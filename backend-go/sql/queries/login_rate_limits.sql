-- name: GetLoginRateLimit :one
SELECT * FROM login_rate_limits WHERE ip_address = $1;

-- name: UpsertLoginAttempt :one
-- Primer intento desde una IP: crea la fila en 1. Intentos siguientes:
-- incrementa. El servicio decide si la ventana de 15min ya venció y hay que
-- resetear en vez de incrementar (ver internal/service/ratelimit).
INSERT INTO login_rate_limits (ip_address, attempt_count, window_started_at)
VALUES ($1, 1, now())
ON CONFLICT (ip_address) DO UPDATE SET attempt_count = login_rate_limits.attempt_count + 1
RETURNING *;

-- name: ResetLoginRateLimit :exec
-- Nueva ventana de 15min, o la válvula de emergencia
-- (POST /api/system/rate-limit-reset).
DELETE FROM login_rate_limits WHERE ip_address = $1;

-- name: ResetAllLoginRateLimits :exec
DELETE FROM login_rate_limits;
