// Package mail envía correo real vía SMTP (Fase 2 del roadmap: "SMTP básico,
// envío de prueba" — spec/02-alcance-y-roadmap.md). Base para Auth (Fase 4,
// forgot-password) y Escalación (Fase 7, POST /api/escalation/notify).
package mail

import (
	"fmt"
	"net/smtp"
	"strings"
)

// Config son los datos de conexión ya resueltos: Password viene DESCIFRADA
// (el llamador es responsable de leer smtp_config.password_encrypted y pasar
// por internal/crypto.Decrypt antes de construir este struct — mail nunca
// toca la capa de cifrado directamente, mismo principio de capas separadas
// que el resto del backend).
type Config struct {
	Host        string
	Port        int
	Username    string
	Password    string
	FromAddress string
	RequireTLS  bool
}

// Sender despacha correo real por SMTP.
type Sender struct {
	cfg Config
}

// NewSender construye un Sender a partir de una config ya resuelta.
func NewSender(cfg Config) *Sender {
	return &Sender{cfg: cfg}
}

// Send despacha un correo de texto plano simple a un único destinatario.
// Suficiente para "envío de prueba" de esta fase; el despacho MJML real de
// escalación/reportes llega en fases posteriores sobre esta misma base.
func (s *Sender) Send(to, subject, body string) error {
	if to == "" {
		return fmt.Errorf("mail: destinatario vacío")
	}
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)

	var auth smtp.Auth
	if s.cfg.Username != "" {
		// net/smtp.PlainAuth se niega a enviar credenciales si la conexión no
		// está en TLS (vía STARTTLS) y el host no es localhost — protección
		// ya incluida en la librería estándar, no reimplementada acá.
		auth = smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	}

	msg := buildMessage(s.cfg.FromAddress, to, subject, body)

	// net/smtp.SendMail sube a STARTTLS automáticamente si el servidor lo
	// anuncia en EHLO. RequireTLS documenta la expectativa del operador; con
	// un relay interno sin auth (ej. catcher de pruebas) STARTTLS no se puede
	// forzar desde acá sin reimplementar el protocolo a mano — aceptado como
	// límite conocido de "SMTP básico" en esta fase, ver spec/07-backend-arquitectura-go.md.
	return smtp.SendMail(addr, auth, s.cfg.FromAddress, []string{to}, msg)
}

func buildMessage(from, to, subject, body string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return []byte(b.String())
}
