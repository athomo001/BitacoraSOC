package handler

import (
	"context"
	"fmt"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Evidencia en la bitácora (HU-1t punto 2): al abrir un incidente de
// escalamiento se crea su entrada, y cada intento, comentario, cierre o
// reapertura queda ahí como comentario de sistema. Así el turno ve en la
// bitácora lo mismo que el historial forense del incidente, sin copiarlo a
// mano.

var attemptResultLabel = map[string]string{
	"answered":            "Contestó",
	"no_answer":           "No contesta",
	"busy":                "Ocupado",
	"unreachable":         "Inalcanzable",
	"escalated_next_tier": "Escaló al nivel siguiente",
}

var channelLabel = map[string]string{
	"call": "llamada", "whatsapp": "WhatsApp", "sms": "SMS", "email": "correo", "other": "otro medio",
}

// incidentTarget es el nombre de lo que falla y el ámbito de la entrada.
func (h *EscalationHandler) incidentTarget(ctx context.Context, q *db.Queries, s scope) (string, db.EntryScope) {
	switch {
	case s.ServiceID != nil:
		if svc, err := q.GetService(ctx, *s.ServiceID); err == nil {
			return "Servicio " + svc.Name, db.EntryScopeSoc
		}
		return "Servicio", db.EntryScopeSoc
	case s.AssetID != nil:
		if a, err := q.GetAsset(ctx, *s.AssetID); err == nil {
			return "Activo " + a.Name, db.EntryScopeNoc
		}
		return "Activo", db.EntryScopeNoc
	default:
		if u, err := q.GetTerritorialUnit(ctx, *s.TerritorialUnitID); err == nil {
			return "Zona " + u.Name, db.EntryScopeNoc
		}
		return "Zona", db.EntryScopeNoc
	}
}

// openIncidentEntry crea la entrada del incidente y la enlaza (misma
// transacción que el incidente).
func (h *EscalationHandler) openIncidentEntry(ctx context.Context, q *db.Queries, inc db.EscalationIncident, s scope, userID uuid.UUID, glpi string) error {
	target, entryScope := h.incidentTarget(ctx, q, s)
	content := fmt.Sprintf("**Escalamiento:** %s\n\n%s", inc.Title, target)
	if glpi != "" {
		content += " · GLPI #" + glpi
	}
	entry, err := q.CreateEntry(ctx, db.CreateEntryParams{
		UserID: userID, EntryType: db.EntryTypeIncidente, Scope: entryScope, Content: content, Tags: []string{"escalamiento"},
		ServiceID: inc.ServiceID, AssetID: inc.AssetID,
	})
	if err != nil {
		return err
	}
	if inc.TicketID.Valid {
		if _, err := q.UpdateEntryTicket(ctx, db.UpdateEntryTicketParams{ID: entry.ID, TicketID: inc.TicketID}); err != nil {
			return err
		}
	}
	return q.SetEscalationIncidentEntry(ctx, db.SetEscalationIncidentEntryParams{ID: inc.ID, EntryID: pgtype.UUID{Bytes: entry.ID, Valid: true}})
}

// logToEntry deja un comentario de sistema en la entrada. Mejor esfuerzo: el
// intento ya quedó registrado (inmutable) en escalation_action_logs; si la
// bitácora falla, se informa en la respuesta en vez de perder el intento.
func (h *EscalationHandler) logToEntry(ctx context.Context, entryID pgtype.UUID, userID uuid.UUID, text string) bool {
	if !entryID.Valid {
		return true
	}
	_, err := h.Queries.CreateEntryComment(ctx, db.CreateEntryCommentParams{
		EntryID: uuid.UUID(entryID.Bytes), UserID: userID, Comment: text, IsSystemGenerated: true,
	})
	return err == nil
}

// attemptText arma el comentario de un intento: "Nivel 2 · Andrea Pino · No contesta (llamada) — nota → pasa al nivel 3".
func attemptText(stepOrder int32, member, result, channel, notes string, nextStep int32) string {
	label := attemptResultLabel[result]
	if label == "" {
		label = result
	}
	ch := channelLabel[channel]
	if ch == "" {
		ch = channel
	}
	text := fmt.Sprintf("Nivel %d · %s · %s (%s)", stepOrder, member, label, ch)
	if n := strings.TrimSpace(notes); n != "" {
		text += " — " + n
	}
	if nextStep > 0 {
		text += fmt.Sprintf(" → pasa al nivel %d", nextStep)
	}
	return text
}
