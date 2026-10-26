ALTER TABLE entry_comments DROP COLUMN via;
DROP TABLE complement_schedules;
DROP INDEX idx_forward_destinations_complement;
ALTER TABLE forward_destinations DROP COLUMN complement_id, DROP COLUMN events, DROP COLUMN hmac_secret_encrypted;
DROP INDEX idx_api_keys_complement;
ALTER TABLE api_keys DROP COLUMN complement_id;
ALTER TABLE complements
  DROP COLUMN manifest, DROP COLUMN approved, DROP COLUMN is_house, DROP COLUMN settings,
  DROP COLUMN secrets_encrypted, DROP COLUMN integration_key_encrypted, DROP COLUMN hook_secret_encrypted;
