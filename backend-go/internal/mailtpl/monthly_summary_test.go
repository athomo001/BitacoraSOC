package mailtpl

import (
	"strings"
	"testing"
)

func TestRenderMonthlySummary(t *testing.T) {
	html, err := RenderMonthlySummary(MonthlySummaryOptions{
		Rows:  []MonthlyRow{{Name: "Ana <Rojas>", Level: "N1", Tasks: 18, OnTimePct: 94, OpenLate: 0, Skipped: 1, Tickets: 12, SLAPct: 91, AbsentDays: 0}},
		Total: MonthlyRow{Name: "Total Infraestructura", Tasks: 50, OnTimePct: 80, OpenLate: 2, Tickets: 29, SLAPct: -1},
		Title: "Resumen mensual Infraestructura", PeriodLabel: "septiembre 2026", Year: 2026,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"RESUMEN MENSUAL", "Ana &lt;Rojas&gt;", "94 %", "#F57C00", "Total Infraestructura", "2 abiertos", "septiembre 2026", "PERSONA"} {
		if !strings.Contains(html, want) {
			t.Errorf("falta %q", want)
		}
	}
}
