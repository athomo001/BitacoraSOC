package handler

import (
	"context"
	"fmt"
	"net/http"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Largo mínimo de contraseña: lo fija el admin (pedido del dueño
// 2026-10-07); 6 por defecto, igual que el legacy.
const (
	defaultPasswordMinLength = 6
	passwordMinLengthFloor   = 4
	passwordMinLengthCeil    = 64
)

// passwordMinLength lee el mínimo vigente; sin fila de app_config, el de
// por defecto.
func passwordMinLength(ctx context.Context, q *db.Queries) int {
	n, err := q.GetPasswordMinLength(ctx)
	if err != nil {
		return defaultPasswordMinLength
	}
	return int(n)
}

// rejectShortPassword responde 400 "weak-password" si la contraseña no llega
// al mínimo. Se usa en todo lugar donde alguien fija una contraseña: cambio
// propio, reseteo por correo y alta de usuario.
func rejectShortPassword(w http.ResponseWriter, r *http.Request, q *db.Queries, password string) bool {
	minLen := passwordMinLength(r.Context(), q)
	if utf8.RuneCountInString(password) >= minLen {
		return false
	}
	problemdetails.Write(w, r, http.StatusBadRequest, "weak-password", fmt.Sprintf("la contraseña debe tener al menos %d caracteres", minLen))
	return true
}

type PasswordPolicyHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

// Get es público: lo leen el perfil, el cambio obligatorio y el reseteo por
// correo (este último sin sesión) para avisar el mínimo antes de enviar.
func (h *PasswordPolicyHandler) Get(w http.ResponseWriter, r *http.Request) {
	writeData(w, http.StatusOK, map[string]any{"minLength": passwordMinLength(r.Context(), h.Queries)})
}

func (h *PasswordPolicyHandler) Update(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		MinLength *int `json:"minLength"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.MinLength == nil || *req.MinLength < passwordMinLengthFloor || *req.MinLength > passwordMinLengthCeil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", fmt.Sprintf("minLength debe estar entre %d y %d", passwordMinLengthFloor, passwordMinLengthCeil))
		return
	}
	before := passwordMinLength(ctx, h.Queries)
	_ = h.Queries.EnsureAppConfigRow(ctx)
	n, err := h.Queries.SetPasswordMinLength(ctx, int16(*req.MinLength))
	if err != nil {
		h.AuditLog.Log(ctx, "password_policy.update", audit.LevelWarn, audit.Failure(err.Error()), nil)
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el mínimo")
		return
	}
	h.AuditLog.Log(ctx, "password_policy.update", audit.LevelWarn, audit.Success(), map[string]any{"minLength": n, "before": before})
	writeData(w, http.StatusOK, map[string]any{"minLength": n})
}
