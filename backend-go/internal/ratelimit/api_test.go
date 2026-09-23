package ratelimit_test

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
)

func TestAPILimiter_PermiteHastaElLimitePorClave(t *testing.T) {
	now := time.Now()
	limiter := ratelimit.NewAPILimiter(3, time.Minute)
	limiter.Now = func() time.Time { return now }

	for i := 1; i <= 3; i++ {
		if !limiter.Allow("user:ana") {
			t.Fatalf("intento %d debería estar permitido (límite 3)", i)
		}
	}
	if limiter.Allow("user:ana") {
		t.Fatal("el 4to intento debería estar bloqueado")
	}
}

func TestAPILimiter_ClavesDistintasNoComparteCupo(t *testing.T) {
	now := time.Now()
	limiter := ratelimit.NewAPILimiter(1, time.Minute)
	limiter.Now = func() time.Time { return now }

	if !limiter.Allow("ip:1.2.3.4") {
		t.Fatal("primer intento debería estar permitido")
	}
	if !limiter.Allow("ip:5.6.7.8") {
		t.Fatal("una clave distinta no debería compartir el cupo de otra")
	}
}

func TestAPILimiter_VentanaVencidaResetea(t *testing.T) {
	start := time.Now()
	limiter := ratelimit.NewAPILimiter(1, time.Minute)
	limiter.Now = func() time.Time { return start }

	if !limiter.Allow("user:ana") {
		t.Fatal("primer intento debería estar permitido")
	}
	if limiter.Allow("user:ana") {
		t.Fatal("segundo intento en la misma ventana debería estar bloqueado")
	}

	limiter.Now = func() time.Time { return start.Add(2 * time.Minute) }
	if !limiter.Allow("user:ana") {
		t.Fatal("tras vencer la ventana, el cupo debería resetear")
	}
}
