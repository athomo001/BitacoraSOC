-- Orden de los turnos de trabajo (paridad con el legacy: WorkShift.order y
-- PUT /api/work-shifts/reorder; decisión del dueño 2026-10-16). Los que ya
-- hay quedan en el orden en que se veían antes (por nombre).
ALTER TABLE work_shifts ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

UPDATE work_shifts w SET sort_order = o.n
FROM (SELECT id, row_number() OVER (ORDER BY name, id)::int AS n FROM work_shifts) o
WHERE o.id = w.id;
