//go:build integration

// Reordenar los turnos de trabajo (paridad con el legacy, 2026-10-16) contra
// Postgres, dentro de una transacción que se deshace.
package handler

import (
	"context"
	"encoding/json"
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
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWorkShiftReorder(t *testing.T) {
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
	n := fmt.Sprintf("wo%d", time.Now().UnixNano())
	q := db.New(tx)
	mk := func(name, start string) uuid.UUID {
		t.Helper()
		var id uuid.UUID
		if err := tx.QueryRow(ctx, `INSERT INTO work_shifts (name, start_time, end_time, sort_order)
			VALUES ($1, $2::time, '20:00', (SELECT COALESCE(max(sort_order), 0) + 1 FROM work_shifts)) RETURNING id`, name+" "+n, start).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	a, b, c := mk("A", "08:00"), mk("B", "09:00"), mk("C", "10:00")

	all, err := q.ListWorkShifts(ctx, pgtype.Bool{})
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, s := range all {
		if s.ID != a && s.ID != b && s.ID != c {
			ids = append(ids, `"`+s.ID.String()+`"`)
		}
	}
	// Los tres nuevos al principio, en orden C, A, B.
	ids = append([]string{`"` + c.String() + `"`, `"` + a.String() + `"`, `"` + b.String() + `"`}, ids...)

	h := &RotationHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	call := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("PUT", "/api/work-shifts/reorder", strings.NewReader(body)).
			WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{Role: "admin"}))
		w := httptest.NewRecorder()
		h.ReorderWorkShifts(w, r)
		return w
	}
	if w := call(`{"ids":["` + a.String() + `","` + a.String() + `"]}`); w.Code != 400 {
		t.Fatalf("repetido: %d", w.Code)
	}
	w := call(`{"ids":[` + strings.Join(ids, ",") + `]}`)
	if w.Code != 200 {
		t.Fatalf("reordenar: %d %s", w.Code, w.Body)
	}
	var out struct {
		Data []struct {
			ID uuid.UUID `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Data) < 3 || out.Data[0].ID != c || out.Data[1].ID != a || out.Data[2].ID != b {
		t.Errorf("orden devuelto: %+v", out.Data[:3])
	}
}
