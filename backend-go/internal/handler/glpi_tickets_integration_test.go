//go:build integration

// Tickets de GLPI en la Ticketera (10d.1, spec/18) contra la base real y un
// GLPI falso, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestGlpiTickets
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi/glpitest"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGlpiTickets_TraeSoloLoElegidoYEsSoloLectura(t *testing.T) {
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
	n := fmt.Sprintf("t%d", time.Now().UnixNano())
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
	infra := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "infra"+n)
	casinos := id(`INSERT INTO organizations (name, code) VALUES ('Casinos '||$1, 'cas'||$1) RETURNING id`, n)
	netics := id(`INSERT INTO organizations (name, code) VALUES ('Netics '||$1, 'net'||$1) RETURNING id`, n)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	diego := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'user') RETURNING id`, "diego"+n)
	analyst := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'user') RETURNING id`, "ana"+n)
	exec(`UPDATE system_features SET is_enabled = true WHERE code IN ('glpi_sync', 'native_tickets')`)
	// Un número de GLPI escrito a mano en una entrada de la Bitácora.
	exec(`INSERT INTO entries (user_id, entry_type, content, glpi_ticket_id) VALUES ($1, 'operativa', 'Revisión con Contabilidad', '48177')`, analyst)

	fake := glpitest.New("app-tok", "user-tok")
	defer fake.Close()
	fake.Set("Entity",
		map[string]any{"id": 0, "completename": "Raíz", "entities_id": -1},
		map[string]any{"id": 3, "completename": "Raíz &#62; Casinos", "entities_id": 0},
		map[string]any{"id": 7, "completename": "Raíz &#62; Casinos &#62; Calama", "entities_id": 3},
		map[string]any{"id": 5, "completename": "Raíz &#62; Contabilidad", "entities_id": 0})
	fake.Set("Group",
		map[string]any{"id": 10, "completename": "Redes y comunicaciones", "is_assign": 1},
		map[string]any{"id": 11, "completename": "Mesa Contabilidad", "is_assign": 1},
		map[string]any{"id": 12, "completename": "Solo avisos", "is_assign": 0})
	enlace := map[string]any{"id": 48213, "name": "Caída intermitente del enlace de Calama", "content": "&#60;p&#62;El enlace MPLS se cae.&#60;br&#62;Lentitud en caja.&#60;/p&#62;",
		"entities_id": 7, "type": 1, "status": 2, "urgency": 4, "impact": 3, "priority": 4, "is_deleted": 0,
		"date": "2026-10-20 07:52:00", "date_mod": "2026-10-20 08:40:00", "time_to_resolve": "2026-10-20 11:52:00", "takeintoaccountdate": "2026-10-20 08:05:00"}
	otraArea := map[string]any{"id": 48190, "name": "Cuadratura de caja", "entities_id": 3, "type": 2, "status": 1, "priority": 3, "is_deleted": 0,
		"date": "2026-10-19 22:14:00", "date_mod": "2026-10-19 22:30:00"}
	aMano := map[string]any{"id": 48177, "name": "Permisos de la carpeta de cierre", "entities_id": 5, "type": 2, "status": 5, "priority": 2, "is_deleted": 0,
		"date": "2026-10-19 15:03:00", "date_mod": "2026-10-19 16:05:00", "solvedate": "2026-10-19 16:05:00"}
	fake.Set("Ticket", enlace, otraArea, aMano)
	fake.Set("Ticket/48213/Group_Ticket", map[string]any{"id": 1, "groups_id": 10, "type": 2})
	fake.Set("Ticket/48190/Group_Ticket", map[string]any{"id": 2, "groups_id": 11, "type": 2})
	fake.Set("Ticket/48213/Ticket_User", map[string]any{"id": 1, "users_id": 501, "type": 2}, map[string]any{"id": 2, "users_id": 600, "type": 1})
	fake.Set("User", map[string]any{"id": 501, "name": "dmunoz", "firstname": "Diego", "realname": "Muñoz"})
	fake.Set("User/501/UserEmail", map[string]any{"id": 1, "email": "Diego" + n + "@test.local", "is_default": 1})
	fake.Set("Ticket/48213/ITILFollowup",
		map[string]any{"id": 900, "users_id": 501, "content": "Se revisa con Entel.", "is_private": 0, "date": "2026-10-20 08:10:00"},
		map[string]any{"id": 901, "users_id": 501, "content": "El proveedor confirma falla.", "is_private": 1, "date": "2026-10-20 08:30:00"})
	fake.Set("Ticket/48213/TicketTask", map[string]any{"id": 77, "users_id_tech": 501, "content": "Pruebas de latencia.", "actiontime": 2700, "is_private": 0, "begin": "2026-10-20 08:20:00"})
	fake.Set("Ticket/48177/ITILSolution", map[string]any{"id": 5, "users_id": 501, "content": "Permisos corregidos.", "status": 3, "date_creation": "2026-10-19 16:05:00"})

	box, err := crypto.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	rec := &recordedAudit{}
	auditLog := audit.NewLogger(rec, slog.Default())
	inv := &InventoryHandler{Pool: tx, Queries: q, AuditLog: auditLog}
	h := &GlpiHandler{Queries: q, Crypto: box, AuditLog: auditLog, Notify: &Notifier{Queries: q, AuditLog: auditLog}, Inventory: inv, SyncWait: true}
	tk := &TicketsHandler{Queries: q, AuditLog: auditLog}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "adm", Role: "admin"})
	call := func(fn http.HandlerFunc, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		w := httptest.NewRecorder()
		h.RequireEnabled(fn)(w, httptest.NewRequest(method, path, &buf).WithContext(asAdmin))
		return w
	}
	sync := func() glpiTicketRunDTO {
		t.Helper()
		if w := call(h.SyncTickets, "POST", "/api/glpi/tickets/sync", nil); w.Code != http.StatusAccepted {
			t.Fatalf("sincronizar: %d %s", w.Code, w.Body)
		}
		var r struct{ Data []glpiTicketRunDTO }
		w := call(h.TicketRuns, "GET", "/api/glpi/tickets/runs", nil)
		_ = json.Unmarshal(w.Body.Bytes(), &r)
		if len(r.Data) == 0 || r.Data[0].Running {
			t.Fatalf("corridas: %s", w.Body)
		}
		return r.Data[0]
	}
	ticket := func(glpiID int) db.Ticket {
		t.Helper()
		var tid uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM tickets WHERE glpi_id = $1`, glpiID).Scan(&tid); err != nil {
			t.Fatalf("ticket GLPI-%d: %v", glpiID, err)
		}
		out, err := q.GetTicket(ctx, tid)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}

	// Conexión, y luego qué se trae: Casinos (con sus hijas), «Redes» → Infra,
	// la mesa de Contabilidad no se trae; Contabilidad tiene cliente para lo enlazado a mano.
	if w := call(h.PutConfig, "PUT", "/api/glpi/config", map[string]any{"url": fake.Server.URL, "appToken": "app-tok", "userToken": "user-tok",
		"verifyTls": true, "timeoutSeconds": 5, "importComputers": true, "importNetwork": true, "autoMode": "off"}); w.Code != 200 {
		t.Fatalf("conexión: %d %s", w.Code, w.Body)
	}
	if w := call(h.SyncTickets, "POST", "/api/glpi/tickets/sync", nil); w.Code != http.StatusConflict {
		t.Fatalf("apagado no debe sincronizar: %d", w.Code)
	}
	w := call(h.PutTicketsConfig, "PUT", "/api/glpi/tickets/config", map[string]any{"enabled": true, "every": "5m", "sinceDays": 90,
		"entities": []int{3}, "clients": map[string]any{"3": casinos, "5": netics}, "groupAreas": map[string]any{"10": infra, "11": nil}})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"firstLoadPending":true`) {
		t.Fatalf("configurar tickets: %d %s", w.Code, w.Body)
	}
	if w := call(h.TicketsCatalog, "GET", "/api/glpi/tickets/catalog", nil); !strings.Contains(w.Body.String(), "Redes y comunicaciones") || strings.Contains(w.Body.String(), "Solo avisos") {
		t.Fatalf("catálogo: %s", w.Body)
	}

	// Primera carga: el de Calama (hija de Casinos, grupo con área) y el enlazado a mano; el de la mesa de Contabilidad no.
	run := sync()
	if !run.OK || !run.FirstLoad || run.Created != 2 || run.Skipped != 1 {
		t.Fatalf("primera carga: %+v", run)
	}
	if search := fake.Searches[0]; search.Get("criteria[0][criteria][0][searchtype]") != "under" || search.Get("criteria[1][criteria][0][value]") != "notold" {
		t.Fatalf("búsqueda de la primera carga: %v", search)
	}
	tc := ticket(48213)
	if tc.TicketNumber != "GLPI-48213" || tc.Source != "glpi" || tc.AreaID != infra || tc.ClientID != casinos || tc.Status != db.TicketStatusAssigned ||
		tc.Priority != db.ItilPriorityP2High || tc.Urgency != db.ItilUrgencyHigh || tc.Impact != db.ItilImpactMedium || tc.PublicTrackingToken.Valid ||
		!tc.AssignedUserID.Valid || uuid.UUID(tc.AssignedUserID.Bytes) != diego || tc.GlpiTechnician.String != "Diego Muñoz" || tc.GlpiGroupName.String != "Redes y comunicaciones" {
		t.Fatalf("ticket de Calama: %+v", tc)
	}
	if tc.Description != "El enlace MPLS se cae.\nLentitud en caja." {
		t.Fatalf("el HTML de GLPI debe pasar a texto: %q", tc.Description)
	}
	if loc := h.location(ctx); !tc.SlaResolutionDueAt.Valid || !tc.SlaResolutionDueAt.Time.Equal(time.Date(2026, 10, 20, 11, 52, 0, 0, loc)) {
		t.Fatalf("el SLA lo pone GLPI: %v", tc.SlaResolutionDueAt)
	}
	hand := ticket(48177)
	if !hand.GlpiLinkedOnly || hand.ClientID != netics || hand.Status != db.TicketStatusResolved || !hand.ResolvedAt.Valid {
		t.Fatalf("enlazado a mano: %+v", hand)
	}

	// El detalle: solo lectura, «Abrir en GLPI», notas internas, tarea con tiempo y la entrada enlazada.
	get := func(tid uuid.UUID) ticketDetailDTO {
		t.Helper()
		r := httptest.NewRequest("GET", "/api/tickets/"+tid.String(), nil).WithContext(asAdmin)
		r.SetPathValue("id", tid.String())
		w := httptest.NewRecorder()
		tk.Get(w, r)
		var d struct{ Data ticketDetailDTO }
		if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil || w.Code != 200 {
			t.Fatalf("detalle: %d %s", w.Code, w.Body)
		}
		return d.Data
	}
	d := get(tc.ID)
	if d.Ticket.Glpi == nil || d.Ticket.Glpi.URL != fake.Server.URL+"/front/ticket.form.php?id=48213" || d.Ticket.CanWork || len(d.Ticket.AllowedTransitions) != 0 {
		t.Fatalf("detalle de GLPI: %+v", d.Ticket)
	}
	kinds := map[string]bool{}
	for _, c := range d.Comments {
		kinds[fmt.Sprintf("%s:%v", c.GlpiKind, c.IsPublic)] = true
	}
	if len(d.Comments) != 3 || !kinds["followup:true"] || !kinds["followup:false"] || !kinds["task:true"] || d.TotalTimeSpentSeconds != 2700 || len(d.Tasks) != 1 {
		t.Fatalf("seguimientos: %+v (tiempo %d)", d.Comments, d.TotalTimeSpentSeconds)
	}
	if hd := get(hand.ID); len(hd.Entries) != 1 || len(hd.Comments) != 1 || hd.Comments[0].GlpiKind != "solution" {
		t.Fatalf("detalle del enlazado a mano: %+v", hd)
	}

	// Solo lectura: escribir sobre un ticket de GLPI responde 409.
	for _, m := range []string{"PATCH", "POST"} {
		r := httptest.NewRequest(m, "/api/tickets/"+tc.ID.String(), strings.NewReader(`{"status":"in_progress"}`)).WithContext(asAdmin)
		r.SetPathValue("id", tc.ID.String())
		w := httptest.NewRecorder()
		tk.RequireEnabled(w, r, func(http.ResponseWriter, *http.Request) { t.Fatal("no debió llegar al handler") })
		if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "glpi-readonly") {
			t.Fatalf("%s sobre un ticket de GLPI: %d %s", m, w.Code, w.Body)
		}
	}

	// Sin cambios en GLPI, la siguiente corrida no reescribe nada.
	if run := sync(); !run.OK || run.FirstLoad || run.Created != 0 || run.Updated != 0 {
		t.Fatalf("sin cambios: %+v", run)
	}

	// En GLPI pasa a «En espera», se agrega un seguimiento y se borra la nota interna.
	enlace["status"], enlace["date_mod"], enlace["begin_waiting_date"] = 4, "2026-10-20 09:15:00", "2026-10-20 09:15:00"
	fake.Set("Ticket", enlace, otraArea, aMano)
	fake.Set("Ticket/48213/ITILFollowup",
		map[string]any{"id": 900, "users_id": 501, "content": "Se revisa con Entel.", "is_private": 0, "date": "2026-10-20 08:10:00"},
		map[string]any{"id": 902, "users_id": 501, "content": "Cuadrilla en camino.", "is_private": 0, "date": "2026-10-20 09:15:00"})
	if run := sync(); !run.OK || run.Updated != 1 {
		t.Fatalf("cambio en GLPI: %+v", run)
	}
	tc = ticket(48213)
	var comments int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM ticket_comments WHERE ticket_id = $1 AND glpi_kind = 'followup'`, tc.ID).Scan(&comments)
	if tc.Status != db.TicketStatusPendingVendor || !tc.SlaOnHoldSince.Valid || comments != 2 {
		t.Fatalf("en espera: %s, pausa %v, seguimientos %d", tc.Status, tc.SlaOnHoldSince, comments)
	}

	// A la papelera de GLPI: «Eliminado en GLPI», sale de la cola, nunca se borra.
	enlace["is_deleted"], enlace["date_mod"] = 1, "2026-10-20 09:30:00"
	fake.Set("Ticket", enlace, otraArea, aMano)
	if run := sync(); !run.OK || run.Deleted != 1 {
		t.Fatalf("papelera: %+v", run)
	}
	if !ticket(48213).GlpiDeleted {
		t.Fatal("el ticket en la papelera debe quedar marcado")
	}
	queue, err := q.CountTicketsView(asAdmin, db.CountTicketsViewParams{Source: pgtype.Text{String: "glpi", Valid: true}})
	if err != nil || queue != 1 {
		t.Fatalf("cola de GLPI: %d %v", queue, err)
	}

	// Tres corridas automáticas fallidas seguidas: aviso a los administradores y el cursor no se mueve.
	var cursor string
	_ = tx.QueryRow(ctx, `SELECT tickets_cursor FROM glpi_config`).Scan(&cursor)
	fake.Fail["search/Ticket"] = "ERROR_RIGHT_MISSING"
	for i := 0; i < 3; i++ {
		exec(`UPDATE glpi_config SET tickets_last_auto_at = NULL`)
		if err := h.TicketsAutoTick(asAdmin); err != nil {
			t.Fatal(err)
		}
	}
	var after string
	var notified, failed int
	_ = tx.QueryRow(ctx, `SELECT tickets_cursor FROM glpi_config`).Scan(&after)
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM glpi_ticket_runs WHERE trigger = 'auto' AND NOT ok`).Scan(&failed)
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1 AND kind = 'glpi.import'`, admin).Scan(&notified)
	if after != cursor || failed != 3 || notified != 1 {
		t.Fatalf("fallas: cursor %q → %q, fallidas %d, avisos %d", cursor, after, failed, notified)
	}
	// La automática no vuelve a correr antes de 5 minutos.
	if err := h.TicketsAutoTick(asAdmin); err != nil {
		t.Fatal(err)
	}
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM glpi_ticket_runs WHERE trigger = 'auto'`).Scan(&failed)
	if failed != 3 {
		t.Fatalf("corridas automáticas: %d", failed)
	}
}
