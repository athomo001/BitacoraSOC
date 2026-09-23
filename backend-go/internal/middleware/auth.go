package middleware

import (
	"context"
	"net/http"
	"strings"
	"sync"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	authpkg "github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/google/uuid"
)

// LookedUpUser es lo mínimo que RequireAuth necesita del usuario para armar
// el contexto — desacoplado del tipo concreto generado por sqlc.
type LookedUpUser struct {
	ID                 uuid.UUID
	Username           string
	Role               string
	MustChangePassword bool
	Active             bool
}

// UserLookup carga el usuario autenticado por id — separado de db.Queries
// para no acoplar este middleware al tipo concreto generado por sqlc.
type UserLookup interface {
	GetActiveUser(ctx context.Context, id uuid.UUID) (LookedUpUser, error)
}

// TokenDenylistChecker consulta token_denylist.
type TokenDenylistChecker interface {
	IsDenylisted(ctx context.Context, jti uuid.UUID) (bool, error)
}

// Auth verifica el JWT de cada request protegida, carga el usuario real
// (para must_change_password, que puede cambiar entre requests) y detecta
// cambios de IP en la sesión (spec/07-backend-arquitectura-go.md sección 6.2).
type Auth struct {
	JWT      *authpkg.JWTIssuer
	Users    UserLookup
	Denylist TokenDenylistChecker
	AuditLog *audit.Logger

	ipTrackerMu sync.Mutex
	ipTracker   map[uuid.UUID]string // JTI -> última IP vista
}

// NewAuth construye el middleware de auth.
func NewAuth(jwtIssuer *authpkg.JWTIssuer, users UserLookup, denylist TokenDenylistChecker, auditLog *audit.Logger) *Auth {
	return &Auth{JWT: jwtIssuer, Users: users, Denylist: denylist, AuditLog: auditLog, ipTracker: make(map[uuid.UUID]string)}
}

// RequireAuth exige un JWT válido, no revocado, de un usuario activo.
func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "falta el header Authorization: Bearer <jwt>")
			return
		}

		claims, err := a.JWT.Verify(token)
		if err != nil {
			problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-token", "token inválido o expirado")
			return
		}
		if claims.Purpose != authpkg.PurposeAccess {
			// Un tempToken de MFA pendiente (u otro propósito acotado a
			// futuro) nunca debe funcionar como sesión completa — ver
			// internal/auth.PurposeMFAPending.
			problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-token", "este token no es válido para autenticación general")
			return
		}

		if a.Denylist != nil {
			denylisted, err := a.Denylist.IsDenylisted(r.Context(), claims.JTI)
			if err == nil && denylisted {
				problemdetails.Write(w, r, http.StatusUnauthorized, "revoked-token", "la sesión fue cerrada")
				return
			}
		}

		user, err := a.Users.GetActiveUser(r.Context(), claims.UserID)
		if err != nil || !user.Active {
			problemdetails.Write(w, r, http.StatusUnauthorized, "invalid-token", "usuario inexistente o desactivado")
			return
		}

		ctx := WithUser(r.Context(), AuthenticatedUser{
			ID: user.ID, Username: user.Username, Role: user.Role,
			MustChangePassword: user.MustChangePassword, JTI: claims.JTI,
		})
		ctx = audit.WithActor(ctx, audit.Actor{UserID: user.ID, Username: user.Username, Role: user.Role})
		ctx = a.detectIPChange(ctx, claims.JTI)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// detectIPChange compara la IP de esta request contra la última vista para
// el mismo JTI — si cambió, marca ip_changed/previous_ip en el contexto de
// auditoría (nivel warn en el handler que llame audit.Log, no bloquea la
// request: un analista cambiando de red a mitad de turno es normal).
func (a *Auth) detectIPChange(ctx context.Context, jti uuid.UUID) context.Context {
	meta, ok := audit.RequestMetaFromContext(ctx)
	if !ok {
		return ctx
	}

	a.ipTrackerMu.Lock()
	previousIP, seenBefore := a.ipTracker[jti]
	a.ipTracker[jti] = meta.IP
	a.ipTrackerMu.Unlock()

	if seenBefore && previousIP != meta.IP {
		meta.IPChanged = true
		meta.PreviousIP = previousIP
		return audit.WithRequestMeta(ctx, meta)
	}
	return ctx
}

// RequireNotForcedPasswordChange bloquea el endpoint mientras el usuario
// tenga must_change_password=true (código FORCE_SETUP_REQUIRED) — debe
// montarse después de RequireAuth, y **no** aplicarse a las 4 rutas que
// spec/04-contratos-api.md permite mientras el flag está activo
// (GET /api/users/me, PUT /api/users/me/password, PUT /api/users/me/avatar,
// POST /api/auth/logout): esas se registran en main.go solo con RequireAuth,
// sin este middleware encima — más simple y explícito que introspeccionar
// el patrón de ruta contra una allowlist genérica.
func RequireNotForcedPasswordChange(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := UserFromContext(r.Context())
		if ok && user.MustChangePassword {
			problemdetails.Write(w, r, http.StatusForbidden, "force-setup-required", "debés cambiar tu contraseña temporal antes de continuar")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole exige que el usuario autenticado tenga uno de los roles dados.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, role := range roles {
		allowed[role] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFromContext(r.Context())
			if !ok || !allowed[user.Role] {
				problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "no tenés permiso para esta acción")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimPrefix(header, prefix)
}
