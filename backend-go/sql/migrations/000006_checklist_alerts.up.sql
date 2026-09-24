ALTER TABLE checklist_templates
  ADD COLUMN alert_nok_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN alert_nok_role_target TEXT;