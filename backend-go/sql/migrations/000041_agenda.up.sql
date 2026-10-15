-- Agenda (spec/16 §4.3, 9.3, diseño aprobado por el dueño 2026-10-14): un
-- solo motor para todo lo que "hay que hacer para una fecha" (informes de
-- N2/N3, trabajos recurrentes de Infra, acciones del CSM, pendientes sueltos).
--
-- Horario hábil de la Agenda: solo ordena vencimientos y avisos. No es el
-- horario de la oficina ni toca Turnos, guardias o escalamiento (24/7).
CREATE TABLE agenda_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- 0 = domingo … 6 = sábado.
  work_days INT[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (work_days <@ ARRAY[0,1,2,3,4,5,6]),
  day_start TIME NOT NULL DEFAULT '08:00',
  day_end TIME NOT NULL DEFAULT '20:00' CHECK (day_end > day_start),
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  -- País de la lista de feriados incluida en la app (internal/agenda/holidays).
  holiday_country TEXT NOT NULL DEFAULT 'CL',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO agenda_settings DEFAULT VALUES;

-- Feriados (los configura el admin; se importan por año desde la lista
-- incluida y los regionales se agregan a mano).
CREATE TABLE holidays (
  day DATE PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La tarea programada (plantilla). Responsable: una persona, un nivel del
-- área («N1 de Infra») o quien esté de guardia en una guardia del área.
CREATE TABLE agenda_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  assignee_kind TEXT NOT NULL CHECK (assignee_kind IN ('person', 'level', 'guard')),
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assignee_level_id UUID REFERENCES levels(id) ON DELETE RESTRICT,
  assignee_team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  -- {kind: once|days|weekly|bizN|lastBiz|fixed, …} (internal/agenda.Recurrence).
  recurrence JSONB NOT NULL,
  -- Avisos: días hábiles antes del vencimiento (0 = el mismo día). Los envía
  -- el centro de notificaciones (9.5); el atraso se avisa siempre.
  warn_days INT[] NOT NULL DEFAULT '{0}',
  steps TEXT[] NOT NULL DEFAULT '{}',
  doc_url TEXT CHECK (doc_url IS NULL OR length(doc_url) <= 500),
  -- Se cierra sola al enviar este informe de Reportes al cliente de la tarea.
  report_kind TEXT CHECK (report_kind IN ('incident', 'bulletin')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_agenda_task_assignee CHECK (
    (assignee_kind = 'person' AND assignee_user_id IS NOT NULL) OR
    (assignee_kind = 'level' AND assignee_level_id IS NOT NULL) OR
    (assignee_kind = 'guard' AND assignee_team_id IS NOT NULL))
);
CREATE INDEX idx_agenda_tasks_area ON agenda_tasks(area_id) WHERE active;
CREATE INDEX idx_agenda_tasks_creator ON agenda_tasks(created_by);

-- Cada vez que toca: pendiente, hecha u omitida (con motivo). Atrasada es
-- una pendiente con el vencimiento pasado (se calcula, no se guarda).
-- user_id es quién la tiene; sin nadie, la ve el nivel ofrecido del área
-- (offered_level_id) o la guardia. absent_user_id: la tenía alguien que
-- quedó ausente en Dotación y volvió a su nivel.
CREATE TABLE agenda_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agenda_tasks(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  moved_from DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  offered_level_id UUID REFERENCES levels(id) ON DELETE SET NULL,
  absent_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  steps_done INT[] NOT NULL DEFAULT '{}',
  note TEXT CHECK (note IS NULL OR length(note) <= 5000),
  link TEXT CHECK (link IS NULL OR length(link) <= 500),
  skip_reason TEXT CHECK (skip_reason IS NULL OR length(skip_reason) <= 500),
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  report_history_id UUID REFERENCES report_history(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, due_date)
);
CREATE INDEX idx_agenda_occurrences_pending ON agenda_occurrences(due_date) WHERE status = 'pending';
CREATE INDEX idx_agenda_occurrences_user ON agenda_occurrences(user_id) WHERE status = 'pending';
