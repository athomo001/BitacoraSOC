//go:build integration

// Metas por persona con escalones, resultado y regla (000058) contra la base
// real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestMetasEscalones
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

func TestMetasEscalones_ReglaYResultado(t *testing.T) {
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
	n := fmt.Sprintf("r%d", time.Now().UnixNano())
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
	soc := uuid.MustParse(areaSOCID)
	exec(`UPDATE areas SET active = true WHERE id = $1`, soc)
	user := func(name string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash, role) VALUES ($1, $1 || '@test.local', initcap($2), 'x', 'user') RETURNING id`, name+n, name)
	}
	jefa, matias := user("jefa"), user("matias")
	group := func(code string, caps []string, u uuid.UUID) {
		g := id(`INSERT INTO permission_groups (code, name, profile, capabilities) VALUES ($1, $1, 'operativo', $2) RETURNING id`, code+n, caps)
		exec(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2)`, g, soc)
		exec(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2)`, u, g)
	}
	group("socjefa", []string{CapAreaLead}, jefa)
	group("socn2", []string{}, matias)

	h := &ManagementHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default()), Agenda: &AgendaHandler{Queries: q}}
	call := func(fn http.HandlerFunc, who uuid.UUID, method string, body any, vals ...string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		c := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: who, Username: "u", Role: "user"})
		r := httptest.NewRequest(method, "/", &buf).WithContext(c)
		for i := 0; i+1 < len(vals); i += 2 {
			r.SetPathValue(vals[i], vals[i+1])
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	goal := func(w *httptest.ResponseRecorder) goalDTO {
		t.Helper()
		var env struct{ Data goalDTO }
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || env.Data.ID == uuid.Nil {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		return env.Data
	}
	due := time.Now().AddDate(0, 3, 0).Format("2006-01-02")
	create := func(name, rank string) goalDTO {
		return goal(call(h.CreateGoal, jefa, "POST", map[string]any{"name": name, "scope": "person", "personId": matias, "kind": "certification", "bonus": rank, "dueDate": due}))
	}
	primary, secondary, tertiary := create("Btrust BCIE", "primary"), create("ISO 27001", "secondary"), create("Fortinet NSE 1", "tertiary")
	state := func(g goalDTO) goalDTO {
		t.Helper()
		return goal(call(h.Goal, jefa, "GET", nil, "id", g.ID.String()))
	}
	rule := func(who uuid.UUID, r string) int {
		return call(h.PersonRule, who, "PUT", map[string]string{"rule": r}, "userId", matias.String()).Code
	}

	// La regla la pone la jefatura, no la persona.
	if c := rule(matias, "any"); c != http.StatusForbidden {
		t.Fatalf("la persona cambia su regla: %d", c)
	}
	if c := rule(jefa, "primary"); c != http.StatusOK {
		t.Fatalf("regla: %d", c)
	}
	if g := state(primary); g.PersonRule != "primary" || !g.CanRule || !g.CanOutcome {
		t.Fatalf("primaria: %+v", g)
	}

	// Rindió la primaria y no pasó: queda no lograda con el motivo y sigue la secundaria.
	if w := call(h.GoalAction, matias, "POST", map[string]string{"reason": "x"}, "id", primary.ID.String(), "action", "not-achieved"); w.Code != http.StatusForbidden {
		t.Fatalf("la persona se marca no lograda: %d", w.Code)
	}
	if w := call(h.GoalAction, jefa, "POST", map[string]string{"reason": "Reprobó el examen"}, "id", primary.ID.String(), "action", "not-achieved"); w.Code != 200 {
		t.Fatalf("no lograda: %d %s", w.Code, w.Body)
	}
	if g := state(primary); g.State != "failed" || g.OutcomeReason != "Reprobó el examen" {
		t.Fatalf("primaria no lograda: %+v", g)
	}

	// Logra la secundaria: con «Basta la primaria» la terciaria sigue abierta.
	if w := call(h.GoalAction, jefa, "POST", nil, "id", secondary.ID.String(), "action", "complete"); w.Code != 200 {
		t.Fatalf("lograr secundaria: %d %s", w.Code, w.Body)
	}
	if g := state(secondary); g.State != "done" {
		t.Fatalf("secundaria: %s", g.State)
	}
	if g := state(tertiary); g.State != "open" {
		t.Fatalf("terciaria con basta la primaria: %s", g.State)
	}
	// «Basta una»: la terciaria ya no hace falta; la primaria sigue no lograda.
	_ = rule(jefa, "any")
	if g := state(tertiary); g.State != "not_needed" || g.OutcomeReason != "Logró la meta secundaria «ISO 27001»" {
		t.Fatalf("terciaria con basta una: %+v", g)
	}
	if g := state(primary); g.State != "failed" {
		t.Fatalf("la primaria no lograda no cambia: %s", g.State)
	}
	// «Todas cuentan»: vuelve a abrirse.
	_ = rule(jefa, "all")
	if g := state(tertiary); g.State != "open" || g.PersonRule != "all" {
		t.Fatalf("terciaria con todas: %+v", g)
	}
	// Las que no hacen falta no avisan.
	_ = rule(jefa, "any")
	alerts, err := q.ListGoalsForAlerts(ctx, db.ListGoalsForAlertsParams{FromDay: pgDate(time.Now().AddDate(-1, 0, 0)), ToDay: pgDate(time.Now().AddDate(1, 0, 0))})
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range alerts {
		if a.ID == tertiary.ID || a.ID == primary.ID {
			t.Fatalf("avisa una meta cerrada: %s", a.Name)
		}
	}
}
