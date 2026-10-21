//go:build integration

// Notas internas del CSM (spec/16 §4.7.1) contra la base real, dentro de una
// transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestNotasCSM
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
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNotasCSM_SoloLasVeCSM(t *testing.T) {
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
	n := fmt.Sprintf("n%d", time.Now().UnixNano())
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
	csmArea := id(`INSERT INTO areas (code, name, default_profile) VALUES ($1, 'CSM '||$1, 'gestion') RETURNING id`, "csm"+n)
	user := func(name, role string) uuid.UUID {
		return id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', $2) RETURNING id`, name+n, role)
	}
	lucia, tomas, admin, jefa := user("lucia", "user"), user("tomas", "user"), user("adm", "admin"), user("jefa", "user")
	group := func(code, profile string, area uuid.UUID, caps []string, users ...uuid.UUID) {
		g := id(`INSERT INTO permission_groups (code, name, profile, capabilities) VALUES ($1, $1, $2, $3) RETURNING id`, code+n, profile, caps)
		exec(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2)`, g, area)
		for _, u := range users {
			exec(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2)`, u, g)
		}
	}
	group("csm", "gestion", csmArea, []string{}, lucia, tomas)
	group("socjefa", "operativo", uuid.MustParse(areaSOCID), []string{CapAreaLead}, jefa)
	casinos := id(`INSERT INTO organizations (name, code) VALUES ('Casinos '||$1, 'cas'||$1) RETURNING id`, n)

	h := &ManagementHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	as := func(u uuid.UUID, role string) context.Context {
		return middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: u, Username: "u" + u.String()[:4], Role: role})
	}
	call := func(c context.Context, fn http.HandlerFunc, method string, body any, pathID uuid.UUID) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, "/", &buf).WithContext(c)
		r.SetPathValue("id", pathID.String())
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	note := func(w *httptest.ResponseRecorder) clientNoteDTO {
		t.Helper()
		var env struct{ Data clientNoteDTO }
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		return env.Data
	}

	w := call(as(lucia, "user"), h.CreateClientNote, "POST", map[string]any{"content": "Avisos de ventana: al jefe de TI por correo y WhatsApp."}, casinos)
	if w.Code != 201 {
		t.Fatalf("crear: %d %s", w.Code, w.Body)
	}
	first := note(w)
	second := note(call(as(lucia, "user"), h.CreateClientNote, "POST", map[string]any{"content": "Renovación: quieren sumar las sucursales del norte."}, casinos))
	if w := call(as(lucia, "user"), h.CreateClientNote, "POST", map[string]any{"content": "   "}, casinos); w.Code != 400 {
		t.Fatalf("vacía: %d", w.Code)
	}

	// Ni el admin ni una jefatura de otra área las ven (aunque vean Gestión).
	for name, c := range map[string]context.Context{"admin": as(admin, "admin"), "jefatura": as(jefa, "user")} {
		if w := call(c, h.ClientNotes, "GET", nil, casinos); w.Code != http.StatusForbidden {
			t.Fatalf("%s no debe verlas: %d", name, w.Code)
		}
	}

	// Otra persona de CSM fija una nota ajena, pero no la edita ni la borra.
	if w := call(as(tomas, "user"), h.PinClientNote, "POST", map[string]any{"pinned": true}, first.ID); w.Code != 200 || !note(w).Pinned {
		t.Fatalf("fijar: %d %s", w.Code, w.Body)
	}
	if w := call(as(tomas, "user"), h.UpdateClientNote, "PUT", map[string]any{"content": "x"}, first.ID); w.Code != http.StatusForbidden {
		t.Fatalf("editar ajena: %d", w.Code)
	}
	if w := call(as(tomas, "user"), h.DeleteClientNote, "DELETE", nil, first.ID); w.Code != http.StatusForbidden {
		t.Fatalf("borrar ajena: %d", w.Code)
	}
	if e := note(call(as(lucia, "user"), h.UpdateClientNote, "PUT", map[string]any{"content": "Renovación al 31/12."}, second.ID)); e.EditedAt == nil || e.Content != "Renovación al 31/12." || !e.Mine {
		t.Fatalf("editar propia: %+v", e)
	}

	// La lista: la fijada arriba; la ve todo CSM.
	var list struct{ Data []clientNoteDTO }
	_ = json.Unmarshal(call(as(tomas, "user"), h.ClientNotes, "GET", nil, casinos).Body.Bytes(), &list)
	if len(list.Data) != 2 || list.Data[0].ID != first.ID || list.Data[0].Mine {
		t.Fatalf("lista: %+v", list.Data)
	}
	if w := call(as(lucia, "user"), h.DeleteClientNote, "DELETE", nil, second.ID); w.Code != http.StatusNoContent {
		t.Fatalf("borrar propia: %d", w.Code)
	}
	var count int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM client_notes WHERE client_id = $1`, casinos).Scan(&count)
	if count != 1 {
		t.Fatalf("quedan %d", count)
	}
}
