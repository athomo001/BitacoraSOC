package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/tickets"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Unir tickets duplicados, tickets padre/hijo y cambiar el cliente (pedido
// del dueño 2026-10-07, canvas "Ticketera: unir y padre/hijo"). A diferencia
// de GLPI, la relación padre/hijo no es solo informativa: lo que se publica
// en el padre llega a los hijos, lo que pasa en los hijos se ve en el padre,
// y esperar proveedor / retomar / resolver se propagan.

var ticketStatusLabel = map[tickets.Status]string{
	tickets.New: "Nuevo", tickets.Assigned: "Asignado", tickets.InProgress: "En curso",
	tickets.PendingVendor: "Espera proveedor", tickets.Resolved: "Resuelto", tickets.Closed: "Cerrado",
}

const maxRelationReason = 500

// ticketNote deja un comentario interno sin los efectos de un comentario
// normal (no reabre ni cuenta como primera respuesta): avisos del sistema
// entre padre e hijos y constancias de unir o cambiar cliente.
func ticketNote(ctx context.Context, q *db.Queries, ticketID uuid.UUID, user middleware.AuthenticatedUser, content string, isPublic bool, origin string) error {
	_, err := q.CreateTicketComment(ctx, db.CreateTicketCommentParams{
		TicketID: ticketID, UserID: pgtype.UUID{Bytes: user.ID, Valid: user.ID != uuid.Nil}, AuthorName: user.Username,
		Content: content, IsPublic: isPublic, Origin: origin,
	})
	return err
}

// afterStatusChange corre después de cambiar el estado de un ticket: avisa al
// padre y, si es un padre, propaga a los hijos abiertos. Mejor esfuerzo: el
// cambio principal ya quedó guardado.
func (h *TicketsHandler) afterStatusChange(ctx context.Context, old db.Ticket, to tickets.Status, alsoChildren bool, actor middleware.AuthenticatedUser, now time.Time) {
	from := tickets.Status(old.Status)
	if old.ParentID.Valid {
		_ = ticketNote(ctx, h.Queries, uuid.UUID(old.ParentID.Bytes), actor,
			fmt.Sprintf("%s pasó a %s.", old.TicketNumber, ticketStatusLabel[to]), false, "child:"+old.TicketNumber)
		h.notifyChanged(ctx, uuid.UUID(old.ParentID.Bytes))
	}
	children, err := h.Queries.ListOpenChildTickets(ctx, pgtype.UUID{Bytes: old.ID, Valid: true})
	if err != nil || len(children) == 0 {
		return
	}
	origin := "parent:" + old.TicketNumber
	for _, c := range children {
		cs := tickets.Status(c.Status)
		var target tickets.Status
		var note string
		switch {
		case to == tickets.PendingVendor && cs == tickets.InProgress:
			target, note = tickets.PendingVendor, "En espera de proveedor como el padre: SLA en pausa."
		case from == tickets.PendingVendor && to == tickets.InProgress && cs == tickets.PendingVendor:
			target, note = tickets.InProgress, "Se retoma junto con el padre."
		case to == tickets.Resolved && alsoChildren:
			// Lo resuelve el padre: vale desde cualquier estado abierto.
			target, note = tickets.Resolved, "Resuelto junto con el padre."
		default:
			continue
		}
		p := baseTicketUpdate(c)
		applyTicketStatus(&p, c, target, now)
		if _, err := h.Queries.UpdateTicket(ctx, p); err != nil {
			continue
		}
		_ = ticketNote(ctx, h.Queries, c.ID, actor, note, false, origin)
		h.notifyChanged(ctx, c.ID)
	}
}

// cascadeComment: un comentario en el padre con "también en los hijos" llega
// a cada hijo abierto (cada cliente lo ve en su propio ticket); un comentario
// público en un hijo se ve en el padre.
func (h *TicketsHandler) cascadeComment(ctx context.Context, ticket db.Ticket, user middleware.AuthenticatedUser, content string, isPublic, alsoChildren bool) int {
	copied := 0
	if alsoChildren {
		children, err := h.Queries.ListOpenChildTickets(ctx, pgtype.UUID{Bytes: ticket.ID, Valid: true})
		if err == nil {
			for _, c := range children {
				if _, err := h.addTicketCommentFrom(ctx, h.Queries, c, user, content, isPublic, "parent:"+ticket.TicketNumber); err == nil {
					copied++
					h.notifyChanged(ctx, c.ID)
				}
			}
		}
	}
	if ticket.ParentID.Valid && isPublic {
		_ = ticketNote(ctx, h.Queries, uuid.UUID(ticket.ParentID.Bytes), user, content, false, "child:"+ticket.TicketNumber)
		h.notifyChanged(ctx, uuid.UUID(ticket.ParentID.Bytes))
	}
	return copied
}

// ===== Unir =====

type mergeTicketsRequest struct {
	MainID  uuid.UUID `json:"mainId"`
	OtherID uuid.UUID `json:"otherId"`
	Reason  string    `json:"reason"`
}

// Merge es POST /api/tickets/merge: el ticket "other" se une al "main". Todo
// su historial pasa al principal (marcado 'merged:TKT-…') y él queda cerrado
// como "Unido a…", sin borrarse. Pueden el admin o quien creó cualquiera de
// los dos; mismo cliente y ninguno cerrado ni unido antes. No se deshace.
func (h *TicketsHandler) Merge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req mergeTicketsRequest
	if err := decodeJSON(w, r, &req); err != nil || req.MainID == uuid.Nil || req.OtherID == uuid.Nil || req.MainID == req.OtherID {
		problemdetails.Write(w, r, 400, "invalid-payload", "indica los dos tickets (distintos) a unir")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" || len([]rune(reason)) > maxRelationReason {
		problemdetails.Write(w, r, 400, "invalid-payload", "el motivo es obligatorio (hasta 500 caracteres)")
		return
	}
	main, err1 := h.Queries.GetTicket(ctx, req.MainID)
	other, err2 := h.Queries.GetTicket(ctx, req.OtherID)
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	createdBy := func(t db.Ticket) bool { return t.CreatedBy.Valid && uuid.UUID(t.CreatedBy.Bytes) == user.ID }
	if user.Role != "admin" && !createdBy(main) && !createdBy(other) {
		problemdetails.Write(w, r, 403, "forbidden", "solo el administrador o quien creó alguno de los dos tickets puede unirlos")
		return
	}
	switch {
	case main.ClientID != other.ClientID:
		problemdetails.Write(w, r, 409, "different-client", "solo se unen tickets del mismo cliente (si uno está mal, cambia primero su cliente)")
		return
	case main.MergedIntoID.Valid || other.MergedIntoID.Valid:
		problemdetails.Write(w, r, 409, "already-merged", "uno de los tickets ya se unió a otro")
		return
	case main.Status == db.TicketStatusClosed || other.Status == db.TicketStatusClosed:
		problemdetails.Write(w, r, 409, "ticket-closed", "un ticket cerrado no se une: reábrelo primero")
		return
	}
	otherChildren, err := h.Queries.CountTicketChildren(ctx, pgtype.UUID{Bytes: other.ID, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo revisar el ticket")
		return
	}
	if otherChildren > 0 && main.ParentID.Valid {
		problemdetails.Write(w, r, 409, "nested-parent", "el que se une tiene hijos y el principal es hijo de otro: solo hay un nivel")
		return
	}
	if other.ParentID.Valid && main.ParentID.Valid && other.ParentID != main.ParentID {
		problemdetails.Write(w, r, 409, "different-parent", "los dos son hijos de padres distintos")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo unir")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	steps := []func() error{
		func() error {
			return q.MoveTicketComments(ctx, db.MoveTicketCommentsParams{MainID: main.ID, OtherNumber: other.TicketNumber, OtherID: other.ID})
		},
		func() error {
			return q.MoveTicketTasks(ctx, db.MoveTicketTasksParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			return q.MoveTicketImages(ctx, db.MoveTicketImagesParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			return q.MoveTicketEntries(ctx, db.MoveTicketEntriesParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			return q.MoveTicketEscalationIncidents(ctx, db.MoveTicketEscalationIncidentsParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			return q.CopyTicketResolvers(ctx, db.CopyTicketResolversParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			return q.MoveTicketChildren(ctx, db.MoveTicketChildrenParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			return q.MarkTicketMerged(ctx, db.MarkTicketMergedParams{MainID: main.ID, OtherID: other.ID})
		},
		func() error {
			// El principal hereda el padre del otro si no tenía uno.
			if other.ParentID.Valid && !main.ParentID.Valid && otherChildren == 0 {
				return q.SetTicketParent(ctx, db.SetTicketParentParams{ID: main.ID, ParentID: other.ParentID})
			}
			return nil
		},
		func() error {
			return ticketNote(ctx, q, main.ID, user, fmt.Sprintf("Se une %s: %s", other.TicketNumber, reason), false, "")
		},
		func() error {
			return ticketNote(ctx, q, other.ID, user, fmt.Sprintf("Este ticket se unió a %s, donde sigue el seguimiento.", main.TicketNumber), true, "")
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo unir")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo unir")
		return
	}
	h.AuditLog.Log(ctx, "ticket.merged", audit.LevelInfo, audit.Success(), map[string]any{
		"mainId": main.ID.String(), "mainNumber": main.TicketNumber, "otherId": other.ID.String(), "otherNumber": other.TicketNumber, "reason": reason,
	})
	h.notifyChanged(ctx, main.ID)
	h.notifyChanged(ctx, other.ID)
	d, err := h.loadDetail(r, main.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo recargar el ticket")
		return
	}
	writeData(w, 200, d)
}

// ===== Padre / hijo =====

type setParentRequest struct {
	// ParentNumber: TKT-… del padre; vacío quita el padre.
	ParentNumber string `json:"parentNumber"`
}

// validParent revisa que child pueda colgar de parent (un solo nivel).
func (h *TicketsHandler) validParent(ctx context.Context, child, parent db.Ticket) (string, string) {
	switch {
	case child.ID == parent.ID:
		return "invalid-parent", "un ticket no puede ser su propio padre"
	case parent.ParentID.Valid:
		return "nested-parent", parent.TicketNumber + " ya es hijo de otro: solo hay un nivel"
	case parent.MergedIntoID.Valid || child.MergedIntoID.Valid:
		return "ticket-merged", "un ticket unido a otro no se relaciona"
	case parent.Status == db.TicketStatusClosed:
		return "ticket-closed", "el padre está cerrado"
	}
	n, err := h.Queries.CountTicketChildren(ctx, pgtype.UUID{Bytes: child.ID, Valid: true})
	if err != nil {
		return "internal-error", "no se pudo revisar el ticket"
	}
	if n > 0 {
		return "nested-parent", child.TicketNumber + " ya tiene hijos: solo hay un nivel"
	}
	return "", ""
}

// SetParent es PUT /api/tickets/{id}/parent {parentNumber}: lo hace hijo de
// otro ticket, o quita el padre si viene vacío.
func (h *TicketsHandler) SetParent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req setParentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	child, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	number := strings.ToUpper(strings.TrimSpace(req.ParentNumber))
	if number == "" {
		if !child.ParentID.Valid {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err := h.Queries.SetTicketParent(ctx, db.SetTicketParentParams{ID: id}); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo quitar el padre")
			return
		}
		_ = ticketNote(ctx, h.Queries, id, user, "Ya no es hijo de otro ticket.", false, "")
		h.AuditLog.Log(ctx, "ticket.parent_removed", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String()})
		h.notifyChanged(ctx, id)
		h.notifyChanged(ctx, uuid.UUID(child.ParentID.Bytes))
		w.WriteHeader(http.StatusNoContent)
		return
	}
	parent, err := h.Queries.GetTicketByNumberForMerge(ctx, number)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 404, "not-found", "no existe el ticket "+number)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo buscar el ticket")
		return
	}
	if slug, msg := h.validParent(ctx, child, parent); slug != "" {
		problemdetails.Write(w, r, 409, slug, msg)
		return
	}
	if err := h.Queries.SetTicketParent(ctx, db.SetTicketParentParams{ID: id, ParentID: pgtype.UUID{Bytes: parent.ID, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar el padre")
		return
	}
	_ = ticketNote(ctx, h.Queries, id, user, "Ahora es hijo de "+parent.TicketNumber+".", false, "")
	_ = ticketNote(ctx, h.Queries, parent.ID, user, child.TicketNumber+" se agregó como hijo.", false, "child:"+child.TicketNumber)
	h.AuditLog.Log(ctx, "ticket.parent_set", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "parentId": parent.ID.String()})
	h.notifyChanged(ctx, id)
	h.notifyChanged(ctx, parent.ID)
	w.WriteHeader(http.StatusNoContent)
}

// ===== Cambiar cliente =====

type changeClientRequest struct {
	ClientID uuid.UUID `json:"clientId"`
	Reason   string    `json:"reason"`
}

// ChangeClient es PUT /api/tickets/{id}/client (admin o capacidad
// tickets:change_client): corrige un ticket registrado con el cliente
// equivocado. Renueva el enlace público y el PIN para que el cliente anterior
// deje de verlo y quita el servicio si era de ese cliente.
func (h *TicketsHandler) ChangeClient(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req changeClientRequest
	if err := decodeJSON(w, r, &req); err != nil || req.ClientID == uuid.Nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "indica el cliente nuevo")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" || len([]rune(reason)) > maxRelationReason {
		problemdetails.Write(w, r, 400, "invalid-payload", "el motivo es obligatorio (hasta 500 caracteres)")
		return
	}
	old, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if old.MergedIntoID.Valid {
		problemdetails.Write(w, r, 409, "ticket-merged", "este ticket se unió a otro")
		return
	}
	if old.ClientID == req.ClientID {
		problemdetails.Write(w, r, 409, "same-client", "ese ya es el cliente del ticket")
		return
	}
	from, err := h.Queries.GetOrganization(ctx, old.ClientID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer el cliente actual")
		return
	}
	to, err := h.Queries.GetOrganization(ctx, req.ClientID)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "el cliente nuevo no existe")
		return
	}
	token, err := randomToken()
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo renovar el enlace público")
		return
	}
	pin, err := newPublicPin()
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo renovar el PIN")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el cliente")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	if _, err := q.SetTicketClient(ctx, db.SetTicketClientParams{ID: id, ClientID: req.ClientID, Token: pgtype.Text{String: token, Valid: true}, Pin: pgtype.Text{String: pin, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el cliente")
		return
	}
	if err := ticketNote(ctx, q, id, user, fmt.Sprintf("Cliente: %s → %s · %s. Enlace público y PIN renovados.", from.Name, to.Name, reason), false, ""); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el cliente")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el cliente")
		return
	}
	h.AuditLog.Log(ctx, "ticket.client_changed", audit.LevelWarn, audit.Success(), map[string]any{
		"ticketId": id.String(), "fromClientId": old.ClientID.String(), "toClientId": req.ClientID.String(), "reason": reason,
	})
	h.notifyChanged(ctx, id)
	d, err := h.loadDetail(r, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo recargar el ticket")
		return
	}
	writeData(w, 200, d)
}
