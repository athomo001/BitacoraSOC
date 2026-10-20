//go:build integration

// RACI por cliente (pendiente 10 → falta para el corte) contra la base real,
// dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestRaci
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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRaci_ActividadesLetrasYPersonas(t *testing.T) {
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
	box, err := crypto.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	org := id(`INSERT INTO organizations (name, code) VALUES ('Cliente '||$1, 'c'||$1) RETURNING id`, n)
	admin := id(`INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'admin') RETURNING id`, "adm"+n)
	ana := id(`INSERT INTO contacts (organization_id, name, scope) VALUES ($1, 'Ana Pérez '||$2, 'external') RETURNING id`, org, n)
	for typ, value := range map[string]string{"email": "ana@cliente.test", "call": "+56 9 1234 5678"} {
		enc, err := box.Encrypt(value)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := q.CreateContactChannel(ctx, db.CreateContactChannelParams{ContactID: pgtype.UUID{Bytes: ana, Valid: true},
			ChannelType: db.ContactChannelType(typ), ValueEncrypted: enc}); err != nil {
			t.Fatal(err)
		}
	}
	guard := id(`INSERT INTO teams (name, slug, kind) VALUES ('Lista CDC '||$1, 'l-'||$1, 'escalation') RETURNING id`, n)

	rec := &recordedAudit{}
	h := &EscalationHandler{DB: tx, Queries: q, Crypto: box, AuditLog: audit.NewLogger(rec, slog.Default())}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "adm", Role: "admin"})
	call := func(fn http.HandlerFunc, method, path string, pathID string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, path, &buf).WithContext(asAdmin)
		if pathID != "" {
			req.SetPathValue("id", pathID)
		}
		w := httptest.NewRecorder()
		fn(w, req)
		return w
	}
	type teamRef struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	type actResp struct {
		ID      uuid.UUID `json:"id"`
		Topic   string    `json:"topic"`
		Notes   string    `json:"notes"`
		Letters map[string][]struct {
			ID      uuid.UUID `json:"id"`
			Members []struct {
				Name     string `json:"name"`
				Channels []struct {
					ChannelType string `json:"channelType"`
					Value       string `json:"value"`
					Href        string `json:"href"`
				} `json:"channels"`
			} `json:"members"`
		} `json:"letters"`
	}

	// La persona se vuelve un equipo «raci» y se reutiliza.
	w := call(h.RaciPerson, "POST", "/api/raci/people", "", map[string]any{"contactId": ana})
	if w.Code != http.StatusCreated {
		t.Fatalf("persona nueva: %d %s", w.Code, w.Body)
	}
	var person struct{ Data teamRef }
	_ = json.Unmarshal(w.Body.Bytes(), &person)
	w = call(h.RaciPerson, "POST", "/api/raci/people", "", map[string]any{"contactId": ana})
	var again struct{ Data teamRef }
	_ = json.Unmarshal(w.Body.Bytes(), &again)
	if w.Code != http.StatusOK || again.Data.ID != person.Data.ID {
		t.Fatalf("la misma persona reutiliza su equipo: %d %v vs %v", w.Code, again.Data.ID, person.Data.ID)
	}

	// Validación: un solo aprobador y al menos un responsable.
	base := map[string]any{"clientId": org, "topic": "Monitoreo CDC", "activity": "Escalamiento de alertas",
		"notes": "Después de las 17 h el aviso va por el grupo de WhatsApp", "responsible": []uuid.UUID{guard}}
	w = call(h.CreateRaci, "POST", "/api/raci", "", base)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("sin aprobador debe fallar: %d %s", w.Code, w.Body)
	}
	base["accountable"] = []uuid.UUID{person.Data.ID}
	base["informed"] = []uuid.UUID{person.Data.ID}
	w = call(h.CreateRaci, "POST", "/api/raci", "", base)
	if w.Code != http.StatusCreated {
		t.Fatalf("crear: %d %s", w.Code, w.Body)
	}
	var created struct{ Data actResp }
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	a := created.Data
	if a.Notes == "" || len(a.Letters["responsible"]) != 1 || a.Letters["responsible"][0].ID != guard {
		t.Fatalf("la actividad trae notas y su responsable: %+v", a)
	}
	acc := a.Letters["accountable"]
	if len(acc) != 1 || len(acc[0].Members) != 1 {
		t.Fatalf("el aprobador es la persona: %+v", acc)
	}
	chans := acc[0].Members[0].Channels
	if !slices.ContainsFunc(chans, func(c struct {
		ChannelType string `json:"channelType"`
		Value       string `json:"value"`
		Href        string `json:"href"`
	}) bool {
		return c.ChannelType == "email" && c.Value == "ana@cliente.test" && c.Href == "mailto:ana@cliente.test"
	}) {
		t.Fatalf("el correo llega descifrado y con su enlace: %+v", chans)
	}

	// Editar reemplaza las letras.
	edit := map[string]any{"clientId": org, "topic": "Monitoreo CDC", "activity": "Escalamiento de alertas", "notes": "",
		"responsible": []uuid.UUID{person.Data.ID}, "accountable": []uuid.UUID{guard}, "consulted": []uuid.UUID{guard}}
	w = call(h.UpdateRaci, "PUT", "/api/raci/"+a.ID.String(), a.ID.String(), edit)
	if w.Code != http.StatusOK {
		t.Fatalf("editar: %d %s", w.Code, w.Body)
	}
	var updated struct{ Data actResp }
	_ = json.Unmarshal(w.Body.Bytes(), &updated)
	if updated.Data.Letters["responsible"][0].ID != person.Data.ID || len(updated.Data.Letters["informed"]) != 0 || len(updated.Data.Letters["consulted"]) != 1 {
		t.Fatalf("las letras se reemplazan: %+v", updated.Data.Letters)
	}
	missing := uuid.NewString()
	if w := call(h.UpdateRaci, "PUT", "/api/raci/"+missing, missing, edit); w.Code != http.StatusNotFound {
		t.Fatalf("editar una que no existe: %d %s", w.Code, w.Body)
	}

	// Listar por cliente.
	w = call(h.ListRaci, "GET", "/api/raci?clientId="+org.String(), "", nil)
	var list struct{ Data []actResp }
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if w.Code != http.StatusOK || len(list.Data) != 1 || list.Data[0].Topic != "Monitoreo CDC" {
		t.Fatalf("listar: %d %s", w.Code, w.Body)
	}

	// Eliminar deja los equipos (pueden estar en el escalamiento).
	if w := call(h.DeleteRaci, "DELETE", "/api/raci/"+a.ID.String(), a.ID.String(), nil); w.Code != http.StatusNoContent {
		t.Fatalf("eliminar: %d %s", w.Code, w.Body)
	}
	var teams int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM teams WHERE id = ANY($1)`, []uuid.UUID{guard, person.Data.ID}).Scan(&teams); err != nil || teams != 2 {
		t.Fatalf("los equipos quedan: %d %v", teams, err)
	}
	for _, e := range []string{"raci.person", "raci.create", "raci.update", "raci.delete"} {
		if !slices.Contains(rec.events, e) {
			t.Fatalf("falta %s en la auditoría: %v", e, rec.events)
		}
	}
}
