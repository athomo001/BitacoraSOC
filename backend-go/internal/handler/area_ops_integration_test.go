//go:build integration

// Guardias y escalamiento por área (9e) contra la base real, dentro de una
// transacción que se deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestAreaOps
package handler

import (
	"bytes"
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAreaOps_GuardiasYEscalamientoPorArea(t *testing.T) {
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
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	code := "infra_" + nonce
	area := id(`INSERT INTO areas (code, name) VALUES ($1, $1) RETURNING id`, code)
	group := func(caps []string) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities, profile) VALUES ($1, $1, $2, 'resolutor') RETURNING id`, "g"+uuid.NewString()[:8]+nonce, caps)
		id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
		return g
	}
	person := func(g uuid.UUID) uuid.UUID {
		u := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "u"+uuid.NewString()[:8]+nonce)
		if g != uuid.Nil {
			id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		}
		return u
	}
	lead := person(group([]string{CapAreaLead}))
	member := person(group([]string{}))
	outsider := person(uuid.Nil)

	as := func(user uuid.UUID) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: "x", Role: "user"})
	}
	call := func(c context.Context, fn http.HandlerFunc, body any, path map[string]string, query string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest("POST", "/x"+query, &buf).WithContext(c)
		for k, v := range path {
			r.SetPathValue(k, v)
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	logger := audit.NewLogger(&recordedAudit{}, slog.Default())

	// ===== Guardias =====
	gh := &GuardsHandler{Pool: tx, Queries: q, AuditLog: logger}
	w := call(as(lead), gh.CreateGuard, map[string]any{"area": code, "name": "Infra"}, nil, "")
	var created struct {
		Data struct {
			CycleID uuid.UUID `json:"cycleId"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || w.Code != http.StatusCreated {
		t.Fatalf("la jefatura crea la guardia de su área: %d %s", w.Code, w.Body)
	}
	if w := call(as(lead), gh.CreateGuard, map[string]any{"area": "soc", "name": "Otra"}, nil, ""); w.Code != http.StatusForbidden {
		t.Fatalf("no crea guardias de otra área: %d", w.Code)
	}
	cyc := map[string]string{"cycleId": created.Data.CycleID.String()}
	if w := call(as(lead), gh.AddMember, map[string]any{"userId": outsider}, cyc, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("no suma a alguien de fuera del área: %d %s", w.Code, w.Body)
	}
	w = call(as(lead), gh.AddMember, map[string]any{"userId": member}, cyc, "")
	var m struct {
		Data struct {
			TeamMemberID uuid.UUID `json:"teamMemberId"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil || w.Code != http.StatusCreated {
		t.Fatalf("suma a alguien de su área: %d %s", w.Code, w.Body)
	}
	start := time.Now().Add(-time.Hour)
	if w := call(as(lead), gh.CreateSlot, map[string]any{"cycleId": created.Data.CycleID, "teamMemberId": m.Data.TeamMemberID, "startsAt": start, "endsAt": start.Add(7 * 24 * time.Hour)}, nil, ""); w.Code != http.StatusCreated {
		t.Fatalf("asigna la guardia: %d %s", w.Code, w.Body)
	}
	socCycle := id(`SELECT c.id FROM rotation_cycles c JOIN teams t ON t.id = c.team_id WHERE t.kind = 'oncall' AND t.area_id = 'a0000000-0000-4000-8000-000000000001' LIMIT 1`)
	if w := call(as(lead), gh.UpdateGuard, map[string]any{"mustBeCovered": true}, map[string]string{"cycleId": socCycle.String()}, ""); w.Code != http.StatusForbidden {
		t.Fatalf("no edita guardias de SOC: %d %s", w.Code, w.Body)
	}
	// La persona del área ve solo la guardia de su área y no edita.
	w = call(as(member), gh.Timeline, nil, nil, "")
	var tl struct {
		Data struct {
			Guards []struct {
				Area string `json:"area"`
			} `json:"guards"`
			Slots         []json.RawMessage `json:"slots"`
			EditableAreas []string          `json:"editableAreas"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &tl); err != nil || w.Code != http.StatusOK {
		t.Fatalf("timeline: %d %s", w.Code, w.Body)
	}
	if len(tl.Data.Guards) != 1 || tl.Data.Guards[0].Area != code || len(tl.Data.Slots) != 1 || len(tl.Data.EditableAreas) != 0 {
		t.Fatalf("la persona ve su guardia y no edita: %+v", tl.Data)
	}

	// ===== Escalamiento =====
	service := id(`INSERT INTO services (organization_id, name, code) SELECT id, $1, $1 FROM organizations ORDER BY name LIMIT 1 RETURNING id`, "srv-"+nonce)
	eh := &EscalationHandler{DB: tx, Queries: q, AuditLog: logger, Modules: &repository.ModuleAccess{Queries: q}}
	w = call(as(lead), eh.CreatePolicy, map[string]any{"serviceId": service, "area": code}, nil, "")
	if w.Code != http.StatusCreated {
		t.Fatalf("la jefatura crea la política de su área: %d %s", w.Code, w.Body)
	}
	w = call(as(member), eh.ListPolicies, nil, nil, "")
	var pols struct {
		Data []policyDTO
	}
	if err := json.Unmarshal(w.Body.Bytes(), &pols); err != nil || len(pols.Data) != 1 || pols.Data[0].Area != code || pols.Data[0].Editable {
		t.Fatalf("la persona ve solo la política de su área, sin editar: %d %s", w.Code, w.Body)
	}
	socPolicy := id(`SELECT id FROM escalation_policies WHERE area_id = 'a0000000-0000-4000-8000-000000000001' AND id <> $1 LIMIT 1`, pols.Data[0].ID)
	if w := call(as(lead), eh.DeletePolicy, nil, map[string]string{"id": socPolicy.String()}, ""); w.Code != http.StatusForbidden {
		t.Fatalf("no borra políticas de SOC: %d %s", w.Code, w.Body)
	}
}
