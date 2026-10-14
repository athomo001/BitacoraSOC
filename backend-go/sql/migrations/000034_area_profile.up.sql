-- Perfil por defecto de cada área (Usuarios por área y nivel, 2026-10-13):
-- al ubicar a una persona en un área y nivel, la app arma sola el grupo
-- («Infra N1») con este perfil. SOC y NOC son Operativo; las demás, Resolutor.
ALTER TABLE areas
  ADD COLUMN default_profile TEXT NOT NULL DEFAULT 'resolutor'
  CHECK (default_profile IN ('operativo', 'resolutor', 'gestion'));
UPDATE areas SET default_profile = 'operativo' WHERE code IN ('soc', 'noc');
