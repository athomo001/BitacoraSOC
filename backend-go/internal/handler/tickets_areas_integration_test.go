//go:build integration

// Tickets por área (9.1) contra la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestTicketAreas
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTicketAreas_ColasYAcceso(t *testing.T) {
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
	q := db.New(tx)
	n := fmt.Sprintf("a%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	infra := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "infra"+n)
	ti := id(`INSERT INTO areas (code, name) VALUES ($1, 'TI '||$1) RETURNING id`, "ti"+n)
	person := func(area uuid.UUID, profile string) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities, profile) VALUES ($1, $1, '{}', $2) RETURNING id`, "g"+uuid.NewString()[:8]+n, profile)
		if area != uuid.Nil {
			id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
		}
		u := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "u"+uuid.NewString()[:8]+n)
		id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		return u
	}
	ana := person(infra, "resolutor")
	pedro := person(ti, "resolutor")
	carla := person(uuid.Nil, "gestion")
	org := id(`INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, $1) RETURNING id`, n)
	ticket := func(num string, area, requested uuid.UUID) uuid.UUID {
		return id(`INSERT INTO tickets (ticket_number, client_id, title, description, area_id, requested_area_id) VALUES ($1, $2, 'x', 'x', $3, $4) RETURNING id`, num, org, area, requested)
	}
	pedidoATi := ticket("TKT-"+n+"-1", infra, ti) // TI le pide a Infra
	deInfra := ticket("TKT-"+n+"-2", infra, infra)
	deTi := ticket("TKT-"+n+"-3", ti, ti)

	h := &TicketsHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	as := func(user uuid.UUID) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: "x", Role: "user"})
	}
	list := func(user uuid.UUID, queue string) map[uuid.UUID]bool {
		t.Helper()
		w := httptest.NewRecorder()
		h.List(w, httptest.NewRequest("GET", "/api/tickets?pageSize=200&queue="+queue+"&q=TKT-"+n, nil).WithContext(as(user)))
		if w.Code != 200 {
			t.Fatalf("list: %d %s", w.Code, w.Body)
		}
		var out struct {
			Data struct{ Items []ticketViewDTO }
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		got := map[uuid.UUID]bool{}
		for _, it := range out.Data.Items {
			got[it.ID] = it.CanWork
		}
		return got
	}

	if got := list(ana, "mine"); len(got) != 2 || !got[pedidoATi] || !got[deInfra] {
		t.Errorf("cola de Infra para Ana: %v", got)
	}
	if got := list(pedro, "mine"); len(got) != 1 || !got[deTi] {
		t.Errorf("cola de TI para Pedro: %v", got)
	}
	if got := list(pedro, "asked"); len(got) != 1 || got[pedidoATi] != false {
		t.Errorf("pedidos por TI (Pedro lo ve, no lo trabaja): %v", got)
	} else if _, ok := got[pedidoATi]; !ok {
		t.Errorf("Pedro no ve lo que TI pidió: %v", got)
	}
	if got := list(pedro, "all"); len(got) != 2 {
		t.Errorf("Pedro sin «todas»: solo su cola y lo pedido; vio %v", got)
	}
	if got := list(carla, "all"); len(got) != 3 {
		t.Errorf("Gestión ve todos: %v", got)
	}

	access := func(user, ticketID uuid.UUID, method, path string) int {
		r := httptest.NewRequest(method, path, nil).WithContext(as(user))
		r.SetPathValue("id", ticketID.String())
		w := httptest.NewRecorder()
		if h.requireTicketAccess(w, r) {
			return http.StatusOK
		}
		return w.Code
	}
	if c := access(pedro, pedidoATi, "GET", "/api/tickets/x"); c != 200 {
		t.Errorf("Pedro ve el ticket que pidió: %d", c)
	}
	if c := access(pedro, pedidoATi, "POST", "/api/tickets/x/comments"); c != 200 {
		t.Errorf("Pedro comenta el ticket que pidió: %d", c)
	}
	if c := access(pedro, pedidoATi, "PATCH", "/api/tickets/x"); c != 403 {
		t.Errorf("Pedro no trabaja el ticket de Infra: %d", c)
	}
	if c := access(pedro, deInfra, "GET", "/api/tickets/x"); c != 404 {
		t.Errorf("Pedro no ve un ticket de Infra que no pidió: %d", c)
	}
	if c := access(ana, pedidoATi, "PUT", "/api/tickets/x/area"); c != 200 {
		t.Errorf("Ana deriva un ticket de su cola: %d", c)
	}

	// Derivar: a la cola de TI, nuevo y sin responsable.
	if err := q.DeriveTicket(ctx, db.DeriveTicketParams{ID: pedidoATi, AreaID: ti}); err != nil {
		t.Fatal(err)
	}
	if got := list(pedro, "mine"); len(got) != 2 || !got[pedidoATi] {
		t.Errorf("derivado a TI, entra a la cola de Pedro: %v", got)
	}
	if got := list(ana, "mine"); got[pedidoATi] {
		t.Errorf("derivado a TI, sale de la cola de Ana: %v", got)
	}
}
