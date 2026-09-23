package mail

import (
	"strings"
	"testing"
	"time"
)

func TestBuildMessage_EncodesUTF8SubjectAndAddsDate(t *testing.T) {
	msg := string(buildMessage("ops@x.cl", []string{"a@x.cl"}, []string{"b@x.cl"}, "Recuperación de contraseña - Bitácora Ops", "cuerpo", time.Date(2026, 9, 23, 3, 14, 0, 0, time.UTC)))
	if strings.Contains(msg, "Subject: Recuperación") {
		t.Fatal("el asunto con tildes debe ir codificado (RFC 2047), no en UTF-8 crudo")
	}
	if !strings.Contains(msg, "Subject: =?utf-8?") {
		t.Fatalf("asunto sin codificar: %s", msg)
	}
	if !strings.Contains(msg, "Date: Wed, 23 Sep 2026 03:14:00 +0000") {
		t.Fatalf("falta el encabezado Date: %s", msg)
	}
	if !strings.Contains(msg, "To: a@x.cl\r\n") || !strings.Contains(msg, "Cc: b@x.cl\r\n") {
		t.Fatalf("To/Cc mal armados: %s", msg)
	}
}

func TestBuildMessage_ASCIISubjectStaysReadable(t *testing.T) {
	msg := string(buildMessage("ops@x.cl", []string{"a@x.cl"}, nil, "Prueba SMTP", "x", time.Now()))
	if !strings.Contains(msg, "Subject: Prueba SMTP\r\n") || strings.Contains(msg, "Cc:") {
		t.Fatalf("got %s", msg)
	}
}
