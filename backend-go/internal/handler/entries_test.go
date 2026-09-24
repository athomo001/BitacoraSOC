package handler

import (
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/uuid"
)

func TestValidEntryType(t *testing.T) {
	for _, tp := range []string{"operativa", "incidente", "ofensa"} {
		if !validEntryType(tp) {
			t.Fatalf("%q debería ser un entryType válido", tp)
		}
	}
	if validEntryType("checklist") {
		t.Fatal("'checklist' es un valor del ENUM reservado para el auto-inyectado de la Fase 11, no para POST /api/entries manual")
	}
	if validEntryType("inventado") {
		t.Fatal("un valor fuera del ENUM no debería validar")
	}
}

func TestAttachmentURL_RoundTrip(t *testing.T) {
	id := uuid.New()
	url := attachmentURL(id)
	got, ok := attachmentIDFromURL(url)
	if !ok || got != id {
		t.Fatalf("round-trip falló: url=%q got=%v ok=%v", url, got, ok)
	}
}

func TestAttachmentIDFromURL_RejectsGarbage(t *testing.T) {
	cases := []string{"", "/api/attachments/no-es-un-uuid", "https://evil.example/api/attachments/" + uuid.New().String(), "/api/entries/" + uuid.New().String()}
	for _, c := range cases {
		if _, ok := attachmentIDFromURL(c); ok {
			t.Fatalf("%q no debería resolver a un id válido", c)
		}
	}
}

func TestParseEntryFilters_ToDateIsInclusiveOfWholeDay(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/entries?from=2026-09-01&to=2026-09-05", nil)
	f, err := parseEntryFilters(req)
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if !f.FromDate.Valid || f.FromDate.Time.Format("2006-01-02") != "2026-09-01" {
		t.Fatalf("from mal parseado: %+v", f.FromDate)
	}
	// "to" debe cubrir el día 05 completo: el límite exclusivo real es el 06.
	if !f.ToDate.Valid || f.ToDate.Time.Format("2006-01-02") != "2026-09-06" {
		t.Fatalf("to debería ajustarse a medianoche del día siguiente, got %+v", f.ToDate)
	}
}

func TestParseEntryFilters_InvalidDateIsRejected(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/entries?from=no-es-una-fecha", nil)
	if _, err := parseEntryFilters(req); err == nil {
		t.Fatal("una fecha mal formada debería devolver error, no ignorarse en silencio")
	}
}

func TestParseEntryFilters_QAcceptsLooseOperatorCharacters(t *testing.T) {
	// HU-7: 'q' se resuelve con websearch_to_tsquery, no debe rechazarse acá
	// (la validación de sintaxis de tsquery ocurre en Postgres, y
	// websearch_to_tsquery nunca lanza error de sintaxis) — este test solo
	// confirma que el parseo de filtros no le pone restricciones propias.
	params := url.Values{"q": {`"firewall &"`}}
	req := httptest.NewRequest("GET", "/api/entries?"+params.Encode(), nil)
	f, err := parseEntryFilters(req)
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if !f.Q.Valid {
		t.Fatal("q con caracteres de operador sueltos debería seguir pasando tal cual a la capa de datos")
	}
}
