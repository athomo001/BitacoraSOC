-- name: SetPasswordResetToken :exec
UPDATE users SET reset_password_token_hash = $2, reset_password_expires_at = $3, updated_at = now()
WHERE id = $1;

-- name: GetUserByResetTokenHash :one
-- El servicio valida la expiración (reset_password_expires_at > now()) en
-- Go, no acá, para poder distinguir "token no existe" de "token vencido" en
-- los tests sin depender del reloj de Postgres.
SELECT * FROM users WHERE reset_password_token_hash = $1;

-- name: ClearPasswordResetToken :exec
UPDATE users SET reset_password_token_hash = NULL, reset_password_expires_at = NULL, updated_at = now()
WHERE id = $1;
