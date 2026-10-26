//go:build integration

// Complementos que agregan funciones (10i, spec/11 §12) contra la base real,
// dentro de una transacción que se deshace: un servicio de mentira con su
// complement.json, la aprobación cosa por cosa, la llave de integraciones,
// los eventos firmados por la cola de la 10b, las tareas programadas, la
// configuración y lo que pide el bridge (API_REQUEST, ADD_NOTE).
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestComplementosQueAgregan
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/complements"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/forward"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fakeService es un complemento con servidor: sirve su complement.json y
// anota los ganchos que le llegan con su firma.
type fakeService struct {
	srv      *httptest.Server
	mu       sync.Mutex
	manifest string
	hooks    []fakeHook
}

type fakeHook struct {
	Path, Timestamp, Signature string
	Body                       []byte
}

func newFakeService(manifest string) *fakeService {
	f := &fakeService{manifest: manifest}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/complement.json":
			f.mu.Lock()
			_, _ = w.Write([]byte(f.manifest))
			f.mu.Unlock()
		case r.URL.Path == "/health":
			w.WriteHeader(200)
		case strings.HasPrefix(r.URL.Path, "/hooks/"):
			body, _ := io.ReadAll(r.Body)
			f.mu.Lock()
			f.hooks = append(f.hooks, fakeHook{Path: r.URL.Path, Timestamp: r.Header.Get("X-Bitacora-Timestamp"),
				Signature: r.Header.Get("X-Bitacora-Signature"), Body: body})
			f.mu.Unlock()
			w.WriteHeader(204)
		default:
			http.NotFound(w, r)
		}
	}))
	return f
}

func (f *fakeService) take() []fakeHook {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := f.hooks
	f.hooks = nil
	return out
}

const vtManifest = `{
  "version": "1.2.0",
  "panels": [{"id": "reputacion", "target": "ticket", "title": "Reputación", "path": "panel.html"}],
  "actions": [{"id": "buscar", "target": "entry", "title": "Buscar en VirusTotal", "path": "accion.html"}],
  "topbar": {"path": "barra.html"},
  "settings": [{"key": "apiKey", "label": "Llave de VirusTotal", "type": "secret", "required": true},
               {"key": "umbral", "label": "Malicioso desde", "type": "number", "default": 5}],
  "events": ["entry.created"],
  "schedules": [{"name": "revisar", "every": "6h"}],
  "data": ["entries:read", "entries:write"]
}`

func TestComplementosQueAgregan(t *testing.T) {
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
	n := fmt.Sprintf("c%d", time.Now().UnixNano())
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
	exec(`UPDATE forward_destinations SET enabled = false`)
	exec(`UPDATE system_features SET is_enabled = true WHERE code IN ('complements', 'native_tickets')`)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "admin"+n)
	ana := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'user') RETURNING id`, "ana"+n)

	box, err := crypto.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	emitter := &forward.Emitter{Queries: q, Node: "nodo-prueba"}
	auditLog := audit.NewLogger(&repository.AuditStore{Queries: q, After: emitter.FromAudit}, slog.Default())
	tickets := &TicketsHandler{Queries: q, AuditLog: auditLog}
	api := &IntegrationsAPI{Queries: q, Pool: tx, AuditLog: auditLog, Limiter: ratelimit.NewAPILimiter(600, 15*time.Minute), Tickets: tickets}
	h := &ComplementsHandler{Pool: tx, Queries: q, AuditLog: auditLog, JWT: auth.NewJWTIssuer(bytes.Repeat([]byte{9}, 32)),
		Signer: complements.NewSigner(bytes.Repeat([]byte{9}, 32)), Breaker: complements.NewBreaker(), AppOrigin: "https://bitacora.test",
		OriginURL: "https://complementos.test", Crypto: box, Forward: emitter, API: api, Tickets: tickets, Owner: "nodo-prueba", Location: time.UTC}
	h.PreviewCacheInit()
	apiMux := http.NewServeMux()
	apiMux.Handle("GET /api/v1/entries", api.Route("entries:read", api.ListEntries))
	apiMux.Handle("GET /api/v1/tickets", api.Route("tickets:read", api.ListTickets))
	apiMux.Handle("POST /api/v1/entries/{id}/comments", api.Route("entries:write", api.CommentEntry))

	as := func(user uuid.UUID, role string) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: map[uuid.UUID]string{admin: "admin" + n, ana: "ana" + n}[user], Role: role})
	}
	call := func(c context.Context, fn http.HandlerFunc, method, path string, body any, vals ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
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
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("respuesta: %s", w.Body)
		}
		if err := json.Unmarshal(env.Data, out); err != nil {
			t.Fatalf("datos: %s", env.Data)
		}
	}
	asAdmin, asAna := as(admin, "admin"), as(ana, "user")
	slug := "vt-" + n[len(n)-8:]

	// ===== Alta: lee su complement.json, nada aprobado =====
	svc := newFakeService(vtManifest)
	defer svc.srv.Close()
	w := call(asAdmin, h.CreateManual, "POST", "/api/complements", map[string]any{"slug": slug, "name": "VirusTotal", "baseUrl": svc.srv.URL,
		"healthPath": "/health", "entryPath": "/"})
	if w.Code != 201 {
		t.Fatalf("registrar: %d %s", w.Code, w.Body)
	}
	var created struct {
		Complement complementDTO `json:"complement"`
	}
	decode(w, &created)
	if created.Complement.Manifest == nil || created.Complement.Manifest.Version != "1.2.0" || len(created.Complement.Items) != 8 || len(created.Complement.Approved) != 0 {
		t.Fatalf("complement.json al registrar: %+v", created.Complement)
	}
	var slots slotsDTO
	decode(call(asAna, h.Slots, "GET", "/api/complements/slots", nil), &slots)
	if len(slots.Panels)+len(slots.Actions) != 0 || slots.Topbar != nil {
		t.Fatalf("sin aprobar no aparece nada: %+v", slots)
	}

	// ===== La barra superior pide «de la casa» =====
	if w := call(asAdmin, h.SetApprovals, "PUT", "/x", map[string]any{"approved": []string{"topbar"}}, "slug", slug); w.Code != 400 || !strings.Contains(w.Body.String(), "de la casa") {
		t.Fatalf("barra sin «de la casa»: %d %s", w.Code, w.Body)
	}

	// ===== Aprobar todo menos la barra =====
	all := []string{"panel:reputacion", "action:buscar", "settings", "event:entry.created", "schedule:revisar", "data:entries:read", "data:entries:write"}
	w = call(asAdmin, h.SetApprovals, "PUT", "/x", map[string]any{"approved": all}, "slug", slug)
	if w.Code != 200 {
		t.Fatalf("aprobar: %d %s", w.Code, w.Body)
	}
	var detail complementDTO
	decode(w, &detail)
	if detail.Features == nil || detail.Features.IntegrationKey == nil || !slices.Equal(detail.Features.IntegrationKey.Scopes, []string{"entries:read", "entries:write"}) ||
		detail.Features.Events == nil || detail.Features.Events.URL != svc.srv.URL+"/hooks/events" || len(detail.Features.Schedules) != 1 {
		t.Fatalf("lo que prepara la app: %+v", detail.Features)
	}
	if count(`SELECT count(*) FROM forward_destinations WHERE complement_id IS NOT NULL AND name LIKE 'Complemento VirusTotal'`) != 1 {
		t.Fatal("falta el destino de eventos")
	}
	var rows []forwardDestinationDTO
	ih := &IntegrationsHandler{Queries: q, AuditLog: auditLog, Forward: emitter}
	decode(call(asAdmin, ih.ListDestinations, "GET", "/api/integrations/destinations", nil), &rows)
	for _, d := range rows {
		if strings.HasPrefix(d.Name, "Complemento ") {
			t.Fatalf("el destino del complemento no va en Integraciones: %+v", d)
		}
	}
	decode(call(asAna, h.Slots, "GET", "/api/complements/slots", nil), &slots)
	if len(slots.Panels) != 1 || slots.Panels[0].Target != "ticket" || len(slots.Actions) != 1 || slots.Actions[0].Target != "entry" || slots.Topbar != nil {
		t.Fatalf("ranuras aprobadas: %+v", slots)
	}

	// ===== Las credenciales que pide el servicio =====
	c, _ := q.GetComplementBySlug(ctx, slug)
	rt := &RuntimeAPI{Complements: h}
	rw := httptest.NewRecorder()
	rt.Credentials(rw, httptest.NewRequest("GET", "/api/internal/v1/credentials", nil).WithContext(ctx), c)
	var creds struct {
		APIBaseURL     string `json:"apiBaseUrl"`
		IntegrationKey string `json:"integrationKey"`
		HookSecret     string `json:"hookSecret"`
	}
	_ = json.Unmarshal(rw.Body.Bytes(), &creds)
	if creds.APIBaseURL != "https://bitacora.test/api/v1" || !strings.HasPrefix(creds.IntegrationKey, apiKeyPrefix) || len(creds.HookSecret) != 64 {
		t.Fatalf("credenciales: %s", rw.Body)
	}
	apiCall := func(method, path string, body any) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(ctx)
		r.Header.Set("X-API-Key", creds.IntegrationKey)
		w := httptest.NewRecorder()
		apiMux.ServeHTTP(w, r)
		return w
	}
	if w := apiCall("GET", "/api/v1/entries?limit=1", nil); w.Code != 200 {
		t.Fatalf("la llave lee entradas: %d %s", w.Code, w.Body)
	}
	if w := apiCall("GET", "/api/v1/tickets", nil); w.Code != 403 {
		t.Fatalf("sin tickets:read: %d %s", w.Code, w.Body)
	}

	// ===== Evento aprobado: llega firmado por la cola =====
	entry := id(`INSERT INTO entries (user_id, entry_type, scope, content) VALUES ($1, 'incidente', 'soc', 'Correo con adjunto malicioso') RETURNING id`, ana)
	auditLog.Log(asAna, "entry.created", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entry.String()})
	auditLog.Log(asAna, "entry.updated", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entry.String()})
	worker := &forward.Worker{Queries: q, Crypto: box, Owner: "nodo-prueba", Hostname: "nodo-prueba"}
	if err := worker.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	hooks := svc.take()
	if len(hooks) != 1 || hooks[0].Path != "/hooks/events" {
		t.Fatalf("solo el evento aprobado: %+v", hooks)
	}
	if hooks[0].Signature != forward.Sign(creds.HookSecret, hooks[0].Timestamp, hooks[0].Body) || !strings.Contains(string(hooks[0].Body), `"entry.created"`) {
		t.Fatalf("firma o cuerpo del evento: %+v %s", hooks[0], hooks[0].Body)
	}

	// ===== Tarea programada: se dispara una vez y se reprograma =====
	exec(`UPDATE complement_schedules SET next_run_at = now() - interval '1 minute' WHERE complement_id = $1`, c.ID)
	if err := h.RunSchedules(ctx); err != nil {
		t.Fatal(err)
	}
	hooks = svc.take()
	if len(hooks) != 1 || hooks[0].Path != "/hooks/schedule/revisar" || hooks[0].Signature != forward.Sign(creds.HookSecret, hooks[0].Timestamp, hooks[0].Body) {
		t.Fatalf("tarea programada: %+v", hooks)
	}
	if count(`SELECT count(*) FROM complement_schedules WHERE complement_id = $1 AND last_status = 'ok' AND next_run_at > now() + interval '5 hours'`, c.ID) != 1 {
		t.Fatal("la tarea no quedó reprogramada")
	}

	// ===== El servicio deja su resultado como seguimiento por la API =====
	if w := apiCall("POST", "/api/v1/entries/"+entry.String()+"/comments", map[string]any{"content": "41 de 72 motores"}); w.Code != 201 {
		t.Fatalf("seguimiento por la API: %d %s", w.Code, w.Body)
	}
	if count(`SELECT count(*) FROM entry_comments WHERE entry_id = $1 AND via = 'VirusTotal' AND user_id = $2`, entry, admin) != 1 {
		t.Fatal("el seguimiento de la API no quedó firmado con el complemento")
	}

	// ===== ADD_NOTE: a nombre de quien lo usa, solo donde se muestra =====
	if w := call(asAna, h.AddNote, "POST", "/x", map[string]any{"target": "entry", "id": entry, "content": "Revisado desde la acción"}, "slug", slug); w.Code != 201 {
		t.Fatalf("ADD_NOTE en la entrada: %d %s", w.Code, w.Body)
	}
	if count(`SELECT count(*) FROM entry_comments WHERE entry_id = $1 AND via = 'VirusTotal' AND user_id = $2`, entry, ana) != 1 {
		t.Fatal("ADD_NOTE no quedó a nombre de la persona")
	}

	// ===== API_REQUEST: lee como la persona, con lo aprobado =====
	w = call(asAna, h.APIRequest, "POST", "/x", map[string]any{"method": "GET", "path": "/entries?limit=5"}, "slug", slug)
	if w.Code != 200 || !strings.Contains(w.Body.String(), entry.String()) {
		t.Fatalf("API_REQUEST de entradas: %d %s", w.Code, w.Body)
	}
	if w := call(asAna, h.APIRequest, "POST", "/x", map[string]any{"path": "/tickets"}, "slug", slug); w.Code != 403 {
		t.Fatalf("API_REQUEST sin tickets:read: %d %s", w.Code, w.Body)
	}
	if w := call(asAna, h.APIRequest, "POST", "/x", map[string]any{"method": "POST", "path": "/entries"}, "slug", slug); w.Code != 405 {
		t.Fatalf("API_REQUEST solo lee: %d %s", w.Code, w.Body)
	}

	// ===== Embed de una ranura: con la ficha abierta =====
	w = call(asAna, h.Embed, "POST", "/x", map[string]any{"slot": "action:buscar", "objectType": "entry", "objectId": entry}, "slug", slug)
	var emb struct {
		URL      string         `json:"url"`
		Settings map[string]any `json:"settings"`
	}
	decode(w, &emb)
	if w.Code != 200 || emb.URL != svc.srv.URL+"/accion.html?object=entry%3A"+entry.String() {
		t.Fatalf("embed de la acción: %d %s", w.Code, w.Body)
	}
	if w := call(asAna, h.Embed, "POST", "/x", map[string]any{"slot": "topbar"}, "slug", slug); w.Code != 404 {
		t.Fatalf("la barra no aprobada no se abre: %d %s", w.Code, w.Body)
	}

	// ===== Configuración: el secreto se guarda cifrado y no vuelve =====
	if w := call(asAdmin, h.PutSettings, "PUT", "/x", map[string]any{"values": map[string]any{"umbral": "7"}}, "slug", slug); w.Code != 400 {
		t.Fatalf("la llave es obligatoria: %d %s", w.Code, w.Body)
	}
	w = call(asAdmin, h.PutSettings, "PUT", "/x", map[string]any{"values": map[string]any{"umbral": "7"}, "secrets": map[string]string{"apiKey": "vt-secreto-7c2e"}}, "slug", slug)
	if w.Code != 200 || strings.Contains(w.Body.String(), "vt-secreto") || !strings.Contains(w.Body.String(), `"last4":"7c2e"`) {
		t.Fatalf("guardar configuración: %d %s", w.Code, w.Body)
	}
	c, _ = q.GetComplementBySlug(ctx, slug)
	rw = httptest.NewRecorder()
	rt.Settings(rw, httptest.NewRequest("GET", "/api/internal/v1/settings", nil).WithContext(ctx), c)
	if !strings.Contains(rw.Body.String(), `"apiKey":"vt-secreto-7c2e"`) || !strings.Contains(rw.Body.String(), `"umbral":7`) {
		t.Fatalf("el servicio lee su configuración: %s", rw.Body)
	}
	decode(call(asAna, h.Embed, "POST", "/x", map[string]any{"slot": "panel:reputacion", "objectType": "ticket", "objectId": uuid.New()}, "slug", slug), &emb)
	if emb.Settings["umbral"] != float64(7) || emb.Settings["apiKey"] != nil {
		t.Fatalf("el navegador ve lo común, nunca el secreto: %+v", emb.Settings)
	}

	// ===== Versión nueva: lo nuevo queda por revisar =====
	svc.mu.Lock()
	svc.manifest = strings.Replace(strings.Replace(vtManifest, `"1.2.0"`, `"1.3.0"`, 1), `{"name": "revisar", "every": "6h"}`,
		`{"name": "revisar", "every": "6h"}, {"name": "lunes", "at": "08:00", "days": ["mon"]}`, 1)
	svc.mu.Unlock()
	w = call(asAdmin, h.RefreshManifest, "POST", "/x", nil, "slug", slug)
	decode(w, &detail)
	if w.Code != 200 || detail.Manifest.Version != "1.3.0" || slices.Contains(detail.Approved, "schedule:lunes") || !slices.Contains(detail.Approved, "schedule:revisar") {
		t.Fatalf("versión nueva: %d %+v", w.Code, detail.Approved)
	}

	// ===== Quitar los datos revoca la llave; apagado desaparece =====
	call(asAdmin, h.SetApprovals, "PUT", "/x", map[string]any{"approved": []string{"panel:reputacion"}}, "slug", slug)
	if w := apiCall("GET", "/api/v1/entries?limit=1", nil); w.Code != 401 {
		t.Fatalf("la llave quedó revocada: %d %s", w.Code, w.Body)
	}
	if count(`SELECT count(*) FROM forward_destinations WHERE complement_id = $1`, c.ID)+count(`SELECT count(*) FROM complement_schedules WHERE complement_id = $1`, c.ID) != 0 {
		t.Fatal("sin eventos ni tareas aprobadas no queda destino ni tarea")
	}
	exec(`UPDATE complements SET status = 'maintenance' WHERE id = $1`, c.ID)
	decode(call(asAna, h.Slots, "GET", "/api/complements/slots", nil), &slots)
	if len(slots.Panels) != 0 {
		t.Fatalf("en mantenimiento desaparece: %+v", slots)
	}
}
