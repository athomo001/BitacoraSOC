-- 000018: rediseño de escalamiento (#17, canvas v26 aprobado 2026-10-05).

-- Recordatorio del cliente bajo el flujo de llamados ("Llamar 3 veces y 1
-- minuto por cada llamada"): catalogLogSources.escalationLegend del legacy.
ALTER TABLE escalation_policies ADD COLUMN reminder TEXT;

-- Pools: grupo con nombre de personas de una empresa o área (TI-Mundo,
-- Redes-Mundo, Ciber-Mundo; una empresa puede tener varios) que se agrega a
-- un nivel como un solo integrante y se llama en orden: si uno no contesta,
-- el siguiente.
CREATE TABLE escalation_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_escalation_pools_name ON escalation_pools(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE escalation_pool_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES escalation_pools(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_pool_member_exactly_one CHECK ((contact_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1)
);
CREATE INDEX idx_escalation_pool_members_pool ON escalation_pool_members(pool_id, position);

-- Un integrante de nivel puede ser un pool.
ALTER TABLE team_members ADD COLUMN pool_id UUID REFERENCES escalation_pools(id) ON DELETE CASCADE;
ALTER TABLE team_members DROP CONSTRAINT chk_team_member_exactly_one;
ALTER TABLE team_members ADD CONSTRAINT chk_team_member_exactly_one CHECK (
  (user_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int + (pool_id IS NOT NULL)::int = 1
);

-- Incidentes: cada escalamiento pertenece a un evento ("Virus en RRHH 15:02"
-- no es lo mismo que "Phishing 16:31") enlazado a un ticket GLPI o interno.
CREATE TABLE escalation_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  territorial_unit_id UUID REFERENCES territorial_units(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  glpi_ticket TEXT,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  opened_by UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ
);
CREATE INDEX idx_escalation_incidents_service ON escalation_incidents(service_id, opened_at DESC);
CREATE INDEX idx_escalation_incidents_asset ON escalation_incidents(asset_id, opened_at DESC);
CREATE INDEX idx_escalation_incidents_unit ON escalation_incidents(territorial_unit_id, opened_at DESC);

ALTER TABLE escalation_action_logs ADD COLUMN incident_id UUID REFERENCES escalation_incidents(id);
CREATE INDEX idx_escalation_action_logs_incident ON escalation_action_logs(incident_id, created_at);

-- Comentarios del historial forense de cada incidente.
CREATE TABLE escalation_incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES escalation_incidents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_escalation_incident_notes_incident ON escalation_incident_notes(incident_id, created_at);
