//go:build integration

// Prueba de integración real contra un catcher SMTP (Mailpit) — no corre en
// `go test ./...` normal (requiere Docker), sí en CI/local con:
//
//	docker run -d --rm -p 11025:1025 -p 18025:8025 axllent/mailpit
//	go test -tags=integration ./internal/service/mail/...
package mail_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
)

func TestSend_EntregaRealContraMailpit(t *testing.T) {
	sender := mail.NewSender(mail.Config{
		Host:        "127.0.0.1",
		Port:        11025,
		FromAddress: "bitacora-app@bitacorasoc.local",
		RequireTLS:  false,
	})

	subject := fmt.Sprintf("Correo de prueba Fase 2 - %d", time.Now().UnixNano())
	if err := sender.Send("destinatario@bitacorasoc.local", subject, "Cuerpo de prueba SMTP básico."); err != nil {
		t.Fatalf("Send() error inesperado: %v", err)
	}

	// Mailpit expone una API HTTP de solo-lectura sobre lo que capturó — se
	// listan todos los mensajes en vez de usar /search (su sintaxis de query
	// no es un substring simple, no vale la pena acoplarse a ella acá).
	resp, err := http.Get("http://127.0.0.1:18025/api/v1/messages")
	if err != nil {
		t.Fatalf("consultando API de Mailpit: %v", err)
	}
	defer resp.Body.Close()

	var result struct {
		Messages []struct {
			Subject string `json:"Subject"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decodificando respuesta de Mailpit: %v", err)
	}

	found := false
	for _, m := range result.Messages {
		if m.Subject == subject {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("no se encontró un mensaje capturado por Mailpit con asunto %q entre %d mensajes", subject, len(result.Messages))
	}
}
