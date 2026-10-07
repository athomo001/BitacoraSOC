package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Eventos del informe de incidente (catalogEvents del legacy, ~1.900). Al
// escribir el nombre del evento, Reportes sugiere del catálogo y rellena
// "Motivo" con su texto por defecto, como el report-generator del legacy.

const (
	reportEventSuggestLimit = 20
	reportEventPageSize     = 50
)

type reportEventDTO struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Parent        string    `json:"parent"`
	Description   string    `json:"description"`
	MotivoDefault string    `json:"motivoDefault"`
	Enabled       bool      `json:"enabled"`
}

func toReportEventDTO(e db.ReportEvent) reportEventDTO {
	return reportEventDTO{ID: e.ID, Name: e.Name, Parent: e.Parent, Description: e.Description, MotivoDefault: e.MotivoDefault, Enabled: e.Enabled}
}

type reportEventRequest struct {
	Name          string `json:"name"`
	Parent        string `json:"parent"`
	Description   string `json:"description"`
	MotivoDefault string `json:"motivoDefault"`
	Enabled       *bool  `json:"enabled"`
}

func (req *reportEventRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	req.Parent = strings.TrimSpace(req.Parent)
	req.Description = strings.TrimSpace(req.Description)
	req.MotivoDefault = strings.TrimSpace(req.MotivoDefault)
	switch {
	case req.Name == "" || len([]rune(req.Name)) > 200:
		return "el nombre no puede quedar vacío (hasta 200 caracteres)"
	case len([]rune(req.Parent)) > 200:
		return "la categoría va hasta 200 caracteres"
	case len([]rune(req.Description)) > 1000:
		return "la descripción va hasta 1000 caracteres"
	case len([]rune(req.MotivoDefault)) > 500:
		return "el motivo por defecto va hasta 500 caracteres"
	}
	return ""
}

// SuggestReportEvents es GET /api/report-events?q= : hasta 20 eventos activos.
func (h *ReportsHandler) SuggestReportEvents(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeData(w, http.StatusOK, []reportEventDTO{})
		return
	}
	if len([]rune(q)) > 100 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "q va hasta 100 caracteres")
		return
	}
	rows, err := h.Queries.SuggestReportEvents(r.Context(), db.SuggestReportEventsParams{Q: escapeLike(q), Lim: reportEventSuggestLimit})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los eventos")
		return
	}
	out := make([]reportEventDTO, 0, len(rows))
	for _, e := range rows {
		out = append(out, toReportEventDTO(e))
	}
	writeData(w, http.StatusOK, out)
}

// ListReportEvents es GET /api/report-events/all?q=&page= (admin): todo el
// catálogo, también los desactivados, paginado.
func (h *ReportsHandler) ListReportEvents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := escapeLike(strings.TrimSpace(r.URL.Query().Get("q")))
	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	rows, err := h.Queries.ListReportEvents(ctx, db.ListReportEventsParams{Q: q, Lim: reportEventPageSize, Off: int32((page - 1) * reportEventPageSize)})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los eventos")
		return
	}
	total, err := h.Queries.CountReportEvents(ctx, q)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron contar los eventos")
		return
	}
	out := make([]reportEventDTO, 0, len(rows))
	for _, e := range rows {
		out = append(out, toReportEventDTO(e))
	}
	writeDataMeta(w, http.StatusOK, out, map[string]any{"page": page, "pageSize": reportEventPageSize, "total": total})
}

// CreateReportEvent es POST /api/report-events (admin).
func (h *ReportsHandler) CreateReportEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req reportEventRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	e, err := h.Queries.CreateReportEvent(ctx, db.CreateReportEventParams{
		Name: req.Name, Parent: req.Parent, Description: req.Description, MotivoDefault: req.MotivoDefault, Enabled: req.Enabled == nil || *req.Enabled,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el evento")
		return
	}
	h.AuditLog.Log(ctx, "report.event.created", audit.LevelInfo, audit.Success(), map[string]any{"id": e.ID.String(), "name": e.Name})
	writeData(w, http.StatusCreated, toReportEventDTO(e))
}

// UpdateReportEvent es PUT /api/report-events/{id} (admin).
func (h *ReportsHandler) UpdateReportEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "evento no encontrado")
		return
	}
	var req reportEventRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	e, err := h.Queries.UpdateReportEvent(ctx, db.UpdateReportEventParams{
		ID: id, Name: req.Name, Parent: req.Parent, Description: req.Description, MotivoDefault: req.MotivoDefault, Enabled: req.Enabled == nil || *req.Enabled,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "evento no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el evento")
		return
	}
	h.AuditLog.Log(ctx, "report.event.updated", audit.LevelInfo, audit.Success(), map[string]any{"id": e.ID.String(), "name": e.Name, "enabled": e.Enabled})
	writeData(w, http.StatusOK, toReportEventDTO(e))
}

// DeleteReportEvent es DELETE /api/report-events/{id} (admin). Los informes
// ya enviados guardan el nombre como texto: no se ven afectados.
func (h *ReportsHandler) DeleteReportEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "evento no encontrado")
		return
	}
	n, err := h.Queries.DeleteReportEvent(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el evento")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "evento no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "report.event.deleted", audit.LevelInfo, audit.Success(), map[string]any{"id": id.String()})
	w.WriteHeader(http.StatusNoContent)
}
