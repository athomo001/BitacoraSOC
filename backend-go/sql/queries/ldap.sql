-- Entrar con la cuenta del dominio (spec/20, 000064).

-- name: GetLdapConfig :one
SELECT * FROM ldap_config WHERE id;

-- name: UpdateLdapConfig :exec
UPDATE ldap_config SET url = sqlc.arg('url'), start_tls = sqlc.arg('start_tls'), verify_tls = sqlc.arg('verify_tls'),
  ca_pem = sqlc.arg('ca_pem'), bind_dn = sqlc.arg('bind_dn'), bind_password_encrypted = sqlc.narg('bind_password_encrypted'),
  base_dn = sqlc.arg('base_dn'), user_filter = sqlc.arg('user_filter'), username_attr = sqlc.arg('username_attr'),
  name_attr = sqlc.arg('name_attr'), email_attr = sqlc.arg('email_attr'), group_dn = sqlc.arg('group_dn'),
  timeout_seconds = sqlc.arg('timeout_seconds'), updated_at = now()
WHERE id;

-- name: RecordLdapTest :exec
UPDATE ldap_config SET last_test_at = now(), last_test_ok = sqlc.arg('ok'), last_test = sqlc.arg('result') WHERE id;

-- name: GetUserByLdapDN :one
SELECT * FROM users WHERE lower(ldap_dn) = lower(sqlc.arg('dn'));

-- name: LinkUserToLdap :one
-- La cuenta queda del dominio: la contraseña local y su reseteo dejan de
-- servir. Áreas, rol y grupos no se tocan (spec/20 §2).
UPDATE users SET auth_source = 'ldap', ldap_dn = sqlc.arg('dn'), must_change_password = false,
  reset_password_token_hash = NULL, reset_password_expires_at = NULL, updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: SetUserAuthSource :one
-- auto o local (desde la ficha del usuario o al crear el admin del setup):
-- deja de estar vinculada al directorio.
UPDATE users SET auth_source = sqlc.arg('auth_source'), ldap_dn = NULL, updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: CreateLdapUser :one
-- Primera vez que entra alguien del dominio sin cuenta: rol user, sin áreas.
-- password_hash es aleatorio (nadie lo conoce); entra con la del dominio.
INSERT INTO users (username, email, full_name, password_hash, role, must_change_password, auth_source, ldap_dn)
VALUES (sqlc.arg('username'), sqlc.arg('email'), sqlc.narg('full_name'), sqlc.arg('password_hash'), 'user', false, 'ldap', sqlc.arg('dn'))
RETURNING *;

-- name: CountLocalAdmins :one
-- Administradores activos que entran sin depender del directorio.
SELECT count(*) FROM users WHERE role = 'admin' AND active AND auth_source = 'local';
