# Tareas de Bitácora Ops 2.0

Lo hecho, lo que está en revisión y lo que falta hasta el corte. Marca con `[x]` lo que se termina y mueve la línea de sección. El detalle de cada punto está en `spec/12-pendientes.md` y en `docs/history/CHANGELOG.md`.

## Hitos

- [x] Núcleo 2.0 completo (fases 1 a 13)
- [x] Áreas TI, Infra y CSM (9.1 a 9.7 hechas)
- [x] Gestión CSM (9.4, 2026-10-20; falta revisarla en la app)
- [ ] Wiki y orquestador
- [ ] Ensayo de paridad 2
- [ ] Corte a producción y fin del rollback

## En curso

- [ ] Revisar en la app el RACI por cliente (Escalamiento → RACI y Administración → Matriz RACI; antes correr `migrate … up` para la 000049) — Dueño
- [ ] Revisar en la app el Mapa y el lugar del ticket (#24 y 7b) — Dueño
- [ ] Revisar en la app colas por área, Inventario y Agenda (9.1, 9.2, 9.3) — Dueño
- [ ] Revisar en la app las Notificaciones (9.5) — Dueño
- [ ] Probar la importación desde GLPI contra el GLPI real (9.6) — Dueño
- [ ] Probar los tickets de GLPI contra el GLPI real (10d.1): `migrate … up` para la 000050, darle al usuario de solo lectura permiso para ver tickets, grupos y usuarios, marcar tus entidades y grupos en Administración → GLPI y «Sincronizar ahora» — Dueño
- [ ] Revisión humana del shadow-diff del escalamiento — Equipo SOC
- [ ] Revisar en la app la segunda etapa (9.7): flujos, calendario en Outlook, resumen mensual y ventanas que se repiten — Dueño
- [x] Gestión CSM (9.4): el CSM validó el diseño y mandó feedback (2026-10-19); spec ajustado en `16` §4.4 — CSM
- [x] Gestión CSM (9.4): diseño rehecho con el feedback del CSM (2026-10-19)
- [ ] Tema Rosa con efecto 8-bit (construido el 2026-10-19, ver CHANGELOG): revisarlo en la app — Dueño
- [x] Gestión CSM (9.4): la CSM aprobó el diseño rehecho (<https://claude.ai/artifact/MkPD5Eipnsgiy95BPQudob>) — CSM
- [ ] Probar la 10d.2 con el GLPI de pruebas: `migrate … up` para la 000054; un usuario de GLPI con permiso para crear tickets y seguimientos y su User-Token en Administración → GLPI → Escribir en GLPI («Probar»); comentar un GLPI-…, «Crear en GLPI» desde un ticket y desde una entrada, y escribir en GLPI sobre la copia para ver que vuelve — Dueño
- [ ] Revisar en la app el seguimiento de la Bitácora (10j): `migrate … up` para la 000053; filtro «En seguimiento», el contador en la lista y «Cerrar seguimiento» en el detalle — Dueño
- [ ] Probar la 10b (Integraciones): `migrate … up` para la 000052; en Administración → Integraciones crear un destino hacia tu SIEM y «Probar»; crear una llave y probarla con el `curl` que muestra (manual: `docs/api-integraciones.md`) — Dueño
- [ ] Probar los enlaces públicos (10h): `migrate … up` para la 000059; en Administración → Enlaces públicos crear uno de cada tipo y abrirlo en otra pestaña o en la TV. El de teletrabajo ya no está en Turnos: créalo de nuevo aquí y cambia el de la TV — Dueño
- [ ] Probar las cargas por CSV (10g): «Cargar CSV» en Usuarios y grupos, Organizaciones, Ventanas de mantenimiento y la Bitácora (solo admin). Bajar la plantilla, subirla y revisar antes de «Cargar»; los usuarios nuevos muestran su contraseña temporal una sola vez — Dueño
- [ ] Revisar en la app los Departamentos: `migrate … up` para la 000060; en Administración → Departamentos y áreas crear CDC, agregarle SOC y NOC (arrastrándolas), ponerle jefe y marcar que comparten equipo; marcar a alguien como CSM en Usuarios y grupos y asignarla en la pestaña CSM del departamento; en Mi equipo elegir «Departamento CDC» — Dueño
- [ ] Revisar en la app guardias del departamento, ubicación y grupos de equipos (2026-10-23): `migrate … up` para la 000061; en Mi equipo → «Departamento CDC» → Guardias, elegir SOC o NOC; en el Inventario crear un grupo en Grupos (pegar coordenadas de Google Maps), elegirlo en dos equipos, editar el grupo y ver que se mueven; en el Mapa, la capa Equipos y «Ver en el mapa» desde la ficha; ponerle cliente a un grupo, elegir ese cliente en el Mapa y abrir un ticket o una entrada de incidente sobre uno de sus equipos para verlo en rojo con su tarjetita — Dueño
- [ ] Revisar en la app la Gestión CSM (9.4, con las notas internas): antes correr `migrate … up` hasta la 000057; ponerle a cada cliente su CSM, inicio del servicio y renovación (Gestión → ficha → Datos de la cuenta) — Dueño y CSM
- [ ] Revisar en la app las certificaciones validadas por la CSM: `migrate … up` para la 000062; crear una meta de certificación para una persona («Pedir la validación de la CSM»), marcar sus hitos y ver el aviso en la campana de la CSM; con la CSM, «Validar certificación» — Dueño y CSM
- [ ] Probar la 10i (complementos que agregan funciones): la 000063 ya está aplicada en desarrollo (también la 000062). En Administración → Complementos → «Subir ZIP» sube `docs/complementos/informe-incidentes.zip`, publícalo y en «Qué agrega» aprueba la página y sus tres permisos de datos; en Reportes aparece la pestaña «Incidentes por cliente» (prueba «Descargar PDF» y los tres temas). Para un servicio, sigue `docs/complementos.md` §3 con `docs/complementos/servicio-ejemplo` — Dueño
- [ ] Revisar en la app la Gestión sin la Ticketera: apagarla en Administración → Módulos, abrir Gestión (Clientes, ficha, Indicadores y Exportar resumen) y ver que carga sin columnas ni cifras de tickets; encenderla de nuevo y ver que vuelven — Dueño

## Por hacer

### Áreas
- [x] Decidir las 7 preguntas de la Gestión CSM (`16` §4.4.10): quedaron las propuestas (2026-10-20) — Dueño
- [x] Tarea «avisar al cliente» de una ventana de mantenimiento (9.4, 2026-10-20)
- [x] Comunicaciones internas del CSM: notas por cliente, aprobadas y construidas (2026-10-21; `migrate … up` para la 000056)
- [x] Metas: el admin elige entre todos los usuarios, «Alguien sin cuenta» con nombre y correo que pasa a la cuenta al crearla, y «Sin área» en Usuarios (2026-10-21; `migrate … up` para la 000057)
- [x] Desactivar y eliminar usuarios: al desactivar sale de guardias y escalamiento con aviso previo de lo que tiene a su nombre; eliminar borra solo a quien no tiene historial (2026-10-21)
- [x] Metas por persona: agrupadas por persona, escalones primaria/secundaria/terciaria, regla por persona, lograda o no lograda (diseño aprobado y construido 2026-10-21; `migrate … up` para la 000058)
- [x] Gestión CSM: aviso antes del vencimiento de una meta y metas cumplidas por persona en el Resumen mensual (2026-10-21; `migrate … up` para la 000055)
- [x] La Gestión funciona sin la Ticketera: clientes, acciones, metas e indicadores de tareas, sin nada de tickets (2026-10-23)

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
- [ ] Orquestador: barra para saltar entre sistemas, como complemento sobre la 10i (proyecto aparte); antes, decidir entrar sin login y dónde vive (`spec/11` §12.4)

### Áreas y departamentos
- [x] Departamentos (agrupar áreas, jefatura del departamento, áreas que comparten equipo, qué ve cada CSM): construido el 2026-10-22
- [x] Guardias configurables desde el departamento (Mi equipo): construido el 2026-10-23
- [x] Inventario: dirección y coordenadas en el equipo, capa Equipos en el Mapa y grupos de equipos (rack o sala) con la ubicación compartida: construido el 2026-10-23
- [x] Mapa: equipos de clientes en verde/rojo/ámbar según tickets, incidentes y Bitácora, con filtro por cliente y tarjetita al pasar el mouse: construido el 2026-10-23

### Backlog (después del corte, decisión del dueño 2026-10-26)
- [x] 10a RACI por cliente (hecho el 2026-10-20; ver «En curso»)
- [x] 10b Reenvío de eventos a un SIEM y API de integraciones (2026-10-21; ver «En curso»)
- [ ] 10c SSO con Microsoft 365 — un admin del tenant registra la app en Entra ID
- [x] 10d.1 Tickets de GLPI en la Ticketera, solo para mirar (2026-10-20; ver «En curso»)
- [x] 10d.2 De la app a GLPI: comentar los GLPI-… y «Crear en GLPI» (2026-10-21; ver «En curso»)
- Decidido: 10e Pedidos especiales no se hace; ya lo cubren la Solicitud de la Ticketera y las acciones de Gestión (dueño, 2026-10-23)
- [ ] 10f Reportes avanzados — el puntaje de calidad por analista está hecho y revisado (2026-10-23); faltan estadísticas, boletines avanzados y PDF real
- [x] 10g Carga CSV masiva: usuarios, organizaciones con servicios, ventanas de mantenimiento y entradas históricas (2026-10-22; ver «En curso»)
- [x] 10h Enlaces públicos: guardias, Ticketera y Mapa en TV y estado para un cliente (2026-10-22; ver «En curso»)
- [ ] 10k Entrar con la cuenta del dominio (LDAP / AD), construido el 2026-10-26 (`spec/20-ldap.md`): probarlo contra el AD real — `migrate … up` para la 000064; Funcionalidades → «Entrar con la cuenta del dominio»; Administración → LDAP (servidor `ldaps://`, cuenta de servicio de solo lectura, base DN) y «Probar» con un usuario; revisar que haya un admin «Solo local» en Usuarios y grupos; entrar con una cuenta creada antes (ver que queda vinculada y conserva sus áreas) y con una que no existía (llega el aviso y queda sin áreas) — Dueño
- [x] 10i Complementos que agregan funciones (como los plugins de GLPI: informes, integraciones) sin tocar el núcleo (2026-10-26; ver «En curso»)
- [x] 10j Seguimiento de entradas de la Bitácora (2026-10-21; ver «En curso»). «Seguir» con aviso en la campana queda para después

### Corte
- [ ] Ensayo de paridad 2 con un respaldo de producción nuevo
- [ ] Corte: pasar del legacy a 2.0 — Todos
- [ ] Justo después del corte, a mano en producción: ubicar en su área y nivel a los «Sin área» y a quien no es de SOC (Administración → Usuarios y grupos → Áreas y nivel). El ETL deja a los usuarios del legacy en SOC y a los admin sin área; kmateluna va a CSM — Dueño
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
- [x] RACI por cliente como el legacy, con las notas que el ETL perdía (2026-10-20)
- [x] Tickets de GLPI en la Ticketera, solo para mirar (10d.1, 2026-10-20)
- [x] Reenvío de eventos a un SIEM y API de integraciones (10b, 2026-10-21)
- [x] Seguimiento de entradas de la Bitácora (10j, 2026-10-21)
- [x] De la app a GLPI: comentar y crear en GLPI (10d.2, 2026-10-21)
- [x] Cargas por CSV de usuarios, organizaciones, ventanas y entradas históricas (10g, 2026-10-22)
- [x] Enlaces públicos: guardias, Ticketera y Mapa en TV y estado para un cliente (10h, 2026-10-22)
- [x] Puntaje de calidad por analista en Mi equipo, revisado por el dueño (10f, 2026-10-23)
