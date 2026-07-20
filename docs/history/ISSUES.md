<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->

# Plan de Trabajo: Bitacora SOC

## Tablas de Control

**Alcance de seguimiento:** Las filas `AI-SUMMARY-001` ... `AI-SUMMARY-001G` se mantienen como **referencia** (especificacion/archivo), pero **no forman parte** del backlog operativo que el equipo prioriza para iteraciones UI/QA ni de las metricas por oleada historicas (`UI-MIG-060` cerrado como proceso). Para trabajo vivo: obligaciones **Recurrente**, metricas del documento `docs/UI-GOVERNANCE.md`, y nuevos `UI-*` si se abren.

### Leyenda de estados (tablas de control)

| Estado          | Uso                                                                |
| :-------------- | :----------------------------------------------------------------- |
| **Pendiente**   | Issue abierto aun no iniciado.                                     |
| **En progreso** | Issue abierto con trabajo en curso.                                |
| **Recurrente**  | Politica viva (cada PR), no se cierra como ticket unico.           |
| **Archivo**     | Epic/documentacion de referencia sin seguimiento operativo activo. |
| **Listo**       | Issue cerrado con resultado aplicado o documentado.                |

### En progreso (backlog activo)

*No hay tareas pendientes en el backlog activo.*

### Recurrente (QA - cada cambio UI)

| ID        | Estado     | Seccion                     | Tarea                                           | Notas                                                                         |
| :-------- | :--------- | :-------------------------- | :---------------------------------------------- | :---------------------------------------------------------------------------- |
| QA-UI-061 | Recurrente | QA + Frontend CRITICA       | Rol QA en cada cambio UI                        | Obligacion en cada PR que toque estilos. Referencia: `docs/UI-GOVERNANCE.md`. |
| QA-UI-062 | Recurrente | QA Visual CRITICA           | Probar en los 5 temas lo tocado                 | Recurrente por cambio. Ver `docs/UI-GOVERNANCE.md`.                           |
| QA-UI-063 | Recurrente | QA Funcional + UI ALTA      | Regresion de formularios tras cambios de estilo | Recurrente por cambio. Ver `docs/UI-GOVERNANCE.md`.                           |
| QA-UI-064 | Recurrente | QA Contraste / Theming ALTA | Casos explicitos de contraste/inputs            | Recurrente por cambio. Ver `docs/UI-GOVERNANCE.md`.                           |
| QA-UI-065 | Recurrente | Gobernanza CRITICA          | No omitir estandares al codificar               | Politica viva de desarrollo. |

### Archivo (referencia, sin seguimiento operativo)

| ID              | Estado  | Seccion                | Tarea                                                                       | Notas                                                                                                                                                                                                                                      |
| :-------------- | :------ | :--------------------- | :-------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-SUMMARY-001  | Archivo | IA/Operacion ALTA      | Modulo de Resumen Ejecutivo Efimero (IA On-Demand)                          | Integrar Ollama+llama3.2:3b en modo efimero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`. Alcance: IA sin interaccion conversacional con usuarios; solo consume eventos del turno y genera resumen sugerido. |
| AI-SUMMARY-001A | Archivo | IA/Backend CRITICA     | Endpoint seguro de generacion IA on-demand (solo admin)                     | Crear `POST /api/reports/newsletter/ai-summary` con `authenticate + authorize('admin')`, validacion fuerte de payload, timeout y respuesta estructurada.                                                                                   |
| AI-SUMMARY-001B | Archivo | IA/Infra CRITICA       | Orquestador efimero de Ollama con kill garantizado                          | Implementar flujo `start -> healthcheck -> generate -> stop` in `try/finally`, con lock de concurrencia para evitar multiples arranques simultaneos.                                                                                       |
| AI-SUMMARY-001C | Archivo | IA/Seguridad ALTA      | Hardening anti prompt-injection y sanitizacion de contexto                  | Sanitizar entradas, truncar tamano, remover instrucciones maliciosas y usar prompt de sistema inmutable con formato JSON estricto.                                                                                                         |
| AI-SUMMARY-001D | Archivo | IA/Observabilidad ALTA | Auditoria tecnica sin fuga de datos sensibles                               | Auditar duracion, modelo, tokens estimados, resultado y errores; nunca persistir prompt completo ni respuesta integra sensible.                                                                                                            |
| AI-SUMMARY-001E | Archivo | IA/Frontend ALTA       | UX integrada en Boletin: `Resumen Sugerido por IA` + boton `Generar con IA` | Campo editable no bloqueante, estados loading/error/reintento, cancelacion y preservacion de edicion manual al regenerar.                                                                                                                  |
| AI-SUMMARY-001F | Archivo | IA/Operacion ALTA      | Limite de recursos y politicas de degradacion                               | Con timeout duro, memoria/CPU limites, rate-limit por usuario, fallback manual si IA falla, sin bloquear generacion de boletin.                                                                                                            |
| AI-SUMMARY-001G | Archivo | QA/Testing ALTA        | Suite de pruebas de seguridad, carga y regresion                            | Tests de exito, timeout, lock concurrente, sanitizacion, RBAC, fallback UX y no-regresion en report-generator/newsletter. |

### Listas (cerrados)

| ID | Estado | Seccion | Tarea | Notas |
| :--- | :--- | :--- | :--- | :--- |
| QA-AUDIT-LOGS-001 | listo | Auditoría / Trazabilidad ALTA | Inundación de logs basura y falta de trazabilidad en bitácoras y turnos | **HALLAZGO:** Logs redundantes de complementos y falsos positivos de `checklist.opened`/`abandoned` saturan la DB de auditoría. Además, no se audita la actualización ni eliminación de entradas y turnos. **REMEDIACIÓN:** Retrasar `checklist.opened` 3s en el cliente, omitir auditoría en `GET /active` de complementos y agregar logs de auditoría en endpoints mutables de entries y work-shifts. |
| SHIFT-DASH-146 | listo | Admin / Turnos + UX/UI CRITICA | Diseno de Dashboard de Turnos Integrado (Operacion + Administracion) | **OBJETIVO:** Definir el rediseno integral de la vista de turnos en formato "Command Center" con alta densidad de informacion... |
| QA-SERVER-DOS-001 | listo | Backend / Seguridad MEDIA | Body limit excesivo sin validación de tipo en subida de logos | **HALLAZGO:** Body size de `10mb` expuesto en `/api/config/logo` sin validar estructura. **REMEDIACIÓN:** Integrar validación temprana de cabeceras de contenido y limitar a 2MB. |
| QA-ANIM-ROUTE-001 | listo | UX-UI / Apariencia MEDIA | Transición suave en el cambio de páginas (Router-Outlet) | **HALLAZGO:** La navegación entre vistas principales es abrupta y causa parpadeos visuales en `.content-wrapper`. **REMEDIACIÓN:** Integrar animación de fade-in y slide-up (`translateY(10px)`) en `router-outlet + *` con aceleración por hardware (`will-change`). |
| QA-ANIM-OVERLAYS-002 | listo | UX-UI / Apariencia MEDIA | Animación de entrada para selectores desplegables y menús contextuales | **HALLAZGO:** Desplegables y autocompletados Material aparecen instantáneamente sin transición. **REMEDIACIÓN:** Agregar animación `@keyframes menuFadeIn` con escala y desvanecimiento (`scaleY(0.95)` a `scaleY(1)`) en los paneles de overlay. |
| QA-ANIM-DIALOG-003 | listo | UX-UI / Apariencia MEDIA | Entrada con rebote elástico para cuadros de diálogo y modales | **HALLAZGO:** La aparición de diálogos de confirmación y configuración carece de dinamismo premium. **REMEDIACIÓN:** Aplicar animación de escala con curva de rebote sutil (`cubic-bezier(0.34, 1.56, 0.64, 1)`) en `.mat-mdc-dialog-container`. |
| QA-USERLIST-INFO-001 | listo | Usuarios / Seguridad MEDIA | Exposición de información de directorio de usuarios a invitados | **HALLAZGO:** El endpoint `/api/users/list` expone datos sensibles (teléfono, email) a cualquier rol, incluyendo `guest` y `auditor`. **REMEDIACIÓN:** Restringir el retorno de campos sensibles o limitar el acceso al endpoint según el rol. |
| QA-AUTH-REFRESH-001 | listo | Auth / Seguridad ALTA | Mecanismo débil de renovación de sesión (Refresh) sin rotación | **HALLAZGO:** El endpoint `/api/auth/refresh` permite renovar el token JWT sin invalidar el token anterior ni aplicar rotación. **REMEDIACIÓN:** Implementar rotación de tokens o blacklist temporal para tokens antiguos usados para refresco. |
| QA-ENCRYPT-LOG-001 | listo | Criptografía / Seguridad ALTA | Fuga de secretos en logs de consola en caso de descifrado fallido | **HALLAZGO:** En `encryption.js` se imprime en consola un fragmento del texto descifrado (`decoded.substring(0, 20)`) si la verificación falla. **REMEDIACIÓN:** Eliminar la impresión de fragmentos del secreto en los logs. |
| QA-ENCRYPT-KEY-001 | listo | Criptografía / Seguridad CRITICA | Fallback de clave de cifrado estática en utilidad de encriptación | **HALLAZGO:** En `encryption.js` se utiliza la clave hardcodeada `'default-key-change-me!!!!!!!!'` si no hay clave de entorno o keyring. **REMEDIACIÓN:** Eliminar el fallback e impedir el arranque del servidor si no hay llave configurada. |
| QA-CODE-REDUNDANCY-001 | listo | Refactor / Código Limpio BAJA | Duplicación de lógica auxiliar en autenticación y cookies | **HALLAZGO:** La función helper `getTokenFromCookie` se encuentra duplicada textualmente en `auth.js` (rutas) y `auth.js` (middleware). **REMEDIACIÓN:** Centralizar la función en un utilitario común (`cookie-helper.js` en `utils/`) y exportarla. |
| QA-CODE-SPAGHETTI-002 | listo | Refactor / Arquitectura MEDIA | Acoplamiento de lógica de negocio y controladores en `reports.js` | **HALLAZGO:** El archivo `reports.js` posee más de 1700 líneas que mezclan definición de rutas, validaciones, lógica de negocio y plantillas de correo. **REMEDIACIÓN:** Modularizar separando los controladores en `controllers/` y la generación de HTML en `utils/email-templates-helper.js`. |
| QA-CODE-CONFIG-003 | listo | Refactor / Código Limpio BAJA | Inconsistencia y duplicación en la configuración de zona horaria | **HALLAZGO:** La zona horaria `'America/Santiago'` y su lógica de formateo están duplicadas en múltiples rutas, modelos y schedulers. **REMEDIACIÓN:** Crear un módulo de utilidades de fecha unificado (`date-utils.js`) en `utils/` y consumirlo de forma centralizada. |
| QA-REPORTS-ACCESS-001 | listo | Reportes / Seguridad MEDIA | Envío de reportes e incidentes permite uso a invitados | **HALLAZGO:** El endpoint `/api/reports/incident/send` carece de restricción de roles, permitiendo que invitados o auditores envíen correos arbitrarios. **REMEDIACIÓN:** Añadir middleware de autorización para restringir a roles operativos. |
| QA-CODE-SMTP-001 | listo | Refactor / Código Limpio BAJA | Duplicación de lógica de transporte SMTP en forgot-password | **HALLAZGO:** `/api/auth/forgot-password` recrea localmente el transporte SMTP y el descifrado en vez de usar `utils/email.js`. **REMEDIACIÓN:** Refactorizar el endpoint utilizando `sendEmail` centralizado. |
| QA-CODE-DUPLICATION-BOOLEAN-001 | listo | Refactor / Código Limpio BAJA | Duplicación de lógica de parseo de booleanos | **HALLAZGO:** Helpers idénticos (`parseBooleanLike` y `parseBooleanFlag`) se encuentran dispersos en 4 archivos distintos del backend. **REMEDIACIÓN:** Unificar en un módulo utilitario común. |
| QA-FRONTEND-REDUNDANT-REQUESTS-001 | listo | Frontend / Arquitectura BAJA | Peticiones redundantes de branding en Angular | **HALLAZGO:** Múltiples componentes llaman al endpoint de logo localmente sin caché o BehaviorSubject. **REMEDIACIÓN:** Migrar a un store de branding reactivo en `ConfigService`. |
| QA-INFRA-DOCKER-LIMITS-001 | listo | Infraestructura / Producción MEDIA | Ausencia de límites de recursos en contenedores | **HALLAZGO:** Los contenedores en docker-compose no limitan CPU/RAM, pudiendo colgar la máquina virtual host en fugas. **REMEDIACIÓN:** Configurar deploy limits en Compose. |
| QA-DB-INDEX-OPTIMIZATION-001 | listo | Base de Datos / Rendimiento ALTA | COLLSCANs severos en AuditLog y Entry por falta de índices | **HALLAZGO:** Colecciones de auditoría y bitácoras no tienen índices por fecha/evento, ralentizando las aggregaciones del dashboard. **REMEDIACIÓN:** Crear índices en campos clave de búsqueda. |
| QA-ENTRIES-NULL-CREATOR-001 | listo | Entries / Confiabilidad MEDIA | Crash de backend en actualización si createdBy es nulo | **HALLAZGO:** Validar pertenencia con `entry.createdBy.toString()` colapsará con TypeError 500 si la entrada es huérfana de creador. **REMEDIACIÓN:** Proteger validación contra nulos. |
| QA-CODE-TIME-RANGE-001 | listo | Refactor / Código Limpio BAJA | Helper de rango horario duplicado y redefinido dos veces | **HALLAZGO:** `isTimeInRange` está duplicado en rutas de turnos y checklists, y se declara dos veces en `work-shifts.js`. **REMEDIACIÓN:** Unificar en utilitarios comunes. |
| QA-REPORTS-HISTORY-AUTH | listo | Reportes / Seguridad MEDIA | Creación de historial de reportes no valida roles | **HALLAZGO:** El endpoint `POST /api/reports/history` solo requiere autenticación simple, permitiendo a invitados y auditores escribir reportes falsos. **REMEDIACIÓN:** Agregar middleware de validación de rol `authorize('admin', 'user')`. |
| QA-REPORTS-CSV-INJECTION | listo | Reportes / Seguridad MEDIA | Inyección de fórmulas CSV al exportar entradas de bitácora | **HALLAZGO:** Al exportar a CSV no se escapan caracteres iniciales (`=`, `+`, `-`, `@`), posibilitando que analistas o invitados inyecten comandos en hojas de cálculo. **REMEDIACIÓN:** Sanitizar celdas en el CSV agregando comilla simple de escape. |
| QA-NOTES-GUEST-WRITE-BLOCKED | listo | Notas / Lógica BAJA | Bloqueo de escritura en notas personales para roles de solo lectura | **HALLAZGO:** El middleware `authenticate` impide que invitados y auditores actualicen su propia nota personal (`PUT /personal`) al bloquear globalmente métodos mutadores. **REMEDIACIÓN:** Excluir `PUT /personal` del bloqueo general de solo lectura. |
| QA-USERS-PASSWORD-POLICY | listo | Usuarios / Seguridad BAJA | Inconsistencia de longitud mínima en políticas de contraseña creadas por admin | **HALLAZGO:** Mientras que `/users/me` exige mínimo 6 caracteres para nuevas contraseñas, los endpoints administrativos `/users` y `/users/:id` permiten contraseñas de cualquier longitud. **REMEDIACIÓN:** Unificar el validator de contraseña para requerir 6 caracteres mínimos globalmente. |
| QA-ENTRIES-TAGS-SUGGEST-PERF | listo | Entries / Rendimiento MEDIA | Ineficiencia de agregación en autocompletado de tags | **HALLAZGO:** `/tags/suggest` hace `$unwind` de toda la colección `Entry` antes de aplicar `$match` con regex, resultando en COLLSCANs severos en bitácoras grandes. **REMEDIACIÓN:** Filtrar con `$match` antes del `$unwind` para usar el índice multikey de `tags`. |
| QA-ENTRIES-DATE-FORMAT-CRASH | listo | Entries / Confiabilidad MEDIA | Crash de backend (HTTP 500) en listado de bitácoras por fechas inválidas | **HALLAZGO:** Si un checklist tiene fecha corrupta o nula, `toChecklistEntryLikeRecord` colapsará al llamar a `toLocaleDateString` sobre una fecha inválida. **REMEDIACIÓN:** Añadir comprobación de fecha válida con fallback seguro. |
| QA-COMPLIANCE-PRIVACY-NOTICE | listo | Compliance / UI-UX BAJA | Portal de acceso sin aviso de privacidad ni consentimiento de uso | **HALLAZGO:** La interfaz de inicio de sesión no cuenta con cláusulas de términos de uso ni aviso de privacidad. **REMEDIACIÓN:** Incluir casilla de consentimiento y link a políticas en el Login. |
| BACKUP-ENC-081 | listo | Backup / Seguridad ALTA | Cifrado opcional de backups con passphrase | **HALLAZGO:** El administrador debe poder decidir si cifra el backup al crearlo ingresando una frase secreta de forma opcional. **REMEDIACIÓN:** Se implementó cifrado simétrico AES-256-GCM con PBKDF2 para respaldos, solicitando opcionalmente passphrase en UI y descifrando en caliente en la importación/restauración. |
| QA-FRONTEND-SESSION-EXPIRATION | listo | Frontend / UX ALTA | Cierre abrupto de sesión por expiración de token sin silent-refresh | **HALLAZGO:** El frontend no implementa llamadas a `/refresh`, por lo que al expirar el JWT tras 4 horas, el analista es expulsado perdiendo su trabajo en curso. **REMEDIACIÓN:** Integrar interceptor de refresco transparente en Angular mediante `/auth/refresh` y ventana de gracia de 30 minutos en backend. |
| QA-ENTRIES-PAGINATION-001 | listo | Entries / Rendimiento ALTA | Ordenamiento y paginación en memoria heap ineficiente | **HALLAZGO:** Mezclar `Entry` y `ShiftCheck` mediante `.limit(skip + limit)` y ordenar con `.sort` en JS consume CPU y memoria heap de Node masivamente. **REMEDIACIÓN:** Se implementó una agregación nativa `$unionWith` en MongoDB para ordenar, saltar, limitar y poblar referencias de usuario en base de datos. |
| QA-INFRA-DOCKER-LOGS-001 | listo | Infraestructura / Producción ALTA | Logs ilimitados en Docker causan fuga de disco | **HALLAZGO:** `docker-compose.yml` carece de directivas de rotación de logs, arriesgando el llenado del disco del host. **REMEDIACIÓN:** Se configuró el driver de logs json-file con un límite de tamaño de 10MB y una retención máxima de 3 archivos en los contenedores del compose. |
| QA-REPORTS-PERF-001 | listo | Reportes / Rendimiento ALTA | Bloqueo de loop de eventos por envíos SMTP secuenciales | **HALLAZGO:** El envío de boletines a múltiples lotes se hace secuencialmente en un bucle blocking. **REMEDIACIÓN:** Se modificó para responder con `202 Accepted` de inmediato y procesar la cola de envíos SMTP de forma asíncrona en segundo plano con control de concurrencia. |
| QA-REPORTS-SMTP-RELAY-ABUSE | listo | Reportes / Seguridad ALTA | Abuso de SMTP Relay para envío de correos arbitrarios desde el SOC | **HALLAZGO:** `POST /newsletter/send` y `/incident/send` carecían de validación de roles y de dominios de destino, permitiendo a invitados enviar spam o phishing. **REMEDIACIÓN:** Limitar endpoints a roles operativos y restringir dominios a destinatarios válidos del SOC. |
| QA-COMPLIANCE-MFA | listo | Compliance / Seguridad ALTA | Ausencia de autenticación multifactor (MFA) por TOTP | **HALLAZGO:** El acceso al sistema no requiere MFA. **REMEDIACIÓN:** Se integró autenticación MFA por software (TOTP - RFC 6238) desactivada por defecto, activable por el administrador por usuario, con enrolamiento obligatorio (código QR) en primer login y validación en perfil/pantalla de login. |
| QA-COMPLIANCE-PII-ENCRYPTION | listo | Compliance / Privacidad ALTA | Almacenamiento de datos de contacto (PII) en texto claro con descifrado transparente | **HALLAZGO:** Correos y teléfonos se guardan en texto plano en la DB. **REMEDIACIÓN:** Cifrar campos sensibles de contacto en base de datos con AES-256-GCM y descifrar transparentemente en la API antes de enviarlos a la UI, y usar hashes deterministicos (SHA-256) para búsquedas. |

## Anexo temporal: Recomendacion de soluciones

### SHIFT-DASH-146 (Diseño de Dashboard de Turnos)

Este bloque queda asociado al diseño de referencia de SHIFT-DASH-146.

#### Propuesta visual basada en referencia (imagen ejemplo)
1. Mantener un encabezado operativo compacto con título y subtítulo en 2 líneas máximo para priorizar la tabla.
2. Ubicar el selector de semana en la esquina superior derecha con botones anterior/siguiente y rango visible en formato corto.
3. Reemplazar tarjetas separadas por una sola grilla/tabla unificada de alta densidad.
4. Mostrar cada área como fila con micro-barra lateral de color para lectura rápida de criticidad y tipo de equipo.
5. Mantener 3 columnas operativas fijas: `Categoría y turno`, `Personal de turno`, `Contacto`.
6. En `Personal de turno`, permitir 1..N personas por área usando filas internas compactas sin romper la altura general.
7. En `Contacto`, mostrar email y teléfono alineados con iconos pequeños para escaneo rápido (correo/teléfono).
8. Asegurar separadores suaves, bordes sutiles y fondos limpios para evitar ruido visual (estilo command center sobre base clara).
9. Permitir crecimiento vertical a 10+ áreas con scroll del contenedor, manteniendo header de columnas sticky.
10. Mantener coherencia cromática por área en toda la vista (misma barra en tabla, admin y drag-and-drop).

#### Recomendación de implementación UX para la sección Admin
1. Distribuir la parte administrativa en panel inferior con 3 bloques: `Áreas`, `Personal`, `Asignación visual`.
2. Bloque `Áreas`: alta rápida con nombre, color predefinido e icono, más acciones editar/eliminar por fila.
3. Bloque `Personal`: formulario reutilizable (alta/edición) con validación de email corporativo y teléfono.
4. Bloque `Asignación visual`: lista `Personal disponible` a la izquierda y destinos por área a la derecha para drag-and-drop.
5. Definir estados visuales de arrastre: disponible, arrastrando, destino válido, destino inválido, asignado.
6. Agregar pie operativo con métricas en vivo: `Total de Personal Asignado` y `Áreas Activas`.
7. El botón principal `Guardar Cambios Operativos` debe mostrar estado loading/success/error y confirmación clara.
8. En mobile, convertir drag-and-drop a flujo alternativo por selector y botón `Asignar` para no perder usabilidad táctil.
