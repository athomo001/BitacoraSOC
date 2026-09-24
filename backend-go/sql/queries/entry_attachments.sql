-- Fase 9: imagen simple de una entrada (ver migración 000005 — entry_id
-- nullable a propósito). CreateOrphanAttachment inserta sin entrada todavía
-- (POST /api/entries/upload-image); ClaimAttachment la asocia al crear la
-- entrada real. Sin conversión a WebP ni limpieza EXIF (decisión de esta
-- fase, ver spec/00-mapa-mental.md) — se guarda tal cual se subió.

-- name: CreateOrphanAttachment :one
INSERT INTO entry_attachments (file_name, mime_type, size_bytes, file_data, hash_sha256)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: ClaimAttachment :execrows
-- Solo reclama un adjunto todavía huérfano — evita que dos entradas
-- terminen apuntando a la misma imagen si el cliente reenvía el mismo
-- imageUrl dos veces.
UPDATE entry_attachments SET entry_id = $2 WHERE id = $1 AND entry_id IS NULL;

-- name: GetAttachment :one
SELECT * FROM entry_attachments WHERE id = $1;
