//go:build integration

// Bitácora: filtros por autor y cliente, y etiquetas (paridad con el legacy,
// 2026-10-16), contra Postgres dentro de una transacción que se deshace.
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

func TestEntries_FiltrosYEtiquetas(t *testing.T) {
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
	n := fmt.Sprintf("ef%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	ana := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1||'@t.local', 'x') RETURNING id`, "ana"+n)
	beto := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1||'@t.local', 'x') RETURNING id`, "beto"+n)
	org := id(`INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, 'c'||$1) RETURNING id`, n)
	svc := id(`INSERT INTO services (organization_id, name, code) VALUES ($1, 'SIEM', 's'||$2) RETURNING id`, org, n)
	tag := "t" + n
	id(`INSERT INTO entries (user_id, entry_type, scope, content, tags, service_id) VALUES ($1, 'operativa', 'soc', 'con servicio', $2, $3) RETURNING id`, ana, []string{tag, "Mayus" + n}, svc)
	id(`INSERT INTO entries (user_id, entry_type, scope, content, tags) VALUES ($1, 'operativa', 'soc', 'del legacy', $2) RETURNING id`, beto, []string{"Cliente:cliente " + n, tag})
	id(`INSERT INTO entries (user_id, entry_type, scope, content, tags) VALUES ($1, 'operativa', 'general', 'otra', $2) RETURNING id`, beto, []string{"mayus" + n})

	h := &EntriesHandler{Queries: db.New(tx), AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	call := func(user uuid.UUID, role string, fn http.HandlerFunc, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: "x", Role: role}))
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	total := func(user uuid.UUID, query string) int {
		t.Helper()
		w := call(user, "user", h.List, "GET", "/api/entries?"+query, nil)
		var out struct {
			Data struct{ Total int }
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body)
		}
		return out.Data.Total
	}
	// Cliente: por su servicio y por la etiqueta cliente:X del ETL (sin distinguir mayúsculas).
	if got := total(ana, "client="+org.String()); got != 2 {
		t.Errorf("por cliente: %d", got)
	}
	if got := total(ana, "author=me&tag="+tag); got != 1 {
		t.Errorf("mías: %d", got)
	}
	if got := total(ana, "author="+beto.String()+"&client="+org.String()); got != 1 {
		t.Errorf("autor y cliente: %d", got)
	}
	if w := call(ana, "user", h.List, "GET", "/api/entries?author=nadie", nil); w.Code != 400 {
		t.Errorf("autor inválido: %d", w.Code)
	}
	if w := call(ana, "user", h.Authors, "GET", "/api/entries/authors", nil); !strings.Contains(w.Body.String(), "beto"+n) {
		t.Errorf("autores: %s", w.Body)
	}
	// Sugerencias: por prefijo y sin distinguir mayúsculas.
	if w := call(ana, "user", h.SuggestTags, "GET", "/api/entries/tags?q=MAYUS"+n, nil); !strings.Contains(w.Body.String(), "Mayus"+n) || !strings.Contains(w.Body.String(), "mayus"+n) {
		t.Errorf("sugerencias: %s", w.Body)
	}
	// Renombrar junta las dos variantes; la entrada que ya tenía la nueva no la repite.
	if w := call(ana, "admin", h.RenameTag, "POST", "/x", map[string]string{"from": "Mayus" + n, "to": "mayus" + n}); w.Code != 200 {
		t.Fatalf("renombrar: %d %s", w.Code, w.Body)
	}
	var uses int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM entries WHERE $1 = ANY(tags)`, "mayus"+n).Scan(&uses)
	if uses != 2 {
		t.Errorf("después de renombrar: %d entradas", uses)
	}
	if w := call(ana, "admin", h.DeleteTag, "POST", "/x", map[string]string{"tag": tag}); w.Code != 200 || !strings.Contains(w.Body.String(), `"entries":2`) {
		t.Errorf("borrar: %d %s", w.Code, w.Body)
	}
	if got := total(ana, "tag="+tag); got != 0 {
		t.Errorf("quedó la etiqueta borrada: %d", got)
	}
}
