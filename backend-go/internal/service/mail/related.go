package mail

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net/smtp"
	"strings"
	"time"
)

// Inline es una imagen dentro del HTML (src="cid:<CID>"): el logo y las
// evidencias del informe de incidente, como los adjuntos inline del legacy.
type Inline struct {
	CID         string
	Name        string
	ContentType string
	Data        []byte
}

// SendRich manda HTML + texto con imágenes en línea (multipart/related). Sin
// imágenes es lo mismo que SendAlternative.
func (s *Sender) SendRich(to, cc []string, subject, textBody, htmlBody string, inline []Inline) error {
	if len(inline) == 0 {
		return s.SendAlternative(to, cc, subject, textBody, htmlBody)
	}
	to, cc = nonEmpty(to), nonEmpty(cc)
	if len(to) == 0 {
		return fmt.Errorf("mail: destinatario vacío")
	}
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	var auth smtp.Auth
	if s.cfg.Username != "" {
		auth = smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	}
	msg := buildRelatedMessage(s.fromHeader(), to, cc, subject, textBody, htmlBody, inline, time.Now())
	rcpt := append(append([]string{}, to...), cc...)
	return smtp.SendMail(addr, auth, s.cfg.FromAddress, rcpt, msg)
}

func newBoundary(prefix string) string {
	random := make([]byte, 12)
	_, _ = rand.Read(random)
	return prefix + hex.EncodeToString(random)
}

// buildRelatedMessage: related( alternative(texto, html), imágenes ).
func buildRelatedMessage(from string, to, cc []string, subject, textBody, htmlBody string, inline []Inline, now time.Time) []byte {
	const crlf = "\r\n"
	related, alternative := newBoundary("bitacora-rel-"), newBoundary("bitacora-alt-")
	var b strings.Builder
	writeHeaders(&b, from, to, cc, subject, now)
	b.WriteString(`Content-Type: multipart/related; type="multipart/alternative"; boundary="` + related + `"` + crlf + crlf)
	b.WriteString("--" + related + crlf)
	b.WriteString(`Content-Type: multipart/alternative; boundary="` + alternative + `"` + crlf + crlf)
	for _, part := range []struct{ kind, body string }{{"text/plain", textBody}, {"text/html", htmlBody}} {
		b.WriteString("--" + alternative + crlf)
		b.WriteString(`Content-Type: ` + part.kind + `; charset="UTF-8"` + crlf)
		b.WriteString("Content-Transfer-Encoding: quoted-printable" + crlf + crlf)
		var encoded bytes.Buffer
		w := quotedprintable.NewWriter(&encoded)
		_, _ = w.Write([]byte(part.body))
		_ = w.Close()
		b.WriteString(encoded.String() + crlf)
	}
	b.WriteString("--" + alternative + "--" + crlf)
	for _, img := range inline {
		name := mime.QEncoding.Encode("utf-8", img.Name)
		b.WriteString("--" + related + crlf)
		b.WriteString("Content-Type: " + img.ContentType + `; name="` + name + `"` + crlf)
		b.WriteString("Content-Transfer-Encoding: base64" + crlf)
		b.WriteString("Content-ID: <" + img.CID + ">" + crlf)
		b.WriteString(`Content-Disposition: inline; filename="` + name + `"` + crlf + crlf)
		encoded := base64.StdEncoding.EncodeToString(img.Data)
		for len(encoded) > 76 {
			b.WriteString(encoded[:76] + crlf)
			encoded = encoded[76:]
		}
		b.WriteString(encoded + crlf)
	}
	b.WriteString("--" + related + "--" + crlf)
	return []byte(b.String())
}
