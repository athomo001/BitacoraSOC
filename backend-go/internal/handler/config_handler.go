package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// eventPublisher es lo que los handlers de configuración necesitan del hub
// SSE — avisar a los clientes conectados que algo global cambió, para que
// el frontend refresque sin recargar (spec/04-contratos-api.md
// "Gobernanza Dinámica": "emite evento SSE de sincronización").
type eventPublisher interface {
	Publish(ctx context.Context, eventType, scope string, payload []byte) (eventbus.Event, error)
}

// publishSync publica un evento de sincronización en scope 'general'. Mejor
// esfuerzo: si falla, el cambio ya quedó persistido y el cliente lo verá al
// recargar — no se revierte un PATCH exitoso por un SSE caído.
func publishSync(ctx context.Context, hub eventPublisher, eventType string, payload any) {
	if hub == nil {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = hub.Publish(ctx, eventType, string(db.EntryScopeGeneral), body)
}

// ConfigHandler cubre PATCH /api/config/modules y
// GET/PATCH /api/config/territorial-labels (spec/04-contratos-api.md,
// HU-0b/HU-TERR-1).
type ConfigHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Hub      eventPublisher
}

type modulesResponse struct {
	SocEnabled bool `json:"socEnabled"`
	NocEnabled bool `json:"nocEnabled"`
}

type patchModulesRequest struct {
	SocEnabled *bool `json:"socEnabled"`
	NocEnabled *bool `json:"nocEnabled"`
}

// PatchModules activa/desactiva SOC/NOC post-bootstrap. Puramente de
// acceso: nunca borra ni migra datos del módulo apagado (HU-0b) — solo
// cambia 2 booleanos que RequireModule lee en cada request.
func (h *ConfigHandler) PatchModules(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req patchModulesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	config, err := h.Queries.GetAppConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	soc, noc := config.SocModuleEnabled, config.NocModuleEnabled
	if req.SocEnabled != nil {
		soc = *req.SocEnabled
	}
	if req.NocEnabled != nil {
		noc = *req.NocEnabled
	}
	if !soc && !noc {
		problemdetails.Write(w, r, http.StatusBadRequest, "no-module-selected", "al menos un módulo (SOC o NOC) debe quedar activo")
		return
	}

	updated, err := h.Queries.SetModuleFlags(ctx, db.SetModuleFlagsParams{
		SocModuleEnabled: pgtype.Bool{Bool: soc, Valid: true},
		NocModuleEnabled: pgtype.Bool{Bool: noc, Valid: true},
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar los módulos")
		return
	}
	resp := modulesResponse{SocEnabled: updated.SocModuleEnabled, NocEnabled: updated.NocModuleEnabled}
	h.AuditLog.Log(ctx, "config.modules.update", audit.LevelWarn, audit.Success(), map[string]any{
		"before": modulesResponse{SocEnabled: config.SocModuleEnabled, NocEnabled: config.NocModuleEnabled},
		"after":  resp,
	})
	publishSync(ctx, h.Hub, "config.modules.updated", resp)
	writeData(w, http.StatusOK, resp)
}

// territorialLabels es la forma de app_config.territorial_kind_labels.
type territorialLabels struct {
	Country string `json:"country"`
	Region  string `json:"region"`
	Zone    string `json:"zone"`
	Site    string `json:"site"`
}

func (h *ConfigHandler) GetTerritorialLabels(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	config, err := h.Queries.GetAppConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	var labels territorialLabels
	if err := json.Unmarshal(config.TerritorialKindLabels, &labels); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "etiquetas territoriales corruptas")
		return
	}
	writeData(w, http.StatusOK, labels)
}

type patchTerritorialLabelsRequest struct {
	Country *string `json:"country"`
	Region  *string `json:"region"`
	Zone    *string `json:"zone"`
	Site    *string `json:"site"`
}

const maxTerritorialLabelLength = 40

// PatchTerritorialLabels renombra niveles de la jerarquía (ej. region →
// "Departamento"). Solo presentación: no toca el ENUM territorial_kind ni
// ninguna fila de territorial_units (HU-TERR-1).
func (h *ConfigHandler) PatchTerritorialLabels(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req patchTerritorialLabelsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	changes := map[string]string{}
	for kind, value := range map[string]*string{"country": req.Country, "region": req.Region, "zone": req.Zone, "site": req.Site} {
		if value == nil {
			continue
		}
		trimmed := strings.TrimSpace(*value)
		if trimmed == "" || len([]rune(trimmed)) > maxTerritorialLabelLength {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-label", "la etiqueta de "+kind+" no puede quedar vacía ni superar 40 caracteres")
			return
		}
		changes[kind] = trimmed
	}
	if len(changes) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se envió ninguna etiqueta para cambiar")
		return
	}
	body, _ := json.Marshal(changes)
	merged, err := h.Queries.MergeTerritorialLabels(ctx, body)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron guardar las etiquetas")
		return
	}
	var labels territorialLabels
	_ = json.Unmarshal(merged, &labels)
	h.AuditLog.Log(ctx, "config.territorial_labels.update", audit.LevelInfo, audit.Success(), map[string]any{"changes": changes})
	publishSync(ctx, h.Hub, "config.territorial_labels.updated", labels)
	writeData(w, http.StatusOK, labels)
}
