package complements

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTicketRoundTripAndRejections(t *testing.T) {
	s := NewSigner([]byte("llave-de-prueba"))
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	user := uuid.New()

	raw, issued := s.Issue(KindEmbed, "doom-browser", user, "user", EmbedTTL)
	got, err := s.Verify(raw, KindEmbed, "doom-browser")
	if err != nil || got.UserID != user || got.Nonce != issued.Nonce || got.Role != "user" {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	// Otro complemento, otro tipo, firma alterada o vencido: rechazado.
	if _, err := s.Verify(raw, KindEmbed, "otro"); err == nil {
		t.Fatal("aceptó un ticket de otro complemento")
	}
	if _, err := s.Verify(raw, KindSession, "doom-browser"); err == nil {
		t.Fatal("aceptó un ticket de otro tipo como sesión")
	}
	body, sig, _ := strings.Cut(raw, ".")
	if _, err := s.Verify(body+"x."+sig, KindEmbed, "doom-browser"); err == nil {
		t.Fatal("aceptó un ticket alterado")
	}
	if _, err := NewSigner([]byte("otra-llave")).Verify(raw, KindEmbed, "doom-browser"); err == nil {
		t.Fatal("aceptó un ticket firmado con otra llave")
	}
	now = now.Add(EmbedTTL + time.Second)
	if _, err := s.Verify(raw, KindEmbed, "doom-browser"); err == nil {
		t.Fatal("aceptó un ticket vencido")
	}
}

func TestCSP(t *testing.T) {
	csp := CSP("http://127.0.0.1:8081", []string{"https://API.open-meteo.com/v1/x", "https://*.evil.com", "javascript:alert(1)", "wss://ws.x.cl"})
	for _, want := range []string{
		"connect-src 'self' https://api.open-meteo.com wss://ws.x.cl;",
		"style-src 'self' 'unsafe-inline' https://api.open-meteo.com wss://ws.x.cl;",
		"'unsafe-eval'",
		"frame-ancestors http://127.0.0.1:8081",
		"'wasm-unsafe-eval'",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("falta %q en %s", want, csp)
		}
	}
	if strings.Contains(csp, "evil") || strings.Contains(csp, "javascript") {
		t.Errorf("dejó pasar un host inválido: %s", csp)
	}
}

func TestBreakerOpensAfterThreeFailuresAndRecovers(t *testing.T) {
	b := NewBreaker()
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	b.now = func() time.Time { return now }
	for i := 0; i < 2; i++ {
		b.Record("mapa", false, "timeout")
	}
	if st, _ := b.State("mapa"); st != CircuitClosed {
		t.Fatalf("con 2 fallos: %s", st)
	}
	b.Record("mapa", false, "timeout")
	if st, reason := b.State("mapa"); st != CircuitOpen || reason != "timeout" {
		t.Fatalf("con 3 fallos: %s %s", st, reason)
	}
	now = now.Add(breakerCooldown)
	if st, _ := b.State("mapa"); st != CircuitHalfOpen {
		t.Fatalf("tras 30 s: %s", st)
	}
	b.Record("mapa", false, "timeout") // la prueba falla: vuelve a abrir
	if st, _ := b.State("mapa"); st != CircuitOpen {
		t.Fatalf("prueba fallida: %s", st)
	}
	b.Record("mapa", true, "")
	if st, _ := b.State("mapa"); st != CircuitClosed {
		t.Fatalf("tras responder: %s", st)
	}
}
