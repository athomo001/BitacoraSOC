package mailtpl

import (
	"strings"
	"testing"
	"time"
)

func TestRenderAgendaDigest(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	html, err := RenderAgendaDigest(AgendaDigestOptions{
		Title: "Tus pendientes de hoy", PeriodLabel: "Jueves 15-10-2026", BrandName: "Bitácora Ops", Year: 2026, Location: loc, OpenTickets: 2,
		Items: []AgendaItem{
			{Task: "Revisión de reglas <SIEM>", Detail: "SOC", Who: "Tú", Due: time.Date(2026, 10, 13, 20, 0, 0, 0, loc), State: "late"},
			{Task: "Informe mensual", Detail: "SOC", Who: "SOC N2", Client: "Netics", Due: time.Date(2026, 10, 15, 20, 0, 0, 0, loc), State: "today"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"TAREA", "RESPONSABLE", "ATRASADA", "VENCE HOY", "Martes", "13-10-2026", "20:00", "Netics", "2 tickets abiertos a tu nombre", "&lt;SIEM&gt;", "AGENDA", "Tus pendientes de hoy"} {
		if !strings.Contains(html, want) {
			t.Errorf("falta %q", want)
		}
	}
	if strings.Contains(html, "ANALISTA") {
		t.Error("los encabezados de dotación no van en el resumen")
	}
}
