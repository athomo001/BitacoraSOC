//go:build integration

// Mi equipo (spec/16 §3.5, 9d) contra la base real, dentro de una
// transacción que se deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestTeam
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
	"slices"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type recordedAudit struct{ events []string }

func (r *recordedAudit) InsertAuditLog(_ context.Context, e audit.Entry) error {
	r.events = append(r.events, e.Event)
	return nil
}

func TestTeam_JefaturaDePuntaAPunta(t *testing.T) {
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
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	area := id(`INSERT INTO areas (code, name) VALUES ($1, $2) RETURNING id`, "infra_"+nonce, "Infra "+nonce)
	code := "infra_" + nonce
	group := func(name string, caps []string, areas ...uuid.UUID) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities) VALUES ($1, $1, $2) RETURNING id`, name+"_"+nonce, caps)
		for _, a := range areas {
			id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING permission_group_id`, g, a)
		}
		return g
	}
	soc := id(`SELECT id FROM areas WHERE code = 'soc'`)
	leadG := group("jefe", []string{CapAreaLead}, area)
	n1 := group("n1", []string{}, area)
	n2 := group("n2", []string{"directory:write"}, area)
	mixed := group("mixto", []string{}, area, soc)
	person := func(name string, groups ...uuid.UUID) uuid.UUID {
		u := id(`INSERT INTO users (username, email, full_name, password_hash) VALUES ($1, $1 || '@test.local', $1, 'x') RETURNING id`, name+nonce)
		for _, g := range groups {
			id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		}
		return u
	}
	lead := person("jefe", leadG)
	p1 := person("diego", n1)
	p2 := person("marcela", mixed)

	rec := &recordedAudit{}
	h := &TeamHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(rec, slog.Default())}
	asLead := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: lead, Username: "jefe", Role: "user"})
	call := func(fn http.HandlerFunc, method, target string, body any, pathID uuid.UUID) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, target, &buf).WithContext(asLead)
		if pathID != uuid.Nil {
			r.SetPathValue("id", pathID.String())
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}

	// Sus áreas: solo la del grupo de jefatura.
	w := call(h.Areas, "GET", "/api/team/areas", nil, uuid.Nil)
	var areas struct{ Data []teamAreaDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &areas)
	if len(areas.Data) != 1 || areas.Data[0].Code != code {
		t.Fatalf("áreas de la jefatura: %s", w.Body)
	}
	if w := call(h.Get, "GET", "/api/team?area=soc", nil, uuid.Nil); w.Code != http.StatusForbidden {
		t.Fatalf("un área ajena: %d", w.Code)
	}

	w = call(h.Get, "GET", "/api/team?area="+code, nil, uuid.Nil)
	var team struct {
		Data struct {
			People []teamPersonDTO `json:"people"`
			Groups []leadGroupDTO  `json:"groups"`
			Stats  teamStatsDTO    `json:"stats"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &team); err != nil || w.Code != http.StatusOK {
		t.Fatalf("GET /api/team: %d %s", w.Code, w.Body)
	}
	if len(team.Data.People) != 3 || team.Data.Stats.People != 3 {
		t.Fatalf("personas del área: %+v", team.Data)
	}
	editable := map[uuid.UUID]bool{}
	for _, p := range team.Data.People {
		editable[p.ID] = p.Editable
		if len(p.Week) != 5 || p.Today == "" {
			t.Fatalf("semana y hoy: %+v", p)
		}
	}
	if !editable[p1] || editable[p2] || editable[lead] {
		t.Fatalf("editable: diego sí, marcela (otra área) no, la jefatura no: %v", editable)
	}
	var groupIDs []uuid.UUID
	for _, g := range team.Data.Groups {
		groupIDs = append(groupIDs, g.ID)
	}
	if !slices.Contains(groupIDs, n1) || !slices.Contains(groupIDs, n2) || slices.Contains(groupIDs, leadG) || slices.Contains(groupIDs, mixed) {
		t.Fatalf("asignables: solo n1 y n2: %v", groupIDs)
	}

	// Cambiar el grupo: queda solo n2.
	if w := call(h.SetGroup, "PUT", "/", map[string]any{"area": code, "groupId": n2}, p1); w.Code != http.StatusNoContent {
		t.Fatalf("cambiar grupo: %d %s", w.Code, w.Body)
	}
	gs, _ := q.ListUserGroupsWithAreas(ctx, p1)
	if len(gs) != 1 || gs[0].ID != n2 {
		t.Fatalf("grupos de diego: %+v", gs)
	}
	if w := call(h.SetGroup, "PUT", "/", map[string]any{"area": code, "groupId": leadG}, p1); w.Code != http.StatusBadRequest {
		t.Fatalf("no puede nombrar jefaturas: %d", w.Code)
	}
	// Sacar del equipo: quien comparte un grupo con otra área, o la jefatura
	// misma, no; sacar no da de baja la cuenta.
	if w := call(h.Leave, "DELETE", "/?area="+code, nil, p2); w.Code != http.StatusForbidden {
		t.Fatalf("persona con un grupo compartido con otra área: %d", w.Code)
	}
	if w := call(h.Leave, "DELETE", "/?area="+code, nil, lead); w.Code != http.StatusForbidden {
		t.Fatalf("a sí misma: %d", w.Code)
	}
	if w := call(h.Leave, "DELETE", "/?area="+code, nil, p1); w.Code != http.StatusNoContent {
		t.Fatalf("sacar del equipo: %d %s", w.Code, w.Body)
	}
	if u, _ := q.GetUserByID(ctx, p1); !u.Active {
		t.Fatal("sacar del equipo no da de baja la cuenta")
	}
	if gs, _ := q.ListUserGroupsWithAreas(ctx, p1); len(gs) != 0 {
		t.Fatalf("diego sigue con grupos del área: %+v", gs)
	}

	// Agregar a alguien que ya existe: aparece entre los candidatos (los
	// admin no, para la jefatura) y entra con el grupo elegido.
	admin := id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', $1, 'x', 'admin') RETURNING id`, "adm"+nonce)
	w = call(h.Candidates, "GET", "/?area="+code, nil, uuid.Nil)
	var cands struct{ Data []teamCandidateDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &cands)
	ids := map[uuid.UUID]bool{}
	for _, c := range cands.Data {
		ids[c.ID] = true
	}
	if !ids[p1] || ids[p2] || ids[admin] || ids[lead] {
		t.Fatalf("candidatos: diego sí; marcela (ya está), la jefatura y un admin no: %s", w.Body)
	}
	if w := call(h.Join, "POST", "/", map[string]any{"area": code, "groupId": n1}, admin); w.Code != http.StatusBadRequest {
		t.Fatalf("la jefatura no agrega administradores: %d", w.Code)
	}
	if w := call(h.Join, "POST", "/", map[string]any{"area": code, "groupId": leadG}, p1); w.Code != http.StatusBadRequest {
		t.Fatalf("no entra con un grupo de jefatura: %d", w.Code)
	}
	if w := call(h.Join, "POST", "/", map[string]any{"area": code, "groupId": n1}, p1); w.Code != http.StatusNoContent {
		t.Fatalf("agregar a diego: %d %s", w.Code, w.Body)
	}
	if gs, _ := q.ListUserGroupsWithAreas(ctx, p1); len(gs) != 1 || gs[0].ID != n1 {
		t.Fatalf("diego vuelve con su grupo: %+v", gs)
	}
	if w := call(h.Join, "POST", "/", map[string]any{"area": code, "groupId": n1}, p1); w.Code != http.StatusBadRequest {
		t.Fatalf("ya está en el área: %d", w.Code)
	}

	// Alta: rol usuario, contraseña temporal, el grupo elegido.
	w = call(h.CreatePerson, "POST", "/", map[string]any{"area": code, "fullName": "Rocío Fuentes", "username": "rf" + nonce, "email": "rf" + nonce + "@test.local", "groupId": n1}, uuid.Nil)
	var created struct {
		Data struct {
			ID           uuid.UUID `json:"id"`
			TempPassword string    `json:"tempPassword"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || w.Code != http.StatusCreated || len(created.Data.TempPassword) != 14 {
		t.Fatalf("alta: %d %s", w.Code, w.Body)
	}
	u, _ := q.GetUserByID(ctx, created.Data.ID)
	if u.Role != db.UserRoleUser || !u.MustChangePassword || u.FullName.String != "Rocío Fuentes" {
		t.Fatalf("persona creada: %+v", u)
	}
	if gs, _ := q.ListUserGroupsWithAreas(ctx, u.ID); len(gs) != 1 || gs[0].ID != n1 {
		t.Fatalf("grupo de la persona nueva: %+v", gs)
	}
	if w := call(h.CreatePerson, "POST", "/", map[string]any{"area": code, "fullName": "Otra", "username": "rf" + nonce, "email": "x" + nonce + "@test.local", "groupId": n1}, uuid.Nil); w.Code != http.StatusConflict {
		t.Fatalf("usuario repetido: %d", w.Code)
	}

	for _, want := range []string{"team.person.group", "team.person.leave", "team.person.join", "team.person.create"} {
		if !slices.Contains(rec.events, want) {
			t.Fatalf("auditoría sin %s: %v", want, rec.events)
		}
	}
}
