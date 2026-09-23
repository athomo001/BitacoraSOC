package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// TeamsHandler cubre /api/team-groups, /api/teams/*, /api/assets (módulo NOC)
// — spec/04-contratos-api.md sección "Escalación NOC/SOC", Fase 6 tareas 2 y
// 4. Un equipo es la unidad a la que escala el motor de la Fase 7: un team
// de 1 persona es el caso SOC clásico, uno de N con team_coverage es una
// cuadrilla NOC (spec/01-arquitectura.md sección 4).
type TeamsHandler struct {
	Queries    *db.Queries
	AuditLog   *audit.Logger
	NOCEnabled func(r *http.Request) bool // para incluir/omitir coverage en el detalle
}

var teamKinds = map[string]bool{"escalation": true, "oncall": true, "raci": true, "contractor_field": true, "noc_internal": true}

type teamGroupDTO struct {
	ID       uuid.UUID  `json:"id"`
	Name     string     `json:"name"`
	Slug     string     `json:"slug"`
	ClientID *uuid.UUID `json:"organizationId,omitempty"`
	Active   bool       `json:"active"`
}

func (h *TeamsHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	orgID, err := queryUUID(q.Get("organizationId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
		return
	}
	groups, err := h.Queries.ListTeamGroups(r.Context(), db.ListTeamGroupsParams{ClientID: orgID, Active: queryBool(q.Get("active"))})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los grupos")
		return
	}
	dtos := make([]teamGroupDTO, 0, len(groups))
	for _, g := range groups {
		dtos = append(dtos, teamGroupDTO{ID: g.ID, Name: g.Name, Slug: g.Slug, ClientID: uuidPtr(g.ClientID), Active: g.Active})
	}
	writeData(w, http.StatusOK, dtos)
}

type createTeamGroupRequest struct {
	Name           string     `json:"name"`
	Slug           string     `json:"slug"`
	OrganizationID *uuid.UUID `json:"organizationId"`
}

func (h *TeamsHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createTeamGroupRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name es obligatorio")
		return
	}
	slug := slugify(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	g, err := h.Queries.CreateTeamGroup(ctx, db.CreateTeamGroupParams{Name: strings.TrimSpace(req.Name), Slug: slug, ClientID: optionalUUID(req.OrganizationID)})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-slug", "ya existe un grupo con slug "+slug)
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la organización indicada no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el grupo")
		return
	}
	h.AuditLog.Log(ctx, "team_group.create", audit.LevelInfo, audit.Success(), map[string]any{"slug": slug})
	writeData(w, http.StatusCreated, teamGroupDTO{ID: g.ID, Name: g.Name, Slug: g.Slug, ClientID: uuidPtr(g.ClientID), Active: g.Active})
}

type teamDTO struct {
	ID               uuid.UUID     `json:"id"`
	Name             string        `json:"name"`
	Slug             string        `json:"slug"`
	Kind             string        `json:"kind"`
	Audience         string        `json:"audience"`
	OrganizationID   *uuid.UUID    `json:"organizationId,omitempty"`
	OrganizationName *string       `json:"organizationName,omitempty"`
	TeamGroupID      *uuid.UUID    `json:"teamGroupId,omitempty"`
	Active           bool          `json:"active"`
	MemberCount      *int32        `json:"memberCount,omitempty"`
	Members          []memberDTO   `json:"members,omitempty"`
	Coverage         []coverageDTO `json:"coverage,omitempty"`
}

func toTeamDTO(t db.Team) teamDTO {
	return teamDTO{ID: t.ID, Name: t.Name, Slug: t.Slug, Kind: t.Kind, Audience: string(t.Audience),
		OrganizationID: uuidPtr(t.OrganizationID), TeamGroupID: uuidPtr(t.TeamGroupID), Active: t.Active}
}

func (h *TeamsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	orgID, err1 := queryUUID(q.Get("organizationId"))
	groupID, err2 := queryUUID(q.Get("teamGroupId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId/teamGroupId inválido")
		return
	}
	var audience db.NullTeamAudience
	if a := q.Get("audience"); a != "" {
		audience = db.NullTeamAudience{TeamAudience: db.TeamAudience(a), Valid: a == "internal" || a == "client"}
	}
	teams, err := h.Queries.ListTeams(r.Context(), db.ListTeamsParams{
		Kind: queryText(q.Get("kind")), OrganizationID: orgID, TeamGroupID: groupID, Audience: audience, Active: queryBool(q.Get("active")),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los equipos")
		return
	}
	dtos := make([]teamDTO, 0, len(teams))
	for _, t := range teams {
		dto := teamDTO{ID: t.ID, Name: t.Name, Slug: t.Slug, Kind: t.Kind, Audience: string(t.Audience),
			OrganizationID: uuidPtr(t.OrganizationID), OrganizationName: textPtr(t.OrganizationName),
			TeamGroupID: uuidPtr(t.TeamGroupID), Active: t.Active}
		count := t.MemberCount
		dto.MemberCount = &count
		dtos = append(dtos, dto)
	}
	writeData(w, http.StatusOK, dtos)
}

type memberDTO struct {
	ID            uuid.UUID  `json:"id"`
	UserID        *uuid.UUID `json:"userId,omitempty"`
	ContactID     *uuid.UUID `json:"contactId,omitempty"`
	DisplayName   string     `json:"displayName"`
	RecipientType string     `json:"recipientType"`
	RoleInTeam    string     `json:"roleInTeam"`
	Priority      int32      `json:"priority"`
}

type coverageDTO struct {
	TerritorialUnitID uuid.UUID `json:"territorialUnitId"`
	Name              string    `json:"name"`
	Code              string    `json:"code"`
	Kind              string    `json:"kind"`
	Priority          int32     `json:"priority"`
}

// Get devuelve el equipo con sus miembros (y su cobertura territorial si el
// módulo NOC está activo) — lo que la Fase 7 va a mostrar al resolver.
func (h *TeamsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	team, err := h.Queries.GetTeam(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return
	}
	dto := toTeamDTO(team)
	members, err := h.Queries.ListTeamMembers(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los miembros")
		return
	}
	dto.Members = []memberDTO{}
	for _, m := range members {
		dto.Members = append(dto.Members, memberDTO{ID: m.ID, UserID: uuidPtr(m.UserID), ContactID: uuidPtr(m.ContactID),
			DisplayName: m.DisplayName, RecipientType: string(m.RecipientType), RoleInTeam: string(m.RoleInTeam), Priority: m.Priority})
	}
	if h.NOCEnabled != nil && h.NOCEnabled(r) {
		cov, err := h.Queries.ListTeamCoverage(ctx, id)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la cobertura")
			return
		}
		dto.Coverage = []coverageDTO{}
		for _, c := range cov {
			dto.Coverage = append(dto.Coverage, coverageDTO{TerritorialUnitID: c.TerritorialUnitID, Name: c.Name, Code: c.Code, Kind: string(c.Kind), Priority: c.Priority})
		}
	}
	writeData(w, http.StatusOK, dto)
}

type createTeamRequest struct {
	Name           string     `json:"name"`
	Slug           string     `json:"slug"`
	Kind           string     `json:"kind"`
	OrganizationID *uuid.UUID `json:"organizationId"`
	TeamGroupID    *uuid.UUID `json:"teamGroupId"`
	Audience       string     `json:"audience"`
}

func (h *TeamsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createTeamRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name es obligatorio")
		return
	}
	if req.Kind == "" {
		req.Kind = "escalation"
	}
	if req.Audience == "" {
		req.Audience = "internal"
	}
	if !teamKinds[req.Kind] || (req.Audience != "internal" && req.Audience != "client") {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "kind (escalation|oncall|raci|contractor_field|noc_internal) o audience (internal|client) inválido")
		return
	}
	slug := slugify(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	team, err := h.Queries.CreateTeam(ctx, db.CreateTeamParams{
		Name: strings.TrimSpace(req.Name), Slug: slug, Kind: req.Kind, OrganizationID: optionalUUID(req.OrganizationID),
		TeamGroupID: optionalUUID(req.TeamGroupID), Audience: db.TeamAudience(req.Audience),
	})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-slug", "ya existe un equipo con slug "+slug)
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la organización o el grupo indicado no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el equipo")
		return
	}
	h.AuditLog.Log(ctx, "team.create", audit.LevelInfo, audit.Success(), map[string]any{"teamId": team.ID.String(), "slug": slug, "kind": req.Kind})
	writeData(w, http.StatusCreated, toTeamDTO(team))
}

type patchTeamRequest struct {
	Name           *string    `json:"name"`
	Kind           *string    `json:"kind"`
	OrganizationID *uuid.UUID `json:"organizationId"`
	TeamGroupID    *uuid.UUID `json:"teamGroupId"`
	Audience       *string    `json:"audience"`
	Active         *bool      `json:"active"`
}

func (h *TeamsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req patchTeamRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	params := db.UpdateTeamParams{ID: id, Name: nonEmptyText(req.Name), OrganizationID: optionalUUID(req.OrganizationID),
		TeamGroupID: optionalUUID(req.TeamGroupID), Active: optionalBool(req.Active)}
	if req.Kind != nil {
		if !teamKinds[*req.Kind] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "kind inválido")
			return
		}
		params.Kind = pgtype.Text{String: *req.Kind, Valid: true}
	}
	if req.Audience != nil {
		if *req.Audience != "internal" && *req.Audience != "client" {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "audience inválido")
			return
		}
		params.Audience = db.NullTeamAudience{TeamAudience: db.TeamAudience(*req.Audience), Valid: true}
	}
	team, err := h.Queries.UpdateTeam(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la organización o el grupo indicado no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el equipo")
		return
	}
	h.AuditLog.Log(ctx, "team.update", audit.LevelInfo, audit.Success(), map[string]any{"teamId": id.String()})
	writeData(w, http.StatusOK, toTeamDTO(team))
}

type addMemberRequest struct {
	UserID        *uuid.UUID `json:"userId"`
	ContactID     *uuid.UUID `json:"contactId"`
	RecipientType string     `json:"recipientType"`
	RoleInTeam    string     `json:"roleInTeam"`
	Priority      int32      `json:"priority"`
}

func (h *TeamsHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req addMemberRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if (req.UserID == nil) == (req.ContactID == nil) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica exactamente uno: userId o contactId")
		return
	}
	if req.RecipientType == "" {
		req.RecipientType = "to"
	}
	if req.RoleInTeam == "" {
		req.RoleInTeam = "primary"
	}
	if (req.RecipientType != "to" && req.RecipientType != "cc") || (req.RoleInTeam != "primary" && req.RoleInTeam != "backup" && req.RoleInTeam != "lead") {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "recipientType (to|cc) o roleInTeam (primary|backup|lead) inválido")
		return
	}
	if _, err := h.Queries.GetTeam(ctx, teamID); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return
	}
	m, err := h.Queries.AddTeamMember(ctx, db.AddTeamMemberParams{
		TeamID: teamID, UserID: optionalUUID(req.UserID), ContactID: optionalUUID(req.ContactID),
		RecipientType: db.RecipientType(req.RecipientType), RoleInTeam: db.TeamRole(req.RoleInTeam), Priority: req.Priority,
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el usuario o contacto indicado no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar el miembro")
		return
	}
	h.AuditLog.Log(ctx, "team.member.add", audit.LevelInfo, audit.Success(), map[string]any{"teamId": teamID.String(), "memberId": m.ID.String()})
	writeData(w, http.StatusCreated, memberDTO{ID: m.ID, UserID: uuidPtr(m.UserID), ContactID: uuidPtr(m.ContactID),
		RecipientType: string(m.RecipientType), RoleInTeam: string(m.RoleInTeam), Priority: m.Priority})
}

func (h *TeamsHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	teamID, err1 := uuid.Parse(r.PathValue("id"))
	memberID, err2 := uuid.Parse(r.PathValue("memberId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	n, err := h.Queries.RemoveTeamMember(r.Context(), db.RemoveTeamMemberParams{ID: memberID, TeamID: teamID})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo quitar el miembro")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "miembro no encontrado en ese equipo")
		return
	}
	h.AuditLog.Log(r.Context(), "team.member.remove", audit.LevelInfo, audit.Success(), map[string]any{"teamId": teamID.String(), "memberId": memberID.String()})
	writeNoContent(w)
}

// ===== Cobertura territorial (módulo NOC) =====

type coverageRequest struct {
	TerritorialUnitID uuid.UUID `json:"territorialUnitId"`
	Priority          int32     `json:"priority"`
}

func (h *TeamsHandler) ListCoverage(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	cov, err := h.Queries.ListTeamCoverage(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la cobertura")
		return
	}
	dtos := make([]coverageDTO, 0, len(cov))
	for _, c := range cov {
		dtos = append(dtos, coverageDTO{TerritorialUnitID: c.TerritorialUnitID, Name: c.Name, Code: c.Code, Kind: string(c.Kind), Priority: c.Priority})
	}
	writeData(w, http.StatusOK, dtos)
}

// AddCoverage es POST /api/teams/:id/coverage — upsert: repetir la misma
// unidad solo cambia la prioridad (principal vs respaldo territorial).
func (h *TeamsHandler) AddCoverage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req coverageRequest
	if err := decodeJSON(w, r, &req); err != nil || req.TerritorialUnitID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "territorialUnitId es obligatorio")
		return
	}
	c, err := h.Queries.UpsertTeamCoverage(ctx, db.UpsertTeamCoverageParams{TeamID: teamID, TerritorialUnitID: req.TerritorialUnitID, Priority: req.Priority})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el equipo o la unidad territorial no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la cobertura")
		return
	}
	h.AuditLog.Log(ctx, "team.coverage.set", audit.LevelInfo, audit.Success(), map[string]any{"teamId": teamID.String(), "territorialUnitId": req.TerritorialUnitID.String(), "priority": req.Priority})
	writeData(w, http.StatusCreated, map[string]any{"teamId": c.TeamID, "territorialUnitId": c.TerritorialUnitID, "priority": c.Priority})
}

func (h *TeamsHandler) RemoveCoverage(w http.ResponseWriter, r *http.Request) {
	teamID, err1 := uuid.Parse(r.PathValue("id"))
	unitID, err2 := uuid.Parse(r.PathValue("territorialUnitId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	n, err := h.Queries.RemoveTeamCoverage(r.Context(), db.RemoveTeamCoverageParams{TeamID: teamID, TerritorialUnitID: unitID})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo quitar la cobertura")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ese equipo no cubre esa unidad")
		return
	}
	writeNoContent(w)
}

// ===== Activos (módulo NOC) =====

type assetDTO struct {
	ID                uuid.UUID       `json:"id"`
	Type              string          `json:"type"`
	Name              string          `json:"name"`
	Code              string          `json:"code"`
	IPAddress         *string         `json:"ipAddress,omitempty"`
	Address           *string         `json:"address,omitempty"`
	Latitude          *float64        `json:"latitude,omitempty"`
	Longitude         *float64        `json:"longitude,omitempty"`
	Metadata          json.RawMessage `json:"metadata"`
	TerritorialUnitID uuid.UUID       `json:"territorialUnitId"`
	ClientID          *uuid.UUID      `json:"clientId,omitempty"`
	ContractorID      *uuid.UUID      `json:"contractorId,omitempty"`
	LogSourceID       *uuid.UUID      `json:"logSourceId,omitempty"`
	ParentAssetID     *uuid.UUID      `json:"parentAssetId,omitempty"`
	Active            bool            `json:"active"`
}

func toAssetDTO(a db.GetAssetRow) assetDTO {
	dto := assetDTO{ID: a.ID, Type: string(a.Type), Name: a.Name, Code: a.Code, Address: textPtr(a.Address),
		Latitude: a.Latitude, Longitude: a.Longitude, Metadata: a.Metadata, TerritorialUnitID: a.TerritorialUnitID,
		ClientID: uuidPtr(a.ClientID), ContractorID: uuidPtr(a.ContractorID), LogSourceID: uuidPtr(a.LogSourceID),
		ParentAssetID: uuidPtr(a.ParentAssetID), Active: a.Active}
	if a.IpAddress != "" {
		ip := a.IpAddress
		dto.IPAddress = &ip
	}
	if len(dto.Metadata) == 0 {
		dto.Metadata = json.RawMessage(`{}`)
	}
	return dto
}

var assetTypes = map[string]bool{"circuit": true, "link": true, "site": true, "device": true}

func (h *TeamsHandler) ListAssets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	unit, e1 := queryUUID(q.Get("territorialUnitId"))
	client, e2 := queryUUID(q.Get("clientId"))
	contractor, e3 := queryUUID(q.Get("contractorId"))
	if e1 != nil || e2 != nil || e3 != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "territorialUnitId/clientId/contractorId inválido")
		return
	}
	var typeFilter db.NullAssetType
	if t := q.Get("type"); t != "" {
		if !assetTypes[t] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "type debe ser circuit, link, site o device")
			return
		}
		typeFilter = db.NullAssetType{AssetType: db.AssetType(t), Valid: true}
	}
	rows, err := h.Queries.ListAssets(r.Context(), db.ListAssetsParams{TerritorialUnitID: unit, ClientID: client, ContractorID: contractor, Type: typeFilter})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los activos")
		return
	}
	dtos := make([]assetDTO, 0, len(rows))
	for _, a := range rows {
		dtos = append(dtos, toAssetDTO(db.GetAssetRow(a)))
	}
	writeData(w, http.StatusOK, dtos)
}

type assetRequest struct {
	Type              *string         `json:"type"`
	Name              *string         `json:"name"`
	Code              *string         `json:"code"`
	TerritorialUnitID *uuid.UUID      `json:"territorialUnitId"`
	ClientID          *uuid.UUID      `json:"clientId"`
	ContractorID      *uuid.UUID      `json:"contractorId"`
	LogSourceID       *uuid.UUID      `json:"logSourceId"`
	ParentAssetID     *uuid.UUID      `json:"parentAssetId"`
	IPAddress         *string         `json:"ipAddress"`
	Address           *string         `json:"address"`
	Latitude          *float64        `json:"latitude"`
	Longitude         *float64        `json:"longitude"`
	Metadata          json.RawMessage `json:"metadata"`
	Active            *bool           `json:"active"`
}

// validateAsset revisa lo común a crear y editar; devuelve (ip normalizada, metadata, status, motivo).
func (h *TeamsHandler) validateAsset(r *http.Request, req assetRequest, exceptID uuid.UUID) (pgtype.Text, []byte, int, string) {
	var ip pgtype.Text
	if req.IPAddress != nil && strings.TrimSpace(*req.IPAddress) != "" {
		addr, err := netip.ParseAddr(strings.TrimSpace(*req.IPAddress))
		if err != nil {
			return ip, nil, http.StatusBadRequest, "ipAddress con formato inválido"
		}
		ip = pgtype.Text{String: addr.String(), Valid: true}
		taken, err := h.Queries.AssetIPTaken(r.Context(), db.AssetIPTakenParams{Ip: ip.String, ExceptID: exceptID})
		if err != nil {
			return ip, nil, http.StatusInternalServerError, "no se pudo validar la IP"
		}
		if taken {
			return ip, nil, http.StatusConflict, "ya hay un activo con la IP " + ip.String
		}
	}
	if !validCoordinates(req.Latitude, req.Longitude) {
		return ip, nil, http.StatusBadRequest, "latitud/longitud fuera de rango"
	}
	var metadata []byte
	if trimmed := bytes.TrimSpace(req.Metadata); len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null")) {
		if trimmed[0] != '{' || !json.Valid(trimmed) {
			return ip, nil, http.StatusBadRequest, "metadata debe ser un objeto JSON"
		}
		metadata = trimmed
	}
	return ip, metadata, 0, ""
}

func (h *TeamsHandler) CreateAsset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req assetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.Type == nil || !assetTypes[*req.Type] || req.Name == nil || strings.TrimSpace(*req.Name) == "" ||
		req.Code == nil || strings.TrimSpace(*req.Code) == "" || req.TerritorialUnitID == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "type (circuit|link|site|device), name, code y territorialUnitId son obligatorios")
		return
	}
	ip, metadata, status, reason := h.validateAsset(r, req, uuid.Nil)
	if status != 0 {
		problemdetails.Write(w, r, status, map[int]string{400: "invalid-payload", 409: "duplicate-ip", 500: "internal-error"}[status], reason)
		return
	}
	if metadata == nil {
		metadata = []byte(`{}`)
	}
	if _, err := h.Queries.GetTerritorialUnit(ctx, *req.TerritorialUnitID); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "territorialUnitId inexistente")
		return
	}
	id, err := h.Queries.CreateAsset(ctx, db.CreateAssetParams{
		Type: db.AssetType(*req.Type), Name: strings.TrimSpace(*req.Name), Code: strings.TrimSpace(*req.Code), IpAddress: ip,
		Metadata: metadata, Address: nonEmptyText(req.Address), Latitude: req.Latitude, Longitude: req.Longitude,
		TerritorialUnitID: *req.TerritorialUnitID, ClientID: optionalUUID(req.ClientID), ContractorID: optionalUUID(req.ContractorID),
		LogSourceID: optionalUUID(req.LogSourceID), ParentAssetID: optionalUUID(req.ParentAssetID),
	})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe un activo con ese code")
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente, contrata, fuente o activo padre inexistente")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el activo")
		return
	}
	asset, _ := h.Queries.GetAsset(ctx, id)
	h.AuditLog.Log(ctx, "asset.create", audit.LevelInfo, audit.Success(), map[string]any{"assetId": id.String(), "code": asset.Code})
	writeData(w, http.StatusCreated, toAssetDTO(asset))
}

func (h *TeamsHandler) PatchAsset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req assetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ip, metadata, status, reason := h.validateAsset(r, req, id)
	if status != 0 {
		problemdetails.Write(w, r, status, map[int]string{400: "invalid-payload", 409: "duplicate-ip", 500: "internal-error"}[status], reason)
		return
	}
	n, err := h.Queries.UpdateAsset(ctx, db.UpdateAssetParams{
		ID: id, Name: nonEmptyText(req.Name), IpAddress: ip, Metadata: metadata, Address: nonEmptyText(req.Address),
		Latitude: req.Latitude, Longitude: req.Longitude, ClientID: optionalUUID(req.ClientID),
		ContractorID: optionalUUID(req.ContractorID), LogSourceID: optionalUUID(req.LogSourceID), Active: optionalBool(req.Active),
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente, contrata o fuente inexistente")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el activo")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "activo no encontrado")
		return
	}
	asset, _ := h.Queries.GetAsset(ctx, id)
	h.AuditLog.Log(ctx, "asset.update", audit.LevelInfo, audit.Success(), map[string]any{"assetId": id.String()})
	writeData(w, http.StatusOK, toAssetDTO(asset))
}
