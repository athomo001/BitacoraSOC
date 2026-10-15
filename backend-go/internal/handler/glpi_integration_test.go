//go:build integration

// Importación desde GLPI (9.6) contra la base real y un GLPI falso, dentro de
// una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestGlpi
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
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGlpi_ImportaActualizaVinculaYDaDeBaja(t *testing.T) {
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
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	infra := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "infra"+n)
	org := id(`INSERT INTO organizations (name, code) VALUES ('Casinos '||$1, 'cas'||$1) RETURNING id`, n)
	unit := id(`INSERT INTO territorial_units (kind, name, code, path) VALUES ('region', 'Datahouse'||$1, $1||'dh', text2ltree($1||'dh')) RETURNING id`, n)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	appAsset := id(`INSERT INTO assets (type, kind_code, name, code, area_id) VALUES ('device', 'computer', 'NB-APP-'||$1, 'nb_app_'||$1, $2) RETURNING id`, n, infra)
	exec(`UPDATE assets SET serial = 'APPSER-'||$1 WHERE id = $2`, n, appAsset)
	exec(`UPDATE system_features SET is_enabled = true WHERE code = 'glpi_sync'`)

	fake := glpitest.New("app-tok", "user-tok")
	defer fake.Close()
	fake.Set("Entity",
		map[string]any{"id": 0, "completename": "Raíz"},
		map[string]any{"id": 3, "completename": "Raíz &#62; Casinos"},
		map[string]any{"id": 5, "completename": "Raíz &#62; Laboratorio"})
	server := map[string]any{"id": 1042, "name": "SRV-ERP-" + n, "serial": "CZ" + n, "manufacturers_id": "HPE", "computermodels_id": "ProLiant DL380",
		"computertypes_id": "Server", "locations_id": "Santiago &#62; Datahouse" + n, "entities_id": "Raíz &#62; Casinos", "is_deleted": 0}
	laptop := map[string]any{"id": 1311, "name": "NB-CONT-" + n, "serial": "APPSER-" + n, "computertypes_id": "Laptop", "entities_id": "Raíz", "is_deleted": 0}
	lab := map[string]any{"id": 1203, "name": "LAB-PC-" + n, "entities_id": "Raíz &#62; Laboratorio", "is_deleted": 0}
	sw := map[string]any{"id": 88, "name": "SW-ACC-" + n, "serial": "FOC" + n, "networkequipmenttypes_id": "Switch", "entities_id": "Raíz", "is_deleted": 0}
	fake.Set("Computer", server, laptop, lab)
	fake.Set("NetworkEquipment", sw)
	fake.Set("OperatingSystem", map[string]any{"id": 4, "name": "Windows Server 2022"})
	fake.Set("OperatingSystemVersion", map[string]any{"id": 9, "name": "21H2"})
	fake.Set("Item_OperatingSystem", map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "operatingsystems_id": 4, "operatingsystemversions_id": 9})
	fake.Set("Item_DeviceMemory", map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "size": 131072})
	fake.Set("IPAddress", map[string]any{"id": 1, "mainitemtype": "Computer", "mainitems_id": 1042, "name": "10.10.6.40"})

	box, err := crypto.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	rec := &recordedAudit{}
	auditLog := audit.NewLogger(rec, slog.Default())
	inv := &InventoryHandler{Pool: tx, Queries: q, AuditLog: auditLog}
	h := &GlpiHandler{Queries: q, Crypto: box, AuditLog: auditLog, Notify: &Notifier{Queries: q, AuditLog: auditLog}, Inventory: inv}
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
	type planResp struct{ Data glpiPlan }
	preview := func() glpiPlan {
		t.Helper()
		w := call(h.Preview, "POST", "/api/glpi/preview", nil)
		if w.Code != 200 {
			t.Fatalf("revisar: %d %s", w.Code, w.Body)
		}
		var p planResp
		_ = json.Unmarshal(w.Body.Bytes(), &p)
		return p.Data
	}
	importNow := func() glpiRunDTO {
		t.Helper()
		w := call(h.Import, "POST", "/api/glpi/import", nil)
		if w.Code != 200 {
			t.Fatalf("importar: %d %s", w.Code, w.Body)
		}
		var r struct{ Data glpiRunDTO }
		_ = json.Unmarshal(w.Body.Bytes(), &r)
		return r.Data
	}
	byGlpi := func(itemtype string, glpiID int) (uuid.UUID, bool, string) {
		t.Helper()
		var aid uuid.UUID
		var active bool
		var attrs string
		if err := tx.QueryRow(ctx, `SELECT id, active, attributes::text FROM assets WHERE glpi_itemtype = $1 AND glpi_id = $2`, itemtype, glpiID).Scan(&aid, &active, &attrs); err != nil {
			t.Fatalf("equipo %s #%d: %v", itemtype, glpiID, err)
		}
		return aid, active, attrs
	}

	// Configuración: tokens cifrados, área dueña, Casinos → cliente, Laboratorio no se importa.
	w := call(h.PutConfig, "PUT", "/api/glpi/config", map[string]any{
		"url": fake.Server.URL, "appToken": "app-tok", "userToken": "user-tok", "verifyTls": true, "timeoutSeconds": 5,
		"importComputers": true, "importNetwork": true, "areaId": infra, "computerTypes": map[string]string{"Server": "server"},
		"entities": map[string]any{"3": map[string]any{"organizationId": org}, "5": map[string]any{"skip": true}}, "autoMode": "off",
	})
	if w.Code != 200 || strings.Contains(w.Body.String(), "user-tok") || !strings.Contains(w.Body.String(), `"hasUserToken":true`) {
		t.Fatalf("guardar: %d %s", w.Code, w.Body)
	}
	if w := call(h.Test, "POST", "/api/glpi/test", nil); !strings.Contains(w.Body.String(), `"ok":true`) || !strings.Contains(w.Body.String(), `"computers":3`) {
		t.Fatalf("probar: %s", w.Body)
	}

	// Revisión: 2 nuevos (servidor y switch); se saltan la laptop (misma serie que uno de la app) y el laboratorio.
	p := preview()
	if p.Counts["create"] != 2 || p.Counts["skip"] != 2 || p.Computers != 3 || p.Network != 1 {
		t.Fatalf("revisión: %+v", p.Counts)
	}
	var link *glpiPlanRow
	for i, r := range p.Rows {
		if r.GlpiID == 1311 {
			link = &p.Rows[i]
		}
	}
	if link == nil || link.LinkAssetID == nil || *link.LinkAssetID != appAsset {
		t.Fatalf("la laptop debería ofrecer vincularse con el equipo de la app: %+v", p.Rows)
	}
	if run := importNow(); !run.OK || run.Created != 2 || run.Skipped != 2 {
		t.Fatalf("importar: %+v", run)
	}
	srvID, _, attrs := byGlpi("Computer", 1042)
	var kind, model string
	var client, place uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT kind_code, model, client_id, territorial_unit_id FROM assets WHERE id = $1`, srvID).Scan(&kind, &model, &client, &place); err != nil {
		t.Fatal(err)
	}
	if kind != "server" || model != "HPE ProLiant DL380" || client != org || place != unit || !strings.Contains(attrs, `"ram_gb": "128"`) || !strings.Contains(attrs, "Windows Server 2022") {
		t.Fatalf("servidor importado: %s %s %v %v %s", kind, model, client, place, attrs)
	}
	if p := preview(); p.Counts["create"] != 0 || p.Counts["unchanged"] != 2 {
		t.Fatalf("reimportar sin cambios no debe duplicar: %+v", p.Counts)
	}

	// GLPI manda en sus campos; lo de la Bitácora (rack) se queda.
	exec(`UPDATE assets SET rack = 'DC1-R06' WHERE id = $1`, srvID)
	fake.Set("Item_DeviceMemory", map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "size": 262144})
	if run := importNow(); run.Updated != 1 {
		t.Fatalf("actualizar: %+v", run)
	}
	var rack, events string
	_ = tx.QueryRow(ctx, `SELECT rack FROM assets WHERE id = $1`, srvID).Scan(&rack)
	_ = tx.QueryRow(ctx, `SELECT string_agg(kind || ':' || description, ' | ') FROM asset_events WHERE asset_id = $1`, srvID).Scan(&events)
	if rack != "DC1-R06" || !strings.Contains(events, "glpi:RAM (GB): 128 → 256") || !strings.Contains(events, "glpi:Equipo importado desde GLPI") {
		t.Fatalf("rack %q, historial %q", rack, events)
	}

	// Vincular la laptop: desde ahí GLPI la actualiza (nombre y tipo).
	if w := call(h.Link, "POST", "/api/glpi/link", map[string]any{"assetId": appAsset, "itemtype": "Computer", "glpiId": 1311}); w.Code != 200 {
		t.Fatalf("vincular: %d %s", w.Code, w.Body)
	}
	if run := importNow(); run.Updated != 1 || run.Skipped != 1 {
		t.Fatalf("tras vincular: %+v", run)
	}

	// El switch va a la papelera: queda inactivo; si vuelve, se reactiva.
	sw["is_deleted"] = 1
	fake.Set("NetworkEquipment", sw)
	if run := importNow(); run.Deactivated != 1 {
		t.Fatalf("baja: %+v", run)
	}
	if _, active, _ := byGlpi("NetworkEquipment", 88); active {
		t.Fatal("el switch en la papelera debería quedar inactivo")
	}
	sw["is_deleted"] = 0
	fake.Set("NetworkEquipment", sw)
	if run := importNow(); run.Reactivated != 1 {
		t.Fatalf("reactivar: %+v", run)
	}
	if _, active, _ := byGlpi("NetworkEquipment", 88); !active {
		t.Fatal("el switch que volvió debería reactivarse")
	}

	// Seguro: si desaparece todo (3 de 3), la automática no da de baja y avisa.
	fake.Set("Computer", lab)
	fake.Set("NetworkEquipment")
	exec(`UPDATE glpi_config SET auto_mode = '6h', last_auto_at = NULL, last_failure_notified_on = NULL`)
	if err := h.AutoTick(asAdmin); err != nil {
		t.Fatal(err)
	}
	var held, deact int32
	_ = tx.QueryRow(ctx, `SELECT held_back, deactivated FROM glpi_import_runs WHERE trigger = 'auto'`).Scan(&held, &deact)
	if held != 3 || deact != 0 {
		t.Fatalf("seguro: retenidas %d, bajas %d", held, deact)
	}
	if _, active, _ := byGlpi("Computer", 1042); !active {
		t.Fatal("la automática no debió dar de baja con el seguro activo")
	}
	var notified int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1 AND kind = 'glpi.import'`, admin).Scan(&notified)
	if notified != 1 {
		t.Fatalf("aviso a los administradores: %d", notified)
	}
	// La siguiente corrida automática es en 6 horas.
	if err := h.AutoTick(asAdmin); err != nil {
		t.Fatal(err)
	}
	var runs int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM glpi_import_runs WHERE trigger = 'auto'`).Scan(&runs)
	if runs != 1 {
		t.Fatalf("corridas automáticas: %d", runs)
	}

	// Apagada la funcionalidad, la API no responde.
	exec(`UPDATE system_features SET is_enabled = false WHERE code = 'glpi_sync'`)
	if w := call(h.GetConfig, "GET", "/api/glpi/config", nil); w.Code != http.StatusForbidden {
		t.Fatalf("apagada: %d", w.Code)
	}
}
