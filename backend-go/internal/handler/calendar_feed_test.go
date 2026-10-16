package handler

import (
	"strings"
	"testing"
	"time"
)

func TestICS_EventosYEscapes(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	stamp := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	cal := icsCalendar{Name: "Bitácora Ops", Stamp: stamp, Events: []icsEvent{
		{UID: "agenda-1", Summary: "Informe mensual, Netics; v2", AllDay: time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC), Description: "Área: TI\nVence a las 20:00"},
		{UID: "ventana-2", Summary: "Mantenimiento: Parches", Start: time.Date(2026, 11, 10, 22, 0, 0, 0, loc), End: time.Date(2026, 11, 11, 2, 0, 0, 0, loc)},
	}}
	out := cal.String()
	for _, want := range []string{
		"BEGIN:VCALENDAR\r\n", "X-WR-CALNAME:Bitácora Ops\r\n",
		"DTSTART;VALUE=DATE:20261016\r\n", "DTEND;VALUE=DATE:20261017\r\n",
		`SUMMARY:Informe mensual\, Netics\; v2` + "\r\n", `DESCRIPTION:Área: TI\nVence a las 20:00` + "\r\n",
		"DTSTART:20261111T010000Z\r\n", "DTEND:20261111T050000Z\r\n",
		"TRANSP:TRANSPARENT\r\n", "END:VCALENDAR\r\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("falta %q en:\n%s", want, out)
		}
	}
	if strings.Count(out, "BEGIN:VEVENT") != 2 {
		t.Fatalf("eventos: %s", out)
	}
}

func TestICS_FoldNoPartirCaracteres(t *testing.T) {
	s := "SUMMARY:" + strings.Repeat("ñ", 60)
	out := icsFold(s)
	for _, l := range strings.Split(strings.TrimSuffix(out, "\r\n"), "\r\n") {
		if len(l) > 75 {
			t.Fatalf("línea de %d octetos", len(l))
		}
		if !strings.HasPrefix(l, "SUMMARY") && !strings.HasPrefix(l, " ") {
			t.Fatalf("continuación sin espacio: %q", l)
		}
	}
	joined := strings.ReplaceAll(strings.TrimSuffix(out, "\r\n"), "\r\n ", "")
	if joined != s {
		t.Fatal("al desplegar no vuelve al original")
	}
}
