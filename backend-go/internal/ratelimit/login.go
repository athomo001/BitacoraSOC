// Package ratelimit implementa el límite de login por IP
// (spec/07-backend-arquitectura-go.md sección 6.3): 5 intentos/15min,
// respaldado en Postgres (no en memoria) para que el límite sea correcto
// entre los nodos del clúster HA opcional, no solo dentro de un proceso.
package ratelimit

import (
	"context"
	"time"
)

// Window es el estado de una IP dentro de login_rate_limits.
type Window struct {
	AttemptCount    int
	WindowStartedAt time.Time
}

// Store abstrae login_rate_limits — implementado contra Postgres/sqlc en
// producción (ver internal/repository), contra un fake en tests.
type Store interface {
	Get(ctx context.Context, ip string) (Window, bool, error)
	Reset(ctx context.Context, ip string) error
	Increment(ctx context.Context, ip string, now time.Time) (int, error)
}

// LoginLimiter aplica la ventana deslizante de 15min/5 intentos.
type LoginLimiter struct {
	Store          Store
	MaxAttempts    int
	WindowDuration time.Duration
	// Now es inyectable para tests — en producción, time.Now.
	Now func() time.Time
}

// RegisterAttempt registra un intento de login desde ip y decide si debe
// bloquearse. Si la ventana anterior ya venció, se resetea el cupo
// transparentemente en vez de seguir acumulando indefinidamente.
func (l *LoginLimiter) RegisterAttempt(ctx context.Context, ip string) (blocked bool, retryAfter time.Duration, err error) {
	now := l.Now()

	window, exists, err := l.Store.Get(ctx, ip)
	if err != nil {
		return false, 0, err
	}

	if exists && now.Sub(window.WindowStartedAt) > l.WindowDuration {
		if err := l.Store.Reset(ctx, ip); err != nil {
			return false, 0, err
		}
		exists = false
	}

	count, err := l.Store.Increment(ctx, ip, now)
	if err != nil {
		return false, 0, err
	}

	if count > l.MaxAttempts {
		if exists {
			retryAfter = l.WindowDuration - now.Sub(window.WindowStartedAt)
		} else {
			retryAfter = l.WindowDuration
		}
		return true, retryAfter, nil
	}
	return false, 0, nil
}
