//go:build integration

// Usuarios por área y nivel contra la base real, dentro de una transacción
// que se deshace al final.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestPlacement
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
	"slices"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPlacement_GruposQueSeArmanSolos(t *testing.T) {
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
	// La prueba no depende de cómo esté la base: módulo y área SOC encendidos.
	if _, err := tx.Exec(ctx, `UPDATE app_config SET soc_module_enabled = true; UPDATE areas SET active = true WHERE code = 'soc'`); err != nil {
		t.Fatal(err)
	}
	code := "infra_" + nonce
	name := "Infra " + nonce
	if _, err := tx.Exec(ctx, `INSERT INTO areas (code, name) VALUES ($1, $2)`, code, name); err != nil {
		t.Fatal(err)
	}
	var user, n1, n2 uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "juan"+nonce).Scan(&user); err != nil {
		t.Fatal(err)
	}
	_ = tx.QueryRow(ctx, `SELECT id FROM levels WHERE code = 'n1'`).Scan(&n1)
	_ = tx.QueryRow(ctx, `SELECT id FROM levels WHERE code = 'n2'`).Scan(&n2)

	rec := &recordedAudit{}
	h := &PlacementHandler{Queries: q, Pool: tx, AuditLog: audit.NewLogger(rec, slog.Default())}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: uuid.Nil, Username: "admin", Role: "admin"})
	put := func(body placementDTO) placementDTO {
		t.Helper()
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		r := httptest.NewRequest("PUT", "/", &buf).WithContext(asAdmin)
		r.SetPathValue("id", user.String())
		w := httptest.NewRecorder()
		h.Put(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("PUT: %d %s", w.Code, w.Body)
		}
		var out struct{ Data placementDTO }
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data
	}
	groupNames := func() []string {
		rows, _ := q.ListUserGroupShapes(ctx, user)
		var names []string
		for _, r := range rows {
			names = append(names, r.Name)
		}
		slices.Sort(names)
		return names
	}

	// Juan: SOC N2, Infra N1 y jefe de Infra, escribe en el Directorio.
	got := put(placementDTO{Areas: []placementArea{
		{Code: "soc", LevelID: n2.String()},
		{Code: code, LevelID: n1.String(), Lead: true},
	}, Extras: []string{"directory:write"}})
	want := []string{"Directorio: escribir", "Jefatura " + name, name + " N1", "SOC N2"}
	slices.Sort(want)
	if names := groupNames(); !slices.Equal(names, want) {
		t.Fatalf("grupos: %v, quería %v", names, want)
	}
	if len(got.Areas) != 2 || !slices.Equal(got.Extras, []string{"directory:write"}) {
		t.Fatalf("respuesta: %+v", got)
	}
	var profile string
	_ = tx.QueryRow(ctx, `SELECT profile FROM permission_groups WHERE name = $1`, name+" N1").Scan(&profile)
	if profile != "resolutor" {
		t.Fatalf("el grupo de Infra toma el perfil del área: %s", profile)
	}
	_ = tx.QueryRow(ctx, `SELECT profile FROM permission_groups WHERE name = 'SOC N2' ORDER BY created_at LIMIT 1`).Scan(&profile)
	if profile != "operativo" {
		t.Fatalf("SOC es Operativo: %s", profile)
	}

	// Sale de Infra: se va también la jefatura; queda en SOC N2, sin extras.
	put(placementDTO{Areas: []placementArea{{Code: "soc", LevelID: n2.String()}}})
	if names := groupNames(); !slices.Equal(names, []string{"SOC N2"}) {
		t.Fatalf("grupos tras salir de Infra: %v", names)
	}

	// Otra persona con lo mismo reutiliza el grupo, no crea otro.
	var count int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM permission_groups WHERE name = $1`, name+" N1").Scan(&count)
	put(placementDTO{Areas: []placementArea{{Code: "soc", LevelID: n2.String()}, {Code: code, LevelID: n1.String()}}})
	var after int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM permission_groups WHERE name = $1`, name+" N1").Scan(&after)
	if count != 1 || after != 1 {
		t.Fatalf("el grupo automático se reutiliza: antes %d, después %d", count, after)
	}
	if !slices.Contains(rec.events, "user.placement.update") {
		t.Fatalf("auditoría: %v", rec.events)
	}

	// Ficha del área: la gente con su nivel, y una persona nueva directo al área.
	r := httptest.NewRequest("GET", "/", nil).WithContext(asAdmin)
	r.SetPathValue("code", code)
	w := httptest.NewRecorder()
	h.AreaPeople(w, r)
	var people struct{ Data []areaPersonDTO }
	if err := json.Unmarshal(w.Body.Bytes(), &people); err != nil || w.Code != http.StatusOK || len(people.Data) != 1 || people.Data[0].ID != user || people.Data[0].LevelID != n1.String() {
		t.Fatalf("gente del área: %d %s", w.Code, w.Body)
	}
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{"fullName": "Rocío Fuentes", "username": "rf" + nonce, "email": "rf" + nonce + "@test.local", "levelId": n2.String()})
	r = httptest.NewRequest("POST", "/", &buf).WithContext(asAdmin)
	r.SetPathValue("code", code)
	w = httptest.NewRecorder()
	h.CreateAreaPerson(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("persona nueva en el área: %d %s", w.Code, w.Body)
	}
	r = httptest.NewRequest("GET", "/", nil).WithContext(asAdmin)
	r.SetPathValue("code", code)
	w = httptest.NewRecorder()
	h.AreaPeople(w, r)
	_ = json.Unmarshal(w.Body.Bytes(), &people)
	if len(people.Data) != 2 {
		t.Fatalf("la persona nueva aparece en el área: %s", w.Body)
	}
}
