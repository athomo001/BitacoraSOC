# Changelog

Registro de cambios relevantes del proyecto.

## [v1.5.28-beta] - 2026-04-08

### Ayuda Contextual y UX (REP-GEN-039)

#### Sistema de globos dinámicos "Top-Aligned"
- **Nueva UX Avanzada:** Se reemplazó el panel de guía estático por un sistema de ayuda contextual disparado por foco (`focus/blur`).
- **Posicionamiento Inteligente:** Se implementó una estrategia de alineación superior que coloca los globos sobre el campo, eliminando recortes en los bordes de la pantalla y la necesidad de scroll horizontal.
- **Animaciones Premium:** Integración de `anime.js` para efectos de "pop-up" suaves con aceleración por hardware (escala y traslación vertical).
- **Consistencia:** Limpieza de clases manuales y unificación del comportamiento de ayuda en los modos Reporte y Boletín.

### Docker y DevOps (DOCKER-OPT-040)

#### Optimización de Build y Concurrencia
- **BuildKit Caching:** Se asignaron identificadores únicos a los montajes de caché de npm (`npm-cache-backend` y `npm-cache-frontend`), permitiendo que ambos servicios se compilen en paralelo sin errores de colisión de archivos (`ENOTEMPTY`).
- **Imagen Base (Backend):** Se revirtió la imagen a `node:24-alpine` para restaurar la compatibilidad con los comandos `addgroup` y `adduser`, corrigiendo fallos de despliegue en Debian-slim.

### Saneamiento y Estabilidad de Compilación

#### Resolución de errores de metadatos (Build Fix)
- **Fix Angular Compiler:** Se resolvieron errores persistentes `TS2339` (Property does not exist) mediante el renombrado de métodos (`handleFieldFocus`/`handleFieldBlur`) y propiedades (`hintActiveId`) en `ReportGeneratorComponent`, forzando al compilador a invalidar cachés de metadatos corruptos.
- **Corrección de Validación (Bug Fix):** Eliminado el requisito erróneo de la sección "Resumen Ejecutivo" en el validador de boletines, permitiendo el envío exitoso cuando se dejan vacíos los campos opcionales (CVE y Referencias).

## [v1.5.27-beta] - 2026-04-07

### Boletín de Seguridad (logo/correo HTML)

#### Corrección integral de render de logo en Gmail/Outlook
- **Fix backend (newsletter MIME):** Se reforzó `POST /api/reports/newsletter/send` para preparar boletines con imagen inline robusta (`multipart/related` + `cid`) y fallback de adjunto estándar.
- **Fix backend (parser de `<img src>`):** Se reemplazó la extracción/reemplazo frágil por un escaneo seguro del primer `src` (`locateFirstImgSrcRange`, `extractFirstImgSrc`, `replaceFirstImgSrc`) para soportar `data:image` largos sin romper el HTML.
- **Fix backend (higiene de HTML):** Se agregó saneamiento defensivo para remover `<img>` inválidos cuando corresponda (`removeFirstImgTag`, `removeLeadingDataImageTags`) evitando logos rotos.
- **Fix backend (resolución de logo):** La resolución del buffer del logo prioriza el HTML generado del boletín (incluyendo base64 PNG generado en frontend) y usa `AppConfig.logoUrl` como fallback final.
- **Compatibilidad de formato:** Se dejó el flujo operativo en PNG para correos (evitando problemas de render de algunos clientes con WebP inline).

#### Validación pre-envío en frontend
- **Nuevo precheck automático:** Antes de enviar boletín, el frontend valida presencia de logo (`<img src>` no vacío/placeholder), color negro explícito en textos clave (`#111111`) y secciones mínimas requeridas.
- **Bloqueo preventivo:** Si la validación falla, el envío se detiene y se informa el motivo al usuario en UI.

#### Estilo y legibilidad del boletín
- **Fix frontend (color):** Se reforzó color de títulos y párrafos en secciones del boletín con `#111111 !important` para evitar regresiones visuales (texto verde en clientes de correo).
- **Branding frontend:** La carga de logo en el generador vuelve al flujo de conversión a PNG base64 controlado para email (no solo URL directa), preservando consistencia de render.
- **Fix frontend (pegado enriquecido, `UI-NEWS-037`):** En `/main/report-generator` (modo Boletín) se intercepta el pegado `text/html` en `Resumen Ejecutivo`, `Impacto`, `Acciones Recomendadas` y `Referencias`, normalizando a texto legible con estructura (saltos, viñetas y filas tipo `col1 | col2`) para evitar contenido “achochlonado”.

#### Observabilidad
- **Logs de newsletter permanentes:** Las trazas de diagnóstico del flujo de boletín quedaron activas de forma fija en backend (`newsletterDebug`) para auditoría operativa sin depender de flag ENV.

#### Documentación y claridad operativa
- **README actualizado:** Se añadió sección de novedades recientes (UX, boletines, seguridad y estado de IA local en preparación) para lectura rápida del estado real del producto.
- **API actualizada:** Se incorporó `POST /api/reports/newsletter/send` en `docs/API.md` con notas de comportamiento 1:1 y diagnóstico de fallos parciales.
- **Troubleshooting actualizado:** Se agregó guía específica para incidencias de pegado enriquecido en boletines (texto corrido/achochlonado), con pasos de verificación y recuperación.
- **Runbook ampliado:** Se incorporó flujo operativo diario del Boletín de Seguridad, incluyendo checklist de uso y recomendaciones de contenido.
- **Operations ampliado:** Se añadió validación funcional mínima del modo Boletín (preview, envío 1:1 y prueba de pegado enriquecido).
- **Architecture ampliado:** Se agregó diagrama de flujo actual de envío de boletines y diagrama objetivo para IA local planificada (`AI-SUMMARY-001`).
- **Security ampliado:** Se documentaron controles de seguridad requeridos para IA local en modo preparación (RBAC, ejecución efímera, timeout/kill, auditoría técnica y no fuga de datos).

### Cierre QA de issues reabiertos (2026-04-07)

#### Auditoría / Exportación (`AUDIT-EXPORT-028`)
- **Claridad de rango temporal:** Se aclaró la UX de exportación para evitar ambigüedad en "Últimos días/meses", incorporando formato explícito por `N` (`Últimos días (N días)`, `Últimos meses (N meses)`).
- **Ayuda contextual visible:** Se agregaron ejemplos directos en UI (`2, 7, 15, 30` días y `1, 3, 6, 12` meses) y etiquetas dinámicas del campo numérico según modo.
- **Reutilización de filtros activos:** Se añadió modo de exportación **Filtros actuales (incluye fechas)** para descargar respetando exactamente los filtros del formulario (búsqueda, categoría, evento, nivel y rango de fecha), además de los modos por cantidad/ventana.

#### Salud de servicios (`UI-HEALTH-033`)
- **Control por rol:** La barra/chips de salud quedó restringida solo a `admin` (frontend y backend), eliminando exposición innecesaria para otros perfiles.
- **Mejora de legibilidad:** Se separó visualmente del toolbar principal y se reforzó contraste por estado (`ok/warn/down`) con tipografía legible en todos los chips.

#### Reintentos guiados (`INT-RETRY-034`)
- **Trazabilidad de reintentos:** SMTP y GLPI ahora incluyen metadatos de reintento (`retryAttempt`, `retryCount`) tanto en llamadas de prueba como en eventos de auditoría para diferenciar intento inicial vs reintento guiado.

#### Micro-onboarding contextual (`UI-ONBOARD-035`)
- **Fix UX reportes:** Se corrigió el botón "Ver guía rápida" en `/main/report-generator` para evitar comportamiento de "botón muerto": al abrir la guía, hace scroll automático a la tarjeta de onboarding.

#### Dependencias frontend / seguridad (`DEP-NPM-012` seguimiento)
- **Remediación `npm audit`:** Se actualizaron dependencias de Angular a `20.3.18` y se aplicaron overrides de seguridad (`vite`, `picomatch`) en frontend.
- **Validación técnica:** `npm audit` reporta `0 vulnerabilities` y `npm run build` finaliza correctamente tras la actualización.

## [v1.5.26-beta] - 2026-04-05

### Generador de Reportes y Comunicación (REP-GEN-019)

#### Modo de Boletín de Seguridad
- **Feature (Frontend):** Se integró un modo dual en `/main/report-generator` mediante un selector visual que permite alternar entre "Reporte Técnico" y "Boletín de Seguridad" sin necesidad de recargar la página.
- **Flujo Simplificado:** El formulario del modo "Boletín" fue desacoplado de la dependencia obligatoria de *Log Source* y alertas por cliente, priorizando campos orientados a la comunicación ejecutiva y generalizada (Título, Criticidad, Resumen Ejecutivo, Impacto, Mitigación y Referencias).
- **Escala CVSS Integrada:** Se reemplazó el menú genérico de "Nivel de Alerta" incorporando métricas estándar de CVSS (0.1 - 10.0), mapeadas a insignias de color (Verde, Naranja, Rojo y Granate) al exportarse al portapapeles.
- **Firma Automática:** El sistema ahora captura dinámicamente el nombre o identificador del usuario en sesión activa, firmando automáticamente el boletín generado (`Generado por [Usuario]`) en reemplazo del genérico "Bitácora SOC".
- **Branding Personalizado:** Se integró la extracción automática del logo corporativo configurado en el sistema para incrustarlo directamente en el Boletín de Seguridad. Al exportar el documento, la imagen se convierte dinámicamente a Base64 previniendo bloqueos de visibilidad en clientes de correo estricto (como Outlook), presentándose en un encabezado estructural que preserva el título y subtítulo centrados mientras mantiene el logo posicionado a la izquierda.

### Administración y Catálogos

#### Ajustes Operativos y Límites Globales (B48 / B49)
- **Borrado Físico de Catálogos (B48):** Se ajustó la gestión de "Tipos de Operación" en `/main/admin/catalogs`. Además de la opción de desactivación lógica (baja), se habilitó un botón de eliminación física total (`findByIdAndDelete`), permitiendo a los administradores limpiar permanentemente registros configurados por error.
- **Límites de Validación (B49):** Se incrementó la capacidad de subida de Logos de la plataforma de 2MB a 5MB (aplicado a buffers Multer y validación de strings Base64), otorgando tolerancia para imágenes institucionales de mayor tamaño o resolución desde el módulo de Branding.


### Rate limiting y operación de sesión

#### Resolución de falsos positivos en login
- **Fix backend:** Se resolvió el issue SEC-RL-018 que causaba un falso positivo de rate limit masivo (error "DEMASIADAS PETICIONES DESDE ESTA IP").
- Se ajustó el middleware general (`apiLimiter`) para soportar sesiones gestionadas por cookies (`auth_token`), evitando que compartan el bucket restrictivo anónimo (`apiPublicMax`) según su IP de origen (NAT).
- Las rutas de bajo riesgo previas al login, como `/api/config/logo` y afines, fueron exoneradas del cálculo global global limitante.

#### Fuga de memoria y desbordamiento de red en Layout
- **Fix frontend crítico:** Se resolvió una anomalía severa en `MainLayoutComponent` que generaba un desbordamiento exponencial de temporizadores (`setInterval`) por un anidamiento lógico. Esta anomalía causaba parálisis del navegador web, miles de peticiones simultáneas por minuto al backend provocando autoexpulsiones de sesión, y desencadenaba el error "Demasiadas peticiones desde esta IP" derivado en el inicio de sesión.

## [v1.5.25-beta] - 2026-04-03

### Plataforma de complementos

#### Publicación ZIP, visibilidad y operación

- Se elevó el límite de subida de paquetes ZIP a `25 MB` en validación backend, manteniéndolo fijo en código y no en variables de entorno.
- Se incorporó flujo práctico de análisis, preview y publicación para complementos ZIP estáticos desde `Admin > Complementos`, incluyendo detección de stack permitido, configuración sugerida y publicación administrada por plataforma.
- Se generaron paquetes de prueba para QA manual (`sin BD`, `persistencia local`, `API externa`) para validar instalación, uso y borrado end-to-end.
- Se implementó refresco reactivo del menú lateral de complementos tras crear, actualizar, publicar o eliminar, evitando depender de `F5` para ver cambios.
- Se reorganizó el menú lateral para escalar mejor: grupo colapsable de historial/entradas y bloque separado de complementos con tratamiento visual propio.

#### Routing, iframe y acceso seguro

- Se corrigió el flujo de preview/publicación de complementos estáticos normalizando URLs de iframe y rutas relativas bajo `/uploads/complements/...` para que funcionen correctamente detrás de proxy/nginx.
- Se añadió proxy explícito para `/uploads` y `/uploads/complements` en frontend nginx, alineando acceso desde Docker, desarrollo local y despliegue HTTPS.
- Se protegió el acceso directo a artefactos publicados y previews: ahora `/uploads/complements/*` exige autenticación y valida permisos de visibilidad; preview queda restringido a `admin`.
- Se ajustó la política de `iframe` y cabeceras para permitir cargar complementos publicados sin dejar los artefactos expuestos públicamente por URL conocida.
- Se simplificó la vista del contenedor de complementos para reducir el efecto de “cuadro dentro de cuadro”, quitando metadata redundante (`slug · versión`) y ampliando el área útil del iframe.

#### Resiliencia y seguridad operativa

- Se corrigió el circuit breaker de complementos `zip-static`: el health-check ya no intenta sondas HTTP a un servicio inexistente y ahora valida la presencia del artefacto publicado en disco.
- Se mantuvo aislamiento visual de complementos en `OPEN`, evitando que un complemento defectuoso impacte la aplicación principal.
- Se eliminó un `docker-compose.test.yml` residual para reducir ruido operativo y simplificar la superficie de despliegue de complementos.

### Seguridad y autenticación

#### Endurecimiento adicional

- Se eliminó el uso activo de token stub en `.env`, dejando solo guía comentada para pruebas locales controladas.
- Se ajustó el guard SSRF/outbound para permitir explícitamente hosts privados solo en escenarios autorizados de complementos/desarrollo interno.
- Se añadió soporte de auditoría con `source` y `sourceId` para eventos de complementos, permitiendo filtrar por slug y enrutar mejor los eventos a observabilidad/SIEM.

### Auditoría y observabilidad

#### Trazabilidad de complementos

- Se amplió el modelo `AuditLog` con `source` y `sourceId` y se agregaron índices para consultas operativas por complemento.
- Se extendió el endpoint y la UI de auditoría para filtrar por categoría `Complementos` y por `slug` específico del complemento.
- Se documentaron y centralizaron eventos de complementos (`complement.install`, `complement.update.*`, `complement.delete.*`, `complement.wipe.*`, `complement.circuit.*`, `complement.api.*`).

### Dependencias y build

#### Hardening de supply chain

- Se actualizó `nodemailer` a `^8.0.4` para mitigar advisories de seguridad en el flujo SMTP.
- Se migró `mjml` a `5.0.0-beta.2`, eliminando la cadena vulnerable heredada de `html-minifier` y adaptando el render de reportes a API async.
- Se forzó `glob@^13.0.6` mediante `overrides`, eliminando de la instalación productiva los warnings y ramas transitorias deprecadas ligadas a `glob@10.5.0`.
- Se validó generación de reportes y empaquetado con smoke tests, además de reconstrucción Docker con `npm install --omit=dev` sin vulnerabilidades productivas reportadas.

### Rate limiting y operación de sesión

#### Ajustes de despliegue

- Se corrigió el despliegue de variables de rate limit al contenedor backend: `docker-compose.yml` ahora propaga `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_MAX_AUTH_REQUESTS` y `RATE_LIMIT_LOGIN_MAX`.
- Se hizo configurable por entorno el límite del `loginLimiter`, evitando que quedara fijo en `5` intentos al margen de la configuración operativa.
- Se normalizaron valores de preproducción para evitar bloqueos artificiales por recarga/prueba intensiva y separar mejor límites públicos, autenticados y de login.

## [v1.5.24-beta] - 2026-04-02

### Cierre de Issues Operativos

#### Infraestructura y datos
- **INFRA-MONGO-001:** Se actualizó la imagen base de MongoDB a `mongo:8` en `docker-compose.yml` y se documentó el procedimiento de migración mayor (dump, limpieza de volumen y restore) en `docs/DEPLOY.md`.

#### Integraciones
- **B19:** Se completó la integración GLPI para dos modos de operación: despacho de resumen diario y despacho inmediato para eventos críticos (`incidente` / `ofensa`).
- Se agregó persistencia de estado de último despacho (`éxito/fallo`, canal, modo, mensaje) y trazabilidad de auditoría para intentos exitosos y fallidos.

#### Auditoría y autenticación
- **AUDIT-014:** Se corrigió la atribución de actor en `auth.login.success`, enviando actor explícito en backend para evitar que el login exitoso quede como acción de sistema.
- Se ajustó el frontend de auditoría para resolver actor con fallback de metadata cuando corresponda, mejorando trazabilidad forense.
- **MAIL-AUDIT-015:** Se enriqueció la auditoría de correo (`mail.send.success/fail`) con contexto operativo (`sourceModule`, `triggerType`, `triggerContext`, `shiftId/checklistId/entryType`, `smtpConfigId`, destinatarios sanitizados y conteo resuelto), se normalizó la causa de error y se agregó control de ruido para fallos repetidos; la UI ahora muestra causa y origen de disparo de forma explícita.

#### Plataforma de complementos
- **COMP-001 a COMP-011:** Se incorporó la base productiva de complementos con modelo `Complement`, API interna `/api/internal/v1`, Application Tokens con scopes, circuit breaker por complemento, shell iframe seguro, bridge `postMessage`, logging centralizado, overlays Docker y `complement-stub` para QA/integración.

#### Backups
- **BACKUP-AUTO-016:** Se rediseñó el scheduler automático de backups con estado persistente de ejecución (`lastAutoRunAt`, `nextAutoRunAt`, estado y mensaje), verificación por vencimiento en arranque/intervalo y eventos de auditoría de ciclo automático.
- Se añadió visibilidad de estado/última/próxima ejecución automática en la UI de administración de backups.
- **BACKUP-RET-017:** Se corrigió la depuración automática de respaldos locales para incluir `backup-*.json` y `backup-*.zip`, con cálculo robusto de antigüedad y trazabilidad por archivo (`BACKUP_RETENTION_CLEANUP_STARTED`, `BACKUP_RETENTION_FILE_DELETED`, `BACKUP_RETENTION_FILE_SKIPPED`).

#### Seguridad
- **SEC-HIGH-009:** Se mitigó riesgo de Regex Injection/ReDoS en búsquedas administrativas y autocomplete, aplicando escape estricto de patrones y límites de longitud para `search/q/topic`.
- **SEC-HIGH-010:** Se incorporó guard central de destinos salientes (solo HTTPS, bloqueo loopback/red privada, validación DNS y allowlist opcional por `OUTBOUND_ALLOWLIST`) aplicado a GLPI y Log Forwarding en guardado y ejecución.
- **SEC-MED-011:** Se eliminó logging sensible residual de autenticación/reseteo reemplazándolo por trazas sanitizadas sin exponer secretos ni links de recuperación.

#### Frontend
- **B34:** Se incorporó en Administración de Checklist la configuración de alerta por ítems NOK (switch + selección de cargos objetivo), persistida en configuración global.
- Se implementó en backend el envío automático de correo al registrar checklist con estados rojos, resolviendo destinatarios por cargo activo y adjuntando detalle/observación de cada ítem NOK en el mensaje.
- **FE-SASS-013:** Se migró en login el uso de Sass de `@import` a `@use`, eliminando la ruta deprecada para compatibilidad con Dart Sass 3.
- **B46:** Se reforzó el límite de contenido de entradas en UI con `maxlength=50000` en formulario principal y diálogo de edición, más truncado defensivo en `input` y aviso explícito al llegar al tope.
- **B47:** Se mejoró legibilidad del heatmap en temas claros (`light`, `sepia`, `pastel`) ajustando tonos bajos/medio-bajos y forzando color de etiquetas internas con mayor contraste.

#### Deuda técnica backend
- **DEP-NPM-012:** Se actualizó el árbol raíz de dependencias (`jest` 30 y reemplazo de `yamljs` por `yaml`) y se validó instalación de producción (`npm install --omit=dev`) sin presencia de `inflight` ni `glob@7`.
- Queda únicamente remanente de deprecación en subárbol de desarrollo/transitivo, sin impacto en runtime productivo actual.

## Histórico Consolidado - 2026-04-01

Migración documental de cambios cerrados que estaban marcados como `Listo` en `docs/ISSUES.md` pero aún no tenían asiento explícito en este changelog. Esta sección preserva el resultado funcional conocido sin inventar una versión histórica específica retroactiva.

### Infraestructura y Seguridad Base

#### Plataforma, autenticación y hardening inicial
- **INFRA-NODE-ALL:** Upgrade completo a Node 24 LTS con imágenes `node:24-alpine`, validando compatibilidad de Mongoose 8, bcrypt, webpack Angular y arranque estable de contenedores.
- **B-CRÍTICO-001:** Corregido el flujo por el cual los correos no llegaban al cierre de checklist.
- **B5:** Se protegieron rutas críticas que antes podían alcanzarse sin autenticación.
- **SEC-CRIT-001:** Se sanitizó `/api/config` para evitar exposición de credenciales SMTP y se endurecieron endpoints sensibles.
- **SEC-CRIT-002:** Se reforzó la recuperación de contraseña para evitar fugas de token y mantener links seguros.
- **SEC-CRIT-003:** Se corrigió el refresh indefinido de JWT expirados.
- **SEC-CRIT-004:** Se completó el RBAC faltante para `guest` en endpoints críticos.
- **SEC-CRIT-005:** Se aplicaron rate limits y defensas anti brute-force en autenticación.
- **SEC-HIGH-006:** Se eliminaron credenciales por defecto débiles del flujo principal.
- **SEC-HIGH-007:** Se redujo el riesgo de robo de JWT por XSS moviendo sesión a cookie `HttpOnly` y ajustando el flujo auth.
- **SEC-HIGH-008:** Se añadió validación estricta de nombres/rutas para neutralizar path traversal en backups.

#### HTTPS y transporte seguro
- **B28:** Se simplificó la configuración HTTPS con un wizard Angular más fluido y seguro.
- **SEC-HTTPS-ALL:** Se cerró un paquete amplio de fallos TLS/HTTPS: hot-reload de certificados con SNI, validaciones criptográficas previas a guardado, aislamiento de volúmenes y CORS estricto, manteniendo `0-downtime`.

### Base de Producto y Administración

#### Mejoras funcionales y de UX
- **B6:** Refactor de contraste dark mode mediante tokens y mejoras de legibilidad.
- **B8:** Implementada edición admin de entradas con whitelist y auditoría.
- **B9:** Se incorporó soporte de checklist por tipo y turno en backend y frontend.
- **B10:** Se habilitó branding configurable de favicon desde UI y endpoints dedicados.
- **B11:** Se amplió la auditoría de correo y de acciones operativas.
- **B12:** Se implementó el huevo de pascua del login.
- **B13:** Se implementó el sistema de huevo de pascua por hashtag.
- **B15:** Ajustes de compatibilidad visual del correo HTML en clientes dark/light.
- **B16:** Se implementó la auditoría avanzada según el alcance definido en ese momento.
- **B18:** Se creó el módulo general de integraciones en consola admin.
- **B21:** Se implementaron backups automáticos y retención.
- **B25:** Se mejoró la gestión visual y operativa de Log Sources/Clientes activos vs inactivos.
- **B27:** Se consolidó la consola admin unificada.
- **P1:** Se completó el plan general de actualización a Angular 20.

### Turnos y Asignación Operativa

#### Serie inicial `OPS-ASSIGN-*`
- **OPS-ASSIGN-001:** Se integró con API el selector de usuarios en Admin Turnos.
- **OPS-ASSIGN-002:** Se creó el CRUD dedicado `work-shifts/assignments`.
- **OPS-ASSIGN-003:** Se introdujo la colección `WorkShiftAssignment` para soportar recurrencia por días.
- **OPS-ASSIGN-004:** Se implementó el cálculo de estado `EN TURNO / FUERA DE TURNO`.
- **OPS-ASSIGN-005:** Se añadió refresco en vivo con `interval(60000)`.
- **OPS-ASSIGN-006:** Se extrajo lógica común a `shift-time.util.ts` para eliminar duplicación.
- **OPS-ASSIGN-007:** Se robustecieron reglas anti-solapamiento de asignaciones en backend.
- **OPS-ASSIGN-008:** Se corrigió manejo de timezone del turno con `moment-timezone`.
- **OPS-ASSIGN-009:** Se validó compilación frontend y refactor a utilities como base de pruebas de integración.
- **OPS-ASSIGN-010:** Se corrigió la columna `Asignado a` con un resumen de tabla adaptado al modelo operativo.

### Validación Técnica
- Se verificó que los items históricos migrados desde `docs/ISSUES.md` ahora quedan representados en este changelog.
- La tabla `✅ Listas` de `docs/ISSUES.md` puede vaciarse sin perder trazabilidad documental de cambios cerrados.

## [v1.5.23-beta] - 2026-03-20

### UI/UX + Frontend (EE-BAT-001)

#### Easter Egg #bat - comportamiento multi-murcielago y suavizado de trayectoria
- **Fix frontend:** El trigger en `Nueva Entrada` mantiene deteccion exacta de `#bat` (case-insensitive) en tiempo real y ahora crea un murcielago por cada token exacto detectado en el contenido.
- **Fix frontend:** Se elimino el patron de variacion global sincronizada que provocaba reinicios visuales grupales; cada murcielago conserva estado y variacion propios.
- **Fix frontend:** Se introdujeron variantes reales de recorrido (`bat-move-1..4`) y direccion opcional invertida por instancia para reducir trayectorias clonadas.
- **Fix frontend:** Se ajusto la reaccion al cursor para evitar efecto de "teletransporte": se removio la mutacion de duracion de animacion en runtime y se mantuvieron solo micro-desplazamientos acotados.
- **Fix frontend:** Se reforzo el clamping de movimiento para evitar recortes en bordes y zona de menu lateral, manteniendo visibilidad operativa sobre la UI.
- **Mejora funcional:** Se aumento el limite maximo de instancias de murcielago de `15` a `50` y se sincronizo el texto visible del tooltip/estado en interfaz.

### Validacion Tecnica
- Se validaron `entries.component.ts`, `entries.component.html` y `entries.component.scss` sin errores de compilacion posteriores al ajuste.

## [v1.5.22-beta] - 2026-03-19

### Auditoría — Mejora de visibilidad y categorización (B46+)

#### Tabla de auditoría — Redesign compacto y categorización de acciones
- **Fix frontend:** La tabla de auditoría en `/main/audit-logs` fue rediseñada para maximizar el espacio disponible en la columna **"Razón / Tipo"** y mejorar la identificación de acciones críticas.
- **Columnas optimizadas:** Se eliminaron columnas redundantes (`event`, `ip`) y se compactaron (`timestamp`, `actor`, `level`, `username`) para liberar espacio horizontal.
- **Nueva columna "Acción":** Indicador visual 👤 (usuario) vs ⚙️ (sistema) en columna separada, permitiendo identificar al instante si fue acción manual del operador o disparada automáticamente por scheduler/integración.

#### Detección de acciones del usuario vs sistema (B46+)
- **Fix frontend:** Implementado método `isSystemAction()` que detecta automáticamente si una acción fue dispuesta por un usuario o por el sistema basándose en:
  - Presencia/ausencia del actor en el log
  - Patrón del evento (`scheduler.*`, `cron.*`, `automation.*`, etc)
- **Lógica de display:** El indicador se renderiza con icono claro y tooltip descriptivo al pasar el mouse.

#### Categorización contextual de acciones (B46+)
- **Fix frontend:** Se incorporó método `getActionType()` que clasifica cada evento en una de 8 categorías visuales:
  - 🔗 **Integración** → GLPI, Log Forwarding, etc
  - 📧 **Correo** → SMTP, envíos de email
  - 🔐 **Autenticación** → Login, logout, reset de contraseña, cambios de IP
  - 📝 **Entrada** → Crear/editar/borrar entradas en la bitácora
  - ✓ **Checklist** → Completar/modificar checklists de turno
  - 🚨 **Escalación** → Triggers de escalación de alertas
  - ⚙️ **Configuración** → Cambios en settings de administración
  - 📋 **Evento** → Otras acciones genéricas
- **Rendering:** Cada categoría se muestra como un badge coloreado independientemente en la columna "Razón", haciéndola fácil de escanear.

#### Contexto detallado por tipo de acción (B46+)
- **Fix frontend:** El método `getReasonText()` fue expandido para extraer y mostrar información contextual específica de cada tipo de evento:
  - **Correo:** `✅ [CORREO] Para: usuario@mail.com | Asunto: Reporte`
  - **Login:** `✅ [LOGIN] vía LOCAL` o `❌ [LOGIN] intento fallido`
  - **Entrada:** `✅ [ENTRADA CREAR] [INCIDENTE] | Descripción/nota`
  - **Checklist:** `✅ [CHECKLIST COMPLETADO] Checklist del Turno`
  - **Cambio de IP:** `⚠️ [CAMBIO IP] 192.168.1.1 → 200.1.1.1 (probable VPN/Proxy)`
  - **Escalación:** `✅ [ESCALACIÓN TRIGGER] Rueda N2 | Detalles adicionales`
  - **Integración:** `✅ [INTEGRACIÓN] → glpi.example.com | OK`
- **Fallback robusto:** Todos los eventos muestran un estado visual (✅ = éxito, ❌ = error, ⚠️ = alerta) seguido de la categoría en mayúsculas y detalles específicos.

#### Estilos y UX optimizados (B46+)
- **Fix frontend (SCSS):** Las columnas ahora tienen anchos explícitos y flexibles:
  - `timestamp`: 130px (compacto)
  - `actor`: 40px (solo ícono)
  - `level`: 80px (chip)
  - `username`: 140px (nombre de operador)
  - `reason`: flex 1 (ocupa todo el espacio disponible)
- **Fix frontend:** Los badges de categoría (`action-category`) son inline-block con flex-shrink: 0 para no comprimir, dejando la máxima área para el texto de razón.
- **Fix frontend:** Se agregó `line-height: 1.4` en `.reason-text` para mejorar legibilidad del contexto multilínea.
- **Fix frontend:** Los emojis se renderizan con fuente del sistema para garantizar compatibilidad en todos los navegadores.
- **Fix frontend:** Se aumentó el `max-width` del contenedor a 1600px (era 1400px) para aprovechar pantallas modernas sin comprimir información.

#### Filtros de auditoría — categorías mejoradas
- **Fix frontend:** Las opciones de filtro por categoría ahora incluyen todas las categorías nuevas (`integración`, `correo`, `autenticación`, `entrada`, `checklist`, `escalación`, `configuración`) en el selector de categoría del formulario de búsqueda.

### Validación Técnica
- Se validó correctamente la compilación de TypeScript sin errores de tipado.
- Se verificó que el método `getActionCategoryLabel()` retorna etiquetas legibles en español.
- Se testing visual de los badges de categoría con contraste correcto en temas claro/oscuro.

### Auditoría — ajuste final de legibilidad operativa (B46+)

#### Tabla de auditoría — razón visible sin cortar y tooltip útil
- **Fix frontend:** La columna **"Tipo / Razón / Detalles"** fue ajustada para priorizar lectura operativa continua, aumentando ancho mínimo, permitiendo wrap real del texto y mejorando el espaciado vertical de la descripción.
- **Fix frontend:** El tooltip dejó de depender del `json` crudo del log y ahora se alinea con el texto procesado mostrado en pantalla, evitando exponer payloads técnicos poco útiles al operador.
- **Fix frontend:** El contenedor de razón quedó preparado para mostrar textos largos sin colapsar el badge de categoría, mejorando lectura de eventos extensos como correo, escalación y entradas.

#### Tabla de auditoría — limpieza de metadata y detalle expandido
- **Fix frontend:** Se incorporó limpieza de metadata para descartar estructuras serializadas no legibles como buffers de `ObjectId` provenientes de MongoDB, manteniendo solo contexto útil para operación.
- **Fix frontend:** Se añadió vista expandible por fila para revisar el detalle completo del evento sin truncamiento, incluyendo razón completa, metadata filtrada y datos de request/actor cuando existen.
- **Resultado operativo:** El módulo de auditoría ahora permite validar con claridad si el contenido mostrado es completo o resumido, sin depender de tooltips con binarios o JSON irrelevante.

### Reporte de turno — PoC como vista previa real del turno (B47)

#### Correo PoC — vista previa con datos reales del turno seleccionado
- **Fix backend:** `sendShiftReportPoc()` dejó de enviar un correo vacío y ahora genera una **vista previa real** del correo de fin de turno usando checklist y entradas del turno correspondiente a la fecha/hora de referencia.
- **Fix backend:** La PoC reutiliza la misma lógica de cálculo de ventana temporal del envío productivo, incluyendo turnos que cruzan medianoche, búsqueda de checklist de inicio/cierre y recorte de entradas dentro del período efectivo.
- **Regla funcional:** Si el turno sigue en curso, la vista previa muestra lo acumulado hasta el momento de ejecución; si ya terminó, muestra lo registrado dentro de ese turno para la fecha evaluada.
- **Fix backend:** El bloque **"Entradas por tipo"** se mantiene visible en la PoC y se alimenta con los datos reales del período; si no hubo entradas, se muestra igualmente con contadores en cero.
- **Seguridad operativa:** La PoC no registra envío productivo ni actualiza `lastReportSentAt`, por lo que puede usarse repetidamente para validar formato, contenido y canal SMTP sin alterar el flujo real de fin de turno.

#### UI de administración de turnos — semántica corregida del botón PoC
- **Fix frontend:** Los textos del panel de administración de turnos fueron actualizados para reflejar que el botón envía una **vista previa auditada** con datos reales del turno, no una prueba vacía.
- **Fix frontend:** El mensaje de confirmación posterior al envío también fue ajustado para comunicar explícitamente que se trató de una vista previa PoC del reporte.

## [v1.5.21-beta] - 2026-03-17

### Correcciones de Bugs (B42 / B43 / B44)

#### Report Generator — nitidez de evidencia en correo (B42)
- **Fix frontend:** Se mejoró el render de imágenes de evidencia en `frontend/src/app/pages/main/report-generator/report-generator.component.ts` manteniendo intacto el formato técnico de la tabla (ancho fijo y estructura).
- Las imágenes ahora guardan dimensiones reales al cargarse y se renderizan evitando upscaling innecesario (se usa el mínimo entre ancho técnico y ancho nativo), preservando proporción.
- Cada evidencia queda enlazada a su fuente inline para permitir apertura en mayor detalle sin romper el layout del reporte copiado.

#### Reporte de turno — refactor a MJML y dashboard escaneable (B43)
- **Fix backend:** `generateReportHTML()` en `backend/src/utils/shift-report.js` fue migrado de HTML concatenado manual a plantilla MJML compilada en runtime con validación estricta.
- Se incorporó header rediseñado con branding dinámico (`appTitle`) y favicon opcional (`AppConfig.faviconUrl`).
- Se añadió sección de **Resumen Ejecutivo** con conteos visuales de `OK`, `NO OK` y `Entradas`.
- El checklist pasó de tabla plana a bloques/tarjetas por servicio con columnas visuales de Entrada/Salida para lectura rápida.
- La bitácora pasó de lista simple a bloques independientes con jerarquía visual (cabecera temporal, metadatos y contenido).
- Observaciones en checklist se muestran solo cuando existe contenido (se elimina ruido visual por campos vacíos).

#### Reporte de turno — estado REPARADO en salida (B44)
- **Fix backend (mismo módulo):** Se implementó estado `REPARADO` (amarillo) solo en columna de salida cuando se cumple: entrada `rojo` y salida `verde`.
- La comparación se limita a casos donde checklist de inicio/cierre corresponde al mismo contexto (prioridad por `checklistId`; fallback por nombre normalizado).
- Regla preservada: si salida es `rojo`, siempre se muestra `ERROR` independientemente del estado de entrada.

#### Reporte de turno — ajustes de legibilidad y consistencia operativa
- **Fix backend:** Se eliminó el símbolo `🛡️` del título del correo para evitar ruido visual en clientes de correo.
- **Fix backend:** Header del reporte ajustado a paleta clara para mejorar visibilidad del favicon/logo corporativo.
- **Fix backend:** Se aumentó spacing/padding del bloque **Resumen Ejecutivo** para evitar que quede pegado a márgenes.
- **Fix backend:** El checklist del correo ahora respeta el orden operativo original de los servicios en lugar de ordenarlos alfabéticamente.
- **Fix backend:** Se excluyen ítems padre (agrupadores) del render y del cálculo de `NO OK`, evitando conteos inflados cuando el estado rojo proviene de hijos.
- **Fix backend:** La misma exclusión de ítems padre se aplicó al fallback de texto plano para mantener consistencia con HTML.

### Operación de Turnos (B45)

#### Correo de fin de turno diferido hasta checklist de cierre real (B45)
- **Fix backend:** El trigger automático de fin de turno ahora difiere el envío cuando aún no existe checklist de cierre y registra estado `PENDIENTE_POR_CIERRE` en lugar de enviar un reporte incompleto.
- **Fix backend:** En el trigger manual (al guardar checklist de cierre), la búsqueda de cierre se extiende hasta la hora real del disparo, permitiendo cierres tardíos fuera de la hora fin del turno.
- **Fix backend:** Se reforzó la trazabilidad operativa en scheduler y ruta de checklist con estados explícitos `PENDIENTE_POR_CIERRE` y `ENVIADO_DIFERIDO`.
- **Control de duplicados:** Se mantiene protección por `lastReportSentAt` para evitar doble despacho cuando conviven trigger automático y diferido.

#### Correo de turno — resumen por tipo de entrada (Operativa / Ofensa / Incidente)
- **Fix backend:** Se agregó bloque visual **"Entradas por tipo"** bajo la sección de checklist en el correo de turno, con 3 contadores fijos: `Operativa`, `Ofensa` e `Incidente`.
- **Ajuste visual final:** El bloque superior del correo quedó consolidado como **"Resumen Checklist"** y ambos resúmenes (`Resumen Checklist` + `Entradas por tipo`) usan layout de cajones con número grande y título inferior para lectura operativa rápida.
- **Regla funcional:** No se agrega categoría "Otros"; el resumen está acotado explícitamente a los 3 tipos operativos soportados por el modelo de entradas.
- **Robustez de conteo:** Se incorporó normalización/canonización de `entryType` (case/acento/plural) para mantener conteo correcto en escenarios históricos o importados (`operativa/operativas`, `ofensa/ofensas`, `incidente/incidentes`).

#### Correo de turno — robustez de disparo en cierre y scheduler
- **Fix backend (scheduler):** El envío automático dejó de depender del minuto exacto de `endTime` y ahora utiliza una ventana de tolerancia configurable (`SHIFT_REPORT_TOLERANCE_MINUTES`, default 10 min) para evitar pérdidas de disparo por desfases operativos.
- **Fix backend (trigger por cierre):** Al guardar checklist de `cierre`, el disparo manual usa `check.createdAt` como referencia temporal del reporte (en lugar de `new Date()`), mejorando correlación con el evento real registrado.

### Operación de Turnos (OPS-ASSIGN-011)

#### Asignaciones de turno aparentaban perderse tras deploy/reinicio
- **Fix backend:** `GET /api/work-shifts/current` ahora resuelve el analista activo desde la colección real `WorkShiftAssignment` considerando turno, día efectivo, vigencia (`validFrom`/`validTo`) y zona horaria, en lugar de depender del campo legacy `assignedUserId` embebido en `WorkShift`.
- **Fix backend:** El cálculo de asignaciones activas contempla correctamente turnos que cruzan medianoche, resolviendo el weekday operativo efectivo antes de filtrar recurrencia por días.
- **Fix backend:** El payload del turno actual vuelve enriquecido con `assignedUserIds`, `assignedUsers`, `assignedUserId`, `assignedUserName`, `assignedUserEmail` y `assignedUsersCount` ya reconstruidos desde la fuente real.
- **Fix frontend:** La columna `Asignado a` en Admin Turnos dejó de ocultarse según `shift.assignedUserId` y pasó a renderizarse desde el resumen real construido con las asignaciones operativas cargadas por API.
- **Diagnóstico validado:** Se comprobó contra la base real que las asignaciones seguían persistidas tras reinicio; el problema era de lectura/resolución post-deploy, no de borrado físico de `WorkShiftAssignment`.

### Ajustes UI Operativos (Checklist / Notas / Alertas)

#### Checklist — comportamiento del acordeón principal
- **Fix frontend:** El panel principal del checklist vuelve a iniciar cerrado por defecto y solo cambia su estado cuando el usuario lo abre/cierra manualmente.
- **Fix frontend:** Se eliminó la apertura forzada al recargar/cambiar tipo de checklist para evitar comportamiento inesperado en operación.

#### Notas laterales — convivencia con trabajo operativo
- **Fix frontend:** El panel derecho de notas se mantiene visible sin bloquear interacción del contenido principal (checklist, entradas, formularios) al remover el backdrop de bloqueo en el contenedor principal.
- **Fix frontend:** Se desactivó el auto-focus agresivo del panel de notas para evitar pérdida de foco al usuario durante la edición operativa.
- **Fix frontend (escritorio):** Se ajustó el desplazamiento del contenido con notas abiertas para priorizar uso en PC y conservar mejor área útil de trabajo.
- **Fix frontend (escritorio final):** El panel de notas quedó en modo lateral `side` (comportamiento equivalente al menú izquierdo), con botón de cierre interno y recalculo automático de ancho del contenido (`autosize`) al abrir/cerrar.

#### Alerta especial de escalamiento — contraste de color
- **Fix frontend:** El diálogo de alerta especial migró de colores hardcodeados a variables del sistema de temas (`--text-primary`, `--text-secondary`, `--state-warning`, `--state-warning-bg`) para corregir contraste en modo oscuro y mantener consistencia visual en todos los temas.

### Dependencias / Compatibilidad
- **Backend:** Se agregó dependencia `mjml` en `backend/package.json` para compilación de correos compatible con clientes como Outlook/Gmail.

### Validación Técnica
- Se ejecutó validación de runtime de `generateReportHTML()` con compilación MJML exitosa (`OK_MJML`).

## [v1.5.20-beta] - 2026-03-17

### Correcciones de Bugs (B35 / B36 / B39 / B40 / B41)

#### Checklist — Estado derivado de ítems padre (B39)
- **Fix backend:** El endpoint `POST /api/checklist/check` ya no exige `observation` en nodos padre cuando su estado es `rojo` derivado de sus hijos. La validación de observación ahora aplica **solo a nodos hoja** (sin hijos definidos en la plantilla).
- **Fix frontend:** El estado de un ítem padre se deriva automáticamente desde el estado de sus hijos (rojo si alguno está en rojo, verde si todos están en verde, pendiente si alguno no ha sido respondido). El padre ya no muestra campo de estado ni observación manual.

#### Catálogo / Generador de reporte — Búsqueda de ofensas cortas (B40)
- **Fix backend:** Corregido error `Invalid $project :: caused by :: Cannot do exclusion on field _score in inclusion projection` en el pipeline de agregación de `GET /api/catalog/events`. El campo `_score` utilizado para ranking ya no se incluía explícitamente en el `$project`, causando que MongoDB rechazara la consulta al mezclar inclusión y exclusión.
- Resultado: búsquedas con términos cortos como `TOR` ahora retornan correctamente el evento rankeado como primera coincidencia.

#### Recuperación de contraseña — URL incorrecta en email (B41)
- **Fix backend:** El link de reset enviado por email usaba el valor hardcodeado `https://localhost:4200`, con protocolo y puerto incorrectos e inaccesible desde clientes reales.
- **Solución:** Creado nuevo módulo utilitario `backend/src/utils/frontend-url.js` con resolución dinámica de la URL del frontend en el siguiente orden de prioridad:
  1. Variable de entorno `FRONTEND_URL` (override explícito, opcional).
  2. Header `Origin` de la request (fuente principal — siempre contiene el host/IP/protocolo exacto desde el que el usuario accedió).
  3. Header `Referer` de la request.
  4. `HOST_DOMAIN` + detección de protocolo via `X-Forwarded-Proto` / `req.secure`.
- **Corrección automática de puerto:** Si el protocolo detectado es `https:` pero el puerto corresponde al puerto HTTP del frontend (o viceversa), el módulo corrige automáticamente al puerto correspondiente (`FRONTEND_HTTPS_PORT` / `FRONTEND_PORT`).
- La variable `FRONTEND_URL` queda comentada por defecto en `.env.example` — la detección automática via `Origin` cubre el 100% de los casos de uso normales sin configuración adicional.

#### Checklist — Header y último check real (B35)
- **Fix frontend:** El título principal de `/main/checklist` se fijó como **"Checklist del Turno"** y el nombre de la plantilla activa quedó como subtítulo contextual.
- **Fix frontend:** El panel de evaluación deja de mostrar texto hardcodeado y usa el nombre real de la plantilla activa (`activeChecklist?.name`) con fallback seguro.
- **Fix backend:** `GET /api/checklist/check/last` ahora retorna el último check global del equipo (ordenado por `createdAt`), corrigiendo el caso donde se mostraba un registro antiguo por filtrar solo por usuario autenticado.

#### Layout principal — Mejor uso de ancho en escritorio (B36)
- **Fix UI/UX:** El cajón derecho de notas cambió a `mode="over"` para evitar comprimir permanentemente el contenido principal.
- **Fix UI/UX:** Se incorporó clase dinámica `.with-notes-open` en el contenedor principal para aplicar `margin-right` solo cuando el panel de notas está abierto, evitando solapamiento visual.
- **Fix UI/UX:** Se eliminó la restricción `max-width: 900px` del checklist para aprovechar mejor pantallas grandes y mantener comportamiento responsive.

## [v1.5.19-beta] - 2026-03-11

### Reparaciones Críticas (Post-Reinicio Docker)
- **Fix SSL (B37):** Implementación de "Hot Reload" en `SNICallback`. El servidor ahora intenta recargar certificados en caliente tras un reinicio de Docker si detecta que el contexto criptográfico se ha perdido.
- **Fix API assignments (B38):** Se corrigió un conflicto de rutas que causaba un error 400 al cargar turnos. Se reordenaron las rutas en el backend y se ajustó el frontend para usar un endpoint específico `/api/work-shift-assignments`.

### Automático
- Sincronización de versión basada en iteraciones de Git (199 commits totales).

## 2026-03-10

### Interfaz / Login (Cyber v3.5 - Matrix Redesign)
- **Rediseño del Tema Cyber (Legacy Infoflow):** Se reconstruyó el tema de login inspirado en Matrix/Cyberpunk con un enfoque de **Estructura de Alto Contraste**. 
- **Estrategia de Visibilidad Nuclear:** Ante problemas de caché y herencia CSS, se implementó una estrategia de especificidad máxima (`body & .cy-* !important`) que garantiza que todo el texto sea **blanco puro (#ffffff)** o **verde neón (#00ff41)** sobre fondos **negro sólido (#000000)**, eliminando la invisibilidad de mensajes de información y errores.
- **Renombramiento de Clases (Cache-Busting):** Se migraron todos los selectores de `if-` a `cy-` para invalidar versiones antiguas del CSS en los navegadores de los usuarios finales.
- **Branding Dinámico en Login:** El título de la página de login ahora se sincroniza automáticamente con el campo "Título barra superior" de la configuración de Branding en el panel de administración.
- **Animación de "Typing":** Se añadió un efecto de escritura en tiempo real para el subtítulo del tema Cyber, mejorando la estética premium del portal.
- **Refactorización de UX Manual (Feedback Usuario):** El toggle de visibilidad de contraseña se cambió de iconos/emojis a etiquetas de texto puro (`[VER]` / `[OCULTAR]`) para mantener la coherencia con el estilo de terminal retro. Se simplificó la interfaz eliminando iconos redundantes en los campos de usuario y contraseña.
- **Selección de Texto Forzada:** Se sobreescribió el color de selección del navegador para que el resaltado sea blanco-sobre-negro dentro del portal de login.

### Backend / Configuración
- **Corrección en API de Logo/Config:** Se arregló un bug crítico en `GET /api/config/logo` que causaba que el sistema ignorara el tema guardado en la DB cuando no había un logo cargado, forzando erróneamente el tema 'CRT'.
- **Integración de AppTitle en Login:** El endpoint de configuración base ahora expone el `appTitle` para evitar llamadas redundantes al cargar el portal.

## 2026-03-06

### Infraestructura / Arquitectura (Upgrade)
- **Migración a Node 24 LTS (Cero Tiempo de Inactividad):** Se actualizó el núcleo completo del sistema. Las imágenes de Backend saltaron de `node:18` (Fin de Vida) a `node:24-alpine` con el nuevo compilador Alpine/musl-libc. El Front-end Builder saltó de `node:20` a `node:24-alpine`. Las librerías críticas en C++ (`bcryptjs`, driver nativo de `mongoose 8`) compilaron exitosamente bajo esta nueva arquitectura sin causar fugas de memoria o timeouts en MongoDB.
- **Migración a Express 5.1 LTS:** Se actualizó el framework web de `express@4.18` a `express@5.1.0`. Se corrigió la ruta wildcard del SPA fallback (`*` → `/*splat`). Se actualizó `multer` a la versión `2.1.1` (corrige CVE-2025-47935 y CVE-2025-47944 de DoS) y `helmet` a la versión `8.0.0`. No se requirió ningún otro cambio de código gracias a que el proyecto no usaba APIs deprecadas. Express 5 aporta manejo automático de errores async y mejoras de seguridad.

### Backend / Admin (Backup & Restore)
- **Backup ZIP Completo (Full System Backup):** Se rediseñó completamente el sistema de backup y restauración. El endpoint `POST /api/backup/create` ahora produce un único archivo **`.zip`** que contiene: (1) un `data.json` con las 24 colecciones de MongoDB, (2) la carpeta `/uploads` completa (logos, imágenes), y (3) los certificados SSL de `/secrets` que sean legibles. El endpoint `POST /api/backup/restore` fue actualizado para descomprimir el ZIP y restaurar tanto la base de datos como los archivos físicos. Se mantiene compatibilidad con backups `.json` legacy. Se agregaron las dependencias `archiver` y `unzipper` al `package.json`.

### Sistema / Despliegue (Factory Reset & Seed)
- **Factory Reset Profundo (Purgar Todo):** Se modificó la ruta `POST /api/backup/purge`. Ahora, además de limpiar lógicamente todas las colecciones de MongoDB, el sistema vacía físicamente los directorios montados como volúmenes Docker (`/uploads`, `/logs`, `/backups`, `/secrets`) para evitar dejar archivos huérfanos. Se mantuvo intacto el funcionamiento interno de `.wt` de MongoDB para prevenir corrupción.
- **Script Exclusivo de Admin (`seed-admin.js`):** Se creó un nuevo script de inyección (`backend/src/scripts/seed-admin.js`) diseñado para entornos de producción. A diferencia de `seed.js`, este script inicializa **únicamente** al usuario Administrador Maestro leyendo explícitamente las credenciales del `.env`, sin inyectar datos genéricos de prueba (turnos, clientes, checklists, etc.), manteniendo la base de datos totalmente limpia.
- **Actualización de Documentación (`DEPLOY.md`):** Se actualizó la guía de instalación rápida para reflejar claramente las dos opciones de inicialización de Base de Datos para los administradores: Opción de Producción (solo admin) vs Opción de Pruebas (datos genéricos).

## 2026-03-04
### Seguridad / Interfaz TLS (HTTPS)
- **Zero-Leak TLS Storage:** Los certificados SSL y llaves criptográficas ahora están estrictamente confinados en código a la subcarpeta aislada `/app/secrets`, enlazada por un volumen seguro (`docker-compose.yml`), eliminando por completo cualquier posibilidad de fuga de llaves privadas hacia las carpetas estáticas o públicas del sistema.
- **Validación Criptográfica Profunda:** En vez de análisis ingenuos (como buscar "BEGIN" en el archivo), el backend Node.js ahora emplea nativamente `tls.createSecureContext` de forma simulada *antes* de aceptar un certificado y una llave. Archivos erróneos o protegidos por contraseña son bloqueados al vuelo con código HTTP 400.
- **Hot-Reloading sin Downtime (SNICallback):** El socket maestro HTTPS adopta el `SNICallback` dinámico de Node. Al reemplazar los archivos SSL/TLS desde la UI, el backend extrae el nuevo par de llaves y reemplaza la memoria criptográfica subyacente del listener instantáneamente (menos de un milisegundo) sin necesidad de asesinar procesos OS, ni desconectar a los clientes que estén navegando concurrentemente.
- **UI Simplificada y Drag&Drop:** El formulario "HTTPS / Seguridad" consolida la habilitación SSL en una simple carga de pares de archivos (`cert`, `key` y opcionalmente `ca`), desechando la antigua modalidad riesgosa de especificar rutas manuales del servidor que requerían conocimientos de CLI.
- **Seguridad en Redirección e Interacciones Proxy:** Reforzado el switch `forceHttps` con soporte transparente para balanceadores o proxies inversos que operan por encima (`X-Forwarded-Proto`). También las fronteras de CORS encriptan la comunicación exponiendo la variable de Retry si y sólo si el TLS es seguro.
- **Auto-Reinicio Inteligente Local:** Se reemplazó el reinicio manual de comandos por un sistema de *Long Polling* en el Frontend (`start-dev.js`). El entorno de desarrollo Angular ahora consulta silenciosamente al backend cada 5 segundos y se auto-reinicia dinámicamente inyectando o removiendo el flag `--ssl` según los certificados activos.
- **Exterminador de Puertos Zombie Windows:** Se implementó una rutina de limpieza agresiva con `taskkill /pid [PID] /f /t` exclusiva para Windows en el script `start-dev.js`, garantizando que el puerto `4200` y todo el árbol de procesos huérfanos de Node/Angular se liberen al 100% durante los auto-reinicios, eliminando errores de puertos ocupados (`EADDRINUSE`).
- **Feedback UI en Vivo (Cuenta Regresiva):** Se inyectó un timer reactivo dentro de los botones de la consola "HTTPS / Seguridad". Al guardar configuración de puertos, borrar certificados o subir nuevos certificados SSL (0-Downtime), ahora la UI bloquea la pantalla y muestra una cuenta regresiva animada de 15 segundos en el propio botón antes de redirigir mágicamente al navegador hacia las rutas correspondientes (`http://` o `https://`).
- **Corrección de Condición de Carrera Asíncrona:** Se arregló un bug visual (`ERR_EMPTY_RESPONSE`) ajustando la lectura de éxito desde el frontend hacia el estado de persistencia `httpsEnabled` del Payload, ignorando el estado volátil `httpsReady` ya que la instanciación criptográfica del núcleo Node.js TLS es naturalmente asíncrona la primera vez.

### Operación / Turnos (OPS-ASSIGN)
- **Asignaciones Operativas de Turnos Granulares:** Creado nuevo módulo que permite asignar a usuarios a turnos específicos seleccionando días de la semana activos en particular (ej. Turno Noche solo los Lunes, Miércoles y Viernes).
- Añadido soporte real de Zona Horaria (`moment-timezone`) para el cálculo inteligente del turno en curso, validando la hora local del lugar configurado en vez de la del servidor (`/api/work-shifts/current`).
- Se agregó componente UI para asignar múltiples días (Lunes a Domingo) en la grilla visual de turnos.
- Implementación de estado reactivo en UI vía Observers (`interval`) para no tener que refrescar manualmente la página al evaluar si el analista entra en turno.
- Refactorizada fuertemente la gestión de turnos retirando del `WorkShift` el arreglo duro `assignedUserIds` e introduciendo el modelo `WorkShiftAssignment`.
- Adaptado el cálculo frontend de horas (`isShiftActiveNow`, `timeToMinutes`) en la utilidad centralizada `/utils/shift-time.util.ts`.
- Añadidas validaciones anti-solapamiento estrictas a nivel de backend para rechazar explícitamente cuando a un usuario se le asignan dos turnos cruzados o empalmados físicamente el mismo día.

## 2026-03-03

### Registro (16:42 - UTC 0  )
- Se consolidaron los cambios funcionales B29/B30/B31/B32/B33 en backend, frontend y documentación operativa.

### Operación / Turnos (B29-B30)
- Se agregó módulo de asignación operativa en Admin de Turnos para vincular analista ↔ turno bajo la tabla principal.
- Se implementó estado operativo en vivo (`EN TURNO` / `FUERA DE TURNO`) con evaluación de horario y soporte de cruce de medianoche.
- Se incorporó resumen por períodos en Escalación Interna: mes actual, mes anterior en acordeón e histórico bajo demanda con filtros (`fromDate`, `toDate`, `limit`) en backend/frontend.

### Escalación / Datos (B31)
- Se consolidó Escalación sobre `CatalogLogSource` como fuente única de clientes habilitados.
- Se agregó limpieza en cascada al eliminar Log Sources (servicios, contactos, reglas de escalación y entradas RACI asociadas).
- Se incluyó script de migración `migrate-escalation-clients-to-log-sources` y script npm en backend para ejecutar la migración.

### Usuarios / Segmentación (B32)
- Se extendió modelo y CRUD de usuarios con campo `cargoLabel`, validaciones, índice y soporte de cargos base + cargo personalizado.
- Se agregó rol `auditor` en validaciones y formularios administrativos.
- Se incorporó columna de cargo en listado de usuarios y exposición de cargo en `/api/users/list` para consumo en módulos operativos.

### Recordatorio Escalación Interna (B33)
- Se reemplazó el enfoque semanal complejo por recordatorio simple diario por cargos configurados.
- Se movió la configuración B33 desde Checklist Admin hacia Escalación Interna (activar recordatorio + selección múltiple de cargos).
- Se implementó envío automático por scheduler a usuarios activos con email y `cargoLabel` coincidente.
- Se agregó endpoint de prueba `POST /api/escalation/admin/reminder/test` y botón UI **Probar recordatorio** con feedback de destinatarios.
- Se aseguró visibilidad de catálogo base de cargos (N1/N2/N3, QA, Pentester, Arquitecto SIEM, CSM, Jefatura/Gerencia) aunque no existan usuarios aún en todos los cargos.

### Checklist / Configuración
- Se mantuvo Checklist Admin enfocado en parámetros de checklist (cooldown + alerta/hora) y se retiró de ahí la configuración operativa de B33.
- Se agregaron/normalizaron campos de `AppConfig` para alertas y recordatorios (`escalationReminderEnabled`, `escalationReminderCargoLabels`, `lastEscalationReminderDate`).

### Runtime Frontend / Estabilidad Dev
- Se simplificó `main.ts` para bootstrap standalone limpio y evitar cargas duplicadas de módulos en desarrollo.
- Se ajustó entorno de desarrollo a `apiUrl: '/api'` y se agregó `proxy.conf.json` para `/api` y `/uploads`.
- Se deshabilitó HMR y prebundle en `serve` para mitigar colisiones `NG0912` de IDs de componentes en runtime dev.
- Se agregó script `frontend/scripts/restart-clean.js` para reinicio limpio del puerto `4200` y se reforzó `restart-clean` en backend (validación estricta de puertos).

### Documentación / Control
- Se actualizó `ISSUES.md` marcando B30/B31/B32/B33 como listos y registrando pendientes/alcances de asignación operativa.
- Se actualizaron capturas y referencias visuales en `docs/SCREENSHOTS.md`.
- Se validó compilación de frontend posterior a los cambios de configuración y runtime.

### Registro (realizado por usuario)
- Se consolidó este bloque como cambios ejecutados por el usuario con fecha **03/03**.

### Backend / API
- Se corrigió error interno en backup automático de prueba (`POST /api/backup/test-auto`) ajustando llamadas de auditoría para evitar `500`.
- Se extendió `AppConfig` con `appTitle` para branding dinámico en barra superior.
- Se implementó configuración HTTPS en `AppConfig` (`httpsEnabled`, `forceHttps`, `httpsPort`, certificados TLS) y validación en `PUT /api/config`.
- Se agregó endpoint de carga de certificados TLS por archivo (`POST /api/config/security/certificates`) con soporte para `cert`, `key` y `ca`.
- Se actualizó `server.js` para:
	- cargar configuración HTTPS desde DB al iniciar,
	- iniciar listener HTTPS si está habilitado y con certificados válidos,
	- aplicar redirección forzada a HTTPS solo cuando HTTPS está efectivamente activo,
	- robustecer CORS en producción para transición `http/https` por host.

### Frontend / UI
- Branding:
	- se removió el título fijo lateral,
	- se agregó y conectó título configurable centrado en barra superior,
	- se separó la edición de título en sección propia dentro de Branding.
- Se incorporó fuente personalizada para el título (`Monarchia Momentum`) para todos los temas excepto `cyberpunk`, con fallback de formatos (`woff2`, `ttf`, `otf`).
- Se ajustó tipografía del título superior para mejorar legibilidad:
	- respeto exacto de mayúsculas/minúsculas ingresadas,
	- incremento de tamaño,
	- ajuste de espaciado/weight/altura de toolbar según feedback visual.
- Consola Admin:
	- se creó sección separada **HTTPS / Seguridad** (`/main/admin/security`),
	- se añadió en navegación de `AdminConsole` sin mezclar con SMTP/Branding,
	- se cambió UX de seguridad a estilo Portainer (subida de archivos SSL/TLS en vez de rutas manuales).
- Catálogos:
	- se corrigió contraste de pestañas (`Eventos`, `Log Sources / Clientes`, `Alertas Especiales`, `Tipos de Operacion`) para `light`, `sepia` y `pastel`,
	- se dejó estilo neón específico solo para `cyberpunk`.

### Docker / Deploy
- Se actualizó `docker-compose.yml` para exponer puerto HTTPS de backend y pasar `HTTPS_PORT` por entorno.
- Se actualizaron variables en `.env.example` (`BACKEND_HTTPS_PORT`, `HTTPS_PORT`) y ejemplos de `ALLOWED_ORIGINS` orientados a HTTPS real en producción.
- Se reforzó `DEPLOY.md` con flujo de HTTPS en Docker (persistencia de certificados en volumen, reinicio de backend para aplicar listener TLS y orden seguro para activar `forceHttps`).

### Documentación / Control
- Se restauró `B19` en `ISSUES.md` tras eliminación accidental y se mantuvo fuera del ajuste no solicitado.
- Se mantuvo trazabilidad de cambios con verificación de compilación frontend posterior a modificaciones.

## 2026-03-02

### Plataforma / Arquitectura
- Se consolidó la separación de módulos en Admin: Integraciones SIEM/SOAR/NDR por un lado y GLPI en módulo independiente (`/main/admin/glpi`).
- Se dejó documentado y alineado el modelo de múltiples conectores simultáneos para SIEM (`udp/tcp/tls/http`).

### Documentación
- Se reforzó en README el estado del proyecto como **BETA** y se ajustó el mensaje de uso en producción.
- Se agregó en README un bloque de versiones declaradas y exactas para Angular, Express y Mongo (Mongoose).
- Se agregó en README un resumen de estado actual con cambios recientes (Admin unificado, GLPI separado, SIEM multi-conector, backups y auditoría).
- Se removió en README una referencia redundante de documentación para evitar duplicidad.
- Se actualizó la documentación de API para reflejar endpoints vigentes de Backup, Logging (multi-config) y GLPI.
- Se actualizó la documentación de arquitectura con mapa de módulos Admin y flujo de integraciones (SIEM multi-conector + GLPI separado).
- Se actualizó SETUP con advertencia beta, checklist post-instalación y requisito de tokens en GLPI modo API.
- Se actualizó ISSUES removiendo `SEC-STD-009` de pendientes.
- Se creó este `docs/CHANGELOG.md` y se enlazó desde README para trazabilidad de cambios.

### UI / Frontend
- En Integraciones se removió la frase redundante sobre GLPI como módulo separado.
- En módulo GLPI se agregó validación para bloquear guardado en modo API cuando faltan tokens.
- Se verificó compilación del frontend posterior a los cambios de validación y documentación.

### Backend
- Se agregó validación server-side en GLPI (`PUT /api/glpi/config`) para exigir tokens en modo API.
- Se reparó `backend/src/routes/reports.js` para corregir errores de sintaxis y restaurar handlers de reportes.
- Se normalizó flujo de validación para conservar configuración segura cuando existen tokens cifrados previamente y no se reenvían en el payload.

### Operación / Estabilidad
- Se realizó saneamiento de procesos sobre puerto `3000` para eliminar listeners residuales durante pruebas.
- Se revalidó arranque del backend tras los fixes críticos de rutas de reportes.

### Verificación de historial Git (main/develop)
- Se revisó historial y diferencias de ramas para validar trazabilidad de cambios visuales y de navegación admin.
- En este repositorio local no existe rama `develop` con ese nombre exacto; las ramas observadas fueron `main`, `Development-update` y `Developmen-update`.
- Comparación directa:
	- `main..Development-update`: 1 commit adicional (`84e6e09`, "Multiples cambios").
	- `Development-update..main`: sin commits.
	- `main` y `Developmen-update`: sin diferencias.

### Historial relevante confirmado (previo)
- **Tema Cyberpunk/Neon**: ajustes de paleta/tokens, tipografías y estilos neon confirmados en `frontend/src/styles.scss` (incluido en `84e6e09`).
- **Mejoras Dark Mode**: commits previos de contraste/legibilidad detectados en historial (`da9e5d1`, `9fcf7f1`, `9a86aaa`).
- **Orden/Consola Admin**: consolidación de menú y rutas en `/main/admin` con consola unificada (`frontend/src/app/pages/main/main-layout.component.ts`, `frontend/src/app/pages/main/main.module.ts`, `frontend/src/app/pages/main/admin-console/*`) incluida en `84e6e09`.
- **Tema login estilo CRT/Cyberpunk**: registrado en historial previo (`05093c8`).


