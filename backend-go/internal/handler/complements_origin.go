package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/complements"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// complementCookie es la sesión del origen aislado: HttpOnly, acotada por
// ruta a un complemento y firmada (spec/11 §2). No sirve en la app.
const complementCookie = "bitacora_complement"

// browserStateKey es la clave fija de GET/PUT browser-state (legacy).
const browserStateKey = "browser-state"

// maxBrowserState: tope de lo que un complemento guarda por browser-state.
const maxBrowserState = 1 << 20

// OriginHandler es el servidor del origen aislado de complementos (segundo
// puerto por defecto): solo sirve archivos publicados, la vista previa de un
// ZIP y browser-state. Nada del API de la app es alcanzable desde acá.
func (h *ComplementsHandler) OriginHandler() http.Handler {
	if h.previews == nil {
		h.previews = &previewCache{items: map[string]previewEntry{}}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /c/{slug}/{path...}", h.serveComplement)
	mux.HandleFunc("GET /p/{id}/{path...}", h.servePreview)
	mux.HandleFunc("GET /api/complements/{slug}/browser-state", h.getBrowserState)
	mux.HandleFunc("PUT /api/complements/{slug}/browser-state", h.putBrowserState)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		mux.ServeHTTP(w, r)
	})
}

// PreviewCacheInit deja listo el caché de vistas previas (para tests y para
// la app, que publica sin haber servido todavía el origen).
func (h *ComplementsHandler) PreviewCacheInit() {
	if h.previews == nil {
		h.previews = &previewCache{items: map[string]previewEntry{}}
	}
}

func (h *ComplementsHandler) secureCookie() bool {
	return strings.HasPrefix(h.OriginURL, "https://")
}

// setSession deja la cookie para los archivos y para browser-state del
// complemento (dos rutas: el navegador manda la que corresponde).
func (h *ComplementsHandler) setSession(w http.ResponseWriter, kind, target string, t complements.Ticket, paths ...string) {
	raw, _ := h.Signer.Issue(kind, target, t.UserID, t.Role, complements.SessionTTL)
	for _, p := range paths {
		http.SetCookie(w, &http.Cookie{
			Name: complementCookie, Value: raw, Path: p, MaxAge: int(complements.SessionTTL.Seconds()),
			HttpOnly: true, Secure: h.secureCookie(), SameSite: http.SameSiteLaxMode,
		})
	}
}

// session lee la cookie de la ruta pedida y la valida para ese destino.
func (h *ComplementsHandler) session(r *http.Request, kind, target string) (complements.Ticket, bool) {
	for _, c := range r.Cookies() {
		if c.Name != complementCookie {
			continue
		}
		if t, err := h.Signer.Verify(c.Value, kind, target); err == nil {
			return t, true
		}
	}
	return complements.Ticket{}, false
}

// redeem canjea el enlace de un solo uso (?embed=) por la cookie y
// redirige a la misma dirección sin el parámetro. Devuelve true si ya
// respondió.
func (h *ComplementsHandler) redeem(w http.ResponseWriter, r *http.Request, linkKind, sessionKind, target string, paths ...string) bool {
	raw := r.URL.Query().Get("embed")
	if raw == "" {
		return false
	}
	t, err := h.Signer.Verify(raw, linkKind, target)
	if err == nil {
		claimed, claimErr := h.Queries.ClaimComplementTicket(r.Context(), db.ClaimComplementTicketParams{
			Jti: t.Nonce, UserID: t.UserID, ExpiresAt: pgtype.Timestamptz{Time: time.Unix(t.Expiry, 0), Valid: true},
		})
		if claimErr != nil || claimed == 0 {
			err = complements.ErrTicket
		}
	}
	if err != nil {
		http.Error(w, "El enlace ya se usó o venció. Vuelve a abrir el complemento desde Bitácora Ops.", http.StatusForbidden)
		return true
	}
	h.setSession(w, sessionKind, target, t, paths...)
	clean := *r.URL
	q := clean.Query()
	q.Del("embed")
	clean.RawQuery = q.Encode()
	http.Redirect(w, r, clean.RequestURI(), http.StatusSeeOther)
	return true
}

func (h *ComplementsHandler) serveComplement(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if !complements.ValidSlug(slug) {
		http.NotFound(w, r)
		return
	}
	if h.redeem(w, r, complements.KindEmbed, complements.KindSession, slug, "/c/"+slug+"/", "/api/complements/"+slug+"/") {
		return
	}
	if _, ok := h.session(r, complements.KindSession, slug); !ok {
		http.Error(w, "Abre el complemento desde Bitácora Ops.", http.StatusUnauthorized)
		return
	}
	c, err := h.Queries.GetComplementBySlug(r.Context(), slug)
	if err != nil || c.SourceType != db.ComplementSourceZipStatic || c.Status != db.ComplementStatusActive {
		http.NotFound(w, r)
		return
	}
	on, _ := h.Enabled(r.Context())
	if !on {
		http.NotFound(w, r)
		return
	}
	p := r.PathValue("path")
	if p == "" || strings.HasSuffix(p, "/") {
		p += c.EntryPath
	}
	p = path.Clean(p)
	f, err := h.Queries.GetComplementFile(r.Context(), db.GetComplementFileParams{Slug: slug, Path: p})
	if err != nil {
		http.NotFound(w, r)
		return
	}
	h.writeFile(w, r, f.ContentType, f.Sha256, f.Content, c.ConnectHosts)
}

func (h *ComplementsHandler) writeFile(w http.ResponseWriter, r *http.Request, contentType, sha string, content []byte, hosts []string) {
	etag := `"` + sha + `"`
	w.Header().Set("Content-Security-Policy", complements.CSP(h.AppOrigin, hosts))
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(content)
}

// ===== Vista previa (solo admin, sin publicar) =====

type previewEntry struct {
	files   map[string]complements.File
	hosts   []string
	expires time.Time
}

// previewCache guarda el ZIP ya descomprimido de las vistas previas
// abiertas (máximo 3, 10 minutos), para no descomprimirlo en cada archivo.
type previewCache struct {
	mu    sync.Mutex
	items map[string]previewEntry
}

func (c *previewCache) get(id string) (previewEntry, bool) {
	if c == nil {
		return previewEntry{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[id]
	if !ok || time.Now().After(e.expires) {
		delete(c.items, id)
		return previewEntry{}, false
	}
	return e, true
}

func (c *previewCache) put(id string, e previewEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, v := range c.items {
		if time.Now().After(v.expires) || len(c.items) >= 3 {
			delete(c.items, k)
		}
	}
	c.items[id] = e
}

func (c *previewCache) forget(id string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, id)
}

func (h *ComplementsHandler) servePreview(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	uploadID, err := uuid.Parse(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if h.redeem(w, r, complements.KindPreview, complements.KindSession, "preview:"+id, "/p/"+id+"/") {
		return
	}
	t, ok := h.session(r, complements.KindSession, "preview:"+id)
	if !ok || t.Role != "admin" {
		http.Error(w, "La vista previa se abre desde Administración → Complementos.", http.StatusUnauthorized)
		return
	}
	entry, ok := h.previews.get(id)
	if !ok {
		up, err := h.Queries.GetComplementUpload(r.Context(), uploadID)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		analysis, files, err := complements.Analyze(up.Filename, up.Content)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		entry = previewEntry{files: map[string]complements.File{}, hosts: analysis.ConnectHosts, expires: time.Now().Add(10 * time.Minute)}
		for _, f := range files {
			entry.files[f.Path] = f
		}
		h.previews.put(id, entry)
	}
	p := r.PathValue("path")
	if p == "" || strings.HasSuffix(p, "/") {
		p += "index.html"
	}
	f, ok := entry.files[path.Clean(p)]
	if !ok {
		http.NotFound(w, r)
		return
	}
	// En la vista previa se permiten los hosts detectados, para ver si
	// funciona antes de decidir cuáles autorizar.
	h.writeFile(w, r, f.ContentType, f.SHA256, f.Content, entry.hosts)
}

// ===== browser-state (mismo contrato que el legacy) =====

func (h *ComplementsHandler) stateComplement(w http.ResponseWriter, r *http.Request) (db.Complement, complements.Ticket, bool) {
	slug := r.PathValue("slug")
	t, ok := h.session(r, complements.KindSession, slug)
	if !ok {
		writeLegacyError(w, http.StatusUnauthorized, "Abre el complemento desde Bitácora Ops")
		return db.Complement{}, t, false
	}
	c, err := h.Queries.GetComplementBySlug(r.Context(), slug)
	if err != nil || c.Status == db.ComplementStatusDisabled {
		writeLegacyError(w, http.StatusNotFound, "Complemento no encontrado")
		return db.Complement{}, t, false
	}
	return c, t, true
}

func (h *ComplementsHandler) getBrowserState(w http.ResponseWriter, r *http.Request) {
	c, _, ok := h.stateComplement(w, r)
	if !ok {
		return
	}
	rec, err := h.Queries.GetComplementStorage(r.Context(), db.GetComplementStorageParams{ComplementID: c.ID, Key: browserStateKey})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeLegacyError(w, http.StatusInternalServerError, "No se pudo leer el estado")
		return
	}
	out := map[string]any{"slug": c.Slug, "value": nil, "updatedAt": nil}
	if err == nil {
		out["value"] = json.RawMessage(rec.Value)
		out["updatedAt"] = rec.UpdatedAt.Time
	}
	writeLegacyJSON(w, http.StatusOK, out)
}

func (h *ComplementsHandler) putBrowserState(w http.ResponseWriter, r *http.Request) {
	c, t, ok := h.stateComplement(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBrowserState+1))
	if err != nil || len(body) > maxBrowserState {
		writeLegacyError(w, http.StatusRequestEntityTooLarge, "El estado supera 1 MB")
		return
	}
	var req struct {
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeLegacyError(w, http.StatusBadRequest, "Cuerpo inválido: se espera {value}")
		return
	}
	value := req.Value
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	rec, err := h.Queries.UpsertComplementStorage(r.Context(), db.UpsertComplementStorageParams{
		ComplementID: c.ID, Key: browserStateKey, Value: value,
		UpdatedByUserID: pgtype.UUID{Bytes: t.UserID, Valid: true}, UpdatedVia: "browser",
	})
	if err != nil {
		writeLegacyError(w, http.StatusInternalServerError, "No se pudo guardar el estado")
		return
	}
	writeLegacyJSON(w, http.StatusOK, map[string]any{"slug": c.Slug, "value": json.RawMessage(rec.Value), "updatedAt": rec.UpdatedAt.Time})
}

// Las respuestas hacia complementos usan el formato del legacy (JSON plano
// y {message} en los errores): el código existente las lee así.
func writeLegacyJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeLegacyError(w http.ResponseWriter, status int, message string) {
	writeLegacyJSON(w, status, map[string]string{"message": message})
}
