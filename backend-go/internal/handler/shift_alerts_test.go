package handler

import (
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
)

func TestTargetWeek_ComoElLegacy(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	cases := []struct {
		now  time.Time
		days int
		want string
	}{
		{time.Date(2026, 10, 16, 10, 0, 0, 0, loc), 7, "2026-10-26"}, // vie + 7 = vie 23 → lunes 26
		{time.Date(2026, 10, 12, 10, 0, 0, 0, loc), 7, "2026-10-19"}, // lun + 7 = lun 19 → ese lunes
		{time.Date(2026, 10, 11, 10, 0, 0, 0, loc), 7, "2026-10-19"}, // dom + 7 = dom 18 → lunes 19
		{time.Date(2026, 10, 16, 10, 0, 0, 0, loc), 1, "2026-10-19"}, // nunca la semana actual
	}
	for _, c := range cases {
		if got := targetWeek(c.now, c.days).Format("2006-01-02"); got != c.want {
			t.Errorf("%s +%d: %s, quería %s", c.now.Format("Mon 2006-01-02"), c.days, got, c.want)
		}
	}
}

func TestCovered(t *testing.T) {
	d := func(day, hour int) time.Time { return time.Date(2026, 10, day, hour, 0, 0, 0, time.UTC) }
	from, to := d(19, 9), d(26, 9)
	if !covered(from, to, []span{{d(12, 9), d(19, 9)}, {d(19, 9), d(26, 9)}}) {
		t.Error("una guardia de lunes a lunes cubre la semana")
	}
	if !covered(from, to, []span{{d(22, 9), d(26, 12)}, {d(18, 0), d(22, 9)}}) {
		t.Error("dos tramos seguidos (desordenados) cubren")
	}
	if covered(from, to, []span{{d(19, 9), d(22, 9)}, {d(23, 9), d(26, 9)}}) {
		t.Error("un día sin nadie es un hueco")
	}
	if covered(from, to, nil) {
		t.Error("sin guardias no hay cobertura")
	}
}

func TestCorreosDelLegacy(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2026, 10, 16, 9, 30, 5, 0, loc)
	m := mailtpl.ChecklistMissing("Bitácora CDC", "09:30", now)
	if m.Subject != "[Bitácora CDC] Checklist pendiente" || !strings.Contains(m.HTML, "No se registró el checklist antes de las <strong>09:30</strong> (16-10-2026).") ||
		!strings.Contains(m.HTML, "Bitácora CDC - 16-10-2026, 9:30:05") {
		t.Fatalf("checklist: %s\n%s", m.Subject, m.HTML)
	}
	g := mailtpl.GuardUncovered("Bitácora CDC", []string{"N2"}, time.Date(2026, 10, 26, 0, 0, 0, 0, loc), time.Date(2026, 11, 1, 0, 0, 0, 0, loc), 10, []string{"N2", "TI"}, now)
	for _, want := range []string{"Recordatorio de escalación interna", "(<strong>10 día(s)</strong>)", "26-10-2026 al 01-11-2026", "Guardias sin cubrir:</strong> N2, TI", "Cargos objetivo:</strong> N2"} {
		if !strings.Contains(g.HTML, want) {
			t.Errorf("guardia: falta %q", want)
		}
	}
	if g.Subject != "[Bitácora CDC] Recordatorio de escalación interna" {
		t.Errorf("asunto: %s", g.Subject)
	}
}
