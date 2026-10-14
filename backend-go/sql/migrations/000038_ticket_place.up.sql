-- Lugar del ticket (#24, 7b): la localidad del Territorio donde ocurre. Si el
-- ticket tiene un activo, la localidad es la del activo. El Mapa cuenta los
-- tickets abiertos de cada localidad.
ALTER TABLE tickets ADD COLUMN territorial_unit_id UUID REFERENCES territorial_units(id) ON DELETE SET NULL;
CREATE INDEX idx_tickets_territorial_unit ON tickets(territorial_unit_id) WHERE territorial_unit_id IS NOT NULL;
UPDATE tickets t SET territorial_unit_id = a.territorial_unit_id FROM assets a WHERE a.id = t.asset_id;
