DROP TABLE glpi_outbox;
ALTER TABLE entry_comments DROP COLUMN glpi_push_error, DROP COLUMN glpi_push_state, DROP COLUMN glpi_followup_id;
ALTER TABLE ticket_comments DROP COLUMN glpi_push_error, DROP COLUMN glpi_push_state;
DROP INDEX uq_tickets_glpi_copy;
ALTER TABLE tickets DROP COLUMN glpi_copy_synced_at, DROP COLUMN glpi_copy_date_mod, DROP COLUMN glpi_copy_id;
ALTER TABLE glpi_config
  DROP COLUMN write_failure_notified_on,
  DROP COLUMN area_groups,
  DROP COLUMN client_entities,
  DROP COLUMN write_default_type,
  DROP COLUMN write_token_encrypted,
  DROP COLUMN write_enabled;
