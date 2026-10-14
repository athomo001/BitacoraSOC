package handler

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// PermissionGroupsHandler cubre /api/permission-groups/* y
// /api/users/:id/permission-groups, /api/users/me/capabilities —
// spec/04-contratos-api.md sección "Grupos de Permisos Atomizados".
type PermissionGroupsHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

// permissionGroupDTO: un grupo es área(s) + nivel + perfil (spec/16 §3.3).
// Areas son códigos ("soc", "noc", "ti"…).
type permissionGroupDTO struct {
	ID           uuid.UUID  `json:"id"`
	Code         string     `json:"code"`
	Name         string     `json:"name"`
	Areas        []string   `json:"areas"`
	Profile      string     `json:"profile"`
	LevelID      *uuid.UUID `json:"levelId,omitempty"`
	Capabilities []string   `json:"capabilities"`
	Active       bool       `json:"active"`
}

func toPermissionGroupDTO(g db.PermissionGroup, areas []string) permissionGroupDTO {
	if areas == nil {
		areas = []string{}
	}
	return permissionGroupDTO{
		ID: g.ID, Code: g.Code, Name: g.Name, Areas: areas, Profile: g.Profile, LevelID: uuidPtr(g.LevelID),
		Capabilities: g.Capabilities, Active: g.Active,
	}
}

// groupDTOs arma los DTO con sus áreas en una sola consulta.
func (h *PermissionGroupsHandler) groupDTOs(ctx context.Context, groups []db.PermissionGroup) ([]permissionGroupDTO, error) {
	ids := make([]uuid.UUID, 0, len(groups))
	for _, g := range groups {
		ids = append(ids, g.ID)
	}
	rows, err := h.Queries.ListGroupAreaCodes(ctx, ids)
	if err != nil {
		return nil, err
	}
	byGroup := map[uuid.UUID][]string{}
	for _, r := range rows {
		byGroup[r.PermissionGroupID] = append(byGroup[r.PermissionGroupID], r.Code)
	}
	dtos := make([]permissionGroupDTO, 0, len(groups))
	for _, g := range groups {
		dtos = append(dtos, toPermissionGroupDTO(g, byGroup[g.ID]))
	}
	return dtos, nil
}

// validProfile: los perfiles de spec/16 §3.2.
func validProfile(p string) bool { return p == "operativo" || p == "resolutor" || p == "gestion" }

// setGroupAreas reemplaza las áreas del grupo; todas deben existir.
func (h *PermissionGroupsHandler) setGroupAreas(ctx context.Context, groupID uuid.UUID, codes []string) error {
	codes = slices.Compact(slices.Sorted(slices.Values(codes)))
	if err := h.Queries.ClearGroupAreas(ctx, groupID); err != nil {
		return err
	}
	n, err := h.Queries.AddGroupAreasByCode(ctx, db.AddGroupAreasByCodeParams{GroupID: groupID, Codes: codes})
	if err != nil {
		return err
	}
	if int(n) != len(codes) {
		return errUnknownArea
	}
	return nil
}

var errUnknownArea = errors.New("área desconocida")

func (h *PermissionGroupsHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var activeFilter pgtype.Bool
	if active := r.URL.Query().Get("active"); active != "" {
		activeFilter = pgtype.Bool{Bool: active == "true", Valid: true}
	}
	groups, err := h.Queries.ListPermissionGroups(ctx, activeFilter)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar grupos de permisos")
		return
	}
	dtos, err := h.groupDTOs(ctx, groups)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar grupos de permisos")
		return
	}
	writeData(w, http.StatusOK, dtos)
}

// KnownCapabilities es la lista cerrada de capacidades que el backend
// realmente revisa (middleware.RequireCapability). Un grupo solo puede
// llevar estas: antes se escribían a mano y un error de tipeo ("directory:wirte")
// se guardaba sin aviso y no otorgaba nada. La pantalla las muestra como casillas.
var KnownCapabilities = []string{"directory:write", "directory:delete", "tickets:change_client", CapAreaLead}

func validCapabilities(capabilities []string) (string, bool) {
	for _, capability := range capabilities {
		if !slices.Contains(KnownCapabilities, capability) {
			return capability, false
		}
	}
	return "", true
}

type createPermissionGroupRequest struct {
	Code         string     `json:"code"`
	Name         string     `json:"name"`
	Areas        []string   `json:"areas"`
	Profile      string     `json:"profile"`
	LevelID      *uuid.UUID `json:"levelId"`
	Capabilities []string   `json:"capabilities"`
}

func (h *PermissionGroupsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createPermissionGroupRequest
	if err := decodeJSON(w, r, &req); err != nil || req.Code == "" || req.Name == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "code y name son obligatorios")
		return
	}
	if unknown, ok := validCapabilities(req.Capabilities); !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "capacidad desconocida: "+unknown)
		return
	}
	if req.Profile == "" {
		req.Profile = "operativo"
	}
	if !validProfile(req.Profile) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "perfil desconocido: "+req.Profile)
		return
	}
	group, err := h.Queries.CreatePermissionGroup(ctx, db.CreatePermissionGroupParams{
		Code: req.Code, Name: req.Name, Capabilities: req.Capabilities, Profile: req.Profile, LevelID: optionalUUID(req.LevelID),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "el code ya existe o el nivel no existe")
		return
	}
	if err := h.setGroupAreas(ctx, group.ID, req.Areas); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "alguna de las áreas no existe")
		return
	}
	h.AuditLog.Log(ctx, "permissiongroup.create", audit.LevelInfo, audit.Success(), map[string]any{"code": group.Code, "areas": req.Areas, "profile": req.Profile})
	writeData(w, http.StatusCreated, toPermissionGroupDTO(group, slices.Compact(slices.Sorted(slices.Values(req.Areas)))))
}

type patchPermissionGroupRequest struct {
	Name    *string   `json:"name"`
	Areas   *[]string `json:"areas"`
	Profile *string   `json:"profile"`
	// LevelID: presente (aunque sea null) cambia el nivel; null lo quita.
	LevelID      *uuid.UUID `json:"levelId"`
	SetLevel     bool       `json:"setLevel"`
	Capabilities []string   `json:"capabilities"`
	Active       *bool      `json:"active"`
}

func (h *PermissionGroupsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req patchPermissionGroupRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	params := db.UpdatePermissionGroupParams{ID: id}
	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.Profile != nil {
		if !validProfile(*req.Profile) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "perfil desconocido: "+*req.Profile)
			return
		}
		params.Profile = pgtype.Text{String: *req.Profile, Valid: true}
	}
	if req.SetLevel {
		params.SetLevel, params.LevelID = true, optionalUUID(req.LevelID)
	}
	if req.Capabilities != nil {
		if unknown, ok := validCapabilities(req.Capabilities); !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "capacidad desconocida: "+unknown)
			return
		}
		params.Capabilities = req.Capabilities
	}
	if req.Active != nil {
		params.Active = pgtype.Bool{Bool: *req.Active, Valid: true}
	}

	group, err := h.Queries.UpdatePermissionGroup(ctx, params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "grupo no encontrado")
		return
	}
	if req.Areas != nil {
		if err := h.setGroupAreas(ctx, id, *req.Areas); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "alguna de las áreas no existe")
			return
		}
	}
	h.AuditLog.Log(ctx, "permissiongroup.update", audit.LevelInfo, audit.Success(), map[string]any{"groupId": id.String(), "areasChanged": req.Areas != nil})
	dtos, err := h.groupDTOs(ctx, []db.PermissionGroup{group})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el grupo")
		return
	}
	writeData(w, http.StatusOK, dtos[0])
}

type replaceUserGroupsRequest struct {
	PermissionGroupIDs []uuid.UUID `json:"permissionGroupIds"`
}

func (h *PermissionGroupsHandler) ReplaceUserGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req replaceUserGroupsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	actor, _ := middleware.UserFromContext(ctx)

	user, err := h.Queries.GetUserByID(ctx, userID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}

	if err := h.Queries.ReplaceUserPermissionGroups(ctx, userID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar los grupos")
		return
	}
	for _, groupID := range req.PermissionGroupIDs {
		assignedBy := pgtype.UUID{Bytes: actor.ID, Valid: actor.ID != uuid.Nil}
		if err := h.Queries.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
			UserID: userID, PermissionGroupID: groupID, AssignedBy: assignedBy,
		}); err != nil {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "uno de los permissionGroupIds no existe")
			return
		}
	}

	groups, err := h.Queries.ListUserPermissionGroups(ctx, userID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer los grupos actualizados")
		return
	}
	dtos, err := h.groupDTOs(ctx, groups)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer los grupos actualizados")
		return
	}
	h.AuditLog.Log(ctx, "user.permissiongroups.replace", audit.LevelInfo, audit.Success(), map[string]any{"userId": userID.String(), "groupCount": len(dtos)})
	writeData(w, http.StatusOK, map[string]any{"user": toUserDTO(user), "permissionGroups": dtos})
}

// ListUserGroups es GET /api/users/:id/permission-groups. Sin esta lectura,
// la pantalla de Usuarios mostraba a todos sin grupos y el primer cambio
// reemplazaba (PUT) los grupos reales por uno solo.
func (h *PermissionGroupsHandler) ListUserGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	if _, err := h.Queries.GetUserByID(ctx, userID); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	groups, err := h.Queries.ListUserPermissionGroups(ctx, userID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer los grupos del usuario")
		return
	}
	dtos, err := h.groupDTOs(ctx, groups)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer los grupos del usuario")
		return
	}
	writeData(w, http.StatusOK, dtos)
}

// MyCapabilities es GET /api/users/me/capabilities — unión de capacidades y
// áreas de todos los grupos del usuario. moduleScope es lo que eso abre de
// SOC/NOC, ya cruzado con las áreas activas (admin bypassea todo esto,
// siempre tiene acceso completo).
func (h *PermissionGroupsHandler) MyCapabilities(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	authUser, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}

	if authUser.Role == "admin" {
		writeData(w, http.StatusOK, map[string]any{"moduleScope": "both", "capabilities": []string{}, "areas": []string{}, "profiles": []string{"operativo"}})
		return
	}

	groups, err := h.Queries.ListUserPermissionGroups(ctx, authUser.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las capacidades")
		return
	}

	instance, _ := repository.ModuleFlags(ctx, h.Queries)
	areas, err := h.Queries.ListUserAreaCodes(ctx, authUser.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las capacidades")
		return
	}
	// Solo los grupos Operativos abren SOC/NOC (spec/16 §3.2, 9c).
	moduleAreas, err := h.Queries.ListUserModuleAreaCodes(ctx, authUser.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las capacidades")
		return
	}
	profiles, err := h.Queries.ListUserProfiles(ctx, authUser.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las capacidades")
		return
	}

	capabilitySet := map[string]bool{}
	for _, g := range groups {
		for _, c := range g.Capabilities {
			capabilitySet[c] = true
		}
	}
	// Misma regla que middleware.RequireModule — lo que el frontend muestra
	// y lo que el backend deja pasar no pueden divergir.
	moduleScope := modules.EffectiveScope(instance, moduleAreas)

	capabilities := make([]string, 0, len(capabilitySet))
	for c := range capabilitySet {
		capabilities = append(capabilities, c)
	}
	if areas == nil {
		areas = []string{}
	}
	if profiles == nil {
		profiles = []string{}
	}
	writeData(w, http.StatusOK, map[string]any{"moduleScope": moduleScope, "capabilities": capabilities, "areas": areas, "profiles": profiles})
}
