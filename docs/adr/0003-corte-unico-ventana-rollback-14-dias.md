---
status: accepted
---

# Corte único (big-bang) con ventana de rollback de 14 días

BitacoraSOC es un sistema operativo 24/7 sin ventana de mantenimiento cómoda. Se consideró migración gradual (convivencia Node/Go por módulo) contra corte único, y se decidió **corte único**: todos los usuarios pasan al sistema nuevo en un mismo momento, sin dos sistemas en paralelo para el usuario final. Es una decisión de alto riesgo operativo (un error de "a quién avisar" el día del corte es un incidente real, no una molestia de UI) que se mitiga con una **ventana de rollback fija de 14 días**: el stack legacy (Node/MongoDB) se apaga en escrituras pero queda disponible en modo solo-lectura (`MONGO_READONLY=true`) en un puerto alterno, junto con un dump final de Mongo y snapshot de Postgres, para auditoría forense y reconciliación si aparece una inconsistencia severa. Cumplidos los 14 días, el legacy se desmantela definitivamente — no hay vuelta atrás después de eso. Ver `02-alcance-y-roadmap.md` sección 2 punto 7 para el checklist de paridad que debe pasar antes de cortar.
