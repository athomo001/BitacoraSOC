//go:build integration

// Borrar y unir áreas contra la base real, dentro de una transacción que se
// deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestAreaMerge
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
	"sort"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAreaMerge_UnirYBorrar(t *testing.T) {
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
	nonce := fmt.Sprintf("%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	from, into, empty := "x_"+nonce, "y_"+nonce, "z_"+nonce
	fromID := id(`INSERT INTO areas (code, name) VALUES ($1, 'Vieja') RETURNING id`, from)
	intoID := id(`INSERT INTO areas (code, name) VALUES ($1, 'Nueva') RETURNING id`, into)
	id(`INSERT INTO areas (code, name) VALUES ($1, 'Vacía') RETURNING id`, empty)
	person := func(name string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash) VALUES ($1, $1 || '@test.local', $1, 'x') RETURNING id`, name+nonce)
	}
	admin := id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', $1, 'x', 'admin') RETURNING id`, "adm"+nonce)
	u1, u2 := person("uno"), person("dos")
	levels, _ := q.ListLevels(ctx)
	sort.Slice(levels, func(i, j int) bool { return levels[i].Rank < levels[j].Rank })
	n1, n2 := levels[0].ID.String(), levels[1].ID.String()
	team := id(`INSERT INTO teams (name, slug, area_id) VALUES ($1, $1, $2) RETURNING id`, "equipo"+nonce, fromID)

	logger := audit.NewLogger(&recordedAudit{}, slog.Default())
	place := &PlacementHandler{Queries: q, Pool: tx, AuditLog: logger}
	areas := &AreasHandler{Queries: q, Pool: tx, AuditLog: logger}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Role: "admin"})
	call := func(fn http.HandlerFunc, method string, body any, path map[string]string) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, "/", &buf).WithContext(asAdmin)
		for k, v := range path {
			r.SetPathValue(k, v)
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	put := func(user uuid.UUID, a ...placementArea) {
		t.Helper()
		if w := call(place.Put, "PUT", placementDTO{Areas: a, Extras: []string{}}, map[string]string{"id": user.String()}); w.Code != http.StatusOK {
			t.Fatalf("ubicar: %d %s", w.Code, w.Body)
		}
	}
	put(u1, placementArea{Code: from, LevelID: n2}, placementArea{Code: into, LevelID: n1})
	put(u2, placementArea{Code: from, LevelID: n1})

	// Con gente y datos no se borra; vacía sí.
	if w := call(areas.Delete, "DELETE", nil, map[string]string{"code": from}); w.Code != http.StatusConflict {
		t.Fatalf("un área con gente no se borra: %d", w.Code)
	}
	if w := call(areas.Delete, "DELETE", nil, map[string]string{"code": "soc"}); w.Code != http.StatusConflict {
		t.Fatalf("SOC no se borra: %d", w.Code)
	}
	if w := call(areas.Delete, "DELETE", nil, map[string]string{"code": empty}); w.Code != http.StatusNoContent {
		t.Fatalf("borrar un área vacía: %d %s", w.Code, w.Body)
	}

	// Unir: la gente pasa con su nivel (el de más rango si ya estaba) y los datos también.
	if w := call(areas.Merge, "POST", map[string]any{"into": from}, map[string]string{"code": from}); w.Code != http.StatusBadRequest {
		t.Fatalf("no se une consigo misma: %d", w.Code)
	}
	w := call(areas.Merge, "POST", map[string]any{"into": into}, map[string]string{"code": from})
	var out struct {
		Data struct {
			Moved int          `json:"moved"`
			Usage areaUsageDTO `json:"usage"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != http.StatusOK {
		t.Fatalf("unir: %d %s", w.Code, w.Body)
	}
	if out.Data.Moved != 2 || !out.Data.Usage.Empty {
		t.Fatalf("pasan 2 personas y el área queda vacía: %+v", out.Data)
	}
	levelIn := func(user uuid.UUID) map[string]string {
		p, _ := placementOf(ctx, q, user)
		m := map[string]string{}
		for _, a := range p.Areas {
			m[a.Code] = a.LevelID
		}
		return m
	}
	if got := levelIn(u1); got[into] != n2 || len(got) != 1 {
		t.Fatalf("uno queda solo en la nueva con su nivel más alto: %v", got)
	}
	if got := levelIn(u2); got[into] != n1 || len(got) != 1 {
		t.Fatalf("dos pasa a la nueva como N1: %v", got)
	}
	var teamArea uuid.UUID
	_ = tx.QueryRow(ctx, `SELECT area_id FROM teams WHERE id = $1`, team).Scan(&teamArea)
	if teamArea != intoID {
		t.Fatalf("el equipo pasa a la nueva área: %v", teamArea)
	}

	// Ya vacía, se borra.
	if w := call(areas.Delete, "DELETE", nil, map[string]string{"code": from}); w.Code != http.StatusNoContent {
		t.Fatalf("borrar el área ya unida: %d %s", w.Code, w.Body)
	}
	if _, ok, _ := areas.areaByCode(ctx, from); ok {
		t.Fatal("el área vieja ya no existe")
	}
}
