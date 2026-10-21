-- Gestión CSM (spec/16 §4.4, 9.4; diseño aprobado por la CSM y el dueño
-- 2026-10-20, <https://claude.ai/artifact/MkPD5Eipnsgiy95BPQudob>). Las
-- acciones, recordatorios y deadlines son tareas de la Agenda: no hay un motor
-- aparte. Aquí se suma lo que la Agenda no tenía (tipo de acción, tarea clave,
-- ticket), los datos de la cartera, las metas con hitos y las plantillas.

-- Cartera (§4.4.2, §4.4.3): CSM a cargo, inicio del servicio, renovación y,
-- si el contrato lo pide, un objetivo de SLA propio (pregunta 4 del dueño).
ALTER TABLE organizations
  ADD COLUMN csm_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN service_start_date DATE,
  ADD COLUMN renewal_date DATE,
  ADD COLUMN sla_target INT CHECK (sla_target BETWEEN 50 AND 100);

-- Acciones (§4.4.1, §4.4.6): tipo (Reunión, Comité y Contacto cuentan como
-- contacto con el cliente), tarea clave (su atraso baja la salud) y el
-- ticket al que le da seguimiento.
ALTER TABLE agenda_tasks
  ADD COLUMN action_kind TEXT CHECK (action_kind IN ('meeting', 'committee', 'contact', 'report', 'other')),
  ADD COLUMN is_key BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;
CREATE INDEX idx_agenda_tasks_ticket ON agenda_tasks(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_agenda_tasks_org ON agenda_tasks(organization_id) WHERE organization_id IS NOT NULL;

-- Objetivo del SLA (95 %) y desde cuándo se usa la Gestión: los días sin
-- contacto de un cliente se cuentan desde aquí o desde el inicio de su
-- servicio, lo más reciente (§4.4.1), para que el día del corte no queden
-- todos en amarillo.
CREATE TABLE management_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  sla_target INT NOT NULL DEFAULT 95 CHECK (sla_target BETWEEN 50 AND 100),
  started_on DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO management_settings DEFAULT VALUES;

-- Metas (§4.4.5): de un cliente (con área opcional), de un área o de una
-- persona. El estado se calcula: en curso, en riesgo (a mano o sola), por
-- confirmar (las que cuentan para el bono las confirma la jefatura), cumplida
-- o no cumplida (pasó la fecha).
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  scope TEXT NOT NULL CHECK (scope IN ('client', 'area', 'person')),
  client_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  person_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  -- Responsable: marca los hitos (en las de una persona, la persona).
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Solo las de una persona: tipo y si cuenta para el bono (la app solo lo
  -- registra; no guarda montos ni calcula el bono).
  kind TEXT CHECK (kind IN ('certification', 'action', 'other')),
  bonus_rank TEXT CHECK (bonus_rank IN ('primary', 'secondary')),
  due_date DATE NOT NULL,
  -- Plazo en días hábiles desde que se creó (si se dio así).
  estimate_biz_days INT CHECK (estimate_biz_days BETWEEN 1 AND 500),
  evidence_required BOOLEAN NOT NULL DEFAULT false,
  manual_risk BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Bono: la jefatura confirma antes de darla por cumplida (pregunta 6).
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_goal_scope CHECK (
    (scope = 'client' AND client_id IS NOT NULL AND person_user_id IS NULL) OR
    (scope = 'area' AND area_id IS NOT NULL AND client_id IS NULL AND person_user_id IS NULL) OR
    (scope = 'person' AND person_user_id IS NOT NULL AND client_id IS NULL AND area_id IS NULL)),
  CONSTRAINT chk_goal_person_fields CHECK (scope = 'person' OR (kind IS NULL AND bonus_rank IS NULL))
);
CREATE INDEX idx_goals_client ON goals(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_goals_person ON goals(person_user_id) WHERE person_user_id IS NOT NULL;

-- Hitos: se marcan a mano o, enlazados a un ticket o a una tarea de la
-- Agenda, solos cuando el ticket se resuelve o la tarea se hace (y se
-- desmarcan si el ticket se reabre). done_by_name: quién lo cumplió tal como
-- se muestra («Camila» o el técnico de GLPI).
CREATE TABLE goal_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  agenda_task_id UUID REFERENCES agenda_tasks(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  done_by_name TEXT,
  done_source TEXT CHECK (done_source IN ('manual', 'ticket', 'task')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_goal_milestone_link CHECK (ticket_id IS NULL OR agenda_task_id IS NULL)
);
CREATE INDEX idx_goal_milestones_goal ON goal_milestones(goal_id, position);
CREATE INDEX idx_goal_milestones_ticket ON goal_milestones(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_goal_milestones_task ON goal_milestones(agenda_task_id) WHERE agenda_task_id IS NOT NULL;

-- Historial de la meta (y su parte de la línea de tiempo del cliente).
CREATE TABLE goal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_goal_events_goal ON goal_events(goal_id, created_at DESC);

-- Certificado de una meta: un archivo (en la base, como las imágenes de los
-- tickets) o un enlace de verificación.
CREATE TABLE goal_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INT CHECK (size_bytes <= 10485760),
  file_data BYTEA,
  url TEXT CHECK (url IS NULL OR length(url) <= 500),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_goal_evidence_kind CHECK ((file_data IS NULL) <> (url IS NULL))
);
CREATE INDEX idx_goal_evidence_goal ON goal_evidence(goal_id, created_at DESC);

-- Plantillas (playbooks): acciones con quién y cuándo, relativas a una
-- fecha: el día que se aplica, una fecha que se elige (la reunión) o la
-- renovación del cliente. Al aplicarla se crean tareas normales de la Agenda.
CREATE TABLE playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  anchor TEXT NOT NULL CHECK (anchor IN ('apply', 'date', 'renewal')),
  -- Las que vienen con la app (las pantallas las ofrecen por nombre).
  system_key TEXT UNIQUE CHECK (system_key IN ('onboarding', 'qbr', 'renewal')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una acción de la plantilla. assignee: el CSM a cargo del cliente, un
-- nivel de un área o una guardia. offset: cuántos días antes (negativo) o
-- después de la fecha; hábiles o corridos («90 días antes» de la renovación).
CREATE TABLE playbook_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  action_kind TEXT CHECK (action_kind IN ('meeting', 'committee', 'contact', 'report', 'other')),
  is_key BOOLEAN NOT NULL DEFAULT false,
  assignee TEXT NOT NULL CHECK (assignee IN ('csm', 'level', 'guard')),
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  level_id UUID REFERENCES levels(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  offset_days INT NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN -400 AND 400),
  offset_unit TEXT NOT NULL DEFAULT 'biz' CHECK (offset_unit IN ('biz', 'cal')),
  CONSTRAINT chk_playbook_item_assignee CHECK (
    (assignee = 'csm') OR
    (assignee = 'level' AND area_id IS NOT NULL AND level_id IS NOT NULL) OR
    (assignee = 'guard' AND team_id IS NOT NULL))
);
CREATE INDEX idx_playbook_items_playbook ON playbook_items(playbook_id, position);

-- Cada vez que se aplicó una plantilla a un cliente, y las tareas que creó.
CREATE TABLE playbook_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  anchor_date DATE NOT NULL,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_playbook_applications_client ON playbook_applications(client_id, applied_at DESC);
ALTER TABLE agenda_tasks ADD COLUMN playbook_application_id UUID REFERENCES playbook_applications(id) ON DELETE SET NULL;

-- Las tres plantillas del diseño aprobado. Infraestructura es «infra» o
-- «infraestructura» según la instalación; lo de un área que no existe no se
-- agrega (se puede sumar después).
INSERT INTO playbooks (id, name, description, anchor, system_key) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Incorporar un cliente nuevo', 'Al crear el cliente', 'apply', 'onboarding'),
  ('b0000000-0000-4000-8000-000000000002', 'Revisión trimestral (QBR)', 'Cada 3 meses, por cliente', 'date', 'qbr'),
  ('b0000000-0000-4000-8000-000000000003', 'Renovación del contrato', 'Con la fecha de renovación del cliente', 'renewal', 'renewal');

INSERT INTO playbook_items (playbook_id, position, name, action_kind, is_key, assignee, area_id, level_id, offset_days, offset_unit)
SELECT 'b0000000-0000-4000-8000-000000000001'::uuid, x.pos, x.name, x.kind, false, x.assignee, a.id, l.id, x.off, 'biz'
FROM (VALUES
  (1, 'Alta de fuentes de log', 'other', 'level', 'soc', 'n2', 1),
  (2, 'Definir la política de escalamiento', 'other', 'level', 'soc', 'n3', 3),
  (3, 'Cargar sus equipos en el Inventario', 'other', 'level', 'infra', 'n1', 5),
  (4, 'Reunión de bienvenida', 'meeting', 'csm', NULL, NULL, 5),
  (5, 'Primer informe de servicio', 'report', 'level', 'soc', 'n2', 20)
) AS x(pos, name, kind, assignee, area_code, level_code, off)
LEFT JOIN LATERAL (SELECT ar.id FROM areas ar WHERE ar.code = x.area_code OR (x.area_code = 'infra' AND ar.code LIKE 'infra%')
  ORDER BY (ar.code = x.area_code) DESC LIMIT 1) a ON true
LEFT JOIN levels l ON l.code = x.level_code
WHERE x.assignee = 'csm' OR (a.id IS NOT NULL AND l.id IS NOT NULL);

INSERT INTO playbook_items (playbook_id, position, name, action_kind, is_key, assignee, area_id, level_id, offset_days, offset_unit)
SELECT 'b0000000-0000-4000-8000-000000000002'::uuid, x.pos, x.name, x.kind, x.is_key, x.assignee, a.id, l.id, x.off, 'biz'
FROM (VALUES
  (1, 'Preparar los indicadores del trimestre', 'report', false, 'csm', NULL, NULL, -10),
  (2, 'Resumen de incidentes y tiempos', 'report', false, 'level', 'soc', 'n2', -7),
  (3, 'Estado de la infraestructura', 'report', false, 'level', 'infra', 'n2', -7),
  (4, 'Reunión con el cliente', 'meeting', true, 'csm', NULL, NULL, 0),
  (5, 'Enviar acta y compromisos', 'report', false, 'csm', NULL, NULL, 2)
) AS x(pos, name, kind, is_key, assignee, area_code, level_code, off)
LEFT JOIN LATERAL (SELECT ar.id FROM areas ar WHERE ar.code = x.area_code OR (x.area_code = 'infra' AND ar.code LIKE 'infra%')
  ORDER BY (ar.code = x.area_code) DESC LIMIT 1) a ON true
LEFT JOIN levels l ON l.code = x.level_code
WHERE x.assignee = 'csm' OR (a.id IS NOT NULL AND l.id IS NOT NULL);

INSERT INTO playbook_items (playbook_id, position, name, action_kind, is_key, assignee, offset_days, offset_unit) VALUES
  ('b0000000-0000-4000-8000-000000000003', 1, 'Revisar la salud y los indicadores', 'other', false, 'csm', -90, 'cal'),
  ('b0000000-0000-4000-8000-000000000003', 2, 'Propuesta de renovación', 'report', true, 'csm', -60, 'cal'),
  ('b0000000-0000-4000-8000-000000000003', 3, 'Reunión con gerencia', 'meeting', true, 'csm', -30, 'cal');
