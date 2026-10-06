//go:build integration

// Prueba de integración real contra un catcher SMTP (Mailpit) — mismo
// patrón que internal/service/mail/mail_integration_test.go. No corre en
// `go test ./...` normal (requiere Docker), sí en CI/local con:
//
//	docker run -d --rm -p 11025:1025 -p 18025:8025 axllent/mailpit
//	go test -tags=integration ./internal/handler/... -run TestDotacionNotification
//
// Verifica el checklist de salida de la Fase 8 ("un
// work_shift_notification_schedule de prueba dispara un correo") sin
// exponer un endpoint HTTP de "enviar ahora" (no está en el contrato; el
// cron real que lo dispara automáticamente llega en la Fase 12). Va en
// `package handler` (no `handler_test`) como el resto de las pruebas del
// paquete; el correo es el del legacy (mailtpl.RenderOutOfOffice).
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
)

func TestDotacionNotification_EntregaRealContraMailpit(t *testing.T) {
	schedule := db.WorkShiftNotificationSchedule{
		Name: fmt.Sprintf("Reporte de Guardia RRHH - %d", time.Now().UnixNano()),
	}
	body, err := mailtpl.RenderOutOfOffice(mailtpl.OutOfOfficeOptions{
		Columns:     []mailtpl.OutOfOfficeColumn{{DayShort: "Lun", DateShort: "21/09"}},
		Rows:        []mailtpl.OutOfOfficeRow{{Name: "Ana Pérez", CargoLabel: "Analista N1", Days: []string{"telework"}}},
		PeriodLabel: "Periodo Semanal: 21-09-2026 - 27-09-2026", BrandName: "Bitácora Ops", Title: schedule.Name, Year: 2026,
	})
	if err != nil || body == "" {
		t.Fatalf("RenderOutOfOffice: %v", err)
	}
	subject := schedule.Name

	sender := mail.NewSender(mail.Config{Host: "127.0.0.1", Port: 11025, FromAddress: "bitacora-app@bitacorasoc.local", RequireTLS: false})
	if err := sender.SendHTML([]string{"rrhh@bitacorasoc.local"}, nil, subject, body); err != nil {
		t.Fatalf("Send() error inesperado: %v", err)
	}

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
