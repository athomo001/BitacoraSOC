---
status: accepted
---

# Ticketing nativo ITIL como núcleo; GLPI pasa a integración opcional

El legacy asume GLPI como el sistema de ticketing real, con una integración bidireccional ya diseñada (riesgo de loop-avoidance conocido). Se decidió construir una **ticketera nativa ITIL** (`tickets`/`ticket_comments`/`ticket_tasks`, SLA con pausa y reapertura) como parte del núcleo obligatorio del corte, funcionando standalone sin depender de GLPI para nada — y GLPI pasa a ser una integración **opcional**, activable por feature flag (`system_features.glpi_sync`) para quien ya la usa y la quiere seguir usando. Es una decisión cara de revertir (el diseño de datos de `tickets` y el flujo de creación desde bitácora ya asumen que la ticketera nativa es la ruta principal) y contra-intuitiva sin este contexto (alguien podría asumir que GLPI seguía siendo la única fuente de verdad de ticketing) — la integración bidireccional completa con GLPI queda especificada en detalle pero diferida al Backlog Post-Corte. Ver `02-alcance-y-roadmap.md` sección 1 y Fase 10 del roadmap.
