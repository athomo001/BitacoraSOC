ALTER TABLE smtp_config DROP COLUMN IF EXISTS last_test_error;
ALTER TABLE smtp_config DROP COLUMN IF EXISTS last_test_ok;
ALTER TABLE smtp_config DROP COLUMN IF EXISTS last_test_at;
ALTER TABLE smtp_config DROP COLUMN IF EXISTS from_name;
