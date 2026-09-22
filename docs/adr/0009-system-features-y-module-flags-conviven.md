---
status: accepted
---

# `system_features` y `app_config.*_module_enabled` conviven como mecanismos separados

`app_config.soc_module_enabled`/`noc_module_enabled` (dos booleanos específicos, respondidos en el wizard de setup inicial) y `system_features` (tabla genérica de feature flags, ej. `glpi_sync`) se solapaban conceptualmente sin que la spec dijera si debían fusionarse. **Decisión del dueño (Fase 1 del roadmap)**: conviven separados, no se fusionan. Razón: son dos gates de naturaleza distinta — `soc_module_enabled`/`noc_module_enabled` es un gate **estructural** de qué dominio de negocio existe en la instalación (afecta rutas y menús enteros, se define una sola vez en el setup), mientras `system_features` es para features/integraciones puntuales que se prenden y apagan libremente desde la GUI sin pasar por el wizard (GLPI, y futuros complementos). Fusionarlos habría significado perder las columnas tipadas dedicadas del gate de módulo a cambio de un único mecanismo genérico, sin necesidad real de ese nivel de uniformidad.
