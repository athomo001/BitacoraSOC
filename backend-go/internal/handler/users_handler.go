package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// UsersHandler cubre /api/users/* (admin) — spec/04-contratos-api.md
// sección Usuarios.
type UsersHandler struct {
	Queries *db.Queries
	// Pool: eliminar va en su propia transacción (si la base lo rechaza por
	// historial, no deja abortada ninguna otra).
	Pool     txBeginner
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
	if rejectShortPassword(w, r, h.Queries, req.Password) {
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
	// Forzar cambio de contraseña a UNA persona (la pantalla de Usuarios);
	// force-reset-all sigue siendo el botón para todos.
	MustChangePassword *bool `json:"mustChangePassword"`
	// Cumpleaños "AAAA-MM-DD" ("" lo borra), como el formulario de usuarios
	// del legacy; lo usan los correos de cumpleaños.
	Birthday *string `json:"birthday"`
	// De dónde sale la contraseña (spec/20): auto (la del dominio si está en
	// el directorio) o local (solo la de la Bitácora). ldap lo pone el ingreso.
	AuthSource *string `json:"authSource"`
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

	if req.Role != nil && *req.Role != "admin" && *req.Role != "user" && *req.Role != "auditor" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "rol inválido")
		return
	}
	// Un admin no puede quitarse a sí mismo el rol ni desactivarse: dejaría la
	// instalación sin nadie que pueda deshacerlo desde la pantalla.
	if me, ok := middleware.UserFromContext(ctx); ok && me.ID == id {
		if (req.Role != nil && *req.Role != "admin") || (req.Active != nil && !*req.Active) {
			problemdetails.Write(w, r, http.StatusConflict, "self-lockout", "no puedes quitarte el rol de administrador ni desactivarte a ti mismo")
			return
		}
		// Pasar la propia cuenta del dominio a local la deja sin contraseña conocida.
		if req.AuthSource != nil {
			problemdetails.Write(w, r, http.StatusConflict, "self-lockout", "no puedes cambiar de dónde sale tu propia contraseña")
			return
		}
	}
	if req.AuthSource != nil && *req.AuthSource != authSourceAuto && *req.AuthSource != authSourceLocal {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "origen de la contraseña: auto o local")
		return
	}
	if req.MustChangePassword != nil && *req.MustChangePassword {
		if cur, err := h.Queries.GetUserByID(ctx, id); err == nil && domainManaged(ctx, h.Queries, cur) && req.AuthSource == nil {
			problemdetails.Write(w, r, http.StatusConflict, "password-managed-by-directory", "la contraseña de esta cuenta es la del dominio: se cambia allá")
			return
		}
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
	if req.MustChangePassword != nil {
		params.MustChangePassword = pgtype.Bool{Bool: *req.MustChangePassword, Valid: true}
	}
	if req.Birthday != nil {
		params.SetBirthday = true
		if v := strings.TrimSpace(*req.Birthday); v != "" {
			day, err := time.Parse("2006-01-02", v)
			if err != nil || day.After(time.Now()) || day.Year() < 1900 {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el cumpleaños va como AAAA-MM-DD y no puede ser futuro")
				return
			}
			params.Birthday = pgtype.Date{Time: day, Valid: true}
		}
	}

	user, err := h.Queries.UpdateUserAdmin(ctx, params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	details := map[string]any{"userId": id.String()}
	if req.AuthSource != nil && *req.AuthSource != user.AuthSource {
		if user, err = h.Queries.SetUserAuthSource(ctx, db.SetUserAuthSourceParams{ID: id, AuthSource: *req.AuthSource}); err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cambiar el origen de la contraseña")
			return
		}
		details["authSource"] = *req.AuthSource
	}
	h.AuditLog.Log(ctx, "users.update", audit.LevelInfo, audit.Success(), details)
	writeData(w, http.StatusOK, toUserDTO(user))
}

// Delete es DELETE /api/users/:id (decisión del dueño, 2026-10-21): borra de
// verdad, y de todos lados, a quien no tiene historial (un usuario creado por
// error). Si tiene historial —entró alguna vez, escribió entradas, tickets…—
// la base lo rechaza (audit_log y el resto lo referencian sin ON DELETE) y
// queda bloqueado: su nombre se sigue viendo en lo que hizo.
func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	if me, ok := middleware.UserFromContext(ctx); ok && me.ID == id {
		problemdetails.Write(w, r, http.StatusConflict, "self-lockout", "no puedes eliminarte a ti mismo")
		return
	}
	user, err := h.Queries.GetUserByID(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	n, err := h.deleteForever(ctx, id)
	if err == nil && n == 1 {
		h.AuditLog.Log(ctx, "users.delete", audit.LevelWarn, audit.Success(), map[string]any{"userId": id.String(), "username": user.Username})
		writeData(w, http.StatusOK, map[string]any{"deleted": true})
		return
	}
	if err != nil && !isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el usuario")
		return
	}
	if err := h.Queries.DeactivateUser(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "users.deactivate", audit.LevelWarn, audit.Success(), map[string]any{"userId": id.String(), "reason": "tiene historial"})
	writeData(w, http.StatusOK, map[string]any{"deleted": false})
}

func (h *UsersHandler) deleteForever(ctx context.Context, id uuid.UUID) (int64, error) {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // tras Commit no hace nada
	q := h.Queries.WithTx(tx)
	if err := q.DeleteBareTeamMemberships(ctx, pgUUIDOf(id)); err != nil {
		return 0, err
	}
	n, err := q.DeleteUserForever(ctx, id)
	if err != nil {
		return 0, err
	}
	return n, tx.Commit(ctx)
}

type userLinkDTO struct {
	Kind   string `json:"kind"` // guard | escalation | pool | shift | client | ticket | task | goal | asset
	Label  string `json:"label"`
	Detail string `json:"detail,omitempty"`
}

// Links es GET /api/users/:id/links: lo que la persona tiene a su nombre y
// habría que reasignar al bloquearla (al bloquear desaparece de guardias,
// escalamiento y pools; lo demás queda a su nombre hasta reasignarlo).
func (h *UsersHandler) Links(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	rows, err := h.Queries.ListUserLinks(r.Context(), pgUUIDOf(id))
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer lo que tiene a su nombre")
		return
	}
	out := make([]userLinkDTO, 0, len(rows))
	for _, l := range rows {
		out = append(out, userLinkDTO{Kind: l.Kind, Label: l.Label, Detail: l.Detail})
	}
	writeData(w, http.StatusOK, out)
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
			if err := sendForceResetNotice(sender, branding.Title(ctx, h.Queries), u); err == nil {
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

// sendForceResetNotice es el aviso del legacy (routes/users.js), estándar del área.
func sendForceResetNotice(sender *mail.Sender, appTitle string, u db.User) error {
	name := u.FullName.String
	if strings.TrimSpace(name) == "" {
		name = u.Username
	}
	m := mailtpl.ForcedPasswordChange(appTitle, name)
	return sender.SendAlternative([]string{u.Email}, nil, m.Subject, m.Text, m.HTML)
}

// Cargos es GET /api/users/cargos (admin): los cargos en uso y cuántas
// personas activas tiene cada uno (a quién avisa la alerta NOK del checklist).
func (h *UsersHandler) Cargos(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListCargoLabelCounts(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los cargos")
		return
	}
	type cargoDTO struct {
		Cargo  string `json:"cargo"`
		People int32  `json:"people"`
	}
	out := make([]cargoDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, cargoDTO{Cargo: row.Cargo, People: row.People})
	}
	writeData(w, http.StatusOK, out)
}
