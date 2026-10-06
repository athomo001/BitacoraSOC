package handler

import (
	"net/http"
	"slices"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"

	"github.com/google/uuid"
)

// WorkShiftMembersHandler son las personas del turno (WorkShiftAssignment
// del legacy): quién trabaja en cada turno y qué días. A ellas les llegan
// los recordatorios de turno.
type WorkShiftMembersHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

type workShiftMemberDTO struct {
	UserID      uuid.UUID `json:"userId"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	Weekdays    []int32   `json:"weekdays"`
	UserActive  bool      `json:"userActive"`
}

// List es GET /api/work-shifts/{id}/members (admin).
func (h *WorkShiftMembersHandler) List(w http.ResponseWriter, r *http.Request) {
	shift, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "turno no encontrado")
		return
	}
	rows, err := h.Queries.ListWorkShiftMembers(r.Context(), shift)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las personas del turno")
		return
	}
	out := make([]workShiftMemberDTO, 0, len(rows))
	for _, m := range rows {
		out = append(out, workShiftMemberDTO{UserID: m.UserID, Username: m.Username, DisplayName: m.DisplayName, Weekdays: m.Weekdays, UserActive: m.UserActive})
	}
	writeData(w, http.StatusOK, out)
}

// Put es PUT /api/work-shifts/{id}/members/{userId} (admin): agrega a la
// persona o cambia sus días.
func (h *WorkShiftMembersHandler) Put(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	shift, err1 := uuid.Parse(r.PathValue("id"))
	user, err2 := uuid.Parse(r.PathValue("userId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "turno o persona no encontrados")
		return
	}
	var req struct {
		Weekdays []int32 `json:"weekdays"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	days := []int32{}
	for _, d := range req.Weekdays {
		if d < 0 || d > 6 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "los días van de 0 (domingo) a 6 (sábado)")
			return
		}
		if !slices.Contains(days, d) {
			days = append(days, d)
		}
	}
	if len(days) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige al menos un día")
		return
	}
	slices.Sort(days)
	if _, err := h.Queries.UpsertWorkShiftMember(ctx, db.UpsertWorkShiftMemberParams{WorkShiftID: shift, UserID: user, Weekdays: days}); err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "turno o persona no encontrados")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	h.AuditLog.Log(ctx, "work_shift.member.saved", audit.LevelInfo, audit.Success(), map[string]any{"workShiftId": shift.String(), "userId": user.String(), "weekdays": days})
	w.WriteHeader(http.StatusNoContent)
}

// Delete es DELETE /api/work-shifts/{id}/members/{userId} (admin).
func (h *WorkShiftMembersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	shift, err1 := uuid.Parse(r.PathValue("id"))
	user, err2 := uuid.Parse(r.PathValue("userId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "turno o persona no encontrados")
		return
	}
	n, err := h.Queries.DeleteWorkShiftMember(ctx, db.DeleteWorkShiftMemberParams{WorkShiftID: shift, UserID: user})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo quitar")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "esa persona no está en el turno")
		return
	}
	h.AuditLog.Log(ctx, "work_shift.member.removed", audit.LevelInfo, audit.Success(), map[string]any{"workShiftId": shift.String(), "userId": user.String()})
	w.WriteHeader(http.StatusNoContent)
}
