ALTER TABLE tickets DROP COLUMN api_key_name, DROP COLUMN api_key_id;
ALTER TABLE entries DROP COLUMN api_key_name, DROP COLUMN api_key_id;
DROP TABLE api_idempotency;
DROP TABLE api_key_requests;
DROP INDEX idx_api_keys_created_by;
ALTER TABLE api_keys
  DROP COLUMN revoke_reason,
  DROP COLUMN revoked_by,
  DROP COLUMN revoked_at,
  DROP COLUMN area_id,
  DROP COLUMN client_ids,
  DROP COLUMN description;
DROP TABLE forward_stats;
DROP TABLE forward_outbox;
DROP TABLE forward_destinations;
