// Package middleware trae el contexto de request/actor a cada handler
// (spec/07-backend-arquitectura-go.md sección 6: request ID, IP, user
// autenticado) para que audit.Log() nunca tenga que recibirlo a mano.
package middleware

import (
	"context"

	"github.com/google/uuid"
)

type userContextKey struct{}

// AuthenticatedUser es el usuario ya verificado por RequireAuth — más
// completo que audit.Actor (incluye MustChangePassword, que los handlers
// necesitan para el gate de FORCE_SETUP_REQUIRED).
type AuthenticatedUser struct {
	ID                 uuid.UUID
	Username           string
	Role               string
	MustChangePassword bool
	JTI                uuid.UUID
}

func WithUser(ctx context.Context, user AuthenticatedUser) context.Context {
	return context.WithValue(ctx, userContextKey{}, user)
}

func UserFromContext(ctx context.Context) (AuthenticatedUser, bool) {
	user, ok := ctx.Value(userContextKey{}).(AuthenticatedUser)
	return user, ok
}
