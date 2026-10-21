package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ticketmail"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/tickets"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Núcleo compartido de la ticketera: crear un ticket y comentar sobre uno.
// Antes la creación estaba copiada 3 veces (POST /api/tickets, crear desde
// la bitácora y convertir una entrada) con diferencias sutiles entre sí, y
// la reapertura de un ticket resuelto solo corría en uno de los caminos.

// newTicket son los datos de negocio de un ticket nuevo; número, token
// público y vencimientos de SLA los calcula createTicketTx.
type newTicket struct {
	Type      string
	Scope     db.EntryScope
	ClientID  uuid.UUID
	TeamID    uuid.UUID
	ServiceID pgtype.UUID
	AssetID   pgtype.UUID
	// TerritorialUnitID: el lugar; con activo se usa la localidad del activo.
	TerritorialUnitID pgtype.UUID
	// AreaID y RequestedAreaID (000039); vacíos = según el usuario y el alcance.
	AreaID          uuid.UUID
	RequestedAreaID uuid.UUID
	AssignedUserID  pgtype.UUID
	Title           string
	Description     string
	Impact          string
	Urgency         string
	ActorID         uuid.UUID
	// AffectsClient: nil = según la regla de Administración → Ticketera.
	AffectsClient *bool
}

const ticketTitleMaxRunes = 120

// ticketTitleFromContent: al crear un ticket desde la bitácora, el título es
// la primera línea con texto de la entrada (acotada), no la entrada completa.
func ticketTitleFromContent(content string) string {
	title := ""
	for _, line := range strings.Split(content, "\n") {
		if trimmed := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#>*- ")); trimmed != "" {
			title = trimmed
			break
		}
	}
	if utf8.RuneCountInString(title) <= ticketTitleMaxRunes {
		return title
	}
	runes := []rune(title)
	return strings.TrimSpace(string(runes[:ticketTitleMaxRunes-1])) + "…"
}

// createTicketTx asigna el número con la numeración del área que pide el
// ticket (o la general; Administración → Ticketera) y crea el ticket dentro
// de la transacción del llamador. La numeración queda bloqueada hasta el fin
// de la transacción: dos altas simultáneas nunca repiten número.
func (h *TicketsHandler) createTicketTx(ctx context.Context, tx pgx.Tx, n newTicket, now time.Time) (db.Ticket, error) {
	token, err := randomToken()
	if err != nil {
		return db.Ticket{}, err
	}
	if n.AreaID == uuid.Nil {
		area, requested, err := h.newTicketAreas(ctx, "", n.Scope)
		if err != nil {
			return db.Ticket{}, err
		}
		n.AreaID, n.RequestedAreaID = area, requested
	}
	if n.RequestedAreaID == uuid.Nil {
		n.RequestedAreaID = n.AreaID
	}
	q := h.Queries.WithTx(tx)
	number, err := nextTicketNumber(ctx, q, n.RequestedAreaID, now)
	if err != nil {
		return db.Ticket{}, err
	}
	// Plazos de SLA y "Afecta al cliente": Administración → Ticketera.
	settings, err := q.GetTicketSettings(ctx)
	if err != nil {
		return db.Ticket{}, err
	}
	priority := ticketPriority(n.Impact, n.Urgency)
	response, resolution := slaWindows(settings, n.Type, string(priority))
	affects := ticketmail.AffectsByDefault(settings.MailAffectsRule, n.Type, string(priority))
	if n.AffectsClient != nil {
		affects = *n.AffectsClient
	}
	return q.CreateTicket(ctx, db.CreateTicketParams{
		TicketNumber: number, TicketType: db.TicketType(n.Type), Scope: n.Scope,
		ClientID: n.ClientID, AssignedTeamID: pgtype.UUID{Bytes: n.TeamID, Valid: n.TeamID != uuid.Nil}, AssignedUserID: n.AssignedUserID,
		ServiceID: n.ServiceID, AssetID: n.AssetID, TerritorialUnitID: n.TerritorialUnitID,
		AreaID: n.AreaID, RequestedAreaID: n.RequestedAreaID,
		Impact: db.ItilImpact(n.Impact), Urgency: db.ItilUrgency(n.Urgency), Priority: priority,
		Title: n.Title, Description: n.Description,
		SlaResponseDueAt:    pgtype.Timestamptz{Time: now.Add(response), Valid: true},
		SlaResolutionDueAt:  pgtype.Timestamptz{Time: now.Add(resolution), Valid: true},
		PublicTrackingToken: pgtype.Text{String: token, Valid: true},
		CreatedBy:           pgtype.UUID{Bytes: n.ActorID, Valid: true},
		AffectsClient:       affects,
	})
}

// afterCreate: avisos de un ticket nuevo (respaldo, cliente si lo afecta y
// el responsable si ya viene asignado). Corre después del commit.
func (h *TicketsHandler) afterCreate(ctx context.Context, t db.Ticket, actorID uuid.UUID) {
	h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.TeamCreated, TicketID: t.ID, ActorID: actorID})
	if t.AssignedUserID.Valid {
		h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.TeamAssigned, TicketID: t.ID, ActorID: actorID, Targets: []uuid.UUID{uuid.UUID(t.AssignedUserID.Bytes)}})
		h.notifyAssigned(ctx, t.ID, uuid.UUID(t.AssignedUserID.Bytes), actorID, false)
	}
	if t.AffectsClient {
		h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.ClientOpened, TicketID: t.ID, ActorID: actorID})
	}
}

// afterComment: un comentario visible al cliente le llega (si el ticket lo
// afecta); si el ticket estaba resuelto, el comentario lo reabrió.
func (h *TicketsHandler) afterComment(ctx context.Context, before db.Ticket, actorID uuid.UUID, content string, isPublic bool) {
	if before.Status == db.TicketStatusResolved {
		h.afterReopen(ctx, before.ID, actorID)
	}
	if isPublic && strings.TrimSpace(content) != "" {
		h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.ClientComment, TicketID: before.ID, ActorID: actorID, Comment: content})
	}
}

// afterReopen: avisos de reabrir; el SLA de resolución se puede volver a avisar.
func (h *TicketsHandler) afterReopen(ctx context.Context, id, actorID uuid.UUID) {
	_ = h.Queries.ResetTicketResolutionSLANotified(ctx, id)
	h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.TeamReopened, TicketID: id, ActorID: actorID})
	h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.ClientReopened, TicketID: id, ActorID: actorID})
}

// afterStatusMail: avisos de un cambio de estado (spec/15 §4.2 y §4.3).
func (h *TicketsHandler) afterStatusMail(ctx context.Context, id uuid.UUID, from, to tickets.Status, actorID uuid.UUID) {
	emit := func(event, comment string) {
		h.Mailer.Emit(ctx, mailEmission{Event: event, TicketID: id, ActorID: actorID, Comment: comment})
	}
	switch {
	case tickets.IsReopen(from, to):
		h.afterReopen(ctx, id, actorID)
	case to == tickets.PendingVendor:
		emit(ticketmail.TeamPendingVendor, "")
		emit(ticketmail.ClientPendingVendor, "")
	case from == tickets.PendingVendor && to == tickets.InProgress:
		emit(ticketmail.ClientResumed, "")
	case to == tickets.Resolved:
		emit(ticketmail.TeamResolved, "")
		emit(ticketmail.ClientResolved, h.lastPublicComment(ctx, id))
	case to == tickets.Closed:
		emit(ticketmail.ClientClosed, "")
	}
}

// lastPublicComment: la solución que se le muestra al cliente al resolver.
func (h *TicketsHandler) lastPublicComment(ctx context.Context, id uuid.UUID) string {
	comments, err := h.Queries.ListTicketComments(ctx, id)
	if err != nil {
		return ""
	}
	for i := len(comments) - 1; i >= 0; i-- {
		if comments[i].IsPublic && comments[i].Origin == "" {
			return comments[i].Content
		}
	}
	return ""
}

// addTicketComment registra un comentario sobre un ticket y, si estaba
// `resolved`, lo reabre a `in_progress` (spec: una novedad sobre un ticket
// resuelto lo reabre en vez de exigir uno nuevo). Recibe las queries del
// llamador para correr dentro de su transacción cuando la hay.
func (h *TicketsHandler) addTicketComment(ctx context.Context, q *db.Queries, ticket db.Ticket, user middleware.AuthenticatedUser, content string, isPublic bool) (db.TicketComment, error) {
	return h.addTicketCommentFrom(ctx, q, ticket, user, content, isPublic, "")
}

// addTicketCommentFrom es addTicketComment con el origen del comentario
// ('parent:TKT-…', 'child:TKT-…'; ” si es propio).
func (h *TicketsHandler) addTicketCommentFrom(ctx context.Context, q *db.Queries, ticket db.Ticket, user middleware.AuthenticatedUser, content string, isPublic bool, origin string) (db.TicketComment, error) {
	if ticket.Status == db.TicketStatusResolved {
		_, err := q.UpdateTicket(ctx, db.UpdateTicketParams{
			ID: ticket.ID, Status: db.NullTicketStatus{TicketStatus: db.TicketStatusInProgress, Valid: true},
			SlaOnHoldSince: ticket.SlaOnHoldSince, SlaPausedSeconds: pgtype.Int4{Int32: ticket.SlaPausedSeconds, Valid: true},
			ReopenedCount: pgtype.Int4{Int32: ticket.ReopenedCount + 1, Valid: true}, ReopenedAt: pgtype.Timestamptz{Time: h.now(), Valid: true},
		})
		if err != nil {
			return db.TicketComment{}, err
		}
	}
	comment, err := q.CreateTicketComment(ctx, db.CreateTicketCommentParams{TicketID: ticket.ID, UserID: pgtype.UUID{Bytes: user.ID, Valid: true}, AuthorName: user.Username, Content: content, IsPublic: isPublic, Origin: origin})
	if err != nil {
		return db.TicketComment{}, err
	}
	return comment, h.markResponded(ctx, q, ticket.ID)
}

// AddEntryCommentToTicket: un comentario en una entrada vinculada también
// llega al ticket (y lo reabre si estaba resuelto).
func (h *TicketsHandler) AddEntryCommentToTicket(ctx context.Context, ticketID uuid.UUID, user middleware.AuthenticatedUser, content string, isPublic bool) error {
	ticket, err := h.Queries.GetTicket(ctx, ticketID)
	if err != nil {
		return err
	}
	if isGlpiTicket(ticket) {
		return nil // GLPI manda en sus tickets: el comentario queda en la entrada
	}
	if _, err = h.addTicketComment(ctx, h.Queries, ticket, user, content, isPublic); err != nil {
		return err
	}
	h.afterComment(ctx, ticket, user.ID, content, isPublic)
	return nil
}

// Enabled dice si la ticketera nativa está activa. Lo usa también la
// bitácora: crear o vincular un ticket desde una entrada es usar la
// ticketera, aunque la ruta sea /api/entries.
func (h *TicketsHandler) Enabled(ctx context.Context) (bool, error) {
	feature, err := h.Queries.GetSystemFeature(ctx, ticketsFeature)
	if err != nil {
		return false, err
	}
	return feature.IsEnabled, nil
}

func (h *TicketsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createTicketRequest
	if err := decodeJSON(w, r, &req); err != nil || !validTicketType(req.TicketType) || req.ClientID == uuid.Nil || !validImpact(req.Impact) || !validUrgency(req.Urgency) || strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Description) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "ticketType, scope, clientId, impacto, urgencia, título y descripción son obligatorios (el equipo resolutor se puede dejar para después)")
		return
	}
	scope := db.EntryScope(req.Scope)
	if scope != db.EntryScopeSoc && scope != db.EntryScopeNoc {
		scope = db.EntryScopeGeneral
	}
	ctx := r.Context()
	actor, _ := middleware.UserFromContext(ctx)
	area, requested, err := h.newTicketAreas(ctx, strings.TrimSpace(req.Area), "")
	if errors.Is(err, errNoTicketArea) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-area", "elige un área activa que reciba tickets")
		return
	} else if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las áreas")
		return
	}
	var parent *db.Ticket
	if req.ParentID != nil {
		p, err := h.Queries.GetTicket(ctx, *req.ParentID)
		if err != nil {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el ticket padre no existe")
			return
		}
		// Un ticket nuevo no tiene hijos: basta revisar el padre.
		if slug, msg := h.validParent(ctx, db.Ticket{}, p); slug != "" {
			problemdetails.Write(w, r, http.StatusConflict, slug, msg)
			return
		}
		parent = &p
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo iniciar la creación")
		return
	}
	defer tx.Rollback(ctx)
	ticket, err := h.createTicketTx(ctx, tx, newTicket{
		Type: req.TicketType, Scope: scope, ClientID: req.ClientID, TeamID: req.TeamID,
		ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID), TerritorialUnitID: optionalUUID(req.TerritorialUnitID), AssignedUserID: optionalUUID(req.AssignedUserID),
		Title: strings.TrimSpace(req.Title), Description: strings.TrimSpace(req.Description),
		Impact: req.Impact, Urgency: req.Urgency, ActorID: actor.ID, AffectsClient: req.AffectsClient,
		AreaID: area, RequestedAreaID: requested,
	}, h.now())
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se pudo crear el ticket; verifica cliente, equipo y relaciones")
		return
	}
	if parent != nil {
		q := h.Queries.WithTx(tx)
		ticket.ParentID = pgtype.UUID{Bytes: parent.ID, Valid: true}
		if err = q.SetTicketParent(ctx, db.SetTicketParentParams{ID: ticket.ID, ParentID: ticket.ParentID}); err == nil {
			err = ticketNote(ctx, q, parent.ID, actor, ticket.TicketNumber+" se creó como hijo.", false, "child:"+ticket.TicketNumber)
		}
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el hijo")
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el ticket")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "ticket.created", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": ticket.ID.String()})
	}
	h.afterCreate(ctx, ticket, actor.ID)
	h.notifyChanged(ctx, ticket.ID)
	if parent != nil {
		h.notifyChanged(ctx, parent.ID)
	}
	writeData(w, http.StatusCreated, toTicketDTO(ticket, true))
}

// nextTicketNumber toma el próximo número de la numeración del área (o la
// general) y la deja avanzada. Si ese número ya existe (dos numeraciones con
// el mismo prefijo, o un respaldo restaurado) sigue con el siguiente.
func nextTicketNumber(ctx context.Context, q *db.Queries, areaID uuid.UUID, now time.Time) (string, error) {
	series, err := q.LockTicketSeriesForArea(ctx, pgtype.UUID{Bytes: areaID, Valid: areaID != uuid.Nil})
	if err != nil {
		return "", fmt.Errorf("numeración de tickets: %w", err)
	}
	n := series.NextNumber
	for {
		number := tickets.FormatNumber(series.Prefix, series.YearFormat, int(series.Digits), n, now)
		taken, err := q.TicketNumberTaken(ctx, number)
		if err != nil {
			return "", err
		}
		n++
		if !taken {
			return number, q.SetTicketSeriesNext(ctx, db.SetTicketSeriesNextParams{ID: series.ID, NextNumber: n})
		}
	}
}
