-- Grupos de equipos (pedido del dueño 2026-10-23): un rack o una sala con
-- muchos equipos en el mismo lugar. El grupo guarda la ubicación (localidad,
-- dirección, coordenadas y rack) y sus equipos la toman de él: al cambiar el
-- grupo cambian todos. La posición en el rack sigue siendo de cada equipo.
CREATE TABLE asset_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  territorial_unit_id UUID REFERENCES territorial_units(id) ON DELETE SET NULL,
  address TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  rack TEXT,
  -- El cliente dueño de lo que hay en el grupo (opcional): sus equipos sin
  -- cliente lo toman.
  client_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_asset_groups_lat CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_asset_groups_lng CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_asset_groups_coords CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE UNIQUE INDEX idx_asset_groups_name ON asset_groups(lower(name));

ALTER TABLE assets ADD COLUMN group_id UUID REFERENCES asset_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_assets_group ON assets(group_id) WHERE group_id IS NOT NULL;

-- Mapa → capa Equipos: lo que afecta a cada equipo (tickets abiertos y
-- entradas de incidente de la Bitácora).
CREATE INDEX IF NOT EXISTS idx_tickets_asset ON tickets(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_asset ON entries(asset_id, created_at DESC) WHERE asset_id IS NOT NULL;
