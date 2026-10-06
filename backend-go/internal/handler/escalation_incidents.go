package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Rediseño de escalamiento (#17, canvas v26 aprobado 2026-10-05): cada
// escalamiento pertenece a un incidente — un evento ("Virus en RRHH 15:02" no
// es lo mismo que "Phishing 16:31") enlazado a un ticket GLPI o a un ticket
// interno —, con su propio avance e historial forense con comentarios. Los
// pools (TI-Mundo, Redes-Mundo…) se configuran aparte y se agregan a un nivel
// como un solo integrante. El Recordatorio del cliente va en la política.

type incidentDTO struct {
	ID                uuid.UUID  `json:"id"`
	ServiceID         *uuid.UUID `json:"serviceId,omitempty"`
	AssetID           *uuid.UUID `json:"assetId,omitempty"`
	TerritorialUnitID *uuid.UUID `json:"territorialUnitId,omitempty"`
	Title             string     `json:"title"`
	GlpiTicket        *string    `json:"glpiTicket,omitempty"`
	TicketID          *uuid.UUID `json:"ticketId,omitempty"`
	TicketNumber      *string    `json:"ticketNumber,omitempty"`
	OpenedBy          string     `json:"openedBy"`
	OpenedAt          time.Time  `json:"openedAt"`
	ClosedAt          *time.Time `json:"closedAt,omitempty"`
}

func toIncidentDTO(r db.ListEscalationIncidentsRow) incidentDTO {
	dto := incidentDTO{
		ID: r.ID, ServiceID: uuidPtr(r.ServiceID), AssetID: uuidPtr(r.AssetID), TerritorialUnitID: uuidPtr(r.TerritorialUnitID),
		Title: r.Title, GlpiTicket: textPtr(r.GlpiTicket), TicketID: uuidPtr(r.TicketID), TicketNumber: textPtr(r.TicketNumber),
		OpenedBy: r.OpenedByUsername, OpenedAt: r.OpenedAt.Time,
	}
	if r.ClosedAt.Valid {
		dto.ClosedAt = &r.ClosedAt.Time
	}
	return dto
}

func scopeParams(s scope) (pgtype.UUID, pgtype.UUID, pgtype.UUID) {
	return optionalUUID(s.ServiceID), optionalUUID(s.AssetID), optionalUUID(s.TerritorialUnitID)
}

// ListIncidents es GET /api/escalation/incidents?serviceId=|assetId=|territorialUnitId=.
func (h *EscalationHandler) ListIncidents(w http.ResponseWriter, r *http.Request) {
	s, err := scopeFromQuery(r)
	if err != nil || s.count() != 1 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-scope", "indica exactamente uno: serviceId, assetId o territorialUnitId")
		return
	}
	if !h.checkModule(w, r, s) {
		return
	}
	svc, asset, unit := scopeParams(s)
	rows, err := h.Queries.ListEscalationIncidents(r.Context(), db.ListEscalationIncidentsParams{ServiceID: svc, AssetID: asset, TerritorialUnitID: unit})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los incidentes")
		return
	}
	out := make([]incidentDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toIncidentDTO(row))
	}
	writeData(w, http.StatusOK, out)
}

type createIncidentRequest struct {
	scope
	Title      string     `json:"title"`
	GlpiTicket *string    `json:"glpiTicket"`
	TicketID   *uuid.UUID `json:"ticketId"`
}

// CreateIncident es POST /api/escalation/incidents.
func (h *EscalationHandler) CreateIncident(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createIncidentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.scope.count() != 1 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-scope", "indica exactamente uno: serviceId, assetId o territorialUnitId")
		return
	}
	title := strings.TrimSpace(req.Title)
	glpi := strings.TrimPrefix(strings.TrimSpace(deref(req.GlpiTicket)), "#")
	if title == "" || len([]rune(title)) > 160 || len(glpi) > 40 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica qué pasó (hasta 160 caracteres); el número GLPI va sin espacios")
		return
	}
	if glpi != "" && req.TicketID != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "enlaza un ticket GLPI o un ticket interno, no los dos")
		return
	}
	if !h.checkModule(w, r, req.scope) {
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	svc, asset, unit := scopeParams(req.scope)
	inc, err := h.Queries.CreateEscalationIncident(ctx, db.CreateEscalationIncidentParams{
		ServiceID: svc, AssetID: asset, TerritorialUnitID: unit, Title: title,
		GlpiTicket: pgtype.Text{String: glpi, Valid: glpi != ""}, TicketID: optionalUUID(req.TicketID), OpenedBy: user.ID,
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el servicio, activo, unidad o ticket indicado no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo abrir el incidente")
		return
	}
	row, err := h.Queries.GetEscalationIncident(ctx, inc.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el incidente")
		return
	}
	h.AuditLog.Log(ctx, "escalation.incident.opened", audit.LevelInfo, audit.Success(), map[string]any{
		"incidentId": inc.ID.String(), "title": title, "glpiTicket": glpi, "ticketId": uuidString(req.TicketID),
	})
	writeData(w, http.StatusCreated, toIncidentDTO(db.ListEscalationIncidentsRow(row)))
}

func uuidString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

type patchIncidentRequest struct {
	Closed *bool `json:"closed"`
}

// PatchIncident es PATCH /api/escalation/incidents/{id}: cerrar o reabrir.
func (h *EscalationHandler) PatchIncident(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "incidente no encontrado")
		return
	}
	var req patchIncidentRequest
	if err := decodeJSON(w, r, &req); err != nil || req.Closed == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica closed: true o false")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	var n int64
	if *req.Closed {
		n, err = h.Queries.CloseEscalationIncident(ctx, db.CloseEscalationIncidentParams{ID: id, ClosedBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	} else {
		n, err = h.Queries.ReopenEscalationIncident(ctx, id)
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el incidente")
		return
	}
	row, getErr := h.Queries.GetEscalationIncident(ctx, id)
	if errors.Is(getErr, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "incidente no encontrado")
		return
	}
	if getErr != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el incidente")
		return
	}
	if n > 0 {
		event := "escalation.incident.reopened"
		if *req.Closed {
			event = "escalation.incident.closed"
		}
		h.AuditLog.Log(ctx, event, audit.LevelInfo, audit.Success(), map[string]any{"incidentId": id.String()})
	}
	writeData(w, http.StatusOK, toIncidentDTO(db.ListEscalationIncidentsRow(row)))
}

type incidentNoteDTO struct {
	ID        uuid.UUID `json:"id"`
	Note      string    `json:"note"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListIncidentNotes es GET /api/escalation/incidents/{id}/notes.
func (h *EscalationHandler) ListIncidentNotes(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "incidente no encontrado")
		return
	}
	rows, err := h.Queries.ListEscalationIncidentNotes(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los comentarios")
		return
	}
	out := make([]incidentNoteDTO, 0, len(rows))
	for _, n := range rows {
		out = append(out, incidentNoteDTO{ID: n.ID, Note: n.Note, Username: n.Username, CreatedAt: n.CreatedAt.Time})
	}
	writeData(w, http.StatusOK, out)
}

type addNoteRequest struct {
	Note string `json:"note"`
}

// AddIncidentNote es POST /api/escalation/incidents/{id}/notes: un
// comentario en el historial forense del incidente.
func (h *EscalationHandler) AddIncidentNote(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "incidente no encontrado")
		return
	}
	var req addNoteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	note := strings.TrimSpace(req.Note)
	if note == "" || len([]rune(note)) > 4000 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el comentario no puede quedar vacío (máximo 4000 caracteres)")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	n, err := h.Queries.AddEscalationIncidentNote(ctx, db.AddEscalationIncidentNoteParams{IncidentID: id, UserID: user.ID, Note: note})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "incidente no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el comentario")
		return
	}
	h.AuditLog.Log(ctx, "escalation.incident.note", audit.LevelInfo, audit.Success(), map[string]any{"incidentId": id.String(), "noteId": n.ID.String()})
	writeData(w, http.StatusCreated, incidentNoteDTO{ID: n.ID, Note: n.Note, Username: user.Username, CreatedAt: n.CreatedAt.Time})
}

type patchPolicyRequest struct {
	Reminder *string `json:"reminder"`
}

// PatchPolicy es PATCH /api/escalation/policies/{id}: el Recordatorio del
// cliente que se muestra bajo el flujo de llamados.
func (h *EscalationHandler) PatchPolicy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "política no encontrada")
		return
	}
	var req patchPolicyRequest
	if err := decodeJSON(w, r, &req); err != nil || req.Reminder == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica reminder (vacío lo quita)")
		return
	}
	reminder := strings.TrimSpace(*req.Reminder)
	if len([]rune(reminder)) > 500 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el recordatorio admite hasta 500 caracteres")
		return
	}
	p, err := h.Queries.UpdatePolicyReminder(ctx, db.UpdatePolicyReminderParams{Reminder: pgtype.Text{String: reminder, Valid: reminder != ""}, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "política no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el recordatorio")
		return
	}
	h.AuditLog.Log(ctx, "escalation.policy.updated", audit.LevelInfo, audit.Success(), map[string]any{"policyId": p.ID.String(), "reminder": reminder != ""})
	w.WriteHeader(http.StatusNoContent)
}
