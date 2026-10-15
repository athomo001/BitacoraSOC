-- Importación de equipos desde GLPI (spec/16 §5.1, 9.6, diseño aprobado por el
-- dueño 2026-10-15). Va detrás de system_features.glpi_sync. Se usa la API
-- clásica de GLPI (apirest.php, App-Token + User-Token), igual que el legacy.
--
-- Conexión y reglas de importación. Los tokens van cifrados (crypto.Box) y
-- nunca se devuelven. computer_types: tipo de computador en GLPI → tipo de
-- equipo de la Bitácora (lo que no está entra como «computer»). entities:
-- {"<id de entidad GLPI>": {"organizationId": uuid|null, "skip": bool}}.
CREATE TABLE glpi_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  api_url TEXT NOT NULL DEFAULT '',
  app_token_encrypted TEXT,
  user_token_encrypted TEXT,
  verify_tls BOOLEAN NOT NULL DEFAULT true,
  timeout_seconds INT NOT NULL DEFAULT 8 CHECK (timeout_seconds BETWEEN 2 AND 60),
  import_computers BOOLEAN NOT NULL DEFAULT true,
  import_network BOOLEAN NOT NULL DEFAULT true,
  area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  computer_types JSONB NOT NULL DEFAULT '{"Server": "server", "Virtual Machine": "server"}'::jsonb,
  entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- off | night (cada noche, 02:00) | 6h (cada 6 horas)
  auto_mode TEXT NOT NULL DEFAULT 'off' CHECK (auto_mode IN ('off', 'night', '6h')),
  last_auto_at TIMESTAMPTZ,
  last_failure_notified_on DATE,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO glpi_config DEFAULT VALUES;

-- Cada importación (manual o automática), con lo que hizo o por qué falló.
CREATE TABLE glpi_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'auto')),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN NOT NULL DEFAULT false,
  created INT NOT NULL DEFAULT 0,
  updated INT NOT NULL DEFAULT 0,
  deactivated INT NOT NULL DEFAULT 0,
  reactivated INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  unchanged INT NOT NULL DEFAULT 0,
  -- Bajas no aplicadas por el seguro (más del 10 % de lo importado).
  held_back INT NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_glpi_import_runs_started ON glpi_import_runs(started_at DESC);

-- De qué ítem de GLPI viene cada equipo: al reimportar se actualiza, nunca se
-- duplica. glpi_removed_at: se dio de baja porque desapareció de GLPI (si
-- vuelve, se reactiva solo; una baja hecha a mano no).
ALTER TABLE assets
  ADD COLUMN glpi_itemtype TEXT CHECK (glpi_itemtype IN ('Computer', 'NetworkEquipment')),
  ADD COLUMN glpi_id INT,
  ADD COLUMN glpi_removed_at TIMESTAMPTZ,
  ADD CONSTRAINT chk_assets_glpi_link CHECK ((glpi_itemtype IS NULL) = (glpi_id IS NULL));
CREATE UNIQUE INDEX uq_assets_glpi ON assets(glpi_itemtype, glpi_id) WHERE glpi_id IS NOT NULL;

-- Historial: los cambios que trae GLPI se ven como tales.
ALTER TABLE asset_events DROP CONSTRAINT asset_events_kind_check,
  ADD CONSTRAINT asset_events_kind_check CHECK (kind IN ('created', 'edited', 'work', 'ticket', 'import', 'glpi', 'deactivated', 'reactivated'));

UPDATE system_features SET description = 'Importa computadores y equipos de red desde GLPI al Inventario (Administración → GLPI).'
WHERE code = 'glpi_sync';
