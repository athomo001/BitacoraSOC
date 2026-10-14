-- Tickets por área (spec/16 §4.1, 9.1): cada ticket está en la cola de un
-- área (la que lo resuelve) y recuerda el área que lo pidió. Los de hoy van
-- a la cola del SOC; los de alcance NOC, a la del NOC.
ALTER TABLE tickets
  ADD COLUMN area_id UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001' REFERENCES areas(id) ON DELETE RESTRICT,
  ADD COLUMN requested_area_id UUID NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001' REFERENCES areas(id) ON DELETE RESTRICT;
UPDATE tickets SET area_id = 'a0000000-0000-4000-8000-000000000002', requested_area_id = 'a0000000-0000-4000-8000-000000000002' WHERE scope = 'noc';
CREATE INDEX idx_tickets_area ON tickets(area_id);
CREATE INDEX idx_tickets_requested_area ON tickets(requested_area_id);
