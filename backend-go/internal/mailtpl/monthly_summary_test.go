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

// 10f: las entradas y la calidad del mes van bajo el nombre; con la Ticketera
// apagada, ocupan la columna de tickets.
func TestRenderMonthlySummaryBitacora(t *testing.T) {
	row := MonthlyRow{Name: "Ana", Tasks: 3, OnTimePct: -1, Tickets: 4, SLAPct: 100, Entries: 42, Quality: 61}
	html, err := RenderMonthlySummary(MonthlySummaryOptions{Rows: []MonthlyRow{row}, Total: MonthlyRow{Name: "Total", Entries: 42, Quality: -1}, Bitacora: true, Year: 2026})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"42 entradas en la Bitácora, calidad 61", "Bitácora, sin evaluar", "en SLA", "TICKETS"} {
		if !strings.Contains(html, want) {
			t.Errorf("con tickets: falta %q", want)
		}
	}
	html, err = RenderMonthlySummary(MonthlySummaryOptions{Rows: []MonthlyRow{row}, Total: row, Bitacora: true, NoTickets: true, Year: 2026})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(html, "BITÁCORA") || strings.Contains(html, "TICKETS") || strings.Contains(html, "en SLA") || !strings.Contains(html, "#F57C00") {
		t.Errorf("sin tickets, la columna es la Bitácora: %s", html)
	}
}
