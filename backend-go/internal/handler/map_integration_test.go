//go:build integration

// Mapa (#24) contra la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestMap
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMap_PuntosYDetalle(t *testing.T) {
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
	region := id(`INSERT INTO territorial_units (kind, name, code, path, latitude, longitude) VALUES ('region', 'Región '||$1, $1||'r', text2ltree($1||'r'), -23.6, -70.4) RETURNING id`, n)
	zone := id(`INSERT INTO territorial_units (parent_id, kind, name, code, path, latitude, longitude) VALUES ($2, 'zone', 'Zona '||$1, $1||'z', text2ltree($1||'r.'||$1||'z'), -22.45, -68.92) RETURNING id`, n, region)
	quiet := id(`INSERT INTO territorial_units (parent_id, kind, name, code, path, latitude, longitude) VALUES ($2, 'zone', 'Tranquila '||$1, $1||'q', text2ltree($1||'r.'||$1||'q'), -24.0, -70.0) RETURNING id`, n, region)
	noCoords := id(`INSERT INTO territorial_units (parent_id, kind, name, code, path) VALUES ($2, 'site', 'Sin '||$1, $1||'s', text2ltree($1||'r.'||$1||'s')) RETURNING id`, n, region)
	user := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, n)
	asset := id(`INSERT INTO assets (type, name, code, territorial_unit_id) VALUES ('device', 'Router '||$1, $1||'a', $2) RETURNING id`, n, zone)
	id(`INSERT INTO escalation_incidents (asset_id, title, opened_by) VALUES ($1, 'Caída troncal', $2) RETURNING id`, asset, user)
	id(`INSERT INTO escalation_incidents (territorial_unit_id, title, opened_by, closed_at, closed_by) VALUES ($1, 'Cerrado', $2, now(), $2) RETURNING id`, zone, user)
	id(`INSERT INTO maintenance_windows (territorial_unit_id, title, starts_at, ends_at, created_by) VALUES ($1, 'Cambio de equipos', now() - interval '1 hour', now() + interval '2 hours', $2) RETURNING id`, zone, user)
	id(`INSERT INTO maintenance_windows (territorial_unit_id, title, starts_at, ends_at, created_by) VALUES ($1, 'Futura', now() + interval '1 day', now() + interval '2 days', $2) RETURNING id`, quiet, user)
	team := id(`INSERT INTO teams (name, slug) VALUES ('Cuadrilla '||$1, $1) RETURNING id`, n)
	id(`INSERT INTO team_coverage (team_id, territorial_unit_id) VALUES ($1, $2) RETURNING team_id`, team, region)

	// Tickets con lugar (000038): uno abierto por su activo, uno cerrado.
	org := id(`INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, $1||'o') RETURNING id`, n)
	ticket := func(num, status string) uuid.UUID {
		return id(`INSERT INTO tickets (ticket_number, client_id, title, description, status) VALUES ($1, $2, 'Sin internet', 'x', $3::ticket_status) RETURNING id`, num, org, status)
	}
	open := ticket("TKT-"+n+"-1", "new")
	closed := ticket("TKT-"+n+"-2", "closed")
	for _, tk := range []uuid.UUID{open, closed} {
		if err := q.SetTicketPlace(ctx, db.SetTicketPlaceParams{ID: tk, AssetID: pgtype.UUID{Bytes: asset, Valid: true}, TerritorialUnitID: pgtype.UUID{Bytes: zone, Valid: true}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE system_features SET is_enabled = true WHERE code = 'native_tickets'`); err != nil {
		t.Fatal(err)
	}

	h := &MapHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}

	w := httptest.NewRecorder()
	h.Points(w, httptest.NewRequest("GET", "/api/map/points", nil))
	if w.Code != 200 {
		t.Fatalf("points: %d %s", w.Code, w.Body)
	}
	var points struct{ Data []mapPointDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &points)
	byID := map[uuid.UUID]mapPointDTO{}
	for _, p := range points.Data {
		byID[p.ID] = p
	}
	z, ok := byID[zone]
	if !ok {
		t.Fatal("la zona con coordenadas no aparece")
	}
	if z.OpenIncidents != 1 || z.LastIncidentTitle == nil || *z.LastIncidentTitle != "Caída troncal" {
		t.Errorf("incidente del activo no cuenta para su zona: %+v", z)
	}
	if z.MaintenanceUntil == nil || z.MaintenanceTitle == nil || *z.MaintenanceTitle != "Cambio de equipos" {
		t.Errorf("falta el mantenimiento activo: %+v", z)
	}
	if z.OpenTickets != 1 || z.LastTicketTitle == nil || *z.LastTicketTitle != "TKT-"+n+"-1 · Sin internet" {
		t.Errorf("tickets abiertos de la zona: %d %v", z.OpenTickets, z.LastTicketTitle)
	}
	if z.ParentName == nil || *z.ParentName != "Región "+n {
		t.Errorf("parentName = %v", z.ParentName)
	}
	if qz := byID[quiet]; qz.OpenIncidents != 0 || qz.MaintenanceUntil != nil {
		t.Errorf("una ventana futura no es mantenimiento activo: %+v", qz)
	}
	if _, ok := byID[noCoords]; ok {
		t.Error("una localidad sin coordenadas no va en el mapa")
	}

	r := httptest.NewRequest("GET", "/api/map/units/x", nil)
	r.SetPathValue("id", zone.String())
	w = httptest.NewRecorder()
	h.Unit(w, r)
	if w.Code != 200 {
		t.Fatalf("unit: %d %s", w.Code, w.Body)
	}
	var detail struct{ Data mapUnitDTO }
	_ = json.Unmarshal(w.Body.Bytes(), &detail)
	if len(detail.Data.Incidents) != 1 || detail.Data.Incidents[0].AssetName == nil {
		t.Errorf("incidentes: %+v", detail.Data.Incidents)
	}
	if len(detail.Data.Windows) != 1 {
		t.Errorf("ventanas: %+v", detail.Data.Windows)
	}
	if len(detail.Data.Teams) != 1 || detail.Data.Teams[0].CoveredVia != "Región "+n {
		t.Errorf("equipos (cubre la región): %+v", detail.Data.Teams)
	}
	if len(detail.Data.Tickets) != 1 || detail.Data.Tickets[0].ID != open || detail.Data.Tickets[0].AssetName == nil {
		t.Errorf("tickets: %+v", detail.Data.Tickets)
	}

	// Con la Ticketera apagada, los tickets no entran al mapa.
	if _, err := tx.Exec(ctx, `UPDATE system_features SET is_enabled = false WHERE code = 'native_tickets'`); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	h.Points(w, httptest.NewRequest("GET", "/api/map/points", nil))
	points.Data = nil
	_ = json.Unmarshal(w.Body.Bytes(), &points)
	for _, p := range points.Data {
		if p.ID == zone && p.OpenTickets != 0 {
			t.Errorf("Ticketera apagada y la zona cuenta %d tickets", p.OpenTickets)
		}
	}

	r = httptest.NewRequest("GET", "/api/map/units/x", nil)
	r.SetPathValue("id", uuid.NewString())
	w = httptest.NewRecorder()
	h.Unit(w, r)
	if w.Code != 404 {
		t.Errorf("localidad inexistente: %d", w.Code)
	}
}
