//go:build integration

// Inventario (9.2) contra la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestInventory
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
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestInventory_FichaHistorialYBajas(t *testing.T) {
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
	infraCode, tiCode := "infra"+n, "ti"+n
	infra := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$2) RETURNING id`, infraCode, n)
	ti := id(`INSERT INTO areas (code, name) VALUES ($1, 'TI '||$2) RETURNING id`, tiCode, n)
	person := func(area uuid.UUID, caps []string) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities, profile) VALUES ($1, $1, $2, 'resolutor') RETURNING id`, "g"+uuid.NewString()[:8]+n, caps)
		id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
		u := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "u"+uuid.NewString()[:8]+n)
		id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		return u
	}
	ana := person(infra, []string{})
	jefa := person(infra, []string{CapAreaLead})
	pedro := person(ti, []string{})
	org := id(`INSERT INTO organizations (name, code) VALUES ('Datahouse '||$1, 'dh'||$1) RETURNING id`, n)

	h := &InventoryHandler{Pool: tx, Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	as := func(u uuid.UUID) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: u, Username: "x", Role: "user"})
	}
	call := func(user uuid.UUID, fn func(http.ResponseWriter, *http.Request), method, path string, body any, pathID string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(as(user))
		if pathID != "" {
			r.SetPathValue("id", pathID)
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}

	// Alta: varias IP y responsables (área TI y la organización Datahouse).
	in := map[string]any{
		"kind": "server", "name": "SRV-" + n, "code": "srv-" + n, "area": infraCode,
		"attributes":   map[string]string{"os": "Ubuntu Server", "os_version": "20.04", "ram_gb": "32", "virtualization": "físico"},
		"ips":          []map[string]string{{"kind": "network", "address": "10.99.4.21"}, {"kind": "network", "address": "10.99.4.31"}, {"kind": "vip", "address": "10.99.4.20"}, {"kind": "management", "address": "10.99.99.21"}},
		"responsibles": []map[string]any{{"type": "config", "area": tiCode}, {"type": "power", "organizationId": org}},
	}
	w := call(ana, h.Create, "POST", "/api/inventory", in, "")
	if w.Code != 200 {
		t.Fatalf("crear: %d %s", w.Code, w.Body)
	}
	var created struct{ Data inventoryDetailDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	d := created.Data
	if len(d.IPs) != 4 || len(d.Responsibles) != 2 || d.Attributes["virtualization"] != "Físico" || len(d.Events) != 1 {
		t.Fatalf("ficha creada: %+v", d)
	}
	assetID := d.ID.String()

	// Pedro (TI) es responsable: lo ve en «mi área» y lo puede editar.
	w = call(pedro, h.List, "GET", "/api/inventory?scope=mine&q=srv-"+n, nil, "")
	if !strings.Contains(w.Body.String(), "srv-"+n) {
		t.Errorf("TI responsable no ve el equipo: %s", w.Body)
	}

	// Editar: el cambio de versión y de RAM quedan solos en el historial.
	in["attributes"] = map[string]string{"os": "Ubuntu Server", "os_version": "24.04", "ram_gb": "64", "virtualization": "Físico"}
	w = call(pedro, h.Update, "PUT", "/api/inventory/x", in, assetID)
	if w.Code != 200 {
		t.Fatalf("editar: %d %s", w.Code, w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	texts := []string{}
	for _, e := range created.Data.Events {
		texts = append(texts, e.Description)
	}
	all := strings.Join(texts, " | ")
	if !strings.Contains(all, "Versión: 20.04 → 24.04") || !strings.Contains(all, "RAM (GB): 32 → 64") {
		t.Errorf("historial de cambios: %s", all)
	}
	// Guardar sin cambios no anota nada.
	before := len(created.Data.Events)
	w = call(pedro, h.Update, "PUT", "/api/inventory/x", in, assetID)
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if len(created.Data.Events) != before {
		t.Errorf("sin cambios no debería anotar: %d → %d", before, len(created.Data.Events))
	}

	// Baja: Ana no desactiva (403), pide; la jefa aprueba y queda desactivado.
	if w = call(ana, h.SetActive, "POST", "/api/inventory/x/active", map[string]any{"active": false}, assetID); w.Code != 403 {
		t.Errorf("Ana no desactiva directo: %d", w.Code)
	}
	if w = call(ana, h.Request, "POST", "/api/inventory/x/requests", map[string]string{"action": "deactivate", "reason": "Reemplazado por SRV-02"}, assetID); w.Code != 200 {
		t.Fatalf("solicitud: %d %s", w.Code, w.Body)
	}
	if w = call(ana, h.Request, "POST", "/api/inventory/x/requests", map[string]string{"action": "delete", "reason": "otra"}, assetID); w.Code != 409 {
		t.Errorf("una solicitud pendiente a la vez: %d", w.Code)
	}
	w = call(jefa, h.Requests, "GET", "/api/inventory/requests", nil, "")
	var reqs struct{ Data []assetRequestDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &reqs)
	var rid string
	for _, rq := range reqs.Data {
		if rq.AssetID == d.ID {
			rid = rq.ID.String()
		}
	}
	if rid == "" {
		t.Fatalf("la jefa no ve la solicitud: %s", w.Body)
	}
	w = call(pedro, h.Requests, "GET", "/api/inventory/requests", nil, "")
	if strings.Contains(w.Body.String(), rid) {
		t.Error("TI no decide sobre equipos de Infra")
	}
	if w = call(jefa, h.Decide, "POST", "/api/inventory/requests/x/decide", map[string]any{"approve": true}, rid); w.Code != 200 {
		t.Fatalf("aprobar: %d %s", w.Code, w.Body)
	}
	a, _ := q.GetInventoryAsset(ctx, d.ID)
	if a.Active {
		t.Error("aprobada la baja, el equipo queda inactivo")
	}

	// Ticket resuelto con el equipo como lugar → historial.
	tk := id(`INSERT INTO tickets (ticket_number, client_id, title, description, asset_id) VALUES ($1, $2, 'Disco lleno', 'x', $3) RETURNING id`, "TKT-"+n, org, d.ID)
	ticket, _ := q.GetTicket(ctx, tk)
	recordTicketResolved(as(ana), q, ticket)
	w = call(ana, h.Get, "GET", "/api/inventory/x", nil, assetID)
	if !strings.Contains(w.Body.String(), "Resuelto TKT-"+n+": Disco lleno") {
		t.Errorf("el ticket resuelto no quedó en el historial: %s", w.Body)
	}

	// CSV: revisión (no guarda nada), luego la carga: una fila nueva, una que
	// actualiza y una con error.
	csvBody := "codigo;nombre;area;ips;responsables;os;os_version;ram_gb\n" +
		"srv-" + n + ";SRV-" + n + ";" + infraCode + ";\"Red=10.99.4.21; Red=10.99.4.31\";Configuración y sistema=área:" + tiCode + ";Ubuntu Server;24.04;128\n" +
		"srv-new-" + n + ";SRV-NEW;" + infraCode + ";iLO=10.99.99.30;;Windows Server;2022;64\n" +
		"srv-bad-" + n + ";SRV-BAD;noexiste;;;;;\n"
	w = call(jefa, h.Import, "POST", "/api/inventory/import?kind=server&dryRun=true", csvBody, "")
	var res struct{ Data csvImportResult }
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res.Data.Created != 1 || res.Data.Updated != 1 || res.Data.Errors != 1 || res.Data.Applied {
		t.Fatalf("revisión CSV: %s", w.Body)
	}
	if _, err := q.GetAssetIDByCode(ctx, "srv-new-"+n); err == nil {
		t.Error("la revisión no debe crear nada")
	}
	w = call(jefa, h.Import, "POST", "/api/inventory/import?kind=server", csvBody, "")
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res.Data.Created != 1 || res.Data.Updated != 1 || !res.Data.Applied {
		t.Fatalf("carga CSV: %s", w.Body)
	}
	if _, err := q.GetAssetIDByCode(ctx, "srv-new-"+n); err != nil {
		t.Error("la carga crea el equipo nuevo")
	}
	w = call(ana, h.Get, "GET", "/api/inventory/x", nil, assetID)
	if !strings.Contains(w.Body.String(), "RAM (GB): 64 → 128") {
		t.Errorf("la carga deja los cambios en el historial: %s", w.Body)
	}
}
