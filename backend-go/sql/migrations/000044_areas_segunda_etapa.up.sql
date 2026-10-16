-- Segunda etapa de áreas (spec/16 §6.1, 9.7, diseño aprobado por el dueño
-- 2026-10-15): flujos entre áreas, calendario en Outlook, resumen mensual de
-- la jefatura y ventanas de mantenimiento que se repiten.

-- ===== Flujos entre áreas =====
-- Un flujo es una tarea de la Agenda con pasos en orden, cada uno de un área
-- y responsable. Cada paso es una agenda_task con flow_id y su posición. Un
-- paso «al terminar el anterior» (flow_after) espera y recibe su fecha cuando
-- el anterior se cierra: flow_days días hábiles desde ese día. Uno «en
-- paralelo» vence flow_days días hábiles desde el inicio del flujo. El
-- primero vence el día del inicio. Puede ser de una vez o repetirse
-- (decisión del dueño 2026-10-15): cada vuelta es un agenda_flow_runs.
CREATE TABLE agenda_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  recurrence JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agenda_tasks
  ADD COLUMN flow_id UUID REFERENCES agenda_flows(id) ON DELETE CASCADE,
  ADD COLUMN flow_position INT CHECK (flow_position BETWEEN 0 AND 19),
  ADD COLUMN flow_after BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN flow_days INT NOT NULL DEFAULT 0 CHECK (flow_days BETWEEN 0 AND 60),
  ADD CONSTRAINT chk_agenda_task_flow CHECK ((flow_id IS NULL) = (flow_position IS NULL));
CREATE UNIQUE INDEX uq_agenda_tasks_flow_position ON agenda_tasks(flow_id, flow_position) WHERE active AND flow_id IS NOT NULL;

CREATE TABLE agenda_flow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES agenda_flows(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, start_date)
);

-- 'waiting': el paso espera que termine el anterior (su due_date es el inicio
-- de la vuelta hasta que se libera). Las ocurrencias de un flujo son una por
-- paso y vuelta; las demás siguen siendo una por tarea y día.
ALTER TABLE agenda_occurrences
  ADD COLUMN flow_run_id UUID REFERENCES agenda_flow_runs(id) ON DELETE CASCADE,
  DROP CONSTRAINT agenda_occurrences_status_check,
  ADD CONSTRAINT agenda_occurrences_status_check CHECK (status IN ('pending', 'done', 'skipped', 'waiting')),
  DROP CONSTRAINT agenda_occurrences_task_id_due_date_key;
CREATE UNIQUE INDEX uq_agenda_occurrences_task_day ON agenda_occurrences(task_id, due_date) WHERE flow_run_id IS NULL;
CREATE UNIQUE INDEX uq_agenda_occurrences_flow_step ON agenda_occurrences(task_id, flow_run_id) WHERE flow_run_id IS NOT NULL;
CREATE INDEX idx_agenda_occurrences_run ON agenda_occurrences(flow_run_id) WHERE flow_run_id IS NOT NULL;

-- ===== Calendario en Outlook =====
-- Un enlace secreto por persona (suscripción ICS, solo lectura): sus
-- vencimientos y, si quiere, las ventanas de mantenimiento de sus áreas.
-- El token va cifrado (crypto.Box, para volver a copiarlo desde el Perfil) y
-- se busca por su hash. Va detrás de system_features.calendar_feed.
CREATE TABLE calendar_feeds (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT NOT NULL,
  include_windows BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ
);
INSERT INTO system_features (code, name, description) VALUES
  ('calendar_feed', 'Calendario en Outlook', 'Cada persona puede ver sus vencimientos de la Agenda en Outlook o Google Calendar con un enlace propio (Perfil → Calendario).')
ON CONFLICT (code) DO NOTHING;

-- ===== Resumen mensual de la jefatura =====
-- La foto de un mes cerrado por área (se guarda el primer día hábil del mes
-- siguiente, decisión del dueño 2026-10-15): lo enviado no cambia aunque
-- alguien reabra una tarea vieja.
CREATE TABLE monthly_summaries (
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (extract(day FROM month) = 1),
  data JSONB NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id, month)
);

-- ===== Ventanas de mantenimiento que se repiten =====
-- La serie guarda la regla; las ventanas se generan 60 días hacia adelante
-- como ventanas normales (el escalamiento no cambia). Una que cae en feriado
-- se crea inactiva con holiday_name; si es urgente, la jefatura o el admin la
-- aplica igual y queda quién (decisión del dueño 2026-10-15). Saltar una vez
-- es dejarla inactiva.
-- rule: {kind: weekly|monthly, weekdays: [0..6], day: 1..31 | nth: 1..5 (5 =
-- la última) + weekday: 0..6, start: "HH:MM", end: "HH:MM"}; si end <= start
-- pasa la medianoche.
CREATE TABLE maintenance_window_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  territorial_unit_id UUID REFERENCES territorial_units(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  notes TEXT,
  suppress_notifications BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  rule JSONB NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_window_series_one_scope CHECK (
    (service_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int + (territorial_unit_id IS NOT NULL)::int +
    (organization_id IS NOT NULL)::int + (area_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1),
  CONSTRAINT chk_window_series_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

ALTER TABLE maintenance_windows
  ADD COLUMN series_id UUID REFERENCES maintenance_window_series(id) ON DELETE CASCADE,
  ADD COLUMN series_day DATE,
  ADD COLUMN holiday_name TEXT,
  ADD COLUMN approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_maintenance_windows_series_day ON maintenance_windows(series_id, series_day) WHERE series_id IS NOT NULL;
