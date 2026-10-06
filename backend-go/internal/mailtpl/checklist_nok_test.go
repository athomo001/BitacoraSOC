package mailtpl

import (
	"os"
	"testing"
	"time"
)

// TestChecklistNokMatchesLegacy: misma alerta que buildNokChecklistEmailHtml
// del legacy (testdata/checklistnok, hecha con su código en America/Santiago
// y el locale del contenedor, en-US).
func TestChecklistNokMatchesLegacy(t *testing.T) {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin zona horaria America/Santiago")
	}
	want, err := os.ReadFile("testdata/checklistnok/inicio.html")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 5, 18, 4, 5, 0, time.UTC).In(loc)
	m := ChecklistNok("Bitácora CDC", "ana.o'rojas", "Turno Día", "inicio", []string{"N2", "Jefe de turno"},
		[]NokService{{Title: "QRadar <consola>", Observation: "Sin eventos\ndesde las 14:00"}, {Title: "Firewall & VPN"}}, at)
	sameAsLegacy(t, m.HTML, string(want))
	if m.Subject != "[Bitácora CDC] Alerta NOK checklist Turno Día (inicio)" {
		t.Fatalf("asunto %q", m.Subject)
	}
	if got := ChecklistNok("", "", "", "cierre", nil, nil, at).Subject; got != "Alerta NOK checklist Sin turno (cierre)" {
		t.Fatalf("asunto sin marca ni turno: %q", got)
	}
}
