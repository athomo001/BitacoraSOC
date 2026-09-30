package handler

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// AuditLogHandler cubre GET /api/audit-logs y /export (admin|auditor) —
// spec/04-contratos-api.md. Los dos aceptan los mismos filtros, paridad con
// el legacy (audit-logs.js): ?event= (dominios o eventos exactos, separados
// por coma o repitiendo el parámetro: "auth,setup"),
// ?level=, ?result=ok|fail, ?actorUserId=, ?from=/?to= (RFC 3339) y ?q=
// (actor, IP, ruta, evento o motivo). El listado pagina con ?page=/?pageSize=.
type AuditLogHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

const (
	auditDefaultPageSize = 50
	auditMaxPageSize     = 200
)

type auditLogDTO struct {
	ID            string         `json:"id"`
	Timestamp     string         `json:"timestamp"`
	Event         string         `json:"event"`
	Level         string         `json:"level"`
	ActorUsername *string        `json:"actorUsername,omitempty"`
	ActorRole     *string        `json:"actorRole,omitempty"`
	RequestID     *string        `json:"requestId,omitempty"`
	RequestIP     *string        `json:"requestIp,omitempty"`
	RequestMethod *string        `json:"requestMethod,omitempty"`
	RequestPath   *string        `json:"requestPath,omitempty"`
	UserAgent     *string        `json:"userAgent,omitempty"`
	IPChanged     bool           `json:"ipChanged"`
	PreviousIP    *string        `json:"previousIp,omitempty"`
	Success       bool           `json:"success"`
	Reason        *string        `json:"reason,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

func toAuditLogDTO(a db.AuditLog) auditLogDTO {
	dto := auditLogDTO{
		ID:            a.ID.String(),
		Event:         a.Event,
		Level:         a.Level,
		ActorUsername: textPtr(a.ActorUsername),
		ActorRole:     textPtr(a.ActorRole),
		RequestID:     textPtr(a.RequestID),
		RequestIP:     textPtr(a.RequestIp),
		RequestMethod: textPtr(a.RequestMethod),
		RequestPath:   textPtr(a.RequestPath),
		UserAgent:     textPtr(a.UserAgent),
		IPChanged:     a.IpChanged,
		PreviousIP:    textPtr(a.PreviousIp),
		Success:       a.Success,
		Reason:        textPtr(a.Reason),
	}
	if a.Timestamp.Valid {
		dto.Timestamp = a.Timestamp.Time.Format(time.RFC3339)
	}
	if a.Metadata != nil {
		_ = json.Unmarshal(a.Metadata, &dto.Metadata)
	}
	return dto
}

// auditFilter son los filtros comunes al listado y al export, ya validados.
type auditFilter struct {
	Events      []string // nil = todos
	Level       pgtype.Text
	Success     pgtype.Bool
	ActorUserID pgtype.UUID
	FromDate    pgtype.Timestamptz
	ToDate      pgtype.Timestamptz
	Q           pgtype.Text
}

// likeEscaper deja el texto libre literal dentro de ILIKE: un "_" o "%" del
// usuario no debe actuar como comodín.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// parseAuditFilter devuelve el mensaje de error legible si algún filtro es inválido.
func parseAuditFilter(q map[string][]string) (auditFilter, string) {
	get := func(key string) string {
		if v := q[key]; len(v) > 0 {
			return strings.TrimSpace(v[0])
		}
		return ""
	}
	var f auditFilter
	for _, raw := range q["event"] {
		for _, v := range strings.Split(raw, ",") {
			if v = strings.ToLower(strings.TrimSpace(v)); v != "" {
				f.Events = append(f.Events, v)
			}
		}
	}
	if len(f.Events) > 20 {
		return f, "event admite hasta 20 valores"
	}
	switch v := get("level"); v {
	case "":
	case string(audit.LevelInfo), string(audit.LevelWarn), string(audit.LevelError):
		f.Level = pgtype.Text{String: v, Valid: true}
	default:
		return f, "level inválido (info, warn o error)"
	}
	switch v := get("result"); v {
	case "":
	case "ok":
		f.Success = pgtype.Bool{Bool: true, Valid: true}
	case "fail":
		f.Success = pgtype.Bool{Bool: false, Valid: true}
	default:
		return f, "result inválido (ok o fail)"
	}
	if v := get("actorUserId"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return f, "actorUserId inválido"
		}
		f.ActorUserID = pgtype.UUID{Bytes: id, Valid: true}
	}
	for key, dst := range map[string]*pgtype.Timestamptz{"from": &f.FromDate, "to": &f.ToDate} {
		if v := get(key); v != "" {
			value, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return f, key + " inválido (RFC 3339)"
			}
			*dst = pgtype.Timestamptz{Time: value, Valid: true}
		}
	}
	if f.FromDate.Valid && f.ToDate.Valid && !f.ToDate.Time.After(f.FromDate.Time) {
		return f, "to debe ser posterior a from"
	}
	if v := get("q"); v != "" {
		if len(v) > 200 {
			return f, "q admite hasta 200 caracteres"
		}
		f.Q = pgtype.Text{String: likeEscaper.Replace(v), Valid: true}
	}
	return f, ""
}

func (f auditFilter) metadata() map[string]any {
	m := map[string]any{}
	if f.Events != nil {
		m["event"] = f.Events
	}
	if f.Level.Valid {
		m["level"] = f.Level.String
	}
	if f.Success.Valid {
		m["success"] = f.Success.Bool
	}
	if f.ActorUserID.Valid {
		m["actorUserId"] = uuid.UUID(f.ActorUserID.Bytes).String()
	}
	if f.FromDate.Valid {
		m["from"] = f.FromDate.Time.Format(time.RFC3339)
	}
	if f.ToDate.Valid {
		m["to"] = f.ToDate.Time.Format(time.RFC3339)
	}
	if f.Q.Valid {
		m["q"] = f.Q.String
	}
	return m
}

func (h *AuditLogHandler) Export(w http.ResponseWriter, r *http.Request) {
	f, bad := parseAuditFilter(r.URL.Query())
	if bad != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", bad)
		return
	}
	if f.FromDate.Valid && f.ToDate.Valid && f.ToDate.Time.Sub(f.FromDate.Time) > 366*24*time.Hour {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "el rango máximo es de un año")
		return
	}
	rows, err := h.Queries.ListAuditLogsForExport(r.Context(), db.ListAuditLogsForExportParams{
		Events: f.Events, Level: f.Level, Success: f.Success, ActorUserID: f.ActorUserID, FromDate: f.FromDate, ToDate: f.ToDate, Q: f.Q,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar auditoría")
		return
	}
	// Sacar la auditoría del sistema también queda auditado (legacy: audit.logs.export).
	meta := f.metadata()
	meta["rows"] = len(rows)
	h.AuditLog.Log(r.Context(), "audit.logs.export", audit.LevelInfo, audit.Success(), meta)

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-logs.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"timestamp", "event", "level", "actor", "requestIp", "requestId", "success", "reason", "metadata"})
	for _, row := range rows {
		metadata, _ := json.Marshal(row.Metadata)
		_ = writer.Write([]string{row.Timestamp.Time.Format(time.RFC3339), row.Event, row.Level, row.ActorUsername.String, row.RequestIp.String, row.RequestID.String, strconv.FormatBool(row.Success), row.Reason.String, string(metadata)})
	}
	writer.Flush()
}

func (h *AuditLogHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	query := r.URL.Query()
	f, bad := parseAuditFilter(query)
	if bad != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", bad)
		return
	}
	page, _ := strconv.Atoi(query.Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	if pageSize < 1 {
		pageSize = auditDefaultPageSize
	}
	pageSize = min(pageSize, auditMaxPageSize)

	rows, err := h.Queries.ListAuditLogs(ctx, db.ListAuditLogsParams{
		Events: f.Events, Level: f.Level, Success: f.Success, ActorUserID: f.ActorUserID, FromDate: f.FromDate, ToDate: f.ToDate, Q: f.Q,
		PageLimit: int32(pageSize), PageOffset: int32((page - 1) * pageSize),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar auditoría")
		return
	}
	total, err := h.Queries.CountAuditLogs(ctx, db.CountAuditLogsParams{
		Events: f.Events, Level: f.Level, Success: f.Success, ActorUserID: f.ActorUserID, FromDate: f.FromDate, ToDate: f.ToDate, Q: f.Q,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo contar la auditoría")
		return
	}

	dtos := make([]auditLogDTO, 0, len(rows))
	for _, row := range rows {
		dtos = append(dtos, toAuditLogDTO(row))
	}
	writeDataMeta(w, http.StatusOK, dtos, map[string]any{"page": page, "pageSize": pageSize, "total": total})
}
