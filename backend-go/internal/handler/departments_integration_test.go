//go:build integration

// Departamentos (spec/16 §3.5.1) contra la base real, dentro de una
// transacción que se deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestDepartments
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
	"sort"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDepartments_DePuntaAPunta(t *testing.T) {
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
	codeA, codeB, codeC := "a_"+nonce, "b_"+nonce, "c_"+nonce
	id(`INSERT INTO areas (code, name, default_profile) VALUES ($1, 'Ops A', 'operativo') RETURNING id`, codeA)
	id(`INSERT INTO areas (code, name, default_profile) VALUES ($1, 'Ops B', 'operativo') RETURNING id`, codeB)
	areaC := id(`INSERT INTO areas (code, name) VALUES ($1, 'QA') RETURNING id`, codeC)
	person := func(name string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash) VALUES ($1, $1 || '@test.local', $1, 'x') RETURNING id`, name+nonce)
	}
	admin := id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', $1, 'x', 'admin') RETURNING id`, "adm"+nonce)
	jefa, p1, p2, p3 := person("jefa"), person("uno"), person("dos"), person("tres")
	levels, err := q.ListLevels(ctx)
	if err != nil || len(levels) < 2 {
		t.Fatalf("niveles: %v %v", levels, err)
	}
	sort.Slice(levels, func(i, j int) bool { return levels[i].Rank < levels[j].Rank })
	n1, n2 := levels[0].ID.String(), levels[1].ID.String()

	logger := audit.NewLogger(&recordedAudit{}, slog.Default())
	deps := &DepartmentsHandler{Queries: q, Pool: tx, AuditLog: logger}
	place := &PlacementHandler{Queries: q, Pool: tx, AuditLog: logger}
	team := &TeamHandler{Queries: q, Pool: tx, AuditLog: logger}
	as := func(user uuid.UUID, role string) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Role: role})
	}
	call := func(c context.Context, fn http.HandlerFunc, method, target string, body any, path map[string]string) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, target, &buf).WithContext(c)
		for k, v := range path {
			r.SetPathValue(k, v)
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	asAdmin := as(admin, "admin")
	placeIn := func(user uuid.UUID, areas ...placementArea) {
		t.Helper()
		if w := call(asAdmin, place.Put, "PUT", "/", placementDTO{Areas: areas, Extras: []string{}}, map[string]string{"id": user.String()}); w.Code != http.StatusOK {
			t.Fatalf("ubicar: %d %s", w.Code, w.Body)
		}
	}
	placementOfT := func(user uuid.UUID) map[string]string {
		t.Helper()
		p, err := placementOf(ctx, q, user)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, a := range p.Areas {
			out[a.Code] = a.LevelID
		}
		return out
	}
	placeIn(p1, placementArea{Code: codeA, LevelID: n1})
	placeIn(p2, placementArea{Code: codeB, LevelID: n2})

	// Crear el departamento con sus tres áreas y su jefatura.
	w := call(asAdmin, deps.Create, "POST", "/", map[string]any{"name": "CDC " + nonce}, nil)
	var created struct{ Data departmentDTO }
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || w.Code != http.StatusCreated {
		t.Fatalf("crear: %d %s", w.Code, w.Body)
	}
	dep := created.Data.ID.String()
	if w := call(asAdmin, deps.Create, "POST", "/", map[string]any{"name": "cdc " + nonce}, nil); w.Code != http.StatusConflict {
		t.Fatalf("nombre repetido: %d", w.Code)
	}
	if w := call(asAdmin, deps.Patch, "PATCH", "/", map[string]any{"areas": []string{codeA, codeB, codeC}}, map[string]string{"id": dep}); w.Code != http.StatusOK {
		t.Fatalf("áreas: %d %s", w.Code, w.Body)
	}
	if w := call(asAdmin, deps.SetLeads, "PUT", "/", map[string]any{"userIds": []uuid.UUID{jefa}}, map[string]string{"id": dep}); w.Code != http.StatusOK {
		t.Fatalf("jefatura: %d %s", w.Code, w.Body)
	}
	leads, _ := q.ListLeadAreas(ctx, jefa)
	if len(leads) != 3 {
		t.Fatalf("la jefatura del departamento lo es de sus 3 áreas: %+v", leads)
	}

	// Comparten equipo: al marcar A y B se igualan (cada uno queda en ambas
	// con su nivel).
	if w := call(asAdmin, deps.Patch, "PATCH", "/", map[string]any{"shared": []string{codeA, codeB}}, map[string]string{"id": dep}); w.Code != http.StatusOK {
		t.Fatalf("comparten equipo: %d %s", w.Code, w.Body)
	}
	if got := placementOfT(p1); got[codeA] != n1 || got[codeB] != n1 {
		t.Fatalf("uno queda en A y B como N1: %v", got)
	}
	if got := placementOfT(p2); got[codeA] != n2 || got[codeB] != n2 {
		t.Fatalf("dos queda en A y B como N2: %v", got)
	}
	// Salir de una (panel de la persona) saca de todas; la jefatura no se toca.
	placeIn(p1)
	if got := placementOfT(p1); len(got) != 0 {
		t.Fatalf("uno sale de A y de B: %v", got)
	}
	placeIn(jefa, placementArea{Code: codeA, LevelID: n2})
	if l, _ := q.ListLeadAreas(ctx, jefa); len(l) != 3 {
		t.Fatalf("editar el panel de la jefa no le quita la jefatura del departamento: %+v", l)
	}

	// Mi equipo: la jefa agrega a «tres» a A y entra también a B.
	groups, _ := q.ListAreaGroups(ctx, mustArea(t, q, codeA).ID)
	var groupA uuid.UUID
	for _, g := range groups {
		if g.LevelName == levels[0].Name && !slices.Contains(g.Capabilities, CapAreaLead) && len(g.AreaCodes) == 1 {
			groupA = g.ID
		}
	}
	asJefa := as(jefa, "user")
	if w := call(asJefa, team.Join, "POST", "/", map[string]any{"area": codeA, "groupId": groupA}, map[string]string{"id": p3.String()}); w.Code != http.StatusNoContent {
		t.Fatalf("agregar a tres: %d %s", w.Code, w.Body)
	}
	if got := placementOfT(p3); got[codeA] != n1 || got[codeB] != n1 {
		t.Fatalf("tres entra a A y B: %v", got)
	}

	// Mi equipo del departamento: la gente junta, con sus áreas.
	w = call(asJefa, team.Departments, "GET", "/", nil, nil)
	var mine struct{ Data []teamDepartmentDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &mine)
	if !slices.ContainsFunc(mine.Data, func(d teamDepartmentDTO) bool {
		return d.ID == created.Data.ID && d.Lead && d.Quality && len(d.Areas) == 3
	}) {
		t.Fatalf("la jefa ve su departamento: %s", w.Body)
	}
	w = call(asJefa, team.Get, "GET", "/?department="+dep, nil, nil)
	var view struct{ Data teamViewDTO }
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil || w.Code != http.StatusOK {
		t.Fatalf("Mi equipo del departamento: %d %s", w.Code, w.Body)
	}
	byID := map[uuid.UUID]teamPersonDTO{}
	for _, p := range view.Data.People {
		byID[p.ID] = p
	}
	if p := byID[p2]; len(p.Areas) != 2 || p.Editable {
		t.Fatalf("dos aparece una vez, con A y B, y solo para mirar: %+v", p)
	}
	if w := call(asJefa, team.Monthly, "GET", "/?department="+dep+"&month=2026-09", nil, nil); w.Code != http.StatusOK {
		t.Fatalf("resumen del departamento: %d %s", w.Code, w.Body)
	}
	if w := call(asJefa, team.Quality, "GET", "/?department="+dep, nil, nil); w.Code != http.StatusOK {
		t.Fatalf("calidad del departamento: %d %s", w.Code, w.Body)
	}
	if w := call(as(p2, "user"), team.Get, "GET", "/?department="+dep, nil, nil); w.Code != http.StatusForbidden {
		t.Fatalf("quien no es jefatura no ve el departamento: %d", w.Code)
	}

	// Mover QA a otro departamento sin sacarla antes: el primero deja de dirigirla.
	w = call(asAdmin, deps.Create, "POST", "/", map[string]any{"name": "TI " + nonce}, nil)
	var other struct{ Data departmentDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &other)
	if w := call(asAdmin, deps.Patch, "PATCH", "/", map[string]any{"areas": []string{codeC}}, map[string]string{"id": other.Data.ID.String()}); w.Code != http.StatusOK {
		t.Fatalf("mover QA: %d %s", w.Code, w.Body)
	}
	if a := mustArea(t, q, codeC); !a.DepartmentID.Valid || uuid.UUID(a.DepartmentID.Bytes) != other.Data.ID {
		t.Fatalf("QA queda en el otro departamento: %+v", a)
	}
	if l, _ := q.ListLeadAreas(ctx, jefa); len(l) != 2 {
		t.Fatalf("la jefa de CDC ya no dirige QA: %+v", l)
	}

	// CSM: se marca en el panel de la persona (ve todo mientras no tenga
	// departamento) y se asigna en el departamento, a todas sus áreas o a algunas.
	csm := person("csm")
	placeIn(csm)
	if w := call(asAdmin, place.Put, "PUT", "/", placementDTO{Areas: []placementArea{}, Extras: []string{CapCSM}}, map[string]string{"id": csm.String()}); w.Code != http.StatusOK {
		t.Fatalf("marcar CSM: %d %s", w.Code, w.Body)
	}
	if u, err := agendaUserFor(ctx, q, csm, false); err != nil || !u.gestion || u.limited() {
		t.Fatalf("la CSM tiene Gestión y, sin departamento, ve todo: %+v %v", u, err)
	}
	w = call(asAdmin, deps.CSMPeople, "GET", "/", nil, nil)
	if !bytes.Contains(w.Body.Bytes(), []byte(csm.String())) {
		t.Fatalf("la CSM aparece para asignar: %s", w.Body)
	}
	if w := call(asAdmin, deps.SetCSMs, "PUT", "/", map[string]any{"csms": []map[string]any{{"id": p2, "areas": []string{}}}}, map[string]string{"id": other.Data.ID.String()}); w.Code != http.StatusBadRequest {
		t.Fatalf("quien no es CSM no se asigna: %d", w.Code)
	}
	if w := call(asAdmin, deps.SetCSMs, "PUT", "/", map[string]any{"csms": []map[string]any{{"id": csm, "areas": []string{}}}}, map[string]string{"id": other.Data.ID.String()}); w.Code != http.StatusOK {
		t.Fatalf("asignar la CSM al departamento: %d %s", w.Code, w.Body)
	}
	u, err := agendaUserFor(ctx, q, csm, false)
	if err != nil || !u.limited() || !u.seesArea(areaC) || u.seesArea(mustArea(t, q, codeA).ID) {
		t.Fatalf("la CSM ve las áreas de su departamento (QA) y no las de otro: %+v %v", u.scope, err)
	}
	if w := call(asAdmin, deps.SetCSMs, "PUT", "/", map[string]any{"csms": []map[string]any{{"id": csm, "areas": []string{codeA}}}}, map[string]string{"id": other.Data.ID.String()}); w.Code != http.StatusBadRequest {
		t.Fatalf("solo áreas del departamento: %d", w.Code)
	}
	w = call(asAdmin, deps.List, "GET", "/", nil, nil)
	var listed struct{ Data []departmentDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &listed)
	if !slices.ContainsFunc(listed.Data, func(d departmentDTO) bool {
		return d.ID == other.Data.ID && len(d.CSMs) == 1 && d.CSMs[0].ID == csm && len(d.CSMs[0].Areas) == 0
	}) {
		t.Fatalf("el departamento muestra su CSM con todas las áreas: %s", w.Body)
	}

	// Borrar el departamento: las áreas quedan sueltas y la jefatura se va.
	if w := call(asAdmin, deps.Delete, "DELETE", "/", nil, map[string]string{"id": dep}); w.Code != http.StatusNoContent {
		t.Fatalf("borrar: %d %s", w.Code, w.Body)
	}
	if l, _ := q.ListLeadAreas(ctx, jefa); len(l) != 0 {
		t.Fatalf("sin departamento no queda jefatura: %+v", l)
	}
	if a := mustArea(t, q, codeA); a.DepartmentID.Valid || a.SharesTeam {
		t.Fatalf("el área queda sin departamento: %+v", a)
	}
}

func mustArea(t *testing.T, q *db.Queries, code string) db.Area {
	t.Helper()
	areas, err := q.ListAreas(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range areas {
		if a.Code == code {
			return a
		}
	}
	t.Fatalf("área %s no encontrada", code)
	return db.Area{}
}
