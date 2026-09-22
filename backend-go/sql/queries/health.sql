-- name: Ping :one
-- Prueba mínima de conectividad real a Postgres para /api/health/ready
-- (más que un simple pgxpool.Ping(): confirma que el pool puede ejecutar SQL
-- de verdad contra la base, no solo abrir el socket TCP).
SELECT 1::int AS ok;
