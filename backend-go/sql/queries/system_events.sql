-- name: InsertSystemEvent :one
-- Hub SSE genérico (Fase 2 del roadmap) — toda publicación pasa por acá para
-- que GET /api/stream/events pueda reponer eventos perdidos vía Last-Event-ID
-- (ver spec/09-alta-disponibilidad-2-nodos.md sección 3.2/9.3).
INSERT INTO system_events (event_type, scope, payload)
VALUES ($1, $2, $3)
RETURNING id, event_type, scope, payload, created_at;

-- name: ListSystemEventsSince :many
-- Reposición tras reconexión: todo lo publicado después de Last-Event-ID.
SELECT id, event_type, scope, payload, created_at
FROM system_events
WHERE id > $1
ORDER BY id ASC
LIMIT $2;
