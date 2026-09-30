-- Fase 13b (spec/11-complementos.md §4) y recordatorios de turno
-- (spec/12-pendientes.md §2.3b), aprobados por el dueño el 2026-09-30.

-- ===== Complementos =====
CREATE TYPE complement_source AS ENUM ('zip_static', 'manual');
CREATE TYPE complement_status AS ENUM ('active', 'maintenance', 'disabled');

CREATE TABLE complements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT,
  icon TEXT NOT NULL DEFAULT 'extension',
  source_type complement_source NOT NULL,
  status complement_status NOT NULL DEFAULT 'active',
  entry_path TEXT NOT NULL DEFAULT 'index.html',
  base_url TEXT,
  internal_base_url TEXT,
  health_path TEXT,
  api_version TEXT NOT NULL DEFAULT 'v1' CHECK (api_version IN ('v1')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  allowed_collections TEXT[] NOT NULL DEFAULT '{}',
  connect_hosts TEXT[] NOT NULL DEFAULT '{}',
  -- TEXT[] y no user_role[]: pgx no codifica arreglos de un enum sin registrarlo.
  visible_roles TEXT[] NOT NULL DEFAULT '{}' CHECK (visible_roles <@ ARRAY['admin','user','auditor','guest']::text[]),
  visible_permission_group_ids UUID[] NOT NULL DEFAULT '{}',
  token_hash TEXT,
  token_issued_at TIMESTAMPTZ,
  artifact_sha256 TEXT,
  artifact_bytes BIGINT,
  artifact_files INT,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Archivos publicados en la base, no en disco: HA de 2 nodos y respaldos.
CREATE TABLE complement_files (
  complement_id UUID NOT NULL REFERENCES complements(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  PRIMARY KEY (complement_id, path)
);

-- ZIP subido para revisar y previsualizar antes de publicar; vence a las 24 h.
CREATE TABLE complement_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  analysis JSONB NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX idx_complement_uploads_expires ON complement_uploads(expires_at);

-- browser-state (clave fija) y el storage de la Runtime API (varias claves).
CREATE TABLE complement_storage (
  complement_id UUID NOT NULL REFERENCES complements(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_via TEXT NOT NULL CHECK (updated_via IN ('browser', 'runtime_api')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (complement_id, key)
);

-- Entradas creadas por un complemento. Al eliminarlo se conservan (decisión
-- del dueño 2026-09-30): el FK queda en NULL y el nombre copiado sigue
-- mostrando "creada por <nombre> (complemento eliminado)".
ALTER TABLE entries ADD COLUMN owner_complement_id UUID REFERENCES complements(id) ON DELETE SET NULL;
ALTER TABLE entries ADD COLUMN owner_complement_name TEXT;
CREATE INDEX idx_entries_owner_complement ON entries(owner_complement_id) WHERE owner_complement_id IS NOT NULL;

INSERT INTO system_features (code, name, description) VALUES
  ('complements', 'Complementos', 'Mini-apps embebidas (DOOM, diccionario de logs, herramientas propias) servidas desde un origen aislado.')
ON CONFLICT (code) DO NOTHING;

-- ===== Recordatorios de turno por correo =====
CREATE TABLE shift_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 150),
  reminder_text TEXT NOT NULL CHECK (length(reminder_text) BETWEEN 1 AND 5000),
  frequency_type TEXT NOT NULL DEFAULT 'hours' CHECK (frequency_type IN ('hours', 'fixed')),
  interval_hours INT NOT NULL DEFAULT 4 CHECK (interval_hours BETWEEN 1 AND 24),
  fixed_times TEXT[] NOT NULL DEFAULT '{}',
  target_shift_ids UUID[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un envío por recordatorio, turno y bloque u hora: el UNIQUE evita el doble
-- envío con 2 nodos (el que inserta primero es el que envía).
CREATE TABLE shift_reminder_sends (
  reminder_id UUID NOT NULL REFERENCES shift_reminders(id) ON DELETE CASCADE,
  work_shift_id UUID NOT NULL REFERENCES work_shifts(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL,
  recipients_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'no_recipients')),
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reminder_id, work_shift_id, trigger_key)
);
CREATE INDEX idx_shift_reminder_sends_recent ON shift_reminder_sends(reminder_id, sent_at DESC);
