DROP INDEX IF EXISTS idx_entries_asset;
DROP INDEX IF EXISTS idx_tickets_asset;
ALTER TABLE assets DROP COLUMN IF EXISTS group_id;
DROP TABLE IF EXISTS asset_groups;
