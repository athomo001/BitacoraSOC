package handler

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// AuditLogHandler cubre GET /api/audit-logs (admin|auditor) —
// spec/04-contratos-api.md. Paginado simple; ?event=/?actorUserId=/?from=/
// ?to= y /export quedan para cuando un caso real los necesite (no bloquean
// el checklist de salida de la Fase 4, que solo pide listar con
// requestId/userAgent poblados).
type AuditLogHandler struct {
	Queries *db.Queries
}

type auditLogDTO struct {
	Timestamp     string         `json:"timestamp"`
	Event         string         `json:"event"`
	Level         string         `json:"level"`
	ActorUsername *string        `json:"actorUsername,omitempty"`
	ActorRole     *string        `json:"actorRole,omitempty"`
	RequestID     *string        `json:"requestId,omitempty"`
	RequestIP     *string        `json:"requestIp,omitempty"`
	UserAgent     *string        `json:"userAgent,omitempty"`
	IPChanged     bool           `json:"ipChanged"`
	PreviousIP    *string        `json:"previousIp,omitempty"`
	Success       bool           `json:"success"`
	Reason        *string        `json:"reason,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

func toAuditLogDTO(a db.AuditLog) auditLogDTO {
	dto := auditLogDTO{
		Event:     a.Event,
		Level:     a.Level,
		IPChanged: a.IpChanged,
		Success:   a.Success,
	}
	if a.Timestamp.Valid {
		dto.Timestamp = a.Timestamp.Time.Format("2006-01-02T15:04:05Z07:00")
	}
	if a.ActorUsername.Valid {
		dto.ActorUsername = &a.ActorUsername.String
	}
	if a.ActorRole.Valid {
		dto.ActorRole = &a.ActorRole.String
	}
	if a.RequestID.Valid {
		dto.RequestID = &a.RequestID.String
	}
	if a.RequestIp.Valid {
		dto.RequestIP = &a.RequestIp.String
	}
	if a.UserAgent.Valid {
		dto.UserAgent = &a.UserAgent.String
	}
	if a.PreviousIp.Valid {
		dto.PreviousIP = &a.PreviousIp.String
	}
	if a.Reason.Valid {
		dto.Reason = &a.Reason.String
	}
	if a.Metadata != nil {
		_ = json.Unmarshal(a.Metadata, &dto.Metadata)
	}
	return dto
}

func (h *AuditLogHandler) Export(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	params := db.ListAuditLogsForExportParams{Event: pgtype.Text{String: strings.TrimSpace(q.Get("event")), Valid: q.Get("event") != ""}, ActorUserID: pgtype.UUID{}, FromDate: pgtype.Timestamptz{}, ToDate: pgtype.Timestamptz{}}
	if raw := q.Get("actorUserId"); raw != "" {
		if id, err := uuid.Parse(raw); err == nil {
			params.ActorUserID = pgtype.UUID{Bytes: id, Valid: true}
		} else {
			problemdetails.Write(w, r, 400, "invalid-query", "actorUserId inválido")
			return
		}
	}
	if raw := q.Get("from"); raw != "" {
		value, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			problemdetails.Write(w, r, 400, "invalid-query", "from inválido")
			return
		}
		params.FromDate = pgtype.Timestamptz{Time: value, Valid: true}
	}
	if raw := q.Get("to"); raw != "" {
		value, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			problemdetails.Write(w, r, 400, "invalid-query", "to inválido")
			return
		}
		params.ToDate = pgtype.Timestamptz{Time: value, Valid: true}
	}
	if params.FromDate.Valid && params.ToDate.Valid && params.ToDate.Time.Sub(params.FromDate.Time) > 366*24*time.Hour {
		problemdetails.Write(w, r, 400, "invalid-query", "el rango máximo es de un año")
		return
	}
	rows, err := h.Queries.ListAuditLogsForExport(r.Context(), params)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo exportar auditoría")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-logs.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"timestamp", "event", "level", "actor", "requestId", "success", "reason", "metadata"})
	for _, row := range rows {
		metadata, _ := json.Marshal(row.Metadata)
		_ = writer.Write([]string{row.Timestamp.Time.Format(time.RFC3339), row.Event, row.Level, row.ActorUsername.String, row.RequestID.String, strconv.FormatBool(row.Success), row.Reason.String, string(metadata)})
	}
	writer.Flush()
}

func (h *AuditLogHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	const pageSize = 50

	rows, err := h.Queries.ListAuditLogs(ctx, db.ListAuditLogsParams{
		Limit:  pageSize,
		Offset: int32((page - 1) * pageSize),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar auditoría")
		return
	}
	total, err := h.Queries.CountAuditLogs(ctx)
	if err != nil {
		total = 0
	}

	dtos := make([]auditLogDTO, 0, len(rows))
	for _, row := range rows {
		dtos = append(dtos, toAuditLogDTO(row))
	}
	writeDataMeta(w, http.StatusOK, dtos, map[string]any{"page": page, "pageSize": pageSize, "total": total})
}
