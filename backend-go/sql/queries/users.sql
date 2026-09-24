-- name: CreateUser :one
INSERT INTO users (username, email, password_hash, role, must_change_password)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateMyProfile :one
UPDATE users SET
  full_name = COALESCE(sqlc.narg('full_name'), full_name),
  phone = COALESCE(sqlc.narg('phone'), phone),
  birthday = COALESCE(sqlc.narg('birthday'), birthday),
  avatar_url = COALESCE(sqlc.narg('avatar_url'), avatar_url),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: ListUsers :many
-- ?role=&active= son opcionales (04-contratos-api.md) — sqlc.narg + el
-- patrón "columna = $n OR $n IS NULL" evita escribir dos queries a mano.
SELECT * FROM users
WHERE (sqlc.narg('role')::user_role IS NULL OR role = sqlc.narg('role'))
  AND (sqlc.narg('active')::boolean IS NULL OR active = sqlc.narg('active'))
ORDER BY username;

-- name: ListActiveUserEmailsByRole :many
SELECT email FROM users
WHERE active = true
  AND (sqlc.narg('role')::user_role IS NULL OR role = sqlc.narg('role'))
ORDER BY email;

-- name: UpdateUserAdmin :one
-- PATCH /api/users/:id — campos parciales: NULL en un parámetro conserva el
-- valor actual (COALESCE), no lo borra.
UPDATE users SET
  email = COALESCE(sqlc.narg('email'), email),
  role = COALESCE(sqlc.narg('role'), role),
  cargo_label = COALESCE(sqlc.narg('cargo_label'), cargo_label),
  active = COALESCE(sqlc.narg('active'), active),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeactivateUser :exec
-- DELETE /api/users/:id se implementa como soft-delete (active=false), no
-- DELETE real: audit_log.actor_user_id referencia a users(id) sin ON DELETE
-- CASCADE (a propósito, es append-only e inmutable) — borrar de verdad a un
-- usuario que alguna vez hizo algo auditado rompería esa FK. Mismo patrón
-- `active` que ya usa el resto del esquema (organizations, teams, etc.).
UPDATE users SET active = false, updated_at = now() WHERE id = $1;

-- name: UpdateUserPassword :exec
-- Limpia must_change_password al completar el cambio (04-contratos-api.md:
-- "Limpia el flag al completar").
UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now()
WHERE id = $1;

-- name: RehashPassword :exec
-- Re-hash oportunista en login (spec/07-backend-arquitectura-go.md sección
-- 6.5) — a diferencia de UpdateUserPassword, NO toca must_change_password:
-- esto es transparente para el usuario, no un cambio de contraseña real.
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;

-- name: SetMustChangePassword :exec
UPDATE users SET must_change_password = $2, updated_at = now() WHERE id = $1;

-- name: ForceResetAllActivePasswords :many
-- POST /api/users/force-reset-all — usuarios internos = no invitados
-- (is_guest=false), activos. Devuelve los afectados para poder notificarlos
-- por correo sin una segunda consulta.
UPDATE users SET must_change_password = true, updated_at = now()
WHERE active = true AND is_guest = false
RETURNING *;

-- name: RegisterFailedLogin :one
UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = now()
WHERE id = $1
RETURNING failed_login_attempts;

-- name: LockUser :exec
UPDATE users SET locked_until = $2, updated_at = now() WHERE id = $1;

-- name: ResetFailedLoginAttempts :exec
UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1;

-- name: SetMFASecret :exec
UPDATE users SET mfa_secret_encrypted = $2, updated_at = now() WHERE id = $1;

-- name: EnableMFA :exec
UPDATE users SET mfa_enabled = true, updated_at = now() WHERE id = $1;

-- name: DisableMFA :exec
UPDATE users SET mfa_enabled = false, mfa_secret_encrypted = NULL, updated_at = now() WHERE id = $1;
