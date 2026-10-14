//go:build integration

// Avisos por correo de la Ticketera de punta a punta (spec/15 §10): base real
// y un catcher SMTP (Mailpit). La prueba corre dentro de una transacción que se
// deshace al final, incluido apuntar el SMTP a Mailpit: la app levantada nunca
// ve estos cambios y no sale ningún correo real.
//
//	docker run -d --rm --name mailpit-test -p 11025:1025 -p 18025:8025 axllent/mailpit
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestTicketMail
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type mailpitMessage struct {
	ID      string `json:"ID"`
	Subject string `json:"Subject"`
	To      []struct {
		Address string `json:"Address"`
	} `json:"To"`
}

func mailpitSearch(t *testing.T, query string) []mailpitMessage {
	t.Helper()
	resp, err := http.Get("http://127.0.0.1:18025/api/v1/search?query=" + query)
	if err != nil {
		t.Fatalf("Mailpit: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Messages []mailpitMessage `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("Mailpit: %v", err)
	}
	return out.Messages
}

func mailpitText(t *testing.T, id string) string {
	t.Helper()
	resp, err := http.Get("http://127.0.0.1:18025/api/v1/message/" + id)
	if err != nil {
		t.Fatalf("Mailpit: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Text string `json:"Text"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.Text
}

func TestTicketMail_DePuntaAPuntaContraMailpit(t *testing.T) {
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
	nonce := fmt.Sprintf("n%d", time.Now().UnixNano())
	backup := "respaldo-" + nonce + "@test.local"
	client := "cliente-" + nonce + "@test.local"

	mustExec := func(sql string, args ...any) {
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	mustExec(`INSERT INTO smtp_config (id, host, port, username, password_encrypted, from_address, require_tls)
		VALUES (true, '127.0.0.1', 11025, NULL, NULL, 'bitacora@test.local', false)
		ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port, username = NULL, password_encrypted = NULL,
		from_address = EXCLUDED.from_address, require_tls = false`)
	mustExec(`UPDATE ticket_settings SET mail_enabled = true, mail_client_enabled = true, mail_backup_emails = $1,
		mail_comment_batch_minutes = 15, mail_events = $2`,
		[]string{backup}, []string{"team.created", "team.assigned", "client.opened", "client.comment"})

	var org, actor, other uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM organizations ORDER BY name LIMIT 1`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE active ORDER BY username LIMIT 1`).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE active AND id <> $1 ORDER BY username LIMIT 1`, actor).Scan(&other); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	mailer := &TicketMailer{Queries: q, PublicBaseURL: "https://bitacora.test", Now: func() time.Time { return now }}
	h := &TicketsHandler{Queries: q, Mailer: mailer, Now: func() time.Time { return now }}

	// P1: "Afecta al cliente" viene marcado por la regla por defecto.
	ticket, err := h.createTicketTx(ctx, tx, newTicket{Type: "incident", Scope: db.EntryScopeGeneral, ClientID: org,
		Impact: "high", Urgency: "high", Title: "Prueba " + nonce, Description: "x", ActorID: actor}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !ticket.AffectsClient {
		t.Fatal("un P1 nace con 'Afecta al cliente'")
	}
	if d := ticket.SlaResolutionDueAt.Time.Sub(now) - 8*time.Hour; d < -time.Second || d > time.Second {
		t.Fatalf("el plazo sale de la configuración (8 h por defecto): %v", ticket.SlaResolutionDueAt.Time.Sub(now))
	}
	if ticket, err = q.SetTicketMailRecipients(ctx, db.SetTicketMailRecipientsParams{ID: ticket.ID, SetRecipients: true, NotifyTo: []string{client}, NotifyCc: []string{}}); err != nil {
		t.Fatal(err)
	}
	h.afterCreate(ctx, ticket, actor)
	// Tomarlo uno mismo no avisa (no avisar a quien hizo el cambio); asignarlo a otro, sí.
	mailer.Emit(ctx, mailEmission{Event: "team.assigned", TicketID: ticket.ID, ActorID: actor, Targets: []uuid.UUID{actor}})
	mailer.Emit(ctx, mailEmission{Event: "team.assigned", TicketID: ticket.ID, ActorID: actor, Targets: []uuid.UUID{other}})
	for _, c := range []string{"uno " + nonce, "dos " + nonce, "tres " + nonce} {
		h.afterComment(ctx, ticket, actor, c, true)
	}
	h.afterComment(ctx, ticket, actor, "interno "+nonce, false)

	rows, err := q.ListTicketMails(ctx, ticket.ID)
	if err != nil {
		t.Fatal(err)
	}
	count := map[string]int{}
	for _, r := range rows {
		count[r.Event+"/"+r.Status]++
	}
	want := map[string]int{"team.created/pending": 1, "team.assigned/pending": 1, "client.opened/pending": 1, "client.comment/waiting": 1}
	for k, v := range want {
		if count[k] != v {
			t.Fatalf("cola: %v, quería %v", count, want)
		}
	}

	if err := mailer.Dispatch(ctx); err != nil {
		t.Fatal(err)
	}
	if got := mailpitSearch(t, "subject:"+nonce); len(got) != 2 {
		t.Fatalf("antes de la ventana salen el respaldo y el abierto: %d correos", len(got))
	}
	now = now.Add(16 * time.Minute)
	if err := mailer.Dispatch(ctx); err != nil {
		t.Fatal(err)
	}
	msgs := mailpitSearch(t, "subject:"+nonce)
	if len(msgs) != 3 {
		t.Fatalf("los 3 comentarios van en un solo correo: %d correos", len(msgs))
	}
	var commentMail mailpitMessage
	for _, m := range msgs {
		if strings.Contains(m.Subject, "Nuevo comentario") {
			commentMail = m
		}
	}
	if commentMail.ID == "" || len(commentMail.To) != 1 || commentMail.To[0].Address != client {
		t.Fatalf("el aviso de comentarios va al cliente: %+v", commentMail)
	}
	text := mailpitText(t, commentMail.ID)
	for _, c := range []string{"uno ", "dos ", "tres "} {
		if !strings.Contains(text, c+nonce) {
			t.Errorf("falta el comentario %q", c)
		}
	}
	if strings.Contains(text, "interno "+nonce) {
		t.Error("un comentario interno nunca le llega al cliente")
	}
	rows, _ = q.ListTicketMails(ctx, ticket.ID)
	for _, r := range rows {
		if r.Status != "sent" {
			t.Errorf("%s quedó %s", r.Event, r.Status)
		}
	}
}
