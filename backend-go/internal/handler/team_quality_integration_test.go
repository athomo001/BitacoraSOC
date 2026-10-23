//go:build integration

// Mi equipo → Calidad (10f) contra la base real, dentro de una transacción
// que se deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestTeamQuality
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/quality"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestTeamQuality_PuntajePorPersona(t *testing.T) {
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
	local := func(day, h, m int) time.Time { return time.Date(2026, 10, day, h, m, 0, 0, loc) }

	// Un área operativa (usa la Bitácora) y otra resolutora.
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
	auditor := person("auditora", "auditor")
	n1 := group("n1", []string{}, ops)
	ana := person("ana", "user", n1)
	pablo := person("pablo", "user", n1)

	// Ana: un turno con checklist de 08:00 a 20:00 y una entrada por hora;
	// la del checklist no cuenta.
	tpl := id(`INSERT INTO checklist_templates (name) VALUES ('Turno ' || $1::text) RETURNING id`, nonce)
	shift := id(`INSERT INTO work_shifts (name, start_time, end_time) VALUES ('Día ' || $1::text, '08:00', '20:00') RETURNING id`, nonce)
	id(`INSERT INTO shift_checks (checklist_template_id, user_id, work_shift_id, check_type, check_date) VALUES ($1, $2, $3, 'inicio', $4) RETURNING id`, tpl, ana, shift, local(20, 8, 0))
	id(`INSERT INTO shift_checks (checklist_template_id, user_id, work_shift_id, check_type, check_date) VALUES ($1, $2, $3, 'cierre', $4) RETURNING id`, tpl, ana, shift, local(20, 20, 0))
	entry := func(user uuid.UUID, kind, content string, at time.Time) {
		id(`INSERT INTO entries (user_id, entry_type, content, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, user, kind, content, at)
	}
	for i := range 12 {
		entry(ana, "operativa", "Revisión de alertas del firewall perimetral sin hallazgos, nota "+string(rune('A'+i)), local(20, 8+i, 30))
	}
	entry(ana, "checklist", "Checklist de inicio", local(20, 8, 1))
	// Pablo: pocas entradas y dos días de vacaciones.
	for i := range 3 {
		entry(pablo, "operativa", "Revisión de consola sin novedad, caso "+string(rune('A'+i)), local(14, 9+i, 0))
	}
	for _, d := range []int{17, 18} {
		id(`INSERT INTO work_shift_assignments (user_id, assigned_date, condition) VALUES ($1, $2, 'vacation') RETURNING user_id`, pablo, time.Date(2026, 10, d, 0, 0, 0, 0, time.UTC))
	}

	h := &TeamHandler{Queries: db.New(tx), Pool: tx, Now: func() time.Time { return local(22, 18, 0) }}
	call := func(fn http.HandlerFunc, as uuid.UUID, role, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", target, nil).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: as, Role: role}))
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}

	// Áreas: la jefatura ve la suya con Calidad; el auditor, las operativas sin ser jefatura.
	var areas struct{ Data []teamAreaDTO }
	_ = json.Unmarshal(call(h.Areas, opsLead, "user", "/api/team/areas").Body.Bytes(), &areas)
	if len(areas.Data) != 1 || areas.Data[0].Code != opsCode || !areas.Data[0].Lead || !areas.Data[0].Quality {
		t.Fatalf("áreas de la jefatura: %+v", areas.Data)
	}
	_ = json.Unmarshal(call(h.Areas, auditor, "auditor", "/api/team/areas").Body.Bytes(), &areas)
	seen := map[string]teamAreaDTO{}
	for _, a := range areas.Data {
		seen[a.Code] = a
	}
	if a, ok := seen[opsCode]; !ok || a.Lead || !a.Quality {
		t.Fatalf("el auditor ve el área operativa, sin ser jefatura: %+v", areas.Data)
	}
	if _, ok := seen[infraCode]; ok {
		t.Fatalf("el auditor no ve áreas sin Calidad: %+v", areas.Data)
	}

	// Permisos y período.
	if w := call(h.Quality, infraLead, "user", "/api/team/quality?area="+infraCode); w.Code != http.StatusNotFound {
		t.Fatalf("un área que no usa la Bitácora: %d", w.Code)
	}
	if w := call(h.Quality, infraLead, "user", "/api/team/quality?area="+opsCode); w.Code != http.StatusForbidden {
		t.Fatalf("un área ajena: %d", w.Code)
	}
	if w := call(h.Quality, opsLead, "user", "/api/team/quality?area="+opsCode+"&days=10"); w.Code != http.StatusBadRequest {
		t.Fatalf("período inválido: %d", w.Code)
	}

	for _, who := range []struct {
		id   uuid.UUID
		role string
	}{{opsLead, "user"}, {auditor, "auditor"}} {
		w := call(h.Quality, who.id, who.role, "/api/team/quality?area="+opsCode+"&days=7")
		var out struct{ Data qualityDataDTO }
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != http.StatusOK {
			t.Fatalf("GET /api/team/quality (%s): %d %s", who.role, w.Code, w.Body)
		}
		d := out.Data
		if d.Days != 7 || d.From != "2026-10-16" || d.To != "2026-10-22" || d.MinEntries != quality.MinEntries {
			t.Fatalf("período: %+v", d)
		}
		byID := map[uuid.UUID]qualityPersonDTO{}
		for _, p := range d.People {
			byID[p.ID] = p
		}
		a := byID[ana]
		if !a.Evaluated || a.Entries != 12 || a.Shifts != 1 || a.Score != 100 || a.Status != quality.StatusExcellent {
			t.Fatalf("Ana: 12 entradas (sin el checklist) en un turno, 100: %+v", a)
		}
		// Pablo registró el 14, fuera de los 7 días; sus vacaciones sí caen.
		p := byID[pablo]
		if p.Evaluated || p.Entries != 0 || p.Absence == nil || p.Absence.Kind != "vacation" || p.Absence.Days != 2 {
			t.Fatalf("Pablo: sin evaluar, de vacaciones 2 días: %+v", p)
		}
	}
	// Un mes cerrado: Ana registró el 20 de octubre; en septiembre no hay nada.
	var sep struct{ Data qualityDataDTO }
	_ = json.Unmarshal(call(h.Quality, opsLead, "user", "/api/team/quality?area="+opsCode+"&month=2026-09").Body.Bytes(), &sep)
	if sep.Data.Month != "2026-09" || sep.Data.Days != 0 || sep.Data.From != "2026-09-01" || sep.Data.To != "2026-09-30" {
		t.Fatalf("septiembre: %+v", sep.Data)
	}
	for _, p := range sep.Data.People {
		if p.ID == ana && p.Entries != 0 {
			t.Fatalf("Ana no registró en septiembre: %+v", p)
		}
	}
	// El mes en curso llega hasta hoy; uno futuro no se pide.
	var oct struct{ Data qualityDataDTO }
	_ = json.Unmarshal(call(h.Quality, opsLead, "user", "/api/team/quality?area="+opsCode+"&month=2026-10").Body.Bytes(), &oct)
	if oct.Data.To != "2026-10-22" {
		t.Fatalf("octubre llega hasta hoy: %+v", oct.Data)
	}
	if w := call(h.Quality, opsLead, "user", "/api/team/quality?area="+opsCode+"&month=2026-11"); w.Code != http.StatusBadRequest {
		t.Fatalf("un mes futuro: %d", w.Code)
	}
	// Resumen mensual: septiembre ya se congeló. Si entra alguien con
	// entradas de ese mes, o sale alguien, la foto se rehace al abrirla.
	monthlyNames := func() map[string]int {
		t.Helper()
		w := call(h.Monthly, opsLead, "user", "/api/team/monthly?area="+opsCode+"&month=2026-09")
		var out struct {
			Data struct {
				Summary monthlyDataDTO `json:"summary"`
				Frozen  bool           `json:"frozen"`
			}
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != http.StatusOK || !out.Data.Frozen {
			t.Fatalf("resumen de septiembre: %d %s", w.Code, w.Body)
		}
		names := map[string]int{}
		for _, p := range out.Data.Summary.People {
			names[p.Name] = p.Entries
		}
		return names
	}
	if names := monthlyNames(); len(names) != 3 {
		t.Fatalf("septiembre con la jefa, Ana y Pablo: %v", names)
	}
	rafa := person("rafa", "user")
	for i := range 4 {
		entry(rafa, "operativa", "Revisión de alertas del SIEM sin hallazgos, turno "+string(rune('A'+i)), local(10, 9+i, 0).AddDate(0, -1, 0))
	}
	join := httptest.NewRequest("POST", "/", bytes.NewBufferString(`{"area":"`+opsCode+`","groupId":"`+n1.String()+`"}`)).
		WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: opsLead, Role: "user"}))
	join.SetPathValue("id", rafa.String())
	jw := httptest.NewRecorder()
	h.AuditLog = audit.NewLogger(&recordedAudit{}, slog.Default())
	h.Join(jw, join)
	if jw.Code != http.StatusNoContent {
		t.Fatalf("agregar a rafa: %d %s", jw.Code, jw.Body)
	}
	if names := monthlyNames(); names["rafa"+nonce] != 4 {
		t.Fatalf("rafa aparece en septiembre con sus 4 entradas: %v", names)
	}
	leave := httptest.NewRequest("DELETE", "/?area="+opsCode, nil).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: opsLead, Role: "user"}))
	leave.SetPathValue("id", pablo.String())
	lw := httptest.NewRecorder()
	h.Leave(lw, leave)
	if lw.Code != http.StatusNoContent {
		t.Fatalf("sacar a pablo: %d %s", lw.Code, lw.Body)
	}
	if _, ok := monthlyNames()["pablo"+nonce]; ok {
		t.Fatal("pablo salió del área y no debe seguir en la foto de septiembre")
	}

	w := call(h.Quality, opsLead, "user", "/api/team/quality?area="+opsCode)
	var out struct{ Data qualityDataDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	for _, p := range out.Data.People {
		if p.ID == pablo && (p.Entries != 3 || p.Evaluated) {
			t.Fatalf("en 30 días Pablo tiene 3 entradas y no se evalúa: %+v", p)
		}
	}
}
