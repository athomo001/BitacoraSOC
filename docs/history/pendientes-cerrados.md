# Pendientes cerrados

Lo que salió de `spec/12-pendientes.md` porque ya está hecho o decidido. El detalle de cada cambio está en [CHANGELOG](CHANGELOG.md).

## Hecho (al 2026-10-07)

| Área | Estado |
| --- | --- |
| Núcleo (shell, 3 temas, ES/EN completo, OpenDyslexic), Ticketera, Respaldos, Turnos/Mi turno/Historial/Dotación, Administración, Reportes, Escalamiento (canvas v26), Directorio | Hecho y verificado (E2E con Postgres) |
| ETL legacy → 2.0 (`cmd/legacy-etl`, spec/13) | Hecho; ensayo de paridad 1 el 2026-10-06 (29.482 registros, 6 de 7 verificaciones) |
| Complementos (Fase 13b) | Hechos (2026-09-30) |
| Auditoría: escrituras (test de cobertura) + lecturas sensibles (contactos de escalamiento, Directorio) | Hecho (lecturas: 2026-10-07) |
| Setup inicial con "solo Ticketera" | Hecho (2026-10-07) |
| Evidencia del escalamiento en la bitácora (HU-1t punto 2) | Hecho (2026-10-07) |
| Eventos del informe (catalogEvents) migrados y sugeridos en Reportes | Hecho (2026-10-07) |
| Bundle inicial 381,9 kB (textos por pantalla); CSS del login 14 kB (temas aparte) | Hecho (2026-10-07) |
| Equipos: llamados dentro de la política, acciones en lote y borrado (migración 000030) | Hecho (2026-10-07) |

## Ensayo de paridad 1 (2026-10-06)

Checklist de paridad (`02` §2), respaldo en `respaldos/ensayo-2026-10-06/` (fuera de git). Lo que pasó:

1. Auth de punta a punta — ✅ el dueño entró con su contraseña del legacy en la 2.0 restaurada.
2. Shadow-diff del escalamiento — ✅ 4 de 4 clientes sin diferencias (falta la revisión humana: sigue en pendientes).
3. Calendario de guardia — ✅ con deltas explicados; el de "varias personas a la vez en un rol" quedó corregido el 2026-10-07 (se muestran todas).
4. Respaldo → restauración — ✅ 44 tablas idénticas.
5. Conteos de auditoría — ✅ 21.786 = 21.786.
6. Rendimiento con volumen real — ✅ 16–116 ms de mediana.

## Decisiones tomadas el 2026-10-07 (el dueño pidió cerrar todo)

| Tema | Decisión |
| --- | --- |
| Auditar lecturas sensibles | **Sí**, como el legacy y con sus mismos nombres: `escalation.view.contacts.read`, `directory.central.list.view` (sin guardar lo buscado) y `directory.central.detail.view`. Los reportes por usuario del legacy no existen en la 2.0. |
| `catalogEvents` (1.863) | **Se migran** a `report_events` (000027): "Nombre del evento" sugiere y rellena "Motivo", como el legacy. |
| Formato del reporte NOC | **El del legacy** (incidente): la regla es no diseñar correos nuevos y el legacy no tiene uno de NOC. |
| Setup "solo Ticketera" | **Sí**: tercera opción del asistente (`ticketsEnabled`). |
| `GET /api/audit-logs/events` | **Fuera de `04`**: nunca existió y Auditoría usa categorías fijas. |
| `tickets:assign` | **No se implementa**: hoy cualquier analista con Ticketera toma y asigna (comentario #13); un permiso nuevo se lo quitaría. |
| Mínimo de contraseña | Configurable por el admin, **6 por defecto** (000025). |

## Comentarios del desarrollador cerrados

1 ✅ (2026-10-02) el login  úede ser con user o correo, ademas el user puede ver la contraseña en todos sus login (asi ve si no se equivoco).
2 ✅ (2026-10-02) hay una falla de seguridad cuanod el token de sesion es invalido, puedo ver la aplicacion completa como que se guarda en cache  o nose pero puedo verla completa , sin datos pero puedo acceder
3 ✅ (2026-10-02) la activacion del modulo de tiketera  la quiero en /admin  modulos , asi no anda repartido  por todos lados
4 ✅ (2026-10-02; Equipos queda porque la escalación SOC también lo usa, sin los tipos NOC) tengo desativado  el noc  y aparece   el menu de equipos y lo mismo que soc  si  desactivo el soc  no deberia ver nada relacionado con soc a menos que exitan opciones que se usan en todo  ocn la tiketera debe funcionar igual, y eso debe ser automatico no esperar a que el user haga f5
5 ✅ (2026-10-02: era el caché, ahora en vivo) si activo NOC  no aparecen todas las config para noc
6 ✅ (2026-10-03, popup de Inicio y Cierre de turno) en /shifts  agregar el comentario de final de turno como popup bien bonito  , revisa le legasy   aca podriamso reutilizar el checklist  onda  un popup  por que asi como esta no me gusta  , ademas etsa bloqueaod   no puedo hacre  el texto de cierre
6.1 ✅ (2026-10-03) no hay cajon de texto para inicio de turno tomate del punto anterior para crear el popup  bien  , asi el user no tiene que bajatr al final para  escribir
7 ✅ (2026-10-02: idem 5) en  /entries  tengo activado el noc y no aparecen sus cosas
8 ✅ (2026-10-05, Administración → Marca) falta lo de branding, eso estaba en el legasy
9 ✅ (2026-10-03, botón Formato) tutorial para markdown onda el user  podra apretar un botoncito  en  /entri  y vera un popup  con detalles de markdown y como escribor asi en facil
10 ✅ (2026-10-05, menú Reportes Alt+8 + Administración → Avisos por cliente) falta el menu de reportes , que esta en legasy en /main/reports,  igual siempre se podria mejorar eso  porsiacaso, este menu lo hacen directamente los analistas porsiacaso ellos usan eso para los correos y esta enlazado con varias cosas de admin  segun el legasy   revisa y adecua al caso
11 ✅ (2026-10-05: con el rediseño del 17) el escalamiento lo tomo super mal y no se ve bien o no funciona bien pero no hay datos en escalamiento pero en admin si
12 ✅ (2026-10-02: editar/eliminar, tipos configurables con Mandante y "a través de") en aorganizaciones no puedo borrar ongs y  adems  todos las ong son mis clientes  para evitar drama son clientes  (gente que yo contrate) y mandantes (contratos que tengo con clientes mios) y tener la posibilidad de crear nuevos/modificar/borrar(para eso migracion a otro tipo antes si tengo clientes con ese tipo) si quiero, ademas de poder modificra las organizaciones que ya tengo (eso ahora no se puede)
13 ✅ (2026-10-02) la creacion de tiket esta mala equipo resolutor salen datos nada que ver  como ddp 2 llamado  nada que ver eso , ademas  que nos ea obligatorio agregar ese dato  se puede llenar despues, ademas esta el tema de tomar el tiket  y ahi se podria cargar altiro  el resolutor  , pero igual se podria modificar o agregar mas resolutore sa futuro
14 ✅ (2026-10-03, hasta 10 imágenes por comentario) aca es tiketer si que deberi apoder subir imagenes varias
15 ✅ (2026-10-02) en los tiket esta el cancelar pero eso seria  com tiket malo no valido pero lo toma como terminado , esta mal , cancelar es que el tiket esta malo y se borra toda existencia del tiket (solo lo hace el admin),  el resuelto  y el cerrado
16 ✅ (2026-10-02) las ventanas de manteniemiento las puede tambien crear el analista porsiacaso
17 ✅ (2026-10-05) la pantalla de escalamiento falta mejorarla  hay cosas que no se pueden hacer por decir ahora no puedo crear nuevos escaliemtos de nada y se quedoi con lo del respaldo  del legasy  y lo peor es que se restauro horrible
   ✅ 2026-10-05 construido según el canvas v26 (artboard "Escalamiento: flujo de llamados y vista compacta"):
   - Pantalla: servicio y cliente destacados; barra de incidentes; flujo de llamados con flechas animadas (legacy escalation-flow-preview); Recordatorio; contactos del nivel elegido en filas compactas; el flujo avanza solo al marcar No contesta (pool: siguiente contacto); "Saltar a este nivel"; historial forense del incidente con "Comentar". Sale "Aviso por correo".
   - **Pools** (decisión del dueño): grupo con nombre de personas de una empresa/área (TI-Mundo, Redes-Mundo, Ciber-Mundo; una empresa puede tener varios), configurado en Administración → Escalamiento, que se agrega a cualquier nivel como un solo integrante; se llama en orden, si uno no contesta el siguiente. Tabla `escalation_pools` + `escalation_pool_members` (orden) y `team_members.pool_id`.
   - **Incidentes**: registro real (`escalation_incidents`: título, servicio/política, GLPI # o ticket interno, abierto/cerrado), intentos (`escalation_action_logs.incident_id`) y comentarios por incidente.
   - **Recordatorio**: `escalation_policies.reminder`; ETL desde `catalogLogSources.escalationLegend` (DPP, JUNJI, PJUD, AFPmodelo).
   - ETL: los pasos `pool` del legacy ("POOL de Mundo", "Pool Netics", "Pool llamados", "Aviso a N2") pasan a pools con nombre.
18 ✅ (2026-10-06, spec/14-modelo-er-legacy-2.0.md; de paso se encontraron y corrigieron 2 huecos del ETL: historial de checklists y personas del turno) necesito el modelo entidad  relacion entre legasy y 2.0
19 ✅ (2026-10-02) en modulos van NOC, SOC y Tiketera

20 ✅ (2026-10-05: la entrada queda con un comentario de sistema del ticket eliminado) "15 Cancelar ticket: ya no es un estado. Un ticket mal creado lo elimina un admin: se borra entero, con comentarios y tareas. El botón "Cancelar ticket" desapareció y un analista no puede eliminar."  cuanod borro un tiket se borra todo menos el comentario en bitacora ese se borra a parte   ese solo queda en el historico del sistema

21 ✅ (2026-10-06: hámsters kawaii radiactivos del dueño en el correo del legacy; envío diario portado) el correo de cunmpleaños el raton tiene 3 brazos  sigams esa idea de que sea amorfo pero ahora que sea aun mas kawai pero radiactivo  como el cap de mr bruns cuanod era radiotivi y solo queria dar amor
