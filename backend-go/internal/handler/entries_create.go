package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// POST /api/entries — alta de una entrada de bitácora, opcionalmente
// creando un ticket nuevo (`createTicket`) o vinculándose a uno existente
// (`ticketNumber`), todo en una sola transacción (Fase 10).

var errBadImage = errors.New("imageUrl no corresponde a una imagen subida")

// resolveImage valida la imagen pegada/subida antes de crear la entrada y
// devuelve las columnas de imagen + el adjunto a reclamar. Compartido por
// los dos caminos de alta: antes el camino con ticket la perdía.
func (h *EntriesHandler) resolveImage(ctx context.Context, imageURL *string, params *db.CreateEntryParams) (*uuid.UUID, error) {
	if imageURL == nil || strings.TrimSpace(*imageURL) == "" {
		return nil, nil
	}
	id, ok := attachmentIDFromURL(*imageURL)
	if !ok {
		return nil, errBadImage
	}
	attachment, err := h.Queries.GetAttachment(ctx, id)
	if err != nil {
		return nil, errBadImage
	}
	params.ImageUrl = pgtype.Text{String: *imageURL, Valid: true}
	params.ImageHash = pgtype.Text{String: attachment.HashSha256, Valid: true}
	params.ImageSizeBytes = pgtype.Int4{Int32: attachment.SizeBytes, Valid: true}
	return &id, nil
}

func (h *EntriesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createEntryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	req.TicketNumber = strings.TrimSpace(req.TicketNumber)
	if req.Content == "" || !validEntryType(req.EntryType) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "content y entryType (operativa|incidente|ofensa) son obligatorios")
		return
	}
	scope := db.EntryScopeGeneral
	if req.Scope != "" {
		scope = db.EntryScope(req.Scope)
	}
	if req.Tags == nil {
		req.Tags = []string{}
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	params := db.CreateEntryParams{
		UserID: user.ID, EntryType: db.EntryType(req.EntryType), Scope: scope, Content: req.Content, Tags: req.Tags,
		ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID),
	}
	attachmentID, err := h.resolveImage(ctx, req.ImageURL, &params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	if req.CreateTicket || req.TicketNumber != "" {
		h.createWithTicket(w, r, req, params, attachmentID, user)
		return
	}

	entry, err := h.Queries.CreateEntry(ctx, params)
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el servicio o activo indicado no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la entrada")
		return
	}
	if attachmentID != nil {
		// Mejor esfuerzo: si dos entradas reclaman el mismo adjunto a la vez,
		// solo la primera lo asocia (ClaimAttachment ignora si ya tiene
		// entry_id) — la entrada igual queda con la imagen correcta en sus
		// propias columnas, no depende de haber ganado la carrera.
		_, _ = h.Queries.ClaimAttachment(ctx, db.ClaimAttachmentParams{ID: *attachmentID, EntryID: pgtype.UUID{Bytes: entry.ID, Valid: true}})
	}

	h.AuditLog.Log(ctx, "entry.created", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entry.ID.String(), "entryType": string(entry.EntryType)})
	writeData(w, http.StatusCreated, toEntryDTO(entry, user.Username))
}

// ticketNotLinkable: un ticket cerrado o cancelado no recibe entradas nuevas
// (reabrir uno cerrado es una decisión explícita en la ticketera, no un
// efecto lateral de escribir en la bitácora).
func ticketNotLinkable(status db.TicketStatus) bool {
	return status == db.TicketStatusClosed || status == db.TicketStatusCancelled
}

func (h *EntriesHandler) createWithTicket(w http.ResponseWriter, r *http.Request, req createEntryRequest, params db.CreateEntryParams, attachmentID *uuid.UUID, user middleware.AuthenticatedUser) {
	ctx := r.Context()
	if h.Pool == nil || h.Tickets == nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "ticketing transaccional no está disponible")
		return
	}
	// La ruta es /api/entries (sin el gate de la ticketera), pero esto ES usar
	// la ticketera: con el módulo apagado no se crean ni vinculan tickets.
	enabled, err := h.Tickets.Enabled(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el estado de ticketing")
		return
	}
	if !enabled {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la ticketera nativa está desactivada")
		return
	}
	impact, urgency := req.Impact, req.Urgency
	if impact == "" {
		impact = "medium"
	}
	if urgency == "" {
		urgency = "medium"
	}
	if !validImpact(impact) || !validUrgency(urgency) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "impacto o urgencia inválidos")
		return
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo iniciar la operación transaccional")
		return
	}
	defer tx.Rollback(ctx)
	queries := h.Queries.WithTx(tx)

	var ticket db.Ticket
	if req.TicketNumber != "" {
		ticket, err = queries.GetTicketByNumber(ctx, req.TicketNumber)
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ticket "+req.TicketNumber+" no encontrado")
			return
		}
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo buscar el ticket")
			return
		}
		if ticketNotLinkable(ticket.Status) {
			problemdetails.Write(w, r, http.StatusConflict, "ticket-closed", "el ticket "+req.TicketNumber+" está cerrado; reábrelo desde la ticketera")
			return
		}
	} else {
		if !validTicketType(req.TicketType) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "createTicket requiere ticketType")
			return
		}
		// El equipo resolutor es opcional: se completa al tomar el ticket.
		teamID := uuid.Nil
		if req.AssignedTeamID != nil {
			teamID = *req.AssignedTeamID
		}
		clientID := uuid.Nil
		if req.ClientID != nil {
			clientID = *req.ClientID
		} else if req.ServiceID != nil {
			if clientID, err = queries.GetServiceOrganizationID(ctx, *req.ServiceID); err != nil {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el servicio no tiene una organización cliente")
				return
			}
		}
		if clientID == uuid.Nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "createTicket requiere clientId o serviceId")
			return
		}
		ticket, err = h.Tickets.createTicketTx(ctx, tx, newTicket{
			Type: req.TicketType, Scope: params.Scope, ClientID: clientID, TeamID: teamID,
			ServiceID: params.ServiceID, AssetID: params.AssetID,
			Title: ticketTitleFromContent(req.Content), Description: req.Content,
			Impact: impact, Urgency: urgency, ActorID: user.ID,
		}, h.now())
		if err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se pudo crear el ticket desde la entrada")
			return
		}
	}

	entry, err := queries.CreateEntry(ctx, params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se pudo crear la entrada vinculada")
		return
	}
	entry, err = queries.UpdateEntryTicket(ctx, db.UpdateEntryTicketParams{ID: entry.ID, TicketID: pgtype.UUID{Bytes: ticket.ID, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo vincular la entrada al ticket")
		return
	}
	// Mismo camino que un comentario normal: si el ticket estaba resuelto, se reabre.
	if _, err = h.Tickets.addTicketComment(ctx, queries, ticket, user, req.Content, false); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo sincronizar el comentario")
		return
	}
	if attachmentID != nil {
		_, _ = queries.ClaimAttachment(ctx, db.ClaimAttachmentParams{ID: *attachmentID, EntryID: pgtype.UUID{Bytes: entry.ID, Valid: true}})
	}
	if err = tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo confirmar la entrada y el ticket")
		return
	}
	h.Tickets.notifyChanged(ctx, ticket.ID)
	if refreshed, getErr := h.Tickets.Queries.GetTicket(ctx, ticket.ID); getErr == nil {
		ticket = refreshed // refleja una posible reapertura
	}
	h.AuditLog.Log(ctx, "entry.created_with_ticket", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entry.ID.String(), "ticketId": ticket.ID.String(), "linkedExisting": req.TicketNumber != ""})
	writeData(w, http.StatusCreated, map[string]any{"entry": toEntryDTO(entry, user.Username), "ticket": toTicketDTO(ticket, true)})
}
