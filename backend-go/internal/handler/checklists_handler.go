package handler

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/checklist"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChecklistsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	Crypto   *crypto.Box
	Now      func() time.Time
}

var checklistKeywordPattern = regexp.MustCompile(`[[:alnum:]]{4,}`)

func relatedChecklistTitles(left, right string) bool {
	seen := make(map[string]struct{})
	for _, word := range checklistKeywordPattern.FindAllString(strings.ToLower(left), -1) {
		seen[word] = struct{}{}
	}
	for _, word := range checklistKeywordPattern.FindAllString(strings.ToLower(right), -1) {
		if _, ok := seen[word]; ok {
			return true
		}
	}
	return false
}

func (h *ChecklistsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

type checklistItemDTO struct {
	ID           uuid.UUID  `json:"id"`
	ParentItemID *uuid.UUID `json:"parentItemId,omitempty"`
	Title        string     `json:"title"`
	ItemOrder    int32      `json:"itemOrder"`
}

type checklistTemplateDTO struct {
	ID    uuid.UUID          `json:"id"`
	Name  string             `json:"name"`
	Items []checklistItemDTO `json:"items"`
}

func toChecklistItemDTO(item db.ChecklistItem) checklistItemDTO {
	return checklistItemDTO{ID: item.ID, ParentItemID: uuidPtr(item.ParentItemID), Title: item.Title, ItemOrder: item.ItemOrder}
}

type shiftCheckServiceDTO struct {
	ID                      uuid.UUID  `json:"id"`
	ChecklistItemID         *uuid.UUID `json:"checklistItemId,omitempty"`
	ServiceTitle            string     `json:"serviceTitle"`
	Status                  string     `json:"status"`
	IsComputed              bool       `json:"isComputed"`
	Observation             *string    `json:"observation,omitempty"`
	CorrelatedFromServiceID *uuid.UUID `json:"correlatedFromServiceId,omitempty"`
}

type shiftCheckDTO struct {
	ID                  uuid.UUID              `json:"id"`
	ChecklistTemplateID uuid.UUID              `json:"checklistTemplateId"`
	UserID              uuid.UUID              `json:"userId"`
	WorkShiftID         uuid.UUID              `json:"workShiftId"`
	CheckType           string                 `json:"checkType"`
	CheckDate           time.Time              `json:"checkDate"`
	HasRedServices      bool                   `json:"hasRedServices"`
	Services            []shiftCheckServiceDTO `json:"services"`
}

func toShiftCheckServiceDTO(service db.ShiftCheckService) shiftCheckServiceDTO {
	return shiftCheckServiceDTO{ID: service.ID, ChecklistItemID: uuidPtr(service.ChecklistItemID), ServiceTitle: service.ServiceTitle, Status: string(service.Status), IsComputed: service.IsComputed, Observation: textPtr(service.Observation), CorrelatedFromServiceID: uuidPtr(service.CorrelatedFromServiceID)}
}

func (h *ChecklistsHandler) shiftCheckDTO(ctx context.Context, check db.ShiftCheck) (shiftCheckDTO, error) {
	services, err := h.Queries.ListShiftCheckServices(ctx, check.ID)
	if err != nil {
		return shiftCheckDTO{}, err
	}
	out := make([]shiftCheckServiceDTO, 0, len(services))
	for _, service := range services {
		out = append(out, toShiftCheckServiceDTO(service))
	}
	return shiftCheckDTO{ID: check.ID, ChecklistTemplateID: check.ChecklistTemplateID, UserID: check.UserID, WorkShiftID: check.WorkShiftID, CheckType: string(check.CheckType), CheckDate: check.CheckDate.Time, HasRedServices: check.HasRedServices, Services: out}, nil
}

func (h *ChecklistsHandler) ActiveTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := h.Queries.ListActiveChecklistTemplates(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar las plantillas")
		return
	}
	out := make([]checklistTemplateDTO, 0, len(templates))
	for _, template := range templates {
		items, err := h.Queries.ListChecklistItems(r.Context(), template.ID)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar los ítems")
			return
		}
		dto := checklistTemplateDTO{ID: template.ID, Name: template.Name, Items: make([]checklistItemDTO, 0, len(items))}
		for _, item := range items {
			dto.Items = append(dto.Items, toChecklistItemDTO(item))
		}
		out = append(out, dto)
	}
	writeData(w, 200, out)
}

type checkServiceRequest struct {
	ChecklistItemID uuid.UUID `json:"checklistItemId"`
	ServiceTitle    string    `json:"serviceTitle"`
	Status          string    `json:"status"`
	Observation     string    `json:"observation"`
}

type createShiftCheckRequest struct {
	ChecklistTemplateID uuid.UUID             `json:"checklistTemplateId"`
	WorkShiftID         uuid.UUID             `json:"workShiftId"`
	CheckType           string                `json:"checkType"`
	Services            []checkServiceRequest `json:"services"`
}

func (h *ChecklistsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createShiftCheckRequest
	if err := decodeJSON(w, r, &req); err != nil || req.ChecklistTemplateID == uuid.Nil || req.WorkShiftID == uuid.Nil || (req.CheckType != "inicio" && req.CheckType != "cierre") {
		problemdetails.Write(w, r, 400, "invalid-payload", "plantilla, turno, checkType y servicios son obligatorios")
		return
	}
	template, err := h.Queries.GetActiveChecklistTemplate(r.Context(), req.ChecklistTemplateID)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "plantilla no encontrada")
		return
	}
	items, err := h.Queries.ListChecklistItems(r.Context(), template.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar los ítems")
		return
	}
	itemByID := make(map[uuid.UUID]db.ChecklistItem, len(items))
	engineItems := make([]checklist.Item, 0, len(items))
	for _, item := range items {
		itemByID[item.ID] = item
		var parent *string
		if item.ParentItemID.Valid {
			value := uuid.UUID(item.ParentItemID.Bytes).String()
			parent = &value
		}
		engineItems = append(engineItems, checklist.Item{ID: item.ID.String(), ParentID: parent, Title: item.Title})
	}
	observations := make(map[string]checklist.Observation, len(req.Services))
	for _, service := range req.Services {
		item, ok := itemByID[service.ChecklistItemID]
		if !ok {
			problemdetails.Write(w, r, 400, "invalid-payload", "el ítem no pertenece a la plantilla")
			return
		}
		if service.Status != "verde" && service.Status != "rojo" {
			problemdetails.Write(w, r, 400, "invalid-payload", "estado de checklist inválido")
			return
		}
		if item.ParentItemID.Valid {
			problemdetails.Write(w, r, 400, "invalid-payload", "los ítems con subítems se calculan automáticamente")
			return
		}
		observations[item.ID.String()] = checklist.Observation{Status: checklist.Status(service.Status), Observation: strings.TrimSpace(service.Observation)}
	}
	results, err := checklist.Evaluate(engineItems, observations)
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", err.Error())
		return
	}
	latest, latestErr := h.Queries.GetLatestShiftCheck(r.Context(), req.WorkShiftID)
	if latestErr == nil && string(latest.CheckType) == req.CheckType {
		problemdetails.Write(w, r, 409, "invalid-sequence", "debes alternar entre inicio y cierre")
		return
	}
	if latestErr == nil && h.now().Sub(latest.CheckDate.Time) < time.Hour {
		problemdetails.Write(w, r, 409, "cooldown", "debes esperar una hora antes de abrir otro checklist")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	tx, err := h.Pool.Begin(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo iniciar el checklist")
		return
	}
	defer tx.Rollback(r.Context())
	queries := h.Queries.WithTx(tx)
	check, err := queries.CreateShiftCheck(r.Context(), db.CreateShiftCheckParams{ChecklistTemplateID: req.ChecklistTemplateID, UserID: user.ID, WorkShiftID: req.WorkShiftID, CheckType: db.ChecklistCheckType(req.CheckType), CheckDate: pgtype.Timestamptz{Time: h.now(), Valid: true}, HasRedServices: hasRed(results)})
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo guardar el checklist")
		return
	}
	servicesByItem := make(map[uuid.UUID]db.ShiftCheckService, len(items))
	for _, item := range items {
		result := results[item.ID.String()]
		service, err := queries.CreateShiftCheckService(r.Context(), db.CreateShiftCheckServiceParams{ShiftCheckID: check.ID, ChecklistItemID: pgtype.UUID{Bytes: item.ID, Valid: true}, ServiceTitle: item.Title, Status: db.ChecklistStatus(result.Status), IsComputed: result.IsComputed, Observation: pgtype.Text{String: result.Observation, Valid: result.Observation != ""}, CorrelatedFromServiceID: pgtype.UUID{}})
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar un ítem del checklist")
			return
		}
		servicesByItem[item.ID] = service
	}
	for _, left := range items {
		if left.ParentItemID.Valid || results[left.ID.String()].Status != checklist.Red {
			continue
		}
		for _, right := range items {
			if right.ID == left.ID || right.ParentItemID.Valid || results[right.ID.String()].Status != checklist.Red || !relatedChecklistTitles(left.Title, right.Title) {
				continue
			}
			_, err := queries.LinkCorrelatedShiftCheckService(r.Context(), db.LinkCorrelatedShiftCheckServiceParams{ID: servicesByItem[right.ID].ID, CorrelatedFromServiceID: pgtype.UUID{Bytes: servicesByItem[left.ID].ID, Valid: true}})
			if err != nil {
				problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la correlación")
				return
			}
			break
		}
	}
	redTitles := make([]string, 0)
	for _, item := range items {
		if results[item.ID.String()].Status == checklist.Red {
			redTitles = append(redTitles, item.Title)
		}
	}
	content := "Checklist " + req.CheckType + " guardado."
	if len(redTitles) > 0 {
		content += " Servicios en rojo: " + strings.Join(redTitles, ", ") + "."
	}
	if _, err := queries.CreateChecklistEntry(r.Context(), db.CreateChecklistEntryParams{UserID: user.ID, Content: content, Tags: []string{"checklist", req.CheckType}, WorkShiftID: pgtype.UUID{Bytes: req.WorkShiftID, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo inyectar el checklist en la bitácora")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el checklist")
		return
	}
	dto, err := h.shiftCheckDTO(r.Context(), check)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el checklist guardado")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "checklist.opened", audit.LevelInfo, audit.Success(), map[string]any{"checkId": check.ID.String(), "checkType": req.CheckType})
	}
	if template.AlertNokEnabled && hasRed(results) && h.Crypto != nil {
		role := db.NullUserRole{}
		if template.AlertNokRoleTarget.Valid {
			role = db.NullUserRole{UserRole: db.UserRole(template.AlertNokRoleTarget.String), Valid: true}
		}
		recipients, recipientErr := h.Queries.ListActiveUserEmailsByRole(r.Context(), role)
		if recipientErr == nil && len(recipients) > 0 {
			if sender, _, mailErr := buildMailSender(r.Context(), h.Queries, h.Crypto); mailErr == nil {
				_ = sender.SendMany(recipients, nil, "Checklist NOK - "+template.Name, content)
			}
		}
	}
	writeData(w, 201, dto)
}

func hasRed(results map[string]checklist.Result) bool {
	for _, result := range results {
		if result.Status == checklist.Red {
			return true
		}
	}
	return false
}

func (h *ChecklistsHandler) List(w http.ResponseWriter, r *http.Request) {
	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	params := db.ListShiftChecksParams{PageSize: 50, PageOffset: int32((page - 1) * 50)}
	if id, err := uuid.Parse(r.URL.Query().Get("workShiftId")); err == nil {
		params.WorkShiftID = pgtype.UUID{Bytes: id, Valid: true}
	}
	checks, err := h.Queries.ListShiftChecks(r.Context(), params)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron listar los checklists")
		return
	}
	out := make([]shiftCheckDTO, 0, len(checks))
	for _, check := range checks {
		dto, err := h.shiftCheckDTO(r.Context(), check)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar un checklist")
			return
		}
		out = append(out, dto)
	}
	writeData(w, 200, out)
}

type closeShiftRequest struct {
	ClosureCheckID      uuid.UUID `json:"closureCheckId"`
	Observations        string    `json:"observations"`
	PendingForNextShift string    `json:"pendingForNextShift"`
	NotifyEmail         bool      `json:"notifyEmail"`
	SyncGLPI            bool      `json:"syncGlpi"`
}

func (h *ChecklistsHandler) Abandoned(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		CheckID *uuid.UUID `json:"checkId"`
	}
	if err := decodeJSON(w, r, &payload); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	metadata := map[string]any{}
	if payload.CheckID != nil {
		metadata["checkId"] = payload.CheckID.String()
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "checklist.abandoned", audit.LevelInfo, audit.Success(), metadata)
	}
	writeNoContent(w)
}

func (h *ChecklistsHandler) Close(w http.ResponseWriter, r *http.Request) {
	var req closeShiftRequest
	if err := decodeJSON(w, r, &req); err != nil || req.ClosureCheckID == uuid.Nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "closureCheckId es obligatorio")
		return
	}
	check, err := h.Queries.GetShiftCheck(r.Context(), req.ClosureCheckID)
	if err != nil || check.CheckType != db.ChecklistCheckTypeCierre {
		problemdetails.Write(w, r, 400, "invalid-payload", "el check de cierre no es válido")
		return
	}
	services, err := h.Queries.ListShiftCheckServices(r.Context(), check.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar los servicios")
		return
	}
	start := check.CheckDate.Time.Add(-8 * time.Hour)
	end := check.CheckDate.Time
	from := pgtype.Timestamptz{Time: start, Valid: true}
	to := pgtype.Timestamptz{Time: end, Valid: true}
	totalEntries, _ := h.Queries.CountEntriesInWindow(r.Context(), db.CountEntriesInWindowParams{CreatedAt: from, CreatedAt_2: to})
	totalIncidents, _ := h.Queries.CountIncidentEntriesInWindow(r.Context(), db.CountIncidentEntriesInWindowParams{CreatedAt: from, CreatedAt_2: to})
	resolved, _ := h.Queries.CountResolvedTicketsInWindow(r.Context(), db.CountResolvedTicketsInWindowParams{ResolvedAt: from, ResolvedAt_2: to})
	breaches, _ := h.Queries.CountSLABreachesInWindow(r.Context(), db.CountSLABreachesInWindowParams{ResolvedAt: from, ResolvedAt_2: to})
	servicesDown := make([]string, 0)
	for _, service := range services {
		if service.Status == db.ChecklistStatusRojo {
			servicesDown = append(servicesDown, service.ServiceTitle)
		}
	}
	user, _ := middleware.UserFromContext(r.Context())
	closure, err := h.Queries.CreateShiftClosure(r.Context(), db.CreateShiftClosureParams{UserID: user.ID, ShiftStartAt: pgtype.Timestamptz{Time: start, Valid: true}, ShiftEndAt: pgtype.Timestamptz{Time: end, Valid: true}, ClosureCheckID: check.ID, TotalEntries: int32(totalEntries), TotalIncidents: int32(totalIncidents), ServicesDown: servicesDown, Observations: pgtype.Text{String: strings.TrimSpace(req.Observations), Valid: strings.TrimSpace(req.Observations) != ""}, PendingForNextShift: pgtype.Text{String: strings.TrimSpace(req.PendingForNextShift), Valid: strings.TrimSpace(req.PendingForNextShift) != ""}, TicketsResolvedCount: int32(resolved), SlaBreachesCount: int32(breaches)})
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo crear el cierre")
		return
	}
	if req.SyncGLPI {
		problemdetails.Write(w, r, 409, "integration-unavailable", "la sincronización GLPI sigue fuera del corte inicial")
		return
	}
	if req.NotifyEmail && h.Crypto != nil {
		recipients, recipientErr := h.Queries.ListActiveUserEmailsByRole(r.Context(), db.NullUserRole{})
		if recipientErr != nil || len(recipients) == 0 {
			_ = h.Queries.MarkShiftClosureSent(r.Context(), db.MarkShiftClosureSentParams{ID: closure.ID, SentVia: "email", SentStatus: "failed", SentError: pgtype.Text{String: "no hay destinatarios activos", Valid: true}})
		} else if sender, _, mailErr := buildMailSender(r.Context(), h.Queries, h.Crypto); mailErr != nil || sender.SendMany(recipients, nil, "Cierre de turno", "Pendientes:\n"+req.PendingForNextShift+"\n\nObservaciones:\n"+req.Observations) != nil {
			_ = h.Queries.MarkShiftClosureSent(r.Context(), db.MarkShiftClosureSentParams{ID: closure.ID, SentVia: "email", SentStatus: "failed", SentError: pgtype.Text{String: "falló el envío SMTP", Valid: true}})
		} else {
			_ = h.Queries.MarkShiftClosureSent(r.Context(), db.MarkShiftClosureSentParams{ID: closure.ID, SentVia: "email", SentStatus: "success", SentError: pgtype.Text{}})
		}
	}
	writeData(w, 201, closure)
}

func (h *ChecklistsHandler) Handover(w http.ResponseWriter, r *http.Request) {
	previous, err := h.Queries.GetLatestShiftClosure(r.Context())
	if err != nil && err != pgx.ErrNoRows {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el cierre anterior")
		return
	}
	previousExists := err == nil
	now := h.now()
	windows, maintenanceErr := h.Queries.ListUpcomingMaintenanceWindows(r.Context(), db.ListUpcomingMaintenanceWindowsParams{EndsAt: pgtype.Timestamptz{Time: now, Valid: true}, StartsAt: pgtype.Timestamptz{Time: now.Add(4 * time.Hour), Valid: true}})
	if maintenanceErr != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar mantenimientos")
		return
	}
	var previousValue any
	if previousExists {
		previousValue = previous
	}
	var teamID pgtype.UUID
	if raw := r.URL.Query().Get("teamId"); raw != "" {
		if parsed, parseErr := uuid.Parse(raw); parseErr == nil {
			teamID = pgtype.UUID{Bytes: parsed, Valid: true}
		}
	}
	onCallRows, err := h.Queries.ListHandoverOnCall(r.Context(), db.ListHandoverOnCallParams{Today: pgtype.Date{Time: now, Valid: true}, TeamID: teamID})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar la guardia activa")
		return
	}
	onCall := make([]map[string]any, 0, len(onCallRows))
	for _, row := range onCallRows {
		onCall = append(onCall, map[string]any{"teamId": row.TeamID, "teamName": row.TeamName, "onCallMember": row.OnCallMember})
	}
	writeData(w, 200, map[string]any{"previousClosure": previousValue, "upcomingMaintenanceWindows": windows, "onCallSummary": onCall})
}

func (h *ChecklistsHandler) Acknowledge(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "cierre no encontrado")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	closure, err := h.Queries.AcknowledgeShiftClosure(r.Context(), db.AcknowledgeShiftClosureParams{ID: id, AcknowledgedBy: pgtype.UUID{Bytes: user.ID, Valid: true}, AcknowledgedAt: pgtype.Timestamptz{Time: h.now(), Valid: true}})
	if err == pgx.ErrNoRows {
		problemdetails.Write(w, r, 409, "already-acknowledged", "el relevo ya fue confirmado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "cierre no encontrado")
		return
	}
	writeData(w, 200, closure)
}
