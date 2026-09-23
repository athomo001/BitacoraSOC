package audit_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/google/uuid"
)

type fakeInserter struct {
	lastEntry audit.Entry
	err       error
	calls     int
}

func (f *fakeInserter) InsertAuditLog(ctx context.Context, entry audit.Entry) error {
	f.calls++
	f.lastEntry = entry
	return f.err
}

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestLog_PropagaActorYRequestMetaDelContexto(t *testing.T) {
	inserter := &fakeInserter{}
	logger := audit.NewLogger(inserter, silentLogger())

	userID := uuid.New()
	ctx := audit.WithActor(context.Background(), audit.Actor{UserID: userID, Username: "ana", Role: "admin"})
	ctx = audit.WithRequestMeta(ctx, audit.RequestMeta{RequestID: "req-1", IP: "10.0.0.1", Method: "POST", Path: "/api/auth/login", UserAgent: "curl/8"})

	logger.Log(ctx, "auth.login.success", audit.LevelInfo, audit.Success(), nil)

	if inserter.calls != 1 {
		t.Fatalf("InsertAuditLog llamado %d veces, se esperaba 1", inserter.calls)
	}
	got := inserter.lastEntry
	if got.Event != "auth.login.success" {
		t.Errorf("Event = %q", got.Event)
	}
	if got.ActorUserID == nil || *got.ActorUserID != userID {
		t.Errorf("ActorUserID = %v, se esperaba %v", got.ActorUserID, userID)
	}
	if got.ActorUsername != "ana" || got.ActorRole != "admin" {
		t.Errorf("actor = %q/%q", got.ActorUsername, got.ActorRole)
	}
	if got.RequestID != "req-1" || got.RequestIP != "10.0.0.1" {
		t.Errorf("request meta no se propagó: %+v", got)
	}
	if !got.Success {
		t.Error("Success debería ser true")
	}
}

func TestLog_SinActorEnContextoNoPanica(t *testing.T) {
	inserter := &fakeInserter{}
	logger := audit.NewLogger(inserter, silentLogger())

	// Endpoint público (ej. POST /api/auth/login antes de autenticar) — sin
	// actor en el contexto, no debería panicar ni fallar.
	logger.Log(context.Background(), "auth.login.fail", audit.LevelWarn, audit.Failure("credenciales inválidas"), nil)

	if inserter.calls != 1 {
		t.Fatalf("InsertAuditLog llamado %d veces, se esperaba 1", inserter.calls)
	}
	if inserter.lastEntry.ActorUserID != nil {
		t.Errorf("ActorUserID debería ser nil sin actor en contexto, fue %v", inserter.lastEntry.ActorUserID)
	}
	if inserter.lastEntry.Success {
		t.Error("Success debería ser false para Failure()")
	}
	if inserter.lastEntry.Reason != "credenciales inválidas" {
		t.Errorf("Reason = %q", inserter.lastEntry.Reason)
	}
}

func TestLog_SanitizaMetadataAntesDePersistir(t *testing.T) {
	inserter := &fakeInserter{}
	logger := audit.NewLogger(inserter, silentLogger())

	logger.Log(context.Background(), "users.update", audit.LevelInfo, audit.Success(), map[string]any{
		"newPassword": "no-debe-guardarse-en-claro",
		"field":       "email",
	})

	if inserter.lastEntry.Metadata["newPassword"] != audit.RedactedValue {
		t.Fatalf("metadata no se sanitizó: %+v", inserter.lastEntry.Metadata)
	}
	if inserter.lastEntry.Metadata["field"] != "email" {
		t.Fatalf("se perdió un campo no sensible: %+v", inserter.lastEntry.Metadata)
	}
}

func TestLog_FalloDePersistenciaNuncaPropaga(t *testing.T) {
	inserter := &fakeInserter{err: errors.New("db caída")}
	logger := audit.NewLogger(inserter, silentLogger())

	// No debe panicar ni haber forma de que esto tumbe al handler que
	// llamó — audit.Log() no devuelve error a propósito (ver firma).
	logger.Log(context.Background(), "entry.create", audit.LevelInfo, audit.Success(), nil)

	if inserter.calls != 1 {
		t.Fatalf("se esperaba que igual se intentara insertar una vez, calls=%d", inserter.calls)
	}
}

func TestLog_DefaultSourceEsCore(t *testing.T) {
	inserter := &fakeInserter{}
	logger := audit.NewLogger(inserter, silentLogger())

	logger.Log(context.Background(), "entry.create", audit.LevelInfo, audit.Success(), nil)

	if inserter.lastEntry.Source != "core" {
		t.Fatalf("Source = %q, se esperaba \"core\" por defecto", inserter.lastEntry.Source)
	}
}
