<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

**Alcance de seguimiento:** Las filas `AI-SUMMARY-001` … `AI-SUMMARY-001G` se mantienen como **referencia** (especificación/archivo), pero **no forman parte** del backlog operativo que el equipo prioriza para iteraciones UI/QA ni de las **métricas por oleada** históricas (`UI-MIG-060` cerrado como proceso). Para trabajo vivo: obligaciones **Recurrente**, métricas §9 en `docs/UI-GOVERNANCE.md`, y nuevos `UI-*` si se abren.

### Leyenda de estados (tablas de control)

| Estado | Uso |
| --- | --- |
| **En progreso** | Issues `UI-*` con trabajo abierto. Si la tabla solo muestra el marcador de posición, no hay `UI-*` activos; usar **Listas** para cerrados y **Recurrente** para QA. |
| **Recurrente** | Política viva (cada PR); no se marca **Listo** como ticket único. |
| **Archivo** | Epic IA documentado; sin seguimiento operativo UI (ver nota de alcance). |

**Mejora continua (no son filas En progreso):** bajar `!important` global (`styles.scss`), ejecutar WCAG con herramienta por PR que toque UI (ver `docs/wcag-audit-handoff.md`), y reconteos `rg` §9 cuando cambien tokens o temas.

### En progreso

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| BACKUP-ENC-081 | En progreso | Backup / Seguridad ALTA | Cifrado opcional de backups con passphrase en crear y restaurar | Al crear un backup, el usuario podrá elegir si desea cifrarlo mediante un popup para ingresar frase secreta; no será obligatorio. Al restaurar, si el respaldo está cifrado, el sistema debe pedir la llave, validarla antes de tocar datos y continuar solo si es correcta. |

**Plan de ataque visual ejecutado:** `docs/ui-visual-remediation-plan.md` (oleadas, criterios de aceptación, rutas objetivo y Definition of Done visual).

### Recurrente (QA — cada cambio UI)

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| QA-UI-061 | Recurrente | QA + Frontend CRÍTICA | Rol QA en cada cambio UI | Obligación **en cada PR** que toque estilos. Referencia: `docs/UI-GOVERNANCE.md` §8. |
| QA-UI-062 | Recurrente | QA Visual CRÍTICA | Probar en los 5 temas lo tocado | Recurrente por cambio. `docs/UI-GOVERNANCE.md` §8. |
| QA-UI-063 | Recurrente | QA Funcional + UI ALTA | Regresión formularios tras cambios de estilo | Recurrente por cambio. `docs/UI-GOVERNANCE.md` §8. |
| QA-UI-064 | Recurrente | QA Contraste / Theming ALTA | Casos explícitos contraste/inputs | Recurrente por cambio. `docs/UI-GOVERNANCE.md` §§7–8. |
| QA-UI-065 | Recurrente | Gobernanza CRÍTICA | No omitir estándares al codificar | Política viva; `docs/UI-GOVERNANCE.md` §8. |

### Archivo IA (referencia — sin seguimiento operativo)

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| AI-SUMMARY-001 | Archivo | IA/Operación ALTA | Módulo de Resumen Ejecutivo Efímero (IA On-Demand) | Integrar Ollama+llama3.2:3b en modo efímero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`. Alcance: IA sin interacción conversacional con usuarios; solo consume eventos del turno y genera resumen sugerido. |
| AI-SUMMARY-001A | Archivo | IA/Backend CRÍTICA | Endpoint seguro de generación IA on-demand (solo admin) | Crear `POST /api/reports/newsletter/ai-summary` con `authenticate + authorize('admin')`, validación fuerte de payload, timeout y respuesta estructurada. |
| AI-SUMMARY-001B | Archivo | IA/Infra CRÍTICA | Orquestador efímero de Ollama con kill garantizado | Implementar flujo `start -> healthcheck -> generate -> stop` en `try/finally`, con lock de concurrencia para evitar múltiples arranques simultáneos. |
| AI-SUMMARY-001C | Archivo | IA/Seguridad ALTA | Hardening anti prompt-injection y sanitización de contexto | Sanitizar entradas, truncar tamaño, remover instrucciones maliciosas y usar prompt de sistema inmutable con formato JSON estricto. |
| AI-SUMMARY-001D | Archivo | IA/Observabilidad ALTA | Auditoría técnica sin fuga de datos sensibles | Auditar duración, modelo, tokens estimados, resultado y errores; nunca persistir prompt completo ni respuesta íntegra sensible. |
| AI-SUMMARY-001E | Archivo | IA/Frontend ALTA | UX integrada en Boletín: `Resumen Sugerido por IA` + botón `Generar con IA` | Campo editable no bloqueante, estados loading/error/reintento, cancelación y preservación de edición manual al regenerar. |
| AI-SUMMARY-001F | Archivo | IA/Operación ALTA | Límite de recursos y políticas de degradación | Timeout duro, memoria/CPU límites, rate-limit por usuario, fallback manual si IA falla, sin bloquear generación de boletín. |
| AI-SUMMARY-001G | Archivo | QA/Testing ALTA | Suite de pruebas de seguridad, carga y regresión | Tests de éxito, timeout, lock concurrente, sanitización, RBAC, fallback UX y no-regresión en `report-generator`/newsletter. |





### ✅ Listas

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| UI-NEWS-072 | Listo | UI/UX + Boletines ALTA | Selector rápido de destinatarios guardados en envío de boletín | En `/main/report-generator` se agregó bloque contiguo con contactos guardados por checkbox mostrando **nombre + correo + empresa**; convive con el textarea manual y ambas fuentes se combinan sin duplicados. |
| UI-ESC-073 | Listo | UX/Admin + Escalación MEDIA | Renombrar "Contactos de Clientes" a "Contactos de Escalación" | `/main/admin/escalation` ahora explicita que el módulo corresponde a escalación/turnos y separa la libreta preventiva del flujo operacional. |
| UI-DIR-074 | Listo | Admin + Backend + Email ALTA | Agenda simple de contactos generales para avisos preventivos | Se implementó agenda preventiva separada usando `contactType='preventive'` con CRUD liviano, **nombre/correo/empresa obligatorios** y **teléfono opcional**, reutilizable para boletines. |
| UI-NEWS-075 | Listo | UX/Boletines MEDIA | Filtros, favoritos y selección masiva de destinatarios | El panel del boletín ahora incluye búsqueda por nombre/correo/empresa, filtro por empresa, acciones `Seleccionar todo`, `Limpiar` y `Solo favoritos`, más contador visible de seleccionados. |
| UI-DIR-076 | Listo | Admin + Datos MEDIA | Importación y exportación CSV de agenda preventiva | La agenda preventiva permite descargar plantilla CSV, importar en lote con validación parcial segura y exportar el respaldo actual desde el admin. |
| UI-DIR-077 | Listo | Admin + Cumplimiento ALTA | Estado del contacto y exclusión de envíos | Se agregaron flags `activo`, `favorito` y `no enviar`, además de nota interna; los contactos excluidos o sin correo válido quedan claramente identificados y no participan por defecto. |
| MAIL-NEWS-078 | Listo | Email + QA MEDIA | Validación previa y resumen de destinatarios antes del envío | Antes del envío se resume cuántos destinatarios serán válidos, duplicados, inválidos o excluidos; el despacho queda operativo como **envío real 1:1** con auditoría clara. |
| UI-CHK-080 | Listo | Checklist Admin + Theming ALTA | Corregir legibilidad de plantillas/editor en dark y cyberpunk | Se reparó el layout visual de `/main/admin/checklist` en la sección **Plantillas y editor**: nombres ya no se enciman, badges usan contraste theme-aware y el acordeón/items vuelve a leerse correctamente en temas oscuros. |
| UI-TOKEN-046 | Listo | Design System ALTA | Tokens semánticos superficie/bordes (5 temas) | `frontend/src/styles/semantic-tokens.scss`: `--surface-card`, `--surface-variant`, `--outline-*`, `--text-muted`. |
| UI-TOKEN-047 | Listo | Design System ALTA | Escala spacing/radius/typography base | `:root`: `--space-*`, `--radius-*`, `--font-size-*`, `--line-height-*`, `--font-weight-*`. Migración progresiva de componentes: ver `UI-MIG-060` / `UI-DENS-054`. |
| UI-AUDIT-056 | Listo | UI/Auditoría ALTA | Colores por categoría en `audit-logs` | Tokens `--audit-cat-*` por tema; componente con `var(--audit-cat-*)`. |
| UI-HEALTH-057 | Listo | UI/Operación MEDIA | Chips de salud con tokens globales | Barra y chips usan `--state-*` y bordes semánticos (alineado al layout principal). |
| UI-GOV-058 | Listo | Gobernanza UI ALTA | Publicar guía operativa UI/QA | Entregable: `docs/UI-GOVERNANCE.md`. **No** sustituye las obligaciones **Recurrente** (QA por PR) ni la mejora continua §9. |
| UI-CHK-044 | Listo | UI/UX + Admin Checklist ALTA | Rediseño UX de `/main/admin/checklist` | Secciones 1–3, paneles `.admin-panel`, sticky, tabla recordatorios responsive + móvil apilado; **asistente** por pasos (nav + `scrollIntoView`); **una** acción primaria **Guardar plantilla** en editor (sin duplicar submit abajo). |
| UI-ARCH-045 | Listo | UI/UX Architecture CRÍTICA | Reducir nesting `card > card > card` en vistas core | Regla §3; sin `mat-card` contenedor en rutas core y oleadas 1–11 (`reports`, `all-entries`, `catalog-admin`, checklist operador, GLPI, escalamiento, complementos, turno actual, legado view/admin, etc.). |
| UI-COMP-048 | Listo | UI Componentes ALTA | Librería shared de estados (badge/chip/alert) | Entregable operativo: clases globales en `styles.scss` / §10 `UI-GOVERNANCE.md`; chips/badges Material donde aplica. Paquete Angular dedicido queda como evolución opcional. |
| UI-COLOR-049 | Listo | UI/Temas ALTA | Remover hardcode `#hex` en vistas funcionales | En `frontend/src/app/**/*.scss` solo literales en bloques de variables **CRT** / **infoflow** (`login`); el resto del color de producto vive en `styles.scss` / `semantic-tokens.scss` y `var(--*)`. |
| UI-A11Y-050 | Listo | Accesibilidad CRÍTICA | Auditoría WCAG AA en los 5 temas | Criterios y pasos en `docs/UI-GOVERNANCE.md` §7; handoff de ejecución por release/PR en `docs/wcag-audit-handoff.md`. Hallazgos y fixes en ciclo QA (**Recurrente** / §8). |
| UI-REF-051 | Listo | Frontend ALTA | Quitar estilos inline → SCSS theme-aware | Sin `style="` estático en `frontend/src/app/**/*.html`; excepciones dinámicas §11 (heatmap, selectores de color). |
| UI-MAT-052 | Listo | Frontend + Angular Material ALTA | Reducir `!important` y `::ng-deep` | `::ng-deep` **0** usos activos en SCSS de app; overrides globales Material con `!important` acotados a `styles.scss` (métrica viva §9; reducción gradual sin ticket único). |
| UI-LAYOUT-053 | Listo | UI/UX ALTA | Patrón layout estándar en páginas admin | Patrón §4 aplicado en pantallas admin migradas (incl. oleada 11). |
| UI-DENS-054 | Listo | UI/UX MEDIA | Política de densidad por breakpoint | Política §5 + escala `--space-*` en módulos objeto de la migración UI; refinar tablas densas como mejora continua. |
| UI-LOGIN-055 | Listo | UX/Branding MEDIA | Login CRT vs multi-tema del producto | CRT vía variables SCSS (`$crt-*`); infoflow con tokens; `prefers-reduced-motion` en scanlines. Opción futura: unificar CRT con `var(--*)` del documento. |
| UI-QA-059 | Listo | QA Visual ALTA | Baseline de regresión visual por tema | Rutas/temas §6; convención `docs/ui-baselines/README.md`; evidencia en PR cuando el equipo lo exija (CI opcional fuera de alcance). |
| UI-MIG-060 | Listo | Gestión de deuda ALTA | Migración por lotes con métricas de cierre | Oleadas **1–11** documentadas; comandos `rg` §9; `MatCardModule` retirado de `main.module` donde aplica; nuevas deudas bajo §9 + nuevos issues si hace falta. |
| UI-VIS-066 | Listo | UI/UX Visual CRÍTICA | Resolver errores visuales evidentes en login y layout base | Login CRT/Cyber y shell principal ajustados: jerarquía, spacing, contraste, foco y estados; build y smoke QA OK (`/health` 200, `/api/config/logo` 200, `/api/users/me` 401 esperado sin sesión). |
| UI-VIS-067 | Listo | UI/UX Consistencia ALTA | Unificar jerarquía visual entre pantallas core (`report-generator`, `checklist`, `catalogs`, `audit-logs`, `settings`) | Baseline global en `styles.scss`: `page-header`, `admin-section`, `admin-panel`, `section-card`, toolbars de acciones y densidad homogénea para pantallas operativas. |
| UI-VIS-068 | Listo | UI/Theming + Contraste ALTA | Corregir combinaciones ilegibles o "lavadas" por tema | Reajuste de contraste en login (CRT/Cyber), barra superior/salud y superficies panel; se mantiene QA recurrente por tema en cada PR posterior (`QA-UI-062`/`064`). |
| UI-VIS-069 | Listo | UX Formularios ALTA | Mejorar legibilidad y feedback en formularios largos | Inputs, etiquetas, errores y acciones primarias/secundarias mejor alineadas en baseline de paneles + refinamiento específico de login. |
| UI-VIS-070 | Listo | UX Navegación MEDIA | Reducir fricción de uso en navegación y onboarding contextual | Shell principal con título y densidad ajustada en desktop/móvil; separación visual consistente entre toolbar, health-strip y contenido operativo. |
| UI-VIS-071 | Listo | QA Visual CRÍTICA | Evidencia y baseline de la mejora visual por iteración | Se formalizó y ejecutó plan en `docs/ui-visual-remediation-plan.md` + validación técnica (build prod, lint limpio, smoke Docker). Recurrente activo para iteraciones siguientes. |
| REP-GEN-039 | Listo | UI/UX + Reportería MEDIA | Sistema de ayuda contextual dinámica con globos animados en `/main/report-generator` | Rediseñar guía rápida: eliminar panel fijo, implementar sistema dinámico "Top-Aligned" que evita recortes laterales, contenido condicional por modo y animaciones premium via anime.js. |
| UI-NEWS-042 | Listo | UI/UX + Newsletter MEDIA | Formato de campos de texto en Boletín (saltos de línea, viñetas y sangría) | Se implementó `formatNewsletterText()` en `report-generator`: convierte saltos de línea, viñetas (`-`, `*`, `•`) e indentación en divs con estilos inline email-safe, eliminando dependencia de `white-space: pre-wrap` que los clientes de correo no respetan. |
| MAIL-REM-043 | Listo | Backend / Email / Turnos / Checklist ALTA | Recordatorios por email respetando turnos laborales | Implementado: campos `shiftReminderEnabled`, `shiftReminderMinutesBefore` (5-120 min), `shiftReminderTimezone`, `shiftReminderLastSentMap` en `AppConfig`; `shiftReminderScheduler.js` con polling de 5 min, lógica de ventana con `moment-timezone`, resolución de destinatarios desde `WorkShift.assignedUserIds`, dedup por `shiftReminderLastSentMap`, email HTML con `sendEmail()`; registrado en `server.js`; UI en `/main/admin/checklist` con 3 controles condicionados al toggle. |
| MAIL-REM-079 | Listo | Email / UX + QA ALTA | Texto largo en recordatorios de turno queda limitado a 500 y puede perder formato | Corregido: límite ampliado a **5000** caracteres en frontend + backend y el correo HTML ahora preserva saltos de línea y listas, evitando que el mensaje llegue "achoclonado". |
| ESC-MAINT-042 | Listo | Backend / Frontend / Catálogos ALTA | Bloqueo por Mantenimientos Programados reutilizando Alertas Especiales | Implementado: `ruleType` (`special_alert`/`scheduled_maintenance`), `blocking`, `maintenanceTitle`, `readBy` (con dedup por `occurrenceKey`+usuario) en modelo y controlador; precedencia en evaluación; diálogo bloqueante sin "Más tarde"; banner con variante mantenimiento; tab renombrado "Alertas y Mantenimientos" con selector de tipo y badge en tabla. |
| UI-NEWS-041 | Listo | UI/UX + Newsletter MEDIA | Formato de CVEs en Boletín (saltos de línea) | Se implementó `formatCveList()` en `report-generator`: divide CVE/IDs por comas, puntos y coma o saltos de línea y renderiza uno por línea con fuente monoespaciada, reemplazando el texto continuo anterior. |
| AUDIT-EXPORT-028 | Listo | Auditoría / Operación ALTA | Descarga flexible de logs de auditoría | Verificado completo: selector de 5 modos (filtros, cantidad, días, meses, todos); `mat-hint` visible con ejemplos exactos (`2, 7, 15` días; `1, 3, 6` meses); hint contextual por modo describe la `N` al usuario. |
| UI-HEALTH-033 | Listo | UI/UX + Operación ALTA | Barra de salud visible de servicios críticos | Verificado completo: `*ngIf="isAdmin"` restringe visibilidad solo a admins; barra con `background: var(--surface-muted)` y `border-bottom` separada visualmente del toolbar; chips con colores de alto contraste (`#1f7a35`/blanco verde, `#b71c1c`/blanco rojo) y `font-weight: 600`. |
| DOCKER-OPT-040 | Listo | DevOps / Infra ALTA | Optimización de tiempos de Build y Startup de Docker | Optimización completada: Implementado aislamiento de caché npm en BuildKit (`type=cache,id=...`) para evitar colisiones `ENOTEMPTY` en builds paralelos. Restaurada compatibilidad con `node:24-alpine` en backend. |
| UI-NEWS-037 | Listo | UI/UX + Boletines MEDIA | Pegado enriquecido en campos de boletín se aplana en un bloque | En `report-generator` (modo Boletín) se agregó manejo de pegado enriquecido en textareas clave. Ahora convierte `text/html` a texto legible preservando estructura (saltos, viñetas y filas), evitando el texto "achochlonado". |
| UI-ONBOARD-036 | Listo | UI/UX + Accesibilidad ALTA | Botón "Ver guía rápida" parece enlace muerto en módulos clave | Se corrigió comportamiento en `Report Generator`, `Checklist`, `Auditoría` y `Settings SMTP`: al hacer click en "Ver guía rápida" se abre la guía y se hace scroll automático al bloque visible, eliminando percepción de enlace muerto. |
| SMTP-030 | Listo | Configuración / SMTP ALTA | Probar conexión falla si contraseña queda vacía con estado "Conectado" | Se ajustó frontend y backend para reutilizar la contraseña cifrada guardada cuando el campo password está vacío, manteniendo validación explícita cuando no existe configuración previa. |
| AUDIT-RET-029 | Listo | Auditoría / Retención ALTA | Retención máxima de logs de auditoría: 13 meses | Se estableció retención de 13 meses (TTL por defecto) y scheduler automático de limpieza con métricas (`deletedCount`, `cutoff`) y eventos auditables de éxito/fallo. |
| CATALOG-COLOR-031 | Listo | Admin / Catálogos ALTA | Mejoras en "Color del reporte copiable a correo" | Se renombró a **Colores de Reportería**, se agregó leyenda de alcance (reportes y boletines), entrada manual HEX + selector dinámico y etiqueta "(actual)" ahora refleja el color realmente activo. |
| UI-ERR-032 | Listo | UI/UX + Observabilidad ALTA | Errores accionables en interfaz (causa + siguiente paso) | Se mejoraron mensajes de error con causa probable y acción sugerida en módulos clave (SMTP, GLPI, login y exportación de auditoría), incluyendo fallback para errores no categorizados. |
| INT-RETRY-034 | Listo | Integraciones + Operación ALTA | Reintentos guiados con diagnóstico en un clic | Se implementó reintento guiado en SMTP y GLPI con panel de diagnóstico (código, causa probable, siguiente paso y detalle técnico) y acción directa de reintento en UI. |
| UI-ONBOARD-035 | Listo | UI/UX + Adopción MEDIA | Micro-onboarding contextual por módulo | Se agregaron guías rápidas contextuales en `Checklist`, `Reportes/Boletines`, `Auditoría` y `Admin SMTP`, con opción "No volver a mostrar" por usuario y acceso manual a "Ver guía rápida". |
| REP-GEN-019A | Listo | Email / Comunicación Cliente MEDIA | Sub-issue de `REP-GEN-019`: envío individual por correo desde Boletín de Seguridad | Después de generar el boletín, agregar un cajón de texto para múltiples correos y acción `Enviar` que despache un correo por destinatario (1:1), nunca un único correo con todos en copia. Debe depender del SMTP existente, registrar auditoría por destinatario y mantener fallback de copia manual. |
| REP-GEN-019 | Listo | Frontend / Comunicación Cliente ALTA | Reutilizar `/main/report-generator` para modo dual Reporte / Boletín de Seguridad | Mantener la ruta y mecánica actual del generador, agregando un selector vistoso de modo con default en `Reporte`. El modo `Boletín` debe simplificar el formulario a título/amenaza, criticidad, resumen ejecutivo, impacto, mitigación y referencias, generar salida HTML para cliente y quedar desacoplado de `Log Source` para permitir alertas transversales reutilizables con múltiples clientes por separado. |
| B48 | Listo | Admin / Catálogos | No se pueden borrar elementos en "Tipos de operacion" | En `/main/admin/catalogs` no es posible eliminar los "Tipos de operacion". Es correcto que se puedan deshabilitar, pero el sistema debe proveer también la opción para poder borrarlos definitivamente. |
| B49 | Listo | Configuración / Logo | Aumentar límite de tamaño de imagen para Logo a 5MB | En `/main/logo`, al utilizar la opción para subir la imagen del logo se debe incrementar el límite de tamaño máximo permitido del archivo de 2MB a 5MB. |
| SEC-RL-018 | Listo | Seguridad / Autenticación ALTA | Falso positivo de rate limit en login: mensaje "DEMASIADAS PETICIONES DESDE ESTA IP" sin conducta de DoS | Se actualizó `apiLimiter` para detectar identificadores de sesión por cookie (auth_token). Ahora se aplica un rate limit separado e individual usando los últimos 24 caracteres del token para autenticados, y se agregaron exclusiones para rutas estáticas como /config/logo. |
| AQL-LIB-001 | Listo | Complemento / Operación SOC ALTA | Biblioteca de Sentencias AQL (Complemento) | Nuevo complemento que centraliza sentencias AQL pre-validadas para QRadar, con catálogo por tipo, botón de copia rápida, campo de explicación, sección de Tips/Cheatsheet y CRUD admin para agregar/editar/eliminar sentencias y tips. |
| INFRA-MONGO-001 | Listo | Infraestructura / Datos CRÍTICA | Upgrade MongoDB (7 → 8) | Se actualizó `docker-compose.yml` a `mongo:8` y se documentó el procedimiento de migración mayor (dump, volumen limpio y restore) en `docs/DEPLOY.md`. |
| B19 | Listo | Integraciones | Creación de tickets en GLPI (Correo / API) | Se implementó despacho GLPI para resumen diario e inmediato (incidente/ofensa), con reintentos, estado persistente y auditoría de éxito/fallo. |
| DEP-NPM-012 | Listo | Deuda Técnica / Backend MEDIA | Dependencias npm deprecadas en build Docker (`glob`/`inflight`) | Se actualizó árbol raíz (`jest` 30, reemplazo `yamljs` por `yaml`) y se validó que en instalación de producción (`--omit=dev`) no aparece `inflight` ni `glob@7`; remanente deprecado queda solo en subárbol dev/transitivo. |
| FE-SASS-013 | Listo | Deuda Técnica / Frontend MEDIA | Migrar `@import` Sass a `@use/@forward` en login | Migración aplicada en login (`@import` → `@use`) para compatibilidad con Dart Sass 3. |
| AUDIT-014 | Listo | Auditoría / Backend+Frontend ALTA | Login exitoso no muestra actor real en Auditoría | Se corrigió la atribución de actor en `auth.login.success` (backend) y el fallback de renderizado en auditoría (frontend). |
| BACKUP-AUTO-016 | Listo | Backup / Operación ALTA | Backup automático no se ejecuta según intervalo configurado | Scheduler rediseñado con estado persistente (`last/next run`), verificación por vencimiento al inicio/intervalo, trazabilidad de eventos automáticos y visualización de estado en UI. |
| BACKUP-RET-017 | Listo | Backup / Operación ALTA | Retención de backups no elimina archivos al superar 7 días | Se corrigió cleanup de retención para respaldos locales `backup-*.json` y `backup-*.zip`, usando criterio robusto de antigüedad y trazabilidad explícita de inicio/eliminado/omitido por archivo. |
| SEC-HIGH-009 | Listo | Seguridad ALTA | Riesgo de Regex Injection / ReDoS en búsquedas de catálogo y tags (NoSQL) | Se saneó construcción de regex con escape en búsquedas de catálogo/tags/RACI y se agregaron límites de tamaño de input (`search/q/topic`) y clamp de paginación para evitar patrones costosos. |
| SEC-HIGH-010 | Listo | Seguridad ALTA | OWASP A10 SSRF: URLs salientes configurables sin allowlist en integraciones | Se implementó guard central de URLs salientes (solo HTTPS, bloqueo loopback/red privada, validación DNS y `OUTBOUND_ALLOWLIST` opcional) aplicado a GLPI y Log Forwarding en configuración y runtime. |
| SEC-MED-011 | Listo | Seguridad MEDIA | OWASP A09/A02: Logging sensible en autenticación (username + estado de password) | Se eliminó exposición de datos sensibles en logs de autenticación y se reemplazó logging de enlace de reseteo por mensaje sanitizado sin secretos. |
| MAIL-AUDIT-015 | Listo | Email / Observabilidad ALTA | Error `❌ [CORREO] Para: sin destinatarios` sin contexto diagnóstico | Se enriqueció la auditoría de `mail.send.success/fail` con `sourceModule`, `triggerType`, `triggerContext`, `shiftId/checklistId/entryType`, `smtpConfigId`, `resolvedRecipientsCount` y preview sanitizado; además se normalizó causa de fallo y se aplicó control de ruido (deduplicación/re-log periódico) para errores repetidos. La UI ahora muestra contexto operativo y causa explícita. |
| COMP-001 | Listo | Arquitectura / Complementos ALTA | Persistencia Aislada, Wipe Out y Auditoría Forense | Se implementó `Complement`, DB privada `bitacora_ext_*`, wipe-out de 4 fases, purge por `ownerComplementId` y eventos `complement.wipe.*`. |
| COMP-002 | Listo | API / Complementos ALTA | Contrato de API Interna (Microservicio-Bitácora) | Se creó `/api/internal/v1/*` con Application Token, scopes, colecciones autorizadas y propagación de `X-Request-Id`. |
| COMP-003 | Listo | UI / Complementos ALTA | Slot Dinámico en UI (N1 y Admin) | Se agregó shell iframe con `sandbox`, menú dinámico y consola admin de complementos. |
| COMP-004 | Listo | Resiliencia / Complementos ALTA | Circuit Breaker para Microservicios | Se añadió health-check periódico y estados `CLOSED/OPEN/HALF_OPEN` con aislamiento visual y rechazo `503` en API interna. |
| COMP-005 | Listo | Seguridad / Complementos ALTA | Application Token y Scopes Granulares | Se implementó `COMPLEMENT_TOKEN_SECRET`, hash SHA-256 del token activo, regeneración y revocación por borrado. |
| COMP-006 | Listo | Arquitectura / Contratos ALTA | Shared Types & Contracts (Esquema JSON Compartido) | Se creó `shared/schemas/` y validación backend con `ajv`, más modelo TypeScript para frontend. |
| COMP-007 | Listo | Frontend / Estado ALTA | Bus de Eventos para State Sync (Core ↔ Iframe) | Se implementó `ComplementBridgeService` con validación de `origin`, `REQUEST_CONTEXT` y sincronización de turno/tema/checklist. |
| COMP-008 | Listo | DevOps / Infraestructura ALTA | Orquestación Docker y Redes Aisladas | Se agregó overlay `docker-compose.complements.yml` y red `bitacora-complements`; el antiguo `docker-compose.test.yml` quedó deprecado y fue eliminado. |
| COMP-009 | Listo | Observabilidad / Complementos ALTA | Logging Centralizado de Microservicios | Los complementos ya publican a `/api/internal/v1/log`, centralizado en `AuditLog` con `source='complement'` y filtro por slug. |
| COMP-010 | Listo | API / Versionamiento MEDIA | Versionamiento de API Interna (Compatibilidad) | Se estructuró la API interna en `v1` y `v2`, con discovery en `/api/internal/versions` y headers de versión. |
| COMP-011 | Listo | Testing / Complementos MEDIA | Mocks de Complementos para Pruebas de Integración | Se creó `tools/complement-stub/` y el overlay de testing para simular health, iframe y cleanup. |
| MAIL-NEWS-082 | Listo | Email + UX + Compatibilidad ALTA | Boletín copiado manualmente al correo pierde layout frente al envío directo | Se reescribió completamente `buildNewsletterHtml()` usando SOLO tablas anidadas (sin divs, h1-h6, spans con display, border-radius) para máxima compatibilidad cross-client. Cada sección (header, título, badges, contenido, evidencias, footer) es ahora una fila de tabla con celdas y tablas internas. Se eliminaron propiedades problemáticas para Outlook/Gmail (margin en elementos anidados, display inline-block, border-radius). El HTML resultante funciona correctamente tanto al copiar/pegar manualmente como al enviar por SMTP. Se implementó campo opcional de evidencias con imágenes (validación tipo/tamaño max 5MB, resize automático 500px, compresión JPEG 85%), renderizadas como tablas. Sección evidencias solo aparece si hay imágenes cargadas. **Corrección URLs rotas:** Se corrigió bug donde URLs largas se enviaban con espacios entre caracteres alfanuméricos (`61f428a2fc` → `61 f 428 a 2 fc`). Implementadas funciones `formatNewsletterReferences()` para convertir URLs en links clicables preservados y protección de URLs en `applyNewsletterPasteHeuristics()` mediante extracción temporal con placeholders. |
| B34 | Listo | Operación/Alertas | Alerta por ítems NOK (Rojo) en Checklist | Se agregó configuración global para alertas NOK (`alertNokEnabled`, `alertNokRoleTarget`) y envío automático de correo por checklist con rojos a usuarios activos del cargo seleccionado, incluyendo detalle de observación por ítem NOK. |
| B46 | Listo | UI/UX + Seguridad Preventiva / Frontend MEDIA | Textarea de entradas permite escribir más de 50000 caracteres | Se aplicó `maxlength=50000` en creación y edición, truncado defensivo por `input` y aviso explícito al alcanzar el máximo. |
| B47 | Listo | UI/UX + Accesibilidad / Frontend MEDIA | Heatmap en temas light/sepia/pastel no muestra bien el número de entradas | **Causa raíz**: `ngx-charts-heat-map` v23 NO renderiza texto dentro de las celdas (solo tooltip). Se reemplazó por heatmap HTML/CSS propio con grid de `div`, color por celda según escala 5-niveles desde CSS vars, y contraste de texto dinámico por luminancia (oscuro para celdas claras, blanco para oscuras). Se corrigieron también los tokens `--heatmap-label-color` de sepia/pastel que eran blancos sobre fondo claro. |

Los items marcados como `Listo` deben quedar reflejados en `docs/CHANGELOG.md` como fuente de historial.
---

## [UI/UX] Deuda visual global: "cuadrados dentro de cuadrados" y consistencia multi-tema

**Prioridad:** Alta  
**Estado:** Cerrado a nivel tabla de control — los `UI-*` de esta ola pasaron a **Listas** (CHK-044 … MIG-060); mejora continua vía **Recurrente** (`QA-UI-061`–`065`), §9 métricas y `docs/wcag-audit-handoff.md`. **Sin incluir** el epic IA `AI-SUMMARY-*` (**Archivo IA**). Ver `docs/UI-GOVERNANCE.md`.  
**Tipo:** UX/UI Architecture  
**Scope:** Frontend completo (Angular + temas)

### Problema observado

La interfaz presenta un patron repetido de contencion visual excesiva:

- card principal
- cards internas
- bloques internos con borde + fondo + sombra

Esto genera una experiencia tosca y recargada. Aunque el branding y los temas funcionan, la jerarquia visual depende demasiado de cajas y poco de tipografia, espaciado y ritmo visual.

En resumen: hay buena base de tema, pero falta un **sistema de layout y jerarquia** para evitar "box-in-box-in-box".

### Impacto

1. Fatiga visual en pantallas operativas de uso diario.
2. Menor legibilidad y escaneo de informacion critica.
3. Inconsistencia entre modulos (cada vista resuelve distinto).
4. Mayor costo de mantenimiento para cada tema.
5. Mayor riesgo de errores de contraste en overrides locales.

### Rol QA y pruebas obligatorias (regresión visual y funcional)

Todo lo descrito en esta sección y en los issues `UI-*` / `QA-UI-*` **debe probarse** al implementarse. Los cambios de CSS, tokens o estructura de layout suelen introducir:

- aspectos visuales raros o incoherentes entre módulos;
- errores aparentes en campos (errores ilegibles, mismos colores que el fondo);
- **fondo oscuro con letras oscuras** (o claro con texto claro) por tokens incompletos o hardcode;
- **cajas de texto** (`input`, `textarea`, Material outline) cuyo fondo o borde **no acompaña al tema** mientras el resto de la página sí cambia;
- regresiones solo visibles en **un** tema (p. ej. sepia o cyberpunk).

**Regla:** no se marca trabajo como terminado sin pasar la matriz de temas y el checklist de formularios/contraste (`docs/UI-GOVERNANCE.md` **§8**, equivalente a `QA-UI-061`–`065`; contraste detallado **§7**). Las buenas prácticas de verificación multi-tema y accesibilidad **no se omiten** al escribir código de interfaz; ahí es donde más se concentran los fallos.

### Evidencia (muestras representativas)

- Uso extensivo de contenedores visuales y overrides globales: `frontend/src/styles.scss`
- Estructura con multiples bloques visuales y estilos inline:  
  `frontend/src/app/pages/main/report-generator/report-generator.component.html`  
  `frontend/src/app/pages/main/report-generator/report-generator.component.scss`
- Patrones de badge/estado duplicados por modulo:  
  `frontend/src/app/pages/main/checklist-admin/checklist-admin.component.scss`  
  `frontend/src/app/pages/main/catalog-admin/catalog-admin.component.scss`
- Chips/estados hardcodeados no semanticos:  
  `frontend/src/app/pages/main/main-layout.component.scss`
- Paletas locales por categoria y tokens no definidos:  
  `frontend/src/app/pages/main/audit-logs/audit-logs.component.scss`
- Tema/pantalla visualmente aislada del sistema global:  
  `frontend/src/app/pages/login/login.component.scss`

### Causas raiz

1. Jerarquia visual basada en bordes/fondos, no en contenido.
2. Falta de reglas de contencion por nivel (cuantos niveles de caja permitir).
3. Tokens semanticos incompletos (surface variants, outline variants, etc).
4. Uso de hardcode (`#hex`) en vistas funcionales.
5. Dependencia alta de `!important` y `::ng-deep`.

### Mejores practicas a aplicar (multi-tema)

1. **Maximo 2 niveles visuales por pantalla**
   - Nivel A: superficie de pagina.
   - Nivel B: bloque funcional.
   - Evitar Nivel C como otra card salvo excepciones justificadas (dialogs, estados criticos).

2. **Jerarquia por tipografia + espacio, no por mas cajas**
   - Encabezados claros (`title`, `section-title`, `label`).
   - Espaciado consistente (escala 8px).
   - Separar secciones con ritmo vertical antes que con bordes repetidos.

3. **Una sola pista visual por bloque**
   - Usar solo una de estas por nivel: borde, fondo o sombra.
   - Evitar combinar las 3 simultaneamente.

4. **Tokens semanticos obligatorios para todos los temas**
   - `--surface-base`, `--surface-raised`, `--surface-subtle`, `--surface-card`, `--surface-variant`
   - `--outline-subtle`, `--outline-strong`, `--outline-variant`
   - `--text-primary`, `--text-secondary`, `--text-muted`
   - `--state-success|warning|error|info` + fondos asociados

5. **Estados reutilizables, no por pantalla**
   - Componente base para `badge/chip/alert/status-pill`.
   - Misma semantica visual en checklist, catalogos, reportes, auditoria.

6. **Accesibilidad de contraste por tema (WCAG AA)**
   - Texto normal >= 4.5:1
   - Texto grande >= 3:1
   - Validar especialmente textos secundarios y badges.

7. **Densidad y forma global**
   - Radius fijo por escala (`sm/md/lg`).
   - Elevacion limitada (`0/1/2`) para evitar ruido.
   - Padding/gaps sistematizados (`space-1..space-6`).

### Plan de implementacion propuesto

#### Fase 1 - Estabilizacion visual (Quick wins)
- Definir tokens faltantes usados por componentes actuales.
- Mover estilos inline a SCSS en vistas criticas.
- Reemplazar hardcoded de color en estados y superficies principales.

#### Fase 2 - Arquitectura visual comun
- Crear capa de design tokens de spacing/radius/typography.
- Definir reglas de contencion (max 2 niveles visuales).
- Estandarizar estructura de pagina: header, bloque principal, secciones internas limpias.

#### Fase 3 - Componentizacion de estados
- Crear componentes o clases utilitarias shared para badge/chip/alert/status.
- Migrar modulos de mayor deuda: report-generator, checklist-admin, catalog-admin, audit-logs.

#### Fase 4 - Calidad continua multi-tema
- Checklist de contraste por tema en PR.
- Lint de estilos para bloquear hex hardcode fuera de tokens.
- Baseline visual por tema para detectar regresiones.
- **QA manual obligatorio** según `QA-UI-061`–`QA-UI-065` para cada PR que toque estilos o tokens.

### Checklist de criterios de aceptacion

1. Ninguna pantalla critica supera 2 niveles de contencion visual.
2. Se elimina al menos 80% de estilos inline en modulos prioritarios.
3. Estados visuales (success/warning/error/info) son consistentes en todas las vistas auditadas.
4. No se introducen colores hardcode en componentes funcionales nuevos.
5. Contraste AA validado en tema light/dark/sepia/pastel/cyberpunk para texto y estados.
6. Se reduce significativamente el uso de `!important`/`::ng-deep` en vistas priorizadas.
7. **Prueba en los cinco temas** en las rutas afectadas; sin excepciones por “cambio pequeño”.
8. **Formularios y mensajes de validacion** legibles en todos los temas; sin inputs “fantasma” (fondo/texto que no refleja el tema activo).
9. Evidencia en PR (checklist marcado o nota breve) de que se cumplieron `QA-UI-062`–`QA-UI-064`.

### Sub-issues recomendados

- `UI-BOX-01` Reducir nesting de contenedores en `report-generator`.
- `UI-BOX-02` Reducir nesting de contenedores en `checklist-admin`.
- `UI-BOX-03` Reducir nesting de contenedores en `catalog-admin`.
- `UI-TOKEN-01` Completar tokens semanticos de superficies y bordes para todos los temas.
- `UI-TOKEN-02` Introducir escala de spacing/radius/typography global.
- `UI-STATE-01` Libreria shared de badges/chips/alerts theme-aware.
- `UI-A11Y-01` Auditoria de contraste multi-tema con correcciones.
- `UI-CSS-01` Politica anti-hardcode y reduccion progresiva de `::ng-deep`.
- `QA-UI-061`–`QA-UI-065` Rol QA, matriz 5 temas, regresión de formularios, checklist contraste/inputs, gobernanza al codificar.


## BACKUP-ENC-081 - Cifrado opcional de backups con passphrase

**Estado:** En progreso  
**Prioridad:** ALTA  
**Tipo:** Backup / Seguridad

### Objetivo

Permitir cifrado opcional de backups mediante passphrase, sin volverlo obligatorio. Al restaurar un backup cifrado, el sistema debe solicitar y validar la clave antes de ejecutar cualquier operación destructiva.

### Criterios de aceptación

1. **Crear backup sin volverlo obligatorio:** en la UI de `/main/backup`, al pulsar crear respaldo, ofrecer un popup/modal opcional para activar cifrado e ingresar una frase secreta; si el usuario no la ingresa, el backup se genera como hoy, sin cifrar.
2. **UX de cifrado clara:** el modal debe pedir frase + confirmación, mostrar advertencia de que la llave no debe perderse y permitir cancelar sin bloquear la creación de un backup normal.
3. **Cifrado fuerte y metadata explícita:** el archivo debe quedar marcado como cifrado en sus metadatos y usar un esquema robusto de derivación + cifrado moderno; la frase no debe guardarse en texto plano ni persistirse en auditoría.
4. **Restauración segura:** al intentar restaurar un backup cifrado, el sistema debe detectarlo, abrir popup para ingresar la llave y validar primero si es correcta antes de iniciar cualquier restore destructivo.
5. **Respuesta ante llave incorrecta:** si la llave no coincide, el sistema debe rechazar la restauración con mensaje claro, registrar intento fallido y no modificar datos.
6. **Compatibilidad hacia atrás:** backups existentes no cifrados deben seguir restaurando normalmente sin pedir clave.
7. **Criterio de cierre:** el usuario puede crear un backup cifrado opcionalmente, descargarlo, y luego restaurarlo solo si proporciona la llave correcta; con llave errónea no se ejecuta ninguna restauración.

---

## AI-SUMMARY-001 - Resumen Ejecutivo Efímero (IA On-Demand)

**Estado:** Archivo IA (referencia — sin seguimiento operativo)  
**Prioridad:** ALTA  
**Tipo:** IA/Operación

### Objetivo

Integrar Ollama+llama3.2:3b en modo efímero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`. Alcance: IA sin interacción conversacional con usuarios; solo consume eventos del turno y genera resumen sugerido.

### Sub-issues

Consultar tabla **Archivo IA** en la sección de **Tablas de Control** para ver todos los sub-issues de este epic (AI-SUMMARY-001A hasta AI-SUMMARY-001G).
