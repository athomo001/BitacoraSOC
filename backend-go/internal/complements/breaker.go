package complements

import (
	"sync"
	"time"
)

// Estados del circuit breaker (mismos nombres que el legacy).
const (
	CircuitClosed   = "CLOSED"
	CircuitOpen     = "OPEN"
	CircuitHalfOpen = "HALF_OPEN"
)

// Reglas de spec/11 HU-COMP-6: 3 fallos seguidos abren el circuito; tras 30 s
// se deja pasar una prueba y, si responde, se cierra.
const (
	breakerThreshold = 3
	breakerCooldown  = 30 * time.Second
)

// Breaker lleva el estado de salud de los complementos "servicio" en este
// nodo (en memoria, como el legacy: cada nodo sondea por su cuenta).
type Breaker struct {
	mu    sync.Mutex
	state map[string]*circuit
	now   func() time.Time
}

type circuit struct {
	failures int
	openedAt time.Time
	lastErr  string
}

// NewBreaker arma un breaker vacío.
func NewBreaker() *Breaker { return &Breaker{state: map[string]*circuit{}, now: time.Now} }

func (b *Breaker) get(slug string) *circuit {
	c, ok := b.state[slug]
	if !ok {
		c = &circuit{}
		b.state[slug] = c
	}
	return c
}

// State dice el estado actual del circuito de slug.
func (b *Breaker) State(slug string) (string, string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c := b.get(slug)
	switch {
	case c.failures < breakerThreshold:
		return CircuitClosed, c.lastErr
	case b.now().Sub(c.openedAt) >= breakerCooldown:
		return CircuitHalfOpen, c.lastErr
	default:
		return CircuitOpen, c.lastErr
	}
}

// Record anota el resultado de una sonda de salud.
func (b *Breaker) Record(slug string, ok bool, errText string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c := b.get(slug)
	if ok {
		c.failures, c.lastErr = 0, ""
		return
	}
	c.failures++
	c.lastErr = errText
	if c.failures >= breakerThreshold {
		// Abrir (o reabrir tras una prueba fallida en HALF_OPEN) reinicia la espera.
		c.openedAt = b.now()
	}
}

// Forget borra el estado de un complemento eliminado.
func (b *Breaker) Forget(slug string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.state, slug)
}
