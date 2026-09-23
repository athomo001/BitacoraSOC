package audit

import (
	"context"

	"github.com/google/uuid"
)

type contextKey int

const (
	actorContextKey contextKey = iota
	requestMetaContextKey
)

// Actor es quién ejecuta la acción — puesto en el contexto por el
// middleware de auth tras verificar el JWT. Ausente en endpoints públicos
// (login, forgot-password, setup/bootstrap antes de que exista un admin).
type Actor struct {
	UserID   uuid.UUID
	Username string
	Role     string
}

// RequestMeta es el contexto de la request HTTP — puesto por el middleware
// de metadata en cada request, autenticada o no (spec/07-backend-arquitectura-go.md
// sección 6.1: "nunca se pasan a mano en cada call site").
type RequestMeta struct {
	RequestID         string
	IP                string
	Method            string
	Path              string
	UserAgent         string
	DeviceFingerprint string
	// IPChanged/PreviousIP: detección de secuestro de sesión (sección 6.2) —
	// el middleware de auth los completa comparando contra el tracker en
	// memoria de la sesión activa.
	IPChanged  bool
	PreviousIP string
}

// WithActor y WithRequestMeta guardan el actor/contexto de request en ctx.
func WithActor(ctx context.Context, actor Actor) context.Context {
	return context.WithValue(ctx, actorContextKey, actor)
}

func WithRequestMeta(ctx context.Context, meta RequestMeta) context.Context {
	return context.WithValue(ctx, requestMetaContextKey, meta)
}

// ActorFromContext y RequestMetaFromContext leen lo que pusieron los
// middlewares — el segundo valor es false si nunca se pobló (ej. actor en
// un endpoint público).
func ActorFromContext(ctx context.Context) (Actor, bool) {
	actor, ok := ctx.Value(actorContextKey).(Actor)
	return actor, ok
}

func RequestMetaFromContext(ctx context.Context) (RequestMeta, bool) {
	meta, ok := ctx.Value(requestMetaContextKey).(RequestMeta)
	return meta, ok
}
