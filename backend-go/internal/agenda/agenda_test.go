package agenda

import (
	"strings"
	"testing"
	"time"
)

func d(s string) time.Time {
	t, err := ParseDate(s)
	if err != nil {
		panic(err)
	}
	return t
}

func chile() Calendar {
	c := DefaultCalendar()
	for _, h := range HolidaysFor("CL", "2026") {
		c.Holidays[h.Date] = h.Name
	}
	for _, h := range HolidaysFor("cl", "2027") {
		c.Holidays[h.Date] = h.Name
	}
	return c
}

func dates(os []Occurrence) string {
	parts := make([]string, len(os))
	for i, o := range os {
		parts[i] = FormatDate(o.Date)
		if o.MovedFrom != nil {
			parts[i] += "<" + FormatDate(*o.MovedFrom)
		}
	}
	return strings.Join(parts, " ")
}

func TestIsBusiness(t *testing.T) {
	c := chile()
	cases := map[string]bool{
		"2026-10-14": true,  // miércoles
		"2026-10-17": false, // sábado
		"2026-10-12": false, // Encuentro de Dos Mundos (lunes)
		"2026-12-25": false,
		"2026-12-24": true,
	}
	for day, want := range cases {
		if got := c.IsBusiness(d(day)); got != want {
			t.Errorf("%s: hábil = %v, quería %v", day, got, want)
		}
	}
}

func TestBusinessDaysBetween(t *testing.T) {
	c := chile()
	if n := c.BusinessDaysBetween(d("2026-10-09"), d("2026-10-14")); n != 2 { // vie → mié, con el lunes 12 feriado
		t.Fatalf("días hábiles = %d, quería 2", n)
	}
	if n := c.BusinessDaysBetween(d("2026-10-14"), d("2026-10-13")); n != -1 {
		t.Fatalf("hacia atrás = %d, quería -1", n)
	}
	if got := FormatDate(c.AddBusinessDays(d("2026-10-16"), 1)); got != "2026-10-19" {
		t.Fatalf("1 día hábil después del viernes = %s", got)
	}
	if got := FormatDate(c.AddBusinessDays(d("2026-10-13"), -1)); got != "2026-10-09" {
		t.Fatalf("1 día hábil antes del martes 13 = %s (el lunes 12 es feriado)", got)
	}
}

func TestOccurrences(t *testing.T) {
	c := chile()
	from, to := d("2026-10-14"), d("2027-01-31")
	cases := []struct {
		name string
		rec  Recurrence
		want string
	}{
		{"día hábil 5", Recurrence{Kind: KindBizN, N: 5}, "2026-11-06 2026-12-07 2027-01-08"},
		{"último día hábil", Recurrence{Kind: KindLastBiz}, "2026-10-30 2026-11-30 2026-12-31 2027-01-29"},
		{"día 25 se adelanta", Recurrence{Kind: KindFixed, Day: 25, Shift: "prev"}, "2026-10-23<2026-10-25 2026-11-25 2026-12-24<2026-12-25 2027-01-25"},
		{"día 31 en meses cortos", Recurrence{Kind: KindFixed, Day: 31, Shift: "next"}, "2026-11-02<2026-10-31 2026-11-30 2026-12-31"},
		{"una vez", Recurrence{Kind: KindOnce, Date: "2026-10-21"}, "2026-10-21"},
	}
	for _, tc := range cases {
		if got := dates(c.Occurrences(tc.rec, from, to)); got != tc.want {
			t.Errorf("%s:\n got %s\nwant %s", tc.name, got, tc.want)
		}
	}
}

func TestOccurrencesWeeklyAndDaysMoveToNextBusinessDay(t *testing.T) {
	c := chile()
	// lunes: el 12 de octubre es feriado → martes 13
	got := dates(c.Occurrences(Recurrence{Kind: KindWeekly, Weekdays: []int{1}}, d("2026-10-05"), d("2026-10-20")))
	if got != "2026-10-05 2026-10-13<2026-10-12 2026-10-19" {
		t.Fatalf("semanal: %s", got)
	}
	// cada 7 días desde un sábado: siempre se corre al lunes
	got = dates(c.Occurrences(Recurrence{Kind: KindDays, Every: 7, Start: "2026-10-03"}, d("2026-10-14"), d("2026-10-31")))
	if got != "2026-10-19<2026-10-17 2026-10-26<2026-10-24" { // el del 31 se corre al 2 de noviembre, fuera del rango
		t.Fatalf("cada 7 días: %s", got)
	}
	// un día que se corre dentro del rango aparece aunque su fecha original quede antes
	got = dates(c.Occurrences(Recurrence{Kind: KindWeekly, Weekdays: []int{0}}, d("2026-10-19"), d("2026-10-19")))
	if got != "2026-10-19<2026-10-18" {
		t.Fatalf("domingo corrido al lunes: %s", got)
	}
}

func TestOccurrencesNoDuplicates(t *testing.T) {
	c := chile()
	// sábado y domingo se corren al mismo lunes: cuenta una vez
	got := dates(c.Occurrences(Recurrence{Kind: KindWeekly, Weekdays: []int{0, 6}}, d("2026-10-14"), d("2026-10-20")))
	if got != "2026-10-19<2026-10-17" {
		t.Fatalf("sin repetir: %s", got)
	}
}

func TestCalendarWithoutWorkDaysDoesNotLoop(t *testing.T) {
	c := Calendar{Holidays: map[string]string{}}
	if got := len(c.Occurrences(Recurrence{Kind: KindFixed, Day: 10, Shift: "next"}, d("2026-10-01"), d("2026-12-31"))); got != 3 {
		t.Fatalf("ocurrencias = %d", got)
	}
	if c.NthBusinessDay(2026, time.October, 1) != nil {
		t.Fatal("sin días hábiles no hay día hábil 1")
	}
}

func TestValidate(t *testing.T) {
	bad := []Recurrence{
		{Kind: "x"},
		{Kind: KindOnce, Date: "21-10-2026"},
		{Kind: KindDays, Start: "2026-10-14"},
		{Kind: KindWeekly},
		{Kind: KindWeekly, Weekdays: []int{7}},
		{Kind: KindBizN, N: 0},
		{Kind: KindFixed, Day: 10},
	}
	for _, r := range bad {
		if err := r.Validate(); err == nil {
			t.Errorf("%+v debió fallar", r)
		}
	}
	r := Recurrence{Kind: KindWeekly, Weekdays: []int{5, 1, 5}, Day: 3, N: 2}
	if err := r.Validate(); err != nil {
		t.Fatal(err)
	}
	if len(r.Weekdays) != 2 || r.Weekdays[0] != 1 || r.Day != 0 || r.N != 0 {
		t.Fatalf("no quedó normalizada: %+v", r)
	}
}

func TestHolidayCountries(t *testing.T) {
	cs := HolidayCountries()
	if len(cs) == 0 || cs[0].Country != "CL" || len(cs[0].Years) < 2 || cs[0].Years[0] != 2026 {
		t.Fatalf("países: %+v", cs)
	}
	if HolidaysFor("CL", "1990") != nil || HolidaysFor("XX", "2026") != nil {
		t.Fatal("sin datos debe ser nil")
	}
}

func TestClock(t *testing.T) {
	c, err := ParseClock("20:00")
	if err != nil || c.String() != "20:00" {
		t.Fatalf("%v %v", c, err)
	}
	loc, _ := time.LoadLocation("America/Santiago")
	at := c.At(d("2026-10-14"), loc)
	if at.UTC().Format(time.RFC3339) != "2026-10-14T23:00:00Z" {
		t.Fatalf("20:00 en Santiago (UTC-3) = %s", at.UTC())
	}
	if _, err := ParseClock("25:00"); err == nil {
		t.Fatal("hora inválida")
	}
}
