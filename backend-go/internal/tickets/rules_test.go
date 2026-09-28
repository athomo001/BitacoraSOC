package tickets

import (
	"testing"
	"time"
)

func TestCanTransition_OnlyValidMoves(t *testing.T) {
	valid := [][2]Status{
		{New, Assigned}, {New, Cancelled},
		{Assigned, InProgress}, {Assigned, Cancelled},
		{InProgress, PendingVendor}, {InProgress, Resolved},
		{PendingVendor, InProgress},
		{Resolved, Closed}, {Resolved, InProgress},
		{Closed, InProgress},
	}
	for _, m := range valid {
		if !CanTransition(m[0], m[1]) {
			t.Fatalf("%s → %s debería ser válido", m[0], m[1])
		}
	}
	// Regresión: antes se podía saltar de new a closed o revivir un cancelado.
	invalid := [][2]Status{
		{New, Closed}, {New, Resolved}, {Cancelled, InProgress}, {Closed, Resolved},
		{PendingVendor, Resolved}, {New, New}, {Resolved, PendingVendor},
	}
	for _, m := range invalid {
		if CanTransition(m[0], m[1]) {
			t.Fatalf("%s → %s no debería ser válido", m[0], m[1])
		}
	}
}

func TestIsReopen(t *testing.T) {
	if !IsReopen(Resolved, InProgress) || !IsReopen(Closed, InProgress) {
		t.Fatal("volver a en curso desde resuelto o cerrado es reabrir")
	}
	if IsReopen(PendingVendor, InProgress) {
		t.Fatal("retomar tras la pausa no es reabrir")
	}
}

func TestPriority_ITILMatrix(t *testing.T) {
	cases := map[[2]string]string{
		{"high", "critical"}: "p1_critical", {"high", "high"}: "p1_critical",
		{"high", "low"}: "p2_high", {"low", "critical"}: "p2_high",
		{"medium", "low"}: "p3_medium", {"low", "medium"}: "p3_medium",
		{"low", "low"}: "p4_low",
	}
	for in, want := range cases {
		if got := Priority(in[0], in[1]); got != want {
			t.Fatalf("Priority(%s, %s) = %s, want %s", in[0], in[1], got, want)
		}
	}
}

var t0 = time.Date(2026, 9, 27, 3, 0, 0, 0, time.UTC)

func base() SLAInput {
	return SLAInput{
		Status: InProgress, CreatedAt: t0,
		ResponseDueAt: t0.Add(time.Hour), ResolutionDueAt: t0.Add(8 * time.Hour),
	}
}

func TestResolutionClock_OnTimeAndAtRisk(t *testing.T) {
	in := base()
	c := ResolutionClock(in, t0.Add(2*time.Hour))
	if c.State != OnTime || c.Percent != 25 || c.RemainingSeconds != int64(6*time.Hour/time.Second) {
		t.Fatalf("a las 2h de 8h: %+v", c)
	}
	if c = ResolutionClock(in, t0.Add(7*time.Hour)); c.State != AtRisk {
		t.Fatalf("con 87%% consumido está en riesgo: %+v", c)
	}
}

func TestResolutionClock_BreachedAfterDue(t *testing.T) {
	c := ResolutionClock(base(), t0.Add(9*time.Hour))
	if c.State != Breached || c.Percent != 100 || c.RemainingSeconds != -3600 {
		t.Fatalf("vencido hace 1h: %+v", c)
	}
}

// La espera de una contrata/carrier no cuenta contra el equipo (spec 04, PATCH tickets).
func TestResolutionClock_PauseMovesDueDate(t *testing.T) {
	in := base()
	in.PausedSeconds = int64(2 * time.Hour / time.Second)
	c := ResolutionClock(in, t0.Add(9*time.Hour))
	if c.State == Breached || !c.DueAt.Equal(t0.Add(10*time.Hour)) {
		t.Fatalf("2h de pausa corren el vencimiento a las 10h: %+v", c)
	}
}

func TestResolutionClock_CurrentPauseFreezesClock(t *testing.T) {
	in := base()
	in.Status = PendingVendor
	in.OnHoldSince = ptr(t0.Add(3 * time.Hour))
	early := ResolutionClock(in, t0.Add(4*time.Hour))
	late := ResolutionClock(in, t0.Add(20*time.Hour))
	if late.State != Paused || late.Percent != early.Percent || late.RemainingSeconds != early.RemainingSeconds {
		t.Fatalf("en pausa el reloj no avanza: %+v vs %+v", early, late)
	}
	if late.PausedForSeconds != int64(17*time.Hour/time.Second) {
		t.Fatalf("pausa en curso de 17h: %d", late.PausedForSeconds)
	}
}

func TestResolutionClock_ResolvedIsMetOrBreached(t *testing.T) {
	in := base()
	in.Status = Resolved
	in.ResolvedAt = ptr(t0.Add(5 * time.Hour))
	if c := ResolutionClock(in, t0.Add(30*time.Hour)); c.State != Met {
		t.Fatalf("resuelto dentro del plazo: %+v", c)
	}
	in.ResolvedAt = ptr(t0.Add(9 * time.Hour))
	if c := ResolutionClock(in, t0.Add(30*time.Hour)); c.State != Breached {
		t.Fatalf("resuelto fuera de plazo queda incumplido: %+v", c)
	}
}

func TestResponseClock(t *testing.T) {
	in := base()
	in.Status = New
	if c := ResponseClock(in, t0.Add(30*time.Minute)); c.State != OnTime {
		t.Fatalf("sin respuesta, a mitad de plazo: %+v", c)
	}
	if c := ResponseClock(in, t0.Add(2*time.Hour)); c.State != Breached {
		t.Fatalf("sin respuesta pasada la hora: %+v", c)
	}
	in.FirstRespondedAt = ptr(t0.Add(8 * time.Minute))
	c := ResponseClock(in, t0.Add(2*time.Hour))
	if c.State != Met || c.ElapsedSeconds != 480 {
		t.Fatalf("respondido a los 8 min: %+v", c)
	}
}

func ptr(v time.Time) *time.Time { return &v }
