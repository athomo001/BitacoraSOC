// Package agenda contiene las reglas puras de la Agenda (spec/16 §4.3, 9.3,
// diseño aprobado por el dueño 2026-10-14): el calendario de días hábiles
// (días de la semana + feriados) y las recurrencias de las tareas
// programadas. Sin DB ni HTTP: el handler arma el calendario desde Postgres y
// llama a estas funciones, mismo patrón que internal/rotation.
//
// El calendario es solo para ordenar la Agenda (vencimientos y avisos). No es
// el horario de la oficina ni tiene relación con Turnos, guardias o
// escalamiento, que siguen 24/7.
package agenda

import (
	"errors"
	"fmt"
	"sort"
	"time"
)

const dateLayout = "2006-01-02"

// Calendar dice qué días son hábiles: los días de la semana marcados
// (0 = domingo … 6 = sábado) que no son feriado.
type Calendar struct {
	WorkDays [7]bool
	// Holidays: "YYYY-MM-DD" → nombre del feriado.
	Holidays map[string]string
}

// DefaultCalendar: lunes a viernes, sin feriados (decisión del dueño).
func DefaultCalendar() Calendar {
	return Calendar{WorkDays: [7]bool{false, true, true, true, true, true, false}, Holidays: map[string]string{}}
}

// ParseDate lee "YYYY-MM-DD" como medianoche UTC (las fechas de la Agenda
// son días civiles; la hora se agrega recién al calcular el vencimiento).
func ParseDate(s string) (time.Time, error) {
	return time.Parse(dateLayout, s)
}

// FormatDate es el inverso de ParseDate.
func FormatDate(d time.Time) string { return d.Format(dateLayout) }

// Day devuelve el día civil de t en loc, como medianoche UTC.
func Day(t time.Time, loc *time.Location) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// IsBusiness: día marcado como hábil y que no es feriado.
func (c Calendar) IsBusiness(d time.Time) bool {
	if !c.WorkDays[d.Weekday()] {
		return false
	}
	_, holiday := c.Holidays[FormatDate(d)]
	return !holiday
}

func (c Calendar) hasWorkDay() bool {
	for _, w := range c.WorkDays {
		if w {
			return true
		}
	}
	return false
}

// step avanza (o retrocede) hasta el siguiente día hábil. Con un calendario
// sin días hábiles devuelve d tal cual, para no quedar en un ciclo infinito.
func (c Calendar) step(d time.Time, dir int) time.Time {
	if !c.hasWorkDay() {
		return d
	}
	for i := 0; i < 400; i++ {
		d = d.AddDate(0, 0, dir)
		if c.IsBusiness(d) {
			return d
		}
	}
	return d
}

// NextBusiness: el primer día hábil después de d.
func (c Calendar) NextBusiness(d time.Time) time.Time { return c.step(d, 1) }

// PrevBusiness: el último día hábil antes de d.
func (c Calendar) PrevBusiness(d time.Time) time.Time { return c.step(d, -1) }

// BusinessDaysBetween cuenta los días hábiles en (a, b]. Si b es anterior a
// a devuelve el negativo de los de (b, a].
func (c Calendar) BusinessDaysBetween(a, b time.Time) int {
	if b.Before(a) {
		return -c.BusinessDaysBetween(b, a)
	}
	n := 0
	for d := a.AddDate(0, 0, 1); !d.After(b); d = d.AddDate(0, 0, 1) {
		if c.IsBusiness(d) {
			n++
		}
	}
	return n
}

// AddBusinessDays: n días hábiles antes (n < 0) o después de d.
func (c Calendar) AddBusinessDays(d time.Time, n int) time.Time {
	dir := 1
	if n < 0 {
		dir, n = -1, -n
	}
	for i := 0; i < n; i++ {
		d = c.step(d, dir)
	}
	return d
}

// NthBusinessDay: el día hábil n (desde 1) del mes; nil si el mes no tiene tantos.
func (c Calendar) NthBusinessDay(year int, month time.Month, n int) *time.Time {
	count := 0
	for d := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC); d.Month() == month; d = d.AddDate(0, 0, 1) {
		if c.IsBusiness(d) {
			count++
			if count == n {
				return &d
			}
		}
	}
	return nil
}

// LastBusinessDay: el último día hábil del mes; nil si no tiene ninguno.
func (c Calendar) LastBusinessDay(year int, month time.Month) *time.Time {
	for d := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC); d.Month() == month; d = d.AddDate(0, 0, -1) {
		if c.IsBusiness(d) {
			return &d
		}
	}
	return nil
}

// Clases de recurrencia (spec/16 §4.3).
const (
	KindOnce    = "once"    // una sola vez, en Date
	KindDays    = "days"    // cada Every días desde Start
	KindWeekly  = "weekly"  // los Weekdays de cada semana
	KindBizN    = "bizN"    // el día hábil N de cada mes
	KindLastBiz = "lastBiz" // el último día hábil de cada mes
	KindFixed   = "fixed"   // el día Day de cada mes; si no es hábil, Shift
)

// Recurrence es cuándo toca una tarea. Se guarda como JSON en agenda_tasks.
type Recurrence struct {
	Kind     string `json:"kind"`
	Date     string `json:"date,omitempty"`
	Start    string `json:"start,omitempty"`
	Every    int    `json:"every,omitempty"`
	Weekdays []int  `json:"weekdays,omitempty"`
	N        int    `json:"n,omitempty"`
	Day      int    `json:"day,omitempty"`
	// Shift: "prev" adelanta al hábil anterior, "next" posterga al siguiente.
	Shift string `json:"shift,omitempty"`
}

// Validate revisa que la recurrencia tenga lo que su clase necesita y
// limpia lo que sobra (lo que se guarda queda siempre normalizado).
func (r *Recurrence) Validate() error {
	clean := Recurrence{Kind: r.Kind}
	switch r.Kind {
	case KindOnce:
		if _, err := ParseDate(r.Date); err != nil {
			return errors.New("fecha inválida (YYYY-MM-DD)")
		}
		clean.Date = r.Date
	case KindDays:
		if _, err := ParseDate(r.Start); err != nil {
			return errors.New("fecha de inicio inválida (YYYY-MM-DD)")
		}
		if r.Every < 1 || r.Every > 366 {
			return errors.New("cada cuántos días: entre 1 y 366")
		}
		clean.Start, clean.Every = r.Start, r.Every
	case KindWeekly:
		seen := map[int]bool{}
		for _, w := range r.Weekdays {
			if w < 0 || w > 6 {
				return errors.New("día de la semana inválido (0 = domingo … 6 = sábado)")
			}
			if !seen[w] {
				seen[w] = true
				clean.Weekdays = append(clean.Weekdays, w)
			}
		}
		if len(clean.Weekdays) == 0 {
			return errors.New("elige al menos un día de la semana")
		}
		sort.Ints(clean.Weekdays)
	case KindBizN:
		if r.N < 1 || r.N > 23 {
			return errors.New("el día hábil del mes va de 1 a 23")
		}
		clean.N = r.N
	case KindLastBiz:
	case KindFixed:
		if r.Day < 1 || r.Day > 31 {
			return errors.New("el día del mes va de 1 a 31")
		}
		if r.Shift != "prev" && r.Shift != "next" {
			return errors.New(`si cae en día no hábil: "prev" (se adelanta) o "next" (se posterga)`)
		}
		clean.Day, clean.Shift = r.Day, r.Shift
	default:
		return fmt.Errorf("recurrencia desconocida: %q", r.Kind)
	}
	*r = clean
	return nil
}

// Occurrence es una vez que toca la tarea. MovedFrom es el día que tocaba
// cuando no era hábil y se corrió.
type Occurrence struct {
	Date      time.Time
	MovedFrom *time.Time
}

// Occurrences: las veces que toca r con fecha en [from, to], en orden y sin
// repetir fecha (dos días que se corren al mismo hábil cuentan una vez).
func (c Calendar) Occurrences(r Recurrence, from, to time.Time) []Occurrence {
	var raw []Occurrence
	// moveNext: un día no hábil pasa al siguiente hábil (cada N días, semanal).
	moveNext := func(d time.Time) Occurrence {
		if c.IsBusiness(d) || !c.hasWorkDay() {
			return Occurrence{Date: d}
		}
		orig := d
		return Occurrence{Date: c.NextBusiness(d), MovedFrom: &orig}
	}
	switch r.Kind {
	case KindOnce:
		if d, err := ParseDate(r.Date); err == nil {
			raw = append(raw, Occurrence{Date: d})
		}
	case KindDays:
		start, err := ParseDate(r.Start)
		if err != nil || r.Every < 1 {
			break
		}
		d := start
		if from.After(start) {
			// saltar directo al primer múltiplo cercano a from (menos un margen
			// por si el anterior se corrió hacia adentro del rango)
			k := int(from.Sub(start).Hours()/24) / r.Every
			if k > 0 {
				k--
			}
			d = start.AddDate(0, 0, k*r.Every)
		}
		for ; !d.After(to.AddDate(0, 0, 10)); d = d.AddDate(0, 0, r.Every) {
			raw = append(raw, moveNext(d))
		}
	case KindWeekly:
		want := map[int]bool{}
		for _, w := range r.Weekdays {
			want[w] = true
		}
		for d := from.AddDate(0, 0, -10); !d.After(to); d = d.AddDate(0, 0, 1) {
			if want[int(d.Weekday())] {
				raw = append(raw, moveNext(d))
			}
		}
	case KindBizN, KindLastBiz, KindFixed:
		for m := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC); !m.After(to); m = m.AddDate(0, 1, 0) {
			switch r.Kind {
			case KindBizN:
				if d := c.NthBusinessDay(m.Year(), m.Month(), r.N); d != nil {
					raw = append(raw, Occurrence{Date: *d})
				}
			case KindLastBiz:
				if d := c.LastBusinessDay(m.Year(), m.Month()); d != nil {
					raw = append(raw, Occurrence{Date: *d})
				}
			case KindFixed:
				last := time.Date(m.Year(), m.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
				day := r.Day
				if day > last {
					day = last
				}
				d := time.Date(m.Year(), m.Month(), day, 0, 0, 0, 0, time.UTC)
				if c.IsBusiness(d) || !c.hasWorkDay() {
					raw = append(raw, Occurrence{Date: d})
				} else {
					orig := d
					if r.Shift == "prev" {
						d = c.PrevBusiness(d)
					} else {
						d = c.NextBusiness(d)
					}
					raw = append(raw, Occurrence{Date: d, MovedFrom: &orig})
				}
			}
		}
	}
	out := make([]Occurrence, 0, len(raw))
	seen := map[string]bool{}
	for _, o := range raw {
		k := FormatDate(o.Date)
		if o.Date.Before(from) || o.Date.After(to) || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, o)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date.Before(out[j].Date) })
	return out
}

// Clock es una hora del día ("08:00").
type Clock struct{ Hour, Minute int }

// ParseClock lee "HH:MM".
func ParseClock(s string) (Clock, error) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return Clock{}, errors.New("hora inválida (HH:MM)")
	}
	return Clock{t.Hour(), t.Minute()}, nil
}

func (c Clock) String() string { return fmt.Sprintf("%02d:%02d", c.Hour, c.Minute) }

// At: el instante del día d (civil) a la hora c en loc.
func (c Clock) At(d time.Time, loc *time.Location) time.Time {
	return time.Date(d.Year(), d.Month(), d.Day(), c.Hour, c.Minute, 0, 0, loc)
}
