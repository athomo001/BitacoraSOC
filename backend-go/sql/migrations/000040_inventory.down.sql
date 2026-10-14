DROP TABLE IF EXISTS asset_requests;
DROP TABLE IF EXISTS asset_events;
DROP TABLE IF EXISTS asset_responsibles;
DROP TABLE IF EXISTS asset_ips;
DROP INDEX IF EXISTS idx_assets_area;
ALTER TABLE assets
  DROP COLUMN updated_at, DROP COLUMN created_at, DROP COLUMN attributes, DROP COLUMN rack_position,
  DROP COLUMN rack, DROP COLUMN serial, DROP COLUMN model, DROP COLUMN kind_code, DROP COLUMN area_id;
-- territorial_unit_id vuelve a ser obligatorio solo si ningún equipo quedó sin localidad.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM assets WHERE territorial_unit_id IS NULL) THEN
    ALTER TABLE assets ALTER COLUMN territorial_unit_id SET NOT NULL;
  END IF;
END $$;
DROP TABLE IF EXISTS responsibility_types;
DROP TABLE IF EXISTS asset_kinds;
