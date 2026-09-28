package handler

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// fallbackShiftDuration solo se usa si el turno no tiene hora de inicio
// válida — antes era la regla para todos los turnos, fueran de 8 o de 12h.
const fallbackShiftDuration = 8 * time.Hour

// shiftWindow devuelve [inicio, fin] del turno que se está cerrando: el fin
// es el momento del check de cierre y el inicio es la última vez que ocurrió
// la hora de inicio del turno antes de ese momento, en la zona horaria del
// turno. Así un turno noche 20:00-08:00 cerrado a las 07:50 cuenta desde las
// 20:00 del día anterior, y uno de 12h no pierde 4h de actividad.
func shiftWindow(closedAt time.Time, start pgtype.Time, timezone string) (time.Time, time.Time) {
	if !start.Valid {
		return closedAt.Add(-fallbackShiftDuration), closedAt
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	local := closedAt.In(loc)
	offset := time.Duration(start.Microseconds) * time.Microsecond
	candidate := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).Add(offset)
	if candidate.After(local) {
		candidate = candidate.AddDate(0, 0, -1)
	}
	return candidate, closedAt
}
