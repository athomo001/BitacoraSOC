package glpi

import (
	"errors"
	"html"
	"strings"
	"testing"
)

func TestIsOurs(t *testing.T) {
	raw := HTML("Cuadrilla en camino")
	if !IsOurs(raw) {
		t.Fatal("lo que arma HTML lleva la marca")
	}
	// GLPI 10 guarda el HTML codificado, a veces dos veces.
	once := html.EscapeString(raw)
	if !IsOurs(once) || !IsOurs(html.EscapeString(once)) {
		t.Fatal("la marca se reconoce aunque venga codificada")
	}
	if IsOurs("<p>Se revisa con Entel.</p>") || IsOurs("") {
		t.Fatal("un seguimiento de GLPI no es nuestro")
	}
	// Text quita la marca: lo que se muestra no la trae.
	if strings.Contains(Text(once), "bitacora-soc-sync") {
		t.Fatalf("Text: %q", Text(once))
	}
}

func TestHTML(t *testing.T) {
	got := HTML("Línea 1\r\n<script>x</script>\nLínea 3")
	if !strings.HasPrefix(got, "<p>Línea 1<br>&lt;script&gt;x&lt;/script&gt;<br>Línea 3</p>") || !strings.HasSuffix(got, SyncMarker) {
		t.Fatalf("HTML: %q", got)
	}
}

func TestPermanent(t *testing.T) {
	cases := map[int]bool{400: true, 403: true, 404: true, 401: false, 408: false, 429: false, 500: false, 503: false}
	for status, want := range cases {
		if got := Permanent(&APIError{Status: status}); got != want {
			t.Errorf("Permanent(%d) = %v", status, got)
		}
	}
	if Permanent(errors.New("connection refused")) {
		t.Error("un error de red se reintenta")
	}
}
