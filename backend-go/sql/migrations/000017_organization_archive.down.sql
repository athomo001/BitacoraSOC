CREATE OR REPLACE VIEW clients AS
  SELECT o.id, o.name, o.code, o.active, o.created_at
  FROM organizations o JOIN organization_types t ON t.code = o.type
  WHERE t.is_client;

ALTER TABLE organizations DROP COLUMN IF EXISTS archived_at;
