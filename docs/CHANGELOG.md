# Changelog

Registro de cambios relevantes del proyecto.

## [v1.5.19-beta] - 2026-03-11

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


