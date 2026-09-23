package middleware

import (
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
)

// APIRateLimit aplica el límite general de la API (spec/07-backend-arquitectura-go.md
// sección 6.3): se limita por identidad real (user_id si ya pasó
// RequireAuth, IP para tráfico anónimo), nunca por header/IP heurística.
// authenticatedLimiter/anonymousLimiter son distintos porque tienen cupos
// distintos (1200/300 req por 15min).
func APIRateLimit(anonymousLimiter, authenticatedLimiter *ratelimit.APILimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var key string
			var limiter *ratelimit.APILimiter

			if user, ok := UserFromContext(r.Context()); ok {
				key = "user:" + user.ID.String()
				limiter = authenticatedLimiter
			} else {
				ip := ""
				if meta, ok := audit.RequestMetaFromContext(r.Context()); ok {
					ip = meta.IP
				}
				key = "ip:" + ip
				limiter = anonymousLimiter
			}

			if !limiter.Allow(key) {
				problemdetails.WriteRateLimited(w, r, 60, "límite de requests excedido, esperá un momento")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
