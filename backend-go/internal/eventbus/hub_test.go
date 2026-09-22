package eventbus_test

import (
	"context"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
)

func TestHub_SubscribeReceivesPublishedEvent(t *testing.T) {
	hub := eventbus.NewHub()

	sub := hub.Subscribe()
	defer hub.Unsubscribe(sub)

	published := eventbus.Event{ID: 1, EventType: "entry_created", Scope: "general", Payload: []byte(`{"ok":true}`)}
	hub.Broadcast(published)

	select {
	case got := <-sub.C:
		if got.EventType != published.EventType {
			t.Fatalf("EventType = %q, se esperaba %q", got.EventType, published.EventType)
		}
	case <-time.After(time.Second):
		t.Fatal("no se recibió el evento publicado dentro de 1s")
	}
}

func TestHub_UnsubscribeDetieneLaEntrega(t *testing.T) {
	hub := eventbus.NewHub()
	sub := hub.Subscribe()
	hub.Unsubscribe(sub)

	hub.Broadcast(eventbus.Event{ID: 1, EventType: "entry_created"})

	select {
	case _, ok := <-sub.C:
		if ok {
			t.Fatal("se recibió un evento después de Unsubscribe()")
		}
		// canal cerrado: comportamiento esperado también.
	case <-time.After(100 * time.Millisecond):
		// tampoco llegó nada: comportamiento esperado.
	}
}

func TestHub_UnClienteLentoNoBloqueaAOtrosSuscriptores(t *testing.T) {
	hub := eventbus.NewHub()
	slow := hub.Subscribe() // nunca lee su canal
	defer hub.Unsubscribe(slow)
	fast := hub.Subscribe()
	defer hub.Unsubscribe(fast)

	done := make(chan struct{})
	go func() {
		// Publica más eventos que el buffer del canal lento — si Broadcast
		// bloqueara por un suscriptor lento, esto nunca terminaría.
		for i := 0; i < 200; i++ {
			hub.Broadcast(eventbus.Event{ID: int64(i), EventType: "tick"})
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Broadcast() se bloqueó por un suscriptor lento")
	}

	select {
	case <-fast.C:
	case <-time.After(time.Second):
		t.Fatal("el suscriptor rápido no recibió ningún evento")
	}
}

// storeStub simula la persistencia real (Postgres) para probar Publish sin BD.
type storeStub struct {
	nextID int64
}

func (s *storeStub) Insert(ctx context.Context, eventType, scope string, payload []byte) (eventbus.Event, error) {
	s.nextID++
	return eventbus.Event{ID: s.nextID, EventType: eventType, Scope: scope, Payload: payload}, nil
}

func TestHub_PublishPersisteYLuegoDifunde(t *testing.T) {
	store := &storeStub{}
	hub := eventbus.NewHub()
	hub.Store = store

	sub := hub.Subscribe()
	defer hub.Unsubscribe(sub)

	evt, err := hub.Publish(context.Background(), "deployment_ready", "general", []byte(`{}`))
	if err != nil {
		t.Fatalf("Publish() error inesperado: %v", err)
	}
	if evt.ID != 1 {
		t.Fatalf("ID del evento persistido = %d, se esperaba 1 (asignado por el store)", evt.ID)
	}

	select {
	case got := <-sub.C:
		if got.ID != evt.ID {
			t.Fatalf("el evento difundido tiene ID %d, se esperaba %d (el que devolvió el store)", got.ID, evt.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("Publish() no difundió el evento a los suscriptores")
	}
}
