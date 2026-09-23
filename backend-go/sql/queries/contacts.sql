-- Directorio Global de Contactos (spec/04-contratos-api.md, HU-DIR-1/2).
-- email/phone están cifrados (AES-256-GCM): la búsqueda por esos campos es por
-- igualdad exacta contra su índice ciego (email_hash/phone_hash, HMAC), igual
-- que el legacy buscaba por sha256. Nombre/cargo/especialidad/organización sí
-- admiten búsqueda parcial (ILIKE).

-- name: ListDirectory :many
SELECT c.*, o.name AS organization_name, o.type AS organization_type
FROM contacts c JOIN organizations o ON o.id = c.organization_id
WHERE c.active = sqlc.arg('active')::boolean
  AND (sqlc.narg('organization_id')::uuid IS NULL OR c.organization_id = sqlc.narg('organization_id'))
  AND (sqlc.narg('scope')::contact_scope IS NULL OR c.scope = sqlc.narg('scope'))
  AND (sqlc.narg('specialty')::text IS NULL OR unaccent(c.specialty) ILIKE unaccent('%' || sqlc.narg('specialty') || '%'))
  AND (sqlc.narg('favorite')::boolean IS NULL OR c.is_favorite = sqlc.narg('favorite'))
  AND (sqlc.narg('q')::text IS NULL
       OR unaccent(c.name) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR unaccent(c.position) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR unaccent(c.specialty) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR unaccent(o.name) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR c.email_hash = sqlc.narg('q_email_hash')
       OR c.phone_hash = sqlc.narg('q_phone_hash'))
ORDER BY c.is_favorite DESC, c.name
LIMIT sqlc.arg('page_size') OFFSET sqlc.arg('page_offset');

-- name: CountDirectory :one
SELECT count(*)
FROM contacts c JOIN organizations o ON o.id = c.organization_id
WHERE c.active = sqlc.arg('active')::boolean
  AND (sqlc.narg('organization_id')::uuid IS NULL OR c.organization_id = sqlc.narg('organization_id'))
  AND (sqlc.narg('scope')::contact_scope IS NULL OR c.scope = sqlc.narg('scope'))
  AND (sqlc.narg('specialty')::text IS NULL OR unaccent(c.specialty) ILIKE unaccent('%' || sqlc.narg('specialty') || '%'))
  AND (sqlc.narg('favorite')::boolean IS NULL OR c.is_favorite = sqlc.narg('favorite'))
  AND (sqlc.narg('q')::text IS NULL
       OR unaccent(c.name) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR unaccent(c.position) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR unaccent(c.specialty) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR unaccent(o.name) ILIKE unaccent('%' || sqlc.narg('q') || '%')
       OR c.email_hash = sqlc.narg('q_email_hash')
       OR c.phone_hash = sqlc.narg('q_phone_hash'));

-- name: GetDirectoryContact :one
SELECT c.*, o.name AS organization_name, o.type AS organization_type
FROM contacts c JOIN organizations o ON o.id = c.organization_id
WHERE c.id = $1;

-- name: CreateContact :one
INSERT INTO contacts (organization_id, name, position, specialty, scope, source, is_favorite, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id;

-- name: UpdateContact :execrows
UPDATE contacts SET
  organization_id = COALESCE(sqlc.narg('organization_id'), organization_id),
  name = COALESCE(sqlc.narg('name'), name),
  position = COALESCE(sqlc.narg('position'), position),
  specialty = COALESCE(sqlc.narg('specialty'), specialty),
  scope = COALESCE(sqlc.narg('scope'), scope),
  is_favorite = COALESCE(sqlc.narg('is_favorite'), is_favorite),
  notes = COALESCE(sqlc.narg('notes'), notes),
  updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SetContactPrimaryChannels :exec
-- email/phone de contacts son la copia denormalizada del canal preferido de
-- cada tipo (la fuente de verdad son contact_channels), cifrada + indexada
-- para listar y buscar sin recorrer los canales.
UPDATE contacts SET
  email_encrypted = sqlc.narg('email_encrypted'),
  email_hash = sqlc.narg('email_hash'),
  phone_encrypted = sqlc.narg('phone_encrypted'),
  phone_hash = sqlc.narg('phone_hash'),
  updated_at = now()
WHERE id = sqlc.arg('id');

-- name: SoftDeleteContact :execrows
-- Borrado lógico: el contacto puede estar referenciado por team_members (FK
-- sin cascada) y por el historial de escalación de fases siguientes.
UPDATE contacts SET active = false, updated_at = now() WHERE id = $1 AND active;

-- name: FindContactByEmailHash :one
SELECT id, source FROM contacts WHERE active AND email_hash = $1 ORDER BY created_at LIMIT 1;

-- name: FindContactByNameAndOrg :one
SELECT id, source FROM contacts
WHERE active AND organization_id = $1 AND lower(name) = lower(sqlc.arg('name')::text)
ORDER BY created_at LIMIT 1;

-- ===== Canales =====

-- name: ListChannelsForContacts :many
SELECT * FROM contact_channels
WHERE active AND contact_id = ANY(sqlc.arg('contact_ids')::uuid[])
ORDER BY preferred DESC, channel_type, id;

-- name: ListChannelsForUser :many
SELECT * FROM contact_channels WHERE active AND user_id = $1 ORDER BY preferred DESC, channel_type, id;

-- name: CreateContactChannel :one
INSERT INTO contact_channels (contact_id, channel_type, value_encrypted, label, preferred)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: CreateUserChannel :one
INSERT INTO contact_channels (user_id, channel_type, value_encrypted, label, preferred)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: ClearPreferredContactChannel :exec
-- A lo sumo un canal preferido por dueño (índice único parcial del esquema):
-- marcar uno nuevo desmarca el anterior.
UPDATE contact_channels SET preferred = false WHERE contact_id = $1 AND preferred;

-- name: ClearPreferredUserChannel :exec
UPDATE contact_channels SET preferred = false WHERE user_id = $1 AND preferred;

-- name: UpdateChannelValue :exec
UPDATE contact_channels SET value_encrypted = $2 WHERE id = $1;

-- name: DeleteContactChannel :execrows
DELETE FROM contact_channels WHERE id = $1 AND contact_id = $2;

-- name: DeleteUserChannel :execrows
DELETE FROM contact_channels WHERE id = $1 AND user_id = $2;

-- ===== Consolidación de duplicados (POST /api/directory/merge-duplicates) =====

-- name: ListContactsForDedupe :many
-- Orden por antigüedad: el más antiguo de cada grupo queda como principal,
-- salvo que otro esté más completo (ver handler).
SELECT id, organization_id, name, email_hash, phone_hash, source,
  ((email_hash IS NOT NULL)::int + (phone_hash IS NOT NULL)::int
   + (position IS NOT NULL)::int + (specialty IS NOT NULL)::int)::int AS completeness
FROM contacts WHERE active ORDER BY created_at, id;

-- name: FillContactFromDuplicate :exec
-- Completa los huecos del principal con los datos del duplicado, sin pisar nada.
UPDATE contacts p SET
  position = COALESCE(p.position, d.position),
  specialty = COALESCE(p.specialty, d.specialty),
  notes = COALESCE(p.notes, d.notes),
  email_encrypted = COALESCE(p.email_encrypted, d.email_encrypted),
  email_hash = COALESCE(p.email_hash, d.email_hash),
  phone_encrypted = COALESCE(p.phone_encrypted, d.phone_encrypted),
  phone_hash = COALESCE(p.phone_hash, d.phone_hash),
  is_favorite = p.is_favorite OR d.is_favorite,
  updated_at = now()
FROM contacts d
WHERE p.id = sqlc.arg('primary_id') AND d.id = sqlc.arg('duplicate_id');

-- name: MoveContactChannels :exec
-- Pierden la marca de preferido: el principal ya puede tener el suyo (a lo
-- sumo uno por dueño, uq_contact_channels_preferred_contact).
UPDATE contact_channels SET contact_id = sqlc.arg('primary_id'), preferred = false
WHERE contact_id = sqlc.arg('duplicate_id');

-- name: MoveTeamMemberships :exec
-- Reapunta la membresía al principal, salvo que ya esté en ese equipo.
UPDATE team_members m SET contact_id = sqlc.arg('primary_id')
WHERE m.contact_id = sqlc.arg('duplicate_id')
  AND NOT EXISTS (SELECT 1 FROM team_members x
                  WHERE x.team_id = m.team_id AND x.contact_id = sqlc.arg('primary_id'));

-- name: DeactivateLeftoverMemberships :exec
UPDATE team_members SET active = false WHERE contact_id = sqlc.arg('duplicate_id');
