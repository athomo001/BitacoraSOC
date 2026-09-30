package complements

import (
	"archive/zip"
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildZip arma un ZIP en memoria con los archivos dados.
func buildZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(content))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAnalyzeStaticStripsSingleRootAndReadsTitle(t *testing.T) {
	data := buildZip(t, map[string]string{
		"mi-app/index.html": "<html><head><title> Clima en terreno </title></head><script src=app.js></script></html>",
		"mi-app/app.js":     "fetch('https://api.open-meteo.com/v1/forecast').then(r => r.json()); new Worker('w.js')",
		"mi-app/w.js":       "",
		"__MACOSX/._index":  "basura de macOS",
	})
	a, files, err := Analyze("Clima Terreno v2.zip", data)
	if err != nil {
		t.Fatal(err)
	}
	if !a.Publishable || a.Stack != StackStatic || a.Files != 3 {
		t.Fatalf("análisis inesperado: %+v", a)
	}
	if files[0].Path != "app.js" || files[1].Path != "index.html" {
		t.Fatalf("no quitó la carpeta raíz: %v, %v", files[0].Path, files[1].Path)
	}
	if a.SuggestedName != "Clima en terreno" || a.SuggestedSlug != "clima-terreno-v2" {
		t.Fatalf("sugerencias: %q %q", a.SuggestedName, a.SuggestedSlug)
	}
	if len(a.ConnectHosts) != 1 || a.ConnectHosts[0] != "https://api.open-meteo.com" {
		t.Fatalf("hosts: %v", a.ConnectHosts)
	}
	if strings.Join(a.Features, ",") != "workers" || len(a.Warnings) != 1 {
		t.Fatalf("features/warnings: %v %v", a.Features, a.Warnings)
	}
	if files[1].ContentType != "text/html; charset=utf-8" {
		t.Fatalf("content type: %s", files[1].ContentType)
	}
}

func TestAnalyzeRejects(t *testing.T) {
	cases := map[string]map[string]string{
		"sale de la carpeta": {"../evil.html": "x", "index.html": "x"},
		"ruta absoluta":      {"/etc/passwd": "x"},
		"código Python":      {"index.html": "x", "server.py": "print(1)"},
		"está vacío":         {"__MACOSX/x": "x"},
	}
	for name, files := range cases {
		_, _, err := Analyze("x.zip", buildZip(t, files))
		if err == nil || !IsInvalid(err) {
			t.Errorf("%s: se esperaba rechazo, got %v", name, err)
		}
	}
	if _, _, err := Analyze("x.zip", []byte("no soy un zip")); !IsInvalid(err) {
		t.Errorf("basura: %v", err)
	}
}

func TestAnalyzeRejectsSymlink(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "link"}
	h.SetMode(fs.ModeSymlink | 0o777)
	w, _ := zw.CreateHeader(h)
	_, _ = w.Write([]byte("/etc/passwd"))
	_ = zw.Close()
	if _, _, err := Analyze("x.zip", buf.Bytes()); !IsInvalid(err) || !strings.Contains(err.Error(), "enlace simbólico") {
		t.Fatalf("symlink: %v", err)
	}
}

func TestAnalyzeDetectsNonStaticStacks(t *testing.T) {
	a, _, err := Analyze("x.zip", buildZip(t, map[string]string{
		"package.json": `{"devDependencies":{"vite":"^8"},"dependencies":{"react":"^20"}}`, "index.html": "x",
	}))
	if err != nil || a.Publishable || a.Stack != StackReact || a.Reason == "" {
		t.Fatalf("react: %+v %v", a, err)
	}
	a, _, _ = Analyze("x.zip", buildZip(t, map[string]string{"package.json": `{"dependencies":{"express":"4"}}`}))
	if a.Publishable || a.Stack != StackNode {
		t.Fatalf("node: %+v", a)
	}
	a, _, _ = Analyze("x.zip", buildZip(t, map[string]string{"app.js": "x"}))
	if a.Publishable || !strings.Contains(a.Reason, "index.html") {
		t.Fatalf("sin index: %+v", a)
	}
}

func TestSuggestSlug(t *testing.T) {
	for in, want := range map[string]string{
		"doom-browser.zip": "doom-browser", "Diccionario Logs Ciber.ZIP": "diccionario-logs-ciber",
		"ñ.zip": "complemento", `C:\tmp\Mi App.zip`: "mi-app",
	} {
		if got := SuggestSlug(in); got != want {
			t.Errorf("SuggestSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

// Criterio de aceptación de la Fase 13b: los ZIP de Extras/ del legacy se
// publican sin modificarlos. Se salta si el worktree del legacy no está.
func TestAnalyzeLegacyExtras(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "..", "BitacoraSOC-legacy", "Extras")
	for _, tc := range []struct {
		file  string
		files int
		wasm  bool
	}{{"doom-browser.zip", 11, true}, {"diccionario-logs-ciber.zip", 4, false}} {
		data, err := os.ReadFile(filepath.Join(dir, tc.file))
		if err != nil {
			t.Skip("sin el legacy en ../BitacoraSOC-legacy:", err)
		}
		a, _, err := Analyze(tc.file, data)
		if err != nil || !a.Publishable || a.Files != tc.files {
			t.Fatalf("%s: %+v %v", tc.file, a, err)
		}
		if tc.file == "doom-browser.zip" && !strings.Contains(strings.Join(a.ConnectHosts, ","), "https://fonts.cdnfonts.com") {
			t.Fatalf("DOOM carga una fuente externa y debería sugerir autorizarla: %v", a.ConnectHosts)
		}
		hasWasm := strings.Contains(strings.Join(a.Features, ","), "webassembly")
		if hasWasm != tc.wasm {
			t.Fatalf("%s: features %v", tc.file, a.Features)
		}
	}
}
