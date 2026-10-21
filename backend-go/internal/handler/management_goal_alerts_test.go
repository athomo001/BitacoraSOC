package handler

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestGoalAlert(t *testing.T) {
	today := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		due      time.Time
		business bool
		left     int
		want     string
	}{
		{today.AddDate(0, 0, 7), true, 5, "warn5"},
		{today.AddDate(0, 0, 1), true, 1, "warn1"},
		{today.AddDate(0, 0, 3), true, 3, ""},
		{today, true, 0, "due"},
		{today, false, 0, ""}, // fuera de horario no avisa «vence hoy»
		{today.AddDate(0, 0, -1), false, -1, "late"},
	}
	for _, c := range cases {
		if got, _ := goalAlert(c.due, today, c.business, c.left); got != c.want {
			t.Errorf("vence %s, hábil %v, quedan %d: %q, quería %q", c.due.Format("02-01"), c.business, c.left, got, c.want)
		}
	}
}

func TestGoalAlertTargets(t *testing.T) {
	person, lead := uuid.New(), uuid.New()
	g := db.ListGoalsForAlertsRow{PersonUserID: pgtype.UUID{Bytes: person, Valid: true}, OwnerUserID: pgtype.UUID{Bytes: person, Valid: true},
		CreatedBy: pgtype.UUID{Bytes: lead, Valid: true}}
	if got := goalAlertTargets(g, false); len(got) != 1 || got[0] != person {
		t.Fatalf("antes de vencer, a la persona: %v", got)
	}
	if got := goalAlertTargets(g, true); len(got) != 2 || got[1] != lead {
		t.Fatalf("vencida, también a quien la creó: %v", got)
	}
	if got := goalAlertTargets(db.ListGoalsForAlertsRow{CreatedBy: pgtype.UUID{Bytes: lead, Valid: true}}, false); len(got) != 1 || got[0] != lead {
		t.Fatalf("sin responsable, a quien la creó: %v", got)
	}
}
