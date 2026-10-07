package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
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
	Type           string
	Scope          db.EntryScope
	ClientID       uuid.UUID
	TeamID         uuid.UUID
	ServiceID      pgtype.UUID
	AssetID        pgtype.UUID
	AssignedUserID pgtype.UUID
	Title          string
	Description    string
	Impact         string
	Urgency        string
	ActorID        uuid.UUID
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

func resolutionWindow(ticketType string) time.Duration {
	if ticketType == "service_request" {
		return 72 * time.Hour
	}
	return 8 * time.Hour
}

// createTicketTx asigna el correlativo TKT-YYYY-NNNNN bajo un advisory lock
// por año (dos altas simultáneas nunca repiten número) y crea el ticket
// dentro de la transacción del llamador.
func (h *TicketsHandler) createTicketTx(ctx context.Context, tx pgx.Tx, n newTicket, now time.Time) (db.Ticket, error) {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", strconv.Itoa(now.Year())); err != nil {
		return db.Ticket{}, err
	}
	var sequence int
	if err := tx.QueryRow(ctx, "SELECT COALESCE(MAX(CAST(right(ticket_number, 5) AS integer)), 0) + 1 FROM tickets WHERE ticket_number LIKE $1", fmt.Sprintf("TKT-%04d-%%", now.Year())).Scan(&sequence); err != nil {
		return db.Ticket{}, err
	}
	token, err := randomToken()
	if err != nil {
		return db.Ticket{}, err
	}
	return h.Queries.WithTx(tx).CreateTicket(ctx, db.CreateTicketParams{
		TicketNumber: fmt.Sprintf("TKT-%04d-%05d", now.Year(), sequence), TicketType: db.TicketType(n.Type), Scope: n.Scope,
		ClientID: n.ClientID, AssignedTeamID: pgtype.UUID{Bytes: n.TeamID, Valid: n.TeamID != uuid.Nil}, AssignedUserID: n.AssignedUserID,
		ServiceID: n.ServiceID, AssetID: n.AssetID,
		Impact: db.ItilImpact(n.Impact), Urgency: db.ItilUrgency(n.Urgency), Priority: ticketPriority(n.Impact, n.Urgency),
		Title: n.Title, Description: n.Description,
		SlaResponseDueAt:    pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
		SlaResolutionDueAt:  pgtype.Timestamptz{Time: now.Add(resolutionWindow(n.Type)), Valid: true},
		PublicTrackingToken: pgtype.Text{String: token, Valid: true},
		CreatedBy:           pgtype.UUID{Bytes: n.ActorID, Valid: true},
	})
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
	_, err = h.addTicketComment(ctx, h.Queries, ticket, user, content, isPublic)
	return err
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
		ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID), AssignedUserID: optionalUUID(req.AssignedUserID),
		Title: strings.TrimSpace(req.Title), Description: strings.TrimSpace(req.Description),
		Impact: req.Impact, Urgency: req.Urgency, ActorID: actor.ID,
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
	h.notifyChanged(ctx, ticket.ID)
	if parent != nil {
		h.notifyChanged(ctx, parent.ID)
	}
	writeData(w, http.StatusCreated, toTicketDTO(ticket, true))
}
