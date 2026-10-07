-- 000027: catálogo de eventos del informe de incidente (catalogEvents del
-- legacy, ~1.900: "Phishing detectado"…). Al escribir el nombre del evento,
-- Reportes sugiere del catálogo y rellena "Motivo" con su texto por defecto.
CREATE TABLE report_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  motivo_default TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_events_name ON report_events (lower(name));
