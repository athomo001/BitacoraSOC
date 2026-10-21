// Package forward reenvía los eventos de la app a un SIEM (spec/19 §3):
// cada evento queda en la cola persistente forward_outbox y cada destino
// (syslog UDP/TCP/TLS o HTTP) la recorre con su cursor, así nada se pierde
// si el SIEM o la app se reinician.
package forward

import (
	"strings"
	"time"
)

// Grupo de un evento: en la base (forward_outbox.grp) y en el JSON que llega
// al SIEM (Event.Group).
const (
	GroupAudit      = "audit"
	GroupEntries    = "entries"
	GroupEscalation = "escalation"
	GroupTickets    = "tickets"
)

// wireGroup es el nombre del grupo en el JSON, el mismo que ve la pantalla.
var wireGroup = map[string]string{
	GroupAudit: "auditoria", GroupEntries: "bitacora", GroupEscalation: "escalamiento", GroupTickets: "ticketera",
}

// Version del JSON que llega al SIEM; cambia solo si se rompe la forma.
const Version = 1

// Event es lo que llega al SIEM, una línea de JSON por evento.
type Event struct {
	V       int            `json:"v"`
	TS      time.Time      `json:"ts"`
	Source  string         `json:"source"`
	Group   string         `json:"group"`
	Event   string         `json:"event"`
	Level   string         `json:"level"`
	Success *bool          `json:"success,omitempty"`
	Reason  string         `json:"reason,omitempty"`
	Actor   *Actor         `json:"actor,omitempty"`
	Request *Request       `json:"request,omitempty"`
	Client  *Ref           `json:"client,omitempty"`
	Object  *Object        `json:"object,omitempty"`
	Data    map[string]any `json:"data,omitempty"`
	Node    string         `json:"node,omitempty"`
}

type Actor struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
	Role string `json:"role,omitempty"`
}

type Request struct {
	ID     string `json:"id,omitempty"`
	IP     string `json:"ip,omitempty"`
	Method string `json:"method,omitempty"`
	Path   string `json:"path,omitempty"`
}

type Ref struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}

type Object struct {
	Type string `json:"type"`
	ID   string `json:"id,omitempty"`
	Ref  string `json:"ref,omitempty"`
}

// opsEvents: los eventos de operación y su grupo. Todo lo demás es
// auditoría (ingresos, configuración, accesos denegados, respaldos).
var opsEvents = map[string]string{
	"entry.created": GroupEntries, "entry.created_with_ticket": GroupEntries, "entry.updated": GroupEntries,
	"entry.deleted": GroupEntries, "entry.resolved": GroupEntries, "entry.comment_added": GroupEntries,
	"entry.converted_to_ticket": GroupEntries, "entry.bulk_patched": GroupEntries,

	"escalation.incident.opened": GroupEscalation, "escalation.incident.closed": GroupEscalation,
	"escalation.incident.reopened": GroupEscalation, "escalation.incident.note": GroupEscalation,
	"escalation.action": GroupEscalation, "escalation.notify.sent": GroupEscalation,

	"ticket.created": GroupTickets, "ticket.updated": GroupTickets, "ticket.assigned": GroupTickets,
	"ticket.derived": GroupTickets, "ticket.move": GroupTickets, "ticket.client_changed": GroupTickets,
	"ticket.comment_added": GroupTickets, "ticket.comment": GroupTickets, "ticket.merged": GroupTickets,
	"ticket.deleted": GroupTickets, "ticket.sla_breached": GroupTickets, "ticket.glpi_synced": GroupTickets,
}

// Classify dice a qué grupo va un evento por su nombre.
func Classify(event string) string {
	if g, ok := opsEvents[event]; ok {
		return g
	}
	return GroupAudit
}

// Rank ordena los niveles para el «desde» de la auditoría.
func Rank(level string) int {
	switch level {
	case "warn":
		return 1
	case "error":
		return 2
	}
	return 0
}

// NormalizeLevel deja solo info, warn o error.
func NormalizeLevel(level string) string {
	switch strings.ToLower(level) {
	case "warn", "warning":
		return "warn"
	case "error", "critical", "fatal":
		return "error"
	}
	return "info"
}
