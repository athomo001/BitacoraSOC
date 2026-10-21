package handler

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
)

func day(s string) time.Time {
	d, err := agenda.ParseDate(s)
	if err != nil {
		panic(err)
	}
	return d
}

func at(s string) *time.Time {
	d := day(s).Add(15 * time.Hour)
	return &d
}

// La regla de salud de la CSM (spec/16 §4.4.1).
func TestClientHealth(t *testing.T) {
	base := healthInput{Baseline: day("2026-01-01"), Today: day("2026-10-20"), Loc: time.UTC}
	cases := []struct {
		name  string
		in    func(healthInput) healthInput
		state string
		codes []string
	}{
		{"verde: reunión hace 10 días y tickets en SLA", func(in healthInput) healthInput {
			in.LastMeeting, in.LastContact, in.MeetingKind = at("2026-10-10"), at("2026-10-10"), "meeting"
			return in
		}, "green", nil},
		{"rojo: un ticket fuera de SLA, aunque haya reunión", func(in healthInput) healthInput {
			in.LastMeeting, in.LastContact = at("2026-10-07"), at("2026-10-07")
			in.Breached, in.BreachedFirst = 1, "TKT-2026-00039"
			return in
		}, "red", []string{"ticketBreached"}},
		{"amarillo: sin reunión en +30 días (hubo un contacto)", func(in healthInput) healthInput {
			in.LastMeeting, in.LastContact = at("2026-09-08"), at("2026-10-01")
			return in
		}, "amber", []string{"noMeeting"}},
		{"rojo: sin contacto en +60 días", func(in healthInput) healthInput {
			in.LastMeeting, in.LastContact = at("2026-08-04"), at("2026-08-04")
			return in
		}, "red", []string{"noContact"}},
		{"amarillo: tarea clave atrasada", func(in healthInput) healthInput {
			in.LastMeeting, in.LastContact = at("2026-10-15"), at("2026-10-15")
			in.KeyLate, in.KeyLateFirst = 1, "Avisar la ventana del sábado"
			return in
		}, "amber", []string{"keyLate"}},
		{"cliente nuevo: los días cuentan desde el inicio del servicio", func(in healthInput) healthInput {
			in.Baseline = day("2026-10-05")
			return in
		}, "green", nil},
		{"varios motivos: primero el más grave", func(in healthInput) healthInput {
			in.Breached, in.BreachedFirst = 2, "TKT-1"
			in.KeyLate, in.KeyLateFirst = 1, "Informe"
			in.LastMeeting, in.LastContact = at("2026-09-01"), at("2026-10-01")
			return in
		}, "red", []string{"ticketBreached", "noMeeting", "keyLate"}},
	}
	for _, c := range cases {
		h := clientHealth(c.in(base))
		if h.State != c.state {
			t.Errorf("%s: estado %s, quiero %s", c.name, h.State, c.state)
		}
		if len(h.Reasons) != len(c.codes) {
			t.Errorf("%s: motivos %+v, quiero %v", c.name, h.Reasons, c.codes)
			continue
		}
		for i, code := range c.codes {
			if h.Reasons[i].Code != code {
				t.Errorf("%s: motivo %d = %s, quiero %s", c.name, i, h.Reasons[i].Code, code)
			}
		}
	}
	if h := clientHealth(base); h.Contact.ContactDays != 292 || !h.Contact.FromBaseline {
		t.Errorf("sin contacto nunca: %+v", h.Contact)
	}
}

// Estados de una meta (§4.4.5, preguntas 3 y 6 del dueño).
func TestGoalState(t *testing.T) {
	today := day("2026-10-20")
	future := day("2026-12-15")
	cases := []struct {
		name                                 string
		done, total, left                    int
		bonus, completed, confirmed, manRisk bool
		due                                  time.Time
		want                                 string
		auto                                 bool
	}{
		{"en curso", 1, 3, 40, false, false, false, false, future, "open", false},
		{"en riesgo sola: ≤10 días hábiles y menos de la mitad", 1, 5, 7, false, false, false, false, future, "risk", true},
		{"con la mitad hecha no está en riesgo", 3, 5, 7, false, false, false, false, future, "open", false},
		{"en riesgo a mano", 4, 5, 30, false, false, false, true, future, "risk", false},
		{"cumplida", 3, 3, 30, false, true, false, false, future, "done", false},
		{"bono: cumplida espera la confirmación", 3, 3, 30, true, true, false, false, future, "confirm", false},
		{"bono confirmado", 3, 3, 30, true, true, true, false, future, "done", false},
		{"bono por confirmar aunque pase la fecha", 3, 3, -2, true, true, false, false, day("2026-10-15"), "confirm", false},
		{"no cumplida: pasó la fecha", 1, 3, -3, false, false, false, false, day("2026-10-15"), "failed", false},
		{"sin hitos no entra sola en riesgo", 0, 0, 2, false, false, false, false, future, "open", false},
	}
	for _, c := range cases {
		got, auto := goalState(c.done, c.total, c.bonus, c.completed, c.confirmed, c.manRisk, c.due, today, c.left)
		if got != c.want || auto != c.auto {
			t.Errorf("%s: %s (auto %v), quiero %s (auto %v)", c.name, got, auto, c.want, c.auto)
		}
	}
}

// Fechas de las acciones de una plantilla (días hábiles o corridos).
func TestPlaybookDate(t *testing.T) {
	cal := agenda.DefaultCalendar()
	cal.Holidays["2026-12-08"] = "Inmaculada Concepción"
	today := day("2026-10-20") // martes
	cases := []struct {
		anchor string
		off    int32
		unit   string
		want   string
	}{
		{"2026-10-20", 1, "biz", "2026-10-21"},
		{"2026-10-20", 5, "biz", "2026-10-27"},
		{"2026-11-18", -10, "biz", "2026-11-04"},
		{"2026-11-18", 0, "biz", "2026-11-18"},
		// 90 días corridos antes de la renovación; si cae en sábado, el viernes antes.
		{"2027-03-15", -90, "cal", "2026-12-15"},
		{"2027-03-14", -90, "cal", "2026-12-14"},
		// Cae en un feriado: el hábil anterior.
		{"2027-01-07", -30, "cal", "2026-12-07"},
		// Lo que ya pasó queda para hoy.
		{"2026-11-12", -90, "cal", "2026-10-20"},
	}
	for _, c := range cases {
		got := playbookDate(day(c.anchor), playbookItemDTO{OffsetDays: c.off, OffsetUnit: c.unit}, cal, today)
		if agenda.FormatDate(got) != c.want {
			t.Errorf("%s %+d %s = %s, quiero %s", c.anchor, c.off, c.unit, agenda.FormatDate(got), c.want)
		}
	}
}

func TestFormatDuration(t *testing.T) {
	cases := map[float64]string{0: "-", 540: "9 min", 22320: "6,2 h", 138240: "1,6 d"}
	for in, want := range cases {
		if got := formatDuration(in); got != want {
			t.Errorf("formatDuration(%v) = %q, quiero %q", in, got, want)
		}
	}
}
