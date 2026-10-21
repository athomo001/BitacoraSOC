-- GLPI en la Ticketera, fase 1 (10d.1, spec/18; diseño aprobado por el dueño
-- 2026-10-20): los tickets de GLPI se traen a la Ticketera solo para mirar.
-- GLPI manda en ellos: en la app no se editan y la app no manda correos por
-- ellos. Va detrás de system_features.glpi_sync y de glpi_config.tickets_enabled.
--
-- source: dónde nació el ticket. glpi_date_mod: el date_mod de GLPI tal como
-- viene (hora de GLPI); si no cambió, la corrida no reescribe el ticket.
-- glpi_linked_only: llegó porque alguien lo enlazó a mano (Bitácora o
-- Escalamiento), no por las entidades y grupos marcados. glpi_deleted: borrado
-- o en la papelera de GLPI; sale de las colas pero nunca se borra.
ALTER TABLE tickets
  ADD COLUMN source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'glpi')),
  ADD COLUMN glpi_id INT,
  ADD COLUMN glpi_date_mod TEXT,
  ADD COLUMN glpi_synced_at TIMESTAMPTZ,
  ADD COLUMN glpi_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN glpi_linked_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN glpi_group_id INT,
  ADD COLUMN glpi_group_name TEXT,
  ADD COLUMN glpi_technician TEXT,
  ADD CONSTRAINT chk_tickets_glpi_source CHECK ((source = 'glpi') = (glpi_id IS NOT NULL));
CREATE UNIQUE INDEX uq_tickets_glpi ON tickets(glpi_id) WHERE glpi_id IS NOT NULL;

-- Seguimientos, tareas y solución de GLPI: una fila por cada uno, para no
-- duplicar al volver a traerlos. glpi_time_seconds: el tiempo de una tarea.
ALTER TABLE ticket_comments
  ADD COLUMN glpi_id INT,
  ADD COLUMN glpi_kind TEXT CHECK (glpi_kind IN ('followup', 'task', 'solution')),
  ADD COLUMN glpi_time_seconds INT,
  ADD CONSTRAINT chk_ticket_comments_glpi CHECK ((glpi_kind IS NULL) = (glpi_id IS NULL));
CREATE UNIQUE INDEX uq_ticket_comments_glpi ON ticket_comments(ticket_id, glpi_kind, glpi_id) WHERE glpi_id IS NOT NULL;

-- Qué se trae y cada cuánto. ticket_entities: ids de las entidades marcadas
-- (con sus hijas); el cliente sale de glpi_config.entities, el mismo mapeo
-- del inventario. group_areas: {"<id de grupo GLPI>": "<id de área>"}.
-- tickets_cursor: el último date_mod traído (hora de GLPI); NULL = la próxima
-- corrida es la primera carga (abiertos + cerrados de tickets_since_days).
ALTER TABLE glpi_config
  ADD COLUMN tickets_enabled BOOLEAN NOT NULL DEFAULT false,
  -- off: solo a mano · 5m · 15m
  ADD COLUMN tickets_every TEXT NOT NULL DEFAULT '5m' CHECK (tickets_every IN ('off', '5m', '15m')),
  ADD COLUMN tickets_since_days INT NOT NULL DEFAULT 90 CHECK (tickets_since_days BETWEEN 1 AND 365),
  ADD COLUMN tickets_cursor TEXT,
  ADD COLUMN ticket_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN group_areas JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN tickets_last_auto_at TIMESTAMPTZ,
  ADD COLUMN tickets_failure_notified_on DATE;

-- Cada corrida (a mano o automática). finished_at NULL = en curso.
CREATE TABLE glpi_ticket_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'auto')),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  first_load BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN NOT NULL DEFAULT false,
  created INT NOT NULL DEFAULT 0,
  updated INT NOT NULL DEFAULT 0,
  -- Saltados: sin grupo con área, o enlazados a mano de una entidad sin cliente.
  skipped INT NOT NULL DEFAULT 0,
  deleted INT NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_glpi_ticket_runs_started ON glpi_ticket_runs(started_at DESC);

UPDATE system_features SET description = 'Importa equipos al Inventario y trae los tickets de GLPI a la Ticketera (Administración → GLPI).'
WHERE code = 'glpi_sync';
