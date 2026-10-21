//go:build integration

// Gestión CSM (9.4) contra la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestManagement
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestManagement_SaludMetasYPlantillas(t *testing.T) {
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
	n := fmt.Sprintf("m%d", time.Now().UnixNano())
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
	csmArea := id(`INSERT INTO areas (code, name, default_profile) VALUES ($1, 'CSM '||$1, 'gestion') RETURNING id`, "csm"+n)
	user := func(name string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', initcap($2), 'x', 'user') RETURNING id`, name+n, name)
	}
	group := func(code, profile string, area uuid.UUID, level string, caps []string, users ...uuid.UUID) {
		g := id(`INSERT INTO permission_groups (code, name, profile, capabilities, level_id) VALUES ($1, $1, $2, $3, (SELECT id FROM levels WHERE code = NULLIF($4, ''))) RETURNING id`,
			code+n, profile, caps, level)
		exec(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2)`, g, area)
		for _, u := range users {
			exec(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2)`, u, g)
		}
	}
	lucia, tomas, jefa, camila, diego := user("lucia"), user("tomas"), user("jefa"), user("camila"), user("diego")
	group("csm", "gestion", csmArea, "", []string{}, lucia, tomas)
	group("socjefa", "operativo", soc, "n3", []string{CapAreaLead}, jefa)
	group("socn2", "operativo", soc, "n2", []string{}, camila, diego)
	casinos := id(`INSERT INTO organizations (name, code) VALUES ('Casinos '||$1, 'cas'||$1) RETURNING id`, n)
	netics := id(`INSERT INTO organizations (name, code) VALUES ('Netics '||$1, 'net'||$1) RETURNING id`, n)
	// La Gestión se usa desde hace 90 días (si no, todos quedarían con la línea base de hoy).
	exec(`UPDATE management_settings SET started_on = CURRENT_DATE - 90`)

	rec := &recordedAudit{}
	auditLog := audit.NewLogger(rec, slog.Default())
	ag := &AgendaHandler{Queries: q, AuditLog: auditLog}
	h := &ManagementHandler{Queries: q, Pool: tx, AuditLog: auditLog, Agenda: ag}
	as := func(u uuid.UUID) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: u, Username: "u", Role: "user"})
	}
	call := func(fn http.HandlerFunc, who uuid.UUID, method, path string, body any, vals ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(as(who))
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
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("respuesta: %s", w.Body)
		}
		if err := json.Unmarshal(env.Data, out); err != nil {
			t.Fatalf("datos: %s", env.Data)
		}
	}
	clientOf := func(who uuid.UUID, cid uuid.UUID) mgmtClientDTO {
		t.Helper()
		w := call(h.Clients, who, "GET", "/api/management/clients", nil)
		if w.Code != 200 {
			t.Fatalf("cartera: %d %s", w.Code, w.Body)
		}
		var list []mgmtClientDTO
		decode(w, &list)
		for _, c := range list {
			if c.ID == cid {
				return c
			}
		}
		t.Fatalf("cliente %s no está en la cartera", cid)
		return mgmtClientDTO{}
	}

	// Quién ve Gestión: el perfil Gestión y la jefatura sí; una analista, no.
	if w := call(h.Clients, camila, "GET", "/api/management/clients", nil); w.Code != http.StatusForbidden {
		t.Fatalf("una analista no ve Gestión: %d", w.Code)
	}
	if w := call(h.Clients, jefa, "GET", "/api/management/clients", nil); w.Code != 200 {
		t.Fatalf("la jefatura ve Gestión: %d", w.Code)
	}

	// Cartera: CSM a cargo y renovación.
	renewal := time.Now().AddDate(0, 0, 70).Format("2006-01-02")
	if w := call(h.UpdateClient, lucia, "PUT", "/", map[string]any{"csmUserId": lucia, "renewal": renewal}, "id", casinos.String()); w.Code != 204 {
		t.Fatalf("cartera: %d %s", w.Code, w.Body)
	}
	c := clientOf(lucia, casinos)
	if !c.Mine || c.RenewalDays == nil || *c.RenewalDays != 70 {
		t.Fatalf("Mis cuentas y renovación: %+v", c)
	}
	// Sin reunión desde que se usa la Gestión (90 días): rojo por falta de contacto.
	if c.Health.State != "red" || c.Health.Reasons[0].Code != "noContact" {
		t.Fatalf("sin contacto: %+v", c.Health)
	}

	// Una acción de la CSM (Reunión) hecha hoy: la cuenta queda verde.
	today := time.Now().Format("2006-01-02")
	w := call(ag.CreateTask, lucia, "POST", "/api/agenda/tasks", map[string]any{"name": "Comité mensual de servicio", "areaId": csmArea, "clientId": casinos,
		"assigneeKind": "person", "assigneeId": lucia, "recurrence": map[string]any{"kind": "once", "date": today}, "actionKind": "committee"})
	if w.Code != 201 {
		t.Fatalf("acción: %d %s", w.Code, w.Body)
	}
	var task agendaTaskDTO
	decode(w, &task)
	if task.ActionKind == nil || *task.ActionKind != "committee" {
		t.Fatalf("la acción guarda su tipo: %+v", task)
	}
	exec(`UPDATE agenda_occurrences SET status = 'done', closed_at = now(), closed_by = $2 WHERE task_id = $1`, task.ID, lucia)
	if c := clientOf(lucia, casinos); c.Health.State != "green" || c.Health.Contact.ContactDays != 0 {
		t.Fatalf("con un comité hoy: %+v", c.Health)
	}

	// Un ticket abierto fuera de SLA en cualquier área: rojo, con el número.
	tk := id(`INSERT INTO tickets (ticket_number, client_id, title, description, sla_resolution_due_at, area_id, requested_area_id)
		VALUES ('TKT-'||$1, $2, 'Alerta de fuerza bruta en VPN', 'x', now() - interval '2 hours', $3, $3) RETURNING id`, n, casinos, soc)
	if c := clientOf(lucia, casinos); c.Health.State != "red" || c.Health.Reasons[0].Code != "ticketBreached" || c.Health.Reasons[0].Ticket != "TKT-"+n {
		t.Fatalf("ticket fuera de SLA: %+v", c.Health)
	}

	// Acción de seguimiento del ticket, clave, para el SOC N2, atrasada: además amarillo por la tarea clave.
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	exec(`INSERT INTO agenda_tasks (name, area_id, organization_id, assignee_kind, assignee_level_id, recurrence, action_kind, is_key, ticket_id, created_by)
		VALUES ('Avisar la ventana del sábado', $1, $2, 'level', (SELECT id FROM levels WHERE code = 'n2'), jsonb_build_object('kind', 'once', 'date', $3::text), 'contact', true, $4, $5)`,
		soc, casinos, yesterday, tk, lucia)
	exec(`INSERT INTO agenda_occurrences (task_id, due_date, offered_level_id) SELECT id, $2::date, assignee_level_id FROM agenda_tasks WHERE name = 'Avisar la ventana del sábado' AND organization_id = $1`, casinos, yesterday)
	c = clientOf(lucia, casinos)
	if len(c.Health.Reasons) != 2 || c.Health.Reasons[1].Code != "keyLate" || c.LateActions != 1 {
		t.Fatalf("tarea clave atrasada: %+v", c.Health)
	}
	w = call(h.TicketActions, lucia, "GET", "/", nil, "id", tk.String())
	var tkActions []mgmtTicketActionDTO
	decode(w, &tkActions)
	if len(tkActions) != 1 || !tkActions[0].Late || !tkActions[0].Key {
		t.Fatalf("acciones del ticket: %s", w.Body)
	}

	// Ficha del cliente.
	w = call(h.Client, lucia, "GET", "/", nil, "id", casinos.String())
	var detail mgmtClientDetailDTO
	decode(w, &detail)
	if len(detail.Tickets) != 1 || detail.Tickets[0].Resolution == nil || detail.Tickets[0].Resolution.State != "breached" || len(detail.Actions) != 1 || len(detail.Timeline) == 0 {
		t.Fatalf("ficha: %s", w.Body)
	}

	// Meta del cliente con un hito enlazado al ticket: se marca sola al resolverlo y la meta se cumple.
	due := time.Now().AddDate(0, 2, 0).Format("2006-01-02")
	w = call(h.CreateGoal, lucia, "POST", "/api/goals", map[string]any{"name": "Migrar el monitoreo al SIEM nuevo", "scope": "client", "clientId": casinos,
		"areaId": soc, "dueDate": due, "steps": []string{"Inventario de fuentes de log"}})
	if w.Code != 201 {
		t.Fatalf("meta: %d %s", w.Code, w.Body)
	}
	var goal goalDTO
	decode(w, &goal)
	gid := goal.ID.String()
	w = call(h.AddMilestone, lucia, "POST", "/", map[string]any{"name": "Conectores instalados", "ticketId": tk}, "id", gid)
	decode(w, &goal)
	if goal.Milestones != 2 || goal.State != "open" {
		t.Fatalf("hito enlazado: %+v", goal)
	}
	var manual, linked goalMilestoneDTO
	for _, s := range goal.Steps {
		if s.TicketID != nil {
			linked = s
		} else {
			manual = s
		}
	}
	if w := call(h.MarkMilestone, lucia, "POST", "/", map[string]bool{"done": true}, "id", gid, "mid", linked.ID.String()); w.Code != http.StatusConflict {
		t.Fatalf("un hito enlazado no se marca a mano: %d", w.Code)
	}
	call(h.MarkMilestone, lucia, "POST", "/", map[string]bool{"done": true}, "id", gid, "mid", manual.ID.String())
	exec(`UPDATE tickets SET status = 'resolved', resolved_at = now(), assigned_user_id = $2 WHERE id = $1`, tk, camila)
	w = call(h.Goal, lucia, "GET", "/", nil, "id", gid)
	decode(w, &goal)
	if goal.State != "done" || goal.MilestonesDone != 2 || !strings.Contains(w.Body.String(), "cumplido por TKT-"+n+" (Camila)") {
		t.Fatalf("el hito se marca solo con el ticket: %s", w.Body)
	}
	// Se reabre el ticket: el hito se desmarca y la meta vuelve a estar en curso.
	exec(`UPDATE tickets SET status = 'in_progress', resolved_at = NULL WHERE id = $1`, tk)
	w = call(h.Goal, lucia, "GET", "/", nil, "id", gid)
	decode(w, &goal)
	if goal.State != "open" || goal.MilestonesDone != 1 || !strings.Contains(w.Body.String(), "se reabrió") {
		t.Fatalf("el ticket se reabrió: %s", w.Body)
	}

	// Meta de una persona para el bono: la crea su jefatura (no la CSM), pide el certificado y la confirma la jefatura.
	if w := call(h.CreateGoal, lucia, "POST", "/api/goals", map[string]any{"name": "Security+", "scope": "person", "personId": camila, "kind": "certification",
		"bonus": "primary", "dueDate": due}); w.Code != http.StatusForbidden {
		t.Fatalf("la CSM no le pone metas a una persona de otra área: %d", w.Code)
	}
	w = call(h.CreateGoal, jefa, "POST", "/api/goals", map[string]any{"name": "Certificación CompTIA Security+", "scope": "person", "personId": camila,
		"kind": "certification", "bonus": "primary", "estimateBizDays": 40, "evidenceRequired": true, "steps": []string{"Inscripción", "Examen aprobado"}})
	if w.Code != 201 {
		t.Fatalf("meta de una persona: %d %s", w.Code, w.Body)
	}
	var cert goalDTO
	decode(w, &cert)
	cid := cert.ID.String()
	// La ven la persona y su jefatura; la CSM y otra persona del área, no.
	for who, want := range map[uuid.UUID]int{camila: 200, jefa: 200, lucia: 404, diego: 404} {
		if w := call(h.Goal, who, "GET", "/", nil, "id", cid); w.Code != want {
			t.Fatalf("ver la meta de Camila (%s): %d, quiero %d", who, w.Code, want)
		}
	}
	w = call(h.Goals, camila, "GET", "/api/goals?mine=1", nil)
	if !strings.Contains(w.Body.String(), "Security+") {
		t.Fatalf("Mis metas: %s", w.Body)
	}
	for _, s := range cert.Steps {
		call(h.MarkMilestone, camila, "POST", "/", map[string]bool{"done": true}, "id", cid, "mid", s.ID.String())
	}
	if w := call(h.GoalAction, camila, "POST", "/", nil, "id", cid, "action", "complete"); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "evidence-missing") {
		t.Fatalf("sin certificado no se cumple: %d %s", w.Code, w.Body)
	}
	w = call(h.AddEvidence, camila, "POST", "/", map[string]string{"url": "https://verify.comptia.org/abc"}, "id", cid)
	decode(w, &cert)
	if cert.State != "confirm" || cert.CanConfirm {
		t.Fatalf("con hitos y certificado espera a la jefatura: %+v", cert)
	}
	if w := call(h.GoalAction, camila, "POST", "/", nil, "id", cid, "action", "confirm"); w.Code != http.StatusForbidden {
		t.Fatalf("la persona no se confirma a sí misma: %d", w.Code)
	}
	w = call(h.GoalAction, jefa, "POST", "/", nil, "id", cid, "action", "confirm")
	decode(w, &cert)
	if cert.State != "done" || cert.ConfirmedByName == "" {
		t.Fatalf("confirmada: %+v", cert)
	}
	found := false
	for _, e := range rec.events {
		found = found || e == "goal.bonus.confirmed"
	}
	if !found {
		t.Fatal("la confirmación del bono queda en Auditoría")
	}

	// Plantillas: la de renovación crea 3 acciones para la CSM a cargo; no se aplica dos veces.
	renewalPB := "b0000000-0000-4000-8000-000000000003"
	w = call(h.ApplyPlaybook, tomas, "POST", "/", map[string]any{"clientId": casinos}, "id", renewalPB)
	if w.Code != 201 {
		t.Fatalf("aplicar renovación: %d %s", w.Code, w.Body)
	}
	var tasks []struct {
		Name, Who string
		Due       time.Time
	}
	rows, err := tx.Query(ctx, `SELECT k.name, COALESCE(u.full_name, ''), o.due_date FROM agenda_tasks k JOIN agenda_occurrences o ON o.task_id = k.id
		LEFT JOIN users u ON u.id = k.assignee_user_id WHERE k.organization_id = $1 AND k.playbook_application_id IS NOT NULL ORDER BY o.due_date`, casinos)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var x struct {
			Name, Who string
			Due       time.Time
		}
		_ = rows.Scan(&x.Name, &x.Who, &x.Due)
		tasks = append(tasks, x)
	}
	rows.Close()
	if len(tasks) != 3 || tasks[0].Who != "Lucia" || tasks[2].Name != "Reunión con gerencia" {
		t.Fatalf("tareas de la renovación: %+v", tasks)
	}
	// 90 días antes ya pasó (faltan 70): queda para hoy o el próximo hábil.
	if tasks[0].Due.Before(time.Now().AddDate(0, 0, -1)) {
		t.Fatalf("lo que ya pasó queda para hoy: %+v", tasks[0])
	}
	if w := call(h.ApplyPlaybook, tomas, "POST", "/", map[string]any{"clientId": casinos}, "id", renewalPB); w.Code != http.StatusConflict {
		t.Fatalf("la misma plantilla no se aplica dos veces: %d", w.Code)
	}
	w = call(h.Client, lucia, "GET", "/", nil, "id", casinos.String())
	decode(w, &detail)
	if len(detail.Renewal) != 3 || detail.Applied["renewal"] == "" {
		t.Fatalf("pasos de la renovación en la ficha: %+v %+v", detail.Renewal, detail.Applied)
	}
	// Sin fecha de renovación, no se aplica.
	if w := call(h.ApplyPlaybook, tomas, "POST", "/", map[string]any{"clientId": netics}, "id", renewalPB); w.Code != http.StatusConflict {
		t.Fatalf("sin fecha de renovación: %d", w.Code)
	}
	// La revisión trimestral: las del SOC N2 van a su nivel.
	meeting := agenda.FormatDate(time.Now().AddDate(0, 1, 0))
	if w := call(h.ApplyPlaybook, lucia, "POST", "/", map[string]any{"clientId": netics, "anchorDate": meeting}, "id", "b0000000-0000-4000-8000-000000000002"); w.Code != 201 {
		t.Fatalf("revisión trimestral: %d %s", w.Code, w.Body)
	}
	var socN2 int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM agenda_tasks WHERE organization_id = $1 AND assignee_kind = 'level' AND area_id = $2`, netics, soc).Scan(&socN2)
	if socN2 != 1 {
		t.Fatalf("la acción del SOC N2 va a su nivel: %d", socN2)
	}

	// Indicadores y resumen.
	exec(`UPDATE tickets SET status = 'resolved', resolved_at = now(), first_responded_at = created_at + interval '9 minutes' WHERE id = $1`, tk)
	w = call(h.Indicators, lucia, "GET", "/api/management/indicators?by=client&period=month", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"trend"`) {
		t.Fatalf("indicadores: %d %s", w.Code, w.Body)
	}
	w = call(h.Summary, lucia, "GET", "/?period=month", nil, "id", casinos.String())
	var sum mgmtSummaryDTO
	decode(w, &sum)
	if sum.SLAPct != 0 || len(sum.Incidents) != 1 || sum.Incidents[0].P3 != 1 || len(sum.Goals) == 0 {
		t.Fatalf("resumen: %s", w.Body)
	}
	if html, _, err := (&ManagementHandler{Notify: &Notifier{Queries: q}}).summaryMail(ctx, sum); err != nil || !strings.Contains(html, "RESUMEN DE SERVICIO") {
		t.Fatalf("correo del resumen: %v", err)
	}
	// Las jefaturas ven los indicadores de su área.
	w = call(h.Indicators, jefa, "GET", "/api/management/indicators?by=area&period=month", nil)
	var ind struct{ Rows []mgmtIndicatorRowDTO }
	decode(w, &ind)
	if len(ind.Rows) != 1 || ind.Rows[0].ID != soc {
		t.Fatalf("la jefatura del SOC ve su área: %s", w.Body)
	}
}
