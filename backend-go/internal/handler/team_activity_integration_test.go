//go:build integration

// Mi equipo → Actividad (10f) contra la base real, dentro de una transacción
// que se deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestTeamActivity
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTeamActivity_MapaDiaHora(t *testing.T) {
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
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	loc := teamLocation()
	local := func(month, day, h, m int) time.Time { return time.Date(2026, time.Month(month), day, h, m, 0, 0, loc) }

	opsCode, infraCode := "ops_"+nonce, "inf_"+nonce
	ops := id(`INSERT INTO areas (code, name, default_profile) VALUES ($1, 'Ops', 'operativo') RETURNING id`, opsCode)
	infra := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra') RETURNING id`, infraCode)
	group := func(name string, caps []string, area uuid.UUID) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities) VALUES ($1, $1, $2) RETURNING id`, name+"_"+nonce, caps)
		id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING permission_group_id`, g, area)
		return g
	}
	person := func(name, role string, groups ...uuid.UUID) uuid.UUID {
		u := id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', $1, 'x', $2) RETURNING id`, name+nonce, role)
		for _, g := range groups {
			id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		}
		return u
	}
	opsLead := person("jefa", "user", group("jefe_ops", []string{CapAreaLead}, ops))
	infraLead := person("jefe", "user", group("jefe_inf", []string{CapAreaLead}, infra))
	n1 := group("n1", []string{}, ops)
	ana := person("ana", "user", n1)
	pablo := person("pablo", "user", n1)
	event := func(user uuid.UUID, name string, ok bool, at time.Time) {
		id(`INSERT INTO audit_log ("timestamp", event, actor_user_id, success) VALUES ($1, $2, $3, $4) RETURNING id`, at, name, user, ok)
	}

	// Ana, la madrugada del miércoles 21: dos entradas (una con el nombre del
	// legacy) y un correo de escalamiento a las 03:xx.
	event(ana, "entry.created", true, local(10, 21, 3, 15))
	event(ana, "entry.create", true, local(10, 21, 3, 40))
	event(ana, "escalation.notify.sent", true, local(10, 21, 3, 50))
	// No cuentan: un envío fallido, un login y algo fuera del período.
	event(ana, "report.incident.sent", false, local(10, 21, 4, 0))
	event(ana, "auth.login.success", true, local(10, 21, 2, 55))
	event(ana, "entry.created", true, local(9, 1, 3, 0))
	// Pablo, el jueves 22 a las 10:00, crea un ticket.
	event(pablo, "ticket.created", true, local(10, 22, 10, 0))
	// Alguien de otra área no aparece.
	event(infraLead, "entry.created", true, local(10, 21, 3, 0))

	h := &TeamHandler{Queries: db.New(tx), Pool: tx, Now: func() time.Time { return local(10, 22, 18, 0) }}
	call := func(as uuid.UUID, role, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", target, nil).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: as, Role: role}))
		w := httptest.NewRecorder()
		h.Activity(w, r)
		return w
	}

	if w := call(infraLead, "user", "/api/team/activity?area="+opsCode); w.Code != http.StatusForbidden {
		t.Fatalf("un área ajena: %d", w.Code)
	}
	if w := call(opsLead, "user", "/api/team/activity?area="+opsCode+"&days=15"); w.Code != http.StatusBadRequest {
		t.Fatalf("período inválido: %d", w.Code)
	}

	w := call(opsLead, "user", "/api/team/activity?area="+opsCode+"&days=30")
	if w.Code != http.StatusOK {
		t.Fatalf("actividad: %d %s", w.Code, w.Body.String())
	}
	var got struct{ Data activityDataDTO }
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	d := got.Data
	if d.From != "2026-09-23" || d.To != "2026-10-22" || len(d.Kinds) != 5 {
		t.Fatalf("período o tipos: %s → %s %v", d.From, d.To, d.Kinds)
	}
	if len(d.People) != 3 { // la jefa, Ana y Pablo
		t.Fatalf("personas del área: %+v", d.People)
	}
	want := map[activityCellDTO]bool{
		{UserID: ana, Kind: "entries", Day: 3, Hour: 3, Count: 2}:    true,
		{UserID: ana, Kind: "mail", Day: 3, Hour: 3, Count: 1}:       true,
		{UserID: pablo, Kind: "tickets", Day: 4, Hour: 10, Count: 1}: true,
	}
	if len(d.Cells) != len(want) {
		t.Fatalf("celdas: %+v", d.Cells)
	}
	for _, c := range d.Cells {
		if !want[c] {
			t.Fatalf("celda inesperada %+v en %+v", c, d.Cells)
		}
	}
}
