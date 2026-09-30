package middleware

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/google/uuid"
)

type recordingInserter struct{ entries []audit.Entry }

func (r *recordingInserter) InsertAuditLog(_ context.Context, e audit.Entry) error {
	r.entries = append(r.entries, e)
	return nil
}

// Regresión: el cambio de IP solo quedaba marcado en el contexto y se perdía
// si la request era un GET (la mayoría), que no audita nada.
func TestDetectIPChange_AuditsOwnEvent(t *testing.T) {
	rec := &recordingInserter{}
	a := NewAuth(nil, nil, nil, audit.NewLogger(rec, slog.New(slog.NewTextHandler(io.Discard, nil))))
	jti := uuid.New()
	request := func(ip string) context.Context {
		ctx := audit.WithActor(context.Background(), audit.Actor{UserID: uuid.New(), Username: "ana", Role: "user"})
		return a.detectIPChange(audit.WithRequestMeta(ctx, audit.RequestMeta{IP: ip, Method: "GET", Path: "/api/entries"}), jti)
	}

	request("10.0.0.1")
	request("10.0.0.1")
	if len(rec.entries) != 0 {
		t.Fatalf("sin cambio de IP no debe auditar nada, hubo %d eventos", len(rec.entries))
	}

	ctx := request("200.1.2.3")
	if len(rec.entries) != 1 {
		t.Fatalf("esperaba 1 evento de cambio de IP, hubo %d", len(rec.entries))
	}
	got := rec.entries[0]
	if got.Event != "auth.session.ip_change" || got.Level != audit.LevelWarn || got.ActorUsername != "ana" {
		t.Fatalf("evento inesperado: %+v", got)
	}
	if !got.IPChanged || got.PreviousIP != "10.0.0.1" || got.RequestIP != "200.1.2.3" || got.Metadata["previousIp"] != "10.0.0.1" {
		t.Fatalf("faltan las IPs en el evento: %+v", got)
	}
	if meta, _ := audit.RequestMetaFromContext(ctx); !meta.IPChanged {
		t.Fatal("el contexto sigue debiendo marcar ip_changed para lo que audite el handler")
	}
}
