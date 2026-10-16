# Tareas de Bitácora Ops 2.0

Lo hecho, lo que está en revisión y lo que falta hasta el corte. Marca con `[x]` lo que se termina y mueve la línea de sección. El detalle de cada punto está en `spec/12-pendientes.md` y en `docs/history/CHANGELOG.md`.

## Hitos

- [x] Núcleo 2.0 completo (fases 1 a 13)
- [ ] Áreas TI, Infra y CSM (9.1 a 9.7 hechas; falta la Gestión CSM)
- [ ] Gestión CSM y segunda etapa de áreas
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
- [ ] Gestión CSM (9.4): en pausa mientras el CSM valida si le sirve — CSM

## Por hacer

### Áreas
- [ ] Decidir las 6 preguntas de la Gestión CSM — Dueño
- [ ] Comunicaciones internas del CSM y la tarea «avisar al cliente» (espera a la 9.4)

### Integraciones
- [ ] Wiki: responder sus 2 preguntas abiertas — Dueño
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
