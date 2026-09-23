// Package mail envía correo real vía SMTP (Fase 2 del roadmap: "SMTP básico,
// envío de prueba" — spec/02-alcance-y-roadmap.md). Base para Auth (Fase 4,
// forgot-password) y Escalación (Fase 7, POST /api/escalation/notify).
package mail

import (
	"fmt"
	"mime"
	"net/smtp"
	"strings"
	"time"
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

// Send despacha un correo de texto plano a un único destinatario.
func (s *Sender) Send(to, subject, body string) error {
	return s.SendMany([]string{to}, nil, subject, body)
}

// SendMany despacha un solo correo con varios destinatarios en To y Cc
// (miembros recipient_type=to/cc de un equipo de escalación).
func (s *Sender) SendMany(to, cc []string, subject, body string) error {
	to, cc = nonEmpty(to), nonEmpty(cc)
	if len(to) == 0 {
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

	msg := buildMessage(s.cfg.FromAddress, to, cc, subject, body, time.Now())

	// net/smtp.SendMail sube a STARTTLS automáticamente si el servidor lo
	// anuncia en EHLO. RequireTLS documenta la expectativa del operador; con
	// un relay interno sin auth (ej. catcher de pruebas) STARTTLS no se puede
	// forzar desde acá sin reimplementar el protocolo a mano — aceptado como
	// límite conocido de "SMTP básico", ver spec/07-backend-arquitectura-go.md.
	rcpt := append(append([]string{}, to...), cc...)
	return smtp.SendMail(addr, auth, s.cfg.FromAddress, rcpt, msg)
}

func nonEmpty(addrs []string) []string {
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		if a = strings.TrimSpace(a); a != "" {
			out = append(out, a)
		}
	}
	return out
}

// buildMessage arma el mensaje. El asunto se codifica según RFC 2047
// (mime.QEncoding): en UTF-8 crudo, "Recuperación de contraseña - Bitácora
// Ops" llega roto a varios clientes de correo — bug de las fases anteriores,
// encontrado en la Fase 7. Date es obligatorio según RFC 5322 y su ausencia
// sube el puntaje de spam.
func buildMessage(from string, to, cc []string, subject, body string, now time.Time) []byte {
	const crlf = "\r\n"
	var b strings.Builder
	b.WriteString("From: " + from + crlf)
	b.WriteString("To: " + strings.Join(to, ", ") + crlf)
	if len(cc) > 0 {
		b.WriteString("Cc: " + strings.Join(cc, ", ") + crlf)
	}
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + crlf)
	b.WriteString("Date: " + now.Format(time.RFC1123Z) + crlf)
	b.WriteString("MIME-Version: 1.0" + crlf)
	b.WriteString(`Content-Type: text/plain; charset="UTF-8"` + crlf)
	b.WriteString(crlf)
	b.WriteString(body)
	return []byte(b.String())
}
