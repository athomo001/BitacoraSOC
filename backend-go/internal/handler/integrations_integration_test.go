//go:build integration

// Reenvío de eventos a un SIEM y API de integraciones (10b, spec/19) contra
// la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestIntegraciones
package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/forward"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// siemTCP es un SIEM de mentira: junta las líneas que le llegan.
type siemTCP struct {
	ln    net.Listener
	mu    sync.Mutex
	lines []string
}

func newSiemTCP(t *testing.T) *siemTCP {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &siemTCP{ln: ln}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				sc := bufio.NewScanner(c)
				sc.Buffer(make([]byte, 1<<20), 1<<20)
				for sc.Scan() {
					s.mu.Lock()
					s.lines = append(s.lines, sc.Text())
					s.mu.Unlock()
				}
			}()
		}
	}()
	return s
}

func (s *siemTCP) port() int32 { return int32(s.ln.Addr().(*net.TCPAddr).Port) }

func (s *siemTCP) events(t *testing.T) map[string][]forward.Event {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		s.mu.Lock()
		n := len(s.lines)
		s.mu.Unlock()
		if n > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond) // que termine de llegar el resto
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string][]forward.Event{}
	for _, l := range s.lines {
		var ev forward.Event
		if err := json.Unmarshal([]byte(l), &ev); err != nil {
			t.Fatalf("línea que no es JSON: %s", l)
		}
		out[ev.Event] = append(out[ev.Event], ev)
	}
	s.lines = nil
	return out
}

func TestIntegraciones_ReenvioYAPI(t *testing.T) {
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
	n := fmt.Sprintf("i%d", time.Now().UnixNano())
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
	// Ningún otro destino encendido de la base de desarrollo se mete en la prueba.
	exec(`UPDATE forward_destinations SET enabled = false`)
	exec(`UPDATE system_features SET is_enabled = true WHERE code = 'native_tickets'`)
	soc := uuid.MustParse(areaSOCID)
	exec(`UPDATE areas SET active = true WHERE id = $1`, soc)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "admin"+n)
	jorge := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'user') RETURNING id`, "jorge"+n)
	casinos := id(`INSERT INTO organizations (name, code) VALUES ('Casinos '||$1, 'cas'||$1) RETURNING id`, n)
	id(`INSERT INTO organizations (name, code) VALUES ('Netics '||$1, 'net'||$1) RETURNING id`, n)

	emitter := &forward.Emitter{Queries: q, Node: "nodo-prueba"}
	auditLog := audit.NewLogger(&repository.AuditStore{Queries: q, After: emitter.FromAudit}, slog.Default())
	ih := &IntegrationsHandler{Queries: q, AuditLog: auditLog, Forward: emitter, Hostname: "nodo-prueba"}
	tickets := &TicketsHandler{Queries: q, AuditLog: auditLog}
	api := &IntegrationsAPI{Queries: q, Pool: tx, AuditLog: auditLog, Limiter: ratelimit.NewAPILimiter(600, 15*time.Minute), Tickets: tickets}
	mux := http.NewServeMux()
	mux.Handle("GET /api/v1", api.Route("", api.Discovery))
	mux.Handle("GET /api/v1/entries", api.Route("entries:read", api.ListEntries))
	mux.Handle("POST /api/v1/entries", api.Route("entries:write", api.CreateEntry))
	mux.Handle("GET /api/v1/oncall", api.Route("oncall:read", api.OnCall))
	mux.Handle("GET /api/v1/tickets/{ref}", api.Route("tickets:read", api.GetTicket))
	mux.Handle("POST /api/v1/tickets", api.Route("tickets:write", api.CreateTicket))
	mux.Handle("POST /api/v1/tickets/{ref}/comments", api.Route("tickets:write", api.CommentTicket))

	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "admin" + n, Role: "admin"})
	call := func(fn http.HandlerFunc, method, path string, body any, vals ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(asAdmin)
		for i := 0; i+1 < len(vals); i += 2 {
			r.SetPathValue(vals[i], vals[i+1])
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	apiCall := func(key, method, path string, body any, headers ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(ctx)
		if key != "" {
			r.Header.Set("X-API-Key", key)
		}
		for i := 0; i+1 < len(headers); i += 2 {
			r.Header.Set(headers[i], headers[i+1])
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
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

	// ===== Destino: un SIEM por TCP que recibe auditoría, Bitácora y Ticketera =====
	siem := newSiemTCP(t)
	defer siem.ln.Close()
	w := call(ih.CreateDestination, "POST", "/api/integrations/destinations", map[string]any{"name": "Wazuh " + n, "enabled": true,
		"transport": "tcp", "host": "127.0.0.1", "port": siem.port(), "format": "json", "sendAudit": true, "auditLevel": "warn",
		"sendEntries": true, "sendTickets": true})
	if w.Code != 201 {
		t.Fatalf("crear destino: %d %s", w.Code, w.Body)
	}
	var dest forwardDestinationDTO
	decode(w, &dest)
	if bad := call(ih.CreateDestination, "POST", "/api/integrations/destinations", map[string]any{"name": "x", "transport": "http",
		"url": "http://siem.local/x", "format": "json"}); bad.Code != 400 || !strings.Contains(bad.Body.String(), "https://") {
		t.Fatalf("una URL http:// no se acepta: %d %s", bad.Code, bad.Body)
	}

	// ===== Llave: escribe entradas y tickets solo para Casinos =====
	w = call(ih.CreateKey, "POST", "/api/integrations/keys", map[string]any{"name": "n8n " + n, "scopes": []string{"entries:read", "entries:write", "tickets:read", "tickets:write"},
		"clientIds": []uuid.UUID{casinos}, "areaId": soc, "expiresInDays": 365})
	if w.Code != 201 {
		t.Fatalf("crear llave: %d %s", w.Code, w.Body)
	}
	var created struct {
		Key    apiKeyDTO `json:"key"`
		Secret string    `json:"secret"`
	}
	decode(w, &created)
	if !strings.HasPrefix(created.Secret, "bop_") || len(created.Secret) != 47 || created.Key.Prefix != created.Secret[:12] {
		t.Fatalf("llave: %+v", created)
	}
	if count(`SELECT count(*) FROM api_keys WHERE id = $1 AND key_hash <> $2`, created.Key.ID, created.Secret) != 1 {
		t.Fatal("la llave se guarda como hash, nunca en claro")
	}
	// La llave queda a nombre de Jorge (así firma lo que crea).
	exec(`UPDATE api_keys SET created_by = $2 WHERE id = $1`, created.Key.ID, jorge)
	key := created.Secret

	if w := apiCall("", "GET", "/api/v1", nil); w.Code != 401 || !strings.Contains(w.Body.String(), "api-key-required") {
		t.Fatalf("sin llave: %d %s", w.Code, w.Body)
	}
	if w := apiCall("bop_"+strings.Repeat("x", 43), "GET", "/api/v1", nil); w.Code != 401 {
		t.Fatalf("llave inventada: %d", w.Code)
	}
	if w := apiCall("", "GET", "/api/v1", nil, "Authorization", "Bearer "+key); w.Code != 200 || w.Header().Get("X-API-Version") != "v1" {
		t.Fatalf("Bearer vale igual que X-API-Key: %d %s", w.Code, w.Body)
	}
	if w := apiCall(key, "GET", "/api/v1/oncall", nil); w.Code != 403 || !strings.Contains(w.Body.String(), "oncall:read") {
		t.Fatalf("sin el permiso: %d %s", w.Code, w.Body)
	}

	// ===== Entradas: con Idempotency-Key, un reintento no duplica =====
	body := map[string]any{"content": "Alerta Wazuh 5712: fuerza bruta en VPN", "entryType": "incidente", "client": "casinos " + n, "tags": []string{"wazuh", "vpn", "wazuh"}}
	w1 := apiCall(key, "POST", "/api/v1/entries", body, "Idempotency-Key", "alerta-5712")
	if w1.Code != 201 {
		t.Fatalf("crear entrada: %d %s", w1.Code, w1.Body)
	}
	var entry apiEntryDTO
	decode(w1, &entry)
	if entry.Author != "jorge"+n || entry.APIKey == nil || *entry.APIKey != "n8n "+n || entry.Client == nil || entry.Client.ID != casinos.String() {
		t.Fatalf("entrada: %+v", entry)
	}
	if len(entry.Tags) != 3 || entry.Tags[2] != "cliente:Casinos "+n {
		t.Fatalf("sin servicio, el cliente va en la etiqueta: %v", entry.Tags)
	}
	w2 := apiCall(key, "POST", "/api/v1/entries", body, "Idempotency-Key", "alerta-5712")
	if w2.Code != 201 || w2.Header().Get("Idempotent-Replayed") != "true" || w2.Body.String() != w1.Body.String() {
		t.Fatalf("el reintento devuelve lo mismo: %d %s", w2.Code, w2.Header())
	}
	if c := count(`SELECT count(*) FROM entries WHERE api_key_id = $1`, created.Key.ID); c != 1 {
		t.Fatalf("entradas creadas: %d", c)
	}
	if w := apiCall(key, "POST", "/api/v1/entries", map[string]any{"content": "otra"}, "Idempotency-Key", "alerta-5712"); w.Code != 422 {
		t.Fatalf("la misma clave con otro cuerpo: %d", w.Code)
	}
	if w := apiCall(key, "POST", "/api/v1/entries", map[string]any{"content": "x", "client": "Netics " + n}); w.Code != 400 || !strings.Contains(w.Body.String(), "invalid-client") {
		t.Fatalf("un cliente que no es de la llave: %d %s", w.Code, w.Body)
	}
	var list []apiEntryDTO
	w = apiCall(key, "GET", "/api/v1/entries?limit=5", nil)
	decode(w, &list)
	if w.Code != 200 || len(list) != 1 || list[0].ID != entry.ID {
		t.Fatalf("solo ve las de sus clientes: %d %+v", w.Code, list)
	}

	// ===== Tickets: entra a la cola SOC, con la marca de la llave =====
	w = apiCall(key, "POST", "/api/v1/tickets", map[string]any{"title": "Fuerza bruta en VPN", "description": "312 intentos", "client": casinos.String(), "urgency": "high"},
		"Idempotency-Key", "ticket-5712")
	if w.Code != 201 {
		t.Fatalf("crear ticket: %d %s", w.Code, w.Body)
	}
	var tk apiTicketDTO
	decode(w, &tk)
	if tk.Area != "SOC" || tk.APIKey == nil || tk.Client.ID != casinos.String() || !strings.HasPrefix(tk.Number, "TKT-") {
		t.Fatalf("ticket: %+v", tk)
	}
	if again := apiCall(key, "POST", "/api/v1/tickets", map[string]any{"title": "Fuerza bruta en VPN", "description": "312 intentos", "client": casinos.String(), "urgency": "high"},
		"Idempotency-Key", "ticket-5712"); again.Code != 201 || count(`SELECT count(*) FROM tickets WHERE api_key_id = $1`, created.Key.ID) != 1 {
		t.Fatal("un SIEM que reintenta no abre dos tickets")
	}
	if w := apiCall(key, "POST", "/api/v1/tickets/"+tk.Number+"/comments", map[string]any{"content": "Visto por el cliente", "public": true}); w.Code != 201 {
		t.Fatalf("comentar: %d %s", w.Code, w.Body)
	}
	apiCall(key, "POST", "/api/v1/tickets/"+tk.Number+"/comments", map[string]any{"content": "Nota interna"})
	w = apiCall(key, "GET", "/api/v1/tickets/"+strings.ToLower(tk.Number), nil)
	decode(w, &tk)
	if w.Code != 200 || len(tk.Comments) != 1 || tk.Comments[0].Content != "Visto por el cliente" || !strings.Contains(tk.Comments[0].Author, "(API · n8n") {
		t.Fatalf("detalle con solo los comentarios públicos: %d %+v", w.Code, tk.Comments)
	}

	// ===== El SIEM recibe lo de operación (completo) y la auditoría desde advertencia =====
	worker := &forward.Worker{Queries: q, Owner: "prueba", Hostname: "nodo-prueba"}
	if err := worker.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	got := siem.events(t)
	ec := got["entry.created"]
	if len(ec) != 1 || ec[0].Group != "bitacora" || ec[0].Data["content"] != body["content"] || ec[0].Client == nil || ec[0].Object.Type != "entry" {
		t.Fatalf("entrada en el SIEM: %+v", ec)
	}
	if tc := got["ticket.created"]; len(tc) != 1 || tc[0].Object.Ref != tk.Number || tc[0].Data["area"] != "SOC" || tc[0].Actor == nil || !strings.Contains(tc[0].Actor.Name, "API ·") {
		t.Fatalf("ticket en el SIEM: %+v", tc)
	}
	if len(got["apikey.create"]) != 1 || len(got["config.forward.create"]) != 1 || len(got["ticket.comment_added"]) != 2 {
		t.Fatalf("auditoría desde advertencia (crear el destino y la llave) y los comentarios: %v", keys(got))
	}
	var d forwardDestinationDTO
	w = call(ih.ListDestinations, "GET", "/api/integrations/destinations", nil)
	var dests []forwardDestinationDTO
	decode(w, &dests)
	for _, x := range dests {
		if x.ID == dest.ID {
			d = x
		}
	}
	if d.State != "ok" || d.SentToday < 3 || d.Pending != 0 {
		t.Fatalf("cifras del destino: %+v", d)
	}

	// ===== SIEM caído: queda en cola, con el error a la vista =====
	siem.ln.Close()
	apiCall(key, "POST", "/api/v1/entries", map[string]any{"content": "segunda", "client": "Casinos " + n})
	exec(`UPDATE forward_destinations SET lease_until = NULL WHERE id = $1`, dest.ID)
	if err := worker.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	decode(call(ih.ListDestinations, "GET", "/api/integrations/destinations", nil), &dests)
	for _, x := range dests {
		if x.ID == dest.ID {
			d = x
		}
	}
	if d.State != "failing" || d.LastError == nil || !strings.Contains(*d.LastError, "no se pudo conectar") || d.Pending < 1 {
		t.Fatalf("destino caído: %+v", d)
	}

	// ===== Registro de llamadas y revocación =====
	var reqs []apiKeyRequestDTO
	decode(call(ih.KeyRequests, "GET", "/", nil, "id", created.Key.ID.String()), &reqs)
	replayed := false
	for _, r := range reqs {
		replayed = replayed || (r.Note != nil && strings.Contains(*r.Note, "no se duplicó"))
	}
	if len(reqs) < 8 || !replayed {
		t.Fatalf("registro de llamadas: %d", len(reqs))
	}
	if w := call(ih.RevokeKey, "POST", "/", nil, "id", created.Key.ID.String()); w.Code != 204 {
		t.Fatalf("revocar: %d", w.Code)
	}
	if w := apiCall(key, "GET", "/api/v1", nil); w.Code != 401 || !strings.Contains(w.Body.String(), "api-key-revoked") {
		t.Fatalf("revocada: %d %s", w.Code, w.Body)
	}

	// Si quien la creó se da de baja, la llave se revoca sola.
	w = call(ih.CreateKey, "POST", "/api/integrations/keys", map[string]any{"name": "soar " + n, "scopes": []string{"entries:read"}})
	decode(w, &created)
	exec(`UPDATE api_keys SET created_by = $2 WHERE id = $1`, created.Key.ID, jorge)
	exec(`UPDATE users SET active = false WHERE id = $1`, jorge)
	if w := apiCall(created.Secret, "GET", "/api/v1", nil); w.Code != 401 {
		t.Fatalf("creador de baja: %d", w.Code)
	}
	if count(`SELECT count(*) FROM api_keys WHERE id = $1 AND NOT active AND revoke_reason IS NOT NULL`, created.Key.ID) != 1 {
		t.Fatal("la llave tenía que quedar revocada con el motivo")
	}
}

func keys(m map[string][]forward.Event) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}
