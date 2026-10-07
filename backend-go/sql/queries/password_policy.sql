-- name: GetPasswordMinLength :one
SELECT password_min_length FROM app_config WHERE id = true;

-- name: SetPasswordMinLength :one
UPDATE app_config SET password_min_length = $1, updated_at = now() WHERE id = true
RETURNING password_min_length;
