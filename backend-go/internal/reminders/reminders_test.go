package reminders

import (
	"testing"
	"time"
)

func TestInProgress(t *testing.T) {
	cases := []struct {
		minute, start, end int
		want               bool
	}{
		{8 * 60, 8 * 60, 20 * 60, true},   // justo al empezar
		{20 * 60, 8 * 60, 20 * 60, false}, // justo al terminar
		{23 * 60, 20 * 60, 8 * 60, true},  // noche, antes de medianoche
		{3 * 60, 20 * 60, 8 * 60, true},   // noche, después de medianoche
		{12 * 60, 20 * 60, 8 * 60, false}, // noche, a mediodía
		{5 * 60, 8 * 60, 8 * 60, true},    // inicio = fin: 24 h
	}
	for _, c := range cases {
		if got := InProgress(c.minute, c.start, c.end); got != c.want {
			t.Errorf("InProgress(%d, %d, %d) = %v, want %v", c.minute, c.start, c.end, got, c.want)
		}
	}
}

func TestDueHoursUsesBlocksInShiftTimezone(t *testing.T) {
	scl, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin base de zonas horarias:", err)
	}
	day := Shift{StartMinute: 8 * 60, EndMinute: 20 * 60, Location: scl}
	r := Reminder{FrequencyType: FrequencyHours, IntervalHours: 4}

	at := func(h, m int) time.Time { return time.Date(2026, 9, 30, h, m, 0, 0, scl) }
	k1, ok := Due(r, day, at(9, 0))
	if !ok || k1 != "hours-2026-09-30-block2" {
		t.Fatalf("09:00 → %q %v", k1, ok)
	}
	// Mismo bloque (08–12): misma clave, el UNIQUE deja un solo envío.
	if k2, _ := Due(r, day, at(11, 59)); k2 != k1 {
		t.Fatalf("11:59 → %q, want %q", k2, k1)
	}
	if k3, _ := Due(r, day, at(12, 0)); k3 != "hours-2026-09-30-block3" {
		t.Fatalf("12:00 → %q", k3)
	}
	// Fuera del turno no toca, aunque sea otro bloque.
	if _, ok := Due(r, day, at(21, 0)); ok {
		t.Fatal("21:00 fuera del turno de día no debería tocar")
	}
	// El instante se lee en la zona del turno, no en la del servidor.
	if _, ok := Due(r, day, at(9, 0).UTC()); !ok {
		t.Fatal("el mismo instante en UTC debería tocar igual")
	}
}

func TestDueFixedWithTolerance(t *testing.T) {
	night := Shift{StartMinute: 20 * 60, EndMinute: 8 * 60, Location: time.UTC}
	r := Reminder{FrequencyType: FrequencyFixed, FixedTimes: []string{"07:30", "mal", "19:30"}}
	at := func(h, m int) time.Time { return time.Date(2026, 9, 30, h, m, 0, 0, time.UTC) }

	if k, ok := Due(r, night, at(7, 31)); !ok || k != "fixed-07:30-2026-09-30" {
		t.Fatalf("07:31 → %q %v", k, ok)
	}
	if _, ok := Due(r, night, at(7, 33)); ok {
		t.Fatal("07:33 está fuera de la tolerancia")
	}
	// 19:30 no toca: el turno de noche recién empieza a las 20:00.
	if _, ok := Due(r, night, at(19, 30)); ok {
		t.Fatal("19:30 está fuera del turno de noche")
	}
}

func TestDueRejectsBadConfig(t *testing.T) {
	s := Shift{StartMinute: 0, EndMinute: 0, Location: time.UTC}
	now := time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)
	for _, r := range []Reminder{
		{FrequencyType: FrequencyHours, IntervalHours: 0},
		{FrequencyType: FrequencyHours, IntervalHours: 25},
		{FrequencyType: FrequencyFixed},
		{FrequencyType: "otra"},
	} {
		if _, ok := Due(r, s, now); ok {
			t.Errorf("%+v no debería tocar", r)
		}
	}
}
