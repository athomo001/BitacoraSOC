//go:build integration

// Importar eventos del catálogo y borrar fuentes de log (paridad con el
// legacy, 2026-10-16) contra Postgres, dentro de una transacción que se deshace.
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCatalogParity(t *testing.T) {
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
	n := fmt.Sprintf("cp%d", time.Now().UnixNano())
	q := db.New(tx)
	userCtx := middleware.WithUser(ctx, middleware.AuthenticatedUser{Role: "admin"})

	// ===== Importar eventos =====
	if _, err := tx.Exec(ctx, `INSERT INTO report_events (name, parent) VALUES ('Ya '||$1, 'Cat')`, n); err != nil {
		t.Fatal(err)
	}
	reports := &ReportsHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "eventos.csv")
	fmt.Fprintf(fw, "nombre,categoria,motivo\nNuevo %[1]s,Cat,Motivo\nya %[1]s,cat,\n,Cat,sin nombre\nNuevo %[1]s,Cat,repetido en el archivo\n", n)
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/api/report-events/import", &body).WithContext(userCtx)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	reports.ImportReportEvents(w, r)
	if w.Code != 200 {
		t.Fatalf("importar: %d %s", w.Code, w.Body)
	}
	var res struct {
		Data importEventsResult `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	if res.Data.Created != 1 || res.Data.Skipped != 2 || len(res.Data.Errors) != 1 || res.Data.Errors[0].Line != 4 {
		t.Errorf("resultado: %+v", res.Data)
	}

	// ===== Borrar fuentes de log =====
	orgs := &OrganizationsHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	src := func(code string) uuid.UUID {
		var id uuid.UUID
		if err := tx.QueryRow(ctx, `INSERT INTO catalog_log_sources (code, display_name, category) VALUES ($1, $1, 'network') RETURNING id`, code+n).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	free, used := src("libre"), src("usada")
	var tu uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM territorial_units LIMIT 1`).Scan(&tu); err != nil {
		t.Skip("sin unidades territoriales para crear un activo")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assets (code, name, type, territorial_unit_id, log_source_id) VALUES ($1, 'Activo', 'device', $2, $3)`, n, tu, used); err != nil {
		t.Fatal(err)
	}
	del := func(id uuid.UUID) int {
		r := httptest.NewRequest("DELETE", "/api/log-sources/"+id.String(), nil).WithContext(userCtx)
		r.SetPathValue("id", id.String())
		w := httptest.NewRecorder()
		orgs.DeleteLogSource(w, r)
		return w.Code
	}
	if c := del(used); c != 409 {
		t.Errorf("en uso: %d", c)
	}
	if c := del(free); c != 204 {
		t.Errorf("libre: %d", c)
	}
	if c := del(free); c != 404 {
		t.Errorf("ya borrada: %d", c)
	}
}
