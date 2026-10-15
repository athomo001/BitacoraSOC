package handler

import (
	"context"
	"fmt"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// Avisos de la Ticketera en la campana (spec/16 §4.5, 9.5): te asignaron un
// ticket o te sumaron como resolutor, derivaron uno a tu área, comentaron en
// uno tuyo. Los correos siguen siendo los de la Ticketera (spec/15).

func (h *TicketsHandler) notifyTicket(ctx context.Context, ticketID uuid.UUID, users []uuid.UUID, actor uuid.UUID, kind string, title func(t db.Ticket) string, body string) {
	if h.Notify == nil || len(users) == 0 {
		return
	}
	t, err := h.Queries.GetTicket(ctx, ticketID)
	if err != nil {
		return
	}
	if body == "" {
		body = t.Title
	}
	h.Notify.Send(ctx, users, NotifMsg{Kind: kind, Title: title(t), Body: body, Link: "/tickets?id=" + ticketID.String(), Exclude: actor})
}

func (h *TicketsHandler) notifyAssigned(ctx context.Context, ticketID, user, actor uuid.UUID, resolver bool) {
	h.notifyTicket(ctx, ticketID, []uuid.UUID{user}, actor, NotifTicketAssigned, func(t db.Ticket) string {
		if resolver {
			return fmt.Sprintf("Te sumaron como resolutor de %s", t.TicketNumber)
		}
		return fmt.Sprintf("Te asignaron %s (%s)", t.TicketNumber, strings.ToUpper(strings.SplitN(string(t.Priority), "_", 2)[0]))
	}, "")
}

func (h *TicketsHandler) notifyDerived(ctx context.Context, ticketID, area uuid.UUID, areaName, reason string, actor uuid.UUID) {
	if h.Notify == nil {
		return
	}
	h.notifyTicket(ctx, ticketID, h.Notify.areaMembers(ctx, area), actor, NotifTicketDerived, func(t db.Ticket) string {
		return fmt.Sprintf("%s se derivó a la cola de %s", t.TicketNumber, areaName)
	}, reason)
}

// notifyComment: a quien tiene el ticket y a sus resolutores, menos el autor.
func (h *TicketsHandler) notifyComment(ctx context.Context, t db.Ticket, author uuid.UUID, content string) {
	if h.Notify == nil {
		return
	}
	var users []uuid.UUID
	if t.AssignedUserID.Valid {
		users = append(users, uuid.UUID(t.AssignedUserID.Bytes))
	}
	if resolvers, err := h.Queries.ListTicketResolvers(ctx, t.ID); err == nil {
		for _, r := range resolvers {
			users = append(users, r.UserID)
		}
	}
	runes := []rune(content)
	if len(runes) > 140 {
		content = string(runes[:140]) + "…"
	}
	h.notifyTicket(ctx, t.ID, users, author, NotifTicketComment, func(t db.Ticket) string {
		return "Comentario en " + t.TicketNumber
	}, content)
}
