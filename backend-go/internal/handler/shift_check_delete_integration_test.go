//go:build integration

// Borrar un checklist del historial (admin, con motivo; paridad con el
// legacy, 2026-10-16) contra Postgres, dentro de una transacción que se deshace.
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

func TestShiftCheckDelete(t *testing.T) {
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
	n := fmt.Sprintf("dc%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	user := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1||'@t.local', 'x') RETURNING id`, n)
	tmpl := id(`INSERT INTO checklist_templates (name) VALUES ('Plantilla '||$1) RETURNING id`, n)
	shift := id(`INSERT INTO work_shifts (name, start_time, end_time, timezone) VALUES ('Turno '||$1, '08:00', '20:00', 'America/Santiago') RETURNING id`, n)
	free := id(`INSERT INTO shift_checks (checklist_template_id, user_id, work_shift_id, check_type) VALUES ($1, $2, $3, 'inicio') RETURNING id`, tmpl, user, shift)
	id(`INSERT INTO shift_check_services (shift_check_id, service_title, status, observation) VALUES ($1, 'Firewall', 'rojo', 'Caído') RETURNING id`, free)
	closing := id(`INSERT INTO shift_checks (checklist_template_id, user_id, work_shift_id, check_type) VALUES ($1, $2, $3, 'cierre') RETURNING id`, tmpl, user, shift)
	id(`INSERT INTO shift_closures (user_id, shift_start_at, shift_end_at, closure_check_id) VALUES ($1, now() - interval '12 hours', now(), $2) RETURNING id`, user, closing)

	rec := &recordedAudit{}
	h := &ChecklistsHandler{Queries: db.New(tx), AuditLog: audit.NewLogger(rec, slog.Default())}
	del := func(check uuid.UUID, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("DELETE", "/api/shift-checks/"+check.String(), strings.NewReader(body)).
			WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Role: "admin"}))
		r.SetPathValue("id", check.String())
		w := httptest.NewRecorder()
		h.DeleteCheck(w, r)
		return w
	}
	if w := del(free, `{"reason":""}`); w.Code != 400 {
		t.Fatalf("sin motivo: %d", w.Code)
	}
	if w := del(closing, `{"reason":"error"}`); w.Code != 409 {
		t.Fatalf("checklist de un cierre: %d %s", w.Code, w.Body)
	}
	if w := del(free, `{"reason":"Duplicado"}`); w.Code != 204 {
		t.Fatalf("borrar: %d %s", w.Code, w.Body)
	}
	var left int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM shift_check_services WHERE shift_check_id = $1`, free).Scan(&left)
	if left != 0 {
		t.Errorf("quedaron %d servicios", left)
	}
	if w := del(free, `{"reason":"otra vez"}`); w.Code != 404 {
		t.Errorf("ya borrado: %d", w.Code)
	}
}
