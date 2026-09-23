package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	accountLockThreshold = 5
	accountLockDuration  = 15 * time.Minute
	accessTokenTTL       = 8 * time.Hour
	mfaPendingTokenTTL   = 5 * time.Minute
	resetTokenTTL        = 5 * time.Minute // spec/03-esquema-db.sql: recortado del legacy (1h -> 5min, "C5")
)

// AuthHandler cubre /api/auth/* y las rutas de perfil propio
// (spec/04-contratos-api.md sección Auth).
type AuthHandler struct {
	Queries       *db.Queries
	JWT           *auth.JWTIssuer
	Crypto        *crypto.Box
	LoginLimiter  *ratelimit.LoginLimiter
	AuditLog      *audit.Logger
	PublicBaseURL string
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req loginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	ip := ""
	if meta, ok := audit.RequestMetaFromContext(ctx); ok {
		ip = meta.IP
	}
	if h.LoginLimiter != nil {
		blocked, retryAfter, err := h.LoginLimiter.RegisterAttempt(ctx, ip)
		if err == nil && blocked {
			h.AuditLog.Log(ctx, "auth.login.fail", audit.LevelWarn, audit.Failure("rate limit por IP"), map[string]any{"username": req.Username})
			problemdetails.WriteRateLimited(w, r, int(retryAfter.Seconds()), "demasiados intentos de login desde esta IP, esperá unos minutos")
			return
		}
	}

	user, err := h.Queries.GetUserByUsername(ctx, req.Username)
	if err != nil {
		h.AuditLog.Log(ctx, "auth.login.fail", audit.LevelWarn, audit.Failure("usuario inexistente"), map[string]any{"username": req.Username})
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-credentials", "credenciales inválidas")
		return
	}

	if user.LockedUntil.Valid && user.LockedUntil.Time.After(time.Now()) {
		h.AuditLog.Log(ctx, "auth.login.fail", audit.LevelWarn, audit.Failure("cuenta bloqueada"), map[string]any{"username": req.Username})
		problemdetails.Write(w, r, http.StatusLocked, "account-locked", "cuenta bloqueada temporalmente por múltiples intentos fallidos, probá en 15 minutos")
		return
	}
	if !user.Active {
		h.AuditLog.Log(ctx, "auth.login.fail", audit.LevelWarn, audit.Failure("cuenta inactiva"), map[string]any{"username": req.Username})
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-credentials", "credenciales inválidas")
		return
	}

	if err := auth.CheckPassword(user.PasswordHash, req.Password); err != nil {
		attempts, regErr := h.Queries.RegisterFailedLogin(ctx, user.ID)
		if regErr == nil && attempts >= accountLockThreshold {
			_ = h.Queries.LockUser(ctx, db.LockUserParams{
				ID:          user.ID,
				LockedUntil: pgtype.Timestamptz{Time: time.Now().Add(accountLockDuration), Valid: true},
			})
		}
		h.AuditLog.Log(ctx, "auth.login.fail", audit.LevelWarn, audit.Failure("contraseña incorrecta"), map[string]any{"username": req.Username, "failedAttempts": attempts})
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-credentials", "credenciales inválidas")
		return
	}

	// Contraseña correcta: limpiar intentos fallidos y, si el hash viene del
	// legacy (costo < 12), re-hashearlo transparentemente.
	_ = h.Queries.ResetFailedLoginAttempts(ctx, user.ID)
	if auth.NeedsRehash(user.PasswordHash) {
		if newHash, err := auth.HashPassword(req.Password); err == nil {
			_ = h.Queries.RehashPassword(ctx, db.RehashPasswordParams{ID: user.ID, PasswordHash: newHash})
		}
	}

	if user.MfaEnabled {
		tempToken, err := h.JWT.Issue(auth.Claims{UserID: user.ID, Username: user.Username, Role: string(user.Role), Purpose: auth.PurposeMFAPending}, mfaPendingTokenTTL)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo iniciar el segundo factor")
			return
		}
		h.AuditLog.Log(ctx, "auth.login.mfa_required", audit.LevelInfo, audit.Success(), map[string]any{"username": user.Username})
		writeData(w, http.StatusOK, map[string]any{"tempToken": tempToken, "mfaPending": true})
		return
	}

	token, err := h.JWT.Issue(auth.Claims{UserID: user.ID, Username: user.Username, Role: string(user.Role)}, accessTokenTTL)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo emitir el token")
		return
	}
	h.AuditLog.Log(ctx, "auth.login.success", audit.LevelInfo, audit.Success(), map[string]any{"username": user.Username})
	writeData(w, http.StatusOK, map[string]any{"token": token, "mustChangePassword": user.MustChangePassword})
}

type mfaAuthenticateRequest struct {
	TempToken string `json:"tempToken"`
	Code      string `json:"code"`
}

func (h *AuthHandler) MFAAuthenticate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req mfaAuthenticateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	claims, err := h.JWT.Verify(req.TempToken)
	if err != nil || claims.Purpose != auth.PurposeMFAPending {
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-token", "código inválido o expirado")
		return
	}

	user, err := h.Queries.GetUserByID(ctx, claims.UserID)
	if err != nil || !user.MfaSecretEncrypted.Valid {
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-token", "código inválido o expirado")
		return
	}
	secret, err := h.Crypto.Decrypt(user.MfaSecretEncrypted.String)
	if err != nil || !auth.VerifyTOTPCode(secret, req.Code) {
		h.AuditLog.Log(ctx, "auth.mfa.fail", audit.LevelWarn, audit.Failure("código TOTP inválido"), map[string]any{"username": user.Username})
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-code", "código inválido o expirado")
		return
	}

	token, err := h.JWT.Issue(auth.Claims{UserID: user.ID, Username: user.Username, Role: string(user.Role)}, accessTokenTTL)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo emitir el token")
		return
	}
	h.AuditLog.Log(ctx, "auth.login.success", audit.LevelInfo, audit.Success(), map[string]any{"username": user.Username, "viaMfa": true})
	writeData(w, http.StatusOK, map[string]any{"token": token})
}

func (h *AuthHandler) MFASetup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}

	enrollment, err := auth.GenerateTOTPSecret(user.Username, "Bitácora Ops")
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo generar el secreto TOTP")
		return
	}
	encryptedSecret, err := h.Crypto.Encrypt(enrollment.Secret)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cifrar el secreto TOTP")
		return
	}
	if err := h.Queries.SetMFASecret(ctx, db.SetMFASecretParams{ID: user.ID, MfaSecretEncrypted: pgtype.Text{String: encryptedSecret, Valid: true}}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el secreto TOTP")
		return
	}

	writeData(w, http.StatusOK, map[string]any{"qrCodeDataUrl": enrollment.QRCodeDataURL, "secret": enrollment.Secret})
}

type mfaVerifyRequest struct {
	Code string `json:"code"`
}

func (h *AuthHandler) MFAVerify(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}
	var req mfaVerifyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	dbUser, err := h.Queries.GetUserByID(ctx, user.ID)
	if err != nil || !dbUser.MfaSecretEncrypted.Valid {
		problemdetails.Write(w, r, http.StatusBadRequest, "mfa-not-setup", "primero llamá a /api/auth/mfa/setup")
		return
	}
	secret, err := h.Crypto.Decrypt(dbUser.MfaSecretEncrypted.String)
	if err != nil || !auth.VerifyTOTPCode(secret, req.Code) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-code", "código inválido")
		return
	}

	if err := h.Queries.EnableMFA(ctx, user.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo activar MFA")
		return
	}
	h.AuditLog.Log(ctx, "auth.mfa.enabled", audit.LevelInfo, audit.Success(), nil)
	w.WriteHeader(http.StatusOK)
}

type mfaDisableRequest struct {
	Password string `json:"password"`
}

func (h *AuthHandler) MFADisable(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}
	var req mfaDisableRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	dbUser, err := h.Queries.GetUserByID(ctx, user.ID)
	if err != nil || auth.CheckPassword(dbUser.PasswordHash, req.Password) != nil {
		problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-credentials", "contraseña incorrecta")
		return
	}
	if err := h.Queries.DisableMFA(ctx, user.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo desactivar MFA")
		return
	}
	h.AuditLog.Log(ctx, "auth.mfa.disabled", audit.LevelWarn, audit.Success(), nil)
	w.WriteHeader(http.StatusOK)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := middleware.UserFromContext(ctx)
	if ok {
		_ = h.Queries.DenylistToken(ctx, db.DenylistTokenParams{
			Jti:       user.JTI,
			UserID:    user.ID,
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(accessTokenTTL), Valid: true},
		})
		h.AuditLog.Log(ctx, "auth.logout", audit.LevelInfo, audit.Success(), nil)
	}
	writeNoContent(w)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}
	dbUser, err := h.Queries.GetUserByID(ctx, user.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	writeData(w, http.StatusOK, toUserDTO(dbUser))
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *AuthHandler) ChangeMyPassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	authUser, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}
	var req changePasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.NewPassword == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "newPassword es obligatorio")
		return
	}

	dbUser, err := h.Queries.GetUserByID(ctx, authUser.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}

	// currentPassword no se exige si mustChangePassword=true — spec/04-contratos-api.md:
	// "el usuario no debería tener que recordar la temporal que le dieron".
	if !dbUser.MustChangePassword {
		if req.CurrentPassword == "" || auth.CheckPassword(dbUser.PasswordHash, req.CurrentPassword) != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-current-password", "la contraseña actual no es correcta")
			return
		}
	}

	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo procesar la nueva contraseña")
		return
	}
	if err := h.Queries.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: authUser.ID, PasswordHash: newHash}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la contraseña")
		return
	}

	h.AuditLog.Log(ctx, "auth.password.change", audit.LevelInfo, audit.Success(), nil)
	updated, _ := h.Queries.GetUserByID(ctx, authUser.ID)
	writeData(w, http.StatusOK, map[string]any{"user": toUserDTO(updated)})
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

// ForgotPassword genera un token de reseteo (32 bytes aleatorios, se
// persiste solo su hash SHA-256) y lo envía por correo. Siempre responde
// 202 sin importar si el email existe (spec/04-contratos-api.md:
// "no filtra existencia") — mismo criterio anti-enumeración que el legacy.
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req forgotPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	user, err := h.Queries.GetUserByEmail(ctx, req.Email)
	if err != nil || !user.Active {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	rawTokenHex := hex.EncodeToString(rawToken)
	tokenHash := sha256.Sum256([]byte(rawTokenHex))
	tokenHashHex := hex.EncodeToString(tokenHash[:])

	if err := h.Queries.SetPasswordResetToken(ctx, db.SetPasswordResetTokenParams{
		ID:                     user.ID,
		ResetPasswordTokenHash: pgtype.Text{String: tokenHashHex, Valid: true},
		ResetPasswordExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(resetTokenTTL), Valid: true},
	}); err != nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	if sender, from, err := buildMailSender(ctx, h.Queries, h.Crypto); err == nil {
		resetURL := h.PublicBaseURL + "/reset-password?token=" + rawTokenHex
		_ = sender.Send(user.Email, "Recuperación de contraseña - Bitácora Ops",
			"Solicitaste restablecer tu contraseña. Este enlace vence en 5 minutos:\n\n"+resetURL+"\n\nSi no fuiste vos, ignorá este correo.")
		_ = from
	}

	h.AuditLog.Log(ctx, "auth.password.forgot", audit.LevelInfo, audit.Success(), map[string]any{"username": user.Username})
	w.WriteHeader(http.StatusAccepted)
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req resetPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.Token == "" || req.NewPassword == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "token y newPassword son obligatorios")
		return
	}

	tokenHash := sha256.Sum256([]byte(req.Token))
	tokenHashHex := hex.EncodeToString(tokenHash[:])

	user, err := h.Queries.GetUserByResetTokenHash(ctx, pgtype.Text{String: tokenHashHex, Valid: true})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo validar el token")
			return
		}
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-token", "token inválido o expirado")
		return
	}
	if !user.ResetPasswordExpiresAt.Valid || user.ResetPasswordExpiresAt.Time.Before(time.Now()) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-token", "token inválido o expirado")
		return
	}

	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo procesar la nueva contraseña")
		return
	}
	if err := h.Queries.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: user.ID, PasswordHash: newHash}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la contraseña")
		return
	}
	_ = h.Queries.ClearPasswordResetToken(ctx, user.ID)

	h.AuditLog.Log(ctx, "auth.password.reset", audit.LevelInfo, audit.Success(), map[string]any{"username": user.Username})
	w.WriteHeader(http.StatusOK)
}
