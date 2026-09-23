package ratelimit_test

import (
	"context"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
)

type fakeWindow struct {
	attemptCount    int
	windowStartedAt time.Time
}

type fakeStore struct {
	windows map[string]fakeWindow
}

func newFakeStore() *fakeStore { return &fakeStore{windows: map[string]fakeWindow{}} }

func (s *fakeStore) Get(ctx context.Context, ip string) (ratelimit.Window, bool, error) {
	w, ok := s.windows[ip]
	if !ok {
		return ratelimit.Window{}, false, nil
	}
	return ratelimit.Window{AttemptCount: w.attemptCount, WindowStartedAt: w.windowStartedAt}, true, nil
}

func (s *fakeStore) Reset(ctx context.Context, ip string) error {
	delete(s.windows, ip)
	return nil
}

func (s *fakeStore) Increment(ctx context.Context, ip string, now time.Time) (int, error) {
	w, ok := s.windows[ip]
	if !ok {
		w = fakeWindow{attemptCount: 0, windowStartedAt: now}
	}
	w.attemptCount++
	s.windows[ip] = w
	return w.attemptCount, nil
}

func newLimiter(store ratelimit.Store, now time.Time) *ratelimit.LoginLimiter {
	return &ratelimit.LoginLimiter{
		Store:          store,
		MaxAttempts:    5,
		WindowDuration: 15 * time.Minute,
		Now:            func() time.Time { return now },
	}
}

func TestLoginLimiter_PermiteHastaElLimite(t *testing.T) {
	store := newFakeStore()
	now := time.Now()
	limiter := newLimiter(store, now)

	for i := 1; i <= 5; i++ {
		blocked, _, err := limiter.RegisterAttempt(context.Background(), "10.0.0.1")
		if err != nil {
			t.Fatalf("intento %d: error inesperado: %v", i, err)
		}
		if blocked {
			t.Fatalf("intento %d no debería estar bloqueado (límite es 5)", i)
		}
	}
}

func TestLoginLimiter_BloqueaAlSextoIntento(t *testing.T) {
	store := newFakeStore()
	now := time.Now()
	limiter := newLimiter(store, now)

	for i := 1; i <= 5; i++ {
		if _, _, err := limiter.RegisterAttempt(context.Background(), "10.0.0.1"); err != nil {
			t.Fatalf("intento %d: error inesperado: %v", i, err)
		}
	}
	blocked, retryAfter, err := limiter.RegisterAttempt(context.Background(), "10.0.0.1")
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if !blocked {
		t.Fatal("el 6to intento en 15min debería estar bloqueado")
	}
	if retryAfter <= 0 {
		t.Fatalf("retryAfter debería ser positivo, fue %v", retryAfter)
	}
}

func TestLoginLimiter_IPsDistintasNoComparteCupo(t *testing.T) {
	store := newFakeStore()
	now := time.Now()
	limiter := newLimiter(store, now)

	for i := 1; i <= 5; i++ {
		if _, _, err := limiter.RegisterAttempt(context.Background(), "10.0.0.1"); err != nil {
			t.Fatalf("intento %d (IP 1): error inesperado: %v", i, err)
		}
	}
	// IP distinta: no debería estar afectada por los 5 intentos de la otra.
	blocked, _, err := limiter.RegisterAttempt(context.Background(), "10.0.0.2")
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if blocked {
		t.Fatal("una IP distinta no debería compartir el cupo de otra")
	}
}

func TestLoginLimiter_VentanaVencidaResetea(t *testing.T) {
	store := newFakeStore()
	start := time.Now()
	limiter := newLimiter(store, start)

	for i := 1; i <= 5; i++ {
		if _, _, err := limiter.RegisterAttempt(context.Background(), "10.0.0.1"); err != nil {
			t.Fatalf("intento %d: error inesperado: %v", i, err)
		}
	}

	// Avanza el reloj más allá de la ventana de 15 minutos.
	limiter.Now = func() time.Time { return start.Add(16 * time.Minute) }

	blocked, _, err := limiter.RegisterAttempt(context.Background(), "10.0.0.1")
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if blocked {
		t.Fatal("una ventana vencida debería resetear el cupo, no seguir bloqueando")
	}
}
