DELETE FROM system_features WHERE code = 'allow_purge';
DROP TABLE IF EXISTS backup_config;
ALTER TABLE backup_runs DROP COLUMN IF EXISTS trigger_source;
