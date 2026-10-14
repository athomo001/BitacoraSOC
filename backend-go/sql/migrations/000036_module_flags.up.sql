-- Módulos y áreas son cosas distintas (dueño, 2026-10-14): el MÓDULO SOC/NOC
-- son las funciones (bitácora SOC, servicios, activos, territorio,
-- escalamiento por servicio o zona) y se enciende en Administración →
-- Módulos; el ÁREA SOC/NOC es gente (personal, jefaturas, permisos) y se
-- administra en Áreas y niveles. 000033 los había unido en areas.active;
-- vuelven a app_config, partiendo del estado de hoy.
ALTER TABLE app_config
  ADD COLUMN soc_module_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN noc_module_enabled BOOLEAN NOT NULL DEFAULT false;
UPDATE app_config SET
  soc_module_enabled = COALESCE((SELECT active FROM areas WHERE code = 'soc'), false),
  noc_module_enabled = COALESCE((SELECT active FROM areas WHERE code = 'noc'), false);
