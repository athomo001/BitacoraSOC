-- Administración → Ticketera (pedido del dueño 2026-10-13: "todo lo de
-- tickets en una sección de admin, para configurarlo a gusto") y los avisos
-- por correo de spec/15-ticketera-avisos-correo.md.
--
-- ticket_settings es de una sola fila. Los valores por defecto son los que
-- antes estaban fijos en el código: respuesta 1 h; resolución 8 h (incidente)
-- y 72 h (requerimiento); "en riesgo" desde el 75 %; firma "Mesa de
-- Operaciones". Los avisos vienen apagados (decisión del dueño, spec/15 §11).
CREATE TABLE ticket_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- SLA en minutos: incidentes por prioridad y requerimientos aparte.
  sla_p1_response_minutes INT NOT NULL DEFAULT 60 CHECK (sla_p1_response_minutes > 0),
  sla_p1_resolution_minutes INT NOT NULL DEFAULT 480 CHECK (sla_p1_resolution_minutes > 0),
  sla_p2_response_minutes INT NOT NULL DEFAULT 60 CHECK (sla_p2_response_minutes > 0),
  sla_p2_resolution_minutes INT NOT NULL DEFAULT 480 CHECK (sla_p2_resolution_minutes > 0),
  sla_p3_response_minutes INT NOT NULL DEFAULT 60 CHECK (sla_p3_response_minutes > 0),
  sla_p3_resolution_minutes INT NOT NULL DEFAULT 480 CHECK (sla_p3_resolution_minutes > 0),
  sla_p4_response_minutes INT NOT NULL DEFAULT 60 CHECK (sla_p4_response_minutes > 0),
  sla_p4_resolution_minutes INT NOT NULL DEFAULT 480 CHECK (sla_p4_resolution_minutes > 0),
  sla_request_response_minutes INT NOT NULL DEFAULT 60 CHECK (sla_request_response_minutes > 0),
  sla_request_resolution_minutes INT NOT NULL DEFAULT 4320 CHECK (sla_request_resolution_minutes > 0),
  at_risk_percent INT NOT NULL DEFAULT 75 CHECK (at_risk_percent BETWEEN 1 AND 99),
  public_signature TEXT NOT NULL DEFAULT 'Mesa de Operaciones' CHECK (length(trim(public_signature)) > 0),
  -- Avisos por correo (spec/15 §4).
  mail_enabled BOOLEAN NOT NULL DEFAULT false,
  mail_team_link BOOLEAN NOT NULL DEFAULT true,
  mail_skip_actor BOOLEAN NOT NULL DEFAULT true,
  mail_team_enabled BOOLEAN NOT NULL DEFAULT true,
  mail_backup_emails TEXT[] NOT NULL DEFAULT '{}',
  mail_client_enabled BOOLEAN NOT NULL DEFAULT false,
  mail_affects_rule TEXT NOT NULL DEFAULT 'p1p2' CHECK (mail_affects_rule IN ('p1p2', 'incidents', 'none')),
  mail_comment_batch_minutes INT NOT NULL DEFAULT 15 CHECK (mail_comment_batch_minutes IN (0, 5, 15, 30, 60)),
  mail_include_pin BOOLEAN NOT NULL DEFAULT false,
  -- Eventos encendidos ('team.created', 'client.resolved'…). Por defecto,
  -- los marcados "sí" en spec/15 §4.2 y §4.3.
  mail_events TEXT[] NOT NULL DEFAULT ARRAY[
    'team.created', 'team.assigned', 'team.resolver_added', 'team.sla_response_breached',
    'team.sla_resolution_breached', 'team.reopened', 'team.merged', 'team.client_changed',
    'client.opened', 'client.comment', 'client.resolved', 'client.reopened'
  ],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ticket_settings (id) VALUES (true);

-- En cada ticket (spec/15 §5): la marca, los destinatarios propios (NULL =
-- los del cliente) y cuándo ya se avisó cada SLA (se avisa una sola vez).
ALTER TABLE tickets
  ADD COLUMN affects_client BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN notify_to TEXT[],
  ADD COLUMN notify_cc TEXT[],
  ADD COLUMN sla_response_breach_notified_at TIMESTAMPTZ,
  ADD COLUMN sla_resolution_warn_notified_at TIMESTAMPTZ,
  ADD COLUMN sla_resolution_breach_notified_at TIMESTAMPTZ;

-- Cola de correos de la Ticketera (spec/15 §7): la acción del analista nunca
-- espera al correo; un despachador los envía con reintentos. 'waiting' es un
-- aviso de comentarios al cliente que junta los que lleguen en la ventana
-- (comments guarda cada uno: {"at": …, "text": …}).
CREATE TABLE ticket_mail_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  mail_group TEXT NOT NULL CHECK (mail_group IN ('team', 'client')),
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  comments JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'waiting', 'sent', 'failed', 'no_recipients')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  send_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_mail_outbox_due ON ticket_mail_outbox(send_after) WHERE status IN ('pending', 'waiting');
CREATE INDEX idx_ticket_mail_outbox_ticket ON ticket_mail_outbox(ticket_id, created_at DESC);
