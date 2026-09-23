package repository

import (
	"context"
	"encoding/json"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// AuditStore adapta db.Queries a audit.Inserter — el único punto donde una
// audit.Entry se convierte a filas/columnas reales de Postgres.
type AuditStore struct {
	Queries *db.Queries
}

func (s *AuditStore) InsertAuditLog(ctx context.Context, entry audit.Entry) error {
	metadataJSON, err := json.Marshal(entry.Metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	var actorUserID pgtype.UUID
	if entry.ActorUserID != nil {
		actorUserID = pgtype.UUID{Bytes: *entry.ActorUserID, Valid: true}
	}

	return s.Queries.InsertAuditLog(ctx, db.InsertAuditLogParams{
		Event:             entry.Event,
		Level:             string(entry.Level),
		ActorUserID:       actorUserID,
		ActorUsername:     textOrNull(entry.ActorUsername),
		ActorRole:         textOrNull(entry.ActorRole),
		RequestID:         textOrNull(entry.RequestID),
		RequestIp:         textOrNull(entry.RequestIP),
		RequestPath:       textOrNull(entry.RequestPath),
		RequestMethod:     textOrNull(entry.RequestMethod),
		UserAgent:         textOrNull(entry.UserAgent),
		DeviceFingerprint: textOrNull(entry.DeviceFingerprint),
		IpChanged:         entry.IPChanged,
		PreviousIp:        textOrNull(entry.PreviousIP),
		Success:           entry.Success,
		Reason:            textOrNull(entry.Reason),
		Source:            entry.Source,
		SourceID:          textOrNull(entry.SourceID),
		Metadata:          metadataJSON,
	})
}

// textOrNull evita persistir strings vacíos como "" en vez de NULL cuando
// el dato simplemente no aplica (ej. reason en un evento exitoso).
func textOrNull(value string) pgtype.Text {
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}
