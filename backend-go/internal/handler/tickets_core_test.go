package handler

import (
	"strings"
	"testing"
	"time"
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

// Los plazos salen de Administración → Ticketera; con los valores por
// defecto (los que antes estaban fijos) un incidente vence en 8 h y un
// requerimiento en 72 h, con 1 h de respuesta.
func TestSLAWindowsFromSettings(t *testing.T) {
	s := db.TicketSetting{
		SlaP1ResponseMinutes: 15, SlaP1ResolutionMinutes: 240,
		SlaP2ResponseMinutes: 60, SlaP2ResolutionMinutes: 480, SlaP3ResponseMinutes: 60, SlaP3ResolutionMinutes: 480,
		SlaP4ResponseMinutes: 60, SlaP4ResolutionMinutes: 480, SlaRequestResponseMinutes: 60, SlaRequestResolutionMinutes: 4320,
	}
	if resp, res := slaWindows(s, "incident", "p3_medium"); resp != time.Hour || res != 8*time.Hour {
		t.Fatalf("P3: %v / %v", resp, res)
	}
	if resp, res := slaWindows(s, "incident", "p1_critical"); resp != 15*time.Minute || res != 4*time.Hour {
		t.Fatalf("P1 propio: %v / %v", resp, res)
	}
	if _, res := slaWindows(s, "service_request", "p1_critical"); res != 72*time.Hour {
		t.Fatalf("un requerimiento usa su propio plazo, no el de la prioridad: %v", res)
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
