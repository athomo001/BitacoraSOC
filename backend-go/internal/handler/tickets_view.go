package handler

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
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

// Vista de la ticketera para la pantalla aprobada (canvas "BitacoraSOC UI
// Base", artboard Ticketera): la cola con nombres (nunca UUID), el estado de
// los dos relojes de SLA y las transiciones válidas ya calculadas, para que
// la pantalla no repita reglas de negocio. Todo en camelCase: antes el
// detalle devolvía structs de sqlc y la UI no veía el autor de los comentarios.

type slaDTO struct {
	Response   *tickets.Clock `json:"response,omitempty"`
	Resolution *tickets.Clock `json:"resolution,omitempty"`
}

type ticketViewDTO struct {
	ticketDTO
	ClientName         string     `json:"clientName"`
	TeamName           *string    `json:"teamName"`
	AssigneeUsername   *string    `json:"assigneeUsername"`
	OnHoldSince        *time.Time `json:"onHoldSince"`
	FirstRespondedAt   *time.Time `json:"firstRespondedAt"`
	ResolvedAt         *time.Time `json:"resolvedAt"`
	SLA                slaDTO     `json:"sla"`
	AllowedTransitions []string   `json:"allowedTransitions"`
}

func slaInput(t db.Ticket) tickets.SLAInput {
	return tickets.SLAInput{
		Status: tickets.Status(t.Status), CreatedAt: t.CreatedAt.Time,
		ResponseDueAt: t.SlaResponseDueAt.Time, ResolutionDueAt: t.SlaResolutionDueAt.Time,
		PausedSeconds: int64(t.SlaPausedSeconds), OnHoldSince: timestamptzPtr(t.SlaOnHoldSince),
		FirstRespondedAt: timestamptzPtr(t.FirstRespondedAt), ResolvedAt: timestamptzPtr(t.ResolvedAt),
	}
}

func toTicketView(t db.Ticket, clientName string, teamName, assignee pgtype.Text, now time.Time) ticketViewDTO {
	v := ticketViewDTO{
		ticketDTO: toTicketDTO(t, false), ClientName: clientName, TeamName: textPtr(teamName), AssigneeUsername: textPtr(assignee),
		OnHoldSince: timestamptzPtr(t.SlaOnHoldSince), FirstRespondedAt: timestamptzPtr(t.FirstRespondedAt), ResolvedAt: timestamptzPtr(t.ResolvedAt),
		AllowedTransitions: []string{},
	}
	in := slaInput(t)
	if t.SlaResponseDueAt.Valid && t.CreatedAt.Valid {
		c := tickets.ResponseClock(in, now)
		v.SLA.Response = &c
	}
	if t.SlaResolutionDueAt.Valid && t.CreatedAt.Valid {
		c := tickets.ResolutionClock(in, now)
		v.SLA.Resolution = &c
	}
	for _, to := range tickets.Transitions(tickets.Status(t.Status)) {
		if to == tickets.Cancelled {
			continue // cancelar = eliminar (admin), no un botón de estado
		}
		v.AllowedTransitions = append(v.AllowedTransitions, string(to))
	}
	return v
}

type ticketCommentDTO struct {
	ID         uuid.UUID        `json:"id"`
	AuthorName string           `json:"authorName"`
	Content    string           `json:"content"`
	IsPublic   bool             `json:"isPublic"`
	CreatedAt  time.Time        `json:"createdAt"`
	Images     []ticketImageDTO `json:"images"`
}

// ticketImageDTO: los bytes se piden aparte (GET /api/tickets/{id}/images/{imageId}).
type ticketImageDTO struct {
	ID        uuid.UUID `json:"id"`
	FileName  string    `json:"fileName"`
	SizeBytes int32     `json:"sizeBytes"`
	CreatedAt time.Time `json:"createdAt"`
}

func imagesOfComment(rows []db.ListTicketImagesRow, commentID uuid.UUID) []ticketImageDTO {
	out := []ticketImageDTO{}
	for _, i := range rows {
		if i.CommentID.Valid && uuid.UUID(i.CommentID.Bytes) == commentID {
			out = append(out, ticketImageDTO{ID: i.ID, FileName: i.FileName, SizeBytes: i.SizeBytes, CreatedAt: i.CreatedAt.Time})
		}
	}
	return out
}

func toTicketCommentDTO(c db.TicketComment) ticketCommentDTO {
	return ticketCommentDTO{ID: c.ID, AuthorName: c.AuthorName, Content: c.Content, IsPublic: c.IsPublic, CreatedAt: c.CreatedAt.Time, Images: []ticketImageDTO{}}
}

type ticketTaskDTO struct {
	ID               uuid.UUID `json:"id"`
	Username         string    `json:"username"`
	Content          string    `json:"content"`
	TimeSpentSeconds int32     `json:"timeSpentSeconds"`
	IsPublic         bool      `json:"isPublic"`
	PerformedAt      time.Time `json:"performedAt"`
}

func toTicketTaskDTO(t db.TicketTask, username string) ticketTaskDTO {
	return ticketTaskDTO{ID: t.ID, Username: username, Content: t.Content, TimeSpentSeconds: t.TimeSpentSeconds, IsPublic: t.IsPublic, PerformedAt: t.PerformedAt.Time}
}

type ticketEntryDTO struct {
	ID             uuid.UUID `json:"id"`
	EntryType      string    `json:"entryType"`
	Content        string    `json:"content"`
	AuthorUsername string    `json:"authorUsername"`
	CreatedAt      time.Time `json:"createdAt"`
}

type ticketDetailDTO struct {
	Ticket                ticketViewDTO       `json:"ticket"`
	PublicTrackingToken   *string             `json:"publicTrackingToken"`
	PublicTrackingPin     *string             `json:"publicTrackingPin"`
	Comments              []ticketCommentDTO  `json:"comments"`
	Tasks                 []ticketTaskDTO     `json:"tasks"`
	Entries               []ticketEntryDTO    `json:"entries"`
	TotalTimeSpentSeconds int64               `json:"totalTimeSpentSeconds"`
	Resolvers             []ticketResolverDTO `json:"resolvers"`
}

// ticketResolverDTO: una persona que trabaja el ticket (puede haber varias).
type ticketResolverDTO struct {
	UserID   uuid.UUID `json:"userId"`
	Username string    `json:"username"`
	FullName *string   `json:"fullName"`
}

type ticketQueueSummaryDTO struct {
	Open          int64 `json:"open"`
	Breached      int64 `json:"breached"`
	Paused        int64 `json:"paused"`
	ResolvedToday int64 `json:"resolvedToday"`
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

// List es GET /api/tickets: `?ticketType=&scope=&status=&teamId=&clientId=&q=&openOnly=true&page=`.
// Devuelve además el resumen de la cola para la cabecera (una sola llamada).
func (h *TicketsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := parsePositiveInt(q.Get("page"), 1)
	size := parsePositiveInt(q.Get("pageSize"), defaultTicketsPageSize)
	if size > maxTicketsPageSize {
		size = maxTicketsPageSize
	}
	params := db.ListTicketsViewParams{
		TicketType: db.NullTicketType{TicketType: db.TicketType(q.Get("ticketType")), Valid: q.Get("ticketType") != ""},
		Scope:      db.NullEntryScope{EntryScope: db.EntryScope(q.Get("scope")), Valid: q.Get("scope") != ""},
		Status:     db.NullTicketStatus{TicketStatus: db.TicketStatus(q.Get("status")), Valid: q.Get("status") != ""},
		Q:          queryText(q.Get("q")), OpenOnly: q.Get("openOnly") == "true",
		PageSize: int32(size), PageOffset: int32((page - 1) * size),
	}
	if v, err := uuid.Parse(q.Get("teamId")); err == nil {
		params.AssignedTeamID = pgtype.UUID{Bytes: v, Valid: true}
	}
	if v, err := uuid.Parse(q.Get("clientId")); err == nil {
		params.ClientID = pgtype.UUID{Bytes: v, Valid: true}
	}
	ctx := r.Context()
	rows, err := h.Queries.ListTicketsView(ctx, params)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron listar los tickets")
		return
	}
	total, err := h.Queries.CountTicketsView(ctx, db.CountTicketsViewParams{TicketType: params.TicketType, Scope: params.Scope, Status: params.Status, AssignedTeamID: params.AssignedTeamID, ClientID: params.ClientID, Q: params.Q, OpenOnly: params.OpenOnly})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo contar los tickets")
		return
	}
	now := h.now()
	summary, err := h.Queries.TicketQueueSummary(ctx, db.TicketQueueSummaryParams{Now: pgtype.Timestamptz{Time: now, Valid: true}, ResolvedSince: pgtype.Timestamptz{Time: startOfDay(now), Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo resumir la cola")
		return
	}
	items := make([]ticketViewDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, toTicketView(row.Ticket, row.ClientName, row.TeamName, row.AssigneeUsername, now))
	}
	writeData(w, 200, map[string]any{
		"items": items, "total": total,
		"summary": ticketQueueSummaryDTO{Open: summary.OpenCount, Breached: summary.BreachedCount, Paused: summary.PausedCount, ResolvedToday: summary.ResolvedTodayCount},
	})
}

func (h *TicketsHandler) loadDetail(r *http.Request, id uuid.UUID) (ticketDetailDTO, error) {
	ctx := r.Context()
	row, err := h.Queries.GetTicketView(ctx, id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	comments, err := h.Queries.ListTicketComments(ctx, id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	taskRows, err := h.Queries.ListTicketTasksWithUser(ctx, id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	entryRows, err := h.Queries.ListTicketEntriesWithAuthor(ctx, pgtype.UUID{Bytes: id, Valid: true})
	if err != nil {
		return ticketDetailDTO{}, err
	}
	total, err := h.Queries.SumTicketTaskTime(ctx, id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	resolvers, err := h.Queries.ListTicketResolvers(ctx, id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	images, err := h.Queries.ListTicketImages(ctx, id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	d := ticketDetailDTO{
		Ticket:              toTicketView(row.Ticket, row.ClientName, row.TeamName, row.AssigneeUsername, h.now()),
		PublicTrackingToken: textPtr(row.Ticket.PublicTrackingToken), PublicTrackingPin: textPtr(row.Ticket.PublicTrackingPin),
		Comments: make([]ticketCommentDTO, 0, len(comments)), Tasks: make([]ticketTaskDTO, 0, len(taskRows)),
		Entries: make([]ticketEntryDTO, 0, len(entryRows)), TotalTimeSpentSeconds: total,
		Resolvers: make([]ticketResolverDTO, 0, len(resolvers)),
	}
	for _, rv := range resolvers {
		d.Resolvers = append(d.Resolvers, ticketResolverDTO{UserID: rv.UserID, Username: rv.Username, FullName: textPtr(rv.FullName)})
	}
	// Actividad: lo más reciente arriba, como en la pantalla.
	for i := len(comments) - 1; i >= 0; i-- {
		dto := toTicketCommentDTO(comments[i])
		dto.Images = imagesOfComment(images, comments[i].ID)
		d.Comments = append(d.Comments, dto)
	}
	for _, t := range taskRows {
		d.Tasks = append(d.Tasks, ticketTaskDTO{ID: t.ID, Username: t.Username, Content: t.Content, TimeSpentSeconds: t.TimeSpentSeconds, IsPublic: t.IsPublic, PerformedAt: t.PerformedAt.Time})
	}
	for _, e := range entryRows {
		d.Entries = append(d.Entries, ticketEntryDTO{ID: e.ID, EntryType: string(e.EntryType), Content: e.Content, AuthorUsername: e.Username, CreatedAt: e.CreatedAt.Time})
	}
	return d, nil
}

func (h *TicketsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	d, err := h.loadDetail(r, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el ticket")
		return
	}
	writeData(w, 200, d)
}

type updateTicketRequest struct {
	Status            *string    `json:"status"`
	TeamID            *uuid.UUID `json:"teamId"`
	AssignedUserID    *uuid.UUID `json:"assignedUserId"`
	AssignedContactID *uuid.UUID `json:"assignedContactId"`
	Impact            *string    `json:"impact"`
	Urgency           *string    `json:"urgency"`
}

// Patch cambia estado/asignación/impacto. Solo acepta transiciones válidas
// (tickets.Transitions); la pausa por proveedor acumula tiempo en
// slaPausedSeconds; volver desde resuelto/cerrado cuenta como reapertura; la
// primera acción del equipo cumple el SLA de respuesta.
func (h *TicketsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	ctx := r.Context()
	old, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req updateTicketRequest
	if err = decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	if (req.Impact != nil && !validImpact(*req.Impact)) || (req.Urgency != nil && !validUrgency(*req.Urgency)) {
		problemdetails.Write(w, r, 400, "invalid-payload", "impacto o urgencia inválidos")
		return
	}
	now := h.now()
	p := db.UpdateTicketParams{ID: id, SlaOnHoldSince: old.SlaOnHoldSince, ResolvedAt: old.ResolvedAt, ClosedAt: old.ClosedAt, ReopenedAt: old.ReopenedAt, SlaPausedSeconds: pgtype.Int4{Int32: old.SlaPausedSeconds, Valid: true}, ReopenedCount: pgtype.Int4{Int32: old.ReopenedCount, Valid: true}}
	from := tickets.Status(old.Status)
	if req.Status != nil && tickets.Status(*req.Status) != from {
		to := tickets.Status(*req.Status)
		if !validStatus(*req.Status) {
			problemdetails.Write(w, r, 400, "invalid-payload", "estado inválido")
			return
		}
		// Cancelar no es un estado de cierre (pedido del dueño): un ticket mal
		// creado se borra entero, y eso lo hace un admin (DELETE).
		if to == tickets.Cancelled {
			problemdetails.Write(w, r, 400, "invalid-payload", "un ticket mal creado no se cancela: un admin lo elimina")
			return
		}
		if !tickets.CanTransition(from, to) {
			problemdetails.Write(w, r, http.StatusConflict, "invalid-transition", fmt.Sprintf("no se puede pasar de %s a %s", from, to))
			return
		}
		if to == tickets.Assigned && !old.AssignedUserID.Valid && req.AssignedUserID == nil {
			problemdetails.Write(w, r, 400, "invalid-payload", "indica a quién se asigna el ticket (assignedUserId)")
			return
		}
		p.Status = db.NullTicketStatus{TicketStatus: db.TicketStatus(to), Valid: true}
		if to == tickets.PendingVendor {
			p.SlaOnHoldSince = pgtype.Timestamptz{Time: now, Valid: true}
		}
		if from == tickets.PendingVendor && old.SlaOnHoldSince.Valid {
			p.SlaPausedSeconds.Int32 += int32(now.Sub(old.SlaOnHoldSince.Time).Seconds())
			p.SlaOnHoldSince = pgtype.Timestamptz{}
		}
		switch to {
		case tickets.Resolved:
			p.ResolvedAt = pgtype.Timestamptz{Time: now, Valid: true}
		case tickets.Closed:
			p.ClosedAt = pgtype.Timestamptz{Time: now, Valid: true}
		}
		if tickets.IsReopen(from, to) {
			p.ReopenedCount.Int32++
			p.ReopenedAt = pgtype.Timestamptz{Time: now, Valid: true}
			p.ResolvedAt = pgtype.Timestamptz{}
			p.ClosedAt = pgtype.Timestamptz{}
		}
		p.FirstRespondedAt = pgtype.Timestamptz{Time: now, Valid: true} // COALESCE: solo cuenta la primera
	}
	if req.TeamID != nil {
		p.AssignedTeamID = pgtype.UUID{Bytes: *req.TeamID, Valid: true}
	}
	if req.AssignedUserID != nil {
		p.AssignedUserID = pgtype.UUID{Bytes: *req.AssignedUserID, Valid: true}
	}
	if req.AssignedContactID != nil {
		p.AssignedContactID = pgtype.UUID{Bytes: *req.AssignedContactID, Valid: true}
	}
	if req.Impact != nil || req.Urgency != nil {
		impact, urgency := string(old.Impact), string(old.Urgency)
		if req.Impact != nil {
			impact = *req.Impact
		}
		if req.Urgency != nil {
			urgency = *req.Urgency
		}
		p.Impact = db.NullItilImpact{ItilImpact: db.ItilImpact(impact), Valid: true}
		p.Urgency = db.NullItilUrgency{ItilUrgency: db.ItilUrgency(urgency), Valid: true}
		p.Priority = db.NullItilPriority{ItilPriority: ticketPriority(impact, urgency), Valid: true}
	}
	if _, err = h.Queries.UpdateTicket(ctx, p); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo actualizar el ticket")
		return
	}
	// Quien toma (o a quien se asigna) el ticket queda como resolutor.
	if req.AssignedUserID != nil {
		actor, _ := middleware.UserFromContext(ctx)
		_ = h.Queries.AddTicketResolver(ctx, db.AddTicketResolverParams{TicketID: id, UserID: *req.AssignedUserID, AddedBy: pgtype.UUID{Bytes: actor.ID, Valid: actor.ID != uuid.Nil}})
	}
	if h.AuditLog != nil {
		meta := map[string]any{"ticketId": id.String()}
		if req.Status != nil {
			meta["from"], meta["to"] = string(from), *req.Status
		}
		h.AuditLog.Log(ctx, "ticket.updated", audit.LevelInfo, audit.Success(), meta)
	}
	h.notifyChanged(ctx, id)
	row, err := h.Queries.GetTicketView(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo recargar el ticket")
		return
	}
	writeData(w, 200, toTicketView(row.Ticket, row.ClientName, row.TeamName, row.AssigneeUsername, now))
}

// newPublicPin: 6 dígitos (spec/06 §6.4) con crypto/rand.
func newPublicPin() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// RegeneratePublicPin es POST /api/tickets/:id/public-pin: invalida el PIN
// anterior (por ejemplo, si se envió al contacto equivocado).
func (h *TicketsHandler) RegeneratePublicPin(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	pin, err := newPublicPin()
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo generar el PIN")
		return
	}
	if _, err = h.Queries.SetTicketPublicPin(r.Context(), db.SetTicketPublicPinParams{ID: id, PublicTrackingPin: pgtype.Text{String: pin, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "ticket.public_pin_regenerated", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String()})
	}
	writeData(w, 200, map[string]any{"publicTrackingPin": pin})
}

// markResponded: comentar o registrar trabajo también cumple la primera respuesta.
// notifyChanged publica ticket.updated; mejor esfuerzo, como el resto de los eventos de sincronización.
func (h *TicketsHandler) notifyChanged(ctx context.Context, id uuid.UUID) {
	publishSync(ctx, h.Hub, "ticket.updated", map[string]string{"id": id.String()})
}

func (h *TicketsHandler) markResponded(ctx context.Context, q *db.Queries, id uuid.UUID) error {
	return q.MarkTicketResponded(ctx, db.MarkTicketRespondedParams{ID: id, At: pgtype.Timestamptz{Time: h.now(), Valid: true}})
}

// Delete es DELETE /api/tickets/{id} (solo admin): un ticket mal creado o no
// válido se borra entero — comentarios y tareas caen con él (ON DELETE
// CASCADE) y las entradas de bitácora que lo enlazaban quedan sin enlace. Su
// número queda solo en la auditoría.
func (h *TicketsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	ctx := r.Context()
	number, err := h.Queries.DeleteTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "ticket.deleted", audit.LevelWarn, audit.Success(), map[string]any{"ticketId": id.String(), "ticketNumber": number})
	publishSync(ctx, h.Hub, "ticket.updated", map[string]string{"id": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

// AddResolver es POST /api/tickets/{id}/resolvers {userId}: suma a una
// persona que trabaja el ticket.
func (h *TicketsHandler) AddResolver(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req struct {
		UserID uuid.UUID `json:"userId"`
	}
	if err = decodeJSON(w, r, &req); err != nil || req.UserID == uuid.Nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "userId es obligatorio")
		return
	}
	ctx := r.Context()
	if _, err = h.Queries.GetTicket(ctx, id); err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	if err = h.Queries.AddTicketResolver(ctx, db.AddTicketResolverParams{TicketID: id, UserID: req.UserID, AddedBy: pgtype.UUID{Bytes: actor.ID, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "usuario inexistente")
		return
	}
	h.AuditLog.Log(ctx, "ticket.resolver.add", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "userId": req.UserID.String()})
	h.notifyChanged(ctx, id)
	w.WriteHeader(http.StatusNoContent)
}

// RemoveResolver es DELETE /api/tickets/{id}/resolvers/{userId}.
func (h *TicketsHandler) RemoveResolver(w http.ResponseWriter, r *http.Request) {
	id, err1 := uuid.Parse(r.PathValue("id"))
	userID, err2 := uuid.Parse(r.PathValue("userId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, 404, "not-found", "resolutor no encontrado")
		return
	}
	ctx := r.Context()
	n, err := h.Queries.RemoveTicketResolver(ctx, db.RemoveTicketResolverParams{TicketID: id, UserID: userID})
	if err != nil || n == 0 {
		problemdetails.Write(w, r, 404, "not-found", "resolutor no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "ticket.resolver.remove", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "userId": userID.String()})
	h.notifyChanged(ctx, id)
	w.WriteHeader(http.StatusNoContent)
}

// Assignees es GET /api/tickets/assignees: a quién se puede sumar como
// resolutor (lo usa cualquier analista; /api/users es solo admin).
func (h *TicketsHandler) Assignees(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListTicketAssignees(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo listar a los usuarios")
		return
	}
	out := make([]ticketResolverDTO, 0, len(rows))
	for _, u := range rows {
		out = append(out, ticketResolverDTO{UserID: u.ID, Username: u.Username, FullName: textPtr(u.FullName)})
	}
	writeData(w, 200, out)
}

// UploadImage es POST /api/tickets/{id}/images (multipart "image"): la deja
// pendiente hasta que un comentario la reclama con imageIds. Las pendientes de
// más de un día (pestaña cerrada) se limpian acá mismo.
func (h *TicketsHandler) UploadImage(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	ctx := r.Context()
	if _, err := h.Queries.GetTicket(ctx, id); err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	img, ok := readImageUpload(w, r)
	if !ok {
		return
	}
	_ = h.Queries.DeleteStaleTicketImages(ctx)
	u, _ := middleware.UserFromContext(ctx)
	row, err := h.Queries.CreateTicketImage(ctx, db.CreateTicketImageParams{
		TicketID: id, FileName: img.name, MimeType: img.mime, SizeBytes: int32(len(img.data)), FileData: img.data,
		HashSha256: img.hash, UploadedBy: pgtype.UUID{Bytes: u.ID, Valid: true},
	})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la imagen")
		return
	}
	h.AuditLog.Log(ctx, "ticket.image_uploaded", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "imageId": row.ID.String(), "sizeBytes": row.SizeBytes})
	writeData(w, 201, ticketImageDTO{ID: row.ID, FileName: row.FileName, SizeBytes: row.SizeBytes, CreatedAt: row.CreatedAt.Time})
}

// DeletePendingImage es DELETE /api/tickets/{id}/images/{imageId}: quitar
// una imagen antes de publicar el comentario (solo quien la subió).
func (h *TicketsHandler) DeletePendingImage(w http.ResponseWriter, r *http.Request) {
	id, err1 := uuid.Parse(r.PathValue("id"))
	imageID, err2 := uuid.Parse(r.PathValue("imageId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada")
		return
	}
	ctx := r.Context()
	u, _ := middleware.UserFromContext(ctx)
	n, err := h.Queries.DeletePendingTicketImage(ctx, db.DeletePendingTicketImageParams{ID: imageID, TicketID: id, UploadedBy: pgtype.UUID{Bytes: u.ID, Valid: true}})
	if err != nil || n == 0 {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada o ya publicada")
		return
	}
	h.AuditLog.Log(ctx, "ticket.image_removed", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "imageId": imageID.String()})
	w.WriteHeader(http.StatusNoContent)
}

// ServeImage es GET /api/tickets/{id}/images/{imageId}: las publicadas, o las
// pendientes de quien las subió (la miniatura antes de comentar).
func (h *TicketsHandler) ServeImage(w http.ResponseWriter, r *http.Request) {
	id, err1 := uuid.Parse(r.PathValue("id"))
	imageID, err2 := uuid.Parse(r.PathValue("imageId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada")
		return
	}
	img, err := h.Queries.GetTicketImage(r.Context(), db.GetTicketImageParams{ID: imageID, TicketID: id})
	u, _ := middleware.UserFromContext(r.Context())
	if err != nil || (!img.CommentID.Valid && (!img.UploadedBy.Valid || uuid.UUID(img.UploadedBy.Bytes) != u.ID)) {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada")
		return
	}
	writeImage(w, img.MimeType, img.FileName, img.FileData)
}

// PublicImage es GET /api/public/tickets/{token}/images/{imageId}?pin=: solo
// imágenes de comentarios visibles al cliente, con el mismo PIN que la página.
func (h *TicketsHandler) PublicImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := r.PathValue("token")
	t, err := h.Queries.GetPublicTicket(ctx, pgtype.Text{String: token, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada")
		return
	}
	// Una página con varias imágenes hace varias peticiones con el PIN ya
	// aceptado: solo los PIN incorrectos consumen intentos del limitador.
	if t.PublicTrackingPin.Valid && !publicPinMatches(t.PublicTrackingPin, r.URL.Query().Get("pin")) {
		if h.PinLimiter != nil && !h.PinLimiter.Allow("ticket-pin:"+token) {
			problemdetails.Write(w, r, http.StatusTooManyRequests, "too-many-attempts", "demasiados intentos de PIN, espera unos minutos")
			return
		}
		problemdetails.Write(w, r, 401, "pin-required", "PIN requerido o incorrecto")
		return
	}
	imageID, err := uuid.Parse(r.PathValue("imageId"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada")
		return
	}
	img, err := h.Queries.GetTicketImage(ctx, db.GetTicketImageParams{ID: imageID, TicketID: t.ID})
	if err != nil || !img.CommentID.Valid || !img.IsPublic {
		problemdetails.Write(w, r, 404, "not-found", "imagen no encontrada")
		return
	}
	writeImage(w, img.MimeType, img.FileName, img.FileData)
}

func writeImage(w http.ResponseWriter, mime, name string, data []byte) {
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
