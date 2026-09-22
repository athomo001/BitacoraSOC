// Package eventbus es el hub SSE genérico (Fase 2 del roadmap): un punto
// único de publicación que persiste en `system_events` y difunde en vivo a
// todos los clientes conectados, para que GET /api/stream/events pueda
// reponer eventos perdidos vía Last-Event-ID al reconectar.
// Ver spec/09-alta-disponibilidad-2-nodos.md secciones 3.2 y 9.3.
package eventbus

import (
	"context"
	"sync"
	"time"
)

// Event es la forma en memoria de una fila de system_events. Payload viaja
// como JSON crudo — el hub nunca interpreta su contenido, solo lo transporta.
type Event struct {
	ID        int64
	EventType string
	Scope     string
	Payload   []byte
	CreatedAt time.Time
}

// Store persiste un evento nuevo (implementado por internal/repository/db
// vía sqlc en producción; un stub en tests). Separado de Hub para que la
// lógica de fan-out se pueda probar sin una base de datos real.
type Store interface {
	Insert(ctx context.Context, eventType, scope string, payload []byte) (Event, error)
}

// subscriberBuffer es el tamaño del canal por suscriptor. Un cliente SSE
// lento se queda atrás y pierde los eventos más viejos del buffer en vez de
// bloquear a `Broadcast()` para todos los demás — un consumidor SSE ya sabe
// reponerse solo vía Last-Event-ID al reconectar, así que perder unos pocos
// eventos en memoria de un cliente lento es aceptable y no un bug.
const subscriberBuffer = 32

// Subscription es el handle que devuelve Subscribe(); C es de solo lectura
// para el llamador.
type Subscription struct {
	C  <-chan Event
	ch chan Event
}

// Hub reparte eventos a N suscriptores concurrentes y opcionalmente los
// persiste antes de difundirlos (ver Publish).
type Hub struct {
	Store Store

	mu   sync.Mutex
	subs map[chan Event]struct{}
}

// NewHub crea un hub vacío, listo para usar.
func NewHub() *Hub {
	return &Hub{subs: make(map[chan Event]struct{})}
}

// Subscribe registra un nuevo suscriptor. Siempre llamar a Unsubscribe
// cuando el cliente se desconecta, para no filtrar el canal.
func (h *Hub) Subscribe() *Subscription {
	ch := make(chan Event, subscriberBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return &Subscription{C: ch, ch: ch}
}

// Unsubscribe da de baja un suscriptor y cierra su canal. Idempotente.
func (h *Hub) Unsubscribe(sub *Subscription) {
	h.mu.Lock()
	if _, ok := h.subs[sub.ch]; ok {
		delete(h.subs, sub.ch)
		close(sub.ch)
	}
	h.mu.Unlock()
}

// Broadcast difunde un evento ya existente (por ejemplo, repuesto desde la
// base de datos) a todos los suscriptores activos, sin persistirlo de nuevo.
// Nunca bloquea: un suscriptor con el buffer lleno se salta ese evento en vez
// de frenar a los demás (ver subscriberBuffer).
func (h *Hub) Broadcast(evt Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- evt:
		default:
			// Suscriptor lento: se descarta este evento para él, no se bloquea.
		}
	}
}

// Publish persiste el evento (vía Store, típicamente Postgres) y luego lo
// difunde con el ID real ya asignado — mismo patrón que
// spec/09-alta-disponibilidad-2-nodos.md sección 9.3.1 (DeploymentNotifier).
func (h *Hub) Publish(ctx context.Context, eventType, scope string, payload []byte) (Event, error) {
	evt, err := h.Store.Insert(ctx, eventType, scope, payload)
	if err != nil {
		return Event{}, err
	}
	h.Broadcast(evt)
	return evt, nil
}
