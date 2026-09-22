-- name: GetSMTPConfig :one
-- smtp_config es singleton (id BOOLEAN PRIMARY KEY DEFAULT true), siempre hay
-- a lo sumo una fila. sqlc.narg permite pgx.ErrNoRows cuando aún no se
-- configuró SMTP (setup inicial no completado).
SELECT host, port, username, password_encrypted, from_address, require_tls
FROM smtp_config
WHERE id = true;

-- name: UpsertSMTPConfig :exec
INSERT INTO smtp_config (id, host, port, username, password_encrypted, from_address, require_tls)
VALUES (true, $1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE SET
  host = EXCLUDED.host,
  port = EXCLUDED.port,
  username = EXCLUDED.username,
  password_encrypted = EXCLUDED.password_encrypted,
  from_address = EXCLUDED.from_address,
  require_tls = EXCLUDED.require_tls;
