package handler

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Regresión: crear un ticket desde la bitácora usaba la entrada COMPLETA
// como título (Markdown, varias líneas, IoCs pegados...).
func TestTicketTitleFromContent_UsesFirstMeaningfulLine(t *testing.T) {
	got := ticketTitleFromContent("\n## Corte FO Nodo Puerto Montt\n\nCuadrilla Q-88 en ruta con OTDR.")
	if got != "Corte FO Nodo Puerto Montt" {
		t.Fatalf("got %q", got)
	}
}

func TestTicketTitleFromContent_TruncatesLongLines(t *testing.T) {
	got := ticketTitleFromContent(strings.Repeat("enlace caído ", 30))
	if utf8.RuneCountInString(got) > ticketTitleMaxRunes || !strings.HasSuffix(got, "…") {
		t.Fatalf("título sin acotar: %d runas, %q", utf8.RuneCountInString(got), got)
	}
}

func TestResolutionWindow(t *testing.T) {
	if resolutionWindow("incident") >= resolutionWindow("service_request") {
		t.Fatal("un incidente vence antes que un requerimiento")
	}
}

func TestTicketNotLinkable(t *testing.T) {
	for _, status := range []db.TicketStatus{db.TicketStatusClosed, db.TicketStatusCancelled} {
		if !ticketNotLinkable(status) {
			t.Fatalf("%s no debería aceptar entradas nuevas", status)
		}
	}
	for _, status := range []db.TicketStatus{db.TicketStatusNew, db.TicketStatusInProgress, db.TicketStatusPendingVendor, db.TicketStatusResolved} {
		if ticketNotLinkable(status) {
			t.Fatalf("%s sí acepta entradas (resolved se reabre)", status)
		}
	}
}
