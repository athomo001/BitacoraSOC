<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

### ⏳ Pendientes

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| INFRA-MONGO-001 | Pendiente | Infraestructura / Datos CRÍTICA | Upgrade MongoDB (7 → 8) | El motor base de `mongo:7` en el docker-compose termina su soporte LTS oficial en Agosto de 2026. Se debe planificar un salto a `mongo:8`. Dado que los archivos de base de datos `.wt` no siempre son retrocompatibles entre versiones mayores, el protocolo a documentar e investigar requerirá: 1) `mongodump` completo; 2) Borrar el contenedor y limpiar el volumen físico `.data/mongodb_data`; 3) Levantar el nuevo `mongo:8` vacío; 4) Inyectar los datos de vuelta con `mongorestore`. |
| B19 | Pendiente | Integraciones | Creación de tickets en GLPI (Correo / API) | Definir flujo final (resumen diario vs evento inmediato), destino y estrategia de reintentos. |
| AI-SUMMARY-001 | Pendiente | IA/Operación ALTA | Módulo de Resumen Ejecutivo Efímero (IA On-Demand) | Integrar Ollama+llama3.2:3b en modo efímero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`, salida editable en campo "Resumen Sugerido por IA" y botón "Generar con IA". |
| DEP-NPM-012 | Pendiente | Deuda Técnica / Backend MEDIA | Dependencias npm deprecadas en build Docker (`glob`/`inflight`) | Durante `npm install --omit=dev` en backend aparecen warnings por paquetes deprecados (`glob@7.2.3`, `glob@10.5.0`, `inflight@1.0.6`). Se requiere trazar árbol de dependencias, actualizar paquetes raíz y regenerar lockfile para eliminar dependencias sin soporte y riesgo de seguridad/memoria. |
| FE-SASS-013 | Pendiente | Deuda Técnica / Frontend MEDIA | Migrar `@import` Sass a `@use/@forward` en login | Build Angular reporta deprecación en `src/app/pages/login/login.component.scss` por `@import 'login-infoflow';`. Sass eliminará `@import` en Dart Sass 3.0.0; se debe migrar a módulos `@use/@forward` para compatibilidad futura. |
| AUDIT-014 | Pendiente | Auditoría / Backend+Frontend ALTA | Login exitoso no muestra actor real en Auditoría | Hallazgo operativo: al autenticarse un usuario, el registro aparece como `Sistema` en columna Actor y sin contexto suficiente del usuario autenticado. Se debe corregir la atribución para que `auth.login.success` persista/renderice `actorId/username` reales (sin exponer secretos) y permita trazabilidad forense confiable. |
| MAIL-AUDIT-015 | Pendiente | Email / Observabilidad ALTA | Error `❌ [CORREO] Para: sin destinatarios` sin contexto diagnóstico | Hallazgo operativo: en auditoría se observan múltiples WARN/ERROR de correo con texto genérico `Para: sin destinatarios`, sin identificar origen exacto (módulo, turno/checklist, trigger, destinatarios calculados, config SMTP). Se requiere enriquecer metadata y razón visible para identificar por qué falla y desde qué flujo se dispara. |
| BACKUP-AUTO-016 | Pendiente | Backup / Operación ALTA | Backup automático no se ejecuta según intervalo configurado | Hallazgo operativo: con backups automáticos habilitados (`cada 7 días`) no aparecen ejecuciones automáticas en historial aun habiendo transcurrido más de 9 días; solo se observan backups manuales. Se debe validar scheduler, persistencia de última ejecución y timezone/frecuencia real del job. |
| BACKUP-RET-017 | Pendiente | Backup / Operación ALTA | Retención de backups no elimina archivos al superar 7 días | Hallazgo operativo: se configuró retención local en `7 días`, pero permanecen backups antiguos sin depuración automática. Se debe validar criterio de antigüedad, origen de fecha usada para purge, ejecución efectiva de cleanup y trazabilidad de eliminaciones/skips. |
| B34 | Pendiente | Operación/Alertas | Alerta por ítems NOK (Rojo) en Checklist | Añadir switch en config global para activar/desactivar alerta por ítems en rojo. Agregar selector de cargo (ej. N2) a notificar. Al guardar el checklist, si el analista marca ítems NOK (rojo), enviar email automático a todos los usuarios del cargo seleccionado incluyendo el detalle/observación ingresada por el analista. |
| SEC-HIGH-009 | Pendiente | Seguridad ALTA | Riesgo de Regex Injection / ReDoS en búsquedas de catálogo y tags (NoSQL) | Hallazgo QA: existen regex construidas directo desde input sin escape (`new RegExp(search, 'i')`, `new RegExp('^' + q, 'i')`, `$regex` con `topic` sin escapar) en rutas autenticadas/admin. Un patrón malicioso puede disparar backtracking costoso y degradar el backend (DoS lógico). Archivos detectados: `backend/src/routes/admin-catalog.js`, `backend/src/routes/tags.js`, `backend/src/routes/entries.js`, `backend/src/controllers/escalationController.js`. |
| SEC-HIGH-010 | Pendiente | Seguridad ALTA | OWASP A10 SSRF: URLs salientes configurables sin allowlist en integraciones | Hallazgo QA: endpoints de integración permiten destinos salientes controlados por configuración (`GLPI api.baseUrl` y `logging http.url`) sin validación estricta de red interna/loopback/protocolos. Riesgo: Server-Side Request Forgery desde backend hacia servicios internos/metadatos si una cuenta admin se compromete. Archivos detectados: `backend/src/routes/glpi.js`, `backend/src/routes/logging.js`, `backend/src/utils/logForwarder.js`. |
| SEC-MED-011 | Pendiente | Seguridad MEDIA | OWASP A09/A02: Logging sensible en autenticación (username + estado de password) | Hallazgo QA: en login se registran por consola datos sensibles de autenticación (`LOGIN REQUEST`, `Usuario encontrado`, `Password match`) sin condicionamiento por entorno. Riesgo: exposición de telemetría de credenciales/intentos en logs operativos. Archivo detectado: `backend/src/routes/auth.js`. |
| COMP-001 | Pendiente | Arquitectura / Complementos ALTA | Persistencia Aislada, Wipe Out y Auditoría Forense | Cada complemento usa su propia DB (`bitacora_ext_*`). Al ejecutar `DELETE_COMPLEMENTO`, el orquestador dispara un Wipe Out de 4 fases (hook → dropDB → purge general → delete modelo) con trail forense completo en AuditLog. |
| COMP-002 | Pendiente | API / Complementos ALTA | Contrato de API Interna (Microservicio-Bitácora) | Gateway seguro en `/api/internal/v1/*` con Application Token (no JWT de usuario), scopes granulares (`READ_LOGS`, `WRITE_STORAGE`, etc.) y colecciones autorizadas explícitamente por Admin. |
| COMP-003 | Pendiente | UI / Complementos ALTA | Slot Dinámico en UI (N1 y Admin) | Iframe con `sandbox` restrictivo + `postMessage` con validación de origin. Consola Admin para gestión de Alta/Baja/Permisos. Circuit Breaker visual si el complemento falla. |
| COMP-004 | Pendiente | Resiliencia / Complementos ALTA | Circuit Breaker para Microservicios | Si un complemento tarda >3s o devuelve 5xx, el Core lo aísla visualmente mostrando badge "Mantenimiento" sin afectar el resto de la aplicación. Estados: CLOSED → OPEN → HALF-OPEN. |
| COMP-005 | Pendiente | Seguridad / Complementos ALTA | Application Token y Scopes Granulares | Sistema de tokens de aplicación independiente del JWT de usuario, firmado con `COMPLEMENT_TOKEN_SECRET`, con scopes verificados por middleware y revocación inmediata al eliminar complemento. |
| COMP-006 | Pendiente | Arquitectura / Contratos ALTA | Shared Types & Contracts (Esquema JSON Compartido) | Actualmente Backend (Mongoose/JS) y Frontend (12 `.model.ts`) no comparten contratos. Sin un paquete o esquema común, los microservicios de complementos duplicarán tipos y romperán ante cambios del Core. |
| COMP-007 | Pendiente | Frontend / Estado ALTA | Bus de Eventos para State Sync (Core ↔ Iframe) | Si el N1 cambia de turno/cliente en la Bitácora, el iframe del complemento no se entera. Se necesita un bus de eventos bidireccional vía `postMessage` con protocolo tipado y validación de origin. |
| COMP-008 | Pendiente | DevOps / Infraestructura ALTA | Orquestación Docker y Redes Aisladas | El `docker-compose.yml` actual tiene una sola red (`bitacora-network`). Los microservicios necesitan red aislada (`bitacora-complements`) con acceso exclusivo al backend. |
| COMP-009 | Pendiente | Observabilidad / Complementos ALTA | Logging Centralizado de Microservicios | Los logs de un complemento quedan en su propio contenedor y no son visibles desde la Bitácora. Se necesita un colector centralizado y una vista en la UI Admin para diagnosticar fallos. |
| COMP-010 | Pendiente | API / Versionamiento MEDIA | Versionamiento de API Interna (Compatibilidad) | Si se actualiza el Core pero un complemento sigue en v1, debe seguir funcionando. Se necesita control de versiones en la API Interna (`/api/internal/v1/`, `/v2/`) con deprecation headers. |
| COMP-011 | Pendiente | Testing / Complementos MEDIA | Mocks de Complementos para Pruebas de Integración | Crear un microservicio mock (`complement-stub`) que simule todas las interacciones de un complemento real para testing del Core sin depender de microservicios reales. |

### ✅ Listas

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| INFRA-NODE-ALL | Listo | Infraestructura / Seguridad CRÍTICA | Upgrade Completo y Pruebas a Node 24 LTS | Se migraron las imágenes Docker a `node:24-alpine`. Mongoose 8 y Bcrypt compilaron sus bindings nativos exitosamente bajo el nuevo musl libc. Webpack de Angular funcionó perfecto. Levantamiento de contenedores estable. |
| B-CRÍTICO-001 | Listo | Bugs CRÍTICO | Emails no llegan en cierre checklist | Corregido y validado. |
| SEC-CRIT-001 | Listo | Seguridad CRÍTICA | Exposición de credenciales SMTP en `/api/config` | Respuesta sanitizada y endpoints sensibles restringidos. |
| SEC-CRIT-002 | Listo | Seguridad CRÍTICA | Recuperación de contraseña vulnerable | Link seguro y sin fuga de token en respuesta. |
| SEC-CRIT-003 | Listo | Seguridad CRÍTICA | Refresh indefinido de JWT expirados | Corregido. |
| SEC-CRIT-004 | Listo | Seguridad CRÍTICA | RBAC incompleto para `guest` | Endpoints críticos endurecidos. |
| SEC-CRIT-005 | Listo | Seguridad CRÍTICA | Anti brute-force login | Rate-limits aplicados en auth. |
| SEC-HIGH-006 | Listo | Seguridad ALTA | Credenciales por defecto débiles | Eliminadas del flujo principal. |
| SEC-HIGH-007 | Listo | Seguridad ALTA | Riesgo de robo JWT por XSS | Sesión en cookie `HttpOnly` y ajuste de flujo auth. |
| SEC-HIGH-008 | Listo | Seguridad ALTA | Path Traversal en backups | Validación estricta de filename/ruta. |
| B5 | Listo | Bugs CRÍTICO | Acceso a rutas sin autenticación | Rutas críticas protegidas. |
| B6 | Listo | UI/UX | Dark mode contraste | Refactor con tokens y mejoras de legibilidad. |
| B8 | Listo | Mejoras | Edición admin de entradas | Implementado con whitelist + auditoría. |
| B9 | Listo | Mejoras | Checklist por tipo/turno | Implementado en backend + UI. |
| B10 | Listo | Mejoras | Branding favicon configurable | Implementado con endpoints y UI. |
| B11 | Listo | Mejoras | Auditoría de correo y acciones | Eventos y filtros ampliados. |
| B12 | Listo | Mejoras | Huevo de pascua login | Implementado. |
| B13 | Listo | Mejoras | Huevo de pascua por hashtag | Implementado. |
| B15 | Listo | Bugs | Compatibilidad visual correo HTML | Ajustado para clientes dark/light. |
| B16 | Listo | Seguridad/Arquitectura | Auditoría avanzada | Implementado según alcance actual. |
| B18 | Listo | Integraciones | Módulo general de integraciones | Implementado en consola admin. |
| B21 | Listo | Backup/Operación | Backups automáticos + retención | Implementado. |
| B25 | Listo | UI/UX + Operación | Log Sources/Clientes activos vs inactivos | Implementado. |
| B27 | Listo | UI/UX + Arquitectura | Consola Admin unificada | Implementado. |
| B30 | Listo | UI/UX Escalación | `/main/admin/escalation` compacta por meses | Mes actual visible, mes anterior en acordeón e histórico on-demand con filtro backend (`fromDate/toDate/limit`). |
| B31 | Listo | Arquitectura/Datos Escalación | Fuente única de clientes con `CatalogLogSource` | Escalación unificada a Log Sources habilitados + cascada de limpieza al borrar log source + script de migración. |
| B32 | Listo | Usuarios/Notificaciones | Campo `cargo` en CRUD de usuarios (base + custom) | Backend/frontend end-to-end con validación, persistencia, edición y columna de cargo en listado. Cargos base: N1, N2, N3, QA Nivel 1/2, Pentester N1/N2, Arquitecto SIEM, CSM, Jefe Área, Gerente Área. |
| B33 | Listo | Operación/Alertas | Recordatorio simple de escalación interna por cargo | Configuración desde Escalación Interna para seleccionar cargos (ej. N2/N3) y envío diario simple a usuarios activos con esos cargos. |
| P1 | Listo | Angular 20 | Plan general actualización | Completo. |
| B29 | Listo | Turnos/Operación | Módulo de Asignación Operativa (usuario ↔ turno) debajo de tabla de turnos | UI implementada. |
| OPS-ASSIGN-001 | Listo | Frontend/Integración ALTA | Selector de usuarios no funcional en Admin Turnos | Integrado con API. |
| OPS-ASSIGN-002 | Listo | Backend/API ALTA | No existe API dedicada | Creado CRUD `work-shifts/assignments`. |
| OPS-ASSIGN-003 | Listo | Modelo de Datos ALTA | Modelo sin recurrencia por días | Creada colección `WorkShiftAssignment`. |
| OPS-ASSIGN-004 | Listo | Lógica Operativa ALTA | Falta cálculo de estado `EN TURNO / FUERA DE TURNO` | Implementado estado local y remoto. |
| OPS-ASSIGN-005 | Listo | Frontend/Arquitectura MEDIA | Refresco en vivo con observable | Implementado `interval(60000)`. |
| OPS-ASSIGN-006 | Listo | Frontend/Calidad MEDIA | Lógica duplicada de comparación | Creado `shift-time.util.ts`. |
| OPS-ASSIGN-007 | Listo | Backend/Validaciones ALTA | Reglas anti-solapamiento de asignaciones | Validación robustecida en POST/PUT backend. |
| OPS-ASSIGN-008 | Listo | Backend/Timezone ALTA | Ignora timezone del turno | Refactor a `get/current` con `moment-timezone`. |
| OPS-ASSIGN-010 | Listo | UI/UX + Datos MEDIA | Columna "Asignado a" desactualizada | Resumen adaptado en tabla principal. |
| OPS-ASSIGN-011 | Listo | Operación/Turnos ALTA | Asignaciones de turno aparentan perderse después de deploy | Corregida la resolución post-reinicio: el turno actual ahora reconstruye analistas desde `WorkShiftAssignment` según día/horario/vigencia, y la columna `Asignado a` en Admin Turnos deja de depender del campo legacy `assignedUserId` del `WorkShift`. Validación real en DB confirmó que las asignaciones persistían y el problema era de lectura/UI. |
| OPS-ASSIGN-009 | Listo | QA/Pruebas MEDIA | Faltan pruebas completas de integración | Compilación frontend OK y refactor a utilities. |
| B28 | Listo | Infraestructura/Seguridad | Configuración HTTPS simplificada | Wizard fluido y seguro implementado en Angular. |
| SEC-HTTPS-ALL | Listo | Seguridad/Operación CRÍTICA | 19 Vulnerabilidades y Fallos de Arquitectura TLS (001 a 019) | Hot-reloading con SNI, volúmenes de Docker estancos, validaciones criptográficas previas a guardado, CORS estricto y UX de 1 paso logrados con 0-downtime. |
| B37 | Listo | Seguridad / Infra BLOQUEANTE | Error SSL tras reinicio (ERR_SSL_PROTOCOL_ERROR) | Se añadió lógica de auto-recuperación en SNICallback para recargar certificados en caliente si se pierde el contexto tras un reinicio. |
| B38 | Listo | Backend / Bug | Error 400 en `/api/work-shifts/assignments` | Se corrigió el orden de rutas en el servidor y se actualizó el frontend a una ruta más específica para evitar conflicto con el validador de IDs. |
| B39 | Listo | UI/UX + Lógica | Checklist: ocultar estado de item padre con sub-items | Frontend y backend ajustados: el padre ya no pide estado/observación manual, su estado se deriva desde los hijos y la API solo exige observación para nodos hoja en rojo. Validado end-to-end con plantilla temporal padre/hijo y envío real del checklist. |
| B40 | Listo | UI/UX + Bug | Report Generator: búsqueda de ofensas no encuentra nuevas ni coincide por texto | Se cerró el ajuste completo backend+frontend: búsqueda rankeada para términos cortos, refresh del autocomplete sin cache stale y validación viva por API confirmando que `TOR` aparece correctamente como coincidencia principal. |
| B42 | Listo | UI/UX + Bug | Report Generator: imágenes de evidencia pierden nitidez al enviarse por correo | Se mantuvo el layout técnico fijo y se mejoró la nitidez al evitar upscaling de evidencia (usa dimensiones reales de la imagen), preservando proporción y permitiendo abrir la evidencia original al hacer clic. |
| B43 | Listo | Email / UX / Mantenibilidad | Email de turno: refactorizar a MJML y rediseñar como dashboard escaneable | `generateReportHTML` migrado a MJML con compatibilidad robusta para clientes de correo, nuevo header con branding y favicon opcional (`AppConfig.faviconUrl`), resumen ejecutivo (OK/NO OK/Entradas), checklist en tarjetas escaneables, bitácora en bloques jerárquicos y observaciones mostradas solo cuando existen. |
| B44 | Listo | Email / UX | Reporte de turno: mostrar estado "REPARADO" (amarillo) cuando entrada fue ERROR y salida fue OK | Implementado en el correo de turno: `REPARADO` aparece solo en salida cuando entrada fue rojo y salida verde, únicamente si inicio/cierre corresponden a la misma checklist (ID o fallback por nombre). Si salida es rojo, siempre queda `ERROR`. |
| B45 | Listo | Operación/Turnos + Email | Correo de fin de turno debe posponerse hasta checklist de cierre real (si analista se atrasa) | Implementado en backend: el trigger automático de fin de turno ya no envía si no existe checklist de cierre (`PENDIENTE_POR_CIERRE`), el envío se ejecuta al registrar cierre incluso fuera de la hora fin (ventana extendida en trigger manual), y se mantiene control anti-duplicado con `lastReportSentAt` más trazabilidad `ENVIADO_DIFERIDO`/`PENDIENTE_POR_CIERRE`. |
| B35 | Listo | UI/UX + Bug | Ajuste Header Checklist y Fix "Último Check" | H1 cambiado a título fijo "Checklist del Turno"; nombre de plantilla se muestra como subtítulo. Accordion usa el nombre de la plantilla. Backend `GET /check/last` corregido para retornar el último check del equipo (sin filtro por usuario), garantizando que siempre se muestre el registro más reciente real. |
| B36 | Listo | UI/UX | Aprovechamiento de ancho de pantalla | Cajón de notas (right sidebar) cambiado a `mode="over"` (overlay sobre el contenido, sin empujar). Cuando las notas se abren, el contenido recibe `margin-right: 350px` vía clase `.with-notes-open` para evitar solapamiento. El contenido principal usa `transition` suave y ocupa el ancho completo disponible en pantallas grandes. Eliminado `max-width: 900px` del contenedor del Checklist. |
| EE-BAT-001 | Listo | UI/UX + Frontend MEDIA | Easter Egg: Murciélago Pixel-Art (#bat) | Implementar animación pixel-art retro que se active escribiendo `#bat` exacto en el textarea de entradas. Murciélago en estilo box-shadow con aleteo (`@keyframes steps(2)`), movimiento circular por 15s, desaparición con F5. Solo acepta hashtag exacto (#bat, #BAT, #Bat) — rechaza variaciones. Referencia visual: pixel-art con 2 fotogramas. |
---

## Información de como solucionar los Pendientes

### B19 - GLPI (Correo/API)

1. Definir modo operativo final: resumen diario o ticket inmediato.
2. Cerrar contrato técnico de integración (`apirest.php`, tokens, sesión, payload y reintentos).
3. Agregar trazabilidad de entrega/fracaso por cada intento de ticket.

### AI-SUMMARY-001 - Resumen Ejecutivo Efímero (IA On-Demand)

1. Backend: implementar método de orquestación efímera para Ollama:
   - `docker start ollama`
   - healthcheck en `http://localhost:11434`
   - consulta a `/api/generate` con modelo `llama3.2:3b`
   - `docker stop ollama` en bloque `finally` (siempre).
2. Prompt del sistema: forzar estructura de salida con:
   - tabla de tickets
   - incidentes críticos
   - tareas en curso.
3. Payload: incluir todas las entradas de bitácora del turno actual.
4. Frontend:
   - agregar campo de texto editable `Resumen Sugerido por IA`
   - agregar botón `✨ Generar con IA`
   - completar el campo al terminar la respuesta sin bloquear edición manual.
5. Recursos/operación del contenedor:
   - memoria limitada a `--memory="2g"`
   - volumen persistente `-v ollama_data:/root/.ollama`
   - contenedor apagado fuera de uso (superficie mínima y ahorro de RAM).

### INFRA-MONGO-001 - Upgrade MongoDB (7 → 8)

1. **Respaldar Datos:** Crear un script bash temporal que entre al contenedor `mongo:7` actual y ejecute `mongodump` completo hacia `/data/db/dump`. Mover este dump al host.
2. **Destrucción Segura:** Bajar el stack completo (`docker-compose down`). Renombrar o hacer backup físico de la carpeta host `./.data/mongodb_data` por precaución.
3. **Actualización de Imágen:** Modificar `docker-compose.yml` apuntando el tag a `mongo:8`.
4. **Levantamiento y Restauración:** Arrancar el nuevo servicio `mongo:8`. Las bases estarán limpias porque se generará un nuevo volumen o carpeta de datos. Entrar al contenedor y ejecutar `mongorestore` apuntando al dump generado en el paso 1. Validar integridad visual de la Bitácora.
5. **Documentación:** Registrar la ventana de mantenimiento y las versiones finales en `README.md` o documentación operativa.

### BACKUP-AUTO-016 - Backup automático no se ejecuta según intervalo configurado

1. **Reproducir con evidencia:** Confirmar en UI que `Habilitar Backups Automáticos` está activo, intervalo `7`, retención y destino guardados; capturar timestamp de última ejecución real en historial.
2. **Validar persistencia de configuración:** Revisar en DB (colección de configuración) que el flag de backup automático y el intervalo quedaron almacenados correctamente tras `Guardar Configuración`.
3. **Inspeccionar scheduler backend:** Verificar que el job de backup automático se inicializa al arrancar backend y no depende de ruta manual. Confirmar frecuencia efectiva del cron/timer.
4. **Corregir cálculo temporal:** Auditar lógica de próximo disparo (`lastRunAt + intervalDays`) con timezone del sistema para evitar desfases UTC/local que bloqueen ejecución.
5. **Trazabilidad obligatoria:** Registrar en auditoría eventos `BACKUP_AUTO_SCHEDULED`, `BACKUP_AUTO_TRIGGERED`, `BACKUP_AUTO_SKIPPED` y motivo de skip para diagnóstico operativo.
6. **Prueba controlada:** Bajar temporalmente intervalo a 1 día (o modo test en minutos), validar creación automática y luego restaurar 7 días.
7. **Criterio de cierre:** Sin interacción manual, el sistema debe crear backup automático cuando vence el intervalo y mostrarlo en historial con etiqueta de origen `automático`.

### BACKUP-RET-017 - Retención de backups no elimina archivos al superar 7 días

1. **Reproducir con evidencia:** Configurar retención local en `7 días`, listar historial y respaldar evidencia de archivos con antigüedad mayor a 7 días que siguen presentes.
2. **Validar configuración persistida:** Confirmar en DB que `localRetentionDays=7` quedó guardado y que no existe override por defecto en runtime.
3. **Auditar lógica de purge:** Revisar en backend el cálculo de antigüedad (`mtime` vs timestamp embebido en nombre), timezone y comparación límite (`>`, `>=`) para evitar off-by-one.
4. **Ejecutar cleanup forzado en entorno controlado:** Disparar backup automático de prueba y verificar que `cleanupOldLocalBackups(7)` realmente recorra y elimine archivos elegibles.
5. **Agregar trazabilidad operativa:** Registrar en auditoría/logs `BACKUP_RETENTION_CLEANUP_STARTED`, `BACKUP_RETENTION_FILE_DELETED`, `BACKUP_RETENTION_FILE_SKIPPED` y motivo.
6. **Cubrir regresión mínima:** Crear prueba automática de integración/unidad que genere archivos con fechas antiguas y valide su eliminación con retención de 7 días.
7. **Criterio de cierre:** Todo backup con antigüedad mayor a 7 días debe eliminarse automáticamente en el siguiente ciclo de cleanup y reflejarse en trazabilidad.

### DEP-NPM-012 - Dependencias npm deprecadas en build Docker (`glob`/`inflight`)

1. **Trazar el origen real:** Ejecutar en `backend` comandos como `npm ls glob inflight` para identificar qué dependencias raíz introducen cada versión deprecada.
2. **Actualizar dependencias raíz:** Subir versiones de los paquetes de primer nivel que arrastran `glob@7`/`glob@10.5.0` e `inflight@1.0.6`.
3. **Regenerar lockfile limpio:** Borrar `node_modules` + `package-lock.json`, reinstalar (`npm install`) y confirmar que el árbol nuevo elimina los paquetes sin soporte.
4. **Validar build Docker:** Re-ejecutar `docker compose build backend` y verificar que desaparezcan warnings de deprecación relevantes.
5. **Control de regresión:** Correr smoke tests backend (arranque API, rutas críticas y scripts de correo/reportes) para confirmar que los upgrades no rompen compatibilidad.
6. **Evidencia de revisión (2026-03-20):** En `backend/package-lock.json` los únicos deprecados detectados fueron `glob` (7.2.3 y 10.5.0 en subárboles) e `inflight@1.0.6`; en `frontend/package-lock.json` no se detectaron entradas `deprecated`.

### FE-SASS-013 - Migrar `@import` Sass a `@use/@forward` en login

1. **Archivo afectado inicial:** Reemplazar `@import 'login-infoflow';` en `frontend/src/app/pages/login/login.component.scss` por `@use` (o `@forward` según arquitectura de estilos compartidos).
2. **Normalizar módulos Sass:** Si `login-infoflow` exporta variables/mixins, moverlos a formato modular y referenciarlos con namespace para evitar colisiones globales.
3. **Compatibilidad Angular build:** Compilar frontend (`ng build` o build Docker) y confirmar desaparición de warning `Deprecation [plugin angular-sass]`.
4. **Validación visual login:** Revisar que el tema login (incluido infoflow/cyber) conserve estilos exactos tras la migración.
5. **Prevención futura:** Buscar otros `@import` en `frontend/src/**/*.scss` para cerrar la deuda técnica antes de Dart Sass 3.0.0.

### AUDIT-014 - Login exitoso no muestra actor real en Auditoría

1. **Reproducir y capturar evidencia:** Iniciar sesión con usuario real y verificar en `/main/audit-logs` si el evento de login queda con `Actor=Sistema` en vez de usuario autenticado.
2. **Backend (emisión de evento):** Revisar punto exacto donde se registra `auth.login.success` para asegurar que incluya `actorId`, `username` y `requestId` desde contexto autenticado.
3. **Persistencia de metadata:** Validar que el modelo/DAO de `AuditLog` no esté sobrescribiendo actor con fallback `system` cuando sí hay usuario.
4. **Frontend (render):** Ajustar `isSystemAction()` y resolución de columnas `Actor/Username` para priorizar actor humano cuando exista en payload.
5. **Criterio de cierre:** Login exitoso debe mostrar usuario real en la fila y conservar clasificación de autenticación sin exponer credenciales/tokens.

### MAIL-AUDIT-015 - Error `❌ [CORREO] Para: sin destinatarios` sin contexto diagnóstico

1. **Normalizar razón de error:** Cambiar el texto genérico por mensaje estructurado con causa explícita (`destinatarios vacíos por filtro`, `rol sin usuarios activos`, `config SMTP incompleta`, etc.).
2. **Enriquecer metadata de auditoría:** Incluir en evento de correo campos mínimos: `sourceModule`, `triggerType`, `shiftId`, `checklistId`, `entryType`, `resolvedRecipientsCount`, `resolvedRecipientsPreview` (sanitizado) y `smtpConfigId`.
3. **Trazar origen de disparo:** Registrar si proviene de cierre de checklist, scheduler, escalación, PoC o envío manual para evitar confusión cuando solo se esperaba 1 correo.
4. **Frontend (razón visible):** Mejorar `Tipo / Razón / Detalles` para mostrar resumen útil en una línea y detalle expandible con contexto operativo.
5. **Control de ruido:** Aplicar deduplicación/ratelimit de logs repetidos para el mismo fallo en ventana corta (ej. 5-10 min) y mantener contador de repeticiones.
6. **Criterio de cierre:** Ante fallo de correo, auditoría debe permitir responder en menos de 1 minuto: qué intentó enviar, desde dónde, a quién, por qué falló y qué configuración estaba activa.

### B34 - Alerta por ítems NOK (Rojo) en Checklist

1. **Modelo y Base de Datos:**
   - En `AppConfig` (o `ChecklistTemplate` dependiendo de la granularidad requerida), agregar propiedades: `alertNokEnabled: Boolean`, `alertNokRoleTarget: [String]` (array referenciando los roles, ej: `['N2', 'N3']`).
2. **Lógica de Backend (Guardado de Checklist):**
   - Interceptar la ruta `POST/PUT` o el servicio de cierre/guardado del `Checklist`.
   - Después de validar, iterar el array de ítems buscando `status === 'NOK'`.
   - Si existen y la config local `alertNokEnabled` está en true, extraer la lista de `alertNokRoleTarget`.
3. **Motor de Envíos y Usuarios:**
   - Hacer un query de la colección `Users` buscando a las personas que tengan esos cargos activos (`Usuarios.find({ cargo: { $in: alertNokRoleTarget } })`).
   - Construir el cuerpo HTML del correo donde se Listen iterativamente los ítems fallidos incluyendo las propiedades (Texto del check y el "Detalle u Observación" llenado por el analista).
4. **Experiencia de Usuario (Frontend):**
   - En `Global Configuration` o en Configuración de Checklists, agregar el toggle switch "Habilitar alertas NOK".
   - Al lado, un Mat-Select con selección múltiple (checkboxes) que cargue el diccionario de cargos permitidos.
   - Guardar estas variables de vuelta al modelo usando el servicio existente de `ConfigService`.

### SEC-HIGH-009 - Regex Injection / ReDoS en búsquedas (NoSQL)

1. **Corrección de construcción regex (obligatoria):**
   - Nunca construir regex con input crudo. Crear helper común `escapeRegex()` y usarlo en:
   - `backend/src/routes/admin-catalog.js` (campo `search`)
   - `backend/src/routes/tags.js` (endpoint `/suggest`)
   - `backend/src/routes/entries.js` (endpoint `/tags/suggest`)
2. **Límites de entrada y paginación:**
   - Restringir longitud de `search/q` (ej. max 64) y rechazar vacío/whitespace puro.
   - Aplicar `limit` máximo estricto con clamp en todos los listados (`Math.min(..., 50)` o menor según endpoint).
3. **Defensa adicional anti-ReDoS:**
   - Rechazar patrones con metacaracteres no esperados si el caso de uso es búsqueda literal.
   - Mantener búsquedas por prefijo seguro (`^textoEscapado`) para autocomplete.
4. **Pruebas de seguridad QA:**
   - Agregar test de regresión con payloads tipo `(a+)+$`, `(.+)+`, `(?:a|aa)+` verificando respuesta controlada y sin degradación.
5. **Nota de clasificación:**
   - No se encontraron vectores de SQL injection clásico (el proyecto usa MongoDB/Mongoose), pero este hallazgo califica como riesgo de inyección/DoS en capa NoSQL por regex no saneada.

### SEC-HIGH-010 - OWASP A10 SSRF en integraciones salientes

1. **Validación estricta de destino URL:**
   - Restringir `api.baseUrl` (GLPI) y `http.url` (log forwarding) a `https://` por defecto y rechazar esquemas no permitidos.
2. **Bloqueo de redes internas y loopback:**
   - Resolver DNS y bloquear destinos privados/reservados (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, link-local/ULA IPv6).
3. **Allowlist operativa opcional/obligatoria en producción:**
   - Introducir `OUTBOUND_ALLOWLIST` y validar host destino contra dominios/IPs aprobados por seguridad.
4. **Controles de transporte:**
   - Forzar `verifyTls=true` por defecto en GLPI, timeout bajo, y denegar redirecciones automáticas.
5. **Auditoría y alertas:**
   - Registrar cambios de destino (host/URL) y generar evento de seguridad cuando apunten a redes no corporativas.

### SEC-MED-011 - OWASP A09/A02 logging sensible en login

1. **Eliminar logs sensibles de autenticación:**
   - Quitar `console.log` de `username`, `Usuario encontrado` y `Password match` en `auth.js`.
2. **Logging seguro por niveles:**
   - Reemplazar por `logger` estructurado, sin PII/secretos, usando `requestId` y resultado genérico (`success/fail`).
3. **Política por entorno:**
   - Si se requiere diagnóstico en desarrollo, habilitar solo detrás de flag explícito (`AUTH_DEBUG_LOGS=false` por defecto).
4. **Revisión histórica:**
   - Verificar pipelines de logs existentes y limpiar retención de registros que hayan capturado esta telemetría.

### COMP-001 - Persistencia Aislada, Wipe Out y Auditoría Forense

**Descripción técnica:**
Diseñar el esquema de microservicios donde cada complemento posee su propia base de datos (aislamiento total) y el núcleo de la Bitácora gestiona el ciclo de vida de forma independiente, incluyendo un protocolo de Wipe Out (borrado atómico) con trazabilidad forense completa.

**Pasos a seguir:**
1. **Modelo `Complement`**: Crear `backend/src/models/Complement.js` para registrar `slug` (alfanumérico + guion, max 32 chars), `baseUrl`, `dbName` (prefijo obligatorio `bitacora_ext_*`), `permissions`, `status` y `tokenHash`.
2. **Protocolo Wipe Out (4 fases secuenciales)**:
   - **Fase 1 – Notificar Microservicio**: `POST /hook/cleanup` al microservicio con timeout de 5s. Si no responde, continuar igualmente.
   - **Fase 2 – Eliminar DB Privada**: `db.dropDatabase()` sobre la DB del complemento. Solo se ejecuta si `dbName` cumple patrón `bitacora_ext_*`.
   - **Fase 3 – Purgar BD General**: `deleteMany({ownerComplementId: slug})` en todas las colecciones con datos del complemento.
   - **Fase 4 – Limpiar Modelo**: `Complement.deleteOne({slug})` y revocar token activo.
3. **Post-Wipe Verification**: Query `db.listCollections()` para confirmar eliminación total. Si quedan artefactos, registrar como `complement.wipe.orphans_detected`.

**Trail Forense (eventos de auditoría para LOGGING.md):**

| Namespace | Acción | Nivel | Metadata |
|-----------|--------|-------|----------|
| `complement.install` | - | info | `{slug, baseUrl, dbName, scopes}` |
| `complement.update` | `.permissions` / `.config` | info | `{slug, changedFields}` |
| `complement.delete` | `.initiated` / `.completed` | warn | `{slug, adminId, reason}` |
| `complement.wipe` | `.hook_sent` | info | `{slug, hookUrl, responseStatus}` |
| `complement.wipe` | `.hook_timeout` | warn | `{slug, hookUrl, timeoutMs}` |
| `complement.wipe` | `.db_dropped` | warn | `{slug, dbName}` |
| `complement.wipe` | `.general_purged` | warn | `{slug, collectionsAffected, docsRemoved}` |
| `complement.wipe` | `.orphans_detected` | error | `{slug, orphanCollections}` |

**Restricciones de Seguridad:**
- El microservicio **jamás** recibe credenciales de MongoDB General directamente.
- `db.dropDatabase()` solo se ejecuta sobre DBs con prefijo `bitacora_ext_*`. Si el nombre no cumple el patrón, el Wipe Out aborta con error de seguridad.
- Toda operación de borrado se audita con nivel `warn` y datos forenses completos.
- El hook de cleanup al microservicio tiene timeout estricto de 5s; si el microservicio no responde, el Wipe Out continúa (no se bloquea).

**Criterios de Aceptación de Arquitectura:**
1. Modelo `Complement` creado con validación de `slug` (alfanumérico + guion, max 32 chars).
2. `deleteComplement()` ejecuta las 4 fases del Wipe Out en secuencia con rollback parcial si falla la Fase 2.
3. Post-wipe: query de verificación `db.listCollections()` confirma eliminación total.
4. Trail forense: ≥ 4 eventos de auditoría registrados por cada Wipe Out completo.
5. No queda ningún documento con `ownerComplementId` del complemento eliminado en la BD General.

### COMP-002 - Contrato de API Interna (Microservicio-Bitácora)

**Descripción técnica:**
Establecer el protocolo de comunicación para que el microservicio interactúe con el núcleo sin tener acceso directo a la infraestructura de datos. Autenticación exclusiva por Application Token (no JWT de usuario).

**Endpoints Internos (Microservicio → Bitácora):**

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/internal/v1/context` | Contexto turno/analista activo | App Token |
| POST | `/api/internal/v1/log-entry` | Crear entrada operativa vinculada | App Token + `WRITE_ENTRIES` |
| GET | `/api/internal/v1/query-general` | Leer logs con filtros limitados | App Token + `READ_LOGS` |
| POST | `/api/internal/v1/storage` | Escribir en colección "Shared" | App Token + `WRITE_STORAGE` |
| GET | `/api/internal/v1/storage` | Leer datos propios en "Shared" | App Token + `READ_STORAGE` |

**Endpoints Admin (Gestión de Complementos):**

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/complements` | Listar complementos registrados | Admin |
| POST | `/api/complements` | Registrar/instalar complemento | Admin |
| GET | `/api/complements/:slug` | Detalle de un complemento | Admin |
| PUT | `/api/complements/:slug` | Actualizar configuración/permisos | Admin |
| DELETE | `/api/complements/:slug` | Eliminar complemento (Wipe Out) | Admin |
| POST | `/api/complements/:slug/test` | Probar conectividad | Admin |
| GET | `/api/complements/active` | Complementos activos para sidebar | Todos |

**Rate Limiting (por token de complemento):**

| Endpoint | Límite | Ventana |
|----------|--------|---------|
| `/api/internal/v1/*` | 200 requests | 15 min (por token) |
| `/api/complements` (admin) | 50 requests | 15 min |
| `DELETE /api/complements/:slug` | 3 requests | 60 min |

**Restricciones de Seguridad:**
- Autenticación exclusiva por Application Token firmado con `COMPLEMENT_TOKEN_SECRET` (diferente a `JWT_SECRET`).
- Scopes verificados en cada endpoint; acceso denegado fuera de scope con evento `complement.api.denied`.
- Colecciones accesibles listadas explícitamente en el token (`allowedCollections`); no se permite wildcard.
- Rate-limiting por token: 200 req/15min (independiente del rate-limit global de usuario).
- Sanitización de inputs aplicando las mismas reglas que `sanitizeInput.js` existente.
- El endpoint `/context` no expone PII del analista (solo `username`, `shiftId`, `shiftName`).

**Criterios de Aceptación de Arquitectura:**
1. Middleware `complementAuth.js` creado y montado exclusivamente en `/api/internal/v1/*`.
2. Token validado con `COMPLEMENT_TOKEN_SECRET` y verificación de `exp`.
3. Scope check: cada ruta declara `requireScope('READ_LOGS')` y el middleware lo verifica contra el token.
4. Correlation ID (`X-Request-Id`) propagado desde el microservicio al AuditLog.
5. Todo acceso denegado por scope se audita como `complement.api.denied` con metadata del intento.
6. Endpoints documentados en `API.md` bajo sección "API Interna (Complementos)" siguiendo el formato de tablas existente.

### COMP-003 - Slot Dinámico en UI (N1 y Admin)

**Descripción técnica:**
Inyectar el espacio de trabajo del complemento en el frontend de forma segura y no intrusiva. Si el Circuit Breaker detecta fallo, mostrar badge de mantenimiento en lugar del iframe.

**Implementación:**
1. **Frontend N1**: Crear componente `ComplementContainerComponent` con `@Input() complement: Complement`. Cargar `baseUrl` en `<iframe>` con atributos de seguridad.
2. **Sidebar Dinámico**: `MainLayoutComponent` consulta `GET /api/complements/active` y agrega links dinámicos al sidebar siguiendo el patrón visual existente.
3. **PostMessage**: Bus de eventos para pasar context token (short-lived, no JWT de usuario) y contexto (turno/cliente) desde Angular hacia el microservicio. Validación de `origin` contra `complement.baseUrl` registrada.
4. **Consola Admin**: Nueva sección en administración (siguiendo el patrón visual de `Admin > Integraciones SIEM`) para gestionar Alta/Baja/URL/Permisos.
5. **Degradación Grácil**: Si Circuit Breaker está OPEN para un complemento, el contenedor muestra badge `🔧 Complemento en mantenimiento` en lugar del iframe.

**Sandbox de iframe:**
```html
<iframe
  [src]="complement.baseUrl | safe"
  sandbox="allow-scripts allow-same-origin allow-forms"
  referrerpolicy="no-referrer"
  loading="lazy">
</iframe>
```

**Restricciones de Seguridad:**
- iframe con `sandbox` restrictivo: NO `allow-top-navigation`, NO `allow-popups` (previene redirecciones y ventanas maliciosas).
- `postMessage` valida `event.origin` contra `complement.baseUrl` registrada; mensajes de orígenes no registrados se descartan silenciosamente.
- El token enviado al iframe **no** es el JWT del usuario; es un short-lived context token con TTL de 5 minutos.
- El iframe no puede acceder al DOM padre ni a cookies de la Bitácora.
- `baseUrl` validada al registrar el complemento: bloqueo de loopback/redes privadas y forzar `https://` en producción (mismas reglas anti-SSRF de `SECURITY.md`).

**Criterios de Aceptación de Arquitectura:**
1. Componente `ComplementContainerComponent` creado con `@Input() complement`.
2. `MainLayoutComponent` carga links dinámicos en sidebar desde `GET /api/complements/active`.
3. Si Circuit Breaker está OPEN, el contenedor muestra badge de mantenimiento en lugar del iframe.
4. Admin Console de complementos sigue el mismo patrón visual de `Admin > Integraciones SIEM/SOAR/NDR`.
5. `postMessage` handler registrado en `ngOnInit` con validación de origin y cleanup en `ngOnDestroy`.

### COMP-004 - Circuit Breaker para Microservicios

**Descripción técnica:**
Implementar patrón Circuit Breaker para aislar visualmente complementos con errores sin afectar el Core de la Bitácora. Si un microservicio tarda más de 3 segundos o devuelve errores 5xx, el sistema lo marca como "En Mantenimiento" y deja de intentar cargarlo hasta que se recupere.

**Estados del Circuit Breaker:**

| Estado | Condición de Entrada | Comportamiento UI | Comportamiento API |
|--------|---------------------|-------------------|-----------|
| **CLOSED** | Normal (< 3 fallos consecutivos) | iframe carga `baseUrl` normalmente | API Interna acepta requests del complemento |
| **OPEN** | ≥ 3 fallos en 60s **ó** timeout > 3s | iframe reemplazado por badge: `🔧 En mantenimiento` | API Interna rechaza requests con 503 |
| **HALF-OPEN** | 30s después de OPEN | Se intenta 1 request de health-check al microservicio | Si éxito → CLOSED. Si fallo → OPEN |

**Implementación Backend:**
```javascript
// Estado por complemento (en memoria, no persistido)
const circuitState = {
  slug: 'pentesting-scanner',
  state: 'CLOSED',      // CLOSED | OPEN | HALF_OPEN
  failCount: 0,
  lastFailure: null,
  lastCheck: null
};
```

**Configuración sugerida (variables de entorno):**
- `COMPLEMENT_CIRCUIT_TIMEOUT_MS=3000` (timeout de request)
- `COMPLEMENT_CIRCUIT_FAIL_THRESHOLD=3` (fallos para abrir)
- `COMPLEMENT_CIRCUIT_RESET_MS=30000` (tiempo antes de HALF-OPEN)

**Eventos de auditoría:**

| Namespace | Acción | Nivel | Metadata |
|-----------|--------|-------|----------|
| `complement.circuit` | `.open` | warn | `{slug, reason, failCount, lastError}` |
| `complement.circuit` | `.half_open` | info | `{slug, checkUrl}` |
| `complement.circuit` | `.close` | info | `{slug, recoveredAfterMs}` |

**Restricciones de Seguridad:**
- El estado del circuit breaker se almacena **en memoria** (no en DB); se resetea con reinicio del backend.
- Un complemento en estado OPEN no puede hacer requests a la API Interna (previene cascada de errores).
- Transición a OPEN genera evento de auditoría `complement.circuit.open` con detalles del fallo.

**Criterios de Aceptación de Arquitectura:**
1. **No-Impact Design**: Si un microservicio falla, el Core **NUNCA** se degrada. Solo ese complemento se muestra como "En Mantenimiento". Sidebar, checklist, entradas y todo lo demás funcionan con normalidad.
2. Frontend: `ComplementContainerComponent` consulta estado del circuit breaker y renderiza badge si OPEN.
3. Backend: health-check periódico (cada 30s) intenta transición HALF-OPEN → CLOSED.
4. Auditoría: todas las transiciones de estado registradas como eventos `complement.circuit.*`.
5. Config externalizada: los 3 parámetros del circuit breaker son variables de entorno, no hardcodeados.

### COMP-005 - Application Token y Scopes Granulares

**Descripción técnica:**
Implementar sistema de tokens de aplicación independiente del JWT de usuario, con scopes granulares y colecciones autorizadas. Cada complemento recibe su propio token firmado con un secret dedicado.

**Estructura del Application Token:**
```json
{
  "iss": "bitacora-core",
  "sub": "complement:pentesting-scanner",
  "slug": "pentesting-scanner",
  "scopes": ["READ_LOGS", "WRITE_STORAGE"],
  "allowedCollections": ["entries", "catalog_log_sources"],
  "iat": 1704067200,
  "exp": 1704153600
}
```

**Scopes disponibles:**

| Scope | Permite | Restricción |
|-------|---------|-------------|
| `READ_LOGS` | Leer entradas y logs filtrados | Solo colecciones autorizadas por admin |
| `WRITE_ENTRIES` | Crear entradas vinculadas al complemento | Marcadas con `ownerComplementId` automáticamente |
| `WRITE_STORAGE` | Escribir en colección "Shared" | Solo bajo su propio `complementId` |
| `READ_STORAGE` | Leer datos propios en "Shared" | Filtrado por `complementId` automático |
| `READ_CONTEXT` | Obtener turno/analista activo | Solo lectura, sin PII sensible |

**Restricciones de Seguridad:**
- `COMPLEMENT_TOKEN_SECRET` es un secret **diferente** a `JWT_SECRET` (generado con `openssl rand -base64 32`).
- Tokens tienen TTL configurable (max 24h) y se regeneran automáticamente al vencer.
- Revocación inmediata: al ejecutar `DELETE` de un complemento, su token se invalida al eliminarse el `tokenHash` del modelo.
- El middleware `complementAuth.js` verifica: firma, expiración, que el `slug` existe y está activo, y que los scopes requeridos están presentes.
- No se permiten wildcards en `allowedCollections`; cada colección debe ser autorizada explícitamente por el Admin.

**Criterios de Aceptación de Arquitectura:**
1. Modelo `Complement` incluye campo `tokenHash` (hash SHA-256 del último token emitido).
2. Admin puede ver scopes activos y revocar/regenerar token desde la UI de gestión.
3. Middleware `complementAuth.js` verifica: firma, expiración, slug activo, scopes requeridos.
4. Log: todo acceso denegado por scope se audita como `complement.api.denied` con metadata completa.
5. Secret `COMPLEMENT_TOKEN_SECRET` documentado en `DEPLOY.md` y `SECURITY.md` con instrucciones de generación.

### COMP-DOC - Archivos de `/docs` que Requieren Actualización

**Descripción:** Al implementar el Módulo de Complementos, los siguientes archivos de documentación deben actualizarse para que el módulo sea parte oficial del estándar de BitacoraSOC:

| Archivo | Qué se agrega | Prioridad |
|---------|---------------|-----------|
| `ARCHITECTURE.md` | Nuevo diagrama Mermaid del Orquestador + subgrafo de Complementos integrado al mapa conceptual. Nuevo nodo `🧩 Complementos` en el mapa de módulos admin. Flujo `sequenceDiagram` para comunicación Microservicio ↔ API Interna. | **CRÍTICA** |
| `API.md` | Nueva sección **"API Interna (Complementos)"** con tabla de endpoints `/api/internal/v1/*`, autenticación por Application Token, schemas y ejemplo cURL. Sección **"Complementos (Admin)"** con CRUD. | **CRÍTICA** |
| `SECURITY.md` | Sección **"Aislamiento de Complementos"**: Application Tokens, Scopes, sandbox de red, iframe sandbox. Actualizar checklist pre-producción. Sección **"Respuesta a Complement Comprometido"** en Incidentes. | **CRÍTICA** |
| `LOGGING.md` | 10 nuevos namespaces de auditoría: `complement.install`, `complement.delete`, `complement.wipe.*`, `complement.api.*`, `complement.circuit.*`. Trail forense del Wipe Out. | **ALTA** |
| `DEPLOY.md` | Variables de entorno: `COMPLEMENT_TOKEN_SECRET`, `COMPLEMENT_CIRCUIT_TIMEOUT_MS`, `COMPLEMENT_MAX_DBS`. Docker network aislada `bitacora-complements`. | **MEDIA** |
| `BACKUP.md` | Aclaración: backup general **NO incluye** DBs privadas de complementos. Responsabilidad del microservicio. Impacto del Wipe Out en backups. | **MEDIA** |
| `RUNBOOK.md` | Nuevo rol Admin: gestión de complementos. Troubleshooting para estado "Mantenimiento" de un complemento. | **BAJA** |

### COMP-006 - Shared Types & Contracts (Esquema JSON Compartido)

**Descripción técnica:**
BitacoraSOC no posee contratos de datos compartidos entre capas. El backend define 30 modelos Mongoose en JavaScript puro (`backend/src/models/*.js`), mientras que el frontend mantiene 12 archivos TypeScript locales (`frontend/src/app/models/*.model.ts`). No existe un paquete de tipos compartidos ni un esquema JSON unificado. Cuando se agreguen microservicios de complementos, cada uno tendría que duplicar las interfaces del Core para comunicarse, creando un riesgo alto de desincronización.

**Hallazgo de Auditoría de Código:**

| Capa | Archivos | Lenguaje | Tipado |
|------|----------|----------|--------|
| Backend | 30 modelos en `backend/src/models/` | JavaScript (ES6) | Mongoose Schema (runtime) |
| Frontend | 12 modelos en `frontend/src/app/models/` | TypeScript | Interfaces locales |
| Microservicios | (no existen aún) | (por definir) | (nada compartido) |

**Problema concreto:**
- Si el Core cambia el schema de `Entry` (agrega campo `ownerComplementId`), el microservicio no se entera hasta que falla en runtime.
- Si el frontend agrega una interfaz `Complement` en `models/`, el backend no tiene equivalente validado.
- Cero interfaces `.interface.ts` encontradas en el frontend — todo son `.model.ts` acoplados a la UI.

**Solución propuesta:**
1. **JSON Schema como fuente de verdad**: Crear carpeta `shared/schemas/` en raíz del repositorio con archivos `.schema.json` para cada entidad compartida (`complement.schema.json`, `internal-api-context.schema.json`, `complement-event.schema.json`).
2. **Generación automática**: Usar `json-schema-to-typescript` para generar interfaces TS desde los schemas, y validación con `ajv` en backend.
3. **Paquete npm local** (alternativa futura): Si el proyecto crece, mover a workspace npm con `shared-types` como paquete interno.

**Estructura propuesta:**
```
BitacoraSOC/
├── shared/
│   └── schemas/
│       ├── complement.schema.json        # Modelo Complement (slug, baseUrl, scopes...)
│       ├── complement-context.schema.json # Payload de /api/internal/v1/context
│       ├── complement-event.schema.json   # Eventos postMessage (type, payload)
│       └── README.md                      # Documentación del contrato
├── backend/
│   └── src/models/Complement.js           # Mongoose schema (consume JSON Schema)
└── frontend/
    └── src/app/models/complement.model.ts # Generado desde JSON Schema
```

**Restricciones de Seguridad:**
- Los schemas NO exponen campos internos del Core (`passwordHash`, `jwtSecret`, etc.)
- Solo se comparten las interfaces de la API Interna, no los modelos completos de Mongoose.
- Los schemas se versionan junto con la API Interna (`v1/complement.schema.json`).

**Criterios de Aceptación de Arquitectura:**
1. Carpeta `shared/schemas/` creada con al menos 3 JSON Schemas.
2. Backend valida payloads entrantes de la API Interna contra el schema con `ajv`.
3. Frontend tiene interfaces TypeScript generadas (o manuales) que coinciden con los schemas.
4. Un cambio en el schema se detecta en CI/CD (validación de compatibilidad).
5. Los microservicios de complementos pueden importar los schemas directamente.

### COMP-007 - Bus de Eventos para State Sync (Core ↔ Iframe)

**Descripción técnica:**
Actualmente `MainLayoutComponent` en `frontend/src/app/pages/main/main-layout.component.ts` gestiona estado local con `Subject<void>` (destroy), `Subject<string>` (notas) y consultas HTTP directas a servicios. No existe ningún mecanismo para notificar a iframes de complementos cuando cambia el contexto operativo. Si el analista N1 cambia de turno, cierra un checklist o cambia de cliente, el complemento sigue mostrando datos antiguos.

**Problema concreto con el código actual:**
- `MainLayoutComponent` (línea 40-60) tiene `currentUser`, `isAdmin`, `activeChecklist` como propiedades locales.
- `WorkShiftService.getCurrentShift()` se llama desde el componente, pero el resultado no se emite hacia ningún bus compartido.
- El iframe del complemento NO tiene acceso a estos servicios Angular — está en un sandbox aislado.

**Solución propuesta — Protocolo `postMessage` tipado:**

```typescript
// Protocolo de eventos Core → Complemento (outbound)
interface BitacoraEvent {
  type: 'CONTEXT_UPDATE' | 'SHIFT_CHANGE' | 'USER_CHANGE' | 'THEME_CHANGE' | 'CHECKLIST_SUBMITTED';
  version: 1;
  payload: ContextPayload | ShiftPayload | ThemePayload;
  timestamp: number;
}

interface ContextPayload {
  shiftId: string;
  shiftName: string;
  analystUsername: string;
  clientId?: string;
  clientName?: string;
}

// Protocolo de eventos Complemento → Core (inbound)
interface ComplementEvent {
  type: 'REQUEST_CONTEXT' | 'CREATE_ENTRY' | 'NOTIFY_ERROR';
  version: 1;
  slug: string;  // Identificador del complemento que envía
  payload: any;
}
```

**Implementación sugerida:**
1. **Servicio Angular `ComplementBridgeService`**: Singleton que escucha `window.addEventListener('message', ...)` y despacha eventos a los iframes registrados.
2. **Registro de iframes**: Al cargar un `ComplementContainerComponent`, registra su `contentWindow` en el bridge.
3. **Emisión reactiva**: Cuando `WorkShiftService.getCurrentShift()` detecta cambio de turno, el bridge emite `SHIFT_CHANGE` a todos los iframes.
4. **Validación de origin**: Solo se procesan mensajes cuyo `event.origin` coincida con el `baseUrl` registrado del complemento.
5. **Debounce**: Eventos rápidos (ej. cambio de tema) se agrupan con `debounceTime(300ms)` antes de enviar.

**Diagrama de flujo:**
```
┌──────────────┐    postMessage     ┌──────────────────┐
│ Angular Core │ ───────────────→  │ Iframe Complement │
│              │                    │                  │
│ ShiftService │  SHIFT_CHANGE      │  onMessage()     │
│ AuthService  │  USER_CHANGE       │  updateContext() │
│ ThemeService │  THEME_CHANGE      │  re-render()     │
│              │ ←───────────────── │                  │
│              │  REQUEST_CONTEXT   │  requestData()   │
└──────────────┘                    └──────────────────┘
```

**Restricciones de Seguridad:**
- Validación estricta de `event.origin` contra `complement.baseUrl` registrada.
- El Core NUNCA envía JWT ni tokens de usuario por postMessage; solo context tokens de corta vida.
- Los eventos `ComplementEvent` inbound se validan contra el JSON Schema de `complement-event.schema.json`.
- Si un iframe envía más de 100 mensajes en 10 segundos, se desconecta del bridge y se registra como `complement.api.flood`.

**Criterios de Aceptación de Arquitectura:**
1. `ComplementBridgeService` creado como `providedIn: 'root'` con registro/desregistro de iframes.
2. Eventos tipados con `BitacoraEvent` interface y validación de `version` para compatibilidad futura.
3. Cambio de turno en `WorkShiftService` dispara `SHIFT_CHANGE` a todos los iframes activos en < 500ms.
4. Eventos inbound del complemento se validan por origin y rate-limit antes de procesarse.
5. Si el complemento envía `REQUEST_CONTEXT`, el Core responde con el contexto actual sin re-consultar la API.

### COMP-008 - Orquestación Docker y Redes Aisladas

**Descripción técnica:**
El `docker-compose.yml` actual define 3 servicios (`mongodb`, `backend`, `frontend`) en una única red `bitacora-network` tipo `bridge`. Para integrar microservicios de complementos, se necesita una red aislada que permita a los complementos comunicarse exclusivamente con el backend, sin acceso directo a MongoDB ni al frontend.

**Estado actual del `docker-compose.yml`:**
```yaml
# Servicios actuales: mongodb, backend, frontend
# Red actual: bitacora-network (bridge, única)
# Puertos expuestos: 3000 (backend), 80/443 (frontend)
# Sin network isolation para servicios externos
```

**Problema concreto:**
- Un microservicio de complemento en la misma `bitacora-network` podría conectarse directamente a `mongodb:27017` (bypass total de la API Interna).
- No existe `docker-compose.override.yml` ni `docker-compose.complements.yml` para separar servicios opcionales.
- No hay variables de entorno para configurar la cantidad máxima de complementos ni límites de recursos.

**Solución propuesta — docker-compose multi-network:**

```yaml
# docker-compose.complements.yml (archivo separado, se levanta con -f)
services:
  complement-example:
    image: ${COMPLEMENT_EXAMPLE_IMAGE:-ghcr.io/org/complement-example:latest}
    container_name: bitacora-complement-example
    restart: unless-stopped
    environment:
      BITACORA_API_URL: http://backend:3000/api/internal/v1
      COMPLEMENT_TOKEN: ${COMPLEMENT_EXAMPLE_TOKEN}
      COMPLEMENT_SLUG: example-scanner
      MONGODB_URI: mongodb://${MONGO_ROOT_USER:-admin}:${MONGO_ROOT_PASSWORD}@mongodb:27017/bitacora_ext_example?authSource=admin
    networks:
      - bitacora-complements   # Solo acceso a esta red
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 3s
      retries: 3

networks:
  bitacora-complements:
    driver: bridge
    internal: false   # Permite salida a internet si es necesario
```

**Modificación al `docker-compose.yml` principal:**
```yaml
# Agregar al servicio backend:
  backend:
    networks:
      - bitacora-network
      - bitacora-complements  # Backend accesible desde ambas redes

# Agregar al servicio mongodb:
  mongodb:
    networks:
      - bitacora-network
      - bitacora-complements  # Complementos con DB propia necesitan acceso

# Agregar red:
networks:
  bitacora-network:
    driver: bridge
  bitacora-complements:
    driver: bridge
```

**Variables de entorno nuevas para `.env`:**
```bash
# Complementos
COMPLEMENT_TOKEN_SECRET=          # openssl rand -base64 32
COMPLEMENT_MAX_DBS=5              # Máximo de DBs privadas permitidas
COMPLEMENT_CIRCUIT_TIMEOUT_MS=3000
COMPLEMENT_CIRCUIT_FAIL_THRESHOLD=3
COMPLEMENT_CIRCUIT_RESET_MS=30000
```

**Restricciones de Seguridad:**
- Los complementos **no** tienen acceso directo al servicio `frontend`.
- El backend es el único puente entre ambas redes (actúa como API Gateway).
- Cada contenedor de complemento tiene límites de recursos (`memory: 512M`, `cpus: 0.5`) para prevenir DoS.
- MongoDB permite conexión de complementos solo a bases `bitacora_ext_*` (usuario dedicado con permisos limitados).

**Criterios de Aceptación de Arquitectura:**
1. Archivo `docker-compose.complements.yml` creado como overlay separado del principal.
2. Comando de despliegue: `docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d`.
3. Red `bitacora-complements` creada y aislada del frontend.
4. Backend conectado a ambas redes; complementos solo a `bitacora-complements`.
5. Variables de entorno documentadas en `DEPLOY.md` con valores por defecto seguros.
6. Scripts `compose-rebuild.ps1` y `compose-rebuild.sh` actualizados para incluir el overlay.

### COMP-009 - Logging Centralizado de Microservicios

**Descripción técnica:**
El sistema de logging actual (documentado en `LOGGING.md`) opera en 3 capas: pino a stdout, AuditLog a MongoDB, y forwarding a SIEM. Pero las 3 capas solo cubren los logs del backend Core. Cuando un microservicio de complemento falle, su log quedará atrapado dentro de su propio contenedor Docker — invisible desde la Bitácora.

**Estado actual de observabilidad:**

| Capa | Alcance Actual | Limitación para Complementos |
|------|---------------|------------------------------|
| pino (stdout) | Solo `bitacora-backend` | Complementos escriben a su propio stdout |
| AuditLog (MongoDB) | Colección `auditlogs` en BD General | Complementos no tienen acceso de escritura |
| SIEM Forwarding | Solo eventos del Core | Complementos no envían a SIEM |

**Solución propuesta — Logging Bridge via API Interna:**

```javascript
// Nuevo endpoint en API Interna v1
// POST /api/internal/v1/log
// Scope requerido: WRITE_LOGS (nuevo scope)
{
  "level": "error",
  "event": "complement.scanner.scan_failed",
  "message": "Timeout al escanear host 10.0.0.5",
  "metadata": {
    "targetHost": "10.0.0.5",
    "timeoutMs": 5000,
    "scanType": "vulnerability"
  }
}
```

**Flujo de logs centralizado:**
```
┌─────────────────┐   POST /log     ┌──────────────┐
│ Microservicio   │ ──────────────→ │ Backend Core │
│ (complement)    │                  │              │
│ pino local      │                  │ ┌──────────┐ │    ┌──────┐
│ stdout (propio) │                  │ │ AuditLog │──────→│ SIEM │
└─────────────────┘                  │ └──────────┘ │    └──────┘
                                     │              │
                                     │ Admin UI:    │
                                     │ /audit-logs  │
                                     │ filtro: slug │
                                     └──────────────┘
```

**Implementación en la UI Admin:**
1. Extender la vista `/main/admin/audit-logs` con filtro por `source: 'complement:<slug>'`.
2. Nuevo sub-tab: **"Logs de Complementos"** que muestre solo eventos con namespace `complement.*`.
3. Badge de error en sidebar cuando haya errores recientes de un complemento.

**Restricciones de Seguridad:**
- Rate-limit específico para `/api/internal/v1/log`: 50 requests/minuto por token (previene flood de logs).
- Metadata se trunca a 10KB (mismo límite que AuditLog existente).
- El campo `event` del complemento se prefixa automáticamente con `complement.<slug>.` para evitar colisión con namespaces del Core.
- Logs del complemento se marcan como `source: 'complement'` y no pueden falsificar `source: 'core'`.

**Criterios de Aceptación de Arquitectura:**
1. Endpoint `POST /api/internal/v1/log` creado con scope `WRITE_LOGS`.
2. Logs del complemento se persisten en la colección `auditlogs` con TTL idéntico al Core (90 días).
3. Logs se forwardean a SIEM si forwarding está habilitado, con campo `source: 'complement:<slug>'`.
4. UI Admin permite filtrar por complemento en la vista de auditoría.
5. Documentado en `LOGGING.md` bajo nueva sección "Logs de Complementos".

### COMP-010 - Versionamiento de API Interna (Compatibilidad)

**Descripción técnica:**
Si se actualiza el Core de la Bitácora (ej. se agrega un campo obligatorio en el contexto de turno), los microservicios que usan la versión anterior de la API deben seguir funcionando. Actualmente, ninguna ruta de la Bitácora tiene prefijo de versión (`/api/entries`, no `/api/v1/entries`). La API Interna propuesta ya usa `/api/internal/v1/`, pero falta el protocolo de deprecación, negociación de versiones y headers de compatibilidad.

**Estado actual del RouterMap:**
```
/api/auth/*        → Sin versión
/api/entries/*     → Sin versión
/api/checklist/*   → Sin versión
/api/internal/v1/* → Con versión (PROPUESTO, aún no implementado)
```

**Solución propuesta — Versionamiento Semántico de API Interna:**

1. **Convención de rutas**: `/api/internal/v{major}/` — solo se incrementa major si hay breaking changes.
2. **Coexistencia**: Al crear `v2`, se mantiene `v1` operativo durante al menos 2 releases del Core.
3. **Deprecation Headers**: Cuando un complemento hace request a `v1` y ya existe `v2`:
   ```
   HTTP/1.1 200 OK
   Deprecation: true
   Sunset: Sat, 01 Jan 2027 00:00:00 GMT
   Link: </api/internal/v2/context>; rel="successor-version"
   X-API-Version: v1
   X-API-Latest: v2
   ```
4. **Registro de versión en modelo `Complement`**: Campo `apiVersion: 'v1'` para saber qué versión usa cada complemento.
5. **Endpoint de discovery**: `GET /api/internal/versions` retorna las versiones disponibles y su estado.

**Negociación de versión:**
```json
// GET /api/internal/versions
{
  "versions": [
    { "version": "v1", "status": "current", "sunset": null },
    { "version": "v2", "status": "beta", "sunset": null }
  ],
  "latest": "v1"
}
```

**Restricciones de Seguridad:**
- Un complemento no puede auto-upgradear su `apiVersion`; solo Admin lo hace desde la consola.
- Las rutas deprecadas se auditan con `complement.api.deprecated_access` para monitorear adopción.
- Al alcanzar la fecha `Sunset`, las rutas `v1` retornan 410 Gone en lugar de 404.

**Criterios de Aceptación de Arquitectura:**
1. Estructura de archivos: `backend/src/routes/internal/v1/*.js`, `backend/src/routes/internal/v2/*.js`.
2. Middleware de versión inyecta headers `X-API-Version` y `Deprecation` automáticamente.
3. Endpoint `GET /api/internal/versions` operativo y documentado en `API.md`.
4. Modelo `Complement` incluye campo `apiVersion` con valor por defecto `'v1'`.
5. Logs de acceso a versiones deprecadas auditados para planificar sunset.

### COMP-011 - Mocks de Complementos para Pruebas de Integración

**Descripción técnica:**
Cuando se prueba la Bitácora en desarrollo o CI/CD, no se pueden tener 10 microservicios reales corriendo. Se necesita un microservicio mock (`complement-stub`) que simule las interacciones de un complemento real: responder a health-checks, consumir la API Interna, servir un iframe de prueba, y recibir hooks de cleanup del Wipe Out.

**Problema concreto:**
- Sin mocks, los desarrolladores no pueden probar: Circuit Breaker (necesita fallos simulados), State Sync (necesita un iframe receptor), Wipe Out (necesita un `/hook/cleanup` endpoint), ni la consola de Admin.
- No existe infraestructura de test E2E que incluya un complemento.

**Solución propuesta — `complement-stub` (microservicio Node.js mínimo):**

```javascript
// complement-stub/server.js
const express = require('express');
const app = express();

// === Health Check ===
app.get('/health', (req, res) => {
  if (process.env.SIMULATE_FAILURE === 'true') {
    return res.status(503).json({ status: 'down', reason: 'simulated failure' });
  }
  res.json({ status: 'ok', slug: 'test-complement' });
});

// === Iframe Content (UI de prueba) ===
app.get('/', (req, res) => {
  res.send(`
    <html>
    <body>
      <h1>🧩 Complement Stub</h1>
      <div id="context">Esperando contexto...</div>
      <script>
        window.addEventListener('message', (e) => {
          if (e.data.type === 'CONTEXT_UPDATE') {
            document.getElementById('context').textContent =
              JSON.stringify(e.data.payload, null, 2);
          }
        });
        // Solicitar contexto inicial al Core
        window.parent.postMessage(
          { type: 'REQUEST_CONTEXT', slug: 'test-complement', version: 1 },
          '*'
        );
      </script>
    </body>
    </html>
  `);
});

// === Hook de Cleanup (recibe Wipe Out) ===
app.post('/hook/cleanup', (req, res) => {
  console.log('[STUB] Cleanup hook received, simulating cleanup...');
  setTimeout(() => res.json({ cleaned: true }), 500);
});

// === Test de API Interna (consume endpoints del Core) ===
app.get('/test-api', async (req, res) => {
  const fetch = (await import('node-fetch')).default;
  try {
    const response = await fetch(
      `${process.env.BITACORA_API_URL}/context`,
      { headers: { 'Authorization': `Bearer ${process.env.COMPLEMENT_TOKEN}` } }
    );
    const data = await response.json();
    res.json({ coreContext: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(8080, () => console.log('[STUB] Complement mock running on :8080'));
```

**Modos de operación (via variables de entorno):**

| Variable | Efecto | Uso |
|----------|--------|-----|
| `SIMULATE_FAILURE=true` | Health-check retorna 503 | Probar Circuit Breaker |
| `SIMULATE_SLOW=true` | Respuestas con delay de 5s | Probar timeout del Circuit Breaker |
| `SIMULATE_CLEANUP_FAIL=true` | Hook `/cleanup` retorna 500 | Probar Wipe Out con fallo de hook |
| `COMPLEMENT_TOKEN` | Token de autenticación | Probar API Interna |

**Integración con docker-compose:**
```yaml
# docker-compose.test.yml
services:
  complement-stub:
    build: ./tools/complement-stub
    container_name: bitacora-complement-stub
    environment:
      BITACORA_API_URL: http://backend:3000/api/internal/v1
      COMPLEMENT_TOKEN: ${COMPLEMENT_STUB_TOKEN}
      SIMULATE_FAILURE: 'false'
    ports:
      - "8080:8080"
    networks:
      - bitacora-complements
```

**Restricciones de Seguridad:**
- El stub **nunca** se despliega en producción (solo en `docker-compose.test.yml`).
- El token del stub tiene scopes mínimos y expiración corta (1h).
- El stub no almacena datos persistentes (stateless).

**Criterios de Aceptación de Arquitectura:**
1. Directorio `tools/complement-stub/` creado con `server.js`, `Dockerfile` y `README.md`.
2. El stub responde correctamente a: health-check, iframe rendering, hook cleanup, y consulta de API Interna.
3. Configurable por variables de entorno para simular fallos (Circuit Breaker), lentitud (timeout) y errores de cleanup.
4. Documentado en `DEPLOY.md` bajo sección "Entorno de Testing con Complementos".
5. Integrado en `docker-compose.test.yml` como overlay para CI/CD.

---
