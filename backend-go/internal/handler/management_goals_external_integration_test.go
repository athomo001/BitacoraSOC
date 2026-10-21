//go:build integration

// Metas para alguien sin cuenta (000057) contra la base real, dentro de una
// transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestMetasSinCuenta
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMetasSinCuenta_RegistroQuePasaALaCuenta(t *testing.T) {
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
	n := fmt.Sprintf("x%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	soc := uuid.MustParse(areaSOCID)
	exec(`UPDATE areas SET active = true WHERE id = $1`, soc)
	user := func(name, role string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', initcap($2), 'x', $3) RETURNING id`, name+n, name, role)
	}
	jefa, camila, pedro, admin := user("jefa", "user"), user("camila", "user"), user("pedro", "user"), user("adm", "admin")
	group := func(code string, caps []string, users ...uuid.UUID) {
		g := id(`INSERT INTO permission_groups (code, name, profile, capabilities) VALUES ($1, $1, 'operativo', $2) RETURNING id`, code+n, caps)
		exec(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2)`, g, soc)
		for _, u := range users {
			exec(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2)`, u, g)
		}
	}
	group("socjefa", []string{CapAreaLead}, jefa)
	group("socn1", []string{}, camila)

	h := &ManagementHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default()), Agenda: &AgendaHandler{Queries: q}}
	call := func(fn http.HandlerFunc, who uuid.UUID, role, method, path string, body any, vals ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		c := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: who, Username: "u", Role: role})
		r := httptest.NewRequest(method, path, &buf).WithContext(c)
		for i := 0; i+1 < len(vals); i += 2 {
			r.SetPathValue(vals[i], vals[i+1])
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	decode := func(w *httptest.ResponseRecorder, out any) {
		t.Helper()
		var env struct{ Data json.RawMessage }
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || json.Unmarshal(env.Data, out) != nil {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
	}
	people := func(who uuid.UUID, role string) map[uuid.UUID]mgmtPersonDTO {
		t.Helper()
		var meta struct{ People []mgmtPersonDTO }
		decode(call(h.Meta, who, role, "GET", "/api/management/meta", nil), &meta)
		out := map[uuid.UUID]mgmtPersonDTO{}
		for _, p := range meta.People {
			out[p.ID] = p
		}
		return out
	}

	// La jefatura ve a la gente de su área; el admin, también a quien no tiene área.
	if ps := people(jefa, "user"); ps[camila].AreaID == nil || ps[pedro].ID != uuid.Nil {
		t.Fatalf("jefatura: %+v", ps)
	}
	if ps := people(admin, "admin"); ps[pedro].ID != pedro || ps[pedro].AreaID != nil || ps[camila].AreaName == "" {
		t.Fatalf("admin: %+v", ps)
	}

	due := time.Now().AddDate(0, 2, 0).Format("2006-01-02")
	email := "ana.rojas." + n + "@cliente.cl"
	body := map[string]any{"name": "Certificación ITIL", "scope": "person", "personName": " Ana Rojas ", "personEmail": email,
		"kind": "certification", "bonus": "primary", "dueDate": due, "evidenceRequired": true, "steps": []string{"Inscribirse"}}
	if w := call(h.CreateGoal, camila, "user", "POST", "/api/goals", body); w.Code != http.StatusForbidden {
		t.Fatalf("sin ser jefatura: %d %s", w.Code, w.Body)
	}
	taken := map[string]any{"name": "x", "scope": "person", "personName": "Camila", "personEmail": "CAMILA" + n + "@test.local", "dueDate": due}
	if w := call(h.CreateGoal, jefa, "user", "POST", "/api/goals", taken); w.Code != http.StatusConflict {
		t.Fatalf("correo de un usuario: %d %s", w.Code, w.Body)
	}
	w := call(h.CreateGoal, jefa, "user", "POST", "/api/goals", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("crear: %d %s", w.Code, w.Body)
	}
	var g goalDTO
	decode(w, &g)
	if g.PersonID != nil || g.PersonName != "Ana Rojas" || g.PersonEmail != email || !g.CanEdit || !g.CanMark || !g.EvidenceNeeded {
		t.Fatalf("meta: %+v", g)
	}
	// Es un registro de quien la creó: otra persona del área no la ve.
	var list []goalDTO
	decode(call(h.Goals, camila, "user", "GET", "/api/goals?mine=1", nil), &list)
	for _, x := range list {
		if x.ID == g.ID {
			t.Fatal("camila no debe verla")
		}
	}

	// Un admin crea el usuario con ese correo: la meta pasa a su cuenta.
	ana := id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, upper($2), 'Ana Rojas', 'x', 'user') RETURNING id`, "arojas"+n, email)
	decode(call(h.Goals, ana, "user", "GET", "/api/goals?mine=1", nil), &list)
	if len(list) != 1 || list[0].ID != g.ID || list[0].PersonID == nil || *list[0].PersonID != ana || list[0].PersonEmail != "" || list[0].OwnerID == nil || *list[0].OwnerID != ana {
		t.Fatalf("Mis metas de Ana: %+v", list)
	}
	var moved int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM goal_events WHERE goal_id = $1 AND text = 'Pasó a la cuenta de Ana Rojas'`, g.ID).Scan(&moved)
	if moved != 1 {
		t.Fatalf("historial: %d", moved)
	}
}
