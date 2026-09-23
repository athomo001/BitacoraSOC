package handler

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
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

// bootstrapError es un rechazo del bootstrap con su status/slug HTTP.
type bootstrapError struct {
	status int
	slug   string
	msg    string
}

func (e *bootstrapError) Error() string { return e.msg }

// runBootstrap es la única implementación del primer arranque: la usan el
// endpoint (asistente /setup) y BootstrapFromEnv, con las mismas reglas.
func (h *SetupHandler) runBootstrap(ctx context.Context, req bootstrapRequest) (db.User, *bootstrapError) {
	if !req.SocEnabled && !req.NocEnabled {
		return db.User{}, &bootstrapError{http.StatusBadRequest, "no-module-selected", "debés activar al menos un módulo (SOC o NOC)"}
	}
	if req.AdminUsername == "" || req.AdminEmail == "" || req.AdminPassword == "" {
		return db.User{}, &bootstrapError{http.StatusBadRequest, "invalid-payload", "adminUsername/adminEmail/adminPassword son obligatorios"}
	}
	// Fase 5: el wizard pide 12+ caracteres para el primer admin y la regla
	// vive también acá — una validación solo de frontend se salta con curl.
	// (El legacy exigía 6; NIST SP 800-63B recomienda 15 para un solo factor,
	// 12 es el piso razonable para la cuenta con más privilegios del sistema.)
	if len([]rune(req.AdminPassword)) < minAdminPasswordLength {
		return db.User{}, &bootstrapError{http.StatusBadRequest, "weak-password", "la contraseña del admin debe tener al menos 12 caracteres"}
	}
	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		return db.User{}, &bootstrapError{http.StatusInternalServerError, "internal-error", "no se pudo preparar la configuración"}
	}
	config, err := h.Queries.GetAppConfig(ctx)
	if err != nil {
		return db.User{}, &bootstrapError{http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración"}
	}
	if config.SetupCompletedAt.Valid {
		return db.User{}, &bootstrapError{http.StatusConflict, "setup-already-completed", "el setup inicial ya se completó — no puede reejecutarse"}
	}
	passwordHash, err := auth.HashPassword(req.AdminPassword)
	if err != nil {
		return db.User{}, &bootstrapError{http.StatusInternalServerError, "internal-error", "no se pudo procesar la contraseña"}
	}
	user, err := h.Queries.CreateUser(ctx, db.CreateUserParams{
		Username: req.AdminUsername, Email: req.AdminEmail, PasswordHash: passwordHash,
		Role: db.UserRoleAdmin, MustChangePassword: false,
	})
	if err != nil {
		return db.User{}, &bootstrapError{http.StatusConflict, "duplicate-user", "el username o email ya existe"}
	}
	if _, err := h.Queries.CompleteSetup(ctx, db.CompleteSetupParams{SocModuleEnabled: req.SocEnabled, NocModuleEnabled: req.NocEnabled}); err != nil {
		return db.User{}, &bootstrapError{http.StatusInternalServerError, "internal-error", "no se pudo completar el setup"}
	}
	return user, nil
}

func (h *SetupHandler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req bootstrapRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	user, berr := h.runBootstrap(ctx, req)
	if berr != nil {
		problemdetails.Write(w, r, berr.status, berr.slug, berr.msg)
		return
	}
	token, err := h.JWT.Issue(auth.Claims{UserID: user.ID, Username: user.Username, Role: string(user.Role)}, 24*time.Hour)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo emitir el token")
		return
	}
	h.AuditLog.Log(ctx, "setup.bootstrap", audit.LevelInfo, audit.Success(), map[string]any{
		"username": user.Username, "socEnabled": req.SocEnabled, "nocEnabled": req.NocEnabled,
	})
	writeData(w, http.StatusCreated, bootstrapResponse{User: toUserDTO(user), Token: token})
}

// EnvBootstrap es el admin por defecto opcional de .env (BOOTSTRAP_ADMIN_*).
type EnvBootstrap struct {
	Username, Email, Password string
	SOC, NOC                  bool
}

// EnvBootstrapFromEnv lee BOOTSTRAP_ADMIN_USERNAME/EMAIL/PASSWORD y
// BOOTSTRAP_MODULES (soc | noc | both, default both). Devuelve ok=false si no
// hay usuario/contraseña configurados (el caso normal: se usa el asistente).
func EnvBootstrapFromEnv() (EnvBootstrap, bool) {
	cfg := EnvBootstrap{
		Username: strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_USERNAME")),
		Email:    strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL")),
		Password: os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"),
	}
	if cfg.Username == "" || cfg.Password == "" {
		return cfg, false
	}
	if cfg.Email == "" {
		cfg.Email = cfg.Username + "@bitacora.local"
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("BOOTSTRAP_MODULES"))) {
	case "soc":
		cfg.SOC = true
	case "noc":
		cfg.NOC = true
	default:
		cfg.SOC, cfg.NOC = true, true
	}
	return cfg, true
}

// BootstrapFromEnv completa el setup al arrancar con el admin de .env, SOLO
// si el setup todavía no se hizo — para entrar rápido en desarrollo/pruebas
// sin pasar por el asistente. Si el setup ya existe no hace nada (no es una
// puerta trasera para crear admins ni para cambiar contraseñas): lo avisa en
// el log y sigue. Un error nunca impide arrancar el servidor.
func (h *SetupHandler) BootstrapFromEnv(ctx context.Context, cfg EnvBootstrap, logger *slog.Logger) {
	user, berr := h.runBootstrap(ctx, bootstrapRequest{
		AdminUsername: cfg.Username, AdminEmail: cfg.Email, AdminPassword: cfg.Password,
		SocEnabled: cfg.SOC, NocEnabled: cfg.NOC,
	})
	switch {
	case berr == nil:
		logger.Info("setup completado con el admin por defecto de .env (BOOTSTRAP_ADMIN_*)", "username", user.Username, "soc", cfg.SOC, "noc", cfg.NOC)
		h.AuditLog.Log(ctx, "setup.bootstrap.env", audit.LevelWarn, audit.Success(), map[string]any{
			"username": user.Username, "socEnabled": cfg.SOC, "nocEnabled": cfg.NOC,
		})
	case berr.slug == "setup-already-completed":
		logger.Info("BOOTSTRAP_ADMIN_* ignorado: el setup ya estaba completo (no se crean ni modifican usuarios)")
	default:
		logger.Error("BOOTSTRAP_ADMIN_* rechazado; se sigue con el asistente /setup", "motivo", berr.msg)
	}
}
