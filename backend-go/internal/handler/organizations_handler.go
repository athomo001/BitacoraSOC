package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// OrganizationsHandler cubre /api/organizations y /api/log-sources
// (spec/04-contratos-api.md "Organizaciones"; Fase 6 tareas 1-2). Clientes,
// contratas, carriers y la operación interna son una sola tabla con `type`;
// la vista `clients` de la DB es solo compatibilidad semántica.
type OrganizationsHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

type organizationDTO struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Code      string    `json:"code"`
	Type      string    `json:"type"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

func toOrganizationDTO(o db.Organization) organizationDTO {
	return organizationDTO{ID: o.ID, Name: o.Name, Code: o.Code, Type: string(o.Type), Active: o.Active, CreatedAt: o.CreatedAt.Time}
}

var organizationTypes = map[string]bool{"client": true, "contractor": true, "carrier": true, "internal": true}

func (h *OrganizationsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var typeFilter db.NullOrganizationType
	if t := q.Get("type"); t != "" {
		if !organizationTypes[t] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "type debe ser client, contractor, carrier o internal")
			return
		}
		typeFilter = db.NullOrganizationType{OrganizationType: db.OrganizationType(t), Valid: true}
	}
	orgs, err := h.Queries.ListOrganizations(r.Context(), db.ListOrganizationsParams{Type: typeFilter, Active: queryBool(q.Get("active"))})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar las organizaciones")
		return
	}
	dtos := make([]organizationDTO, 0, len(orgs))
	for _, o := range orgs {
		dtos = append(dtos, toOrganizationDTO(o))
	}
	writeData(w, http.StatusOK, dtos)
}

type createOrganizationRequest struct {
	Name string `json:"name"`
	Code string `json:"code"`
	Type string `json:"type"`
}

func (h *OrganizationsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createOrganizationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name, code := strings.TrimSpace(req.Name), strings.TrimSpace(req.Code)
	if req.Type == "" {
		req.Type = "client"
	}
	if name == "" || code == "" || !organizationTypes[req.Type] {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name, code y type (client|contractor|carrier|internal) son obligatorios")
		return
	}
	org, err := h.Queries.CreateOrganization(ctx, db.CreateOrganizationParams{Name: name, Code: code, Type: db.OrganizationType(req.Type)})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe una organización con code "+code)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la organización")
		return
	}
	h.AuditLog.Log(ctx, "organization.create", audit.LevelInfo, audit.Success(), map[string]any{"organizationId": org.ID.String(), "code": code, "type": req.Type})
	writeData(w, http.StatusCreated, toOrganizationDTO(org))
}

type patchOrganizationRequest struct {
	Name   *string `json:"name"`
	Code   *string `json:"code"`
	Type   *string `json:"type"`
	Active *bool   `json:"active"`
}

func (h *OrganizationsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req patchOrganizationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	params := db.UpdateOrganizationParams{ID: id, Name: nonEmptyText(req.Name), Code: nonEmptyText(req.Code), Active: optionalBool(req.Active)}
	if req.Type != nil {
		if !organizationTypes[*req.Type] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "type inválido")
			return
		}
		params.Type = db.NullOrganizationType{OrganizationType: db.OrganizationType(*req.Type), Valid: true}
	}
	org, err := h.Queries.UpdateOrganization(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "organización no encontrada")
		return
	}
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ese code ya está en uso")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la organización")
		return
	}
	h.AuditLog.Log(ctx, "organization.update", audit.LevelInfo, audit.Success(), map[string]any{"organizationId": id.String()})
	writeData(w, http.StatusOK, toOrganizationDTO(org))
}

// ===== Catálogo de fuentes de log / tecnologías (catalog_log_sources) =====

type logSourceDTO struct {
	ID            uuid.UUID `json:"id"`
	Code          string    `json:"code"`
	DisplayName   string    `json:"displayName"`
	Category      string    `json:"category"`
	DefaultParser *string   `json:"defaultParser,omitempty"`
	Active        bool      `json:"active"`
}

func toLogSourceDTO(s db.CatalogLogSource) logSourceDTO {
	return logSourceDTO{ID: s.ID, Code: s.Code, DisplayName: s.DisplayName, Category: s.Category, DefaultParser: textPtr(s.DefaultParser), Active: s.Active}
}

func (h *OrganizationsHandler) ListLogSources(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sources, err := h.Queries.ListLogSources(r.Context(), db.ListLogSourcesParams{Category: queryText(q.Get("category")), Active: queryBool(q.Get("active"))})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar el catálogo")
		return
	}
	dtos := make([]logSourceDTO, 0, len(sources))
	for _, s := range sources {
		dtos = append(dtos, toLogSourceDTO(s))
	}
	writeData(w, http.StatusOK, dtos)
}

type createLogSourceRequest struct {
	Code          string  `json:"code"`
	DisplayName   string  `json:"displayName"`
	Category      string  `json:"category"`
	DefaultParser *string `json:"defaultParser"`
}

func (h *OrganizationsHandler) CreateLogSource(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createLogSourceRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Code) == "" || strings.TrimSpace(req.DisplayName) == "" || strings.TrimSpace(req.Category) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "code, displayName y category son obligatorios")
		return
	}
	src, err := h.Queries.CreateLogSource(ctx, db.CreateLogSourceParams{
		Code: strings.TrimSpace(req.Code), DisplayName: strings.TrimSpace(req.DisplayName),
		Category: strings.TrimSpace(req.Category), DefaultParser: nonEmptyText(req.DefaultParser),
	})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe una fuente con ese code")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la fuente")
		return
	}
	h.AuditLog.Log(ctx, "log_source.create", audit.LevelInfo, audit.Success(), map[string]any{"code": src.Code})
	writeData(w, http.StatusCreated, toLogSourceDTO(src))
}

type patchLogSourceRequest struct {
	DisplayName   *string `json:"displayName"`
	Category      *string `json:"category"`
	DefaultParser *string `json:"defaultParser"`
	Active        *bool   `json:"active"`
}

func (h *OrganizationsHandler) PatchLogSource(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req patchLogSourceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	src, err := h.Queries.UpdateLogSource(ctx, db.UpdateLogSourceParams{
		ID: id, DisplayName: nonEmptyText(req.DisplayName), Category: nonEmptyText(req.Category),
		DefaultParser: nonEmptyText(req.DefaultParser), Active: optionalBool(req.Active),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "fuente no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la fuente")
		return
	}
	h.AuditLog.Log(ctx, "log_source.update", audit.LevelInfo, audit.Success(), map[string]any{"logSourceId": id.String()})
	writeData(w, http.StatusOK, toLogSourceDTO(src))
}
