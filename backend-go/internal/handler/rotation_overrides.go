package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Editar y borrar un reemplazo de guardia (paridad con el legacy:
// /escalation/admin/overrides tenía el CRUD completo; decisión del dueño
// 2026-10-16). Mismo permiso que crearlo: la jefatura del área de la guardia
// o el admin.

// overrideFor lee el reemplazo del path y revisa que el usuario maneje su guardia.
func (h *RotationHandler) overrideFor(w http.ResponseWriter, r *http.Request) (db.RotationOverride, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "reemplazo no encontrado")
		return db.RotationOverride{}, false
	}
	o, err := h.Queries.GetRotationOverride(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "reemplazo no encontrado")
		return o, false
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el reemplazo")
		return o, false
	}
	cycle, err := h.Queries.GetGuardCycle(r.Context(), o.CycleID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la guardia")
		return o, false
	}
	acc, ok := mustLoadAreaAccess(w, r, h.Queries)
	if !ok || !requireManage(w, r, acc, acc.code(cycle.AreaID)) {
		return o, false
	}
	return o, true
}

// UpdateOverride: PUT /api/rotation-overrides/{id} {replacementTeamMemberId, startDate, endDate, reason}.
func (h *RotationHandler) UpdateOverride(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ReplacementTeamMemberID uuid.UUID `json:"replacementTeamMemberId"`
		StartDate               time.Time `json:"startDate"`
		EndDate                 time.Time `json:"endDate"`
		Reason                  string    `json:"reason"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.ReplacementTeamMemberID == uuid.Nil || req.Reason == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige quién reemplaza y escribe el motivo")
		return
	}
	if !req.EndDate.After(req.StartDate) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el término debe ser posterior al inicio")
		return
	}
	o, ok := h.overrideFor(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	updated, err := h.Queries.UpdateRotationOverride(ctx, db.UpdateRotationOverrideParams{
		ID: o.ID, ReplacementTeamMemberID: req.ReplacementTeamMemberID, Reason: req.Reason,
		StartDate: pgtype.Timestamptz{Time: req.StartDate, Valid: true}, EndDate: pgtype.Timestamptz{Time: req.EndDate, Valid: true},
	})
	if err != nil {
		// Sin fila: el reemplazante no es de esa guardia (lo filtra el UPDATE).
		if errors.Is(err, pgx.ErrNoRows) || isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "esa persona no es de la guardia")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el reemplazo")
		return
	}
	h.AuditLog.Log(ctx, "rotation.override.updated", audit.LevelInfo, audit.Success(), map[string]any{
		"overrideId": o.ID.String(), "cycleId": o.CycleID.String(), "from": o.StartDate.Time, "to": o.EndDate.Time,
		"newFrom": req.StartDate, "newTo": req.EndDate})
	writeData(w, http.StatusOK, toRotationOverrideDTO(updated))
}

// DeleteOverride: DELETE /api/rotation-overrides/{id}.
func (h *RotationHandler) DeleteOverride(w http.ResponseWriter, r *http.Request) {
	o, ok := h.overrideFor(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if _, err := h.Queries.DeleteRotationOverride(ctx, o.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el reemplazo")
		return
	}
	h.AuditLog.Log(ctx, "rotation.override.deleted", audit.LevelInfo, audit.Success(), map[string]any{
		"overrideId": o.ID.String(), "cycleId": o.CycleID.String(), "from": o.StartDate.Time, "to": o.EndDate.Time, "reason": o.Reason})
	writeNoContent(w)
}
