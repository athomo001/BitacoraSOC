package clientalerts

import (
	"testing"
	"time"
)

func at(t *testing.T, local string) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin zonas horarias")
	}
	v, err := time.ParseInLocation("2006-01-02 15:04", local, loc)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// La regla real de SCJ: "Alertas fuera de horario hábil" (after_hour 17:00, lun–vie).
func TestAfterHourLikeSCJ(t *testing.T) {
	r := Rule{ID: "scj", Timezone: "America/Santiago", Windows: []Window{{Mode: ModeAfterHour, StartTime: "17:00", EndTime: "08:59", DaysOfWeek: []int{1, 2, 3, 4, 5}}}}
	if ok, _ := Evaluate(r, at(t, "2026-10-05 16:59")); ok {
		t.Fatal("antes de las 17:00 no aplica")
	}
	ok, key := Evaluate(r, at(t, "2026-10-05 17:00"))
	if !ok || key != "scj-2026-10-05" {
		t.Fatalf("desde las 17:00 aplica, una vez por día: %v %q", ok, key)
	}
	if ok, _ := Evaluate(r, at(t, "2026-10-04 20:00")); ok {
		t.Fatal("domingo no está en los días de la regla")
	}
}

func TestBetweenHoursCrossesMidnight(t *testing.T) {
	r := Rule{ID: "n", Timezone: "America/Santiago", Windows: []Window{{Mode: ModeBetweenHours, StartTime: "22:00", EndTime: "06:00"}}}
	for local, want := range map[string]bool{"2026-10-05 23:30": true, "2026-10-06 05:59": true, "2026-10-06 12:00": false} {
		if ok, _ := Evaluate(r, at(t, local)); ok != want {
			t.Fatalf("%s: %v", local, ok)
		}
	}
	out := Rule{ID: "o", Timezone: "America/Santiago", Windows: []Window{{Mode: ModeOutsideBusinessHours, StartTime: "09:00", EndTime: "18:00"}}}
	if ok, _ := Evaluate(out, at(t, "2026-10-05 12:00")); ok {
		t.Fatal("dentro del horario hábil no aplica")
	}
	if ok, _ := Evaluate(out, at(t, "2026-10-05 19:00")); !ok {
		t.Fatal("fuera del horario hábil aplica")
	}
}

func TestValidityAndHolidays(t *testing.T) {
	from, to := at(t, "2026-10-05 10:00"), at(t, "2026-10-05 12:00")
	r := Rule{ID: "m", Timezone: "America/Santiago", ValidFrom: &from, ValidTo: &to}
	if ok, _ := Evaluate(r, at(t, "2026-10-05 09:59")); ok {
		t.Fatal("antes de la vigencia no aplica")
	}
	ok, key := Evaluate(r, at(t, "2026-10-05 11:00"))
	if !ok || key == "m-2026-10-05" {
		t.Fatalf("con vigencia la ocurrencia es la vigencia: %q", key)
	}
	h := Rule{ID: "f", Timezone: "America/Santiago", HolidayDates: []string{"2026-09-18"}, Windows: []Window{{Mode: ModeAlways, HolidayOnly: true}}}
	if ok, _ := Evaluate(h, at(t, "2026-09-18 10:00")); !ok {
		t.Fatal("feriado: aplica")
	}
	if ok, _ := Evaluate(h, at(t, "2026-09-17 10:00")); ok {
		t.Fatal("día normal: no aplica")
	}
}
