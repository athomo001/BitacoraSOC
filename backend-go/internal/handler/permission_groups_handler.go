package handler

import (
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
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

type permissionGroupDTO struct {
	ID           uuid.UUID `json:"id"`
	Code         string    `json:"code"`
	Name         string    `json:"name"`
	ModuleScope  string    `json:"moduleScope"`
	Capabilities []string  `json:"capabilities"`
	Active       bool      `json:"active"`
}

func toPermissionGroupDTO(g db.PermissionGroup) permissionGroupDTO {
	return permissionGroupDTO{
		ID: g.ID, Code: g.Code, Name: g.Name,
		ModuleScope: string(g.ModuleScope), Capabilities: g.Capabilities, Active: g.Active,
	}
}

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
	dtos := make([]permissionGroupDTO, 0, len(groups))
	for _, g := range groups {
		dtos = append(dtos, toPermissionGroupDTO(g))
	}
	writeData(w, http.StatusOK, dtos)
}

type createPermissionGroupRequest struct {
	Code         string   `json:"code"`
	Name         string   `json:"name"`
	ModuleScope  string   `json:"moduleScope"`
	Capabilities []string `json:"capabilities"`
}

func (h *PermissionGroupsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createPermissionGroupRequest
	if err := decodeJSON(w, r, &req); err != nil || req.Code == "" || req.Name == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "code y name son obligatorios")
		return
	}
	scope := req.ModuleScope
	if scope == "" {
		scope = "both"
	}
	group, err := h.Queries.CreatePermissionGroup(ctx, db.CreatePermissionGroupParams{
		Code: req.Code, Name: req.Name,
		ModuleScope:  db.PermissionGroupModuleScope(scope),
		Capabilities: req.Capabilities,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "el code ya existe")
		return
	}
	h.AuditLog.Log(ctx, "permissiongroup.create", audit.LevelInfo, audit.Success(), map[string]any{"code": group.Code})
	writeData(w, http.StatusCreated, toPermissionGroupDTO(group))
}

type patchPermissionGroupRequest struct {
	Name         *string  `json:"name"`
	ModuleScope  *string  `json:"moduleScope"`
	Capabilities []string `json:"capabilities"`
	Active       *bool    `json:"active"`
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
	if req.ModuleScope != nil {
		params.ModuleScope = db.NullPermissionGroupModuleScope{PermissionGroupModuleScope: db.PermissionGroupModuleScope(*req.ModuleScope), Valid: true}
	}
	if req.Capabilities != nil {
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
	h.AuditLog.Log(ctx, "permissiongroup.update", audit.LevelInfo, audit.Success(), map[string]any{"groupId": id.String()})
	writeData(w, http.StatusOK, toPermissionGroupDTO(group))
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
	dtos := make([]permissionGroupDTO, 0, len(groups))
	for _, g := range groups {
		dtos = append(dtos, toPermissionGroupDTO(g))
	}
	h.AuditLog.Log(ctx, "user.permissiongroups.replace", audit.LevelInfo, audit.Success(), map[string]any{"userId": userID.String(), "groupCount": len(dtos)})
	writeData(w, http.StatusOK, map[string]any{"user": toUserDTO(user), "permissionGroups": dtos})
}

// MyCapabilities es GET /api/users/me/capabilities — unión de capacidades de
// todos los grupos del usuario, ya cruzada contra app_config.soc/noc
// enabled (admin bypassea todo esto, siempre tiene acceso completo).
func (h *PermissionGroupsHandler) MyCapabilities(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	authUser, ok := middleware.UserFromContext(ctx)
	if !ok {
		problemdetails.Write(w, r, http.StatusUnauthorized, "missing-token", "no autenticado")
		return
	}

	if authUser.Role == "admin" {
		writeData(w, http.StatusOK, map[string]any{"moduleScope": "both", "capabilities": []string{}})
		return
	}

	groups, err := h.Queries.ListUserPermissionGroups(ctx, authUser.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las capacidades")
		return
	}

	config, err := h.Queries.GetAppConfig(ctx)
	socEnabled, nocEnabled := false, false
	if err == nil {
		socEnabled, nocEnabled = config.SocModuleEnabled, config.NocModuleEnabled
	}

	capabilitySet := map[string]bool{}
	scopeHasSOC, scopeHasNOC := false, false
	for _, g := range groups {
		for _, c := range g.Capabilities {
			capabilitySet[c] = true
		}
		switch g.ModuleScope {
		case "soc":
			scopeHasSOC = true
		case "noc":
			scopeHasNOC = true
		case "both":
			scopeHasSOC, scopeHasNOC = true, true
		}
	}
	scopeHasSOC = scopeHasSOC && socEnabled
	scopeHasNOC = scopeHasNOC && nocEnabled

	moduleScope := "none"
	switch {
	case scopeHasSOC && scopeHasNOC:
		moduleScope = "both"
	case scopeHasSOC:
		moduleScope = "soc"
	case scopeHasNOC:
		moduleScope = "noc"
	}

	capabilities := make([]string, 0, len(capabilitySet))
	for c := range capabilitySet {
		capabilities = append(capabilities, c)
	}
	writeData(w, http.StatusOK, map[string]any{"moduleScope": moduleScope, "capabilities": capabilities})
}
