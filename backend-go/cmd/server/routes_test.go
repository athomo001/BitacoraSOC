package main

import (
	"fmt"
	"net/http"
	"os"
	"regexp"
	"testing"
)

// Regresión (Fase 13): "GET /api/backups/export/{kind}" chocaba con
// "GET /api/backups/{id}/download" y el ServeMux entraba en pánico al
// arrancar — invisible para `go build` y para los tests de handlers, que no
// registran las rutas. Este test registra cada patrón de main.go en un
// ServeMux vacío: un conflicto falla acá, no en el primer arranque.
func TestRoutePatternsDoNotConflict(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	patterns := regexp.MustCompile(`mux\.Handle(?:Func)?\("([^"]+)"`).FindAllStringSubmatch(string(source), -1)
	if len(patterns) < 50 {
		t.Fatalf("se esperaban las rutas de main.go, se encontraron %d", len(patterns))
	}
	mux := http.NewServeMux()
	noop := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	for _, p := range patterns {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("la ruta %q no se puede registrar: %v", p[1], fmt.Sprint(r))
				}
			}()
			mux.Handle(p[1], noop)
		}()
	}
}
