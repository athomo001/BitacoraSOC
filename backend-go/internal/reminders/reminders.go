// Package reminders decide cuándo toca enviar un recordatorio de turno por
// correo (spec/12-pendientes.md §2.3b), portado de shiftReminderScheduler.js
// del legacy: cada N horas (un envío por bloque del día) o a horas fijas
// (tolerancia de 1 minuto), solo mientras el turno está en curso, a la hora
// local del turno. No toca la base ni el correo: devuelve la clave del
// disparo, y quien llama la registra con un UNIQUE para no enviar dos veces.
package reminders

import (
	"fmt"
	"regexp"
	"time"
)

// Frecuencias válidas (shift_reminders.frequency_type).
const (
	FrequencyHours = "hours"
	FrequencyFixed = "fixed"
)

// fixedTolerance es la holgura para las horas fijas: el planificador corre
// cada minuto y puede despertar unos segundos tarde.
const fixedTolerance = 1

var hhmm = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// ValidTime dice si s es una hora "HH:MM" de 00:00 a 23:59.
func ValidTime(s string) bool { return hhmm.MatchString(s) }

// Reminder es lo que importa de un recordatorio para decidir.
type Reminder struct {
	ID            string
	FrequencyType string
	IntervalHours int
	FixedTimes    []string
}

// Shift es la ventana de un turno: inicio y fin en minutos desde medianoche,
// en su zona horaria.
type Shift struct {
	StartMinute int
	EndMinute   int
	Location    *time.Location
}

// InProgress repite isTimeInRange del legacy: [inicio, fin); si el fin es
// menor o igual al inicio, el turno cruza la medianoche (inicio = fin es un
// turno de 24 h).
func InProgress(minute, start, end int) bool {
	if start < end {
		return minute >= start && minute < end
	}
	return minute >= start || minute < end
}

// Due devuelve la clave del disparo si en now toca enviar el recordatorio a
// ese turno, o false si no. La clave es la misma durante todo el bloque (o
// el minuto de tolerancia), así que registrarla con un UNIQUE deja un solo
// envío por bloque u hora aunque haya dos nodos.
func Due(r Reminder, s Shift, now time.Time) (string, bool) {
	loc := s.Location
	if loc == nil {
		loc = time.UTC
	}
	local := now.In(loc)
	minute := local.Hour()*60 + local.Minute()
	if !InProgress(minute, s.StartMinute, s.EndMinute) {
		return "", false
	}
	date := local.Format("2006-01-02")
	switch r.FrequencyType {
	case FrequencyHours:
		interval := r.IntervalHours
		if interval < 1 || interval > 24 {
			return "", false
		}
		return fmt.Sprintf("hours-%s-block%d", date, local.Hour()/interval), true
	case FrequencyFixed:
		for _, t := range r.FixedTimes {
			if !ValidTime(t) {
				continue
			}
			var h, m int
			_, _ = fmt.Sscanf(t, "%d:%d", &h, &m)
			diff := minute - (h*60 + m)
			if diff < 0 {
				diff = -diff
			}
			if diff <= fixedTolerance {
				return fmt.Sprintf("fixed-%s-%s", t, date), true
			}
		}
	}
	return "", false
}
