DROP TABLE IF EXISTS ticket_mail_outbox;
ALTER TABLE tickets
  DROP COLUMN IF EXISTS affects_client,
  DROP COLUMN IF EXISTS notify_to,
  DROP COLUMN IF EXISTS notify_cc,
  DROP COLUMN IF EXISTS sla_response_breach_notified_at,
  DROP COLUMN IF EXISTS sla_resolution_warn_notified_at,
  DROP COLUMN IF EXISTS sla_resolution_breach_notified_at;
DROP TABLE IF EXISTS ticket_settings;
