//go:build integration

// Cargas masivas por CSV (10g) contra la base real, dentro de una transacción
// que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestBulkImport
package handler

import (
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

func TestBulkImport_ContraLaBase(t *testing.T) {
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
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	id(`INSERT INTO areas (code, name) VALUES ($1, $2) RETURNING id`, "ar"+n, "Área "+n)
	id(`INSERT INTO levels (code, name) VALUES ($1, $2) RETURNING id`, "lv"+n, "L"+n)

	h := &BulkImportHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "adm" + n, Role: "admin"})
	post := func(fn func(http.ResponseWriter, *http.Request), csv string, dryRun bool) csvImportResult {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/import?dryRun=%t", dryRun), strings.NewReader(csv)).WithContext(asAdmin)
		rec := httptest.NewRecorder()
		fn(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		var env struct{ Data csvImportResult }
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatal(err)
		}
		return env.Data
	}
	row := func(res csvImportResult, line int) csvRowResult {
		t.Helper()
		for _, r := range res.Rows {
			if r.Line == line {
				return r
			}
		}
		t.Fatalf("no está la fila %d: %+v", line, res.Rows)
		return csvRowResult{}
	}

	t.Run("usuarios", func(t *testing.T) {
		csv := fmt.Sprintf("usuario;nombre;correo;rol;areas\nu%s;Uno %s;u%s@test.local;usuario;Área %s=L%s\n", n, n, n, n, n)
		dry := post(h.Users, csv, true)
		if dry.Created != 1 || dry.Rows[0].Secret != "" {
			t.Fatalf("revisión: %+v", dry)
		}
		if _, err := q.GetUserByUsername(ctx, "u"+n); err == nil {
			t.Fatal("la revisión no guarda nada")
		}
		res := post(h.Users, csv, false)
		if res.Created != 1 || len(res.Rows[0].Secret) != 14 {
			t.Fatalf("carga: %+v", res)
		}
		u, err := q.GetUserByUsername(ctx, "u"+n)
		if err != nil || !u.MustChangePassword || u.FullName.String != "Uno "+n {
			t.Fatalf("usuario creado: %+v, %v", u, err)
		}
		shapes, _ := q.ListUserGroupShapes(ctx, u.ID)
		if len(shapes) != 1 || shapes[0].AreaCodes[0] != "ar"+n || !shapes[0].LevelID.Valid {
			t.Fatalf("ubicación: %+v", shapes)
		}
		if again := post(h.Users, csv, false); again.Unchanged != 1 {
			t.Fatalf("la misma fila de nuevo: %+v", again)
		}
		upd := post(h.Users, fmt.Sprintf("usuario;rol;areas\nu%s;auditor;Área %s\nadm%s;usuario;\n", n, n, n), false)
		if r := row(upd, 2); r.Action != "update" || !strings.Contains(r.Detail, "rol: usuario → auditor") || !strings.Contains(r.Detail, "áreas") {
			t.Fatalf("cambio de rol y nivel: %+v", r)
		}
		if r := row(upd, 3); r.Action != "error" || !strings.Contains(r.Error, "a ti mismo") {
			t.Fatalf("quitarse el admin: %+v", r)
		}
		shapes, _ = q.ListUserGroupShapes(ctx, u.ID)
		if len(shapes) != 1 || shapes[0].LevelID.Valid {
			t.Fatalf("queda en el área sin nivel: %+v", shapes)
		}
	})

	t.Run("organizaciones y servicios", func(t *testing.T) {
		csv := fmt.Sprintf("codigo;nombre;tipo;mandante;servicios\nM%s;Mandante %s;Mandante;;\nC%s;Cliente %s;Cliente;M%s;S%s=Firewall\nA%s;Antes %s;;B%s;\nB%s;Después %s;;;\n", n, n, n, n, n, n, n, n, n, n, n)
		res := post(h.Organizations, csv, false)
		if res.Created != 3 || res.Errors != 1 {
			t.Fatalf("carga: %+v", res)
		}
		if r := row(res, 4); !strings.Contains(r.Error, "más arriba") {
			t.Fatalf("mandante más abajo: %+v", r)
		}
		c, err := q.FindOrganizationByNameOrCode(ctx, "C"+n)
		m, _ := q.FindOrganizationByNameOrCode(ctx, "M"+n)
		if err != nil || !c.ViaOrganizationID.Valid || c.ViaOrganizationID.Bytes != m.ID {
			t.Fatalf("cliente vía mandante: %+v, %v", c, err)
		}
		services, _ := q.ListServices(ctx, db.ListServicesParams{OrganizationID: pgUUIDOf(c.ID)})
		if len(services) != 1 || services[0].Name != "Firewall" {
			t.Fatalf("servicios: %+v", services)
		}
		upd := post(h.Organizations, fmt.Sprintf("codigo;servicios\nC%s;S%s=Firewall perimetral\n", n, n), false)
		if r := row(upd, 2); r.Action != "update" || !strings.Contains(r.Detail, "se renombra") {
			t.Fatalf("renombrar servicio: %+v", r)
		}
		other := post(h.Organizations, fmt.Sprintf("codigo;servicios\nM%s;S%s=Robado\n", n, n), true)
		if r := row(other, 2); !strings.Contains(r.Error, "otra organización") {
			t.Fatalf("servicio ajeno: %+v", r)
		}
	})

	t.Run("ventanas de mantenimiento", func(t *testing.T) {
		start := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
		csv := fmt.Sprintf("titulo,aplica_a,inicio,fin\nMant %s,cliente:C%s,%s,%s\nVieja %s,cliente:C%s,2020-01-01 10:00,2020-01-01 11:00\n",
			n, n, start.Format(time.RFC3339), start.Add(2*time.Hour).Format(time.RFC3339), n, n)
		res := post(h.Windows, csv, false)
		if res.Created != 1 || !strings.Contains(row(res, 3).Error, "ya terminó") {
			t.Fatalf("carga: %+v", res)
		}
		if again := post(h.Windows, csv, false); again.Unchanged != 1 {
			t.Fatalf("la misma ventana de nuevo: %+v", again)
		}
	})

	t.Run("entradas históricas", func(t *testing.T) {
		csv := fmt.Sprintf("fecha;autor;tipo;ambito;tags;contenido\n2024-03-14T08:30:00-03:00;u%s;incidente;soc;a|b;Texto %s\n2024-03-14 09:00;nadie%s;;;;Otro\n", n, n, n)
		res := post(h.Entries, csv, false)
		if res.Created != 1 || !strings.Contains(row(res, 3).Error, "no existe") {
			t.Fatalf("carga: %+v", res)
		}
		var at time.Time
		var tags []string
		if err := tx.QueryRow(ctx, `SELECT created_at, tags FROM entries WHERE content = $1`, "Texto "+n).Scan(&at, &tags); err != nil {
			t.Fatal(err)
		}
		if !at.Equal(time.Date(2024, 3, 14, 11, 30, 0, 0, time.UTC)) || strings.Join(tags, ",") != "a,b" {
			t.Fatalf("fecha y etiquetas: %v %v", at, tags)
		}
		if again := post(h.Entries, csv, false); again.Unchanged != 1 {
			t.Fatalf("la misma entrada de nuevo: %+v", again)
		}
	})
}
