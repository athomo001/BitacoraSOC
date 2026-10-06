-- 000020: Reportes (comentario del dueño #10) y Avisos por cliente (canvas
-- v18–v20 aprobado). Portado de routes/reports.js y clientAlertController.js
-- del legacy.

-- Historial de envíos: informe de incidente o boletín de seguridad, con el
-- correo tal como salió (html, con las imágenes en línea) y los campos del
-- formulario para "Usar como base" (sin imágenes).
CREATE TABLE report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('incident', 'bulletin')),
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  cc_recipients TEXT[] NOT NULL DEFAULT '{}',
  html TEXT NOT NULL,
  payload JSONB,
  -- sent | failed | partial (boletín: algún lote por dominio falló) | legacy
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_by_username TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_history_created ON report_history(created_at DESC);

-- Avisos por cliente (clientEscalationRules de tipo special_alert): un
-- mensaje que sale antes de enviar un reporte a ese cliente, en ciertas
-- ventanas horarias; si lo pide, hay que confirmar "Leí el aviso".
CREATE TABLE client_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- report (enviar) y/o copy-report (copiar el reporte), como el legacy.
  contexts TEXT[] NOT NULL DEFAULT '{report,copy-report}',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  priority INT NOT NULL DEFAULT 100,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  holiday_dates DATE[] NOT NULL DEFAULT '{}',
  -- [{mode, startTime, endTime, daysOfWeek, holidayOnly}] con los modos del
  -- legacy: always, outside_business_hours, between_hours, after_hour,
  -- before_hour, weekend_only, weekdays_only.
  time_windows JSONB NOT NULL DEFAULT '[{"mode":"always","startTime":"09:00","endTime":"17:00","daysOfWeek":[],"holidayOnly":false}]',
  channels TEXT[] NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  requires_ack BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_alert_rules_org ON client_alert_rules(organization_id) WHERE enabled;

-- "Leí el aviso": una vez por persona, ocurrencia (el día local, o la
-- vigencia si la regla tiene fechas) y contexto, como readBy del legacy.
CREATE TABLE client_alert_acks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES client_alert_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL,
  context TEXT NOT NULL,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, user_id, occurrence_key, context)
);
