package repository

import (
	"context"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// EventStore adapta db.Queries (sqlc) a las interfaces que necesita el hub
// SSE genérico (eventbus.Store para persistir, handler.eventLister para
// reponer tras Last-Event-ID) — un solo adaptador para ambos usos.
type EventStore struct {
	Queries *db.Queries
}

// Insert persiste un evento nuevo en system_events (ver eventbus.Store).
func (s *EventStore) Insert(ctx context.Context, eventType, scope string, payload []byte) (eventbus.Event, error) {
	row, err := s.Queries.InsertSystemEvent(ctx, db.InsertSystemEventParams{
		EventType: eventType,
		Scope:     db.EntryScope(scope),
		Payload:   payload,
	})
	if err != nil {
		return eventbus.Event{}, err
	}
	return toEvent(row), nil
}

// ListSince repone eventos publicados después de lastEventID (ver
// handler.eventLister), con un tope defensivo para no cargar de más si el
// cliente estuvo desconectado mucho tiempo.
func (s *EventStore) ListSince(ctx context.Context, lastEventID int64) ([]eventbus.Event, error) {
	const maxReplay = 500
	rows, err := s.Queries.ListSystemEventsSince(ctx, db.ListSystemEventsSinceParams{
		ID:    lastEventID,
		Limit: maxReplay,
	})
	if err != nil {
		return nil, err
	}
	events := make([]eventbus.Event, 0, len(rows))
	for _, row := range rows {
		events = append(events, toEvent(row))
	}
	return events, nil
}

func toEvent(row db.SystemEvent) eventbus.Event {
	return eventbus.Event{
		ID:        row.ID,
		EventType: row.EventType,
		Scope:     string(row.Scope),
		Payload:   row.Payload,
		CreatedAt: row.CreatedAt.Time,
	}
}
