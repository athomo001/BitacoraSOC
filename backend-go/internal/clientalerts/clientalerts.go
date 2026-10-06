// Package clientalerts evalúa los Avisos por cliente (clientEscalationRules
// de tipo special_alert del legacy, clientAlertController.js): un mensaje que
// sale antes de enviar o copiar un reporte a ese cliente, en ciertas
// ventanas horarias. Reglas puras, sin base de datos.
package clientalerts

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"time"
)

// Modos de ventana del legacy.
const (
	ModeAlways               = "always"
	ModeOutsideBusinessHours = "outside_business_hours"
	ModeBetweenHours         = "between_hours"
	ModeAfterHour            = "after_hour"
	ModeBeforeHour           = "before_hour"
	ModeWeekendOnly          = "weekend_only"
	ModeWeekdaysOnly         = "weekdays_only"
)

// ValidModes son los que acepta la API.
var ValidModes = map[string]bool{ModeAlways: true, ModeOutsideBusinessHours: true, ModeBetweenHours: true, ModeAfterHour: true,
	ModeBeforeHour: true, ModeWeekendOnly: true, ModeWeekdaysOnly: true}

// Window es una ventana horaria de la regla.
type Window struct {
	Mode        string `json:"mode"`
	StartTime   string `json:"startTime"`
	EndTime     string `json:"endTime"`
	DaysOfWeek  []int  `json:"daysOfWeek"` // 0 = domingo; vacío = todos
	HolidayOnly bool   `json:"holidayOnly"`
}

// Rule es lo que se evalúa.
type Rule struct {
	ID           string
	Timezone     string
	ValidFrom    *time.Time
	ValidTo      *time.Time
	HolidayDates []string // "2026-09-18"
	Windows      []Window
}

var hhmm = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

// ValidTime dice si v es "HH:MM".
func ValidTime(v string) bool { return hhmm.MatchString(v) }

func toMinutes(v string) int {
	m := hhmm.FindStringSubmatch(v)
	if m == nil {
		return 0
	}
	h, _ := strconv.Atoi(m[1])
	mm, _ := strconv.Atoi(m[2])
	return h*60 + mm
}

// inRange incluye los extremos y cruza la medianoche (22:00–06:00).
func inRange(now, start, end int) bool {
	if start <= end {
		return now >= start && now <= end
	}
	return now >= start || now <= end
}

type local struct {
	date    string
	weekday int
	minutes int
}

func localContext(now time.Time, tz string) local {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc, err = time.LoadLocation("America/Santiago")
		if err != nil {
			loc = time.UTC
		}
	}
	t := now.In(loc)
	return local{date: t.Format("2006-01-02"), weekday: int(t.Weekday()), minutes: t.Hour()*60 + t.Minute()}
}

func windowMatch(w Window, l local, holidays []string) bool {
	if len(w.DaysOfWeek) > 0 && !slices.Contains(w.DaysOfWeek, l.weekday) {
		return false
	}
	if w.HolidayOnly && !slices.Contains(holidays, l.date) {
		return false
	}
	start, end := toMinutes(w.StartTime), toMinutes(w.EndTime)
	switch w.Mode {
	case ModeAlways, "":
		return true
	case ModeOutsideBusinessHours:
		return !inRange(l.minutes, start, end)
	case ModeBetweenHours:
		return inRange(l.minutes, start, end)
	case ModeAfterHour:
		return l.minutes >= start
	case ModeBeforeHour:
		return l.minutes <= end
	case ModeWeekendOnly:
		return l.weekday == 0 || l.weekday == 6
	case ModeWeekdaysOnly:
		return l.weekday >= 1 && l.weekday <= 5
	}
	return false
}

// Evaluate dice si la regla aplica ahora y su clave de ocurrencia: con
// vigencia, la vigencia; si es recurrente, el día local (un "Leí el aviso"
// vale para ese día), como buildOccurrenceKey del legacy.
func Evaluate(r Rule, now time.Time) (bool, string) {
	if r.ValidFrom != nil && now.Before(*r.ValidFrom) {
		return false, ""
	}
	if r.ValidTo != nil && now.After(*r.ValidTo) {
		return false, ""
	}
	l := localContext(now, r.Timezone)
	windows := r.Windows
	if len(windows) == 0 {
		windows = []Window{{Mode: ModeAlways, StartTime: "09:00", EndTime: "17:00"}}
	}
	for _, w := range windows {
		if windowMatch(w, l, r.HolidayDates) {
			return true, occurrenceKey(r, l)
		}
	}
	return false, ""
}

func occurrenceKey(r Rule, l local) string {
	if r.ValidFrom != nil || r.ValidTo != nil {
		from, to := "open", "open"
		if r.ValidFrom != nil {
			from = r.ValidFrom.UTC().Format(time.RFC3339)
		}
		if r.ValidTo != nil {
			to = r.ValidTo.UTC().Format(time.RFC3339)
		}
		return fmt.Sprintf("%s-%s-%s", r.ID, from, to)
	}
	return r.ID + "-" + l.date
}
