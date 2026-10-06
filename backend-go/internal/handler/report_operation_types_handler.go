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

// Tipos de operación del informe de incidente (catalogOperationTypes del
// legacy). Al elegir uno, "Información adicional" toma su texto por defecto.

type operationTypeDTO struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	InfoDefault string    `json:"infoDefault"`
	Enabled     bool      `json:"enabled"`
}

func toOperationTypeDTO(t db.ReportOperationType) operationTypeDTO {
	return operationTypeDTO{ID: t.ID, Name: t.Name, InfoDefault: t.InfoDefault, Enabled: t.Enabled}
}

type operationTypeRequest struct {
	Name        string `json:"name"`
	InfoDefault string `json:"infoDefault"`
	Enabled     *bool  `json:"enabled"`
}

func (req *operationTypeRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	req.InfoDefault = strings.TrimSpace(req.InfoDefault)
	if req.Name == "" || len([]rune(req.Name)) > 120 {
		return "el nombre no puede quedar vacío (hasta 120 caracteres)"
	}
	if len([]rune(req.InfoDefault)) > 4000 {
		return "el texto por defecto va hasta 4000 caracteres"
	}
	return ""
}

func (req operationTypeRequest) enabled() bool {
	return req.Enabled == nil || *req.Enabled
}

// ListOperationTypes es GET /api/report-operation-types.
func (h *ReportsHandler) ListOperationTypes(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListReportOperationTypes(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los tipos de operación")
		return
	}
	out := make([]operationTypeDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, toOperationTypeDTO(t))
	}
	writeData(w, http.StatusOK, out)
}

// CreateOperationType es POST /api/report-operation-types (admin).
func (h *ReportsHandler) CreateOperationType(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req operationTypeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	t, err := h.Queries.CreateReportOperationType(ctx, db.CreateReportOperationTypeParams{Name: req.Name, InfoDefault: req.InfoDefault, Enabled: req.enabled()})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "conflict", "ya existe un tipo de operación con ese nombre")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el tipo de operación")
		return
	}
	h.AuditLog.Log(ctx, "report.operation_type.created", audit.LevelInfo, audit.Success(), map[string]any{"id": t.ID.String(), "name": t.Name})
	writeData(w, http.StatusCreated, toOperationTypeDTO(t))
}

// UpdateOperationType es PUT /api/report-operation-types/{id} (admin).
func (h *ReportsHandler) UpdateOperationType(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo de operación no encontrado")
		return
	}
	var req operationTypeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	t, err := h.Queries.UpdateReportOperationType(ctx, db.UpdateReportOperationTypeParams{ID: id, Name: req.Name, InfoDefault: req.InfoDefault, Enabled: req.enabled()})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo de operación no encontrado")
		return
	}
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "conflict", "ya existe un tipo de operación con ese nombre")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el tipo de operación")
		return
	}
	h.AuditLog.Log(ctx, "report.operation_type.updated", audit.LevelInfo, audit.Success(), map[string]any{"id": t.ID.String(), "name": t.Name, "enabled": t.Enabled})
	writeData(w, http.StatusOK, toOperationTypeDTO(t))
}

// DeleteOperationType es DELETE /api/report-operation-types/{id} (admin).
// Los informes ya enviados guardan el nombre como texto: no se ven afectados.
func (h *ReportsHandler) DeleteOperationType(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo de operación no encontrado")
		return
	}
	n, err := h.Queries.DeleteReportOperationType(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el tipo de operación")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo de operación no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "report.operation_type.deleted", audit.LevelInfo, audit.Success(), map[string]any{"id": id.String()})
	w.WriteHeader(http.StatusNoContent)
}
