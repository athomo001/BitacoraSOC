//go:build integration

// Numeración de tickets configurable (pedido del dueño 2026-10-16) contra
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
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTicketSeries(t *testing.T) {
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
	n := fmt.Sprintf("ts%d", time.Now().UnixNano()%1_000_000_000)
	prefix := "Z" + strings.ToUpper(n[len(n)-6:])
	q := db.New(tx)
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	userCtx := middleware.WithUser(ctx, middleware.AuthenticatedUser{Role: "admin"})
	h := &TicketSeriesHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default()), Now: func() time.Time { return now }}

	var area, otherArea, org, actor uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, n).Scan(&area); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO areas (code, name) VALUES ($1||'b', 'Otra '||$1) RETURNING id`, n).Scan(&otherArea); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM organizations ORDER BY name LIMIT 1`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE active ORDER BY username LIMIT 1`).Scan(&actor); err != nil {
		t.Fatal(err)
	}

	type listResp struct {
		Data struct {
			Series []ticketSeriesDTO `json:"series"`
		} `json:"data"`
	}
	call := func(method, path, id, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(userCtx)
		if id != "" {
			r.SetPathValue("id", id)
		}
		w := httptest.NewRecorder()
		switch {
		case method == "POST":
			h.Create(w, r)
		case method == "PUT" && strings.HasSuffix(path, "/areas"):
			h.Assign(w, r)
		case method == "PUT":
			h.Update(w, r)
		case method == "DELETE":
			h.Delete(w, r)
		}
		return w
	}
	find := func(w *httptest.ResponseRecorder, p string) ticketSeriesDTO {
		var out listResp
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		for _, s := range out.Data.Series {
			if s.Prefix == p {
				return s
			}
		}
		t.Fatalf("no está la numeración %s: %s", p, w.Body)
		return ticketSeriesDTO{}
	}

	if w := call("POST", "/api/config/ticket-series", "", `{"name":"Infra","prefix":"inf x","yearFormat":"none","digits":6,"nextNumber":42}`); w.Code != 400 {
		t.Fatalf("prefijo con espacio: %d", w.Code)
	}
	w := call("POST", "/api/config/ticket-series", "", fmt.Sprintf(`{"name":"Infra","prefix":"%s","yearFormat":"none","digits":6,"nextNumber":42}`, strings.ToLower(prefix)))
	s := find(w, prefix)
	if w.Code != 200 || s.Preview != prefix+"-000042" {
		t.Fatalf("crear: %d %+v", w.Code, s)
	}
	if w := call("PUT", "/api/config/ticket-series/areas", "", fmt.Sprintf(`{"assignments":[{"areaId":%q,"seriesId":%q}]}`, area, s.ID)); w.Code != 200 {
		t.Fatalf("asignar: %d %s", w.Code, w.Body)
	}

	// Un ticket que pide esa área lleva su numeración; si el número ya existe, salta.
	if _, err := tx.Exec(ctx, `INSERT INTO tickets (ticket_number, client_id, title, description) VALUES ($1, $2, 'ya estaba', 'x')`, prefix+"-000042", org); err != nil {
		t.Fatal(err)
	}
	tk := &TicketsHandler{Queries: q, Now: func() time.Time { return now }}
	ticket, err := tk.createTicketTx(ctx, tx, newTicket{Type: "incident", Scope: db.EntryScopeGeneral, ClientID: org, AreaID: otherArea, RequestedAreaID: area,
		Impact: "low", Urgency: "low", Title: "rack", Description: "x", ActorID: actor}, now)
	if err != nil {
		t.Fatal(err)
	}
	if ticket.TicketNumber != prefix+"-000043" {
		t.Errorf("numera el área que pide y salta el ocupado: %s", ticket.TicketNumber)
	}
	// La otra área usa la general.
	general, err := q.LockTicketSeriesForArea(ctx, pgUUIDOf(otherArea))
	if err != nil || !general.IsDefault {
		t.Fatalf("la otra área usa la general: %+v %v", general, err)
	}

	// El próximo número no baja; la general no se borra.
	if w := call("PUT", "/api/config/ticket-series/"+s.ID.String(), s.ID.String(), fmt.Sprintf(`{"name":"Infra","prefix":%q,"yearFormat":"none","digits":6,"nextNumber":10}`, prefix)); w.Code != 400 {
		t.Errorf("bajar el próximo: %d", w.Code)
	}
	w = call("PUT", "/api/config/ticket-series/"+s.ID.String(), s.ID.String(), fmt.Sprintf(`{"name":"Infra","prefix":%q,"yearFormat":"yy","digits":4,"nextNumber":500}`, prefix))
	if got := find(w, prefix); w.Code != 200 || got.Preview != prefix+"-26-0500" {
		t.Errorf("cambiar formato: %d %+v", w.Code, got)
	}
	if w := call("DELETE", "/api/config/ticket-series/"+general.ID.String(), general.ID.String(), ""); w.Code != 409 {
		t.Errorf("borrar la general: %d", w.Code)
	}
	if w := call("DELETE", "/api/config/ticket-series/"+s.ID.String(), s.ID.String(), ""); w.Code != 200 {
		t.Fatalf("borrar: %d %s", w.Code, w.Body)
	}
	var still *uuid.UUID
	_ = tx.QueryRow(ctx, `SELECT ticket_series_id FROM areas WHERE id = $1`, area).Scan(&still)
	if still != nil {
		t.Error("al borrarla, el área vuelve a la general")
	}
}
