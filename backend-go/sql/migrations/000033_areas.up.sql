-- Áreas, niveles y perfiles (spec/16 §3, etapa 9a del dueño 2026-10-13).
-- Hasta acá la app conocía dos áreas fijas, SOC y NOC, en dos lugares:
-- qué existe (app_config.soc/noc_module_enabled) y quién ve qué
-- (permission_groups.module_scope). Ahora las áreas son un catálogo y un
-- grupo de permisos se asocia a una o varias. SOC y NOC quedan como áreas de
-- sistema con ids fijos (los respaldos anteriores a esta migración se
-- actualizan al restaurarlos con esos mismos ids). Para el usuario no cambia
-- nada: cada grupo queda con sus mismas áreas y el perfil Operativo.

CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- active: el área existe en esta instalación (SOC/NOC: los antiguos
  -- soc/noc_module_enabled). Un área apagada no aparece en ningún menú.
  active BOOLEAN NOT NULL DEFAULT true,
  -- is_system: SOC y NOC; no se borran ni cambian de código.
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO areas (id, code, name, active, is_system, sort_order) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'soc', 'SOC', COALESCE((SELECT soc_module_enabled FROM app_config WHERE id), false), true, 10),
  ('a0000000-0000-4000-8000-000000000002', 'noc', 'NOC', COALESCE((SELECT noc_module_enabled FROM app_config WHERE id), false), true, 20);

-- Niveles: catálogo configurable, se combinan con el área ("N1 de Infra").
CREATE TABLE levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  rank INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO levels (id, code, name, rank) VALUES
  ('a0000000-0000-4000-8000-000000000101', 'n1', 'N1', 1),
  ('a0000000-0000-4000-8000-000000000102', 'n2', 'N2', 2),
  ('a0000000-0000-4000-8000-000000000103', 'n3', 'N3', 3);

-- Un grupo de permisos = área(s) + nivel + perfil (spec/16 §3.3). El perfil
-- decide qué pantallas tiene; los grupos que existen son Operativos.
ALTER TABLE permission_groups
  ADD COLUMN profile TEXT NOT NULL DEFAULT 'operativo' CHECK (profile IN ('operativo', 'resolutor', 'gestion')),
  ADD COLUMN level_id UUID REFERENCES levels(id) ON DELETE SET NULL;

CREATE TABLE permission_group_areas (
  permission_group_id UUID NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (permission_group_id, area_id)
);
CREATE INDEX idx_permission_group_areas_area ON permission_group_areas(area_id);

INSERT INTO permission_group_areas (permission_group_id, area_id)
SELECT id, 'a0000000-0000-4000-8000-000000000001'::uuid FROM permission_groups WHERE module_scope IN ('soc', 'both')
UNION ALL
SELECT id, 'a0000000-0000-4000-8000-000000000002'::uuid FROM permission_groups WHERE module_scope IN ('noc', 'both');

ALTER TABLE permission_groups DROP COLUMN module_scope;
DROP TYPE permission_group_module_scope;
ALTER TABLE app_config DROP COLUMN soc_module_enabled, DROP COLUMN noc_module_enabled;
