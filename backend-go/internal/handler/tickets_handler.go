package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
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
	Pool    *pgxpool.Pool
	Queries *db.Queries
	Now     func() time.Time
}

func (h *TicketsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// RequireEnabled is the authorization boundary for the optional ticket module.
func (h *TicketsHandler) RequireEnabled(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	feature, err := h.Queries.GetSystemFeature(r.Context(), "native_tickets")
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el estado de ticketing")
		return
	}
	if !feature.IsEnabled {
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
}

func ticketPriority(impact, urgency string) db.ItilPriority {
	if impact == "high" && (urgency == "high" || urgency == "critical") {
		return db.ItilPriorityP1Critical
	}
	if impact == "high" || urgency == "critical" {
		return db.ItilPriorityP2High
	}
	if impact == "medium" || urgency == "medium" {
		return db.ItilPriorityP3Medium
	}
	return db.ItilPriorityP4Low
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

func (h *TicketsHandler) createTicketTx(ctx context.Context, tx pgx.Tx, queries *db.Queries, ticketType string, scope db.EntryScope, clientID, teamID uuid.UUID, serviceID pgtype.UUID, title, description, impact, urgency string, actorID uuid.UUID, now time.Time) (db.Ticket, error) {
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
	resolution := 8 * time.Hour
	if ticketType == "service_request" {
		resolution = 72 * time.Hour
	}
	return queries.CreateTicket(ctx, db.CreateTicketParams{TicketNumber: fmt.Sprintf("TKT-%04d-%05d", now.Year(), sequence), TicketType: db.TicketType(ticketType), Scope: scope, ClientID: clientID, AssignedTeamID: pgtype.UUID{Bytes: teamID, Valid: true}, Impact: db.ItilImpact(impact), Urgency: db.ItilUrgency(urgency), Priority: ticketPriority(impact, urgency), Title: title, Description: description, SlaResponseDueAt: pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true}, SlaResolutionDueAt: pgtype.Timestamptz{Time: now.Add(resolution), Valid: true}, PublicTrackingToken: pgtype.Text{String: token, Valid: true}, CreatedBy: pgtype.UUID{Bytes: actorID, Valid: true}, ServiceID: serviceID})
}

func (h *TicketsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createTicketRequest
	if err := decodeJSON(w, r, &req); err != nil || !validTicketType(req.TicketType) || req.ClientID == uuid.Nil || req.TeamID == uuid.Nil || !validImpact(req.Impact) || !validUrgency(req.Urgency) || strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Description) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "ticketType, scope, clientId, teamId, impacto, urgencia, título y descripción son obligatorios")
		return
	}
	scope := db.EntryScope(req.Scope)
	if scope != "soc" && scope != "noc" {
		scope = db.EntryScopeGeneral
	}
	token, err := randomToken()
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el seguimiento público")
		return
	}
	now := h.now()
	resolution := 8 * time.Hour
	if req.TicketType == "service_request" {
		resolution = 72 * time.Hour
	}
	actor, _ := middleware.UserFromContext(r.Context())
	tx, err := h.Pool.Begin(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo iniciar la creación")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtext($1))", strconv.Itoa(now.Year())); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo reservar el correlativo")
		return
	}
	var seq int
	err = tx.QueryRow(r.Context(), "SELECT COALESCE(MAX(CAST(right(ticket_number, 5) AS integer)), 0) + 1 FROM tickets WHERE ticket_number LIKE $1", fmt.Sprintf("TKT-%04d-%%", now.Year())).Scan(&seq)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo generar el correlativo")
		return
	}
	ticket, err := h.Queries.WithTx(tx).CreateTicket(r.Context(), db.CreateTicketParams{TicketNumber: fmt.Sprintf("TKT-%04d-%05d", now.Year(), seq), TicketType: db.TicketType(req.TicketType), Scope: scope, ClientID: req.ClientID, AssignedTeamID: pgtype.UUID{Bytes: req.TeamID, Valid: true}, Impact: db.ItilImpact(req.Impact), Urgency: db.ItilUrgency(req.Urgency), Priority: ticketPriority(req.Impact, req.Urgency), Title: strings.TrimSpace(req.Title), Description: strings.TrimSpace(req.Description), SlaResponseDueAt: pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true}, SlaResolutionDueAt: pgtype.Timestamptz{Time: now.Add(resolution), Valid: true}, PublicTrackingToken: pgtype.Text{String: token, Valid: true}, CreatedBy: pgtype.UUID{Bytes: actor.ID, Valid: true}, AssetID: optionalUUID(req.AssetID), ServiceID: optionalUUID(req.ServiceID), AssignedUserID: optionalUUID(req.AssignedUserID)})
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se pudo crear el ticket; verifica cliente, equipo y relaciones")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el ticket")
		return
	}
	writeData(w, http.StatusCreated, toTicketDTO(ticket, true))
}

func (h *TicketsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := parsePositiveInt(q.Get("page"), 1)
	size := parsePositiveInt(q.Get("pageSize"), defaultTicketsPageSize)
	if size > maxTicketsPageSize {
		size = maxTicketsPageSize
	}
	params := db.ListTicketsParams{TicketType: db.NullTicketType{TicketType: db.TicketType(q.Get("ticketType")), Valid: q.Get("ticketType") != ""}, Scope: db.NullEntryScope{EntryScope: db.EntryScope(q.Get("scope")), Valid: q.Get("scope") != ""}, Status: db.NullTicketStatus{TicketStatus: db.TicketStatus(q.Get("status")), Valid: q.Get("status") != ""}, Q: queryText(q.Get("q")), PageSize: int32(size), PageOffset: int32((page - 1) * size)}
	if v, err := uuid.Parse(q.Get("teamId")); err == nil {
		params.AssignedTeamID = pgtype.UUID{Bytes: v, Valid: true}
	}
	if v, err := uuid.Parse(q.Get("clientId")); err == nil {
		params.ClientID = pgtype.UUID{Bytes: v, Valid: true}
	}
	rows, err := h.Queries.ListTickets(r.Context(), params)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron listar los tickets")
		return
	}
	total, err := h.Queries.CountTickets(r.Context(), db.CountTicketsParams{TicketType: params.TicketType, Scope: params.Scope, Status: params.Status, AssignedTeamID: params.AssignedTeamID, ClientID: params.ClientID, Q: params.Q})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo contar los tickets")
		return
	}
	items := make([]ticketDTO, 0, len(rows))
	for _, t := range rows {
		items = append(items, toTicketDTO(t, true))
	}
	writeData(w, 200, map[string]any{"items": items, "total": total})
}

type ticketDetailDTO struct {
	Ticket                ticketDTO          `json:"ticket"`
	Comments              []db.TicketComment `json:"comments"`
	Entries               []db.Entry         `json:"entries"`
	TotalTimeSpentSeconds int64              `json:"totalTimeSpentSeconds"`
}

func (h *TicketsHandler) load(id uuid.UUID, r *http.Request) (ticketDetailDTO, error) {
	t, err := h.Queries.GetTicket(r.Context(), id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	c, err := h.Queries.ListTicketComments(r.Context(), id)
	if err != nil {
		return ticketDetailDTO{}, err
	}
	e, err := h.Queries.ListTicketEntries(r.Context(), pgtype.UUID{Bytes: id, Valid: true})
	if err != nil {
		return ticketDetailDTO{}, err
	}
	s, err := h.Queries.SumTicketTaskTime(r.Context(), id)
	return ticketDetailDTO{Ticket: toTicketDTO(t, true), Comments: c, Entries: e, TotalTimeSpentSeconds: s}, err
}
func (h *TicketsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	d, err := h.load(id, r)
	if err == pgx.ErrNoRows {
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

func (h *TicketsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	old, err := h.Queries.GetTicket(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req updateTicketRequest
	if err = decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	if req.Status != nil && !validStatus(*req.Status) {
		problemdetails.Write(w, r, 400, "invalid-payload", "estado inválido")
		return
	}
	if req.Status != nil && old.Status == db.TicketStatusClosed && *req.Status != "in_progress" {
		problemdetails.Write(w, r, 400, "invalid-payload", "transición de estado inválida")
		return
	}
	now := h.now()
	p := db.UpdateTicketParams{ID: id, SlaOnHoldSince: old.SlaOnHoldSince, ResolvedAt: old.ResolvedAt, ClosedAt: old.ClosedAt, ReopenedAt: old.ReopenedAt, SlaPausedSeconds: pgtype.Int4{Int32: old.SlaPausedSeconds, Valid: true}, ReopenedCount: pgtype.Int4{Int32: old.ReopenedCount, Valid: true}}
	if req.Status != nil {
		p.Status = db.NullTicketStatus{TicketStatus: db.TicketStatus(*req.Status), Valid: true}
		if *req.Status == "pending_vendor" && old.Status != "pending_vendor" {
			p.SlaOnHoldSince = pgtype.Timestamptz{Time: now, Valid: true}
		}
		if old.Status == "pending_vendor" && *req.Status != "pending_vendor" && old.SlaOnHoldSince.Valid {
			p.SlaPausedSeconds.Int32 += int32(now.Sub(old.SlaOnHoldSince.Time).Seconds())
			p.SlaOnHoldSince = pgtype.Timestamptz{}
		}
		if *req.Status == "resolved" {
			p.ResolvedAt = pgtype.Timestamptz{Time: now, Valid: true}
		}
		if *req.Status == "closed" {
			p.ClosedAt = pgtype.Timestamptz{Time: now, Valid: true}
		}
		if old.Status == "resolved" && *req.Status == "in_progress" {
			p.ReopenedCount.Int32++
			p.ReopenedAt = pgtype.Timestamptz{Time: now, Valid: true}
		}
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
	if req.Impact != nil {
		p.Impact = db.NullItilImpact{ItilImpact: db.ItilImpact(*req.Impact), Valid: true}
	}
	if req.Urgency != nil {
		p.Urgency = db.NullItilUrgency{ItilUrgency: db.ItilUrgency(*req.Urgency), Valid: true}
	}
	t, err := h.Queries.UpdateTicket(r.Context(), p)
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo actualizar el ticket")
		return
	}
	writeData(w, 200, toTicketDTO(t, true))
}

type commentRequest struct {
	Content  string `json:"content"`
	IsPublic bool   `json:"isPublic"`
}

func (h *TicketsHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req commentRequest
	if err = decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Content) == "" {
		problemdetails.Write(w, r, 400, "invalid-payload", "content es obligatorio")
		return
	}
	u, _ := middleware.UserFromContext(r.Context())
	if err := h.AddEntryCommentToTicket(r.Context(), id, u, strings.TrimSpace(req.Content), req.IsPublic); err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	c, err := h.Queries.ListTicketComments(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el comentario creado")
		return
	}
	if len(c) == 0 {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	writeData(w, 201, c[len(c)-1])
}

func (h *TicketsHandler) AddEntryCommentToTicket(ctx context.Context, ticketID uuid.UUID, user middleware.AuthenticatedUser, content string, isPublic bool) error {
	ticket, err := h.Queries.GetTicket(ctx, ticketID)
	if err != nil {
		return err
	}
	if ticket.Status == db.TicketStatusResolved {
		now := h.now()
		_, err = h.Queries.UpdateTicket(ctx, db.UpdateTicketParams{ID: ticket.ID, Status: db.NullTicketStatus{TicketStatus: db.TicketStatusInProgress, Valid: true}, SlaOnHoldSince: ticket.SlaOnHoldSince, SlaPausedSeconds: pgtype.Int4{Int32: ticket.SlaPausedSeconds, Valid: true}, ReopenedCount: pgtype.Int4{Int32: ticket.ReopenedCount + 1, Valid: true}, ReopenedAt: pgtype.Timestamptz{Time: now, Valid: true}})
		if err != nil {
			return err
		}
	}
	_, err = h.Queries.CreateTicketComment(ctx, db.CreateTicketCommentParams{TicketID: ticketID, UserID: pgtype.UUID{Bytes: user.ID, Valid: true}, AuthorName: user.Username, Content: content, IsPublic: isPublic})
	return err
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
	if err = decodeJSON(w, r, &req); err != nil || !validTicketType(req.TicketType) || req.TeamID == uuid.Nil || !validImpact(req.Impact) || !validUrgency(req.Urgency) {
		problemdetails.Write(w, r, 400, "invalid-payload", "ticketType, teamId, impact y urgency son obligatorios")
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
	ticket, err := h.createTicketTx(r.Context(), tx, h.Queries.WithTx(tx), req.TicketType, entry.Scope, clientID, req.TeamID, entry.ServiceID, entry.Content, entry.Content, req.Impact, req.Urgency, actor.ID, h.now())
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
			now := h.now()
			updated, updateErr := h.Queries.UpdateTicket(r.Context(), db.UpdateTicketParams{ID: ticket.ID, Status: db.NullTicketStatus{TicketStatus: db.TicketStatusResolved, Valid: true}, SlaOnHoldSince: ticket.SlaOnHoldSince, SlaPausedSeconds: pgtype.Int4{Int32: ticket.SlaPausedSeconds, Valid: true}, ReopenedCount: pgtype.Int4{Int32: ticket.ReopenedCount, Valid: true}, ResolvedAt: pgtype.Timestamptz{Time: now, Valid: true}})
			if updateErr != nil {
				problemdetails.Write(w, r, 500, "internal-error", "no se pudo resolver el ticket")
				return
			}
			ticket = updated
		}
		ticketDTOValue = toTicketDTO(ticket, true)
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
	items, err := h.Queries.ListTicketTasks(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron listar las tareas")
		return
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
	writeData(w, 201, task)
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
	writeData(w, 200, updated)
}

func (h *TicketsHandler) Public(w http.ResponseWriter, r *http.Request) {
	token := pgtype.Text{String: r.PathValue("token"), Valid: true}
	t, err := h.Queries.GetPublicTicket(r.Context(), token)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if t.PublicTrackingPin.Valid && r.URL.Query().Get("pin") != t.PublicTrackingPin.String {
		problemdetails.Write(w, r, 401, "pin-required", "PIN requerido o incorrecto")
		return
	}
	comments, err := h.Queries.ListPublicTicketComments(r.Context(), t.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el seguimiento")
		return
	}
	type publicTicket struct {
		TicketNumber   string             `json:"ticketNumber"`
		Title          string             `json:"title"`
		Status         string             `json:"status"`
		OpenAt         time.Time          `json:"openAt"`
		LastUpdateAt   time.Time          `json:"lastUpdateAt"`
		PublicComments []db.TicketComment `json:"publicComments"`
	}
	p := publicTicket{TicketNumber: t.TicketNumber, Title: t.Title, Status: string(t.Status), PublicComments: comments}
	if t.CreatedAt.Valid {
		p.OpenAt = t.CreatedAt.Time
	}
	if t.UpdatedAt.Valid {
		p.LastUpdateAt = t.UpdatedAt.Time
	}
	writeData(w, 200, p)
}
