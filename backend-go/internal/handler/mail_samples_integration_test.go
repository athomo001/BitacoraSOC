//go:build integration

// Muestras de todos los correos contra Postgres y Mailpit, dentro de una
// transacción que se deshace (ver ticket_mail_integration_test.go).
package handler

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMailSamples_TodasSeArmanYLleganAMailpit(t *testing.T) {
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
	if _, err := tx.Exec(ctx, `INSERT INTO smtp_config (id, host, port, username, password_encrypted, from_address, require_tls)
		VALUES (true, '127.0.0.1', 11025, NULL, NULL, 'bitacora@test.local', false)
		ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port, username = NULL, password_encrypted = NULL,
		from_address = EXCLUDED.from_address, require_tls = false`); err != nil {
		t.Fatal(err)
	}
	q := db.New(tx)
	h := &MailSamplesHandler{Queries: q, PublicBaseURL: "https://bitacora.test",
		Reports: &ReportsHandler{Queries: q}, Dotacion: &DotacionHandler{Queries: q}, Birthdays: &BirthdaysHandler{Queries: q}}
	samples, failed := h.samples(ctx, time.Now(), false)
	if len(failed) > 0 {
		t.Fatalf("no se pudieron armar: %+v", failed)
	}
	// Los 14 de la Fase 12, los de la Agenda, el aviso con acuse, el resumen mensual, los dos avisos del legacy de turnos
	// y el resumen de servicio del cliente (Gestión).
	if len(samples) != 21 {
		t.Fatalf("muestras: %d", len(samples))
	}
	// Todos los tipos (docs/correos): cada uno con su archivo, cuándo sale y contenido.
	previews, errs := h.Previews(ctx, time.Now())
	if len(errs) > 0 {
		t.Fatalf("vistas que no se pudieron armar: %v", errs)
	}
	slugs := map[string]bool{}
	for _, p := range previews {
		if p.Slug == "" || slugs[p.Slug] || p.When == "" || p.HTML == "" || p.Subject == "" {
			t.Errorf("vista incompleta o repetida: %+v", p.Name)
		}
		slugs[p.Slug] = true
	}
	if len(previews) < 34 {
		t.Fatalf("vistas: %d", len(previews))
	}
	sender, _, err := buildMailSender(ctx, q, nil)
	if err != nil {
		t.Fatal(err)
	}
	nonce := fmt.Sprintf("m%d", time.Now().UnixNano())
	for i, s := range samples {
		if s.HTML == "" || s.Subject == "" {
			t.Errorf("%s: vacío", s.Name)
		}
		if err := sender.SendRich([]string{"muestras@test.local"}, nil, fmt.Sprintf("[Muestra %d/%d %s] %s", i+1, len(samples), nonce, s.Subject), s.Text, s.HTML, s.Inline); err != nil {
			t.Errorf("%s: %v", s.Name, err)
		}
	}
	if got := mailpitSearch(t, "subject:"+nonce); len(got) != len(samples) {
		t.Fatalf("llegaron %d de %d", len(got), len(samples))
	}
}
