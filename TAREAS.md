# Tareas de Bitácora Ops 2.0

Lo hecho, lo que está en revisión y lo que falta hasta el corte. Marca con `[x]` lo que se termina y mueve la línea de sección. El detalle de cada punto está en `spec/12-pendientes.md` y en `docs/history/CHANGELOG.md`.

## Hitos

- [x] Núcleo 2.0 completo (fases 1 a 13)
- [ ] Áreas TI, Infra y CSM (9.1 a 9.7 hechas; falta la Gestión CSM)
- [ ] Gestión CSM (la segunda etapa de áreas ya está hecha)
- [ ] Wiki y orquestador
- [ ] Ensayo de paridad 2
- [ ] Corte a producción y fin del rollback

## En curso

- [ ] Revisar en la app el Mapa y el lugar del ticket (#24 y 7b) — Dueño
- [ ] Revisar en la app colas por área, Inventario y Agenda (9.1, 9.2, 9.3) — Dueño
- [ ] Revisar en la app las Notificaciones (9.5) — Dueño
- [ ] Probar la importación desde GLPI contra el GLPI real (9.6) — Dueño
- [ ] Revisión humana del shadow-diff del escalamiento — Equipo SOC
- [ ] Revisar en la app la segunda etapa (9.7): flujos, calendario en Outlook, resumen mensual y ventanas que se repiten — Dueño
- [x] Gestión CSM (9.4): el CSM validó el diseño y mandó feedback (2026-10-19); spec ajustado en `16` §4.4 — CSM
- [x] Gestión CSM (9.4): diseño rehecho con el feedback del CSM (2026-10-19)
- [ ] Tema Rosa con efecto 8-bit (construido el 2026-10-19, ver CHANGELOG): revisarlo en la app — Dueño
- [ ] Gestión CSM (9.4): en pausa; el diseño rehecho (<https://claude.ai/artifact/MkPD5Eipnsgiy95BPQudob>) se envió a la CSM el 2026-10-19 y se implementa si lo aprueba — CSM

## Por hacer

### Áreas
- [ ] Decidir las 7 preguntas de la Gestión CSM (`16` §4.4.10; incluye quién crea las metas por persona y quién confirma una certificación para el bono) — Dueño
- [ ] Comunicaciones internas del CSM y la tarea «avisar al cliente» (espera a la 9.4)

### Paridad con el legacy (revisión y decisiones del dueño, 2026-10-16)
- [x] Correo «no se hizo el checklist de inicio»: igual al legacy (09:30, a la guardia N1 no hábil y a los N2)
- [x] Recordatorio de semana de guardia sin cubrir: igual al legacy (7 días antes, a los N2)
- [x] Login: corregir el texto «Analistas/Admin 4h | Invitados 2h» (sin invitados; la sesión dura 8 h)
- [x] Bitácora: filtrar por autor y por cliente, y «Mías», en la barra de filtros actual
- [x] Etiquetas: sugerencias al escribir para todos; renombrar, borrar y ver uso solo el admin
- [x] Borrar un checklist del historial: solo el admin, con motivo y en Auditoría
- [x] Auditoría: filtro por tipo de evento (el resumen va con los reportes avanzados)
- [x] Reemplazos de guardia: verlos, editarlos y borrarlos
- [x] Exportar contactos a CSV; reordenar turnos; importar eventos del catálogo; borrar fuentes de log
- Decidido: las cuentas de invitado no vuelven.

### Integraciones
- [ ] Wiki: nada por ahora; se retoma cuando exista Kudawiki (decisión del dueño 2026-10-16)
- [ ] Documentación externa (wiki) en la app: buscador, ayuda en pantalla y sugerencias por contexto
- [ ] Orquestador: barra para saltar entre sistemas, como complemento fuera del núcleo

### Backlog
- [ ] GLPI en ambos sentidos (tickets)
- [ ] SSO
- [ ] RACI completo y enlaces públicos avanzados
- [ ] Reportes avanzados y pedidos especiales
- [ ] Carga CSV masiva y logs a SIEM/SOAR

### Corte
- [ ] Ensayo de paridad 2 con un respaldo de producción nuevo
- [ ] Corte: pasar del legacy a 2.0 — Todos
- [ ] Ventana de rollback de 14 días — Equipo SOC

### Deuda menor
- [ ] Tamaño del CSS por componente y versiones que esperan a Angular

## Listo

- [x] Decisiones de arquitectura e infraestructura base (Go, Angular, PostgreSQL, Docker, Caddy)
- [x] Base visual aprobada: temas claro, oscuro y rosa, español/inglés y fuente para dislexia
- [x] Login con los 6 temas del legacy, perfil y verificación en dos pasos
- [x] Setup, módulos SOC/NOC/Ticketera y funcionalidades activables
- [x] Territorio, organizaciones, directorio y equipos
- [x] Bitácora con borradores automáticos
- [x] Turnos y checklist: Mi turno, guardias, dotación y recordatorios
- [x] Escalamiento rediseñado: flujo de llamados, pools e incidentes
- [x] Ticketera ITIL: SLA, padre/hijo, unir, seguimiento público y avisos por correo
- [x] Reportes, avisos por cliente y correos con el formato del legacy
- [x] Respaldos, auditoría y complementos
- [x] ETL legacy → 2.0 y ensayo de paridad 1 con datos de producción
- [x] Áreas, niveles y perfiles: Mi equipo, guardias y escalamiento por área
- [x] Tickets con colas por área (9.1)
- [x] Inventario con historial y carga CSV (9.2)
- [x] Agenda: tareas recurrentes, días hábiles y feriados (9.3)
- [x] Notificaciones: campana, resumen diario y avisos con acuse (9.5)
- [x] Mapa con OpenStreetMap y lugar del ticket (#24, 7b)
- [x] Importación de equipos desde GLPI (9.6)
- [x] Segunda etapa de áreas (9.7): flujos entre áreas, calendario en Outlook, resumen mensual y ventanas que se repiten
- [x] Documentación: instalación, operación, API, modelo de datos y guía de uso
