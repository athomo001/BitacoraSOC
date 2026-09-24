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

func TestBuildNotificationMail_FiltersByRole(t *testing.T) {
	schedule := db.WorkShiftNotificationSchedule{Name: "Reporte N1", RoleFilter: []string{"Analista N1"}}
	matrix := matrixDTO{
		Columns: []matrixColumnDTO{{Date: "2026-09-21"}, {Date: "2026-09-25"}},
		Rows: []matrixRowDTO{
			{Name: "Ana", Role: "Analista N1", Days: []matrixCellDTO{{Date: "2026-09-21", Label: "En Oficina"}}},
			{Name: "Beto", Role: "Analista N2", Days: []matrixCellDTO{{Date: "2026-09-21", Label: "En Oficina"}}},
		},
	}

	subject, body := buildNotificationMail(schedule, matrix)
	if subject != "Reporte N1" {
		t.Fatalf("subject = %q, quería el nombre de la programación", subject)
	}
	if !strings.Contains(body, "Ana") || strings.Contains(body, "Beto") {
		t.Fatalf("roleFilter debería incluir solo Analista N1: %s", body)
	}
}

func TestBuildNotificationMail_EmptyFilterMatchSaysSo(t *testing.T) {
	schedule := db.WorkShiftNotificationSchedule{Name: "Reporte vacío", RoleFilter: []string{"Rol que no existe"}}
	matrix := matrixDTO{Rows: []matrixRowDTO{{Name: "Ana", Role: "Analista N1"}}}

	_, body := buildNotificationMail(schedule, matrix)
	if !strings.Contains(body, "Sin filas") {
		t.Fatalf("un filtro sin coincidencias debería avisarlo explícitamente: %s", body)
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
