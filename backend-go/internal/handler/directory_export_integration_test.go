//go:build integration

// Exportar el directorio a CSV (paridad con el legacy, 2026-10-16) contra
// Postgres, dentro de una transacción que se deshace.
package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDirectoryExport(t *testing.T) {
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
	box, err := crypto.New(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatal(err)
	}
	n := fmt.Sprintf("dx%d", time.Now().UnixNano())
	var org string
	if err := tx.QueryRow(ctx, `INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, $1) RETURNING id`, n).Scan(&org); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO contacts (organization_id, name, position, scope, is_favorite) VALUES
		($1, 'Ana '||$2, '=HYPERLINK("x")', 'internal', true), ($1, 'Beto '||$2, NULL, 'external', false)`, org, n); err != nil {
		t.Fatal(err)
	}

	rec := &recordedAudit{}
	h := &DirectoryHandler{Queries: db.New(tx), Crypto: box, AuditLog: audit.NewLogger(rec, slog.Default())}
	r := httptest.NewRequest("GET", "/api/directory/export?organizationId="+org, nil).
		WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{Role: "admin"}))
	w := httptest.NewRecorder()
	h.Export(w, r)
	if w.Code != 200 {
		t.Fatalf("export: %d %s", w.Code, w.Body)
	}
	body := w.Body.String()
	if !strings.Contains(body, `'=HYPERLINK`) {
		t.Errorf("una fórmula debe salir neutralizada:\n%s", body)
	}
	// El archivo vuelve a entrar por la importación tal cual.
	rows, errs := directory.ParseCSV(body)
	if len(errs) != 0 || len(rows) != 2 {
		t.Fatalf("re-importar: %d filas, errores %v", len(rows), errs)
	}
	if rows[0].Name != "Ana "+n || rows[0].Scope != directory.ScopeInternal || !rows[0].IsFavorite || rows[0].Organization != "Cliente "+n {
		t.Errorf("fila Ana: %+v", rows[0])
	}
	if rows[1].IsFavorite || rows[1].Scope != directory.ScopeExternal {
		t.Errorf("fila Beto: %+v", rows[1])
	}
}
