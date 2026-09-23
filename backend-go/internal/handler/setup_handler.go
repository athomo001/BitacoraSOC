package handler

import (
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// SetupHandler cubre GET /api/setup/status y POST /api/setup/bootstrap
// (spec/04-contratos-api.md). bootstrap vive en la Fase 4 (no en la Fase 5,
// donde vivía originalmente) — ver la nota de reordenamiento en
// spec/02-alcance-y-roadmap.md Fase 4 tarea 0: sin esto, la Fase 4 no podía
// probar login sin depender de una tarea de la Fase 5.
type SetupHandler struct {
	Queries  *db.Queries
	JWT      *auth.JWTIssuer
	AuditLog *audit.Logger
}

type setupStatusResponse struct {
	SetupCompleted bool `json:"setupCompleted"`
	SocEnabled     bool `json:"socEnabled"`
	NocEnabled     bool `json:"nocEnabled"`
}

func (h *SetupHandler) Status(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	config, err := h.Queries.GetAppConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	writeData(w, http.StatusOK, setupStatusResponse{
		SetupCompleted: config.SetupCompletedAt.Valid,
		SocEnabled:     config.SocModuleEnabled,
		NocEnabled:     config.NocModuleEnabled,
	})
}

const minAdminPasswordLength = 12

type bootstrapRequest struct {
	AdminUsername string `json:"adminUsername"`
	AdminEmail    string `json:"adminEmail"`
	AdminPassword string `json:"adminPassword"`
	SocEnabled    bool   `json:"socEnabled"`
	NocEnabled    bool   `json:"nocEnabled"`
}

type bootstrapResponse struct {
	User  UserDTO `json:"user"`
	Token string  `json:"token"`
}

func (h *SetupHandler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req bootstrapRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if !req.SocEnabled && !req.NocEnabled {
		problemdetails.Write(w, r, http.StatusBadRequest, "no-module-selected", "debés activar al menos un módulo (SOC o NOC)")
		return
	}
	if req.AdminUsername == "" || req.AdminEmail == "" || req.AdminPassword == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "adminUsername/adminEmail/adminPassword son obligatorios")
		return
	}
	// Fase 5: el wizard pide 12+ caracteres para el primer admin y la regla
	// vive también acá — una validación solo de frontend se salta con curl.
	// (El legacy exigía 6; NIST SP 800-63B recomienda 15 para un solo factor,
	// 12 es el piso razonable para la cuenta con más privilegios del sistema.)
	if len([]rune(req.AdminPassword)) < minAdminPasswordLength {
		problemdetails.Write(w, r, http.StatusBadRequest, "weak-password", "la contraseña del admin debe tener al menos 12 caracteres")
		return
	}

	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo preparar la configuración")
		return
	}
	config, err := h.Queries.GetAppConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	if config.SetupCompletedAt.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "setup-already-completed", "el setup inicial ya se completó — no puede reejecutarse")
		return
	}

	passwordHash, err := auth.HashPassword(req.AdminPassword)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo procesar la contraseña")
		return
	}

	user, err := h.Queries.CreateUser(ctx, db.CreateUserParams{
		Username:           req.AdminUsername,
		Email:              req.AdminEmail,
		PasswordHash:       passwordHash,
		Role:               db.UserRoleAdmin,
		MustChangePassword: false,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-user", "el username o email ya existe")
		return
	}

	if _, err := h.Queries.CompleteSetup(ctx, db.CompleteSetupParams{
		SocModuleEnabled: req.SocEnabled,
		NocModuleEnabled: req.NocEnabled,
	}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo completar el setup")
		return
	}

	token, err := h.JWT.Issue(auth.Claims{UserID: user.ID, Username: user.Username, Role: string(user.Role)}, 24*time.Hour)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo emitir el token")
		return
	}

	h.AuditLog.Log(ctx, "setup.bootstrap", audit.LevelInfo, audit.Success(), map[string]any{
		"username":   user.Username,
		"socEnabled": req.SocEnabled,
		"nocEnabled": req.NocEnabled,
	})

	writeData(w, http.StatusCreated, bootstrapResponse{User: toUserDTO(user), Token: token})
}
