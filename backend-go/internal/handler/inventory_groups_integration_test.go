//go:build integration

// Grupos de equipos y ubicación (000061) contra la base real, dentro de una
// transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestInventoryGroups
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

func TestInventoryGroups_UbicacionCompartida(t *testing.T) {
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
	n := fmt.Sprintf("g%d", time.Now().UnixNano())
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
	person := func(area uuid.UUID) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities, profile) VALUES ($1, $1, '{}', 'resolutor') RETURNING id`, "g"+uuid.NewString()[:8]+n)
		id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
		u := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "u"+uuid.NewString()[:8]+n)
		id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		return u
	}
	ana := person(infra)
	pedro := person(ti)
	sitio := id(`INSERT INTO territorial_units (kind, name, code, path) VALUES ('site', 'DC '||$1, $1||'dc', text2ltree($1||'dc')) RETURNING id`, n)

	h := &InventoryHandler{Pool: tx, Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	mh := &MapHandler{Queries: q}
	call := func(user uuid.UUID, fn func(http.ResponseWriter, *http.Request), method, path string, body any, pathID string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else if body != nil {
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
	detail := func(w *httptest.ResponseRecorder) inventoryDetailDTO {
		t.Helper()
		var out struct{ Data inventoryDetailDTO }
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("respuesta: %s", w.Body)
		}
		return out.Data
	}

	// Un equipo suelto con dirección y coordenadas propias; solo latitud no vale.
	suelto := map[string]any{"kind": "server", "name": "SUELTO-" + n, "code": "suelto-" + n, "area": infraCode,
		"address": "Av. Siempre Viva 742", "latitude": -33.4489, "longitude": -70.6693}
	w := call(ana, h.Create, "POST", "/api/inventory", suelto, "")
	if w.Code != 200 {
		t.Fatalf("crear con coordenadas: %d %s", w.Code, w.Body)
	}
	if d := detail(w); d.Address == nil || *d.Address != "Av. Siempre Viva 742" || d.Latitude == nil || *d.Latitude != -33.4489 {
		t.Errorf("dirección y coordenadas: %+v", d)
	}
	malo := map[string]any{"kind": "server", "name": "MALO-" + n, "area": infraCode, "latitude": -33.4}
	if w = call(ana, h.Create, "POST", "/api/inventory", malo, ""); w.Code != 400 {
		t.Errorf("latitud sin longitud: %d", w.Code)
	}

	// Grupo del rack: Pedro (TI) no crea grupos de Infra; Ana sí.
	cliente := id(`INSERT INTO organizations (name, code) VALUES ('Minera '||$1, 'mn'||$1) RETURNING id`, n)
	grupo := map[string]any{"name": "Rack A " + n, "area": infraCode, "territorialUnitId": sitio, "address": "Calle 1", "latitude": -23.65, "longitude": -70.4, "rack": "R-A", "clientId": cliente}
	if w = call(pedro, h.CreateGroup, "POST", "/api/inventory/groups", grupo, ""); w.Code != 403 {
		t.Errorf("TI no crea grupos de Infra: %d", w.Code)
	}
	w = call(ana, h.CreateGroup, "POST", "/api/inventory/groups", grupo, "")
	if w.Code != 201 {
		t.Fatalf("crear grupo: %d %s", w.Code, w.Body)
	}
	var created struct{ Data struct{ ID uuid.UUID } }
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	gid := created.Data.ID

	// Un equipo del grupo toma su ubicación aunque mande otra.
	enGrupo := map[string]any{"kind": "server", "name": "EN-GRUPO-" + n, "code": "engrupo-" + n, "area": infraCode, "groupId": gid,
		"address": "otra", "latitude": 1, "longitude": 1, "rack": "otro", "rackPosition": "U10"}
	w = call(ana, h.Create, "POST", "/api/inventory", enGrupo, "")
	if w.Code != 200 {
		t.Fatalf("crear en grupo: %d %s", w.Code, w.Body)
	}
	d := detail(w)
	if d.GroupName == nil || d.ClientID == nil || *d.ClientID != cliente || *d.Address != "Calle 1" || *d.Latitude != -23.65 || *d.Rack != "R-A" || *d.RackPosition != "U10" || d.TerritorialUnitID == nil || *d.TerritorialUnitID != sitio {
		t.Errorf("el equipo no tomó la ubicación del grupo: %+v", d)
	}
	assetID := d.ID.String()

	// Mover el grupo mueve a sus equipos y queda en su historial.
	grupo["address"], grupo["latitude"], grupo["longitude"] = "Calle 2", -22.45, -68.92
	w = call(ana, h.UpdateGroup, "PUT", "/api/inventory/groups/x", grupo, gid.String())
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"assetsMoved":1`) {
		t.Fatalf("editar grupo: %d %s", w.Code, w.Body)
	}
	w = call(ana, h.Get, "GET", "/api/inventory/x", nil, assetID)
	if d = detail(w); *d.Address != "Calle 2" || *d.Latitude != -22.45 || !strings.Contains(w.Body.String(), "Ubicación cambiada con el grupo") {
		t.Errorf("el equipo no siguió al grupo: %s", w.Body)
	}

	// Lista filtrada por grupo y el CSV con la columna grupo.
	w = call(ana, h.List, "GET", "/api/inventory?group="+gid.String(), nil, "")
	if !strings.Contains(w.Body.String(), "engrupo-"+n) || strings.Contains(w.Body.String(), "suelto-"+n) {
		t.Errorf("filtro por grupo: %s", w.Body)
	}
	csvBody := "codigo;nombre;area;grupo;posicion\n" + "csv-" + n + ";CSV-" + n + ";" + infraCode + ";Rack A " + n + ";U12\n"
	w = call(ana, h.Import, "POST", "/api/inventory/import?kind=server", csvBody, "")
	if !strings.Contains(w.Body.String(), `"created":1`) {
		t.Fatalf("CSV con grupo: %s", w.Body)
	}
	csvID, _ := q.GetAssetIDByCode(ctx, "csv-"+n)
	if a, _ := q.GetInventoryAsset(ctx, csvID); a.Address.String != "Calle 2" || a.Rack.String != "R-A" {
		t.Errorf("el CSV no tomó la ubicación del grupo: %+v", a)
	}
	// Un CSV sin las columnas nuevas no le borra la dirección al equipo suelto.
	old := "codigo;nombre;area;serie\n" + "suelto-" + n + ";SUELTO-" + n + ";" + infraCode + ";S123\n"
	call(ana, h.Import, "POST", "/api/inventory/import?kind=server", old, "")
	sid, _ := q.GetAssetIDByCode(ctx, "suelto-"+n)
	if a, _ := q.GetInventoryAsset(ctx, sid); a.Address.String != "Av. Siempre Viva 742" || a.Latitude == nil {
		t.Errorf("el CSV viejo borró la ubicación: %+v", a)
	}

	// El mapa: Ana ve sus equipos con coordenadas, en verde si nada los afecta;
	// rojo con un ticket abierto o una entrada de incidente; ámbar en mantenimiento.
	mapa := func() map[string]mapAssetDTO {
		t.Helper()
		w := call(ana, mh.Assets, "GET", "/api/map/assets", nil, "")
		var out struct{ Data []mapAssetDTO }
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		m := map[string]mapAssetDTO{}
		for _, a := range out.Data {
			m[a.Code] = a
		}
		return m
	}
	m := mapa()
	if m["suelto-"+n].Status != "ok" || m["engrupo-"+n].Status != "ok" || m["engrupo-"+n].ClientName == nil {
		t.Errorf("mapa de Ana: %+v", m)
	}
	if _, err := tx.Exec(ctx, `UPDATE system_features SET is_enabled = true WHERE code = 'native_tickets'`); err != nil {
		t.Fatal(err)
	}
	id(`INSERT INTO tickets (ticket_number, client_id, title, description, asset_id, area_id) VALUES ($1, $2, 'Sin enlace', 'x', $3, $4) RETURNING id`, "TKT-"+n, cliente, d.ID, infra)
	id(`INSERT INTO entries (user_id, entry_type, scope, content, asset_id) VALUES ($1, 'incidente', 'noc', 'Corte de fibra en el tramo norte', $2) RETURNING id`, ana, sid)
	id(`INSERT INTO maintenance_windows (title, starts_at, ends_at, created_by, asset_id) VALUES ('Cambio de fuente', now() - interval '1 hour', now() + interval '1 hour', $1, $2) RETURNING id`, ana, csvID)
	m = mapa()
	if a := m["engrupo-"+n]; a.Status != "bad" || a.Ticket == nil || a.Ticket.Number != "TKT-"+n || a.Ticket.Title != "Sin enlace" {
		t.Errorf("ticket abierto → rojo: %+v", a)
	}
	if a := m["suelto-"+n]; a.Status != "bad" || a.Entry == nil || !strings.Contains(a.Entry.Content, "Corte de fibra") {
		t.Errorf("entrada de incidente → rojo: %+v", a)
	}
	if a := m["csv-"+n]; a.Status != "warn" || a.Maintenance == nil || a.Maintenance.Title != "Cambio de fuente" {
		t.Errorf("mantenimiento → ámbar: %+v", a)
	}
	w = call(pedro, mh.Assets, "GET", "/api/map/assets", nil, "")
	if strings.Contains(w.Body.String(), n) {
		t.Errorf("TI no ve equipos de Infra en el mapa: %s", w.Body)
	}

	// Borrar el grupo: los equipos quedan sin grupo y con la ubicación.
	if w = call(ana, h.DeleteGroup, "DELETE", "/api/inventory/groups/x", nil, gid.String()); w.Code != 204 {
		t.Fatalf("borrar grupo: %d %s", w.Code, w.Body)
	}
	w = call(ana, h.Get, "GET", "/api/inventory/x", nil, assetID)
	if d = detail(w); d.GroupID != nil || d.Address == nil || *d.Address != "Calle 2" {
		t.Errorf("tras borrar el grupo: %+v", d)
	}
}
