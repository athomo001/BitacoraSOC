package handler

import (
	"context"
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

// Cierre formal de turno y panel de relevo (Fase 11, HU-6 y siguientes).

// shiftClosureDTO: camelCase como el resto del contrato. Antes se devolvía
// el struct de sqlc (snake_case) y el frontend nunca veía los pendientes ni
// `acknowledgedAt`: el relevo siempre decía "sin pendientes" y el botón de
// confirmar no desaparecía nunca.
type shiftClosureDTO struct {
	ID                   uuid.UUID  `json:"id"`
	UserID               uuid.UUID  `json:"userId"`
	Username             string     `json:"username,omitempty"`
	ShiftStartAt         *time.Time `json:"shiftStartAt"`
	ShiftEndAt           *time.Time `json:"shiftEndAt"`
	ClosureCheckID       uuid.UUID  `json:"closureCheckId"`
	TotalEntries         int32      `json:"totalEntries"`
	TotalIncidents       int32      `json:"totalIncidents"`
	ServicesDown         []string   `json:"servicesDown"`
	Observations         *string    `json:"observations"`
	PendingForNextShift  *string    `json:"pendingForNextShift"`
	AcknowledgedBy       *uuid.UUID `json:"acknowledgedBy"`
	AcknowledgedByName   string     `json:"acknowledgedByName,omitempty"`
	AcknowledgedAt       *time.Time `json:"acknowledgedAt"`
	TicketsResolvedCount int32      `json:"ticketsResolvedCount"`
	SlaBreachesCount     int32      `json:"slaBreachesCount"`
	SentStatus           string     `json:"sentStatus"`
	SentError            *string    `json:"sentError"`
	SentAt               *time.Time `json:"sentAt"`
	CreatedAt            *time.Time `json:"createdAt"`
}

func toShiftClosureDTO(c db.ShiftClosure) shiftClosureDTO {
	servicesDown := c.ServicesDown
	if servicesDown == nil {
		servicesDown = []string{}
	}
	return shiftClosureDTO{
		ID: c.ID, UserID: c.UserID, ShiftStartAt: timestamptzPtr(c.ShiftStartAt), ShiftEndAt: timestamptzPtr(c.ShiftEndAt),
		ClosureCheckID: c.ClosureCheckID, TotalEntries: c.TotalEntries, TotalIncidents: c.TotalIncidents, ServicesDown: servicesDown,
		Observations: textPtr(c.Observations), PendingForNextShift: textPtr(c.PendingForNextShift),
		AcknowledgedBy: uuidPtr(c.AcknowledgedBy), AcknowledgedAt: timestamptzPtr(c.AcknowledgedAt),
		TicketsResolvedCount: c.TicketsResolvedCount, SlaBreachesCount: c.SlaBreachesCount,
		SentStatus: c.SentStatus, SentError: textPtr(c.SentError), SentAt: timestamptzPtr(c.SentAt), CreatedAt: timestamptzPtr(c.CreatedAt),
	}
}

type maintenanceWindowDTO struct {
	ID                    uuid.UUID  `json:"id"`
	Title                 string     `json:"title"`
	Notes                 *string    `json:"notes"`
	StartsAt              *time.Time `json:"startsAt"`
	EndsAt                *time.Time `json:"endsAt"`
	SuppressNotifications bool       `json:"suppressNotifications"`
}

// withNames completa quién cerró y quién confirmó el relevo.
func (d shiftClosureDTO) withNames(ctx context.Context, names *usernames) shiftClosureDTO {
	d.Username = names.name(ctx, d.UserID)
	if d.AcknowledgedBy != nil {
		d.AcknowledgedByName = names.name(ctx, *d.AcknowledgedBy)
	}
	return d
}

func toMaintenanceWindowDTO(m db.MaintenanceWindow) maintenanceWindowDTO {
	return maintenanceWindowDTO{ID: m.ID, Title: m.Title, Notes: textPtr(m.Notes), StartsAt: timestamptzPtr(m.StartsAt), EndsAt: timestamptzPtr(m.EndsAt), SuppressNotifications: m.SuppressNotifications}
}

// leafServicesDown: solo hojas en rojo. Un grupo en rojo ya está
// representado por su hijo caído; listarlo también duplicaba el servicio.
func leafServicesDown(services []db.ShiftCheckService) []string {
	down := make([]string, 0)
	for _, service := range services {
		if service.Status == db.ChecklistStatusRojo && !service.IsComputed {
			down = append(down, service.ServiceTitle)
		}
	}
	return down
}

// Close registra el cierre formal del turno. No envía correo dentro de la
// petición: deja el reporte en `pending` y el scheduler de la Fase 12 lo
// despacha una sola vez a los destinatarios del turno. Antes se enviaba acá
// a TODOS los usuarios activos (bloqueando la respuesta en SMTP), y
// `notifyEmail=false` no servía porque el scheduler lo mandaba igual.
func (h *ChecklistsHandler) Close(w http.ResponseWriter, r *http.Request) {
	var req closeShiftRequest
	if err := decodeJSON(w, r, &req); err != nil || req.ClosureCheckID == uuid.Nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "closureCheckId es obligatorio")
		return
	}
	// Antes de crear nada: si no, el cierre quedaba guardado, el cliente
	// recibía un error y al reintentar se duplicaba.
	if req.SyncGLPI {
		problemdetails.Write(w, r, 409, "integration-unavailable", "la sincronización GLPI sigue fuera del corte inicial")
		return
	}
	ctx := r.Context()
	check, err := h.Queries.GetShiftCheck(ctx, req.ClosureCheckID)
	if err != nil || check.CheckType != db.ChecklistCheckTypeCierre {
		problemdetails.Write(w, r, 400, "invalid-payload", "el check de cierre no es válido")
		return
	}
	if _, err := h.Queries.GetShiftClosureByCheck(ctx, check.ID); err == nil {
		problemdetails.Write(w, r, 409, "already-closed", "este turno ya fue cerrado")
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo verificar el cierre")
		return
	}
	shift, err := h.Queries.GetWorkShiftForCheck(ctx, check.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el turno del checklist")
		return
	}
	services, err := h.Queries.ListShiftCheckServices(ctx, check.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar los servicios")
		return
	}
	start, end := shiftWindow(check.CheckDate.Time, shift.StartTime, shift.Timezone)
	from := pgtype.Timestamptz{Time: start, Valid: true}
	to := pgtype.Timestamptz{Time: end, Valid: true}
	totalEntries, _ := h.Queries.CountEntriesInWindow(ctx, db.CountEntriesInWindowParams{CreatedAt: from, CreatedAt_2: to})
	totalIncidents, _ := h.Queries.CountIncidentEntriesInWindow(ctx, db.CountIncidentEntriesInWindowParams{CreatedAt: from, CreatedAt_2: to})
	resolved, _ := h.Queries.CountResolvedTicketsInWindow(ctx, db.CountResolvedTicketsInWindowParams{ResolvedAt: from, ResolvedAt_2: to})
	breaches, _ := h.Queries.CountSLABreachesInWindow(ctx, db.CountSLABreachesInWindowParams{ResolvedAt: from, ResolvedAt_2: to})
	observations := strings.TrimSpace(req.Observations)
	pending := strings.TrimSpace(req.PendingForNextShift)
	user, _ := middleware.UserFromContext(ctx)
	closure, err := h.Queries.CreateShiftClosure(ctx, db.CreateShiftClosureParams{
		UserID: user.ID, ShiftStartAt: from, ShiftEndAt: to, ClosureCheckID: check.ID,
		TotalEntries: int32(totalEntries), TotalIncidents: int32(totalIncidents), ServicesDown: leafServicesDown(services),
		Observations:         pgtype.Text{String: observations, Valid: observations != ""},
		PendingForNextShift:  pgtype.Text{String: pending, Valid: pending != ""},
		TicketsResolvedCount: int32(resolved), SlaBreachesCount: int32(breaches),
	})
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo crear el cierre")
		return
	}
	if !req.NotifyEmail {
		reason := pgtype.Text{String: "el analista no pidió notificar por correo", Valid: true}
		if err := h.Queries.MarkShiftClosureSent(ctx, db.MarkShiftClosureSentParams{ID: closure.ID, SentVia: "email", SentStatus: "skipped", SentError: reason}); err == nil {
			closure.SentStatus = "skipped"
			closure.SentError = reason
		}
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "shift.closed", audit.LevelInfo, audit.Success(), map[string]any{"closureId": closure.ID.String(), "checkId": check.ID.String(), "notifyEmail": req.NotifyEmail})
	}
	writeData(w, 201, toShiftClosureDTO(closure))
}

func (h *ChecklistsHandler) Handover(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	previous, err := h.Queries.GetLatestShiftClosure(ctx)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el cierre anterior")
		return
	}
	var previousDTO *shiftClosureDTO
	if err == nil {
		dto := toShiftClosureDTO(previous).withNames(ctx, &usernames{queries: h.Queries})
		previousDTO = &dto
	}
	now := h.now()
	windows, err := h.Queries.ListUpcomingMaintenanceWindows(ctx, db.ListUpcomingMaintenanceWindowsParams{EndsAt: pgtype.Timestamptz{Time: now, Valid: true}, StartsAt: pgtype.Timestamptz{Time: now.Add(4 * time.Hour), Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar mantenimientos")
		return
	}
	windowDTOs := make([]maintenanceWindowDTO, 0, len(windows))
	for _, window := range windows {
		windowDTOs = append(windowDTOs, toMaintenanceWindowDTO(window))
	}
	var teamID pgtype.UUID
	if parsed, parseErr := uuid.Parse(r.URL.Query().Get("teamId")); parseErr == nil {
		teamID = pgtype.UUID{Bytes: parsed, Valid: true}
	}
	onCallRows, err := h.Queries.ListHandoverOnCall(ctx, db.ListHandoverOnCallParams{Now: pgtype.Timestamptz{Time: now, Valid: true}, TeamID: teamID})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar la guardia activa")
		return
	}
	onCall := make([]map[string]any, 0, len(onCallRows))
	for _, row := range onCallRows {
		onCall = append(onCall, map[string]any{"teamId": row.TeamID, "teamName": row.TeamName, "onCallMember": row.OnCallMember})
	}
	writeData(w, 200, map[string]any{"previousClosure": previousDTO, "upcomingMaintenanceWindows": windowDTOs, "onCallSummary": onCall})
}

func (h *ChecklistsHandler) Acknowledge(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "cierre no encontrado")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	closure, err := h.Queries.AcknowledgeShiftClosure(ctx, db.AcknowledgeShiftClosureParams{ID: id, AcknowledgedBy: pgtype.UUID{Bytes: user.ID, Valid: true}, AcknowledgedAt: pgtype.Timestamptz{Time: h.now(), Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		// El UPDATE solo toca cierres sin confirmar: distinguir "ya confirmado" de "no existe".
		if _, getErr := h.Queries.GetShiftClosure(ctx, id); getErr != nil {
			problemdetails.Write(w, r, 404, "not-found", "cierre no encontrado")
			return
		}
		problemdetails.Write(w, r, 409, "already-acknowledged", "el relevo ya fue confirmado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el relevo")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "shift.handover_acknowledged", audit.LevelInfo, audit.Success(), map[string]any{"closureId": id.String()})
	}
	writeData(w, 200, toShiftClosureDTO(closure).withNames(ctx, &usernames{queries: h.Queries}))
}

type shiftReportDeliveryDTO struct {
	ID         uuid.UUID  `json:"id"`
	ShiftEndAt *time.Time `json:"shiftEndAt"`
	Status     string     `json:"status"` // pending | success | failed | skipped
	Error      *string    `json:"error"`
	SentAt     *time.Time `json:"sentAt"`
	ClosedBy   string     `json:"closedBy"`
	ShiftName  *string    `json:"shiftName"`
	Recipients []string   `json:"recipients"`
}

// RecentReports es GET /api/reports/shift/recent (admin): los últimos 20
// cierres y cómo salió su reporte. Antes un envío fallido (p. ej. turno sin
// destinatarios) quedaba marcado en la base sin que nadie lo viera.
func (h *ChecklistsHandler) RecentReports(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListRecentShiftReportDeliveries(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los envíos")
		return
	}
	out := make([]shiftReportDeliveryDTO, 0, len(rows))
	for _, row := range rows {
		recipients := row.EmailRecipients
		if recipients == nil {
			recipients = []string{}
		}
		out = append(out, shiftReportDeliveryDTO{
			ID: row.ID, ShiftEndAt: timestamptzPtr(row.ShiftEndAt), Status: row.SentStatus, Error: textPtr(row.SentError),
			SentAt: timestamptzPtr(row.SentAt), ClosedBy: row.Username, ShiftName: textPtr(row.ShiftName), Recipients: recipients,
		})
	}
	writeData(w, http.StatusOK, out)
}

// ShiftStats es GET /api/shift-checks/stats?workShiftId=: las cifras del
// turno en curso (las mismas que guardará el cierre) para el popup de cierre,
// y si el usuario ya escribió su inicio o cierre de turno en la bitácora.
func (h *ChecklistsHandler) ShiftStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.URL.Query().Get("workShiftId"))
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-parameter", "workShiftId es obligatorio")
		return
	}
	shift, err := h.Queries.GetWorkShiftByID(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "turno no encontrado")
		return
	}
	start, end := shiftWindow(h.now(), shift.StartTime, shift.Timezone)
	from := pgtype.Timestamptz{Time: start, Valid: true}
	to := pgtype.Timestamptz{Time: end.Add(time.Minute), Valid: true}
	totalEntries, _ := h.Queries.CountEntriesInWindow(ctx, db.CountEntriesInWindowParams{CreatedAt: from, CreatedAt_2: to})
	totalIncidents, _ := h.Queries.CountIncidentEntriesInWindow(ctx, db.CountIncidentEntriesInWindowParams{CreatedAt: from, CreatedAt_2: to})
	resolved, _ := h.Queries.CountResolvedTicketsInWindow(ctx, db.CountResolvedTicketsInWindowParams{ResolvedAt: from, ResolvedAt_2: to})
	breaches, _ := h.Queries.CountSLABreachesInWindow(ctx, db.CountSLABreachesInWindowParams{ResolvedAt: from, ResolvedAt_2: to})
	user, _ := middleware.UserFromContext(ctx)
	written := func(tag string) *time.Time {
		at, err := h.Queries.LastTaggedEntryInWindow(ctx, db.LastTaggedEntryInWindowParams{UserID: user.ID, Tag: tag, FromAt: from, ToAt: to})
		if err != nil || !at.Valid || at.Time.Year() < 2000 {
			return nil
		}
		return &at.Time
	}
	writeData(w, 200, map[string]any{
		"shiftStartAt": start, "totalEntries": totalEntries, "totalIncidents": totalIncidents,
		"ticketsResolvedCount": resolved, "slaBreachesCount": breaches,
		"inicioWrittenAt": written("iniciodeturno"), "cierreWrittenAt": written("cierredeturno"),
	})
}
