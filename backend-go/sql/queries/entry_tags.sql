-- Etiquetas de la Bitácora (paridad con el legacy: tags.js y
-- entries/tags/suggest, decisiones del dueño 2026-10-16).

-- name: SuggestEntryTags :many
-- Las que empiezan con lo escrito (sin distinguir mayúsculas), las más usadas primero.
SELECT t::text AS tag, count(*)::int AS uses
FROM entries e, unnest(e.tags) t
WHERE t ILIKE sqlc.arg('prefix')::text || '%'
GROUP BY t
ORDER BY 2 DESC, 1
LIMIT sqlc.arg('max_rows')::int;

-- name: ListEntryTagStats :many
-- Todas, con cuántas entradas las usan y cuándo se usó por última vez.
SELECT t::text AS tag, count(*)::int AS uses, max(e.created_at)::timestamptz AS last_used
FROM entries e, unnest(e.tags) t
GROUP BY t
ORDER BY 2 DESC, 1;

-- name: RenameEntryTag :execrows
-- Renombra en todas las entradas; si la entrada ya tenía la nueva, queda una
-- sola vez y en su lugar. No toca updated_at: no es un cambio del contenido.
UPDATE entries e SET tags = ARRAY(
  SELECT y FROM (
    SELECT CASE WHEN x = sqlc.arg('from_tag')::text THEN sqlc.arg('to_tag')::text ELSE x END AS y, min(ord) AS o
    FROM unnest(e.tags) WITH ORDINALITY u(x, ord)
    GROUP BY 1
  ) r ORDER BY o)
WHERE sqlc.arg('from_tag')::text = ANY(e.tags);

-- name: DeleteEntryTag :execrows
UPDATE entries SET tags = array_remove(tags, sqlc.arg('tag')::text) WHERE sqlc.arg('tag')::text = ANY(tags);
