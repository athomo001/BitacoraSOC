-- Notificaciones (spec/16 §4.5, 9.5, diseño aprobado por el dueño 2026-10-15)
-- y ventanas de mantenimiento ampliadas (§4.6).
--
-- La campana: el registro de todo lo que se le avisó a cada persona. Lo que
-- además sale como aviso emergente o del navegador se decide al crearlo,
-- según sus preferencias. Los avisos iguales se agrupan (count).
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- agenda.assigned | agenda.warn | agenda.due | agenda.late | agenda.handover | agenda.absence
  -- ticket.assigned | ticket.derived | ticket.comment | inventory.request | window | notice
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- Ruta de la app a la que lleva ("/agenda", "/tickets?id=…").
  link TEXT NOT NULL DEFAULT '',
  group_key TEXT,
  count INT NOT NULL DEFAULT 1,
  toast BOOLEAN NOT NULL DEFAULT false,
  browser BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX idx_notifications_user ON notifications(user_id, updated_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id, group_key) WHERE read_at IS NULL;

-- Lo que fija el admin (decisiones del dueño 2026-10-15): resumen diario a
-- las 08:00 de los días hábiles de la Agenda, los atrasos y los avisos con
-- acuse no se apagan, la campana guarda 90 días.
CREATE TABLE notification_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  digest_time TIME NOT NULL DEFAULT '08:00',
  locked_kinds TEXT[] NOT NULL DEFAULT '{agenda.late,notice}',
  group_minutes INT NOT NULL DEFAULT 15 CHECK (group_minutes BETWEEN 0 AND 240),
  retention_days INT NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 730),
  last_digest_day DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO notification_settings DEFAULT VALUES;

-- Lo que elige cada persona: {kind: {toast, email, browser}}; lo que no
-- está usa el valor por defecto de la app.
CREATE TABLE notification_prefs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  digest BOOLEAN NOT NULL DEFAULT true,
  browser BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Avisos de la Agenda ya enviados por ocurrencia ("warn2", "due", "late"):
-- no se repiten.
CREATE TABLE agenda_occurrence_alerts (
  occurrence_id UUID NOT NULL REFERENCES agenda_occurrences(id) ON DELETE CASCADE,
  alert TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (occurrence_id, alert)
);

-- Aviso con acuse de lectura (§4.5.1): ventana que solo se cierra con
-- «Leído». audience: {kind: people|level|area|all, ids: [...], areaId}.
CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) <= 10000),
  audience JSONB NOT NULL,
  publish_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_notice_expires CHECK (expires_at IS NULL OR expires_at > publish_at)
);
CREATE INDEX idx_notices_publish ON notices(publish_at) WHERE NOT published;

CREATE TABLE notice_recipients (
  notice_id UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX idx_notice_recipients_pending ON notice_recipients(user_id) WHERE read_at IS NULL;

-- Ventanas de mantenimiento ampliadas (§4.6): además de servicio, activo o
-- zona, un cliente (todos sus servicios), un área o un equipo de la app.
-- Cerrar antes de tiempo queda registrado. agenda_task_id: la ventana se
-- creó desde una tarea de la Agenda y se mueve con ella.
ALTER TABLE maintenance_windows
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN agenda_task_id UUID REFERENCES agenda_tasks(id) ON DELETE SET NULL,
  ADD COLUMN closed_at TIMESTAMPTZ,
  ADD COLUMN closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN notified_start BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN notified_end BOOLEAN NOT NULL DEFAULT false,
  DROP CONSTRAINT chk_maintenance_window_one_scope,
  ADD CONSTRAINT chk_maintenance_window_one_scope CHECK (
    (service_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int + (territorial_unit_id IS NOT NULL)::int +
    (organization_id IS NOT NULL)::int + (area_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1
  );
-- Las que ya pasaron no se avisan al aplicar la migración.
UPDATE maintenance_windows SET notified_start = starts_at <= now(), notified_end = ends_at <= now();
CREATE INDEX idx_maintenance_windows_org ON maintenance_windows(organization_id, starts_at, ends_at) WHERE active;
CREATE INDEX idx_maintenance_windows_area ON maintenance_windows(area_id, starts_at, ends_at) WHERE active;
CREATE INDEX idx_maintenance_windows_team ON maintenance_windows(team_id, starts_at, ends_at) WHERE active;
