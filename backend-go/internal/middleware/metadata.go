package middleware

import (
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/google/uuid"
)

// Metadata puebla audit.RequestMeta en cada request (autenticada o no) —
// spec/07-backend-arquitectura-go.md sección 6.1. Se registra primero en la
// cadena de middlewares, antes de auth, para que hasta un intento de login
// fallido quede con contexto completo en audit_log.
func Metadata(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.NewString()
		}

		ctx := audit.WithRequestMeta(r.Context(), audit.RequestMeta{
			RequestID: requestID,
			IP:        clientIP(r),
			Method:    r.Method,
			Path:      r.URL.Path,
			UserAgent: r.UserAgent(),
		})

		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// clientIP prioriza X-Forwarded-For (Caddy delante, spec/07-backend-arquitectura-go.md
// sección 3) sobre RemoteAddr, que detrás de un proxy siempre sería la IP
// del propio Caddy.
func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		// Puede venir "cliente, proxy1, proxy2" — el primero es el real.
		for i, c := range forwarded {
			if c == ',' {
				return forwarded[:i]
			}
		}
		return forwarded
	}
	return r.RemoteAddr
}
