package main

import (
	"fmt"
	"net/http"
	"os"
	"regexp"
	"slices"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/handler"
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

// La pantalla de grupos ofrece como casillas exactamente las capacidades de
// handler.KnownCapabilities (y el backend rechaza cualquier otra). Si una
// ruta empieza a exigir una capacidad nueva, tiene que estar en esa lista o
// ningún grupo la podría otorgar.
func TestCapabilitiesUsadasEstanEnLaListaCerrada(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	used := regexp.MustCompile(`cap[A-Z]\w*\s*=\s*"([^"]+)"`).FindAllStringSubmatch(string(source), -1)
	if len(used) == 0 {
		t.Fatal("no se encontraron constantes cap* en main.go")
	}
	for _, capability := range used {
		if !slices.Contains(handler.KnownCapabilities, capability[1]) {
			t.Errorf("la capacidad %q se exige en una ruta pero no está en handler.KnownCapabilities", capability[1])
		}
	}
}
