-- name: DenylistToken :exec
-- POST /api/auth/logout — revoca un JTI puntual sin afectar otras sesiones
-- del mismo usuario.
INSERT INTO token_denylist (jti, user_id, expires_at)
VALUES ($1, $2, $3)
ON CONFLICT (jti) DO NOTHING;

-- name: IsTokenDenylisted :one
SELECT EXISTS(SELECT 1 FROM token_denylist WHERE jti = $1) AS denylisted;

-- name: PurgeExpiredDenylistedTokens :exec
-- Housekeeping: una vez que un JTI expiró de verdad, ya no hace falta
-- consultarlo (el JWT tampoco pasaría Verify() por expiración propia).
DELETE FROM token_denylist WHERE expires_at < now();
