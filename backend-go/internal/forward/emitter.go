package forward

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// subsTTL: cada cuánto se relee qué grupos piden los destinos encendidos.
// Al guardar un destino se invalida al instante (en ese nodo).
const subsTTL = 15 * time.Second

type subscriptions struct {
	audit                        bool
	minRank                      int
	entries, escalation, tickets bool
}

func (s subscriptions) wants(group string, level string) bool {
	switch group {
	case GroupEntries:
		return s.entries
	case GroupEscalation:
		return s.escalation
	case GroupTickets:
		return s.tickets
	}
	return s.audit && Rank(level) >= s.minRank
}

// Emitter deja los eventos en la cola. Sin destinos encendidos que pidan el
// grupo, no guarda nada: el costo de tener el reenvío apagado es cero.
type Emitter struct {
	Queries *db.Queries
	Logger  *slog.Logger
	// Node es el nombre del nodo que produjo el evento (alta disponibilidad).
	Node string
	Now  func() time.Time

	mu       sync.Mutex
	subs     subscriptions
	loadedAt time.Time
}

func (e *Emitter) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

// Invalidate hace que la próxima emisión relea los destinos.
func (e *Emitter) Invalidate() {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.loadedAt = time.Time{}
	e.mu.Unlock()
}

func (e *Emitter) subscriptions(ctx context.Context) subscriptions {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.loadedAt.IsZero() && e.now().Sub(e.loadedAt) < subsTTL {
		return e.subs
	}
	rows, err := e.Queries.ListForwardSubscriptions(ctx)
	if err != nil {
		return e.subs // se reintenta en la próxima: mejor el último conocido que nada
	}
	s := subscriptions{minRank: 3}
	for _, r := range rows {
		if r.SendAudit {
			s.audit = true
			s.minRank = min(s.minRank, Rank(r.AuditLevel))
		}
		s.entries = s.entries || r.SendEntries
		s.escalation = s.escalation || r.SendEscalation
		s.tickets = s.tickets || r.SendTickets
	}
	e.subs, e.loadedAt = s, e.now()
	return s
}

// Emit encola un evento ya armado (los que no pasan por la auditoría, como
// los cambios de un ticket de GLPI). Mejor esfuerzo: nunca corta el flujo.
func (e *Emitter) Emit(ctx context.Context, ev Event) {
	if e == nil || e.Queries == nil {
		return
	}
	if ev.Group == "" {
		ev.Group = wireGroup[Classify(ev.Event)]
	}
	group := groupFromWire(ev.Group)
	ev.Level = NormalizeLevel(ev.Level)
	if !e.subscriptions(ctx).wants(group, ev.Level) {
		return
	}
	e.store(ctx, group, ev)
}

// FromAudit es el gancho del registro de auditoría: todo lo auditado pasa
// por aquí y se clasifica en su grupo.
func (e *Emitter) FromAudit(ctx context.Context, a audit.Entry) {
	if e == nil || e.Queries == nil {
		return
	}
	group := Classify(a.Event)
	level := NormalizeLevel(string(a.Level))
	if !e.subscriptions(ctx).wants(group, level) {
		return
	}
	ok := a.Success
	ev := Event{Event: a.Event, Level: level, Success: &ok, Reason: a.Reason, Data: a.Metadata}
	if a.ActorUserID != nil || a.ActorUsername != "" {
		ev.Actor = &Actor{Name: a.ActorUsername, Role: a.ActorRole}
		if a.ActorUserID != nil {
			ev.Actor.ID = a.ActorUserID.String()
		}
	}
	if a.RequestIP != "" || a.RequestPath != "" {
		ev.Request = &Request{ID: a.RequestID, IP: a.RequestIP, Method: a.RequestMethod, Path: a.RequestPath}
	}
	if group != GroupAudit {
		e.enrich(ctx, group, &ev)
	}
	e.store(ctx, group, ev)
}

func (e *Emitter) store(ctx context.Context, group string, ev Event) {
	ev.V, ev.Source, ev.Group = Version, "bitacora", wireGroup[group]
	if ev.TS.IsZero() {
		ev.TS = e.now().UTC()
	}
	if ev.Node == "" {
		ev.Node = e.Node
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		return
	}
	if err := e.Queries.InsertForwardEvent(ctx, db.InsertForwardEventParams{Grp: group, Level: ev.Level, Event: ev.Event, Payload: payload}); err != nil && e.Logger != nil {
		e.Logger.Error("forward: no se pudo encolar el evento", "event", ev.Event, "error", err)
	}
}

func groupFromWire(g string) string {
	for k, v := range wireGroup {
		if v == g || k == g {
			return k
		}
	}
	return GroupAudit
}

// enrich completa un evento de operación con lo que el SIEM necesita para
// leerlo solo: el texto de la entrada, el número y estado del ticket, el
// cliente. Sale de la base en el momento, así queda como estaba entonces.
func (e *Emitter) enrich(ctx context.Context, group string, ev *Event) {
	meta := ev.Data
	idOf := func(key string) (uuid.UUID, bool) {
		s, _ := meta[key].(string)
		id, err := uuid.Parse(s)
		return id, err == nil
	}
	switch group {
	case GroupEntries:
		id, ok := idOf("entryId")
		if !ok {
			return
		}
		ev.Object = &Object{Type: "entry", ID: id.String()}
		rows, err := e.Queries.ListEntriesForAPI(ctx, db.ListEntriesForAPIParams{ID: pgtype.UUID{Bytes: id, Valid: true}, MaxRows: 1})
		if err != nil || len(rows) == 0 {
			return // borrada: la auditoría ya trae lo que quedó (contentSnapshot)
		}
		en := rows[0]
		data := cloneMap(meta)
		data["entryType"], data["scope"], data["content"], data["tags"] = string(en.EntryType), string(en.Scope), en.Content, en.Tags
		data["author"] = en.AuthorUsername
		if en.ApiKeyName.Valid {
			data["apiKey"] = en.ApiKeyName.String
		}
		ev.Data = data
		if en.ClientID != "" {
			ev.Client = &Ref{ID: en.ClientID, Name: en.ClientName}
		}
	case GroupTickets:
		id, ok := idOf("ticketId")
		if !ok {
			return
		}
		ev.Object = &Object{Type: "ticket", ID: id.String()}
		t, err := e.Queries.GetTicketBrief(ctx, id)
		if err != nil {
			return
		}
		ev.Object.Ref = t.TicketNumber
		ev.Client = &Ref{ID: t.ClientID.String(), Name: t.ClientName}
		data := cloneMap(meta)
		data["title"], data["status"], data["priority"], data["type"] = t.Title, t.Status, t.Priority, t.TicketType
		data["area"], data["source"] = t.AreaName, t.Source
		if t.Assignee != "" {
			data["assignee"] = t.Assignee
		}
		if t.SlaResolutionDueAt.Valid {
			data["slaResolutionDue"] = t.SlaResolutionDueAt.Time.UTC().Format(time.RFC3339)
		}
		ev.Data = data
	case GroupEscalation:
		if id, ok := idOf("incidentId"); ok {
			ev.Object = &Object{Type: "incident", ID: id.String()}
		} else if id, ok := idOf("actionLogId"); ok {
			ev.Object = &Object{Type: "escalation_action", ID: id.String()}
		}
	}
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m)+8)
	for k, v := range m {
		out[k] = v
	}
	return out
}

// TestEvent es el evento de «Probar».
func TestEvent(node, who string) Event {
	return Event{V: Version, TS: time.Now().UTC(), Source: "bitacora", Group: wireGroup[GroupAudit], Event: "bitacora.test", Level: "info",
		Actor: &Actor{Name: who}, Data: map[string]any{"message": fmt.Sprintf("Prueba de envío desde Bitácora Ops (%s)", who)}, Node: node}
}
