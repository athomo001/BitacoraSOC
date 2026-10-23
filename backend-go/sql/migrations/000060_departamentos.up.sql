-- Departamentos (spec/16 §3.5.1, pedido y decisiones del dueño 2026-10-22):
-- agrupan áreas bajo un nombre (p. ej. CDC: SOC, NOC, QA, Pentesting, Nube).
-- Un área está en un departamento o en ninguno.
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_departments_name ON departments(lower(name));

-- shares_team: el área comparte su gente con las otras áreas marcadas del
-- mismo departamento (quien entra a una entra a todas con el mismo nivel).
ALTER TABLE areas
  ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN shares_team BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_areas_department ON areas(department_id);

-- La jefatura del departamento es un grupo de jefatura que la app mantiene:
-- capacidad area:lead y todas las áreas del departamento. Así todo lo que ya
-- reconoce a una jefatura (Mi equipo, Agenda, Inventario, avisos, Gestión)
-- la reconoce sin cambios. El panel de la persona no lo toca.
ALTER TABLE permission_groups
  ADD COLUMN department_id UUID UNIQUE REFERENCES departments(id) ON DELETE CASCADE;

-- Qué ve cada CSM en Gestión: sin filas, todo (como hasta ahora); con filas,
-- solo esos departamentos o áreas.
CREATE TABLE management_scopes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  CHECK ((department_id IS NULL) <> (area_id IS NULL))
);
CREATE UNIQUE INDEX idx_management_scopes_dept ON management_scopes(user_id, department_id) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX idx_management_scopes_area ON management_scopes(user_id, area_id) WHERE area_id IS NOT NULL;
