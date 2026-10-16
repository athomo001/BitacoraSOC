package agenda

import (
	"errors"
	"time"
)

// Ventanas de mantenimiento que se repiten (spec/16 §6.1, 9.7, diseño
// aprobado por el dueño 2026-10-15). A diferencia de las tareas, no se mueven
// a un día hábil: el mantenimiento no depende del calendario de la Agenda. El
// handler solo usa los feriados para marcar las que caen en uno (no se
// aplican salvo que la jefatura las apruebe).

const (
	WindowWeekly  = "weekly"  // los Weekdays de cada semana
	WindowMonthly = "monthly" // el día Day del mes, o el Nth Weekday del mes
)

// WindowRule es la regla de una serie de ventanas.
type WindowRule struct {
	Kind     string `json:"kind"`
	Weekdays []int  `json:"weekdays,omitempty"`
	// Day: día fijo del mes (1–31; si el mes es más corto, no hay ventana ese mes).
	Day int `json:"day,omitempty"`
	// Nth + Weekday: «el tercer domingo» (Nth 1–4, 5 = el último).
	Nth     int    `json:"nth,omitempty"`
	Weekday int    `json:"weekday"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

// Validate revisa la regla y deja los días de la semana sin repetir.
func (r *WindowRule) Validate() error {
	if _, err := ParseClock(r.Start); err != nil {
		return errors.New("hora de inicio HH:MM")
	}
	if _, err := ParseClock(r.End); err != nil {
		return errors.New("hora de término HH:MM")
	}
	if r.Start == r.End {
		return errors.New("la ventana debe durar algo")
	}
	switch r.Kind {
	case WindowWeekly:
		seen := map[int]bool{}
		clean := []int{}
		for _, d := range r.Weekdays {
			if d < 0 || d > 6 {
				return errors.New("días de la semana de 0 (domingo) a 6 (sábado)")
			}
			if !seen[d] {
				seen[d] = true
				clean = append(clean, d)
			}
		}
		if len(clean) == 0 {
			return errors.New("elige al menos un día de la semana")
		}
		r.Weekdays = clean
		r.Day, r.Nth = 0, 0
	case WindowMonthly:
		switch {
		case r.Day > 0 && r.Nth > 0:
			return errors.New("elige un día fijo o «el N.º día de la semana», no ambos")
		case r.Day > 0:
			if r.Day > 31 {
				return errors.New("día del mes de 1 a 31")
			}
		case r.Nth > 0:
			if r.Nth > 5 || r.Weekday < 0 || r.Weekday > 6 {
				return errors.New("semana del mes de 1 a 5 (5 = la última) y día de 0 a 6")
			}
		default:
			return errors.New("elige el día del mes")
		}
		r.Weekdays = nil
	default:
		return errors.New("se repite: weekly o monthly")
	}
	return nil
}

// Days: los días (medianoche UTC) en que empieza una ventana entre from y to,
// ambos incluidos.
func (r WindowRule) Days(from, to time.Time) []time.Time {
	var out []time.Time
	switch r.Kind {
	case WindowWeekly:
		on := [7]bool{}
		for _, d := range r.Weekdays {
			on[d] = true
		}
		for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
			if on[d.Weekday()] {
				out = append(out, d)
			}
		}
	case WindowMonthly:
		for m := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC); !m.After(to); m = m.AddDate(0, 1, 0) {
			d, ok := r.dayIn(m.Year(), m.Month())
			if ok && !d.Before(from) && !d.After(to) {
				out = append(out, d)
			}
		}
	}
	return out
}

func (r WindowRule) dayIn(year int, month time.Month) (time.Time, bool) {
	if r.Day > 0 {
		d := time.Date(year, month, r.Day, 0, 0, 0, 0, time.UTC)
		return d, d.Month() == month
	}
	first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	offset := (r.Weekday - int(first.Weekday()) + 7) % 7
	d := first.AddDate(0, 0, offset+7*(r.Nth-1))
	if r.Nth == 5 {
		for d.Month() != month {
			d = d.AddDate(0, 0, -7)
		}
	}
	return d, d.Month() == month
}

// Span: inicio y término de la ventana de un día, en loc. Si End no es
// posterior a Start, termina al día siguiente (pasa la medianoche).
func (r WindowRule) Span(day time.Time, loc *time.Location) (time.Time, time.Time) {
	start, _ := ParseClock(r.Start)
	end, _ := ParseClock(r.End)
	from, to := start.At(day, loc), end.At(day, loc)
	if !to.After(from) {
		to = end.At(day.AddDate(0, 0, 1), loc)
	}
	return from, to
}
