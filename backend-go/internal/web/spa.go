// Package web sirve el build de Angular embebido en el binario Go
// (spec/07-backend-arquitectura-go.md sección 1, Fase 3 del roadmap:
// "//go:embed sirviendo el build de Angular desde el binario Go").
//
// dist/browser/ se puebla con el output real de `ng build` (frontend-v2/dist/
// frontend-v2/browser/*) — ver scripts/build-frontend.sh y Dockerfile. El
// placeholder mínimo que trae el repo por defecto existe solo para que
// `go build` nunca falle en un clon fresco antes de correr ese script (Go
// exige que el path de //go:embed exista de verdad al compilar).
package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:dist/browser
var distFS embed.FS

// Handler sirve el SPA de Angular: archivos estáticos reales tal cual, y
// fallback a index.html para cualquier ruta que no matchee un archivo (rutas
// del router de Angular, ej. /entries, /shifts) — el router de Angular las
// resuelve en el cliente, no el servidor.
func Handler() (http.Handler, error) {
	browserFS, err := fs.Sub(distFS, "dist/browser")
	if err != nil {
		return nil, err
	}
	fileServer := http.FileServer(http.FS(browserFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(browserFS, trimLeadingSlash(r.URL.Path)); err != nil {
			// No es un archivo real del bundle (JS/CSS/fuente/favicon) — es
			// una ruta de Angular Router, se sirve index.html y el router
			// del lado del cliente decide qué mostrar.
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	}), nil
}

func trimLeadingSlash(path string) string {
	if len(path) > 0 && path[0] == '/' {
		return path[1:]
	}
	return path
}
