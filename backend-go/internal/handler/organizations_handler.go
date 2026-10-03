package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OrganizationsHandler cubre /api/organizations y /api/log-sources
// (spec/04-contratos-api.md "Organizaciones"; Fase 6 tareas 1-2). Clientes,
// contratas, carriers y la operación interna son una sola tabla con `type`;
// la vista `clients` de la DB es solo compatibilidad semántica.
type OrganizationsHandler struct {
	Pool     *pgxpool.Pool
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
	// ViaOrganizationID: mandante a través del cual se atiende ("JUNJI vía Mundo").
	ViaOrganizationID *uuid.UUID `json:"viaOrganizationId"`
	ViaName           *string    `json:"viaName,omitempty"`
}

func toOrganizationDTO(o db.Organization) organizationDTO {
	return organizationDTO{ID: o.ID, Name: o.Name, Code: o.Code, Type: o.Type, Active: o.Active, CreatedAt: o.CreatedAt.Time, ViaOrganizationID: uuidPtr(o.ViaOrganizationID)}
}

// validType: el tipo existe en organization_types (configurables desde la 000013).
func (h *OrganizationsHandler) validType(r *http.Request, code string) bool {
	_, err := h.Queries.GetOrganizationType(r.Context(), code)
	return err == nil
}

// List es GET /api/organizations?type=&active=&clients=true. `clients=true`
// trae las de los tipos que cuentan como cliente (Cliente, Mandante…).
func (h *OrganizationsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	params := db.ListOrganizationsParams{Active: queryBool(q.Get("active")), ClientsOnly: q.Get("clients") == "true"}
	if t := q.Get("type"); t != "" {
		params.Type = pgtype.Text{String: t, Valid: true}
	}
	orgs, err := h.Queries.ListOrganizations(r.Context(), params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar las organizaciones")
		return
	}
	dtos := make([]organizationDTO, 0, len(orgs))
	for _, o := range orgs {
		d := toOrganizationDTO(db.Organization{ID: o.ID, Name: o.Name, Code: o.Code, Type: o.Type, Active: o.Active, CreatedAt: o.CreatedAt, ViaOrganizationID: o.ViaOrganizationID})
		d.ViaName = textPtr(o.ViaName)
		dtos = append(dtos, d)
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
	if name == "" || code == "" || !h.validType(r, req.Type) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name, code y un type existente son obligatorios")
		return
	}
	org, err := h.Queries.CreateOrganization(ctx, db.CreateOrganizationParams{Name: name, Code: code, Type: req.Type})
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
	// ViaOrganizationID: presente (aunque sea null) cambia el mandante; ausente no lo toca.
	ViaOrganizationID nullableUUID `json:"viaOrganizationId"`
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
		if !h.validType(r, *req.Type) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "type inválido")
			return
		}
		params.Type = pgtype.Text{String: *req.Type, Valid: true}
	}
	if req.ViaOrganizationID.Set {
		if req.ViaOrganizationID.Value != nil && *req.ViaOrganizationID.Value == id {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "una organización no puede ser su propio mandante")
			return
		}
		params.SetVia = true
		if req.ViaOrganizationID.Value != nil {
			params.ViaOrganizationID = pgtype.UUID{Bytes: *req.ViaOrganizationID.Value, Valid: true}
		}
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
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se pudo actualizar la organización (¿el mandante existe?)")
		return
	}
	h.AuditLog.Log(ctx, "organization.update", audit.LevelInfo, audit.Success(), map[string]any{"organizationId": id.String()})
	writeData(w, http.StatusOK, toOrganizationDTO(org))
}

// nullableUUID distingue "no vino" de "vino null" en un PATCH.
type nullableUUID struct {
	Set   bool
	Value *uuid.UUID
}

func (o *nullableUUID) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var v uuid.UUID
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

// --- Tipos de organización (configurables, comentario del dueño #12) ---

type organizationTypeDTO struct {
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	IsClient      bool    `json:"isClient"`
	System        bool    `json:"system"`
	Organizations int64   `json:"organizations"`
}

// ListTypes es GET /api/organization-types (cualquier usuario: las pantallas
// muestran el nombre del tipo).
func (h *OrganizationsHandler) ListTypes(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListOrganizationTypes(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los tipos")
		return
	}
	out := make([]organizationTypeDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, organizationTypeDTO{Code: t.Code, Name: t.Name, Description: textPtr(t.Description), IsClient: t.IsClient, System: t.System, Organizations: t.Organizations})
	}
	writeData(w, http.StatusOK, out)
}

var typeCodeRe = regexp.MustCompile(`^[a-z0-9_]{2,40}$`)

// CreateType es POST /api/organization-types {code, name, description?, isClient}.
func (h *OrganizationsHandler) CreateType(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		Description string `json:"description"`
		IsClient    bool   `json:"isClient"`
	}
	if err := decodeJSON(w, r, &req); err != nil || !typeCodeRe.MatchString(req.Code) || strings.TrimSpace(req.Name) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name y code (minúsculas, números y _; 2 a 40) son obligatorios")
		return
	}
	t, err := h.Queries.CreateOrganizationType(r.Context(), db.CreateOrganizationTypeParams{Code: req.Code, Name: strings.TrimSpace(req.Name), Description: nonEmptyText(&req.Description), IsClient: req.IsClient})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe un tipo con code "+req.Code)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el tipo")
		return
	}
	h.AuditLog.Log(r.Context(), "organization_type.create", audit.LevelInfo, audit.Success(), map[string]any{"code": t.Code})
	writeData(w, http.StatusCreated, organizationTypeDTO{Code: t.Code, Name: t.Name, Description: textPtr(t.Description), IsClient: t.IsClient, System: t.System})
}

// PatchType es PATCH /api/organization-types/{code} {name?, description?, isClient?}.
// Los de sistema también se renombran.
func (h *OrganizationsHandler) PatchType(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		IsClient    *bool   `json:"isClient"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo inválido")
		return
	}
	code := r.PathValue("code")
	if req.IsClient != nil && code == "client" && !*req.IsClient {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el tipo Cliente siempre cuenta como cliente")
		return
	}
	t, err := h.Queries.UpdateOrganizationType(r.Context(), db.UpdateOrganizationTypeParams{Code: code, Name: nonEmptyText(req.Name), Description: nonEmptyText(req.Description), IsClient: optionalBool(req.IsClient)})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el tipo")
		return
	}
	h.AuditLog.Log(r.Context(), "organization_type.update", audit.LevelInfo, audit.Success(), map[string]any{"code": code})
	writeData(w, http.StatusOK, organizationTypeDTO{Code: t.Code, Name: t.Name, Description: textPtr(t.Description), IsClient: t.IsClient, System: t.System})
}

// DeleteType es DELETE /api/organization-types/{code}?moveTo=otro. Si hay
// organizaciones de ese tipo, primero pasan a `moveTo` (obligatorio en ese
// caso), todo en una transacción. Los de sistema no se borran.
func (h *OrganizationsHandler) DeleteType(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code, moveTo := r.PathValue("code"), r.URL.Query().Get("moveTo")
	t, err := h.Queries.GetOrganizationType(ctx, code)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo no encontrado")
		return
	}
	if t.System {
		problemdetails.Write(w, r, http.StatusConflict, "system-type", "este tipo lo usa la aplicación: se puede renombrar pero no eliminar")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el tipo")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	moved := int64(0)
	if moveTo != "" {
		if moveTo == code || !h.validType(r, moveTo) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "moveTo debe ser otro tipo existente")
			return
		}
		if moved, err = q.MoveOrganizationsToType(ctx, db.MoveOrganizationsToTypeParams{FromCode: code, ToCode: moveTo}); err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron mover las organizaciones")
			return
		}
	}
	if _, err = q.DeleteOrganizationType(ctx, code); err != nil {
		// FK: quedan organizaciones de este tipo y no se dijo a cuál pasan.
		problemdetails.Write(w, r, http.StatusConflict, "type-in-use", "hay organizaciones de este tipo: elige a qué tipo pasan (moveTo)")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el tipo")
		return
	}
	h.AuditLog.Log(ctx, "organization_type.delete", audit.LevelWarn, audit.Success(), map[string]any{"code": code, "movedTo": moveTo, "moved": moved})
	w.WriteHeader(http.StatusNoContent)
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

// Delete es DELETE /api/organizations/{id} (admin). Solo borra una
// organización sin nada asociado: con servicios, contactos, tickets, equipos
// o activos responde 409 con el detalle, para desactivarla o mover esos datos
// antes (los contactos caerían en cascada y el resto quedaría huérfano).
func (h *OrganizationsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "organización no encontrada")
		return
	}
	ctx := r.Context()
	dep, err := h.Queries.OrganizationDependents(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo revisar la organización")
		return
	}
	var parts []string
	for _, p := range []struct {
		n    int64
		name string
	}{{dep.Services, "servicios"}, {dep.Contacts, "contactos"}, {dep.Tickets, "tickets"}, {dep.Teams, "equipos"}, {dep.Assets, "activos"}, {dep.Other, "otras asignaciones"}} {
		if p.n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", p.n, p.name))
		}
	}
	if len(parts) > 0 {
		problemdetails.Write(w, r, http.StatusConflict, "organization-in-use", "no se puede eliminar: tiene "+strings.Join(parts, ", ")+". Desactívala o mueve esos datos a otra organización.")
		return
	}
	n, err := h.Queries.DeleteOrganization(ctx, id)
	if err != nil || n == 0 {
		problemdetails.Write(w, r, 404, "not-found", "organización no encontrada")
		return
	}
	h.AuditLog.Log(ctx, "organization.delete", audit.LevelWarn, audit.Success(), map[string]any{"organizationId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}
