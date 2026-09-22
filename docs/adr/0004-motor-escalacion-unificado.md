---
status: accepted
---

# Motor de escalación unificado reemplaza los 3 mecanismos legacy

El legacy resuelve "a quién avisar" con tres mecanismos distintos según el caso (contacto 1:1 en `Service`, `escalationFlow` embebido en `CatalogLogSource`, y `ClientEscalationRule` para ventanas de mantenimiento) — ninguno basado en grupos ni con cobertura geográfica real, lo que motivó todo el proyecto (el dolor de "a quién avisar cuando se cae un enlace repartido por todo Chile" no tenía dónde encajar). Se decidió un **único motor de escalación** (`escalation_policies`/`escalation_steps` sobre `teams`, con precedencia activo > unidad territorial vía `resolvedVia`) que sirve tanto el caso SOC (cliente→servicio→contacto) como el caso NOC (región→circuito→equipo) — SOC queda modelado como el caso particular de un `team` de 1 miembro. Es la decisión arquitectónica central del rewrite: cara de revertir (toca `escalation_policies`, `teams`, `team_coverage`, resolución y despacho) y el resultado de un trade-off real (un motor único es más simple de operar y auditar que tres, a costa de que SOC ya no tiene un camino "directo" propio). Ver `01-arquitectura.md` sección 4 y `00-mapa-mental.md` para el caso de prueba completo (6 routers de Calama).
