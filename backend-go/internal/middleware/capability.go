package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/google/uuid"
)

// CapabilityAccess lee la unión de capacidades de los permission_groups
// activos del usuario (HU-PERM-1).
type CapabilityAccess interface {
	UserCapabilities(ctx context.Context, userID uuid.UUID) ([]string, error)
}

// RequireCapability exige que el usuario tenga al menos una de las
// capacidades dadas (ej. directory:delete). admin pasa siempre, igual que en
// el legacy. Reemplaza los Set() de cargos hardcodeados de
// backend/src/routes/directory.js (EDIT_ONLY_CARGOS/FULL_DIRECTORY_CARGOS),
// que dependían de que el cargo estuviera tipeado exactamente igual.
func RequireCapability(access CapabilityAccess, capabilities ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFromContext(r.Context())
			if !ok {
				problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
				return
			}
			if user.Role == "admin" {
				next.ServeHTTP(w, r)
				return
			}
			have, err := access.UserCapabilities(r.Context(), user.ID)
			if err != nil {
				problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las capacidades")
				return
			}
			for _, h := range have {
				for _, want := range capabilities {
					if h == want {
						next.ServeHTTP(w, r)
						return
					}
				}
			}
			problemdetails.Write(w, r, http.StatusForbidden, "missing-capability",
				"tu grupo de permisos no incluye la capacidad "+strings.Join(capabilities, " o "))
		})
	}
}
