//go:build integration

// Escribir en GLPI (10d.2, spec/18 §4) contra la base real y un GLPI falso,
// dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestGlpiEscritura
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi/glpitest"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGlpiEscritura_ComentarCrearYVanYVuelven(t *testing.T) {
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
	n := fmt.Sprintf("w%d", time.Now().UnixNano())
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
	count := func(sql string, args ...any) int {
		t.Helper()
		var c int
		if err := tx.QueryRow(ctx, sql, args...).Scan(&c); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return c
	}
	infra := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "infra"+n)
	casinos := id(`INSERT INTO organizations (name, code) VALUES ('Casinos '||$1, 'cas'||$1) RETURNING id`, n)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	jorge := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'user') RETURNING id`, "jorge"+n)
	exec(`UPDATE system_features SET is_enabled = true WHERE code IN ('glpi_sync', 'native_tickets')`)

	fake := glpitest.New("app-tok", "user-tok")
	fake.WriteToken = "write-tok"
	defer fake.Close()
	fake.Set("Entity", map[string]any{"id": 0, "completename": "Raíz", "entities_id": -1}, map[string]any{"id": 3, "completename": "Raíz &#62; Casinos", "entities_id": 0})
	fake.Set("Group", map[string]any{"id": 10, "completename": "Soporte infraestructura", "is_assign": 1})
	fake.Set("Ticket", map[string]any{"id": 48213, "name": "Caída del enlace de Calama", "entities_id": 3, "type": 1, "status": 2, "priority": 3,
		"is_deleted": 0, "date": "2026-10-20 07:52:00", "date_mod": "2026-10-20 08:40:00"})
	fake.Set("Ticket/48213/Group_Ticket", map[string]any{"id": 1, "groups_id": 10, "type": 2})
	fake.Set("Ticket/48213/ITILFollowup", map[string]any{"id": 900, "users_id": 502, "content": "Se revisa con Entel.", "is_private": 0, "date": "2026-10-20 08:10:00"})
	fake.Set("User", map[string]any{"id": 501, "name": "jlagos", "firstname": "Jorge", "realname": "Lagos", "email": "jorge" + n + "@test.local"},
		map[string]any{"id": 502, "name": "mesa", "firstname": "Mesa", "realname": "de ayuda"})

	box, err := crypto.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	auditLog := audit.NewLogger(&recordedAudit{}, slog.Default())
	h := &GlpiHandler{Queries: q, Crypto: box, AuditLog: auditLog, Notify: &Notifier{Queries: q, AuditLog: auditLog},
		Inventory: &InventoryHandler{Pool: tx, Queries: q, AuditLog: auditLog}, SyncWait: true}
	tk := &TicketsHandler{Pool: tx, Queries: q, AuditLog: auditLog, Glpi: h}
	en := &EntriesHandler{Queries: q, AuditLog: auditLog, Glpi: h}
	asUser := func(u uuid.UUID, name, role string) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: u, Username: name, Role: role})
	}
	asAdmin, asJorge := asUser(admin, "adm"+n, "admin"), asUser(jorge, "jorge"+n, "admin")
	call := func(c context.Context, fn http.HandlerFunc, method, path string, body any, ids ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(c)
		if len(ids) > 0 {
			r.SetPathValue("id", ids[0])
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	data := func(w *httptest.ResponseRecorder, out any) {
		t.Helper()
		var env struct{ Data json.RawMessage }
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || json.Unmarshal(env.Data, out) != nil {
			t.Fatalf("respuesta: %d %s", w.Code, w.Body)
		}
	}
	// Las rutas de tickets pasan por el control de acceso (GLPI de solo lectura).
	ticketCall := func(c context.Context, fn http.HandlerFunc, method, path string, body any, tid uuid.UUID) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(c)
		r.SetPathValue("id", tid.String())
		w := httptest.NewRecorder()
		tk.RequireEnabled(w, r, fn)
		return w
	}
	sync := func() {
		t.Helper()
		if w := call(asAdmin, h.RequireEnabled(h.SyncTickets), "POST", "/", nil); w.Code != http.StatusAccepted {
			t.Fatalf("sincronizar: %d %s", w.Code, w.Body)
		}
	}
	detail := func(tid uuid.UUID) ticketDetailDTO {
		t.Helper()
		var d ticketDetailDTO
		data(ticketCall(asAdmin, tk.Get, "GET", "/api/tickets/"+tid.String(), nil, tid), &d)
		return d
	}

	// La 10d.1 trae GLPI-48213 a la cola de Infra.
	if w := call(asAdmin, h.PutConfig, "PUT", "/", map[string]any{"url": fake.Server.URL, "appToken": "app-tok", "userToken": "user-tok",
		"verifyTls": true, "timeoutSeconds": 5, "importComputers": true, "importNetwork": true, "autoMode": "off"}); w.Code != 200 {
		t.Fatalf("conexión: %d %s", w.Code, w.Body)
	}
	if w := call(asAdmin, h.PutTicketsConfig, "PUT", "/", map[string]any{"enabled": true, "every": "5m", "sinceDays": 90,
		"entities": []int{3}, "clients": map[string]any{"3": casinos}, "groupAreas": map[string]any{"10": infra}}); w.Code != 200 {
		t.Fatalf("tickets: %d %s", w.Code, w.Body)
	}
	sync()
	glpiTicket := id(`SELECT id FROM tickets WHERE glpi_id = 48213`)

	// Sin «Escribir en GLPI», un GLPI-… sigue siendo de solo lectura.
	if w := ticketCall(asJorge, tk.AddComment, "POST", "/api/tickets/x/comments", map[string]any{"content": "hola"}, glpiTicket); w.Code != http.StatusConflict {
		t.Fatalf("apagado: %d %s", w.Code, w.Body)
	}
	if d := detail(glpiTicket); d.GlpiWrite {
		t.Fatal("apagado no se ofrece escribir")
	}

	// Encender: pide el token; «Probar» no crea nada.
	if w := call(asAdmin, h.PutWriteConfig, "PUT", "/", map[string]any{"enabled": true, "defaultType": 1}); w.Code != 400 {
		t.Fatalf("sin token: %d", w.Code)
	}
	var cfgOut glpiWriteConfigDTO
	data(call(asAdmin, h.PutWriteConfig, "PUT", "/", map[string]any{"enabled": true, "token": "write-tok", "defaultType": 1}), &cfgOut)
	if !cfgOut.HasToken || !cfgOut.Enabled {
		t.Fatalf("config: %+v", cfgOut)
	}
	var cas glpiWriteClientDTO
	for _, c := range cfgOut.Clients {
		if c.ClientID == casinos {
			cas = c
		}
	}
	if len(cas.Entities) != 1 || cas.Entities[0].Name != "Raíz > Casinos" || cas.EntityID == nil || *cas.EntityID != 3 {
		t.Fatalf("entidad de Casinos al crear: %+v", cas)
	}
	posts := len(fake.Posts)
	var test glpiWriteTestDTO
	data(call(asAdmin, h.TestWrite, "POST", "/", nil), &test)
	if !test.OK || test.User != "bitacora-escritura" || test.Profile != "Técnico" || len(fake.Posts) != posts {
		t.Fatalf("probar: %+v", test)
	}

	// Comentar un GLPI-…: privado por defecto, con la firma y la marca de la app.
	var c1 ticketCommentDTO
	data(ticketCall(asJorge, tk.AddComment, "POST", "/api/tickets/x/comments", map[string]any{"content": "Cuadrilla en camino."}, glpiTicket), &c1)
	if c1.GlpiPush != "sent" || c1.AuthorName != "jorge"+n {
		t.Fatalf("comentario: %+v", c1)
	}
	last := fake.Posts[len(fake.Posts)-1]
	if last.Itemtype != "ITILFollowup" || fmt.Sprint(last.Input["items_id"]) != "48213" || fmt.Sprint(last.Input["is_private"]) != "1" ||
		!strings.Contains(fmt.Sprint(last.Input["content"]), glpi.SyncMarker) || !strings.Contains(fmt.Sprint(last.Input["content"]), "(desde Bitácora Ops)") {
		t.Fatalf("seguimiento en GLPI: %+v", last)
	}
	// La sincronización no lo trae de vuelta como si fuera nuevo.
	sync()
	if got := count(`SELECT count(*) FROM ticket_comments WHERE ticket_id = $1`, glpiTicket); got != 2 {
		t.Fatalf("comentarios del GLPI-… tras sincronizar: %d", got)
	}
	if got := count(`SELECT count(*) FROM ticket_comments WHERE ticket_id = $1 AND author_name = $2 AND glpi_push_state = 'sent'`, glpiTicket, "jorge"+n); got != 1 {
		t.Fatal("el comentario propio sigue con su autor")
	}

	// GLPI no responde: queda en cola y sale en el reintento.
	fake.FailWrite["ITILFollowup"] = 503
	var c2 ticketCommentDTO
	data(ticketCall(asJorge, tk.AddComment, "POST", "/api/tickets/x/comments", map[string]any{"content": "Visible para el cliente", "isPublic": true}, glpiTicket), &c2)
	if c2.GlpiPush != "queued" || c2.GlpiPushError == nil {
		t.Fatalf("en cola: %+v", c2)
	}
	exec(`UPDATE glpi_outbox SET next_attempt_at = now() - interval '1 minute' WHERE state = 'queued'`)
	if err := h.WriteTick(ctx); err != nil {
		t.Fatal(err)
	}
	if got := count(`SELECT count(*) FROM ticket_comments WHERE id = $1 AND glpi_push_state = 'sent' AND glpi_id IS NOT NULL`, c2.ID); got != 1 {
		t.Fatal("el reintento lo envió")
	}
	if fmt.Sprint(fake.Posts[len(fake.Posts)-1].Input["is_private"]) != "0" {
		t.Fatal("marcado visible, sale público")
	}
	// Un error que no se arregla reintentando: «No se envió», y «Reintentar».
	fake.FailWrite["ITILFollowup"] = 400
	var c3 ticketCommentDTO
	data(ticketCall(asJorge, tk.AddComment, "POST", "/api/tickets/x/comments", map[string]any{"content": "Otro"}, glpiTicket), &c3)
	if c3.GlpiPush != "failed" {
		t.Fatalf("fallido: %+v", c3)
	}
	var queue []glpiOutboxDTO
	data(call(asAdmin, h.WriteQueue, "GET", "/", nil), &queue)
	if len(queue) == 0 || queue[0].State != "failed" || queue[0].LastError == nil {
		t.Fatalf("cola: %+v", queue)
	}
	if w := call(asAdmin, h.RetryWrite, "POST", "/", map[string]any{}); w.Code != 200 {
		t.Fatalf("reintentar: %d", w.Code)
	}
	if got := count(`SELECT count(*) FROM ticket_comments WHERE id = $1 AND glpi_push_state = 'sent'`, c3.ID); got != 1 {
		t.Fatal("«Reintentar» lo envió")
	}

	// Crear en GLPI desde un ticket de la app: entidad del cliente, grupo del área, solicitante por correo.
	appTicket, err := tk.createTicketTx(asJorge, tx, newTicket{Type: "incident", Scope: db.EntryScopeGeneral, ClientID: casinos, Title: "Disco lleno en FS01",
		Description: "El volumen D: llegó al 98 %.", Impact: "medium", Urgency: "high", ActorID: jorge, AreaID: infra, RequestedAreaID: infra}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var preview glpiCreatePreviewDTO
	data(ticketCall(asJorge, tk.GlpiCopyPreview, "GET", "/", nil, appTicket.ID), &preview)
	if preview.EntityID == nil || *preview.EntityID != 3 || preview.GroupID == nil || *preview.GroupID != 10 || preview.Urgency != 4 || preview.Impact != 3 ||
		!strings.Contains(preview.Description, appTicket.TicketNumber) || preview.Problem != "" {
		t.Fatalf("vista previa: %+v", preview)
	}
	var copyOut glpiCopyDTO
	data(ticketCall(asJorge, tk.CreateGlpiCopy, "POST", "/", map[string]any{"entityId": 3, "groupId": 10, "type": 1}, appTicket.ID), &copyOut)
	created := fake.Posts[len(fake.Posts)-1]
	if created.Itemtype != "Ticket" || fmt.Sprint(created.Input["entities_id"]) != "3" || fmt.Sprint(created.Input["_groups_id_assign"]) != "10" ||
		fmt.Sprint(created.Input["_users_id_requester"]) != "501" || fmt.Sprint(created.Input["urgency"]) != "4" || copyOut.ID == 0 {
		t.Fatalf("ticket creado en GLPI: %+v", created)
	}
	if w := ticketCall(asJorge, tk.CreateGlpiCopy, "POST", "/", map[string]any{"entityId": 3}, appTicket.ID); w.Code != http.StatusConflict {
		t.Fatalf("dos veces: %d", w.Code)
	}
	if d := detail(appTicket.ID); d.GlpiCopy == nil || d.GlpiCopy.ID != copyOut.ID || !d.GlpiWrite {
		t.Fatalf("detalle con copia: %+v", d.GlpiCopy)
	}
	// Van: un comentario de la app sale a la copia.
	var c4 ticketCommentDTO
	data(ticketCall(asJorge, tk.AddComment, "POST", "/api/tickets/x/comments", map[string]any{"content": "Se liberaron 420 GB."}, appTicket.ID), &c4)
	if c4.GlpiPush != "sent" || fmt.Sprint(fake.Posts[len(fake.Posts)-1].Input["items_id"]) != fmt.Sprint(copyOut.ID) {
		t.Fatalf("a la copia: %+v", c4)
	}
	// Vuelven: lo que alguien escribe en GLPI llega «desde GLPI»; lo propio no se duplica.
	copyKey := fmt.Sprintf("Ticket/%d/ITILFollowup", copyOut.ID)
	fake.Set(copyKey, append(fake.Rows[copyKey], map[string]any{"id": 777, "users_id": 502, "content": "El cliente pide el informe.", "is_private": 0, "date": "2026-10-21 13:00:00"})...)
	for _, row := range fake.Rows["Ticket"] {
		if fmt.Sprint(row["id"]) == fmt.Sprint(copyOut.ID) {
			row["date_mod"] = "2026-10-21 13:00:00"
		}
	}
	sync()
	d := detail(appTicket.ID)
	fromGlpi, mine := 0, 0
	for _, c := range d.Comments {
		if c.Origin == "glpi" && c.Content == "El cliente pide el informe." && c.AuthorName == "Mesa de ayuda" {
			fromGlpi++
		}
		if c.Content == "Se liberaron 420 GB." {
			mine++
		}
	}
	if fromGlpi != 1 || mine != 1 || len(d.Comments) != 2 {
		t.Fatalf("van y vuelven: %+v", d.Comments)
	}
	if got := count(`SELECT count(*) FROM tickets WHERE ticket_number = $1`, fmt.Sprintf("GLPI-%d", copyOut.ID)); got != 0 {
		t.Fatal("la copia no se convierte en un GLPI-…")
	}
	// Resolver en la app resuelve la copia; reabrir la reabre.
	h.AfterStatus(ctx, appTicket.ID, "in_progress", "resolved", jorge)
	if p := fake.Posts[len(fake.Posts)-1]; p.Itemtype != "ITILSolution" || !strings.Contains(fmt.Sprint(p.Input["content"]), appTicket.TicketNumber) {
		t.Fatalf("resolver la copia: %+v", p)
	}
	h.AfterStatus(ctx, appTicket.ID, "resolved", "in_progress", jorge)
	if p := fake.Posts[len(fake.Posts)-1]; p.Method != http.MethodPut || fmt.Sprint(p.Input["status"]) != "2" {
		t.Fatalf("reabrir la copia: %+v", p)
	}

	// Desde la Bitácora: crear en GLPI deja la entrada enlazada; «También en GLPI».
	entry := id(`INSERT INTO entries (user_id, entry_type, scope, content, tags) VALUES ($1, 'incidente', 'general', 'Ventilador del rack 3 con ruido', ARRAY['cliente:Casinos '||$2]) RETURNING id`, jorge, n)
	var ep glpiCreatePreviewDTO
	data(call(asJorge, en.GlpiCreatePreview, "GET", "/", nil, entry.String()), &ep)
	if ep.EntityID == nil || *ep.EntityID != 3 || ep.Urgency != 4 || ep.Problem != "" {
		t.Fatalf("vista previa de la entrada: %+v", ep)
	}
	var made struct{ GlpiTicketID string }
	data(call(asJorge, en.CreateInGlpi, "POST", "/", map[string]any{"entityId": 3}, entry.String()), &made)
	if got := count(`SELECT count(*) FROM entries WHERE id = $1 AND glpi_ticket_id = $2`, entry, made.GlpiTicketID); got != 1 {
		t.Fatal("la entrada quedó enlazada")
	}
	var ec entryCommentDTO
	data(call(asJorge, en.AddComment, "POST", "/", map[string]any{"comment": "Se cambió el ventilador.", "syncToGlpi": true}, entry.String()), &ec)
	if ec.GlpiPush != "sent" || fmt.Sprint(fake.Posts[len(fake.Posts)-1].Input["items_id"]) != made.GlpiTicketID {
		t.Fatalf("también en GLPI: %+v", ec)
	}
	if w := call(asJorge, en.GlpiCreatePreview, "GET", "/", nil, entry.String()); w.Code != http.StatusConflict {
		t.Fatalf("ya enlazada: %d", w.Code)
	}
}
