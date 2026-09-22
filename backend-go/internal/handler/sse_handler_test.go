package handler_test

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/handler"
)

// fakeLister simula la reposición desde Postgres sin una base de datos real.
type fakeLister struct {
	events []eventbus.Event
}

func (f *fakeLister) ListSince(ctx context.Context, lastEventID int64) ([]eventbus.Event, error) {
	var out []eventbus.Event
	for _, e := range f.events {
		if e.ID > lastEventID {
			out = append(out, e)
		}
	}
	return out, nil
}

func TestSSEHandler_ReponeEventosPerdidosConLastEventID(t *testing.T) {
	hub := eventbus.NewHub()
	lister := &fakeLister{events: []eventbus.Event{
		{ID: 1, EventType: "entry_created", Payload: []byte(`{"n":1}`)},
		{ID: 2, EventType: "entry_created", Payload: []byte(`{"n":2}`)},
	}}
	h := &handler.SSEHandler{Hub: hub, Lister: lister}

	srv := httptest.NewServer(http.HandlerFunc(h.Stream))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
	if err != nil {
		t.Fatalf("construyendo request: %v", err)
	}
	req.Header.Set("Last-Event-ID", "1") // el cliente ya vio el evento 1

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("haciendo la request SSE: %v", err)
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	var lines []string
	for scanner.Scan() {
		line := scanner.Text()
		lines = append(lines, line)
		if strings.Contains(line, `"n":2`) {
			break // ya vimos lo que esperábamos, no hace falta seguir leyendo el stream infinito
		}
	}

	got := strings.Join(lines, "\n")
	if strings.Contains(got, `"n":1`) {
		t.Fatalf("se repuso el evento 1, que el cliente ya había visto (Last-Event-ID=1):\n%s", got)
	}
	if !strings.Contains(got, "id: 2") || !strings.Contains(got, `"n":2`) {
		t.Fatalf("no se repuso el evento 2 (el que faltaba tras Last-Event-ID=1):\n%s", got)
	}
}

func TestSSEHandler_TransmiteEventosEnVivo(t *testing.T) {
	hub := eventbus.NewHub()
	h := &handler.SSEHandler{Hub: hub, Lister: &fakeLister{}}

	srv := httptest.NewServer(http.HandlerFunc(h.Stream))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("haciendo la request SSE: %v", err)
	}
	defer resp.Body.Close()

	// Espera a que el handler esté realmente suscrito antes de publicar —
	// evita una carrera donde Broadcast() ocurre antes de Subscribe().
	time.Sleep(100 * time.Millisecond)
	hub.Broadcast(eventbus.Event{ID: 99, EventType: "ping", Payload: []byte(`{"live":true}`)})

	scanner := bufio.NewScanner(resp.Body)
	var lines []string
	for scanner.Scan() {
		line := scanner.Text()
		lines = append(lines, line)
		if strings.Contains(line, `"live":true`) {
			return // éxito: el evento en vivo llegó al cliente
		}
	}
	t.Fatalf("no se recibió el evento en vivo en el stream:\n%s", strings.Join(lines, "\n"))
}
