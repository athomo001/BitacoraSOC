//go:build integration

// Enlaces públicos (10h) contra la base real, dentro de una transacción que
// se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestPublicLinks
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

func TestPublicLinks_ContraLaBase(t *testing.T) {
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
	if err := setModuleFlags(ctx, q, true, true); err != nil {
		t.Fatal(err)
	}
	n := fmt.Sprintf("%d", time.Now().UnixNano()%1_000_000_000)
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
	exec(`UPDATE system_features SET is_enabled = true WHERE code = 'native_tickets'`)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	user := func(name string) uuid.UUID {
		return id(`INSERT INTO users (username, email, full_name, password_hash) VALUES ($1, $1 || '@test.local', $2, 'x') RETURNING id`, name+n, name+" "+n)
	}
	area := id(`INSERT INTO areas (code, name) VALUES ($1, $2) RETURNING id`, "ar"+n, "Área "+n)

	// Una guardia de esa área: Ana ahora, Beto la semana que viene.
	team := id(`INSERT INTO teams (name, slug, kind, area_id) VALUES ('Guardia '||$1, 'g'||$1, 'oncall', $2) RETURNING id`, n, area)
	cycle := id(`INSERT INTO rotation_cycles (team_id, start_day_of_week, start_time_utc) VALUES ($1, 1, '12:00') RETURNING id`, team)
	mAna := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, team, user("ana"))
	mBeto := id(`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) RETURNING id`, team, user("beto"))
	exec(`INSERT INTO rotation_slots (cycle_id, team_member_id, week_start_date, week_end_date, starts_at, ends_at) VALUES
		($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 2, now() - interval '1 day', now() + interval '2 days'),
		($1, $3, CURRENT_DATE + 2, CURRENT_DATE + 9, now() + interval '2 days', now() + interval '9 days')`, cycle, mAna, mBeto)

	org := id(`INSERT INTO organizations (name, code) VALUES ('Mundo '||$1, 'm'||$1) RETURNING id`, n)
	other := id(`INSERT INTO organizations (name, code) VALUES ('Otro '||$1, 'o'||$1) RETURNING id`, n)
	fw := id(`INSERT INTO services (organization_id, name, code) VALUES ($1, 'Firewall', 'fw'||$2) RETURNING id`, org, n)
	id(`INSERT INTO services (organization_id, name, code) VALUES ($1, 'SIEM', 'siem'||$2) RETURNING id`, org, n)
	ajeno := id(`INSERT INTO services (organization_id, name, code) VALUES ($1, 'Ajeno', 'aj'||$2) RETURNING id`, other, n)
	exec(`INSERT INTO escalation_incidents (service_id, title, opened_by) VALUES ($1, 'Secreto interno '||$2, $3)`, fw, n, admin)
	exec(`INSERT INTO escalation_incidents (service_id, title, opened_by) VALUES ($1, 'Del otro cliente', $2)`, ajeno, admin)
	exec(`INSERT INTO maintenance_windows (organization_id, title, starts_at, ends_at, created_by) VALUES ($1, 'Firmware '||$2, now() + interval '3 days', now() + interval '3 days 2 hours', $3)`, org, n, admin)
	exec(`INSERT INTO tickets (ticket_number, client_id, title, description, area_id, requested_area_id) VALUES ($1, $2, 'Bloqueo VPN', 'x', $3, $3)`, "TKT-"+n, org, area)

	h := &PublicLinksHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default()), PublicBaseURL: "https://bitacora.test"}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "adm" + n, Role: "admin"})
	call := func(fn func(http.ResponseWriter, *http.Request), method string, body any, path map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, "/x", &buf).WithContext(asAdmin)
		for k, v := range path {
			req.SetPathValue(k, v)
		}
		rec := httptest.NewRecorder()
		fn(rec, req)
		return rec
	}
	create := func(body map[string]any) (uuid.UUID, string) {
		t.Helper()
		w := call(h.Create, "POST", body, nil)
		if w.Code != http.StatusCreated {
			t.Fatalf("crear %v: %d %s", body, w.Code, w.Body.String())
		}
		var env struct{ Data publicLinkDTO }
		_ = json.Unmarshal(w.Body.Bytes(), &env)
		if !strings.HasPrefix(env.Data.URL, "https://bitacora.test/p/") {
			t.Fatalf("url: %q", env.Data.URL)
		}
		return env.Data.ID, env.Data.URL[strings.LastIndex(env.Data.URL, "/")+1:]
	}
	view := func(token string) (int, string, publicViewDTO) {
		t.Helper()
		w := call(h.View, "GET", nil, map[string]string{"token": token})
		var env struct{ Data publicViewDTO }
		_ = json.Unmarshal(w.Body.Bytes(), &env)
		return w.Code, w.Body.String(), env.Data
	}

	t.Run("validaciones", func(t *testing.T) {
		for _, body := range []map[string]any{
			{"kind": "guards", "name": "TV"},
			{"kind": "client", "name": "Sin cliente"},
			{"kind": "map", "name": "", "areaIds": []uuid.UUID{area}},
			{"kind": "otra", "name": "x"},
		} {
			if w := call(h.Create, "POST", body, nil); w.Code != http.StatusBadRequest {
				t.Errorf("%v: %d", body, w.Code)
			}
		}
	})

	t.Run("guardias", func(t *testing.T) {
		_, token := create(map[string]any{"kind": "guards", "name": "TV sala", "areaIds": []uuid.UUID{area}})
		code, raw, v := view(token)
		if code != 200 || len(v.Guards) != 1 || v.Guards[0].Area != "Área "+n {
			t.Fatalf("%d %s", code, raw)
		}
		g := v.Guards[0].Guards[0]
		if len(g.People) != 1 || g.People[0] != "ana "+n || g.Until == nil || len(g.Next) != 1 || g.Next[0] != "beto "+n {
			t.Fatalf("guardia: %+v", g)
		}
		if strings.Contains(raw, "@test.local") {
			t.Fatal("la vista pública no lleva correos")
		}
	})

	t.Run("ticketera", func(t *testing.T) {
		_, token := create(map[string]any{"kind": "tickets", "name": "TV tickets", "areaIds": []uuid.UUID{area}})
		_, raw, v := view(token)
		if len(v.Tickets) != 1 || v.Tickets[0].Number != "TKT-"+n || v.Tickets[0].Client != "Mundo "+n {
			t.Fatalf("tickets: %s", raw)
		}
	})

	t.Run("estado del cliente sin títulos internos", func(t *testing.T) {
		_, token := create(map[string]any{"kind": "client", "name": "Mundo", "organizationId": org})
		_, raw, v := view(token)
		c := v.Client
		if c == nil || c.Name != "Mundo "+n || len(c.Services) != 2 || len(c.Windows) != 1 || c.Windows[0].Service != "" {
			t.Fatalf("cliente: %s", raw)
		}
		if c.Services[0].Name != "Firewall" || c.Services[0].IncidentSince == nil || c.Services[1].IncidentSince != nil {
			t.Fatalf("servicios: %+v", c.Services)
		}
		if strings.Contains(raw, "Secreto interno") || strings.Contains(raw, "Del otro cliente") || strings.Contains(raw, "Ajeno") {
			t.Fatalf("se filtró algo interno o de otro cliente: %s", raw)
		}
	})

	t.Run("cambiar, desactivar y teletrabajo", func(t *testing.T) {
		linkID, token := create(map[string]any{"kind": "map", "name": "Pantalla NOC"})
		if code, raw, v := view(token); code != 200 || v.Map == nil {
			t.Fatalf("mapa: %d %s", code, raw)
		}
		w := call(h.Rotate, "POST", nil, map[string]string{"id": linkID.String()})
		var env struct{ Data struct{ URL string } }
		_ = json.Unmarshal(w.Body.Bytes(), &env)
		fresh := env.Data.URL[strings.LastIndex(env.Data.URL, "/")+1:]
		if code, _, _ := view(token); code != 404 {
			t.Fatal("el enlace anterior ya no abre")
		}
		if code, _, _ := view(fresh); code != 200 {
			t.Fatal("el nuevo abre")
		}
		call(h.Patch, "PATCH", map[string]any{"active": false}, map[string]string{"id": linkID.String()})
		if code, _, _ := view(fresh); code != 404 {
			t.Fatal("desactivado no abre")
		}
		tele, teleToken := create(map[string]any{"kind": "telework", "name": "Recepción"})
		_ = tele
		if code, _, _ := view(teleToken); code != 404 {
			t.Fatal("el de teletrabajo tiene su propia página")
		}
		if w := call(h.Delete, "DELETE", nil, map[string]string{"id": linkID.String()}); w.Code != http.StatusNoContent {
			t.Fatalf("borrar: %d", w.Code)
		}
		if code, _, _ := view("no-es-un-token"); code != 404 {
			t.Fatal("token mal formado")
		}
	})
}
