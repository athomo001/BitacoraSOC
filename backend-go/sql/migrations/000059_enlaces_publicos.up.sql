-- Enlaces públicos (10h; diseño aprobado por el dueño 2026-10-22,
-- <https://claude.ai/artifact/5DbgXPNMtdtocb1bhgBEoi>): además del de
-- teletrabajo, guardias, Ticketera y Mapa NOC para las TV de la sala, y el
-- estado de un cliente para mandárselo. Cada enlace tiene nombre y alcance:
-- las áreas (guardias, Ticketera) o el cliente (estado). Se administran todos
-- en Administración → Enlaces públicos y puede haber varios de cada tipo.
ALTER TABLE public_share_links
  ADD COLUMN name TEXT NOT NULL DEFAULT '',
  ADD COLUMN area_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_public_share_links_slug CHECK (slug IN ('telework', 'guards', 'tickets', 'map', 'client')),
  ADD CONSTRAINT chk_public_share_links_client CHECK ((slug = 'client') = (organization_id IS NOT NULL));
UPDATE public_share_links SET name = 'Teletrabajo' WHERE slug = 'telework' AND name = '';
