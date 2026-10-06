package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/checklist"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Administración de plantillas de checklist (pantalla aprobada
// "Administración: Checklist", del legacy checklist-admin): editor de ítems
// y sub-ítems, en qué turno y momento se usa cada plantilla, alerta NOK y la
// espera mínima entre checks.

// defaultChecklistCooldownMinutes: la migración 000009 lo deja en 60, lo
// mismo que el backend aplicaba fijo antes de hacerlo configurable.
const defaultChecklistCooldownMinutes = 60

type templateAssignmentDTO struct {
	WorkShiftID uuid.UUID `json:"workShiftId"`
	Moment      string    `json:"moment"`
}

type adminChecklistTemplateDTO struct {
	ID              uuid.UUID               `json:"id"`
	Name            string                  `json:"name"`
	IsActive        bool                    `json:"isActive"`
	AlertNokEnabled bool                    `json:"alertNokEnabled"`
	AlertNokCargos  []string                `json:"alertNokCargos"`
	Items           []checklistItemDTO      `json:"items"`
	Assignments     []templateAssignmentDTO `json:"assignments"`
	ChecksCount     int64                   `json:"checksCount"`
}

func templateAssignments(shifts []db.WorkShift, templateID uuid.UUID) []templateAssignmentDTO {
	out := make([]templateAssignmentDTO, 0)
	for _, shift := range shifts {
		if shift.ChecklistTemplateStartID.Valid && uuid.UUID(shift.ChecklistTemplateStartID.Bytes) == templateID {
			out = append(out, templateAssignmentDTO{WorkShiftID: shift.ID, Moment: "inicio"})
		}
		if shift.ChecklistTemplateEndID.Valid && uuid.UUID(shift.ChecklistTemplateEndID.Bytes) == templateID {
			out = append(out, templateAssignmentDTO{WorkShiftID: shift.ID, Moment: "cierre"})
		}
	}
	return out
}

func (h *ChecklistsHandler) adminTemplateDTO(ctx context.Context, template db.ChecklistTemplate, shifts []db.WorkShift) (adminChecklistTemplateDTO, error) {
	items, err := h.Queries.ListChecklistItems(ctx, template.ID)
	if err != nil {
		return adminChecklistTemplateDTO{}, err
	}
	checks, err := h.Queries.CountShiftChecksForTemplate(ctx, template.ID)
	if err != nil {
		return adminChecklistTemplateDTO{}, err
	}
	dto := adminChecklistTemplateDTO{
		ID: template.ID, Name: template.Name, IsActive: template.IsActive, AlertNokEnabled: template.AlertNokEnabled,
		AlertNokCargos: nonNilStrings(template.AlertNokCargos), Items: make([]checklistItemDTO, 0, len(items)),
		Assignments: templateAssignments(shifts, template.ID), ChecksCount: checks,
	}
	for _, item := range items {
		dto.Items = append(dto.Items, toChecklistItemDTO(item))
	}
	return dto, nil
}

// ListTemplates: todas las plantillas (activas primero) con sus ítems, dónde
// se usan y cuántos checks tienen (con historial no se borran, se desactivan).
func (h *ChecklistsHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	templates, err := h.Queries.ListChecklistTemplates(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar las plantillas")
		return
	}
	shifts, err := h.Queries.ListWorkShifts(ctx, pgtype.Bool{})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron cargar los turnos")
		return
	}
	out := make([]adminChecklistTemplateDTO, 0, len(templates))
	for _, template := range templates {
		dto, err := h.adminTemplateDTO(ctx, template, shifts)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar una plantilla")
			return
		}
		out = append(out, dto)
	}
	writeData(w, 200, out)
}

type templateItemRequest struct {
	Key       string `json:"key"`
	ParentKey string `json:"parentKey"`
	Title     string `json:"title"`
}

type saveTemplateRequest struct {
	Name            string                  `json:"name"`
	IsActive        bool                    `json:"isActive"`
	AlertNokEnabled bool                    `json:"alertNokEnabled"`
	AlertNokCargos  []string                `json:"alertNokCargos"`
	Items           []templateItemRequest   `json:"items"`
	Assignments     []templateAssignmentDTO `json:"assignments"`
}

// cargos normaliza los cargos de la alerta NOK (normalizeCargoLabels del legacy).
func (req saveTemplateRequest) cargos() []string {
	out := []string{}
	seen := map[string]bool{}
	for _, c := range req.AlertNokCargos {
		c = strings.TrimSpace(c)
		if c != "" && !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

func (req saveTemplateRequest) validate() ([]checklist.TemplateItem, error) {
	items := make([]checklist.TemplateItem, 0, len(req.Items))
	for _, item := range req.Items {
		items = append(items, checklist.TemplateItem{Key: item.Key, ParentKey: item.ParentKey, Title: item.Title})
	}
	valid, err := checklist.ValidateTemplate(req.Name, items)
	if err != nil {
		return nil, err
	}
	cargos := req.cargos()
	if req.AlertNokEnabled && len(cargos) == 0 {
		return nil, errors.New("la alerta NOK necesita al menos un cargo a quien avisar")
	}
	if len(cargos) > 20 {
		return nil, errors.New("la alerta NOK avisa a hasta 20 cargos")
	}
	for _, c := range cargos {
		if len([]rune(c)) > 80 {
			return nil, errors.New("cargo inválido (hasta 80 caracteres)")
		}
	}
	for _, assignment := range req.Assignments {
		if assignment.WorkShiftID == uuid.Nil || (assignment.Moment != "inicio" && assignment.Moment != "cierre") {
			return nil, errors.New("asignación a turno inválida")
		}
	}
	return valid, nil
}

func (h *ChecklistsHandler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	h.saveTemplate(w, r, uuid.Nil)
}

func (h *ChecklistsHandler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "plantilla no encontrada")
		return
	}
	h.saveTemplate(w, r, id)
}

// saveTemplate crea (id == uuid.Nil) o reemplaza una plantilla completa en
// una transacción. Los ítems existentes conservan su id — así el historial
// sigue sabiendo "cuántas veces estuvo en rojo este ítem" aunque se renombre
// o se mueva —; los que se quitan se borran y sus checks pasados quedan con
// el nombre guardado.
func (h *ChecklistsHandler) saveTemplate(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	var req saveTemplateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	items, err := req.validate()
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", err.Error())
		return
	}
	cargos := req.cargos()
	ctx := r.Context()
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la plantilla")
		return
	}
	defer tx.Rollback(ctx)
	queries := h.Queries.WithTx(tx)

	var template db.ChecklistTemplate
	existing := map[uuid.UUID]bool{}
	if id == uuid.Nil {
		template, err = queries.CreateChecklistTemplate(ctx, db.CreateChecklistTemplateParams{Name: req.Name, IsActive: req.IsActive, AlertNokEnabled: req.AlertNokEnabled, AlertNokCargos: cargos})
	} else {
		template, err = queries.UpdateChecklistTemplate(ctx, db.UpdateChecklistTemplateParams{ID: id, Name: req.Name, IsActive: req.IsActive, AlertNokEnabled: req.AlertNokEnabled, AlertNokCargos: cargos})
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, 404, "not-found", "plantilla no encontrada")
			return
		}
		if err == nil {
			current, listErr := queries.ListChecklistItems(ctx, id)
			err = listErr
			for _, item := range current {
				existing[item.ID] = true
			}
		}
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la plantilla")
		return
	}
	template.Name = req.Name

	// Clave del editor → id real: un id existente de ESTA plantilla se
	// conserva; cualquier otra clave (temporal o ajena) es un ítem nuevo.
	ids := make(map[string]uuid.UUID, len(items))
	for _, item := range items {
		if parsed, parseErr := uuid.Parse(item.Key); parseErr == nil && existing[parsed] {
			ids[item.Key] = parsed
		} else {
			ids[item.Key] = uuid.New()
		}
	}
	keep := make([]uuid.UUID, 0, len(items))
	for order, item := range items {
		itemID := ids[item.Key]
		parent := pgtype.UUID{}
		if item.ParentKey != "" {
			parent = pgtype.UUID{Bytes: ids[item.ParentKey], Valid: true}
		}
		if existing[itemID] {
			err = queries.UpdateChecklistItem(ctx, db.UpdateChecklistItemParams{ID: itemID, TemplateID: template.ID, Title: item.Title, ItemOrder: int32(order), ParentItemID: parent})
		} else {
			err = queries.InsertChecklistItem(ctx, db.InsertChecklistItemParams{ID: itemID, TemplateID: template.ID, Title: item.Title, ItemOrder: int32(order), ParentItemID: parent})
		}
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar un ítem")
			return
		}
		keep = append(keep, itemID)
	}
	if err := queries.DeleteChecklistItemsExcept(ctx, db.DeleteChecklistItemsExceptParams{TemplateID: template.ID, KeepIds: keep}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron quitar los ítems eliminados")
		return
	}

	// Cada turno tiene UNA plantilla por momento: asignar esta reemplaza a la anterior.
	if err := queries.ClearTemplateFromShifts(ctx, pgtype.UUID{Bytes: template.ID, Valid: true}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo actualizar la asignación a turnos")
		return
	}
	value := pgtype.UUID{Bytes: template.ID, Valid: true}
	for _, assignment := range req.Assignments {
		if assignment.Moment == "inicio" {
			err = queries.AssignShiftStartTemplate(ctx, db.AssignShiftStartTemplateParams{ID: assignment.WorkShiftID, ChecklistTemplateStartID: value})
		} else {
			err = queries.AssignShiftEndTemplate(ctx, db.AssignShiftEndTemplateParams{ID: assignment.WorkShiftID, ChecklistTemplateEndID: value})
		}
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo asignar la plantilla al turno")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar la plantilla")
		return
	}

	shifts, err := h.Queries.ListWorkShifts(ctx, pgtype.Bool{})
	if err == nil {
		template, err = h.Queries.GetChecklistTemplate(ctx, template.ID)
	}
	var dto adminChecklistTemplateDTO
	if err == nil {
		dto, err = h.adminTemplateDTO(ctx, template, shifts)
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "la plantilla se guardó pero no se pudo recargar")
		return
	}
	status, action := 200, "checklist_template.update"
	if id == uuid.Nil {
		status, action = 201, "checklist_template.create"
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, action, audit.LevelInfo, audit.Success(), map[string]any{"templateId": template.ID.String(), "items": len(items), "active": req.IsActive})
	}
	writeData(w, status, dto)
}

// DeleteTemplate solo borra plantillas que nunca se usaron: con historial,
// 409 — la pantalla ofrece desactivarla.
func (h *ChecklistsHandler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "plantilla no encontrada")
		return
	}
	ctx := r.Context()
	if _, err := h.Queries.GetChecklistTemplate(ctx, id); err != nil {
		problemdetails.Write(w, r, 404, "not-found", "plantilla no encontrada")
		return
	}
	checks, err := h.Queries.CountShiftChecksForTemplate(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo revisar el historial")
		return
	}
	if checks > 0 {
		problemdetails.Write(w, r, 409, "template-in-use", "la plantilla tiene checks en el historial: desactívala en vez de borrarla")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo borrar la plantilla")
		return
	}
	defer tx.Rollback(ctx)
	queries := h.Queries.WithTx(tx)
	if err := queries.ClearTemplateFromShifts(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo quitar la plantilla de los turnos")
		return
	}
	if err := queries.DeleteChecklistItemsExcept(ctx, db.DeleteChecklistItemsExceptParams{TemplateID: id, KeepIds: []uuid.UUID{}}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron borrar los ítems")
		return
	}
	if err := queries.DeleteChecklistTemplate(ctx, id); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo borrar la plantilla")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el borrado")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "checklist_template.delete", audit.LevelWarn, audit.Success(), map[string]any{"templateId": id.String()})
	}
	writeNoContent(w)
}

// cooldownMinutes: espera mínima entre checks del mismo turno (app_config).
func (h *ChecklistsHandler) cooldownMinutes(ctx context.Context) int32 {
	minutes, err := h.Queries.GetChecklistCooldown(ctx)
	if err != nil {
		return defaultChecklistCooldownMinutes
	}
	return minutes
}

func (h *ChecklistsHandler) GetChecklistConfig(w http.ResponseWriter, r *http.Request) {
	writeData(w, 200, map[string]any{"cooldownMinutes": h.cooldownMinutes(r.Context())})
}

func (h *ChecklistsHandler) PutChecklistConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CooldownMinutes *int32 `json:"cooldownMinutes"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.CooldownMinutes == nil || *req.CooldownMinutes < 0 || *req.CooldownMinutes > 1440 {
		problemdetails.Write(w, r, 400, "invalid-payload", "cooldownMinutes debe estar entre 0 y 1440")
		return
	}
	minutes, err := h.Queries.SetChecklistCooldown(r.Context(), *req.CooldownMinutes)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la configuración")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "checklist_config.update", audit.LevelInfo, audit.Success(), map[string]any{"cooldownMinutes": minutes})
	}
	writeData(w, 200, map[string]any{"cooldownMinutes": minutes})
}
