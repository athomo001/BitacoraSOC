package handler

import (
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// UsersHandler cubre /api/users/* (admin) — spec/04-contratos-api.md
// sección Usuarios.
type UsersHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
}

func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var roleFilter db.NullUserRole
	if role := r.URL.Query().Get("role"); role != "" {
		roleFilter = db.NullUserRole{UserRole: db.UserRole(role), Valid: true}
	}
	var activeFilter pgtype.Bool
	if active := r.URL.Query().Get("active"); active != "" {
		activeFilter = pgtype.Bool{Bool: active == "true", Valid: true}
	}

	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{Role: roleFilter, Active: activeFilter})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar usuarios")
		return
	}
	dtos := make([]UserDTO, 0, len(users))
	for _, u := range users {
		dtos = append(dtos, toUserDTO(u))
	}
	writeData(w, http.StatusOK, dtos)
}

type createUserRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *UsersHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.Username == "" || req.Email == "" || req.Password == "" || req.Role == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "username/email/password/role son obligatorios")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo procesar la contraseña")
		return
	}

	user, err := h.Queries.CreateUser(ctx, db.CreateUserParams{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: hash,
		Role:         db.UserRole(req.Role),
		// Un admin crea la cuenta con contraseña temporal — el usuario la
		// cambia en su primer login (spec/04-contratos-api.md).
		MustChangePassword: true,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-user", "el username o email ya existe")
		return
	}

	h.AuditLog.Log(ctx, "users.create", audit.LevelInfo, audit.Success(), map[string]any{"username": user.Username, "role": string(user.Role)})
	writeData(w, http.StatusCreated, toUserDTO(user))
}

type patchUserRequest struct {
	Email      *string `json:"email"`
	Role       *string `json:"role"`
	CargoLabel *string `json:"cargoLabel"`
	Active     *bool   `json:"active"`
}

func (h *UsersHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req patchUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}

	params := db.UpdateUserAdminParams{ID: id}
	if req.Email != nil {
		params.Email = pgtype.Text{String: *req.Email, Valid: true}
	}
	if req.Role != nil {
		params.Role = db.NullUserRole{UserRole: db.UserRole(*req.Role), Valid: true}
	}
	if req.CargoLabel != nil {
		params.CargoLabel = pgtype.Text{String: *req.CargoLabel, Valid: true}
	}
	if req.Active != nil {
		params.Active = pgtype.Bool{Bool: *req.Active, Valid: true}
	}

	user, err := h.Queries.UpdateUserAdmin(ctx, params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "users.update", audit.LevelInfo, audit.Success(), map[string]any{"userId": id.String()})
	writeData(w, http.StatusOK, toUserDTO(user))
}

// Delete es un soft-delete (active=false) — ver comentario de
// DeactivateUser en sql/queries/users.sql: un DELETE real rompería la FK de
// audit_log.actor_user_id en cuanto ese usuario haya hecho algo auditado.
func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	if err := h.Queries.DeactivateUser(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "users.deactivate", audit.LevelWarn, audit.Success(), map[string]any{"userId": id.String()})
	writeNoContent(w)
}

type forceResetAllRequest struct {
	Reason string `json:"reason"`
}

func (h *UsersHandler) ForceResetAll(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req forceResetAllRequest
	if err := decodeJSON(w, r, &req); err != nil || req.Reason == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "reason es obligatorio")
		return
	}

	affected, err := h.Queries.ForceResetAllActivePasswords(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo forzar el reseteo")
		return
	}

	notified := 0
	sender, _, mailErr := buildMailSender(ctx, h.Queries, h.Crypto)
	for _, u := range affected {
		if mailErr == nil {
			if err := sendForceResetNotice(sender, u); err == nil {
				notified++
			}
		}
	}

	h.AuditLog.Log(ctx, "users.force_reset_all", audit.LevelWarn, audit.Success(), map[string]any{
		"reason":        req.Reason,
		"modifiedCount": len(affected),
	})
	writeData(w, http.StatusOK, map[string]any{"modifiedCount": len(affected), "notifiedCount": notified})
}

func sendForceResetNotice(sender *mail.Sender, u db.User) error {
	return sender.Send(u.Email, "Cambio de contraseña obligatorio - BitacoraSOC",
		"Por un incidente de seguridad, tu contraseña debe cambiarse en tu próximo inicio de sesión.")
}
