//go:build integration

// Agenda (9.3) contra la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestAgenda
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

func TestAgenda_NivelesTomarAusenciasEInformes(t *testing.T) {
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
	const n1, n2, n3 = "a0000000-0000-4000-8000-000000000101", "a0000000-0000-4000-8000-000000000102", "a0000000-0000-4000-8000-000000000103"
	area := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "inf"+n)
	person := func(level string, caps []string) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities, profile, level_id) VALUES ($1, $1, $2, 'resolutor', $3) RETURNING id`, "g"+uuid.NewString()[:8]+n, caps, level)
		id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
		u := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "u"+uuid.NewString()[:8]+n)
		id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		return u
	}
	jefa := person(n3, []string{CapAreaLead})
	ana := person(n2, []string{})
	pedro := person(n1, []string{})
	sofia := person(n1, []string{})
	org := id(`INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, 'c'||$1) RETURNING id`, n)
	// Sin feriados ni otras tareas que molesten: el calendario parte limpio.
	if _, err := tx.Exec(ctx, `DELETE FROM holidays; UPDATE agenda_tasks SET active = false; UPDATE agenda_settings SET work_days = '{1,2,3,4,5}', day_start = '08:00', day_end = '20:00', timezone = 'America/Santiago'`); err != nil {
		t.Fatal(err)
	}

	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, loc) // miércoles
	h := &AgendaHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default()), Now: func() time.Time { return now }}
	call := func(user uuid.UUID, fn func(http.ResponseWriter, *http.Request), method, path string, body any, pathID string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: "x", Role: "user"}))
		if pathID != "" {
			r.SetPathValue("id", pathID)
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	mine := func(user uuid.UUID) []agendaOccDTO {
		t.Helper()
		h.lastGen = time.Time{}
		w := call(user, h.Mine, "GET", "/api/agenda/mine", nil, "")
		if w.Code != 200 {
			t.Fatalf("mis pendientes: %d %s", w.Code, w.Body)
		}
		var out struct{ Data []agendaOccDTO }
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data
	}
	find := func(list []agendaOccDTO, name string) *agendaOccDTO {
		for i := range list {
			if list[i].Task.Name == name {
				return &list[i]
			}
		}
		return nil
	}
	task := func(user uuid.UUID, body map[string]any) (int, string) {
		t.Helper()
		body["areaId"] = area
		w := call(user, h.CreateTask, "POST", "/api/agenda/tasks", body, "")
		return w.Code, w.Body.String()
	}

	// Ana (N2) asigna a N1 una tarea de los miércoles con pasos.
	code, body := task(ana, map[string]any{"name": "Respaldo " + n, "assigneeKind": "level", "assigneeId": n1,
		"recurrence": map[string]any{"kind": "weekly", "weekdays": []int{3}}, "steps": []string{"Switches", "Firewall"}, "warnDays": []int{0}})
	if code != 201 {
		t.Fatalf("crear: %d %s", code, body)
	}
	// Hacia arriba no: N2 no asigna a N3.
	if code, body := task(ana, map[string]any{"name": "Arriba", "assigneeKind": "level", "assigneeId": n3,
		"recurrence": map[string]any{"kind": "once", "date": "2026-10-20"}}); code != 403 {
		t.Fatalf("asignar hacia arriba: %d %s", code, body)
	}
	// Pedro (N1) tampoco asigna a su propio nivel, pero sí a sí mismo.
	if code, _ := task(pedro, map[string]any{"name": "Par", "assigneeKind": "level", "assigneeId": n1,
		"recurrence": map[string]any{"kind": "once", "date": "2026-10-20"}}); code != 403 {
		t.Fatalf("N1 asigna a N1: %d", code)
	}
	if code, body := task(pedro, map[string]any{"name": "Propia " + n, "assigneeKind": "person", "assigneeId": pedro,
		"recurrence": map[string]any{"kind": "once", "date": "2026-10-15"}}); code != 201 {
		t.Fatalf("tarea propia: %d %s", code, body)
	}

	// La ven Pedro y Sofía (N1) sin tomar; Ana no (no es de N1).
	o := find(mine(pedro), "Respaldo "+n)
	if o == nil || !o.CanTake || o.DueDate != "2026-10-14" || o.HolderID != nil {
		t.Fatalf("pedro no ve la ocurrencia ofrecida: %+v", o)
	}
	if find(mine(ana), "Respaldo "+n) != nil {
		t.Fatal("Ana (N2) no debía verla en sus pendientes")
	}
	// Pedro la toma: deja de estar para Sofía.
	if w := call(pedro, h.Take, "POST", "/x", nil, o.ID.String()); w.Code != 200 {
		t.Fatalf("tomar: %d %s", w.Code, w.Body)
	}
	for _, x := range mine(sofia) {
		if x.ID == o.ID {
			t.Fatal("tomada por Pedro, Sofía ya no debía verla")
		}
	}
	// Sofía no la omite (no es responsable ni quien la asignó); Ana sí podría.
	if w := call(sofia, h.Skip, "POST", "/x", map[string]string{"reason": "x"}, o.ID.String()); w.Code != 403 {
		t.Fatalf("omitir ajena: %d", w.Code)
	}
	// Pasos y hecha.
	if w := call(pedro, h.Steps, "PUT", "/x", map[string]any{"steps": []int{1, 0, 9}}, o.ID.String()); w.Code != 200 || !strings.Contains(w.Body.String(), `"stepsDone":[0,1]`) {
		t.Fatalf("pasos: %d %s", w.Code, w.Body)
	}
	if w := call(pedro, h.Done, "POST", "/x", map[string]string{"note": "listo"}, o.ID.String()); w.Code != 200 || !strings.Contains(w.Body.String(), `"onTime":true`) {
		t.Fatalf("hecha: %d %s", w.Code, w.Body)
	}
	if d := find(mine(pedro), "Respaldo "+n); d == nil || d.ID != o.ID || d.Status != "done" {
		t.Fatalf("la hecha hoy sigue en sus pendientes como hecha: %+v", d)
	}

	// Ausencia: Pedro de vacaciones mañana → su tarea propia vuelve a N1 (Sofía la ve).
	if _, err := tx.Exec(ctx, `INSERT INTO work_shift_assignments (user_id, assigned_date, condition) VALUES ($1, '2026-10-15', 'vacation')`, pedro); err != nil {
		t.Fatal(err)
	}
	s := find(mine(sofia), "Propia "+n)
	if s == nil || !s.CanTake || s.AbsentName == "" {
		t.Fatalf("la tarea de Pedro ausente no volvió a N1: %+v", s)
	}

	// Gestión: Ana ve lo que asignó; la jefatura ve todo el área.
	var managed struct {
		Data struct {
			Tasks []agendaManagedDTO
		}
	}
	w := call(ana, h.Managed, "GET", "/api/agenda/managed?scope=mine", nil, "")
	_ = json.Unmarshal(w.Body.Bytes(), &managed)
	if len(managed.Data.Tasks) != 1 || managed.Data.Tasks[0].History[0] != "ok" {
		t.Fatalf("gestión de Ana: %s", w.Body)
	}
	w = call(jefa, h.Managed, "GET", "/api/agenda/managed?scope=area", nil, "")
	_ = json.Unmarshal(w.Body.Bytes(), &managed)
	if len(managed.Data.Tasks) != 2 {
		t.Fatalf("gestión de la jefatura: %s", w.Body)
	}

	// Informe: la tarea ligada al informe de incidente del cliente se cierra al enviarlo.
	if code, body := task(ana, map[string]any{"name": "Informe " + n, "assigneeKind": "person", "assigneeId": pedro, "clientId": org,
		"reportKind": "incident", "recurrence": map[string]any{"kind": "once", "date": "2026-10-16"}}); code != 201 {
		t.Fatalf("tarea con informe: %d %s", code, body)
	}
	h.lastGen = time.Time{}
	_ = h.generate(ctx, true)
	agendaCloseByReport(ctx, q, nil, h.AuditLog, "incident", org, pgtype.UUID{}, ana, "Incidente X", now)
	var status string
	if err := tx.QueryRow(ctx, `SELECT o.status FROM agenda_occurrences o JOIN agenda_tasks t ON t.id = o.task_id WHERE t.name = $1`, "Informe "+n).Scan(&status); err != nil || status != "done" {
		t.Fatalf("el informe no cerró la tarea: %v %s", err, status)
	}

	// Feriados: el admin importa 2026 y la tarea de los miércoles salta el que caiga.
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	r := httptest.NewRequest("POST", "/api/agenda/holidays/import", strings.NewReader(`{"year":2026}`)).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Role: "admin"}))
	rw := httptest.NewRecorder()
	h.ImportHolidays(rw, r)
	if rw.Code != 200 || !strings.Contains(rw.Body.String(), "Iglesias Evangélicas") {
		t.Fatalf("importar feriados: %d %s", rw.Code, rw.Body)
	}
	w = call(ana, h.Preview, "POST", "/x", map[string]any{"kind": "fixed", "day": 25, "shift": "prev"}, "")
	if !strings.Contains(w.Body.String(), `"date":"2026-12-24","movedFrom":"2026-12-25","reason":"Navidad"`) {
		t.Fatalf("vista previa con feriados: %s", w.Body)
	}
}
