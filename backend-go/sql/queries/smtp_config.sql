-- name: GetSMTPConfig :one
-- smtp_config es singleton (id BOOLEAN PRIMARY KEY DEFAULT true), siempre hay
-- a lo sumo una fila. sqlc.narg permite pgx.ErrNoRows cuando aún no se
-- configuró SMTP (setup inicial no completado).
SELECT host, port, username, password_encrypted, from_address, from_name, require_tls,
       last_test_at, last_test_ok, last_test_error
FROM smtp_config
WHERE id = true;

-- name: UpsertSMTPConfig :exec
-- Guardar no borra el resultado de la última prueba: sigue siendo cierto
-- para la configuración con la que se hizo hasta que se pruebe de nuevo.
INSERT INTO smtp_config (id, host, port, username, password_encrypted, from_address, from_name, require_tls)
VALUES (true, $1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET
  host = EXCLUDED.host,
  port = EXCLUDED.port,
  username = EXCLUDED.username,
  password_encrypted = EXCLUDED.password_encrypted,
  from_address = EXCLUDED.from_address,
  from_name = EXCLUDED.from_name,
  require_tls = EXCLUDED.require_tls;

-- name: RecordSMTPTest :exec
UPDATE smtp_config SET last_test_at = now(), last_test_ok = $1, last_test_error = $2 WHERE id = true;
