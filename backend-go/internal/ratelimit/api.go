package ratelimit

import (
	"sync"
	"time"
)

type apiWindow struct {
	count     int
	startedAt time.Time
}

// APILimiter es el límite general de la API (300 req/15min sin autenticar,
// 1200 req/15min autenticado — spec/07-backend-arquitectura-go.md sección
// 6.3): en memoria por nodo, control de mejor esfuerzo, no un límite de
// seguridad duro como el de login (que sí vive en Postgres). Se limita por
// identidad real (user_id/api_key_id cuando existen, IP solo para tráfico
// anónimo), nunca por header/IP heurística.
type APILimiter struct {
	maxRequests int
	window      time.Duration
	// Now es inyectable para tests — en producción, time.Now.
	Now func() time.Time

	mu       sync.Mutex
	counters map[string]apiWindow
}

// NewAPILimiter construye un limitador con maxRequests por window, por clave.
func NewAPILimiter(maxRequests int, window time.Duration) *APILimiter {
	return &APILimiter{
		maxRequests: maxRequests,
		window:      window,
		Now:         time.Now,
		counters:    make(map[string]apiWindow),
	}
}

// Reset vacía todos los contadores — válvula de emergencia
// (POST /api/system/rate-limit-reset). El limitador en memoria no soporta
// resetear una sola clave (es de mejor esfuerzo, no un control de
// seguridad duro como el de login); si hace falta ese detalle, usar el
// scope "login" en vez de "api".
func (l *APILimiter) Reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.counters = make(map[string]apiWindow)
}

// Allow registra una request para key y devuelve si está dentro del cupo.
func (l *APILimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.Now()
	win, ok := l.counters[key]
	if !ok || now.Sub(win.startedAt) > l.window {
		win = apiWindow{count: 0, startedAt: now}
	}
	win.count++
	l.counters[key] = win

	return win.count <= l.maxRequests
}
