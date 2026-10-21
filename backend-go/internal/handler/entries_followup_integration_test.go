//go:build integration

// Seguimiento de entradas de la Bitácora (10j) contra la base real, dentro de
// una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestSeguimiento
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

func TestSeguimiento_EntradaQuedaAbiertaHastaCerrarla(t *testing.T) {
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
	n := fmt.Sprintf("s%d", time.Now().UnixNano())
	var ana uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $1 || '@test.local', 'x', 'user') RETURNING id`, "ana"+n).Scan(&ana); err != nil {
		t.Fatal(err)
	}
	// Nadie más queda en seguimiento: la lista con el filtro muestra solo lo de esta prueba.
	if _, err := tx.Exec(ctx, `UPDATE entries SET follow_up_open = false`); err != nil {
		t.Fatal(err)
	}
	newEntry := func(content string) db.Entry {
		t.Helper()
		e, err := q.CreateEntry(ctx, db.CreateEntryParams{UserID: ana, EntryType: db.EntryTypeOperativa, Scope: db.EntryScopeGeneral, Content: content, Tags: []string{}})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	vieja := newEntry("Alerta de VPN " + n)
	nueva := newEntry("Caída de enlace " + n)
	sinNada := newEntry("Entrada sin seguimiento " + n)

	h := &EntriesHandler{Queries: q, AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	asAna := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: ana, Username: "ana" + n, Role: "user"})
	call := func(fn http.HandlerFunc, method, path string, body any, id uuid.UUID) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(asAna)
		if id != uuid.Nil {
			r.SetPathValue("id", id.String())
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	list := func(query string) []entryDTO {
		t.Helper()
		w := call(h.List, "GET", "/api/entries?"+query, nil, uuid.Nil)
		if w.Code != 200 {
			t.Fatalf("lista: %d %s", w.Code, w.Body)
		}
		var env struct {
			Data struct{ Items []entryDTO }
		}
		_ = json.Unmarshal(w.Body.Bytes(), &env)
		return env.Data.Items
	}
	ids := func(items []entryDTO) []uuid.UUID {
		out := []uuid.UUID{}
		for _, e := range items {
			out = append(out, e.ID)
		}
		return out
	}

	// Un seguimiento la deja en seguimiento.
	if w := call(h.AddComment, "POST", "/", map[string]any{"comment": "Se pidió al cliente revisar el firewall de Calama " + n}, vieja.ID); w.Code != 201 {
		t.Fatalf("seguimiento: %d %s", w.Code, w.Body)
	}
	// (dentro de la transacción now() no avanza: el primero queda de hace una hora)
	if _, err := tx.Exec(ctx, `UPDATE entry_comments SET created_at = now() - interval '1 hour' WHERE entry_id = $1`, vieja.ID); err != nil {
		t.Fatal(err)
	}
	// Uno de sistema (Escalamiento) también.
	if _, err := q.CreateEntryComment(ctx, db.CreateEntryCommentParams{EntryID: nueva.ID, UserID: ana, Comment: "Nivel 1 · No contesta", IsSystemGenerated: true}); err != nil {
		t.Fatal(err)
	}
	got := list("followUp=open&pageSize=50")
	if fmt.Sprint(ids(got)) != fmt.Sprint([]uuid.UUID{nueva.ID, vieja.ID}) {
		t.Fatalf("en seguimiento, la del seguimiento más reciente primero: %v", ids(got))
	}
	if got[1].FollowUpCount != 1 || got[1].LastFollowUpAt == nil || !got[1].FollowUpOpen {
		t.Fatalf("contador y último seguimiento: %+v", got[1])
	}

	// El buscador encuentra el texto del seguimiento.
	found := ids(list("q=firewall+Calama&pageSize=50"))
	if len(found) != 1 || found[0] != vieja.ID {
		t.Fatalf("buscar en los seguimientos: %v", found)
	}

	// Cerrar con nota: sale del filtro y el detalle dice quién y por qué.
	w := call(h.SetFollowUp, "PUT", "/", map[string]any{"open": false, "note": "El cliente lo resolvió"}, vieja.ID)
	if w.Code != 200 {
		t.Fatalf("cerrar: %d %s", w.Code, w.Body)
	}
	if got := ids(list("followUp=open&pageSize=50")); len(got) != 1 || got[0] != nueva.ID {
		t.Fatalf("la cerrada no sale: %v", got)
	}
	w = call(h.Get, "GET", "/", nil, vieja.ID)
	var detail entryDetailDTO
	var env struct{ Data json.RawMessage }
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	_ = json.Unmarshal(env.Data, &detail)
	if detail.FollowUpOpen || detail.FollowUpClosedBy != "ana"+n || detail.FollowUpCloseNote == nil || *detail.FollowUpCloseNote != "El cliente lo resolvió" || detail.FollowUpCount != 1 {
		t.Fatalf("detalle cerrado: %+v", detail)
	}

	// Un seguimiento nuevo la vuelve a abrir y borra el cierre.
	call(h.AddComment, "POST", "/", map[string]any{"comment": "Volvió a fallar"}, vieja.ID)
	w = call(h.Get, "GET", "/", nil, vieja.ID)
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	detail = entryDetailDTO{}
	_ = json.Unmarshal(env.Data, &detail)
	if !detail.FollowUpOpen || detail.FollowUpCloseNote != nil || detail.FollowUpCount != 2 {
		t.Fatalf("reabierta: %+v", detail)
	}

	// Se puede poner en seguimiento sin escribir uno.
	if w := call(h.SetFollowUp, "PUT", "/", map[string]any{"open": true}, sinNada.ID); w.Code != 200 {
		t.Fatalf("poner en seguimiento: %d", w.Code)
	}
	if got := ids(list("followUp=open&pageSize=50")); len(got) != 3 {
		t.Fatalf("tres en seguimiento: %v", got)
	}
	if w := call(h.SetFollowUp, "PUT", "/", map[string]any{"open": true}, uuid.New()); w.Code != 404 {
		t.Fatalf("entrada que no existe: %d", w.Code)
	}
}
