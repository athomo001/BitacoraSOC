package handler

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/checklist"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"

	"github.com/google/uuid"
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
	Username            string                 `json:"username"`
	WorkShiftID         uuid.UUID              `json:"workShiftId"`
	CheckType           string                 `json:"checkType"`
	CheckDate           time.Time              `json:"checkDate"`
	HasRedServices      bool                   `json:"hasRedServices"`
	Services            []shiftCheckServiceDTO `json:"services"`
}

func toShiftCheckServiceDTO(service db.ShiftCheckService) shiftCheckServiceDTO {
	return shiftCheckServiceDTO{ID: service.ID, ChecklistItemID: uuidPtr(service.ChecklistItemID), ServiceTitle: service.ServiceTitle, Status: string(service.Status), IsComputed: service.IsComputed, Observation: textPtr(service.Observation), CorrelatedFromServiceID: uuidPtr(service.CorrelatedFromServiceID)}
}

// usernames resuelve y memoriza nombres de usuario: el historial y el relevo
// muestran "quién", no un UUID.
type usernames struct {
	queries *db.Queries
	cache   map[uuid.UUID]string
}

func (u *usernames) name(ctx context.Context, id uuid.UUID) string {
	if name, ok := u.cache[id]; ok {
		return name
	}
	name := ""
	if user, err := u.queries.GetUserByID(ctx, id); err == nil {
		name = user.Username
	}
	if u.cache == nil {
		u.cache = make(map[uuid.UUID]string)
	}
	u.cache[id] = name
	return name
}

func (h *ChecklistsHandler) shiftCheckDTO(ctx context.Context, check db.ShiftCheck) (shiftCheckDTO, error) {
	return h.shiftCheckDTOWith(ctx, check, &usernames{queries: h.Queries})
}

func (h *ChecklistsHandler) shiftCheckDTOWith(ctx context.Context, check db.ShiftCheck, names *usernames) (shiftCheckDTO, error) {
	services, err := h.Queries.ListShiftCheckServices(ctx, check.ID)
	if err != nil {
		return shiftCheckDTO{}, err
	}
	out := make([]shiftCheckServiceDTO, 0, len(services))
	for _, service := range services {
		out = append(out, toShiftCheckServiceDTO(service))
	}
	return shiftCheckDTO{ID: check.ID, ChecklistTemplateID: check.ChecklistTemplateID, UserID: check.UserID, Username: names.name(ctx, check.UserID), WorkShiftID: check.WorkShiftID, CheckType: string(check.CheckType), CheckDate: check.CheckDate.Time, HasRedServices: check.HasRedServices, Services: out}, nil
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
	groups := checklist.Groups(engineItems)
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
		// Un grupo (ítem CON sub-ítems) se calcula; una hoja con padre sí se
		// evalúa a mano (antes se rechazaba por tener padre y ninguna
		// plantilla jerárquica se podía guardar).
		if groups[item.ID.String()] {
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
	cooldown := time.Duration(h.cooldownMinutes(r.Context())) * time.Minute
	if latestErr == nil && h.now().Sub(latest.CheckDate.Time) < cooldown {
		wait := cooldown - h.now().Sub(latest.CheckDate.Time)
		problemdetails.Write(w, r, 409, "cooldown", fmt.Sprintf("debes esperar %d min más antes de abrir otro checklist de este turno", int(wait.Minutes())+1))
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
	for itemID, fromID := range checklist.Correlate(engineItems, results) {
		service := servicesByItem[uuid.MustParse(itemID)]
		from := servicesByItem[uuid.MustParse(fromID)]
		if _, err := queries.LinkCorrelatedShiftCheckService(r.Context(), db.LinkCorrelatedShiftCheckServiceParams{ID: service.ID, CorrelatedFromServiceID: pgtype.UUID{Bytes: from.ID, Valid: true}}); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la correlación")
			return
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
		h.sendNokAlert(r.Context(), template, check, user.Username, items, results)
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
	names := &usernames{queries: h.Queries}
	out := make([]shiftCheckDTO, 0, len(checks))
	for _, check := range checks {
		dto, err := h.shiftCheckDTOWith(r.Context(), check, names)
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

// sendNokAlert es la alerta "checklist con ítems NOK" del legacy: a los
// usuarios activos con los cargos de la plantilla, con cada servicio en rojo
// y su observación. Un fallo de correo no frena el checklist (queda en
// auditoría).
func (h *ChecklistsHandler) sendNokAlert(ctx context.Context, template db.ChecklistTemplate, check db.ShiftCheck, username string, items []db.ChecklistItem, results map[string]checklist.Result) {
	recipients, err := h.Queries.ListActiveUserEmailsByCargo(ctx, template.AlertNokCargos)
	if err != nil || len(recipients) == 0 {
		return
	}
	var services []mailtpl.NokService
	for _, item := range items {
		if res := results[item.ID.String()]; res.Status == checklist.Red {
			services = append(services, mailtpl.NokService{Title: item.Title, Observation: res.Observation})
		}
	}
	shiftName := ""
	if shift, err := h.Queries.GetWorkShiftByID(ctx, check.WorkShiftID); err == nil {
		shiftName = shift.Name
	}
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		loc = time.Local
	}
	m := mailtpl.ChecklistNok(branding.Title(ctx, h.Queries), username, shiftName, string(check.CheckType), template.AlertNokCargos, services, check.CheckDate.Time.In(loc))
	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err == nil {
		err = sender.SendHTML(recipients, nil, m.Subject, m.HTML)
	}
	if h.AuditLog == nil {
		return
	}
	meta := map[string]any{"checkId": check.ID.String(), "checkType": string(check.CheckType), "recipientsCount": len(recipients), "cargoTargets": template.AlertNokCargos, "redCount": len(services)}
	if err != nil {
		h.AuditLog.Log(ctx, "shiftcheck.nok.alert.fail", audit.LevelWarn, audit.Failure(err.Error()), meta)
		return
	}
	h.AuditLog.Log(ctx, "shiftcheck.nok.alert.sent", audit.LevelInfo, audit.Success(), meta)
}
