DELETE FROM public_share_links WHERE slug <> 'telework';
ALTER TABLE public_share_links
  DROP CONSTRAINT chk_public_share_links_client,
  DROP CONSTRAINT chk_public_share_links_slug,
  DROP COLUMN organization_id,
  DROP COLUMN area_ids,
  DROP COLUMN name;
