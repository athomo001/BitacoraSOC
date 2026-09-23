package handler

import (
	"crypto/subtle"
	"net/http"
	"os"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// SystemHandler cubre la válvula de emergencia POST /api/system/rate-limit-reset
// (spec/07-backend-arquitectura-go.md sección 6.3) — gateada por secreto
// compartido, no JWT: existe justamente para desbloquear falsos positivos
// de rate limit sin depender de poder loguearse.
type SystemHandler struct {
	Queries     *db.Queries
	APILimiter  *ratelimit.APILimiter
	AuditLog    *audit.Logger
	ResetSecret string // RATE_LIMIT_RESET_SECRET — "" desactiva el endpoint
}

type rateLimitResetRequest struct {
	Scope string `json:"scope"` // "login" | "api" | "all"
	Key   string `json:"key"`
}

func (h *SystemHandler) RateLimitReset(w http.ResponseWriter, r *http.Request) {
	// Responde 404 si el secreto no está configurado — oculta su propia
	// existencia (spec/07-backend-arquitectura-go.md sección 6.3).
	if h.ResetSecret == "" {
		http.NotFound(w, r)
		return
	}

	provided := r.Header.Get("X-Rate-Limit-Reset-Secret")
	if subtle.ConstantTimeCompare([]byte(provided), []byte(h.ResetSecret)) != 1 {
		problemdetails.Write(w, r, http.StatusForbidden, "invalid-secret", "secreto incorrecto")
		return
	}

	var req rateLimitResetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	ctx := r.Context()
	switch req.Scope {
	case "login":
		if req.Key != "" {
			_ = h.Queries.ResetLoginRateLimit(ctx, req.Key)
		} else {
			_ = h.Queries.ResetAllLoginRateLimits(ctx)
		}
	case "api":
		// El limitador en memoria no expone reset por clave individual a
		// propósito (es de mejor esfuerzo) — se recrea completo.
		h.APILimiter.Reset()
	case "all":
		_ = h.Queries.ResetAllLoginRateLimits(ctx)
		h.APILimiter.Reset()
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-scope", "scope debe ser login, api o all")
		return
	}

	h.AuditLog.Log(ctx, "system.ratelimit.reset", audit.LevelWarn, audit.Success(), map[string]any{"scope": req.Scope, "key": req.Key})
	writeData(w, http.StatusOK, map[string]any{"reset": true})
}

// ResetSecretFromEnv lee RATE_LIMIT_RESET_SECRET — separado para que
// main.go no tenga que importar "os" solo por esto.
func ResetSecretFromEnv() string {
	return os.Getenv("RATE_LIMIT_RESET_SECRET")
}
