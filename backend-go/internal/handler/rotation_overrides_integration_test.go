//go:build integration

// Editar y borrar un reemplazo de guardia (paridad con el legacy, 2026-10-16)
// contra Postgres, dentro de una transacción que se deshace.
package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRotationOverrideEditDelete(t *testing.T) {
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
	n := fmt.Sprintf("ro%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	admin := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1||'@t.local', 'x') RETURNING id`, n)
	user2 := id(`INSERT INTO users (username, email, password_hash) VALUES ($1||'b', $1||'b@t.local', 'x') RETURNING id`, n)
	team := id(`INSERT INTO teams (name, slug, kind, area_id) VALUES ('Guardia '||$1, $1, 'oncall', 'a0000000-0000-4000-8000-000000000001') RETURNING id`, n)
	other := id(`INSERT INTO teams (name, slug, kind, area_id) VALUES ('Otra '||$1, $1||'b', 'oncall', 'a0000000-0000-4000-8000-000000000001') RETURNING id`, n)
	ana := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, team, admin)
	beto := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, team, user2)
	stranger := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, other, admin)
	cycle := id(`INSERT INTO rotation_cycles (team_id, start_day_of_week, start_time_utc) VALUES ($1, 1, '12:00') RETURNING id`, team)
	ov := id(`INSERT INTO rotation_overrides (cycle_id, original_team_member_id, replacement_team_member_id, start_date, end_date, reason, created_by)
		VALUES ($1, $2, $3, '2031-03-10T12:00:00Z', '2031-03-11T12:00:00Z', 'Licencia', $4) RETURNING id`, cycle, ana, beto, admin)

	rec := &recordedAudit{}
	h := &RotationHandler{Queries: db.New(tx), AuditLog: audit.NewLogger(rec, slog.Default())}
	call := func(method string, target uuid.UUID, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/rotation-overrides/"+target.String(), strings.NewReader(body)).
			WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Role: "admin"}))
		r.SetPathValue("id", target.String())
		w := httptest.NewRecorder()
		if method == "PUT" {
			h.UpdateOverride(w, r)
		} else {
			h.DeleteOverride(w, r)
		}
		return w
	}
	body := func(member uuid.UUID, from, to, reason string) string {
		return fmt.Sprintf(`{"replacementTeamMemberId":%q,"startDate":%q,"endDate":%q,"reason":%q}`, member, from, to, reason)
	}
	if w := call("PUT", ov, body(ana, "2031-03-11T12:00:00Z", "2031-03-10T12:00:00Z", "x")); w.Code != 400 {
		t.Fatalf("fechas al revés: %d", w.Code)
	}
	if w := call("PUT", ov, body(stranger, "2031-03-10T12:00:00Z", "2031-03-12T12:00:00Z", "x")); w.Code != 400 {
		t.Fatalf("persona de otra guardia: %d %s", w.Code, w.Body)
	}
	if w := call("PUT", ov, body(ana, "2031-03-10T12:00:00Z", "2031-03-12T12:00:00Z", "Cambio")); w.Code != 200 {
		t.Fatalf("editar: %d %s", w.Code, w.Body)
	}
	var who uuid.UUID
	var reason string
	_ = tx.QueryRow(ctx, `SELECT replacement_team_member_id, reason FROM rotation_overrides WHERE id = $1`, ov).Scan(&who, &reason)
	if who != ana || reason != "Cambio" {
		t.Errorf("no quedó editado: %v %q", who, reason)
	}
	if w := call("DELETE", ov, ""); w.Code != 204 {
		t.Fatalf("borrar: %d %s", w.Code, w.Body)
	}
	if w := call("DELETE", ov, ""); w.Code != 404 {
		t.Errorf("ya borrado: %d", w.Code)
	}
}
