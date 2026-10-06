package handler

import (
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

func TestMondayOf(t *testing.T) {
	// Miércoles 23 de septiembre de 2026 → lunes 21.
	wed := time.Date(2026, 9, 23, 15, 30, 0, 0, time.UTC)
	got := mondayOf(wed)
	want := time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("mondayOf(miércoles) = %v, quería %v", got, want)
	}

	sun := time.Date(2026, 9, 27, 8, 0, 0, 0, time.UTC)
	if got := mondayOf(sun); !got.Equal(want) {
		t.Fatalf("mondayOf(domingo) = %v, quería el lunes de la misma semana ISO %v", got, want)
	}
}

func TestParseWeekRange_DefaultsToCurrentWeek(t *testing.T) {
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	from, to, err := parseWeekRange("", "", now)
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if from.Format("2006-01-02") != "2026-09-21" || to.Format("2006-01-02") != "2026-09-25" {
		t.Fatalf("rango por defecto = %s..%s, quería 2026-09-21..2026-09-25", from.Format("2006-01-02"), to.Format("2006-01-02"))
	}
}

func TestParseWeekRange_ExplicitRange(t *testing.T) {
	from, to, err := parseWeekRange("2026-01-05", "2026-01-09", time.Now())
	if err != nil || from.Format("2006-01-02") != "2026-01-05" || to.Format("2006-01-02") != "2026-01-09" {
		t.Fatalf("from/to explícitos no se respetaron: %v %v %v", from, to, err)
	}
}

func TestValidTeleworkCondition(t *testing.T) {
	for _, c := range []string{"telework", "office", "guardia", "vacation", "medical_leave", "medical_appointment", "training"} {
		if !validTeleworkCondition(c) {
			t.Fatalf("%q debería ser una condición válida", c)
		}
	}
	if validTeleworkCondition("inventado") {
		t.Fatal("una condición fuera del ENUM no debería validar")
	}
}

func TestNewShareToken_Format(t *testing.T) {
	token, hash, err := newShareToken()
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if !teleworkTokenRe.MatchString(token) {
		t.Fatalf("token %q no cumple el formato de 64 hex esperado por /p/telework/{token}", token)
	}
	if len(hash) != 64 {
		t.Fatalf("hash del token debería ser sha256 hex (64 chars), got %d", len(hash))
	}
	token2, _, _ := newShareToken()
	if token == token2 {
		t.Fatal("dos tokens generados no deberían coincidir")
	}
}

func TestSchedulePeriod_LikeLegacy(t *testing.T) {
	loc := time.FixedZone("CLT", -3*3600)
	sunday := time.Date(2026, 10, 4, 20, 0, 0, 0, loc)
	start, label := schedulePeriod(db.WorkShiftNotificationSchedule{TargetPeriod: "next_week"}, sunday)
	if start.Format("2006-01-02") != "2026-10-05" || label != "Periodo Semanal: 05-10-2026 - 11-10-2026" {
		t.Fatalf("semana siguiente: %s %q", start, label)
	}
	start, label = schedulePeriod(db.WorkShiftNotificationSchedule{TargetPeriod: "current_week"}, sunday)
	if start.Format("2006-01-02") != "2026-09-28" || label != "Periodo Semanal: 28-09-2026 - 04-10-2026" {
		t.Fatalf("semana actual: %s %q", start, label)
	}
	start, label = schedulePeriod(db.WorkShiftNotificationSchedule{Frequency: db.NotificationScheduleFrequencyMonthly}, sunday)
	if start.Format("2006-01-02") != "2026-10-01" || label != "Periodo Mensual: octubre de 2026" {
		t.Fatalf("mensual: %s %q", start, label)
	}
}

func TestScheduleCategories_LikeLegacy(t *testing.T) {
	cases := map[string][]string{
		"CALENDARIO":                         nil,
		"GUARDIA":                            {"N2", "N1_NO_HABIL"},
		"GUARDIA / TELETRABAJO / VACACIONES": {"TI", "VACATION", "TELEWORK"},
		"CHARLA/CAPACITACIÓN / TRÁMITE MÉDICO": {"MEDICAL_APPOINTMENT", "OL"},
	}
	for want, filter := range cases {
		if got := scheduleCategories(filter); got != want {
			t.Fatalf("%v: %q, se esperaba %q", filter, got, want)
		}
	}
}

func TestListPeriod_SemanaOperativa(t *testing.T) {
	loc := time.FixedZone("CLT", -3*3600)
	start, end := listPeriod(db.WorkShiftNotificationSchedule{TargetPeriod: "current_week"}, time.Date(2026, 10, 7, 15, 0, 0, 0, loc))
	if start.Format("2006-01-02 15:04") != "2026-10-05 09:00" || end.Format("2006-01-02 15:04:05") != "2026-10-12 08:59:59" {
		t.Fatalf("semana: %s → %s", start, end)
	}
}

func TestRenderTeleworkPage_SmokeTest(t *testing.T) {
	matrix := matrixDTO{
		Columns: []matrixColumnDTO{{Date: "2026-09-21", DayShort: "Lun", IsToday: true}},
		Rows: []matrixRowDTO{{
			UserID: "1", Name: "Ana <script>", Role: "Analista",
			Days: []matrixCellDTO{{Date: "2026-09-21", Condition: "vacation", Label: "Vacaciones", Marker: "🌴"}},
		}},
	}
	html := renderTeleworkPage(matrix, time.Now())
	if strings.Contains(html, "<script>") {
		t.Fatal("el nombre debe escaparse en el HTML de la página pública")
	}
	if !strings.Contains(html, "Vacaciones") || !strings.Contains(html, "meta http-equiv=\"refresh\"") {
		t.Fatalf("la página no incluye la condición o el auto-refresh esperado")
	}
}

func TestRenderUnavailablePage_NeverEmpty(t *testing.T) {
	if renderUnavailablePage() == "" {
		t.Fatal("la página de enlace no disponible no debería estar vacía")
	}
}
