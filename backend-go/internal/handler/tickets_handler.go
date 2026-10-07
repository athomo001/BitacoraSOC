package handler

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/tickets"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultTicketsPageSize = 50
	maxTicketsPageSize     = 200
)

type TicketsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	Now      func() time.Time
	// PinLimiter acota los intentos de PIN por token en la vista pública;
	// nil = sin límite (solo tests).
	PinLimiter *ratelimit.APILimiter
	// Hub avisa por SSE que la cola cambió (otro analista la ve al instante).
	Hub eventPublisher
}

func (h *TicketsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// RequireEnabled is the authorization boundary for the optional ticket module.
func (h *TicketsHandler) RequireEnabled(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	enabled, err := h.Enabled(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el estado de ticketing")
		return
	}
	if !enabled {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la ticketera nativa está desactivada")
		return
	}
	next.ServeHTTP(w, r)
}

type ticketDTO struct {
	ID                  uuid.UUID  `json:"id"`
	TicketNumber        string     `json:"ticketNumber"`
	TicketType          string     `json:"ticketType"`
	Scope               string     `json:"scope"`
	ClientID            uuid.UUID  `json:"clientId"`
	AssetID             *uuid.UUID `json:"assetId,omitempty"`
	ServiceID           *uuid.UUID `json:"serviceId,omitempty"`
	AssignedTeamID      *uuid.UUID `json:"assignedTeamId,omitempty"`
	AssignedUserID      *uuid.UUID `json:"assignedUserId,omitempty"`
	Status              string     `json:"status"`
	Impact              string     `json:"impact"`
	Urgency             string     `json:"urgency"`
	Priority            string     `json:"priority"`
	Title               string     `json:"title"`
	Description         string     `json:"description"`
	SLAResponseDueAt    *time.Time `json:"slaResponseDueAt,omitempty"`
	SLAResolutionDueAt  *time.Time `json:"slaResolutionDueAt,omitempty"`
	SLAPausedSeconds    int32      `json:"slaPausedSeconds"`
	ReopenedCount       int32      `json:"reopenedCount"`
	PublicTrackingToken *string    `json:"publicTrackingToken,omitempty"`
	ParentID            *uuid.UUID `json:"parentId,omitempty"`
	MergedIntoID        *uuid.UUID `json:"mergedIntoId,omitempty"`
	CreatedByID         *uuid.UUID `json:"createdById,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

func toTicketDTO(t db.Ticket, exposeToken bool) ticketDTO {
	d := ticketDTO{ID: t.ID, TicketNumber: t.TicketNumber, TicketType: string(t.TicketType), Scope: string(t.Scope), ClientID: t.ClientID, AssetID: uuidPtr(t.AssetID), ServiceID: uuidPtr(t.ServiceID), AssignedTeamID: uuidPtr(t.AssignedTeamID), AssignedUserID: uuidPtr(t.AssignedUserID), Status: string(t.Status), Impact: string(t.Impact), Urgency: string(t.Urgency), Priority: string(t.Priority), Title: t.Title, Description: t.Description, SLAPausedSeconds: t.SlaPausedSeconds, ReopenedCount: t.ReopenedCount}
	if t.SlaResponseDueAt.Valid {
		v := t.SlaResponseDueAt.Time
		d.SLAResponseDueAt = &v
	}
	if t.SlaResolutionDueAt.Valid {
		v := t.SlaResolutionDueAt.Time
		d.SLAResolutionDueAt = &v
	}
	d.ParentID, d.MergedIntoID, d.CreatedByID = uuidPtr(t.ParentID), uuidPtr(t.MergedIntoID), uuidPtr(t.CreatedBy)
	if exposeToken && t.PublicTrackingToken.Valid {
		v := t.PublicTrackingToken.String
		d.PublicTrackingToken = &v
	}
	if t.CreatedAt.Valid {
		d.CreatedAt = t.CreatedAt.Time
	}
	if t.UpdatedAt.Valid {
		d.UpdatedAt = t.UpdatedAt.Time
	}
	return d
}

type createTicketRequest struct {
	TicketType     string     `json:"ticketType"`
	Scope          string     `json:"scope"`
	ClientID       uuid.UUID  `json:"clientId"`
	AssetID        *uuid.UUID `json:"assetId"`
	ServiceID      *uuid.UUID `json:"serviceId"`
	TeamID         uuid.UUID  `json:"teamId"`
	AssignedUserID *uuid.UUID `json:"assignedUserId"`
	Impact         string     `json:"impact"`
	Urgency        string     `json:"urgency"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	// ParentID: crear el ticket ya como hijo de otro ("Crear hijo").
	ParentID *uuid.UUID `json:"parentId"`
}

// ticketPriority aplica la matriz ITIL compartida (internal/tickets).
func ticketPriority(impact, urgency string) db.ItilPriority {
	return db.ItilPriority(tickets.Priority(impact, urgency))
}

func validTicketType(v string) bool { return v == "incident" || v == "service_request" }
func validImpact(v string) bool     { return v == "low" || v == "medium" || v == "high" }
func validUrgency(v string) bool {
	return v == "low" || v == "medium" || v == "high" || v == "critical"
}
func validStatus(v string) bool {
	switch v {
	case "new", "assigned", "in_progress", "pending_vendor", "resolved", "closed", "cancelled":
		return true
	}
	return false
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type commentRequest struct {
	Content  string `json:"content"`
	IsPublic bool   `json:"isPublic"`
	// ImageIDs: imágenes ya subidas a este ticket (POST /api/tickets/{id}/images).
	ImageIDs []uuid.UUID `json:"imageIds"`
	// AlsoChildren: en un padre, copiar el comentario a los hijos abiertos.
	AlsoChildren bool `json:"alsoChildren"`
}

// maxImagesPerComment: tope del diseño aprobado (comentario del dueño #14).
const maxImagesPerComment = 10

func (h *TicketsHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req commentRequest
	if err = decodeJSON(w, r, &req); err != nil || (strings.TrimSpace(req.Content) == "" && len(req.ImageIDs) == 0) {
		problemdetails.Write(w, r, 400, "invalid-payload", "escribe algo o adjunta al menos una imagen")
		return
	}
	if len(req.ImageIDs) > maxImagesPerComment {
		problemdetails.Write(w, r, 400, "invalid-payload", fmt.Sprintf("hasta %d imágenes por comentario", maxImagesPerComment))
		return
	}
	ctx := r.Context()
	u, _ := middleware.UserFromContext(ctx)
	ticket, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if ticket.MergedIntoID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "ticket-merged", "este ticket se unió a otro: comenta en el principal")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	comment, err := h.addTicketComment(ctx, q, ticket, u, strings.TrimSpace(req.Content), req.IsPublic)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	if len(req.ImageIDs) > 0 {
		claimed, err := q.ClaimTicketImages(ctx, db.ClaimTicketImagesParams{CommentID: pgtype.UUID{Bytes: comment.ID, Valid: true}, TicketID: id, UserID: pgtype.UUID{Bytes: u.ID, Valid: true}, Ids: req.ImageIDs})
		if err != nil || claimed != int64(len(req.ImageIDs)) {
			problemdetails.Write(w, r, 400, "invalid-payload", "alguna imagen no es de este ticket, ya se usó o la subió otra persona")
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	copied := h.cascadeComment(ctx, ticket, u, strings.TrimSpace(req.Content), req.IsPublic, req.AlsoChildren)
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "ticket.comment_added", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "images": len(req.ImageIDs), "copiedToChildren": copied})
	}
	h.notifyChanged(ctx, id)
	dto := toTicketCommentDTO(comment)
	if images, err := h.Queries.ListTicketImages(ctx, id); err == nil {
		dto.Images = imagesOfComment(images, comment.ID)
	}
	writeData(w, 201, dto)
}

type linkTicketRequest struct {
	TicketNumber string `json:"ticketNumber"`
}

func (h *TicketsHandler) LinkEntry(w http.ResponseWriter, r *http.Request) {
	entryID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	var req linkTicketRequest
	if err = decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.TicketNumber) == "" {
		problemdetails.Write(w, r, 400, "invalid-payload", "ticketNumber es obligatorio")
		return
	}
	ticket, err := h.Queries.GetTicketByNumber(r.Context(), strings.TrimSpace(req.TicketNumber))
	if err == pgx.ErrNoRows {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo buscar el ticket")
		return
	}
	entry, err := h.Queries.LinkEntryToTicket(r.Context(), db.LinkEntryToTicketParams{ID: entryID, TicketID: pgtype.UUID{Bytes: ticket.ID, Valid: true}})
	if err == pgx.ErrNoRows {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo vincular la entrada")
		return
	}
	u, _ := middleware.UserFromContext(r.Context())
	_, _ = h.Queries.CreateTicketComment(r.Context(), db.CreateTicketCommentParams{TicketID: ticket.ID, UserID: pgtype.UUID{Bytes: u.ID, Valid: true}, AuthorName: u.Username, Content: "Entrada de bitácora vinculada: " + entryID.String(), IsPublic: false})
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "entry.ticket_linked", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entryID.String(), "ticketId": ticket.ID.String()})
	}
	writeData(w, 200, map[string]any{"ticket": toTicketDTO(ticket, true), "entry": entry})
}

type convertEntryRequest struct {
	TicketType string    `json:"ticketType"`
	TeamID     uuid.UUID `json:"teamId"`
	Impact     string    `json:"impact"`
	Urgency    string    `json:"urgency"`
}

func (h *TicketsHandler) ConvertEntry(w http.ResponseWriter, r *http.Request) {
	entryID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	var req convertEntryRequest
	if err = decodeJSON(w, r, &req); err != nil || !validTicketType(req.TicketType) || !validImpact(req.Impact) || !validUrgency(req.Urgency) {
		problemdetails.Write(w, r, 400, "invalid-payload", "ticketType, impact y urgency son obligatorios")
		return
	}
	entry, err := h.Queries.GetEntry(r.Context(), entryID)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	if entry.TicketID.Valid {
		problemdetails.Write(w, r, 409, "already-linked", "la entrada ya tiene un ticket vinculado")
		return
	}
	if !entry.ServiceID.Valid {
		problemdetails.Write(w, r, 400, "invalid-payload", "la entrada necesita un servicio para identificar el cliente")
		return
	}
	clientID, err := h.Queries.GetServiceOrganizationID(r.Context(), uuid.UUID(entry.ServiceID.Bytes))
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "el servicio no tiene una organización cliente")
		return
	}
	actor, _ := middleware.UserFromContext(r.Context())
	tx, err := h.Pool.Begin(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo iniciar la conversión")
		return
	}
	defer tx.Rollback(r.Context())
	ticket, err := h.createTicketTx(r.Context(), tx, newTicket{Type: req.TicketType, Scope: entry.Scope, ClientID: clientID, TeamID: req.TeamID, ServiceID: entry.ServiceID, AssetID: entry.AssetID, Title: ticketTitleFromContent(entry.Content), Description: entry.Content, Impact: req.Impact, Urgency: req.Urgency, ActorID: actor.ID}, h.now())
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo crear el ticket")
		return
	}
	updated, err := h.Queries.WithTx(tx).LinkEntryToTicket(r.Context(), db.LinkEntryToTicketParams{ID: entryID, TicketID: pgtype.UUID{Bytes: ticket.ID, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo vincular la entrada")
		return
	}
	if _, err = h.Queries.WithTx(tx).CreateTicketComment(r.Context(), db.CreateTicketCommentParams{TicketID: ticket.ID, UserID: pgtype.UUID{Bytes: actor.ID, Valid: true}, AuthorName: actor.Username, Content: entry.Content, IsPublic: false}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo sincronizar la entrada")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar la conversión")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "entry.converted_to_ticket", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entryID.String(), "ticketId": ticket.ID.String()})
	}
	writeData(w, 201, map[string]any{"ticket": toTicketDTO(ticket, true), "entry": toEntryDTO(updated, entry.AuthorUsername)})
}

type resolveEntryRequest struct {
	CloseLinkedTicket bool   `json:"closeLinkedTicket"`
	ResolutionNotes   string `json:"resolutionNotes"`
}

func (h *TicketsHandler) ResolveEntry(w http.ResponseWriter, r *http.Request) {
	entryID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	var req resolveEntryRequest
	if err = decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	entry, err := h.Queries.GetEntry(r.Context(), entryID)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	actor, _ := middleware.UserFromContext(r.Context())
	var ticketDTOValue any
	if entry.TicketID.Valid {
		ticket, ticketErr := h.Queries.GetTicket(r.Context(), uuid.UUID(entry.TicketID.Bytes))
		if ticketErr != nil {
			problemdetails.Write(w, r, 404, "not-found", "ticket vinculado no encontrado")
			return
		}
		if strings.TrimSpace(req.ResolutionNotes) != "" {
			_, _ = h.Queries.CreateTicketComment(r.Context(), db.CreateTicketCommentParams{TicketID: ticket.ID, UserID: pgtype.UUID{Bytes: actor.ID, Valid: true}, AuthorName: actor.Username, Content: strings.TrimSpace(req.ResolutionNotes), IsPublic: false})
		}
		if req.CloseLinkedTicket {
			// Mismas reglas que la ticketera: solo se resuelve lo que está en curso.
			if !tickets.CanTransition(tickets.Status(ticket.Status), tickets.Resolved) {
				problemdetails.Write(w, r, http.StatusConflict, "invalid-transition", "el ticket vinculado está en "+string(ticket.Status)+" y no se puede resolver desde acá")
				return
			}
			now := h.now()
			updated, updateErr := h.Queries.UpdateTicket(r.Context(), db.UpdateTicketParams{ID: ticket.ID, Status: db.NullTicketStatus{TicketStatus: db.TicketStatusResolved, Valid: true}, SlaOnHoldSince: ticket.SlaOnHoldSince, SlaPausedSeconds: pgtype.Int4{Int32: ticket.SlaPausedSeconds, Valid: true}, ReopenedCount: pgtype.Int4{Int32: ticket.ReopenedCount, Valid: true}, ReopenedAt: ticket.ReopenedAt, ClosedAt: ticket.ClosedAt, FirstRespondedAt: pgtype.Timestamptz{Time: now, Valid: true}, ResolvedAt: pgtype.Timestamptz{Time: now, Valid: true}})
			if updateErr != nil {
				problemdetails.Write(w, r, 500, "internal-error", "no se pudo resolver el ticket")
				return
			}
			ticket = updated
		}
		ticketDTOValue = toTicketDTO(ticket, true)
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "entry.resolved", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entryID.String(), "closeLinkedTicket": req.CloseLinkedTicket})
	}
	writeData(w, 200, map[string]any{"entry": toEntryDTO(entryFromRow(entry), entry.AuthorUsername), "ticket": ticketDTOValue})
}

type taskRequest struct {
	Content          string     `json:"content"`
	TimeSpentSeconds int32      `json:"timeSpentSeconds"`
	IsPublic         bool       `json:"isPublic"`
	PerformedAt      *time.Time `json:"performedAt"`
}

func (h *TicketsHandler) ListTasks(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	rows, err := h.Queries.ListTicketTasksWithUser(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron listar las tareas")
		return
	}
	items := make([]ticketTaskDTO, 0, len(rows))
	for _, t := range rows {
		items = append(items, ticketTaskDTO{ID: t.ID, Username: t.Username, Content: t.Content, TimeSpentSeconds: t.TimeSpentSeconds, IsPublic: t.IsPublic, PerformedAt: t.PerformedAt.Time})
	}
	total, _ := h.Queries.SumTicketTaskTime(r.Context(), id)
	writeData(w, 200, map[string]any{"items": items, "totalTimeSpentSeconds": total})
}
func (h *TicketsHandler) AddTask(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req taskRequest
	if err = decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Content) == "" || req.TimeSpentSeconds <= 0 {
		problemdetails.Write(w, r, 400, "invalid-payload", "content y timeSpentSeconds positivo son obligatorios")
		return
	}
	u, _ := middleware.UserFromContext(r.Context())
	var performed interface{}
	if req.PerformedAt != nil {
		performed = *req.PerformedAt
	}
	task, err := h.Queries.CreateTicketTask(r.Context(), db.CreateTicketTaskParams{TicketID: id, UserID: u.ID, Content: strings.TrimSpace(req.Content), TimeSpentSeconds: req.TimeSpentSeconds, IsPublic: req.IsPublic, PerformedAt: performed})
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo registrar la tarea")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "ticket.task_added", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "taskId": task.ID.String()})
	}
	_ = h.markResponded(r.Context(), h.Queries, id)
	h.notifyChanged(r.Context(), id)
	writeData(w, 201, toTicketTaskDTO(task, u.Username))
}
func (h *TicketsHandler) PatchTask(w http.ResponseWriter, r *http.Request) {
	ticketID, err := uuid.Parse(r.PathValue("id"))
	taskID, err2 := uuid.Parse(r.PathValue("taskId"))
	if err != nil || err2 != nil {
		problemdetails.Write(w, r, 404, "not-found", "tarea no encontrada")
		return
	}
	var req taskRequest
	if err = decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	task, err := h.Queries.GetTicketTask(r.Context(), taskID)
	if err != nil || task.TicketID != ticketID {
		problemdetails.Write(w, r, 404, "not-found", "tarea no encontrada")
		return
	}
	u, _ := middleware.UserFromContext(r.Context())
	if task.UserID != u.ID && u.Role != "admin" {
		problemdetails.Write(w, r, 403, "forbidden", "solo puedes editar tus propias tareas")
		return
	}
	updated, err := h.Queries.UpdateTicketTask(r.Context(), db.UpdateTicketTaskParams{ID: taskID, TicketID: ticketID, Content: pgtype.Text{String: strings.TrimSpace(req.Content), Valid: req.Content != ""}, TimeSpentSeconds: pgtype.Int4{Int32: req.TimeSpentSeconds, Valid: req.TimeSpentSeconds > 0}})
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo actualizar la tarea")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "ticket.task_updated", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": ticketID.String(), "taskId": taskID.String()})
	}
	username := ""
	if task.UserID == u.ID {
		username = u.Username
	}
	writeData(w, 200, toTicketTaskDTO(updated, username))
}
