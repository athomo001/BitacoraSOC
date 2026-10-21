-- Los tickets traídos de GLPI se borran: viven en GLPI.
DELETE FROM tickets WHERE source = 'glpi';
DROP TABLE glpi_ticket_runs;
ALTER TABLE glpi_config
  DROP COLUMN tickets_enabled,
  DROP COLUMN tickets_every,
  DROP COLUMN tickets_since_days,
  DROP COLUMN tickets_cursor,
  DROP COLUMN ticket_entities,
  DROP COLUMN group_areas,
  DROP COLUMN tickets_last_auto_at,
  DROP COLUMN tickets_failure_notified_on;
DROP INDEX uq_ticket_comments_glpi;
ALTER TABLE ticket_comments
  DROP CONSTRAINT chk_ticket_comments_glpi,
  DROP COLUMN glpi_id,
  DROP COLUMN glpi_kind,
  DROP COLUMN glpi_time_seconds;
DROP INDEX uq_tickets_glpi;
ALTER TABLE tickets
  DROP CONSTRAINT chk_tickets_glpi_source,
  DROP COLUMN source,
  DROP COLUMN glpi_id,
  DROP COLUMN glpi_date_mod,
  DROP COLUMN glpi_synced_at,
  DROP COLUMN glpi_deleted,
  DROP COLUMN glpi_linked_only,
  DROP COLUMN glpi_group_id,
  DROP COLUMN glpi_group_name,
  DROP COLUMN glpi_technician;
UPDATE system_features SET description = 'Importa computadores y equipos de red desde GLPI al Inventario (Administración → GLPI).'
WHERE code = 'glpi_sync';
