-- Revertir exige que no queden adjuntos huérfanos (entry_id NULL); en un
-- rollback real habría que reclamarlos o borrarlos primero.
ALTER TABLE entry_attachments ALTER COLUMN entry_id SET NOT NULL;
