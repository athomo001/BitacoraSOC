DROP VIEW clients;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_organizations_via_not_self;
ALTER TABLE organizations DROP COLUMN IF EXISTS via_organization_id;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS fk_organizations_type;
CREATE TYPE organization_type AS ENUM ('client', 'contractor', 'carrier', 'internal');
-- Los tipos propios vuelven a "cliente" (el enum no los conoce).
UPDATE organizations SET type = 'client' WHERE type NOT IN ('client', 'contractor', 'carrier', 'internal');
ALTER TABLE organizations ALTER COLUMN type DROP DEFAULT;
ALTER TABLE organizations ALTER COLUMN type TYPE organization_type USING type::organization_type;
ALTER TABLE organizations ALTER COLUMN type SET DEFAULT 'client';
DROP TABLE organization_types;
CREATE VIEW clients AS SELECT id, name, code, active, created_at FROM organizations WHERE type = 'client';
