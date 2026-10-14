ALTER TABLE app_config
  ADD COLUMN soc_module_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN noc_module_enabled BOOLEAN NOT NULL DEFAULT false;
UPDATE app_config SET
  soc_module_enabled = COALESCE((SELECT active FROM areas WHERE code = 'soc'), false),
  noc_module_enabled = COALESCE((SELECT active FROM areas WHERE code = 'noc'), false);

CREATE TYPE permission_group_module_scope AS ENUM ('soc', 'noc', 'both', 'none');
ALTER TABLE permission_groups ADD COLUMN module_scope permission_group_module_scope NOT NULL DEFAULT 'both';
UPDATE permission_groups g SET module_scope = CASE
  WHEN s.soc AND s.noc THEN 'both'::permission_group_module_scope
  WHEN s.soc THEN 'soc'::permission_group_module_scope
  WHEN s.noc THEN 'noc'::permission_group_module_scope
  ELSE 'none'::permission_group_module_scope END
FROM (
  SELECT g2.id,
    EXISTS (SELECT 1 FROM permission_group_areas pa JOIN areas a ON a.id = pa.area_id WHERE pa.permission_group_id = g2.id AND a.code = 'soc') AS soc,
    EXISTS (SELECT 1 FROM permission_group_areas pa JOIN areas a ON a.id = pa.area_id WHERE pa.permission_group_id = g2.id AND a.code = 'noc') AS noc
  FROM permission_groups g2
) s
WHERE s.id = g.id;

DROP TABLE permission_group_areas;
ALTER TABLE permission_groups DROP COLUMN level_id, DROP COLUMN profile;
DROP TABLE levels;
DROP TABLE areas;
