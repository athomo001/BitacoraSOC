UPDATE system_features SET description = 'Integración bidireccional opcional con GLPI 11.x — Backlog Post-Corte.'
WHERE code = 'glpi_sync';
UPDATE asset_events SET kind = 'import' WHERE kind = 'glpi';
ALTER TABLE asset_events DROP CONSTRAINT asset_events_kind_check,
  ADD CONSTRAINT asset_events_kind_check CHECK (kind IN ('created', 'edited', 'work', 'ticket', 'import', 'deactivated', 'reactivated'));
DROP INDEX IF EXISTS uq_assets_glpi;
ALTER TABLE assets DROP CONSTRAINT chk_assets_glpi_link,
  DROP COLUMN glpi_removed_at, DROP COLUMN glpi_id, DROP COLUMN glpi_itemtype;
DROP TABLE IF EXISTS glpi_import_runs;
DROP TABLE IF EXISTS glpi_config;
