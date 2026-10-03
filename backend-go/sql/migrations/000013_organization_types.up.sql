-- Tipos de organización configurables (comentario del dueño #12) y el
-- mandante a través del cual se atiende a un cliente ("JUNJI vía Mundo").
CREATE TABLE organization_types (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  name TEXT NOT NULL,
  description TEXT,
  -- Cuenta como cliente: se elige como cliente en tickets y escalamiento.
  is_client BOOLEAN NOT NULL DEFAULT false,
  -- Lo usa la aplicación (cliente, interna, NOC): se renombra pero no se borra.
  system BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organization_types (code, name, description, is_client, system, sort_order) VALUES
  ('client', 'Cliente', 'A quien le prestamos el servicio.', true, true, 10),
  ('mandante', 'Mandante', 'Empresa que nos contrata para atender a sus propios clientes (p. ej. Mundo con JUNJI).', true, false, 20),
  ('internal', 'Interna', 'Nuestra propia operación.', false, true, 30),
  ('contractor', 'Contratista', 'Contrata de terreno (NOC).', false, true, 40),
  ('carrier', 'Carrier', 'Proveedor de enlaces (NOC).', false, true, 50);

DROP VIEW clients;
ALTER TABLE organizations ALTER COLUMN type DROP DEFAULT;
ALTER TABLE organizations ALTER COLUMN type TYPE TEXT USING type::text;
ALTER TABLE organizations ALTER COLUMN type SET DEFAULT 'client';
ALTER TABLE organizations ADD CONSTRAINT fk_organizations_type
  FOREIGN KEY (type) REFERENCES organization_types(code) ON UPDATE CASCADE;
DROP TYPE organization_type;

-- "A través de": el mandante con el que se atiende a esta organización.
ALTER TABLE organizations ADD COLUMN via_organization_id UUID
  REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_via_not_self
  CHECK (via_organization_id IS NULL OR via_organization_id <> id);

CREATE VIEW clients AS
  SELECT o.id, o.name, o.code, o.active, o.created_at
  FROM organizations o JOIN organization_types t ON t.code = o.type
  WHERE t.is_client;
