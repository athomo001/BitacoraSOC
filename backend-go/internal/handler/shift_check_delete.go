package handler

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DeleteCheck: DELETE /api/shift-checks/{id} {reason} (admin). Borra un
// checklist del historial, como el legacy (DELETE /checklist/check/:id;
// decisión del dueño 2026-10-16: solo el admin, con motivo y en Auditoría).
// La foto completa del checklist (quién, cuándo, cada servicio con su estado
// y observación) queda en el registro de Auditoría. El checklist de cierre de
// un turno ya cerrado no se borra: el cierre y su reporte lo usan.
func (h *ChecklistsHandler) DeleteCheck(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "checklist no encontrado")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" || utf8.RuneCountInString(req.Reason) > 500 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el motivo es obligatorio (hasta 500 caracteres)")
		return
	}
	check, err := h.Queries.GetShiftCheck(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "checklist no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el checklist")
		return
	}
	closures, err := h.Queries.CountClosuresForCheck(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo revisar el cierre de turno")
		return
	}
	if closures > 0 {
		problemdetails.Write(w, r, http.StatusConflict, "closure-check", "es el checklist de un cierre de turno ya enviado: no se puede borrar")
		return
	}
	services, err := h.Queries.ListShiftCheckServices(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el checklist")
		return
	}
	snapshot := make([]map[string]any, 0, len(services))
	for _, s := range services {
		item := map[string]any{"service": s.ServiceTitle, "status": string(s.Status)}
		if s.Observation.Valid {
			item["observation"] = s.Observation.String
		}
		snapshot = append(snapshot, item)
	}
	if _, err := h.Queries.DeleteShiftCheck(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el checklist")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	h.AuditLog.Log(ctx, "shiftcheck.delete", audit.LevelWarn, audit.Success(), map[string]any{
		"checkId": id.String(), "type": string(check.CheckType), "checkDate": check.CheckDate.Time, "userId": check.UserID.String(),
		"workShiftId": check.WorkShiftID.String(), "hadRed": check.HasRedServices, "reason": req.Reason, "deletedBy": actor.ID.String(),
		"services": snapshot,
	})
	writeNoContent(w)
}
