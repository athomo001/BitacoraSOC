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
	// UserModuleAreaCodes: áreas de los grupos con perfil Operativo (los únicos que abren SOC/NOC).
	UserModuleAreaCodes(ctx context.Context, userID uuid.UUID) ([]string, error)
}

// RequireModule bloquea con 403 un endpoint de un módulo de dominio (SOC/NOC)
// si la instancia lo tiene desactivado (HU-0/0b: "no es solo ocultamiento
// visual", aplica incluso a admin — un módulo apagado está apagado para
// todos) o si el usuario no-admin no lo tiene en el alcance de sus
// permission_groups (HU-PERM-2). Debe montarse después de RequireAuth.
// Lee los módulos en cada request a propósito: PATCH /api/config/modules
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
				scopes, err := access.UserModuleAreaCodes(ctx, user.ID)
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

// AreaLister lee todas las áreas del usuario (cualquier perfil).
type AreaLister interface {
	UserAreaCodes(ctx context.Context, userID uuid.UUID) ([]string, error)
}

// RequireModuleOrOwnArea es RequireModule para las lecturas que también usa
// la gente de un área propia (TI, Infraestructura…) para su escalamiento
// (9e, spec/16 §3.6): el módulo tiene que estar encendido en la instalación
// y el usuario, o tenerlo en su alcance Operativo, o estar en un área que
// no sea SOC ni NOC.
func RequireModuleOrOwnArea(access ModuleAccess, areas AreaLister, module modules.Module) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		strict := RequireModule(access, module)(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFromContext(r.Context())
			if ok && user.Role != "admin" {
				flags, err := access.InstanceFlags(r.Context())
				if err == nil && flags.Enabled(module) {
					codes, err := areas.UserAreaCodes(r.Context(), user.ID)
					if err != nil {
						problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el alcance del usuario")
						return
					}
					for _, c := range codes {
						if c != string(modules.SOC) && c != string(modules.NOC) {
							next.ServeHTTP(w, r)
							return
						}
					}
				}
			}
			strict.ServeHTTP(w, r)
		})
	}
}
