//go:build integration

// Avisos del legacy (checklist no realizado y guardia sin cubrir) contra
// Postgres y Mailpit, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestShiftAlerts
package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestShiftAlerts_ChecklistYGuardiaLleganUnaVez(t *testing.T) {
	dsn := os.Getenv("BITACORA_TEST_DSN")
	if dsn == "" {
		t.Skip("BITACORA_TEST_DSN no definido")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // la transacción se deshace siempre
	n := fmt.Sprintf("sa%d", time.Now().UnixNano())
	cargo := "C" + n
	email := n + "@test.local"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO smtp_config (id, host, port, username, password_encrypted, from_address, require_tls)
		VALUES (true, '127.0.0.1', 11025, NULL, NULL, 'bitacora@test.local', false)
		ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port, username = NULL, password_encrypted = NULL,
		from_address = EXCLUDED.from_address, require_tls = false`)
	exec(`INSERT INTO users (username, email, full_name, password_hash, cargo_label) VALUES ($1, $2, 'Persona N2', 'x', lower($3))`, n, email, cargo)
	// Una guardia marcada sin nadie asignado; las demás no se revisan.
	exec(`UPDATE rotation_cycles SET remind_uncovered = false`)
	var team string
	if err := tx.QueryRow(ctx, `INSERT INTO teams (name, slug, kind, area_id) VALUES ('Guardia '||$1, $1, 'oncall', 'a0000000-0000-4000-8000-000000000001') RETURNING id`, n).Scan(&team); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO rotation_cycles (team_id, start_day_of_week, start_time_utc, duration_days, timezone, active, remind_uncovered)
		VALUES ($1, 1, '12:00', 7, 'America/Santiago', true, true)`, team)
	exec(`UPDATE app_config SET checklist_missing_enabled = true, checklist_missing_time = '09:30', checklist_missing_team_id = NULL,
		checklist_missing_cargos = $1, checklist_missing_last_date = NULL, guard_reminder_enabled = true, guard_reminder_days_ahead = 7,
		guard_reminder_cargos = $1, guard_reminder_last_date = NULL, guard_reminder_last_week = NULL`, []string{cargo})

	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2031, 3, 12, 9, 0, 0, 0, loc) // miércoles, antes de las 09:30
	h := &ShiftAlertsHandler{Queries: db.New(tx), AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default()), Now: func() time.Time { return now }}
	if err := h.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	if got := mailpitSearch(t, url.QueryEscape("to:"+email+" subject:Checklist")); len(got) != 0 {
		t.Fatalf("antes de la hora no debía salir: %d", len(got))
	}
	if got := mailpitSearch(t, url.QueryEscape("to:"+email+" subject:escalación")); len(got) != 1 {
		t.Fatalf("recordatorio de guardia: %d correos", len(got))
	}
	now = time.Date(2031, 3, 12, 9, 35, 0, 0, loc)
	for i := 0; i < 2; i++ { // dos vueltas: sale una sola vez
		if err := h.Tick(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := mailpitSearch(t, url.QueryEscape("to:"+email+" subject:Checklist")); len(got) != 1 {
		t.Fatalf("checklist no realizado: %d correos", len(got))
	}
	if got := mailpitSearch(t, url.QueryEscape("to:"+email+" subject:escalación")); len(got) != 1 {
		t.Fatalf("el recordatorio salió de nuevo: %d", len(got))
	}
	// Con el checklist de inicio hecho, al día siguiente no avisa.
	var tmpl, shift, user string
	if err := tx.QueryRow(ctx, `SELECT id FROM checklist_templates LIMIT 1`).Scan(&tmpl); err != nil {
		t.Skip("sin plantilla de checklist en la base de prueba")
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM work_shifts LIMIT 1`).Scan(&shift); err != nil {
		t.Skip("sin turnos en la base de prueba")
	}
	_ = tx.QueryRow(ctx, `SELECT id FROM users WHERE username = $1`, n).Scan(&user)
	exec(`INSERT INTO shift_checks (checklist_template_id, user_id, work_shift_id, check_type, check_date) VALUES ($1, $2, $3, 'inicio', $4)`,
		tmpl, user, shift, time.Date(2031, 3, 13, 8, 0, 0, 0, loc))
	now = time.Date(2031, 3, 13, 10, 0, 0, 0, loc)
	if err := h.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	if got := mailpitSearch(t, url.QueryEscape("to:"+email+" subject:Checklist")); len(got) != 1 {
		t.Fatalf("con checklist hecho no debía avisar: %d", len(got))
	}
}
