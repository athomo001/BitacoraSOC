package audit

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
)

// Level es el nivel del evento — mismo vocabulario que ya usaba el legacy.
type Level string

const (
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
)

// Result es el desenlace de la acción auditada — se reduce a audit_log.success
// (bool) + audit_log.reason (texto libre, opcional) al persistir.
type Result struct {
	Success bool
	Reason  string
}

// Success construye un Result exitoso, sin razón (no hace falta explicar
// por qué algo funcionó).
func Success() Result { return Result{Success: true} }

// Failure construye un Result fallido con una razón legible — ej.
// "credenciales inválidas", "cuenta bloqueada".
func Failure(reason string) Result { return Result{Success: false, Reason: reason} }

// Entry es la fila que efectivamente se persiste — desacoplada del tipo
// generado por sqlc para poder probar Log() con un Inserter de prueba sin
// una base de datos real.
type Entry struct {
	Event             string
	Level             Level
	ActorUserID       *uuid.UUID
	ActorUsername     string
	ActorRole         string
	RequestID         string
	RequestIP         string
	RequestPath       string
	RequestMethod     string
	UserAgent         string
	DeviceFingerprint string
	IPChanged         bool
	PreviousIP        string
	Success           bool
	Reason            string
	Source            string
	SourceID          string
	Metadata          map[string]any
}

// Inserter persiste una Entry — implementado contra Postgres/sqlc en
// producción (ver internal/repository), contra un stub en tests.
type Inserter interface {
	InsertAuditLog(ctx context.Context, entry Entry) error
}

// Logger es el único punto de auditoría del backend — spec/07-backend-arquitectura-go.md
// sección 6.1: "un solo helper, llamado desde todo mutating handler".
type Logger struct {
	inserter Inserter
	logger   *slog.Logger
}

// NewLogger construye un Logger. logger recibe el error si la persistencia
// falla — Log() nunca lo propaga al llamador (ver Log).
func NewLogger(inserter Inserter, logger *slog.Logger) *Logger {
	return &Logger{inserter: inserter, logger: logger}
}

// Log registra event con su actor/contexto de request (extraídos de ctx,
// puestos ahí por los middlewares de auth/metadata — nunca a mano en cada
// call site) y metadata ya sanitizado. Nunca bloquea el flujo principal: si
// la persistencia falla, se loguea el error y listo — un audit_log caído no
// puede tumbar un login o un checklist a las 3 AM.
func (l *Logger) Log(ctx context.Context, event string, level Level, result Result, metadata map[string]any) {
	entry := Entry{
		Event:    event,
		Level:    level,
		Success:  result.Success,
		Reason:   result.Reason,
		Source:   "core",
		Metadata: SanitizeMetadata(metadata),
	}

	if actor, ok := ActorFromContext(ctx); ok {
		userID := actor.UserID
		entry.ActorUserID = &userID
		entry.ActorUsername = actor.Username
		entry.ActorRole = actor.Role
	}

	if meta, ok := RequestMetaFromContext(ctx); ok {
		entry.RequestID = meta.RequestID
		entry.RequestIP = meta.IP
		entry.RequestMethod = meta.Method
		entry.RequestPath = meta.Path
		entry.UserAgent = meta.UserAgent
		entry.DeviceFingerprint = meta.DeviceFingerprint
		entry.IPChanged = meta.IPChanged
		entry.PreviousIP = meta.PreviousIP
	}

	if err := l.inserter.InsertAuditLog(ctx, entry); err != nil {
		l.logger.Error("audit: no se pudo persistir el evento", "event", event, "error", err)
	}
}
