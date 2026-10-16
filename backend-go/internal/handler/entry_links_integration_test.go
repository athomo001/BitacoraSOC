//go:build integration

// Enlazar una entrada a un ticket interno o de GLPI desde su detalle (pedido
// del dueño 2026-10-16) contra Postgres, dentro de una transacción que se deshace.
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

func TestEntryTicketLinks(t *testing.T) {
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
	n := fmt.Sprintf("el%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	user := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1||'@t.local', 'x') RETURNING id`, n)
	org := id(`INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, $1) RETURNING id`, n)
	ticket := id(`INSERT INTO tickets (ticket_number, client_id, title, description) VALUES ($1, $2, 'Sin internet', 'x') RETURNING id`, "TKT-"+n, org)
	entry := id(`INSERT INTO entries (user_id, entry_type, scope, content, ticket_id) VALUES ($1, 'incidente', 'general', 'cayó el enlace', $2) RETURNING id`, user, ticket)
	if _, err := tx.Exec(ctx, `UPDATE glpi_config SET api_url = 'https://glpi.empresa.cl/apirest.php'`); err != nil {
		t.Fatal(err)
	}

	q := db.New(tx)
	logger := audit.NewLogger(&recordedAudit{}, slog.Default())
	tickets := &TicketsHandler{Queries: q, AuditLog: logger}
	entries := &EntriesHandler{Queries: q, Tickets: tickets, AuditLog: logger}
	userCtx := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: n, Role: "user"})
	detail := func(w *httptest.ResponseRecorder) entryDetailDTO {
		var out struct {
			Data entryDetailDTO `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data
	}

	get := func() entryDetailDTO {
		r := httptest.NewRequest("GET", "/api/entries/"+entry.String(), nil).WithContext(userCtx)
		r.SetPathValue("id", entry.String())
		w := httptest.NewRecorder()
		entries.Get(w, r)
		return detail(w)
	}
	setGlpi := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("PUT", "/api/entries/"+entry.String()+"/glpi-ticket", strings.NewReader(body)).WithContext(userCtx)
		r.SetPathValue("id", entry.String())
		w := httptest.NewRecorder()
		entries.SetGlpiTicket(w, r)
		return w
	}

	if d := get(); d.Ticket == nil || d.Ticket.Number != "TKT-"+n || d.GlpiTicketID != "" {
		t.Fatalf("detalle con ticket interno: %+v", d.Ticket)
	}
	if w := setGlpi(`{"glpiTicketId":"abc"}`); w.Code != 400 {
		t.Errorf("GLPI no numérico: %d", w.Code)
	}
	w := setGlpi(`{"glpiTicketId":"#4521"}`)
	if d := detail(w); w.Code != 200 || d.GlpiTicketID != "4521" || d.GlpiTicketURL != "https://glpi.empresa.cl/front/ticket.form.php?id=4521" {
		t.Fatalf("enlazar GLPI: %d %+v", w.Code, d)
	}
	if w := setGlpi(`{"glpiTicketId":""}`); w.Code != 200 || detail(w).GlpiTicketID != "" {
		t.Errorf("quitar GLPI: %d %s", w.Code, w.Body)
	}

	r := httptest.NewRequest("DELETE", "/api/entries/"+entry.String()+"/ticket-link", nil).WithContext(userCtx)
	r.SetPathValue("id", entry.String())
	w = httptest.NewRecorder()
	tickets.UnlinkEntry(w, r)
	if w.Code != 204 || get().Ticket != nil {
		t.Fatalf("quitar interno: %d %s", w.Code, w.Body)
	}
	var notes int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM ticket_comments WHERE ticket_id = $1 AND content LIKE 'Entrada de bitácora desvinculada%'`, ticket).Scan(&notes)
	if notes != 1 {
		t.Errorf("nota en el ticket: %d", notes)
	}
}

func TestGlpiTicketURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://glpi.x.cl/apirest.php": "https://glpi.x.cl/front/ticket.form.php?id=7",
		"https://glpi.x.cl/glpi/":       "https://glpi.x.cl/glpi/front/ticket.form.php?id=7",
		"":                              "",
		"glpi.x.cl":                     "",
	} {
		if got := glpiTicketURL(in, "7"); got != want {
			t.Errorf("%q → %q, quería %q", in, got, want)
		}
	}
}
