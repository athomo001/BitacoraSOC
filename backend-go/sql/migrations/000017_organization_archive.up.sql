-- 000017: eliminar una organización la archiva (pedido del dueño 2026-10-05).
-- Sus tickets quedan en el histórico con su nombre y sus contactos siguen en
-- el Directorio con su empresa (los contactos no dependen de que se trabaje
-- con ella); servicios, equipos y activos se resuelven antes (mover, editar o
-- eliminar). La archivada desaparece de listas y selectores y libera su código.
ALTER TABLE organizations ADD COLUMN archived_at TIMESTAMPTZ;

CREATE OR REPLACE VIEW clients AS
  SELECT o.id, o.name, o.code, o.active, o.created_at
  FROM organizations o JOIN organization_types t ON t.code = o.type
  WHERE t.is_client AND o.archived_at IS NULL;
