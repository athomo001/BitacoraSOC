package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// SystemFeaturesHandler cubre GET /api/system-features y
// PATCH /api/system-features/:code (spec/04-contratos-api.md "Gobernanza
// Dinámica de Módulos desde la GUI"). No hay POST/DELETE a propósito: un
// feature es código que ya vive en el binario — el catálogo lo siembra la
// migración 000002 y el admin solo lo prende/apaga (docs/adr/0009).
type SystemFeaturesHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Hub      eventPublisher
}

type systemFeatureDTO struct {
	Code          string          `json:"code"`
	Name          string          `json:"name"`
	Description   *string         `json:"description,omitempty"`
	IsEnabled     bool            `json:"isEnabled"`
	ConfigPayload json.RawMessage `json:"configPayload"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

func toSystemFeatureDTO(f db.SystemFeature) systemFeatureDTO {
	dto := systemFeatureDTO{Code: f.Code, Name: f.Name, IsEnabled: f.IsEnabled, ConfigPayload: f.ConfigPayload}
	if f.Description.Valid {
		dto.Description = &f.Description.String
	}
	if f.UpdatedAt.Valid {
		dto.UpdatedAt = f.UpdatedAt.Time
	}
	if len(dto.ConfigPayload) == 0 {
		dto.ConfigPayload = json.RawMessage(`{}`)
	}
	return dto
}

func (h *SystemFeaturesHandler) List(w http.ResponseWriter, r *http.Request) {
	features, err := h.Queries.ListSystemFeatures(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los features")
		return
	}
	dtos := make([]systemFeatureDTO, 0, len(features))
	for _, f := range features {
		dtos = append(dtos, toSystemFeatureDTO(f))
	}
	writeData(w, http.StatusOK, dtos)
}

type patchSystemFeatureRequest struct {
	IsEnabled     *bool           `json:"isEnabled"`
	ConfigPayload json.RawMessage `json:"configPayload"`
}

func (h *SystemFeaturesHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.PathValue("code")
	var req patchSystemFeatureRequest
	if err := decodeJSON(w, r, &req); err != nil || req.IsEnabled == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "isEnabled (bool) es obligatorio")
		return
	}
	var payload []byte
	if len(req.ConfigPayload) > 0 && !bytes.Equal(bytes.TrimSpace(req.ConfigPayload), []byte("null")) {
		trimmed := bytes.TrimSpace(req.ConfigPayload)
		if len(trimmed) == 0 || trimmed[0] != '{' {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "configPayload debe ser un objeto JSON")
			return
		}
		payload = trimmed
	}

	actor, _ := middleware.UserFromContext(ctx)
	feature, err := h.Queries.UpdateSystemFeature(ctx, db.UpdateSystemFeatureParams{
		Code: code, IsEnabled: *req.IsEnabled, ConfigPayload: payload,
		UpdatedBy: pgtype.UUID{Bytes: actor.ID, Valid: actor.ID != uuid.Nil},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no existe el feature "+code)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el feature")
		return
	}
	dto := toSystemFeatureDTO(feature)
	h.AuditLog.Log(ctx, "system_feature.update", audit.LevelWarn, audit.Success(), map[string]any{
		"code": code, "isEnabled": feature.IsEnabled,
	})
	publishSync(ctx, h.Hub, "system_feature.updated", dto)
	writeData(w, http.StatusOK, dto)
}
