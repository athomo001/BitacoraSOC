<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

### ⏳ Pendientes

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| INFRA-MONGO-001 | Pendiente | Infraestructura / Datos CRÍTICA | Upgrade MongoDB (7 → 8) | El motor base de `mongo:7` en el docker-compose termina su soporte LTS oficial en Agosto de 2026. Se debe planificar un salto a `mongo:8`. Dado que los archivos de base de datos `.wt` no siempre son retrocompatibles entre versiones mayores, el protocolo a documentar e investigar requerirá: 1) `mongodump` completo; 2) Borrar el contenedor y limpiar el volumen físico `.data/mongodb_data`; 3) Levantar el nuevo `mongo:8` vacío; 4) Inyectar los datos de vuelta con `mongorestore`. |
| B19 | Pendiente | Integraciones | Creación de tickets en GLPI (Correo / API) | Definir flujo final (resumen diario vs evento inmediato), destino y estrategia de reintentos. |
| AI-SUMMARY-001 | Pendiente | IA/Operación ALTA | Módulo de Resumen Ejecutivo Efímero (IA On-Demand) | Integrar Ollama+llama3.2:3b en modo efímero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`, salida editable en campo "Resumen Sugerido por IA" y botón "Generar con IA". |
| B34 | Pendiente | Operación/Alertas | Alerta por ítems NOK (Rojo) en Checklist | Añadir switch en config global para activar/desactivar alerta por ítems en rojo. Agregar selector de cargo (ej. N2) a notificar. Al guardar el checklist, si el analista marca ítems NOK (rojo), enviar email automático a todos los usuarios del cargo seleccionado incluyendo el detalle/observación ingresada por el analista. |
| SEC-HIGH-009 | Pendiente | Seguridad ALTA | Riesgo de Regex Injection / ReDoS en búsquedas de catálogo y tags (NoSQL) | Hallazgo QA: existen regex construidas directo desde input sin escape (`new RegExp(search, 'i')`, `new RegExp('^' + q, 'i')`, `$regex` con `topic` sin escapar) en rutas autenticadas/admin. Un patrón malicioso puede disparar backtracking costoso y degradar el backend (DoS lógico). Archivos detectados: `backend/src/routes/admin-catalog.js`, `backend/src/routes/tags.js`, `backend/src/routes/entries.js`, `backend/src/controllers/escalationController.js`. |
| SEC-HIGH-010 | Pendiente | Seguridad ALTA | OWASP A10 SSRF: URLs salientes configurables sin allowlist en integraciones | Hallazgo QA: endpoints de integración permiten destinos salientes controlados por configuración (`GLPI api.baseUrl` y `logging http.url`) sin validación estricta de red interna/loopback/protocolos. Riesgo: Server-Side Request Forgery desde backend hacia servicios internos/metadatos si una cuenta admin se compromete. Archivos detectados: `backend/src/routes/glpi.js`, `backend/src/routes/logging.js`, `backend/src/utils/logForwarder.js`. |
| SEC-MED-011 | Pendiente | Seguridad MEDIA | OWASP A09/A02: Logging sensible en autenticación (username + estado de password) | Hallazgo QA: en login se registran por consola datos sensibles de autenticación (`LOGIN REQUEST`, `Usuario encontrado`, `Password match`) sin condicionamiento por entorno. Riesgo: exposición de telemetría de credenciales/intentos en logs operativos. Archivo detectado: `backend/src/routes/auth.js`. |

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
   - memoria limitada a `--memory=\"2g\"`
   - volumen persistente `-v ollama_data:/root/.ollama`
   - contenedor apagado fuera de uso (superficie mínima y ahorro de RAM).

### INFRA-MONGO-001 - Upgrade MongoDB (7 → 8)

1. **Respaldar Datos:** Crear un script bash temporal que entre al contenedor `mongo:7` actual y ejecute `mongodump` completo hacia `/data/db/dump`. Mover este dump al host.
2. **Destrucción Segura:** Bajar el stack completo (`docker-compose down`). Renombrar o hacer backup físico de la carpeta host `./.data/mongodb_data` por precaución.
3. **Actualización de Imágen:** Modificar `docker-compose.yml` apuntando el tag a `mongo:8`.
4. **Levantamiento y Restauración:** Arrancar el nuevo servicio `mongo:8`. Las bases estarán limpias porque se generará un nuevo volumen o carpeta de datos. Entrar al contenedor y ejecutar `mongorestore` apuntando al dump generado en el paso 1. Validar integridad visual de la Bitácora.
5. **Documentación:** Registrar la ventana de mantenimiento y las versiones finales en `README.md` o documentación operativa.

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

### B45 - Correo de fin de turno pospuesto hasta checklist de cierre real

1. **Regla operativa (backend):**
   - En el trigger automático de fin de turno, si no existe checklist de cierre (`type: 'cierre'`) para ese turno/sesión, no enviar correo y marcar envío como pendiente.
2. **Disparador diferido:**
   - Al registrar checklist de cierre (ruta de guardado de checklist), evaluar si existe reporte pendiente para ese turno y ejecutar `sendShiftReport(...)` inmediatamente.
3. **Antiduplicado:**
   - Reusar/fortalecer la lógica de `lastReportSentAt` para impedir doble envío cuando coincidan cron + envío diferido.
4. **Ventana y correlación:**
   - Correlacionar checklist inicio/cierre y entradas usando la sesión real del turno (incluyendo casos de cruce de medianoche y checklist de cierre tardío).
5. **Trazabilidad:**
   - Registrar en logs/auditoría estados `PENDIENTE_POR_CIERRE`, `ENVIADO_DIFERIDO` y motivo de no envío en trigger horario.

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

### B35 - Header Checklist y Fix "Último Check"

1. **Frontend (Header):**
   - Localizar el componente en `frontend/src/app/pages/main/checklist` (o similar).
   - Cambiar el texto estático `Checklist Diario Analistas N1` por `Checklist del turno`.
2. **Frontend/Backend (Dato de Último Check):**
   - Revisar la suscripción o el servicio que trae el `lastCheck`. Asegurar que se invalide la caché o que el backend devuelva el documento más reciente por `createdAt` sin filtros que excluyan al usuario actual o a otros.
   - Si es un problema de visualización, asegurar que el `DatePipe` sea correcto y el binding del `username` venga del registro real de la DB.

### B36 - Aprovechamiento de ancho de pantalla

1. **Estructura Layout (CSS):**
    - En `main-layout.component.scss`, identificar el contenedor principal (`.main-container` o `.content`).
    - Ajustar el `max-width` o los márgenes laterales.
2. **Interactividad con Cajón de Notas:**
    - Usar una clase dinámica (ej: `.with-notes-open`) en el contenedor principal.
    - Cuando `showNotes` sea `false`, aplicar `width: 100%` o un ancho mayor.
    - Cuando `showNotes` sea `true`, aplicar el padding/margen necesario para no solapar el cajón de notas.

### B39 - Checklist: ocultar estado de item padre con sub-items

1. **UI (Checklist):**
   - En `frontend/src/app/pages/main/checklist/checklist.component.html`, ocultar el `mat-radio-group` del item padre cuando `service.children?.length` es true (hoy aparece dentro del panel).
   - Mantener solo el icono/estado en el header para indicar el estado agregado.
2. **Cálculo de estado agregado (TS):**
   - En `checklist.component.ts`, al cambiar un sub-item, recalcular el estado del padre: `rojo` si algún hijo rojo, `verde` si todos verdes, `null` si hay pendientes.
   - Propagar el cálculo hacia arriba (ancestros) usando un helper (ej. `getAggregateStatus(node)`).
3. **Validación y observaciones:**
   - Ajustar la validación `allHaveStatus` para exigir estado solo a hojas (items sin hijos).
   - La observación obligatoria debe aplicar solo al item rojo hoja, no al padre derivado.
4. **Payload:**
   - Antes de enviar, asegurar que el estado del padre ya esté calculado; enviar ese estado derivado (o, si el backend lo permite, excluir nodos padre del payload).

### B40 - Report Generator: búsqueda de ofensas no encuentra nuevas ni coincide por texto

**Hecho (backend):**
- Se reemplazó el filtro simple por regex con un ranking por relevancia en `/api/catalog/*` para priorizar exact/prefix y reducir ruido en términos cortos.

**Falta validar / completar:**
- Probar en `/main/report-generator` que “TOR” aparece correctamente y por encima de resultados no relacionados.
- Verificar si el selector mantiene cache local y forzar refresh tras crear nuevas ofensas.
- Ejecutar pruebas o smoke test de búsqueda en catálogo.

1. **Reproducción y datos:**
   - Crear ofensa nueva (ej. "TOR") y abrir `/main/report-generator`.
   - Confirmar si el selector usa cache local o datos remotos paginados.
2. **Backend/API:**
   - Revisar endpoint de búsqueda/listado de ofensas: normalizar `q` (lowercase, trim, quitar tildes) y usar `contains` o `startsWith` en `name/title`.
   - Verificar si hay ranking por relevancia que esté priorizando resultados no relacionados.
   - Asegurar índice en campo `name/title` para búsquedas parciales (si usa Mongo, `text` o regex con collation).
3. **Frontend:**
   - Revisar lógica de filtro en el selector/autocomplete (case-insensitive).
   - Forzar refresco del dataset luego de crear una nueva ofensa (re-fetch o invalidar cache).
4. **UX:**
   - Mostrar mensaje "Sin coincidencias" cuando no haya resultados reales.
   - Opcional: mostrar el término buscado y un botón "Refrescar" si el dataset está desactualizado.

### B43 - Email de turno: refactorización a MJML y rediseño como dashboard

**Contexto del código actual:**
- Archivo principal: `backend/src/utils/shift-report.js`
- Función que genera el HTML: `generateReportHTML({ shift, checklistEntry, checklistExit, entries, periodStart, periodEnd, appTitle })`
- Función de texto plano (fallback): `generateReportText(...)` — NO debe modificarse
- Función de envío: `sendShiftReport(shiftId, shiftDate, options)` — su interfaz NO debe cambiar
- Variable de branding: `appTitle` → viene de `AppConfig.appTitle` (DB) con fallback `'Bitácora SOC'`; dentro de `generateReportHTML` se llama `brandedAppTitle`
- Problema de texto redundante: `renderStatusCell()` muestra `'OK (Verde)'` / `'ERROR (Rojo)'` — eliminar redundancia
- Las observaciones vacías se muestran como `Obs: -` — solo mostrar si `service.observation` existe

**Problemas a solucionar en esta refactorización:**
1. Texto redundante en estados (OK Verde / ERROR Rojo)
2. No existe sección de Resumen Ejecutivo (conteos visuales)
3. Checklist es tabla plana de 3 columnas — difícil de escanear
4. Entradas de Bitácora sin jerarquía visual clara
5. Observaciones siempre visibles aunque vacías
6. HTML frágil sin framework — incompatible con dark-mode, Outlook, Gmail

**Dependencia nueva:**
- Añadir `mjml` a `backend/package.json` (`npm install mjml`)
- El paquete compila plantillas MJML a HTML compatible con Outlook/Gmail en tiempo de ejecución (Node)
- Uso: `const mjml2html = require('mjml'); const { html } = mjml2html(mjmlTemplate);`

**Estructura de la nueva plantilla MJML (`generateReportHTML`):**

1. **Header** (`<mj-section>` fondo oscuro o primario)
   - **Favicon/Logo:** Si `AppConfig.faviconUrl` existe, mostrarlo como imagen pequeña (max-width: 32px o 48px) en la esquina izquierda del header, alineado verticalmente con el título
   - Título: `🛡️ Reporte de Turno — ${brandedAppTitle}` (el guión largo separa el subtítulo); posicionar al lado del favicon si existe
   - Subtítulo: `${shift.name} • ${shift.startTime}–${shift.endTime} • ${dateLabel}`
   - Si `periodLabel` existe, mostrarlo en una tercera línea más pequeña (Periodo: [rango completo])

2. **Resumen Ejecutivo** (`<mj-section>` con 3 columnas `<mj-column>`)
   - Calcular antes de renderizar:
     - `totalOk` = servicios con `status === 'verde'` en entry + exit (contar sin duplicados por `serviceId`)
     - `totalError` = servicios con `status === 'rojo'` en entry o exit
     - `totalEntries` = `entries.length`
   - Cada columna: número grande (tipografía gruesa) + etiqueta debajo (`OK`, `NO OK`, `Entradas`); fondos sutiles para claridad

3. **Checklist — tarjetas por servicio** (`<mj-section>` por servicio, NO tabla)
   - Iterar `buildServiceRows(checklistEntry, checklistExit)` y renderizar cada servicio como una tarjeta visual
   - Nombre del servicio en header destacado
   - Columnas visuales Entrada / Salida lado a lado (no filas de tabla, sino bloques)
   - **Estados columna Entrada:**
     - `🟢 OK` → si `row.entry.status === 'verde'`
     - `🔴 ERROR` → si `row.entry.status === 'rojo'`
     - `—` gris → si sin registro
   - **Estados columna Salida:** (Por ahora OK / ERROR; B44 añadirá REPARADO)
     - `🟢 OK` → si `row.exit.status === 'verde'`
     - `🔴 ERROR` → si `row.exit.status === 'rojo'`
     - `—` gris → si sin registro
   - Observación: mostrar **solo si existe** (`service.observation`), con formato `Obs: [texto]`; no mostrar si está vacía

4. **Bitácora — bloques independientes** (`<mj-section>` por cada entrada, con jerarquía visual)
   - Iterar `entries` (igual que antes)
   - Cada entrada como bloque independiente con:
     - Header: hora + fecha (tipografía media/bold)
     - Subtítulo: tipo + cliente (tipografía pequeña, gris)
     - Cuerpo: `content` completo sin resumir, respetando saltos de línea (`\n` → `<br>`)
   - Separación visual clara entre bloques (espaciado, bordes sutiles)

5. **Footer** (`<mj-section>`)
   - `Este correo fue generado automáticamente por ${brandedAppTitle}`
   - `No responder a este mensaje`

**Reglas de implementación:**
- **SOLO** reemplazar la función `generateReportHTML()` — no tocar `generateReportText()`, `sendShiftReport()` ni los modelos
- No modificar `renderStatusCell()` en esta fase (B44 lo hará)
- La lógica de datos (buildServiceRows, formatTime, formatDate, escapeHtml, etc.) se mantiene sin cambios
- El MJML se construye como template literal: `const mjmlTemplate = \`<mjml>...\`; const { html } = mjml2html(mjmlTemplate).html;`
- Si `mjml2html` lanza error de compilación, capturarlo y lanzar error descriptivo (no silenciar)
- Fondo: `#ffffff` (claro), tipografía simple, sin CSS moderno ni JavaScript
- Compatibilidad: probar viewport móvil y outlook desktop antes de mergear

### B44 - Reporte de turno: estado REPARADO (amarillo) en celda de salida

**Alcance estricto:** Solo aplica a `backend/src/utils/shift-report.js`, función `generateReportHTML()`. Ningún otro correo, controlador ni módulo debe modificarse.

**Lógica de negocio:**
- La comparación se hace por servicio, usando `buildServiceRows()` que ya empareja `row.entry` y `row.exit` por `serviceId`
- Antes de comparar estados, validar si checklist de inicio y cierre son la misma plantilla/checklist (prioridad: mismo `checklistId/templateId`; fallback: mismo nombre normalizado)
- Condición REPARADO: `row.exit.status === 'verde'` **y** `row.entry.status === 'rojo'`
- Condición ERROR: `row.exit.status === 'rojo'` (sin importar el estado de entrada)
- El estado REPARADO solo puede aparecer en la columna **Salida**, nunca en Entrada
- Si solo existe checklist de salida (sin entrada), NO aplica REPARADO — mostrar el estado normal de salida
- Si inicio y cierre pertenecen a plantillas/checklists distintos, NO aplica REPARADO: se muestran como registros separados (ejemplo: servicio X rojo en inicio se mantiene rojo con su observación; servicio Y verde en cierre se mantiene verde)

**Implementación sugerida:**
1. Crear función `renderExitCell(exitService, entryService)` en el mismo archivo, a continuación de `renderStatusCell()`
2. La función evalúa la condición y retorna:
   - REPARADO: badge amarillo (`#f57f17`) con texto `REPARADO` + nota `⚠ Fue ERROR en entrada`; observación de salida solo si existe
   - Cualquier otro caso: delegar a `renderStatusCell(exitService)` sin cambios
3. En el `forEach` de `serviceRows`, usar `renderExitCell(row.exit, row.entry)` para la columna de Salida y mantener `renderStatusCell(row.entry)` para la de Entrada
4. No modificar `renderStatusCell()` ni ninguna otra función existente

---
