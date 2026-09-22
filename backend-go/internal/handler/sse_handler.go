package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
)

// eventLister permite reponer eventos perdidos desde la base de datos al
// reconectar (Last-Event-ID) — interfaz mínima en vez de acoplar el handler
// al tipo concreto *db.Queries, para poder probarlo con un stub.
type eventLister interface {
	ListSince(ctx context.Context, lastEventID int64) ([]eventbus.Event, error)
}

// SSEHandler expone el hub genérico de eventos como Server-Sent Events
// (GET /api/stream/events). Fase 2 del roadmap — ver
// spec/09-alta-disponibilidad-2-nodos.md secciones 3.2 y 9.3.
type SSEHandler struct {
	Hub    *eventbus.Hub
	Lister eventLister
}

// Stream atiende la conexión SSE de un cliente: si trae `Last-Event-ID`,
// repone primero lo que se perdió mientras estuvo desconectado, y después
// pasa a transmisión en vivo hasta que el cliente se desconecte.
func (h *SSEHandler) Stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming no soportado", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Suscribirse ANTES de reponer eventos pasados: si algo se publica justo
	// en el medio, se prefiere un evento duplicado (el cliente lo puede
	// ignorar por ID ya visto) a uno perdido por una ventana de carrera.
	sub := h.Hub.Subscribe()
	defer h.Hub.Unsubscribe(sub)

	if lastID, hasLastID := parseLastEventID(r); hasLastID {
		missed, err := h.Lister.ListSince(r.Context(), lastID)
		if err == nil {
			for _, evt := range missed {
				writeEvent(w, evt)
			}
			flusher.Flush()
		}
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case evt, open := <-sub.C:
			if !open {
				return
			}
			writeEvent(w, evt)
			flusher.Flush()
		}
	}
}

func parseLastEventID(r *http.Request) (int64, bool) {
	raw := r.Header.Get("Last-Event-ID")
	if raw == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

// writeEvent serializa un Event en formato SSE. El campo `id:` es lo que
// hace que el navegador reenvíe automáticamente `Last-Event-ID` al reconectar
// — no hace falta manejarlo a mano en el frontend.
func writeEvent(w io.Writer, evt eventbus.Event) {
	fmt.Fprintf(w, "id: %d\n", evt.ID)
	fmt.Fprintf(w, "event: %s\n", evt.EventType)
	fmt.Fprintf(w, "data: %s\n\n", evt.Payload)
}
