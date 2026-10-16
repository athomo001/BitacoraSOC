package agenda

import (
	"testing"
	"time"
)

func dayList(ds []time.Time) []string {
	out := make([]string, len(ds))
	for i, d := range ds {
		out[i] = FormatDate(d)
	}
	return out
}

func TestWindowRule_Days(t *testing.T) {
	from, to := d("2026-10-15"), d("2026-12-31")
	cases := []struct {
		name string
		rule WindowRule
		want []string
	}{
		{"domingos", WindowRule{Kind: WindowWeekly, Weekdays: []int{0}, Start: "02:00", End: "04:00"},
			[]string{"2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"}},
		{"tercer domingo", WindowRule{Kind: WindowMonthly, Nth: 3, Weekday: 0, Start: "02:00", End: "04:00"},
			[]string{"2026-10-18", "2026-11-15", "2026-12-20"}},
		{"segundo martes", WindowRule{Kind: WindowMonthly, Nth: 2, Weekday: 2, Start: "22:00", End: "02:00"},
			[]string{"2026-11-10", "2026-12-08"}},
		{"último viernes", WindowRule{Kind: WindowMonthly, Nth: 5, Weekday: 5, Start: "20:00", End: "23:00"},
			[]string{"2026-10-30", "2026-11-27", "2026-12-25"}},
		{"día 31 (noviembre no tiene)", WindowRule{Kind: WindowMonthly, Day: 31, Start: "01:00", End: "03:00"},
			[]string{"2026-10-31", "2026-12-31"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := c.rule
			if err := r.Validate(); err != nil {
				t.Fatal(err)
			}
			got := dayList(r.Days(from, to))
			if len(got) != len(c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("got %v, want %v", got, c.want)
				}
			}
		})
	}
}

func TestWindowRule_SpanPasaMedianoche(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	r := WindowRule{Kind: WindowWeekly, Weekdays: []int{2}, Start: "22:00", End: "02:00"}
	from, to := r.Span(d("2026-11-10"), loc)
	if from.In(loc).Format("2006-01-02 15:04") != "2026-11-10 22:00" || to.In(loc).Format("2006-01-02 15:04") != "2026-11-11 02:00" {
		t.Fatalf("span %v → %v", from.In(loc), to.In(loc))
	}
}

func TestWindowRule_Validate(t *testing.T) {
	bad := []WindowRule{
		{Kind: WindowWeekly, Start: "02:00", End: "04:00"},
		{Kind: WindowWeekly, Weekdays: []int{7}, Start: "02:00", End: "04:00"},
		{Kind: WindowMonthly, Start: "02:00", End: "04:00"},
		{Kind: WindowMonthly, Day: 3, Nth: 1, Start: "02:00", End: "04:00"},
		{Kind: WindowMonthly, Day: 3, Start: "02:00", End: "02:00"},
		{Kind: WindowMonthly, Day: 3, Start: "2am", End: "04:00"},
		{Kind: "daily", Start: "02:00", End: "04:00"},
	}
	for i, r := range bad {
		if err := r.Validate(); err == nil {
			t.Errorf("caso %d: debía fallar", i)
		}
	}
}
