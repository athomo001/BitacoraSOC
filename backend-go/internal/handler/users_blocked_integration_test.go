//go:build integration

// Usuarios bloqueados y eliminados contra la base real, dentro de una
// transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestUsuarioBloqueado
package handler

import (
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

func TestUsuarioBloqueado_SeEscondeYEliminarCuidaElHistorial(t *testing.T) {
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
	n := fmt.Sprintf("b%d", time.Now().UnixNano())
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
	user := func(name string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', initcap($2), 'x', 'user') RETURNING id`, name+n, name)
	}
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	ana, beto, cami := user("ana"), user("beto"), user("cami")

	// Beto está de guardia ahora y en un llamado de escalamiento; es CSM de un cliente.
	team := id(`INSERT INTO teams (name, slug, kind, area_id) VALUES ('Guardia N2 '||$1, 'g'||$1, 'oncall', $2) RETURNING id`, n, uuid.MustParse(areaSOCID))
	mAna := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, team, ana)
	mBeto := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, team, beto)
	cycle := id(`INSERT INTO rotation_cycles (team_id, start_day_of_week, start_time_utc) VALUES ($1, 1, '12:00') RETURNING id`, team)
	for _, m := range []uuid.UUID{mAna, mBeto} {
		exec(`INSERT INTO rotation_slots (cycle_id, team_member_id, week_start_date, week_end_date, starts_at, ends_at)
			VALUES ($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 6, now() - interval '1 day', now() + interval '6 days')`, cycle, m)
	}
	step := id(`INSERT INTO teams (name, slug, kind) VALUES ('Llamado '||$1, 's'||$1, 'step') RETURNING id`, n)
	exec(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2), ($1, $3)`, step, ana, beto)
	exec(`INSERT INTO organizations (name, code, csm_user_id) VALUES ('Casinos '||$1, 'c'||$1, $2)`, n, beto)

	onCall := func() map[uuid.UUID]bool {
		t.Helper()
		cur, err := resolveCurrentTeamMembers(ctx, q, team, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		out := map[uuid.UUID]bool{}
		for _, c := range cur {
			out[c.TeamMemberID] = true
		}
		return out
	}
	if now := onCall(); !now[mAna] || !now[mBeto] {
		t.Fatalf("antes de bloquear: %v", now)
	}

	h := &UsersHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	call := func(fn http.HandlerFunc, method string, target uuid.UUID) *httptest.ResponseRecorder {
		t.Helper()
		c := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "adm", Role: "admin"})
		r := httptest.NewRequest(method, "/", nil).WithContext(c)
		r.SetPathValue("id", target.String())
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}

	// El aviso antes de bloquear: lo que tiene a su nombre.
	var links struct{ Data []userLinkDTO }
	_ = json.Unmarshal(call(h.Links, "GET", beto).Body.Bytes(), &links)
	kinds := map[string]string{}
	for _, l := range links.Data {
		kinds[l.Kind] = l.Detail
	}
	if kinds["guard"] != "1" || len(links.Data) != 3 {
		t.Fatalf("enlaces: %+v", links.Data)
	}
	if _, ok := kinds["client"]; !ok {
		t.Fatalf("falta el cliente: %+v", links.Data)
	}

	// Bloqueado: deja de estar de guardia, sale del llamado y su turno queda pendiente.
	exec(`UPDATE users SET active = false WHERE id = $1`, beto)
	if now := onCall(); !now[mAna] || now[mBeto] {
		t.Fatalf("después de bloquear: %v", now)
	}
	stepMembers, err := q.ListStepMembers(ctx, []uuid.UUID{step})
	if err != nil || len(stepMembers) != 1 || stepMembers[0].UserID.Bytes != ana {
		t.Fatalf("llamado: %+v %v", stepMembers, err)
	}
	cards, err := q.ListMembersForTeams(ctx, []uuid.UUID{team})
	if err != nil || len(cards) != 1 {
		t.Fatalf("tarjeta de escalamiento: %+v %v", cards, err)
	}
	slots, err := q.ListGuardSlotsBetween(ctx, db.ListGuardSlotsBetweenParams{FromAt: pgTime(time.Now().Add(-time.Hour)), ToAt: pgTime(time.Now().Add(time.Hour))})
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range slots {
		if s.TeamMemberID == mBeto && s.MemberActive {
			t.Fatal("el turno de un bloqueado no puede contar como cubierto")
		}
	}
	// Al reactivarlo vuelve todo, porque no se borró nada.
	exec(`UPDATE users SET active = true WHERE id = $1`, beto)
	if now := onCall(); !now[mBeto] {
		t.Fatal("reactivado: vuelve a estar de guardia")
	}

	// Eliminar: con historial queda bloqueado; sin historial se borra de todos lados.
	exec(`INSERT INTO audit_log (event, level, actor_user_id, success) VALUES ('auth.login.success', 'info', $1, true)`, beto)
	var res struct{ Data struct{ Deleted bool } }
	_ = json.Unmarshal(call(h.Delete, "DELETE", beto).Body.Bytes(), &res)
	var active bool
	_ = tx.QueryRow(ctx, `SELECT active FROM users WHERE id = $1`, beto).Scan(&active)
	if res.Data.Deleted || active {
		t.Fatalf("con historial: deleted=%v active=%v", res.Data.Deleted, active)
	}
	exec(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`, team, cami)
	_ = json.Unmarshal(call(h.Delete, "DELETE", cami).Body.Bytes(), &res)
	var left int
	_ = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM users WHERE id = $1) + (SELECT count(*) FROM team_members WHERE user_id = $1)`, cami).Scan(&left)
	if !res.Data.Deleted || left != 0 {
		t.Fatalf("sin historial: deleted=%v quedan %d", res.Data.Deleted, left)
	}
	if w := call(h.Delete, "DELETE", admin); w.Code != http.StatusConflict {
		t.Fatalf("eliminarse a sí mismo: %d", w.Code)
	}
}
