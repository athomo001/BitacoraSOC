package handler

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func clock(h, m int) pgtype.Time {
	return pgtype.Time{Microseconds: int64(h*3600+m*60) * 1_000_000, Valid: true}
}

func TestShiftWindow_DayShiftStartsSameDay(t *testing.T) {
	santiago, _ := time.LoadLocation("America/Santiago")
	closedAt := time.Date(2026, 9, 27, 19, 45, 0, 0, santiago)
	start, end := shiftWindow(closedAt, clock(8, 0), "America/Santiago")
	want := time.Date(2026, 9, 27, 8, 0, 0, 0, santiago)
	if !start.Equal(want) || !end.Equal(closedAt) {
		t.Fatalf("ventana = [%v, %v], want [%v, %v]", start, end, want, closedAt)
	}
}

func TestShiftWindow_NightShiftStartsPreviousDay(t *testing.T) {
	santiago, _ := time.LoadLocation("America/Santiago")
	closedAt := time.Date(2026, 9, 28, 7, 50, 0, 0, santiago)
	start, _ := shiftWindow(closedAt, clock(20, 0), "America/Santiago")
	want := time.Date(2026, 9, 27, 20, 0, 0, 0, santiago)
	if !start.Equal(want) {
		t.Fatalf("un turno noche cerrado 07:50 empieza 20:00 del día anterior: got %v, want %v", start, want)
	}
}

// Regresión: antes toda ventana era de 8h; un turno de 12h perdía 4h de actividad en el reporte.
func TestShiftWindow_TwelveHourShiftIsNotCutToEight(t *testing.T) {
	closedAt := time.Date(2026, 9, 27, 19, 55, 0, 0, time.UTC)
	start, end := shiftWindow(closedAt, clock(8, 0), "UTC")
	if got := end.Sub(start); got < 11*time.Hour {
		t.Fatalf("la ventana de un turno 08:00-20:00 no puede ser de %v", got)
	}
}

func TestShiftWindow_UsesShiftTimezoneNotServerTimezone(t *testing.T) {
	// 11:00 UTC = 08:00 en Santiago (UTC-3 en septiembre): el turno de 08:00 recién empezó.
	closedAt := time.Date(2026, 9, 27, 11, 30, 0, 0, time.UTC)
	start, _ := shiftWindow(closedAt, clock(8, 0), "America/Santiago")
	if got := closedAt.Sub(start); got != 30*time.Minute {
		t.Fatalf("debería contar desde las 08:00 de Santiago (hace 30 min), got hace %v", got)
	}
}

func TestShiftWindow_FallbackWithoutStartTime(t *testing.T) {
	closedAt := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	start, _ := shiftWindow(closedAt, pgtype.Time{}, "UTC")
	if closedAt.Sub(start) != fallbackShiftDuration {
		t.Fatalf("sin hora de inicio usa %v", fallbackShiftDuration)
	}
}
