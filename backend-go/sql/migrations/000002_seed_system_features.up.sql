-- Catálogo de system_features (spec/04-contratos-api.md "Gobernanza Dinámica
-- de Módulos desde la GUI", docs/adr/0009). Las filas existen desde el día 1
-- y nacen apagadas: un feature es código que ya existe en el binario, el
-- admin solo lo activa/desactiva (PATCH /api/system-features/:code) — no se
-- "crean" features nuevos desde la GUI, por eso no hay POST/DELETE.
-- ON CONFLICT DO NOTHING: nunca pisa un is_enabled/config_payload que el
-- admin ya haya cambiado si la migración se reaplica.
INSERT INTO system_features (code, name, description) VALUES
  ('native_tickets', 'Ticketera nativa ITIL 4', 'Módulo opcional de tickets (incidentes/requerimientos) con SLA con pausa — Fase 10.'),
  ('zabbix_inbound', 'Ingesta de alertas Zabbix', 'Recepción de alertas externas vía webhook de Zabbix — Backlog Post-Corte.'),
  ('glpi_sync', 'Sincronización con GLPI', 'Integración bidireccional opcional con GLPI 11.x — Backlog Post-Corte.')
ON CONFLICT (code) DO NOTHING;
