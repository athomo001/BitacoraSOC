package middleware

import (
	"context"
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/google/uuid"
)

// ModuleAccess lee lo que RequireModule necesita — desacoplado de sqlc
// igual que UserLookup (ver repository.ModuleAccess).
type ModuleAccess interface {
	InstanceFlags(ctx context.Context) (modules.Flags, error)
	UserGroupScopes(ctx context.Context, userID uuid.UUID) ([]string, error)
}

// RequireModule bloquea con 403 un endpoint de un módulo de dominio (SOC/NOC)
// si la instancia lo tiene desactivado (HU-0/0b: "no es solo ocultamiento
// visual", aplica incluso a admin — un módulo apagado está apagado para
// todos) o si el usuario no-admin no lo tiene en el alcance de sus
// permission_groups (HU-PERM-2). Debe montarse después de RequireAuth.
// Lee app_config en cada request a propósito: PATCH /api/config/modules
// tiene que surtir efecto en la request siguiente, sin caché que invalidar.
func RequireModule(access ModuleAccess, module modules.Module) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			flags, err := access.InstanceFlags(ctx)
			if err != nil {
				problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de módulos")
				return
			}
			if !flags.Enabled(module) {
				problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "el módulo "+string(module)+" está desactivado en esta instalación")
				return
			}

			user, ok := UserFromContext(ctx)
			if !ok {
				problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
				return
			}
			if user.Role != "admin" {
				scopes, err := access.UserGroupScopes(ctx, user.ID)
				if err != nil {
					problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el alcance del usuario")
					return
				}
				if !modules.EffectiveScope(flags, scopes).Includes(module) {
					problemdetails.Write(w, r, http.StatusForbidden, "module-not-in-scope", "tu grupo de permisos no incluye el módulo "+string(module))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
