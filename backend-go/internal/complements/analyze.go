// Package complements es el núcleo de los complementos (spec/11-complementos.md):
// el análisis del ZIP que sube un admin, la firma de los enlaces de un solo
// uso y de la cookie del origen aislado, la CSP de cada complemento y el
// circuit breaker de los servicios. No toca la base ni HTTP: eso vive en
// internal/handler.
package complements

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"path"
	"regexp"
	"sort"
	"strings"
)

// Límites del publicador (spec/11 §4, los del legacy ajustados a DOOM).
const (
	MaxZipBytes          = 25 << 20
	MaxFiles             = 400
	MaxUncompressedBytes = 40 << 20
	MaxFileBytes         = 16 << 20
)

// Stacks que se reconocen. Solo StackStatic se publica en la Fase 13b; los
// demás se informan para registrarlos como servicio (spec/11 §3).
const (
	StackStatic = "static-html"
	StackVite   = "vite-frontend"
	StackReact  = "react-vite"
	StackNode   = "node-service"
)

// ErrInvalid es un ZIP que no se acepta; el mensaje dice por qué, en
// lenguaje claro, y va tal cual a la pantalla.
type ErrInvalid struct{ Reason string }

func (e *ErrInvalid) Error() string { return e.Reason }

func invalid(format string, a ...any) error { return &ErrInvalid{Reason: fmt.Sprintf(format, a...)} }

// IsInvalid dice si err es un rechazo del ZIP (400) y no un fallo interno.
func IsInvalid(err error) bool {
	var e *ErrInvalid
	return errors.As(err, &e)
}

// blockedExtensions: código de servidor que no tiene sentido en un
// complemento estático (lista del legacy más scripts web de servidor).
// .cmd/.ps1/.sh no están: DOOM trae run-local.cmd y se publica sin tocarlo.
var blockedExtensions = map[string]string{
	".py": "Python", ".java": "Java", ".cs": "C#/.NET", ".go": "Go", ".php": "PHP", ".rb": "Ruby",
	".rs": "Rust", ".kt": "Kotlin", ".swift": "Swift", ".jsp": "JSP", ".asp": "ASP", ".aspx": "ASP.NET", ".cgi": "CGI",
}

// contentTypes explícitos: mime.TypeByExtension depende del sistema (en
// Windows lee el registro) y .wasm/.mjs no siempre están.
var contentTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json",
	".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
	".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
	".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
	".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".xml": "application/xml",
	".zip": "application/zip", ".pdf": "application/pdf",
}

// ContentType del archivo por su extensión; lo desconocido va como binario.
func ContentType(p string) string {
	ext := strings.ToLower(path.Ext(p))
	if ct, ok := contentTypes[ext]; ok {
		return ct
	}
	if ct := mime.TypeByExtension(ext); ct != "" && !strings.HasPrefix(ct, "text/html") {
		return ct
	}
	return "application/octet-stream"
}

// File es un archivo del ZIP ya normalizado, listo para complement_files.
type File struct {
	Path        string
	ContentType string
	SHA256      string
	Content     []byte
}

// Analysis es lo que se muestra al admin antes de publicar.
type Analysis struct {
	Stack         string   `json:"stack"`
	Publishable   bool     `json:"publishable"`
	Reason        string   `json:"reason,omitempty"`
	Entry         string   `json:"entry"`
	Files         int      `json:"files"`
	Bytes         int64    `json:"bytes"`
	LargestPath   string   `json:"largestPath"`
	LargestBytes  int64    `json:"largestBytes"`
	Features      []string `json:"features"`
	Warnings      []string `json:"warnings"`
	SuggestedSlug string   `json:"suggestedSlug"`
	SuggestedName string   `json:"suggestedName"`
	ConnectHosts  []string `json:"connectHosts"`
	SHA256        string   `json:"sha256"`
}

var (
	slugClean = regexp.MustCompile(`[^a-z0-9-]+`)
	slugValid = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,40}$`)
	titleRe   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	// Hojas de estilo y fuentes externas (<link href>, @import): DOOM trae una.
	styleHosts = regexp.MustCompile(`(?:<link[^>]+href=|@import\s+(?:url\()?)\s*['"]?(https://[a-zA-Z0-9.-]+(?::\d+)?)`)
	fetchHosts = regexp.MustCompile(`(?:fetch|axios(?:\.[a-z]+)?|new\s+(?:WebSocket|EventSource))\(\s*['"` + "`" + `]((?:https?|wss?)://[a-zA-Z0-9.-]+(?::\d+)?)`)
)

// ValidSlug dice si s sirve como identificador de complemento.
func ValidSlug(s string) bool { return slugValid.MatchString(s) }

// SuggestSlug arma un identificador a partir de un nombre de archivo.
func SuggestSlug(name string) string {
	s := strings.ToLower(strings.TrimSuffix(path.Base(strings.ReplaceAll(name, `\`, "/")), path.Ext(name)))
	s = strings.Trim(slugClean.ReplaceAllString(s, "-"), "-")
	if len(s) > 41 {
		s = strings.Trim(s[:41], "-")
	}
	if !ValidSlug(s) {
		return "complemento"
	}
	return s
}

// cleanPath normaliza una ruta del ZIP y la rechaza si sale de la carpeta.
func cleanPath(raw string) (string, error) {
	p := strings.ReplaceAll(raw, `\`, "/")
	if strings.HasPrefix(p, "/") || (len(p) > 1 && p[1] == ':') {
		return "", invalid("el ZIP trae una ruta absoluta (%s)", raw)
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return "", invalid("el ZIP trae una ruta que sale de la carpeta (%s)", raw)
		}
	}
	p = path.Clean(p)
	if p == "." || p == "" {
		return "", nil
	}
	return p, nil
}

func ignored(p string) bool {
	base := path.Base(p)
	return strings.HasPrefix(p, "__MACOSX/") || base == ".DS_Store" || base == "Thumbs.db"
}

// Analyze lee el ZIP en memoria, aplica los límites y las reglas de rutas,
// quita una carpeta raíz única y dice si se puede publicar. Nunca escribe a
// disco. Un rechazo es *ErrInvalid.
func Analyze(filename string, data []byte) (Analysis, []File, error) {
	if len(data) > MaxZipBytes {
		return Analysis{}, nil, invalid("el ZIP pesa más de %d MB", MaxZipBytes>>20)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Analysis{}, nil, invalid("no es un ZIP válido")
	}

	var files []File
	var total int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if f.Mode()&fs.ModeSymlink != 0 {
			return Analysis{}, nil, invalid("el ZIP trae un enlace simbólico (%s)", f.Name)
		}
		p, err := cleanPath(f.Name)
		if err != nil {
			return Analysis{}, nil, err
		}
		if p == "" || ignored(p) {
			continue
		}
		if lang, ok := blockedExtensions[strings.ToLower(path.Ext(p))]; ok {
			return Analysis{}, nil, invalid("el ZIP trae código %s (%s): solo se publican complementos web", lang, p)
		}
		if len(files) >= MaxFiles {
			return Analysis{}, nil, invalid("el ZIP trae más de %d archivos", MaxFiles)
		}
		if f.UncompressedSize64 > MaxFileBytes {
			return Analysis{}, nil, invalid("%s pesa más de %d MB", p, MaxFileBytes>>20)
		}
		rc, err := f.Open()
		if err != nil {
			return Analysis{}, nil, invalid("no se pudo leer %s del ZIP", p)
		}
		// El tamaño declarado puede mentir (zip bomb): se corta al leer.
		content, err := io.ReadAll(io.LimitReader(rc, MaxFileBytes+1))
		_ = rc.Close()
		if err != nil {
			return Analysis{}, nil, invalid("no se pudo leer %s del ZIP", p)
		}
		if len(content) > MaxFileBytes {
			return Analysis{}, nil, invalid("%s pesa más de %d MB", p, MaxFileBytes>>20)
		}
		total += int64(len(content))
		if total > MaxUncompressedBytes {
			return Analysis{}, nil, invalid("el ZIP descomprimido pesa más de %d MB", MaxUncompressedBytes>>20)
		}
		sum := sha256.Sum256(content)
		files = append(files, File{Path: p, Content: content, SHA256: hex.EncodeToString(sum[:])})
	}
	if len(files) == 0 {
		return Analysis{}, nil, invalid("el ZIP está vacío")
	}
	files = stripSingleRoot(files)
	for i := range files {
		files[i].ContentType = ContentType(files[i].Path)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })

	sum := sha256.Sum256(data)
	a := Analysis{
		Files: len(files), Bytes: total, Entry: "index.html", SHA256: hex.EncodeToString(sum[:]),
		SuggestedSlug: SuggestSlug(filename), Features: []string{}, Warnings: []string{}, ConnectHosts: []string{},
	}
	byPath := map[string]*File{}
	hosts := map[string]bool{}
	for i := range files {
		f := &files[i]
		byPath[f.Path] = f
		if int64(len(f.Content)) > a.LargestBytes {
			a.LargestBytes, a.LargestPath = int64(len(f.Content)), f.Path
		}
		ext := strings.ToLower(path.Ext(f.Path))
		if ext == ".css" || ext == ".html" || ext == ".htm" {
			for _, m := range styleHosts.FindAllStringSubmatch(string(f.Content), -1) {
				hosts[strings.ToLower(m[1])] = true
			}
		}
		if ext == ".js" || ext == ".mjs" || ext == ".html" || ext == ".htm" {
			text := string(f.Content)
			for _, m := range fetchHosts.FindAllStringSubmatch(text, -1) {
				hosts[strings.ToLower(m[1])] = true
			}
			addIf(&a.Features, strings.Contains(text, "new Worker("), "workers")
			addIf(&a.Features, strings.Contains(text, "requestPointerLock"), "pointer-lock")
			addIf(&a.Features, strings.Contains(text, "requestFullscreen"), "fullscreen")
			addIf(&a.Features, strings.Contains(text, "WebAssembly") || strings.Contains(f.Path, ".wasm"), "webassembly")
		}
		addIf(&a.Features, ext == ".wasm", "webassembly")
	}
	for h := range hosts {
		a.ConnectHosts = append(a.ConnectHosts, h)
	}
	sort.Strings(a.ConnectHosts)

	a.Stack, a.Reason = detectStack(byPath)
	a.Publishable = a.Stack == StackStatic
	if a.Publishable {
		if idx, ok := byPath["index.html"]; ok {
			if m := titleRe.FindSubmatch(idx.Content); m != nil {
				a.SuggestedName = strings.TrimSpace(string(m[1]))
			}
		} else {
			a.Publishable, a.Reason = false, "falta index.html en la raíz del ZIP (o en su única carpeta)"
		}
	}
	if a.SuggestedName == "" {
		a.SuggestedName = a.SuggestedSlug
	}
	if len([]rune(a.SuggestedName)) > 80 {
		a.SuggestedName = string([]rune(a.SuggestedName)[:80])
	}
	if len(a.ConnectHosts) > 0 {
		a.Warnings = append(a.Warnings, "consulta sitios externos: solo funcionarán los que autorices al publicar")
	}
	return a, files, nil
}

func addIf(list *[]string, cond bool, v string) {
	if !cond {
		return
	}
	for _, x := range *list {
		if x == v {
			return
		}
	}
	*list = append(*list, v)
}

// stripSingleRoot quita la carpeta raíz si todo el ZIP vive dentro de una
// sola ("mi-app/index.html" → "index.html"), como aceptaba el legacy.
func stripSingleRoot(files []File) []File {
	root := ""
	for _, f := range files {
		i := strings.Index(f.Path, "/")
		if i < 0 {
			return files
		}
		if root == "" {
			root = f.Path[:i+1]
		} else if !strings.HasPrefix(f.Path, root) {
			return files
		}
	}
	for i := range files {
		files[i].Path = strings.TrimPrefix(files[i].Path, root)
	}
	return files
}

// detectStack repite las reglas del legacy: package.json con Vite/React o
// un servicio Node se reconocen pero no se publican como estáticos.
func detectStack(byPath map[string]*File) (string, string) {
	pkg, ok := byPath["package.json"]
	if !ok {
		return StackStatic, ""
	}
	var manifest struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	_ = json.Unmarshal(pkg.Content, &manifest)
	has := func(name string) bool {
		_, a := manifest.Dependencies[name]
		_, b := manifest.DevDependencies[name]
		return a || b
	}
	_, viteConfig := byPath["vite.config.js"]
	_, viteTS := byPath["vite.config.ts"]
	isVite := has("vite") || viteConfig || viteTS
	switch {
	case isVite && (has("react") || has("react-dom")):
		return StackReact, "es un proyecto React + Vite: compílalo y sube la carpeta dist, o regístralo como servicio"
	case isVite:
		return StackVite, "es un proyecto Vite: compílalo y sube la carpeta dist, o regístralo como servicio"
	default:
		return StackNode, "es un servicio Node.js: regístralo como servicio con su dirección"
	}
}
