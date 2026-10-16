//go:build integration

// Segunda etapa de áreas (9.7) contra la base real, dentro de una transacción
// que se deshace: flujos entre áreas, calendario en Outlook, resumen mensual
// y ventanas que se repiten.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestSegundaEtapa
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

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type segundaEtapaEnv struct {
	t      *testing.T
	ctx    context.Context
	tx     pgx.Tx
	q      *db.Queries
	n      string
	infra  uuid.UUID
	ti     uuid.UUID
	jefa   uuid.UUID // jefatura de Infraestructura
	ana    uuid.UUID // Infra N1
	pedro  uuid.UUID // TI N2
	sofia  uuid.UUID // TI N1
	logger *audit.Logger
}

const segN1, segN2, segN3 = "a0000000-0000-4000-8000-000000000101", "a0000000-0000-4000-8000-000000000102", "a0000000-0000-4000-8000-000000000103"

func newSegundaEtapaEnv(t *testing.T) *segundaEtapaEnv {
	dsn := os.Getenv("BITACORA_TEST_DSN")
	if dsn == "" {
		t.Skip("BITACORA_TEST_DSN no definido")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	e := &segundaEtapaEnv{t: t, ctx: ctx, tx: tx, q: db.New(tx), n: fmt.Sprintf("s%d", time.Now().UnixNano()),
		logger: audit.NewLogger(&recordedAudit{}, slog.Default())}
	e.infra = e.id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "inf"+e.n)
	e.ti = e.id(`INSERT INTO areas (code, name) VALUES ($1, 'TI '||$1) RETURNING id`, "ti"+e.n)
	e.jefa = e.person(e.infra, segN3, []string{CapAreaLead})
	e.ana = e.person(e.infra, segN1, nil)
	e.pedro = e.person(e.ti, segN2, nil)
	e.sofia = e.person(e.ti, segN1, nil)
	if _, err := tx.Exec(ctx, `DELETE FROM holidays; UPDATE agenda_tasks SET active = false; UPDATE agenda_flows SET active = false;
		UPDATE maintenance_window_series SET active = false;
		UPDATE agenda_settings SET work_days = '{1,2,3,4,5}', day_start = '08:00', day_end = '20:00', timezone = 'America/Santiago'`); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e *segundaEtapaEnv) id(sql string, args ...any) uuid.UUID {
	e.t.Helper()
	var out uuid.UUID
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(&out); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
	return out
}

func (e *segundaEtapaEnv) person(area uuid.UUID, level string, caps []string) uuid.UUID {
	if caps == nil {
		caps = []string{}
	}
	g := e.id(`INSERT INTO permission_groups (code, name, capabilities, profile, level_id) VALUES ($1, $1, $2, 'resolutor', $3) RETURNING id`, "g"+uuid.NewString()[:8]+e.n, caps, level)
	e.id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
	u := e.id(`INSERT INTO users (username, email, full_name, password_hash) VALUES ($1, $1 || '@test.local', $1, 'x') RETURNING id`, "u"+uuid.NewString()[:8]+e.n)
	e.id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
	return u
}

func (e *segundaEtapaEnv) call(user uuid.UUID, role string, fn func(http.ResponseWriter, *http.Request), method, path string, body any, values map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(method, path, &buf).WithContext(middleware.WithUser(e.ctx, middleware.AuthenticatedUser{ID: user, Username: "x", Role: role}))
	for k, v := range values {
		r.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	fn(w, r)
	return w
}

func TestSegundaEtapa_Flujos(t *testing.T) {
	e := newSegundaEtapaEnv(t)
	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, loc) // miércoles
	h := &AgendaHandler{Queries: e.q, AuditLog: e.logger, Now: func() time.Time { return now }}
	mine := func(user uuid.UUID) []agendaOccDTO {
		t.Helper()
		h.lastGen = time.Time{}
		w := e.call(user, "user", h.Mine, "GET", "/api/agenda/mine", nil, nil)
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
	name := "Sucursal " + e.n
	flow := map[string]any{"name": name, "recurrence": map[string]any{"kind": "once", "date": "2026-10-14"}, "steps": []map[string]any{
		{"name": "Rack " + e.n, "areaId": e.infra, "assigneeKind": "person", "assigneeId": e.ana},
		{"name": "Red " + e.n, "areaId": e.ti, "assigneeKind": "person", "assigneeId": e.pedro, "after": true, "days": 2},
		{"name": "Monitoreo " + e.n, "areaId": e.ti, "assigneeKind": "level", "assigneeId": segN1, "after": false, "days": 3},
	}}
	// Ana (N1 de Infra) no arma un flujo con pasos de TI: no asigna en otras áreas.
	if w := e.call(e.ana, "user", h.CreateFlow, "POST", "/api/agenda/flows", flow, nil); w.Code != 403 {
		t.Fatalf("N1 arma flujo entre áreas: %d %s", w.Code, w.Body)
	}
	// La jefatura sí (asigna hacia otras áreas).
	w := e.call(e.jefa, "user", h.CreateFlow, "POST", "/api/agenda/flows", flow, nil)
	if w.Code != 201 {
		t.Fatalf("crear flujo: %d %s", w.Code, w.Body)
	}
	// Pedro ve su paso en espera, con a qué espera; Sofía (TI N1) ve el paso en paralelo.
	p := find(mine(e.pedro), "Red "+e.n)
	if p == nil || p.Status != "waiting" || p.Flow == nil || p.Flow.WaitingFor != "Rack "+e.n || p.CanAct || p.CanReopen {
		t.Fatalf("paso en espera de Pedro: %+v", p)
	}
	s := find(mine(e.sofia), "Monitoreo "+e.n)
	if s == nil || s.Status != "pending" || s.DueDate != "2026-10-19" || !s.CanTake {
		t.Fatalf("paso en paralelo: %+v", s)
	}
	// El paso no se edita como tarea suelta.
	if w := e.call(e.jefa, "user", h.UpdateTask, "PUT", "/x", map[string]any{}, map[string]string{"id": p.Task.ID.String()}); w.Code != 409 {
		t.Fatalf("editar paso como tarea: %d %s", w.Code, w.Body)
	}
	// Ana termina el rack el jueves: el paso de Pedro vence 2 días hábiles después (lunes 19).
	now = time.Date(2026, 10, 15, 10, 0, 0, 0, loc)
	a := find(mine(e.ana), "Rack "+e.n)
	if a == nil {
		t.Fatal("Ana no ve su paso")
	}
	if w := e.call(e.ana, "user", h.Done, "POST", "/x", map[string]string{}, map[string]string{"id": a.ID.String()}); w.Code != 200 {
		t.Fatalf("hecho: %d %s", w.Code, w.Body)
	}
	p = find(mine(e.pedro), "Red "+e.n)
	if p == nil || p.Status != "pending" || p.DueDate != "2026-10-19" || !p.CanAct {
		t.Fatalf("el paso de Pedro no empezó: %+v", p)
	}
	// Gestión de flujos: 1 de 3 hechos, a tiempo.
	w = e.call(e.jefa, "user", h.Flows, "GET", "/api/agenda/flows", nil, nil)
	var flows struct{ Data []flowDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &flows)
	var got *flowDTO
	for i := range flows.Data {
		if flows.Data[i].Name == name {
			got = &flows.Data[i]
		}
	}
	if got == nil || got.Run == nil || got.Run.Done != 1 || got.State != "ok" || len(got.Steps) != 3 || !got.CanEdit {
		t.Fatalf("flujos: %s", w.Body)
	}
	// Editar: el flujo en curso (fecha pasada) se puede cambiar.
	flow["steps"].([]map[string]any)[2]["days"] = 4
	if w := e.call(e.jefa, "user", h.UpdateFlow, "PUT", "/x", flow, map[string]string{"id": got.ID.String()}); w.Code != 204 {
		t.Fatalf("editar flujo en curso: %d %s", w.Code, w.Body)
	}
	// Borrar: deja de aparecer.
	if w := e.call(e.jefa, "user", h.DeleteFlow, "DELETE", "/x", nil, map[string]string{"id": got.ID.String()}); w.Code != 204 {
		t.Fatalf("borrar flujo: %d %s", w.Code, w.Body)
	}
	w = e.call(e.jefa, "user", h.Flows, "GET", "/api/agenda/flows", nil, nil)
	if strings.Contains(w.Body.String(), name) {
		t.Fatalf("el flujo borrado sigue: %s", w.Body)
	}
}

func TestSegundaEtapa_FlujoQueSeRepite(t *testing.T) {
	e := newSegundaEtapaEnv(t)
	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, loc)
	h := &AgendaHandler{Queries: e.q, AuditLog: e.logger, Now: func() time.Time { return now }}
	flow := map[string]any{"name": "Informe " + e.n, "recurrence": map[string]any{"kind": "bizN", "n": 1}, "steps": []map[string]any{
		{"name": "Datos " + e.n, "areaId": e.infra, "assigneeKind": "person", "assigneeId": e.ana},
		{"name": "Arma " + e.n, "areaId": e.ti, "assigneeKind": "person", "assigneeId": e.pedro, "after": true, "days": 1},
	}}
	if w := e.call(e.jefa, "user", h.CreateFlow, "POST", "/api/agenda/flows", flow, nil); w.Code != 201 {
		t.Fatalf("crear flujo mensual: %d %s", w.Code, w.Body)
	}
	var runs int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM agenda_flow_runs r JOIN agenda_flows f ON f.id = r.flow_id WHERE f.name = $1`, "Informe "+e.n).Scan(&runs); err != nil || runs != 3 {
		t.Fatalf("vueltas generadas en 92 días (nov, dic, ene): %d %v", runs, err)
	}
}

func TestSegundaEtapa_CalendarioYResumen(t *testing.T) {
	e := newSegundaEtapaEnv(t)
	key := make([]byte, 32)
	box, err := crypto.New(key)
	if err != nil {
		t.Fatal(err)
	}
	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, loc)
	ah := &AgendaHandler{Queries: e.q, AuditLog: e.logger, Now: func() time.Time { return now }}
	if w := e.call(e.jefa, "user", ah.CreateTask, "POST", "/api/agenda/tasks", map[string]any{"name": "Respaldo " + e.n, "areaId": e.infra,
		"assigneeKind": "person", "assigneeId": e.ana, "recurrence": map[string]any{"kind": "once", "date": "2026-10-16"}}, nil); w.Code != 201 {
		t.Fatalf("tarea: %d %s", w.Code, w.Body)
	}
	ch := &CalendarFeedHandler{Queries: e.q, Crypto: box, AuditLog: e.logger, PublicBaseURL: "https://bitacora.test", Now: func() time.Time { return now }}
	// Apagado: no responde.
	if _, err := e.tx.Exec(e.ctx, `UPDATE system_features SET is_enabled = false WHERE code = 'calendar_feed'`); err != nil {
		t.Fatal(err)
	}
	if w := e.call(e.ana, "user", ch.Create, "POST", "/x", nil, nil); w.Code != 403 {
		t.Fatalf("apagado: %d", w.Code)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE system_features SET is_enabled = true WHERE code = 'calendar_feed'`); err != nil {
		t.Fatal(err)
	}
	w := e.call(e.ana, "user", ch.Create, "POST", "/x", nil, nil)
	var feed struct{ Data calendarFeedDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &feed)
	if w.Code != 200 || !strings.HasPrefix(feed.Data.URL, "https://bitacora.test/cal/") {
		t.Fatalf("crear enlace: %d %s", w.Code, w.Body)
	}
	file := strings.TrimPrefix(feed.Data.URL, "https://bitacora.test/cal/")
	r := httptest.NewRequest("GET", "/cal/"+file, nil)
	r.SetPathValue("file", file)
	rw := httptest.NewRecorder()
	ch.Feed(rw, r)
	if rw.Code != 200 || !strings.Contains(rw.Body.String(), "SUMMARY:Respaldo "+e.n) || !strings.Contains(rw.Body.String(), "DTSTART;VALUE=DATE:20261016") {
		t.Fatalf("ics: %d %s", rw.Code, rw.Body)
	}
	// Un enlace nuevo deja inútil el anterior.
	e.call(e.ana, "user", ch.Create, "POST", "/x", nil, nil)
	rw = httptest.NewRecorder()
	ch.Feed(rw, r)
	if rw.Code != 404 {
		t.Fatalf("el enlace anterior sigue respondiendo: %d", rw.Code)
	}

	// Resumen mensual: la jefatura de Infra ve su área; la de TI no es suya.
	th := &TeamHandler{Queries: e.q, AuditLog: e.logger, Now: func() time.Time { return now }}
	var code string
	if err := e.tx.QueryRow(e.ctx, `SELECT code FROM areas WHERE id = $1`, e.infra).Scan(&code); err != nil {
		t.Fatal(err)
	}
	var tiCode string
	_ = e.tx.QueryRow(e.ctx, `SELECT code FROM areas WHERE id = $1`, e.ti).Scan(&tiCode)
	if w := e.call(e.jefa, "user", th.Monthly, "GET", "/api/team/monthly?area="+tiCode+"&month=2026-10", nil, nil); w.Code != 403 {
		t.Fatalf("resumen de otra área: %d", w.Code)
	}
	if w := e.call(e.jefa, "user", th.Monthly, "GET", "/api/team/monthly?area="+code+"&month=2026-11", nil, nil); w.Code != 400 {
		t.Fatalf("mes futuro: %d", w.Code)
	}
	w = e.call(e.jefa, "user", th.Monthly, "GET", "/api/team/monthly?area="+code+"&month=2026-10", nil, nil)
	var sum struct {
		Data struct {
			Summary monthlyDataDTO
			Frozen  bool
		}
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sum)
	if w.Code != 200 || sum.Data.Frozen || sum.Data.Summary.Total.Tasks != 1 || len(sum.Data.Summary.People) != 2 {
		t.Fatalf("resumen de octubre: %d %s", w.Code, w.Body)
	}
	// Septiembre ya se congeló (1 de octubre hábil, 08:00): queda la foto.
	e.call(e.jefa, "user", th.Monthly, "GET", "/api/team/monthly?area="+code+"&month=2026-09", nil, nil)
	var n int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM monthly_summaries WHERE area_id = $1 AND month = '2026-09-01'`, e.infra).Scan(&n); err != nil || n != 1 {
		t.Fatalf("foto de septiembre: %d %v", n, err)
	}
}

func TestSegundaEtapa_VentanasQueSeRepiten(t *testing.T) {
	e := newSegundaEtapaEnv(t)
	h := &EscalationHandler{Queries: e.q, AuditLog: e.logger}
	loc, _ := time.LoadLocation("America/Santiago")
	// Un feriado en el segundo domingo que viene.
	today := agenda.Day(time.Now(), loc)
	sunday := today.AddDate(0, 0, (7-int(today.Weekday()))%7+7)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO holidays (day, name) VALUES ($1, 'Feriado de prueba')`, sunday); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"areaId": e.infra, "title": "Respaldo " + e.n, "suppressNotifications": true, "validFrom": agenda.FormatDate(today),
		"rule": map[string]any{"kind": "weekly", "weekdays": []int{0}, "start": "02:00", "end": "04:00"}}
	w := e.call(e.ana, "user", h.CreateSeries, "POST", "/x", body, nil)
	if w.Code != 201 {
		t.Fatalf("crear serie: %d %s", w.Code, w.Body)
	}
	var created struct{ Data struct{ ID uuid.UUID } }
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	var total, inactive int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*), count(*) FILTER (WHERE NOT active AND holiday_name IS NOT NULL) FROM maintenance_windows WHERE series_id = $1`, created.Data.ID).Scan(&total, &inactive); err != nil {
		t.Fatal(err)
	}
	if total < 8 || inactive != 1 {
		t.Fatalf("ventanas generadas: %d, en feriado sin aplicar: %d", total, inactive)
	}
	var holidayWin, normalWin uuid.UUID
	_ = e.tx.QueryRow(e.ctx, `SELECT id FROM maintenance_windows WHERE series_id = $1 AND holiday_name IS NOT NULL`, created.Data.ID).Scan(&holidayWin)
	_ = e.tx.QueryRow(e.ctx, `SELECT id FROM maintenance_windows WHERE series_id = $1 AND holiday_name IS NULL ORDER BY starts_at DESC LIMIT 1`, created.Data.ID).Scan(&normalWin)
	// En feriado la aplica la jefatura, no cualquiera.
	if w := e.call(e.ana, "user", h.SetSeriesWindow, "POST", "/x", nil, map[string]string{"id": holidayWin.String(), "action": "approve"}); w.Code != 403 {
		t.Fatalf("aplicar en feriado sin ser jefatura: %d %s", w.Code, w.Body)
	}
	if w := e.call(e.jefa, "user", h.SetSeriesWindow, "POST", "/x", nil, map[string]string{"id": holidayWin.String(), "action": "approve"}); w.Code != 200 || !strings.Contains(w.Body.String(), `"active":true`) {
		t.Fatalf("aplicar en feriado: %d %s", w.Code, w.Body)
	}
	// Saltar una vez y volver a aplicarla.
	if w := e.call(e.ana, "user", h.SetSeriesWindow, "POST", "/x", nil, map[string]string{"id": normalWin.String(), "action": "skip"}); w.Code != 200 || !strings.Contains(w.Body.String(), `"active":false`) {
		t.Fatalf("saltar: %d %s", w.Code, w.Body)
	}
	if w := e.call(e.ana, "user", h.SetSeriesWindow, "POST", "/x", nil, map[string]string{"id": normalWin.String(), "action": "approve"}); w.Code != 409 {
		t.Fatalf("aprobar una que no es feriado: %d", w.Code)
	}
	// Listado con próximas.
	w = e.call(e.ana, "user", h.ListSeries, "GET", "/x", nil, nil)
	if !strings.Contains(w.Body.String(), "Respaldo "+e.n) || !strings.Contains(w.Body.String(), "Feriado de prueba") {
		t.Fatalf("listado: %s", w.Body)
	}
	// Borrar: se van las que no empezaron, menos la aprobada en feriado.
	if w := e.call(e.ana, "user", h.DeleteSeries, "DELETE", "/x", nil, map[string]string{"id": created.Data.ID.String()}); w.Code != 204 {
		t.Fatalf("borrar: %d %s", w.Code, w.Body)
	}
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM maintenance_windows WHERE series_id = $1 AND starts_at > now()`, created.Data.ID).Scan(&total); err != nil || total != 1 {
		t.Fatalf("quedan %d (debía quedar solo la aprobada) %v", total, err)
	}
}
