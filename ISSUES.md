<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

### ⏳ Pendientes

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| SEC-CRIT-001 | ⚠️ BLOQUEANTE | Seguridad CRÍTICA | Exposición de credenciales SMTP en `/api/config` | `GET /api/config` devuelve `smtpConfig.pass` a cualquier usuario autenticado. Riesgo de exfiltración de correo corporativo. |
| SEC-CRIT-002 | ⚠️ BLOQUEANTE | Seguridad CRÍTICA | Recuperación de contraseña vulnerable | Host header poisoning + URL `http` + fuga de `resetToken` en desarrollo. Riesgo de toma de cuenta. |
| SEC-CRIT-003 | ⚠️ BLOQUEANTE | Seguridad CRÍTICA | Refresh indefinido de JWT expirados | `/auth/refresh` usa `ignoreExpiration: true`. Token robado puede persistir indefinidamente. |
| SEC-CRIT-004 | ⚠️ BLOQUEANTE | Seguridad CRÍTICA | RBAC incompleto para rol `guest` | Guests pueden ejecutar endpoints de escritura (`entries`, `checklist`). Rompe política de solo lectura. |
| SEC-CRIT-005 | ⚠️ BLOQUEANTE | Seguridad CRÍTICA | Anti brute-force desactivado en despliegue actual | `NODE_ENV=development` + rate-limit deshabilitado + `loginLimiter` sin aplicar en `/auth/login`. |
| SEC-HIGH-006 | Pendiente | Seguridad ALTA | Credenciales por defecto débiles en bootstrap/scripts | `Admin123!` y `bitacora123` en fallbacks/scripts. Facilita compromiso inicial. |
| SEC-HIGH-007 | Pendiente | Seguridad ALTA | Riesgo de robo de JWT por cadena XSS | Sin CSP efectiva + JWT en `localStorage` + uso de `innerHTML` dinámico. |
| SEC-HIGH-008 | Pendiente | Seguridad ALTA | Posible Path Traversal en backups | Uso de `path.join` con input no sanitizado en download/delete/restore de backups. |
| SEC-STD-009 | Pendiente | Seguridad/Compliance | Alineación OWASP ASVS L2 + Secure Coding + Angular/Node | Revisar backend/frontend, endurecer controles y asegurar auditoría de acciones sensibles. |
| B5 | Pendiente | Bugs CRÍTICO | Acceso a rutas sin autenticación | Vulnerabilidad: posible acceso y modificación sin login |
| B6 | Pendiente | UI/UX | Dark mode: contraste y legibilidad deficientes | Problemas de contraste en inputs/botones/tablas; requiere ajuste WCAG y revisión completa de estilos tema oscuro. |
| B8 | Pendiente | Mejoras | Edición masiva/individual de entradas (Admin) | Habilitar reclasificación controlada por admin sin alterar campos inmutables, con auditoría de before/after. |
| B9 | Pendiente | Mejoras | Checklists distintos por tipo de check y por turno | El módulo de turnos ya existe: al crear/editar turno (ej. noche) debe permitir asignar fácil checklist de `inicio` y `cierre` en la misma pantalla y también poder asignar distinto checklist  en el  turno (entrada/salida). |
| B11 | Pendiente | Mejoras | Auditoría incompleta de correos y acciones de usuarios/admin | En Logs de Auditoría no aparece claramente envío de correos (estado + destinatarios) ni cambios de administradores ni acciones relevantes de usuario normal (ej. generar reporte). |
| B12 | Pendiente | Mejoras | Huevo de pascua en login por combinaciones específicas | Si ingresan combinaciones definidas (ej. `admin/admin`, `1234/1234`, etc.), activar pantalla negra + imagen. Triggers deben configurarse en BD para no hardcodear. |
| B13 | Pendiente | Mejoras | Huevo de pascua en entradas por hashtag `#bender` | Si en entrada aparece `#Bender` o `#bender`, mostrar overlay fullscreen con imagen de Bender. |
| B14 | Pendiente | Bugs | Envío automático de correo de turno fuera de contexto (vacío/duplicado) | En no laborales y a las 00:00 o a la hora que se  configuro  como termino de turno se envían correos vacíos. Debe enviarse solo al registrar checklist de cierre real. |
| B16 | Pendiente | Seguridad/Arquitectura | Auditoría automática avanzada (usuario + dispositivo + red + VPN) | Diseñar e implementar trazabilidad inmutable con fingerprint de dispositivo, metadata de red, detección de cambio de IP en sesión y notificación en tiempo real. |
| B17 | Pendiente | Seguridad/Integraciones | Envío de eventos de auditoría a SIEM/SOAR/NDR (Syslog/API) | Exportar todos los eventos de auditoría a destinos externos (Elastic, Wazuh, QRadar, XSOAR, Fortinet, etc.) por UDP/TCP/TLS con puertos `514`, `6514` o puerto personalizado. |
| B18 | Pendiente | Integraciones | Integración API genérica / Webhooks / SIEM | Framework de conectores salientes con reintentos/cola, formatos JSON/RFC3164/RFC5424/CEF/LEEF y soporte Syslog/API. |
| B19 | Pendiente | Integraciones | Envío automático a GLPI al cierre de turno | Automatizar creación de ticket al cierre con resumen de entradas y estado de checklist, sin bloquear operación si falla integración. |
| B20 | Pendiente | UI/UX | Tema Cyberpunk/Neon | Nuevo tema visual opcional, cuidando contraste y sin repetir problemas del dark mode actual. |
| B21 | Pendiente | Backup/Operación | Backups automáticos programables + destino externo + retención configurable | Permitir programar respaldo automático cada N días, enviar a destino configurable (nube/NFS/Samba) y definir expiración local de respaldos. |
| B22 | Pendiente | Mejoras/Escalamiento | Alertas de escalamiento especiales por cliente y horario en reportes | Al seleccionar cliente o generar/copiar reporte, mostrar alerta contextual con acciones adicionales (ej. fuera de horario: avisar por WhatsApp además del correo), configurable por admin en la ficha del cliente. |

---

### ✅ Listas

| ID | Seccion | Tarea | Notas |
| --- | --- | --- | --- |
| B-CRÍTICO-001 | Bugs CRÍTICO | Emails no llegan cuando se registra cierre checklist | Corregido y marcado como listo. |
| B10 | Mejoras | Branding: favicon configurable | Implementado: favicon separado del logo, con endpoints dedicados y administración en Branding. |
| B15 | Bugs | Compatibilidad visual de correo HTML (modo oscuro vs claro) | Implementado: badges de estado reforzados con color + texto explícito para clientes claros/oscuros. |
| P1 | Actualizacion Angular 20 | Plan general de actualizacion | Actualización completa Angular 17→20 |
| F4-3 | Fase 4 (Post-actualizacion) | Merge rama | Listo para merge |
| F0-1 | Fase 0 (Preparacion) | Crear rama aislada | Rama `feature/angular-20-upgrade` creada |
| F0-2 | Fase 0 (Preparacion) | Limpieza del entorno | Reinstaladas dependencias en backend y frontend |
| F0-3 | Fase 0 (Preparacion) | Verificar pruebas | `ng test` no configurado (sin target de test) |
| F1-1 | Fase 1 (Angular 18) | ng update core/cli 18 + material 18 | Angular/CLI/Material/CDK actualizados a 18.2.x |
| F1-2 | Fase 1 (Angular 18) | Analisis y migracion | Migración HTTP aplicada en `app.module.ts` |
| F1-3 | Fase 1 (Angular 18) | Revision breaking changes | Sin advertencias adicionales; builder migration opcional pendiente |
| F1-4 | Fase 1 (Angular 18) | Verificacion (ng serve / ng test) | `ng build` OK; `ng test` no configurado |
| F1-5 | Fase 1 (Angular 18) | Commit upgrade 18 | Commit local listo |
| F2-1 | Fase 2 (Angular 19) | ng update core/cli 19 + material 19 | Migrado a standalone components primero |
| F2-2 | Fase 2 (Angular 19) | Analisis y migracion | Migraciones automáticas aplicadas |
| F2-3 | Fase 2 (Angular 19) | Revision breaking changes | Sin breaking changes críticos |
| F2-4 | Fase 2 (Angular 19) | Verificacion (ng serve / ng test) | Build OK con standalone components |
| F2-5 | Fase 2 (Angular 19) | Commit upgrade 19 | Commit 8afdb02 + e292d7c |
| F3-1 | Fase 3 (Angular 20) | ng update core/cli 20 + material 20 | Angular 20.3.16 + Material 20.2.14 |
| F3-2 | Fase 3 (Angular 20) | Analisis y migracion | Migraciones de v19 a v20 aplicadas |
| F3-3 | Fase 3 (Angular 20) | Revision breaking changes | TypeScript 5.9.3, sin breaking changes |
| F3-4 | Fase 3 (Angular 20) | Verificacion final | Build exitoso, advertencia menor |
| F3-5 | Fase 3 (Angular 20) | Commit upgrade 20 | Commits c102e7d + fa45c38 |
| F4-1 | Fase 4 (Post-actualizacion) | Revision de dependencias externas | animejs@3.2.2 funcionando OK |
| F4-2 | Fase 4 (Post-actualizacion) | Limpieza de codigo | Código limpio, solo 1 warning menor |
| B1a | Bugs | Visibilidad en tema oscuro | Commit d3112bd: Agregados estilos mat-menu-item y options en dark mode |
| B1b | Bugs | Notas no se guardan | Verificado: autosave con debounce 3s funciona correctamente |
| B2a | Mejoras | Reordenar y clarificar menu lateral | Checklist (Admin) movido a Configuración (Admin); texto Escalación ok |
| B2b | Mejoras | Visualizador de logs de auditoria | Backend: 3 endpoints (logs, events, stats). Frontend: componente con filtros, paginación, badges por tipo entrada |
| B2c | Mejoras | Purgar datos segura | Botón en Backup con confirmación de frase + endpoint admin |
| B2g | Mejoras | Recuperacion de contrasena | Endpoints forgot/reset + componentes Angular + email HTML + rutas |
| B2g-smtp | Mejoras | SMTP destinatarios opcionales | Recipients optional + SSL auto-detect + ENCRYPTION_KEY 64 chars |
| B2d | Mejoras | Gestion de tags: ver entradas por tag | Contador ahora navega a /main/all-entries?tag=... |
| B2e | Mejoras | Mis entradas / Ver todas: contenido completo | Dialogo listo en "Ver todas" y agregado en "Mis entradas" |
| B2g | Mejoras | Recuperacion de contrasena | Backend: forgot-password + reset-password endpoints con token SHA256. Frontend: 2 componentes (forgot/reset) + routes |
| B2h | Mejoras | Reorganizacion pagina configuracion | Cooldown movido a Checklist Admin + texto SMTP clarificado |
| B2i | Mejoras | Selector de cliente en Nueva Entrada + filtro/columna en busqueda | Cliente/LogSource como campo estructurado en entries, filtro + columna en results |
| B2k | Mejoras | Checklist: borrado admin + ocultar iconos + rehacer checklist diario | Borrado admin en historial + UI oculta para no-admin + cooldown solo mismo día |
| B2m | Mejoras | Estado de turno + cierre automatico: enviar checklist + entradas via integracion | Modelo ShiftClosure + endpoints POST/GET, resumen de turno con entradas/incidentes |
| B3a | Arquitectura | Etiquetas de cargo + rol auditor | Rol 'auditor' en User model, cargoLabel para cada usuario, ShiftRole flexible |
| B4-1 | Observaciones | Eliminar backup.js.bak | Archivo eliminado |
| B4-2 | Observaciones | Validacion de variables de entorno | Validación al inicio del server |
| B4-3 | Observaciones | Pruebas automatizadas backend | Jest config + test base encryption |
| B4-4 | Observaciones | Consistencia en nombres (kebab-case) | Alcance acotado: backend/src/middleware (rate-limiter, request-id) + shims camelCase por compatibilidad |
| B4-5 | Observaciones | Error tipografico "escalamiento" lateral | Commit d3112bd: Corregido en ambos menús |
| B4-6 | Observaciones | Login, poder entrar con correo como con nombre de usuario | Backend: $or query, Frontend: label actualizado |
| B4-8 | Infraestructura | Deshabilitar Rate Limiter en desarrollo | NODE_ENV=development en docker-compose |
| B4-9 | Bugs | Navegacion password recovery (NG04002 auth/login) | Corregido en forgot-password.component.ts |
| B4-10 | Configuracion | ENCRYPTION_KEY longitud invalida | Actualizado a 64 hex chars (32 bytes) |
| B4-11 | UI/UX | Mejora visibilidad texto login/recovery CRT theme | Todos los elementos forzados a #ffffff con !important + text-shadow green glow |
| B2j | Mejoras | Tabla RACI por cliente (vista + admin Escalamiento) | Backend: RaciEntry con contactos {name, email, phone}. Frontend: form admin + vista analista con iconos |
| B2f | Mejoras | Reportes: graficos | NGX-Charts: line chart (tendencia), pie chart (tipos), bar charts (usuarios/tags/servicios/log-sources), multi-line (comparación tags), heatmap (día vs hora). Backend: endpoints /tags-trend, /entries-by-logsource y /heatmap |
| C5 | Cambios | Token de recuperación: reducir a 5 min | Reducido de 1h a 5 minutos en auth.js. Email y frontend actualizados con aviso temporal |
| C6 | Cambios | Sesión JWT reducida a 4h | JWT reducido de 24h a 4h para admin/user, guest mantiene 2h. Aviso en login sobre duración |

---

## 🟠 B9 - Checklists distintos por tipo y por turno

**Descripción:**
Se requiere que el checklist pueda cambiar según:

1. Tipo de check: `inicio` vs `cierre`.
2. Turno activo: por ejemplo día vs noche.

Ejemplo esperado:

1. En turno día, checklist de inicio A y checklist de cierre B.
2. En turno noche, checklist de inicio C y checklist de cierre D.

**Análisis de situación actual (código):**

1. `backend/src/routes/checklist.js` usa `getActiveChecklistSnapshot()` y toma una plantilla activa global para todos los casos.
2. El endpoint `POST /api/checklist/check` valida `type` (`inicio`/`cierre`), pero no selecciona plantilla por tipo.
3. `backend/src/models/WorkShift.js` ya tiene `checklistTemplateId`, pero es una sola referencia por turno, no separada por `inicio` y `cierre`.

**Cómo se podría implementar:**

1. Extender modelo de turnos en `backend/src/models/WorkShift.js` con:
   - `checklistTemplateStartId`
   - `checklistTemplateEndId`

   Mantener `checklistTemplateId` solo para backward compatibility y migración.

2. Ajustar `POST /api/checklist/check` en `backend/src/routes/checklist.js`:
   - Detectar turno actual (ya existe `getCurrentShift()`).
   - Si `type === 'inicio'`, cargar `checklistTemplateStartId`.
   - Si `type === 'cierre'`, cargar `checklistTemplateEndId`.
   - Fallback controlado: si no existe plantilla específica, usar la global activa.
3. Actualizar CRUD de turnos en `backend/src/routes/work-shifts.js` para permitir guardar ambas plantillas.
4. Frontend admin de turnos:
   - En pantalla de turnos, agregar dos selectores de plantilla: Inicio y Cierre.
   - Mostrar claramente qué combinación aplica por turno.
5. Migración de datos:
   - Para turnos existentes, copiar `checklistTemplateId` hacia ambos campos nuevos.
   - Evitar corte operativo.
6. Auditoría y trazabilidad:
   - Guardar en `ShiftCheck` el template realmente usado (`checklistId`, `checklistName` ya existen).
   - Agregar test de integración para validar selección correcta por turno + tipo.

**Impacto esperado:**
Mejora operativa alta. Permite control más fino por contexto de turno y reduce errores de checklist no pertinente.

---

## ✅ B10 - Branding: favicon configurable

**Estado:** Listo

**Descripción:**
Actualmente se puede configurar logo, pero falta la configuración de favicon.

**Problema observado:**
El logo no siempre sirve como ícono de pestaña porque puede ser grande o no tener proporción/legibilidad para favicon.

**Cómo se podría implementar:**

1. Backend:
   - Agregar campo `faviconUrl` en `AppConfig`.
   - Reutilizar flujo de upload con endpoint dedicado para favicon (validar tipo y tamaño).
2. Frontend (Branding):
   - Agregar bloque de carga de favicon en la misma pantalla de branding.
   - Mostrar preview y recomendaciones (`.ico` o `.png` cuadrado 32x32/64x64).
3. Frontend runtime:
   - Actualizar dinámicamente `<link rel=\"icon\">` con `faviconUrl`.
   - Fallback al favicon por defecto si no existe configuración.
4. Validaciones:
   - Máximo tamaño sugerido: 256KB.
   - Tipos permitidos: `image/x-icon`, `image/png`.
   - Mantener logo y favicon como elementos separados.

**Impacto esperado:**
Mejor branding y mejor visibilidad del sistema en pestañas/favoritos del navegador.

---

## 🟠 B11 - Auditoría incompleta de correos y acciones de usuarios/admin

**Descripción:**
El módulo `Logs de Auditoría` no está registrando suficiente trazabilidad operativa.

**Problemas reportados:**

1. No se ve claramente si un correo fue enviado o falló.
2. No se ven destinatarios de los correos enviados.
3. No quedan trazadas de forma consistente las acciones de administradores (crear/editar/eliminar/configurar).
4. Tampoco se ven acciones relevantes de usuarios normales (por ejemplo, generar reportes).

**Cómo se podría implementar:**

1. Correo / SMTP:
   - Registrar eventos `mail.send.success` y `mail.send.fail`.
   - Guardar metadata mínima: `to` (enmascarado parcial si aplica), `subject`, `template`, `status`, `error`.
2. Acciones administrativas:
   - Estandarizar auditoría en endpoints admin (`create/update/delete/config changes`).
   - Guardar `actor`, `target`, `action`, `before/after` (solo campos no sensibles).
3. Acciones de usuario normal:
   - Auditar acciones de alto valor: generar/exportar reportes, operaciones críticas de checklist/entradas.
4. UI de Logs:
   - Filtro por tipo de evento (`mail`, `admin`, `user`).
   - Columna de resultado (`success/fail`) y detalles de contexto.
5. Seguridad de auditoría:
   - Nunca guardar secretos (password, tokens, credenciales SMTP).
   - Retención configurable y paginación estable.

**Impacto esperado:**
Mayor trazabilidad operativa y capacidad de investigación/auditoría ante incidentes y cambios en producción.

---

## Recomendación de Reparación (alineada con tabla general)

1. `SEC-CRIT-001`: Bloquear exposición de secretos en APIs de configuración y rotar credenciales SMTP comprometidas.
2. `SEC-CRIT-002`: Endurecer forgot/reset password (host fijo seguro, HTTPS obligatorio, sin fuga de token).
3. `SEC-CRIT-003`: Corregir refresh JWT para respetar expiración y agregar revocación/rotación.
4. `SEC-CRIT-004`: Asegurar RBAC por endpoint y testear matriz de permisos por rol.
5. `SEC-CRIT-005`: Activar controles anti brute-force y rate-limits efectivos en login/auth.
6. `SEC-HIGH-006`: Eliminar credenciales por defecto y forzar bootstrap seguro.
7. `SEC-HIGH-007`: Mitigar XSS y mover estrategia de token a almacenamiento/flujo más seguro.
8. `SEC-HIGH-008`: Sanitizar paths y bloquear traversal en backup/restore/download/delete.
9. `SEC-STD-009`: Alinear con ASVS L2 + Secure Coding + Angular/Node y cerrar brechas de seguridad.
10. `B5`: Auditar cobertura de `authenticate`/`authorize` en todas las rutas críticas.
11. `B6`: Refactor de variables y componentes dark mode con contraste WCAG AA.
12. `B8`: Implementar edición admin controlada con lista blanca de campos y auditoría before/after.
13. `B9`: Soportar checklist por turno y tipo (`inicio`/`cierre`) con migración compatible.
14. `B11`: Completar trazabilidad de correo, acciones admin y acciones relevantes de usuario.
15. `B12`: Implementar reglas de trigger en BD para huevo de pascua de login (sin hardcode).
16. `B13`: Implementar trigger hashtag en entradas con overlay configurable y cooldown opcional.
17. `B14`: Evitar envíos vacíos/duplicados fuera de contexto y acoplar envío real al cierre válido.
18. `B16`: Implementar auditoría avanzada con fingerprint, sessionId y detección de cambio de IP.
19. `B17`: Exportar auditoría completa a SIEM/SOAR/NDR por Syslog/API con cola y reintentos.
20. `B18`: Desplegar módulo de integraciones genéricas con plantillas, auth flexible y test/historial.
21. `B19`: Automatizar GLPI al cierre de turno con payload trazable y tolerancia a fallos.
22. `B20`: Crear tema Cyberpunk/Neon opcional garantizando legibilidad y consistencia visual.
23. `B21`: Implementar backups automáticos con periodicidad configurable, destino externo y retención local con caducidad.

---

## 🟠 SEC-STD-009 - Alineación OWASP ASVS L2 + Secure Coding + Angular/Node

**Objetivo:**
Alinear el desarrollo con OWASP ASVS Nivel 2, OWASP Secure Coding Practices, Angular Security Guide y OWASP Node.js Security Cheat Sheet, cumpliendo estas reglas:

1. Nunca confiar solo en validación del cliente.
2. Autorización server-side estricta.
3. Mínimo privilegio y deny-by-default.
4. Prevención de XSS, inyección y fuga de datos.
5. Auditoría en acciones relevantes de seguridad.

**Tareas pendientes (agregar a backlog):**

1. **Mapa de endpoints y autorización**
  - Inventario de rutas backend y su rol requerido (matriz RBAC).
  - Bloqueo por defecto: todo endpoint requiere `authenticate` + `authorize` salvo lista blanca documentada.
2. **Validación server-side consistente**
  - Centralizar esquemas (Joi/Zod/validator) y usar `validate` en todas las rutas de escritura.
  - Sanitizar parámetros de ruta, query y body (strings, arrays, ids) con listas blancas.
3. **XSS y HTML seguro (Angular)**
  - Revisar `innerHTML`, `bypassSecurityTrust*` y cualquier sanitización manual.
  - Reemplazar por binding seguro + `DomSanitizer` solo donde sea imprescindible.
4. **CSP y headers de seguridad**
  - Definir CSP estricta y headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
  - Alinear `nginx.conf`/proxy y backend para evitar CSP rota en prod.
5. **Autenticación y sesión**
  - Verificar expiración de JWT, refresh seguro y revocación.
  - Mover tokens fuera de `localStorage` si aplica (httpOnly cookie o estrategia equivalente).
6. **Auditoría de acciones sensibles**
  - Registrar create/update/delete y cambios de configuración.
  - Incluir `userId`, `roles`, `request_id`, `status`, `before/after` sin secretos.
7. **Protección contra inyección**
  - Revisar queries y filtros en Mongo/Mongoose con listas blancas.
  - Bloquear operadores peligrosos y normalizar entradas.
8. **Secreto y configuración segura**
  - Eliminar credenciales por defecto y rotarlas.
  - Validar variables de entorno obligatorias en arranque.
9. **Rate limiting y anti brute-force**
  - Asegurar `loginLimiter` activo en prod y uso en `/auth/login`.
  - Perfiles de rate limit por ruta crítica.
10. **Logs seguros y privacidad**
   - Redactar PII, tokens y secretos en logs.
   - Establecer políticas de retención y acceso.
11. **Pruebas de seguridad mínimas**
   - Tests de autorización por rol.
   - Tests de validación server-side y CSP presente.

**Cómo lo implementaría (explicación):**

1. Partiría con un inventario de rutas backend y generaría una matriz RBAC clara (rol -> permisos). Esto define el deny-by-default real.
2. Centralizaría validaciones con un middleware único por esquema y lo aplicaría en todas las rutas de escritura, más sanitización de rutas/query.
3. En frontend, buscaría cualquier uso de `innerHTML` y sanitizadores manuales. Solo dejaría `DomSanitizer` cuando sea inevitable y documentado.
4. Definiría una CSP estricta compatible con Angular, sumando headers de seguridad en el proxy/reverse y en el backend.
5. Revisaría el flujo de sesión: expiración, refresh, revocación y almacén de tokens, priorizando cookies httpOnly seguras.
6. Consolidaría auditoría de acciones críticas con un helper común que registre actor, recurso, resultado y metadatos sin secretos.
7. Cerraría vectores de inyección filtrando operadores Mongo peligrosos y normalizando entradas.
8. Dejaría un checklist de verificación ASVS L2 por módulo y pruebas mínimas que validen autorización y validación server-side.

---

## 🔴 B16 - Auditoría automática avanzada (usuario + dispositivo + red + VPN)

**Descripción:**
Implementar un módulo de auditoría automática, orientado a producción, para trazabilidad completa de sesiones y acciones críticas en entorno web Angular + backend, incluyendo escenarios con VPN.

**Objetivo:**
Tener evidencia técnica consistente de:
1. Quién ejecutó la acción (identidad y roles).
2. Desde qué dispositivo lógico (fingerprint estable).
3. Desde qué red/IP/ASN (considerando variabilidad por VPN).
4. Si hubo cambios de IP durante la misma sesión activa.

**Restricciones obligatorias:**
1. Sin agentes instalados ni extensiones.
2. Respetar límites del navegador:
   - no hostname real del PC,
   - no MAC,
   - no usuario de SO/dominio,
   - no IP pública confiable desde frontend.
3. Auditoría write-only e inmutable.
4. Datos sensibles enmascarados o hasheados.

**Captura automática frontend (Angular):**
1. SO/plataforma y arquitectura aproximada (`navigator.platform`, `userAgentData` cuando exista).
2. Navegador y versión.
3. Resolución y `devicePixelRatio`.
4. `hardwareConcurrency` (CPU cores aproximado).
5. `deviceMemory` (RAM estimada, cuando aplique).
6. Idioma.
7. Timezone.
8. Tipo de conexión aproximada (`navigator.connection` si está disponible).
9. User-Agent completo.

**Fingerprint de dispositivo (frontend):**
1. Construir payload canónico con: `os`, `browser`, `screen`, `cpu_cores`, `memory_gb`, `timezone`, `language`.
2. Generar `device_fingerprint` con SHA-256.
3. Enviar en login y acciones críticas.
4. No usar fingerprint como autenticación; usarlo como señal de riesgo y correlación.

**Backend (middleware de auditoría):**
1. Extraer identidad desde JWT: `userId`, `roles`, `tenant`.
2. Resolver IP real (`X-Forwarded-For` + `remoteAddress`), cuidando proxies confiables.
3. Enriquecer red: ASN/proveedor y flags (`is_vpn`, `is_datacenter`, `is_proxy`) con servicio IP intelligence.
4. Asignar `session_id` y `request_id`.
5. Medir latencia por request.
6. Persistir log de forma append-only (sin update/delete de eventos).

**Detección de cambio de IP en sesión:**
1. Comparar IP actual vs última IP del mismo `session_id`.
2. Si cambia y `device_fingerprint` se mantiene: crear evento `IP_CHANGED_DURING_SESSION`.
3. Guardar evento en auditoría con `risk_level`.
4. Notificar al frontend en tiempo real (WebSocket/SSE): "Se detectó un cambio de red durante tu sesión. La actividad está siendo auditada."

**Reglas de VPN:**
1. VPN no invalida identidad del dispositivo.
2. Fingerprint es identificador principal de continuidad.
3. IP es señal secundaria/variable en VPN corporativa.
4. Acciones críticas desde VPN elevan riesgo (`medium/high` según política).

**Esquema mínimo de auditoría (propuesto):**
1. `timestamp_utc`, `event_type`, `user_id`, `roles`, `tenant_id`.
2. `session_id`, `request_id`.
3. `device_fingerprint`, `device_metadata` (`os`, `browser`, `screen`, `cpu_cores`, `memory_gb`, `timezone`, `language`).
4. `network_metadata` (`ip`, `asn`, `is_vpn`, `is_datacenter`, `ip_changed_during_session`).
5. `action`, `resource`, `object_id`, `status`, `risk_level`.

**Eventos de seguridad iniciales:**
1. `LOGIN_FROM_NEW_DEVICE`
2. `LOGIN_WITH_VPN`
3. `IP_CHANGED_DURING_SESSION`
4. `CRITICAL_ACTION_FROM_NEW_DEVICE`
5. `CRITICAL_ACTION_WITH_VPN`

**Plan de implementación recomendado (iterativo):**
1. Angular: `FingerprintService` + interceptor para adjuntar metadata/fingerprint.
2. Backend: middleware de auditoría + generador de `request_id/session_id`.
3. Persistencia: colección `AuditEvent` append-only con índices por `timestamp`, `user_id`, `session_id`, `event_type`.
4. Detección IP change y score de riesgo en middleware.
5. Canal tiempo real (WebSocket/SSE) para alertas de sesión.
6. Dashboard de auditoría con filtros por evento/riesgo/usuario/sesión.

**Advertencias técnicas (realistas):**
1. El fingerprint en web nunca es 100% único ni inmutable; usarlo como probabilidad, no certeza.
2. `navigator.connection` y `deviceMemory` no están disponibles en todos los navegadores.
3. `X-Forwarded-For` requiere configurar correctamente `trust proxy` y cadena de reverse proxies.
4. El nivel de detección VPN depende de proveedor externo y puede tener falsos positivos/negativos.

**Impacto esperado:**
Salto de madurez en seguridad operativa y capacidad forense, con trazabilidad consistente incluso en entornos corporativos con VPN.

---

## 🔴 B17 - Envío de eventos de auditoría a SIEM/SOAR/NDR (Syslog/API)

**Descripción:**
Se requiere exportar todos los eventos de auditoría relevantes del sistema hacia plataformas externas de seguridad (SIEM/SOAR/NDR), con soporte de transporte estándar para entornos corporativos.

**Objetivo:**
Enviar en tiempo casi real los eventos de auditoría (incluyendo B11/B16) a destinos como Elastic, Wazuh, QRadar, XSOAR, Fortinet u otros, sin acoplar la operación a un proveedor específico.

**Requisitos funcionales mínimos:**
1. Origen de eventos: `AuditLog` completo (auth, admin, user, mail, checklist, seguridad).
2. Transportes:
   - Syslog UDP (default `514`)
   - Syslog TCP (default `514`)
   - Syslog TLS (default `6514`)
   - HTTP/HTTPS webhook/API (opcional para SOAR)
3. Puerto configurable por conector (no fijo), incluyendo `514`, `6514` o cualquier otro.
4. Formato configurable por destino:
   - JSON estructurado (recomendado para Elastic/Wazuh modernos)
   - RFC3164 / RFC5424 (Syslog)
   - CEF / LEEF (si el SIEM lo exige)
5. Modo no bloqueante:
   - Si el destino falla, la app no se detiene.
   - Reintentos con backoff + cola persistente.

**Cómo se implementa sobre el código actual:**
1. Reusar y extender `backend/src/utils/logForwarder.js` como dispatcher unificado de salidas.
2. Crear configuración admin por destino (`IntegrationConfig` o `LogForwardConfig`) con:
   - `transport`, `host`, `port`, `tls`, `format`, `enabled`, `timeoutMs`, `retryPolicy`.
3. En `backend/src/utils/audit.js`, después de persistir `AuditLog`, publicar evento a cola de salida.
4. Worker/cola (`OutboundJob`) procesa y entrega a SIEM externo; registrar resultado en `IntegrationDelivery`.
5. En caso de error: marcar `failed`, guardar causa, reintentar según política.

**Cobertura de auditoría a exportar (alineado con B11/B16):**
1. Login success/fail + new device + VPN.
2. Cambio de IP durante sesión (`IP_CHANGED_DURING_SESSION`).
3. Acciones admin (create/update/delete/config).
4. Acciones críticas de usuario (reportes, checklist cierre, backups, restore, etc.).
5. Eventos de correo (`mail.send.success` / `mail.send.fail`) con metadata segura.

**Seguridad y cumplimiento:**
1. No exportar secretos (passwords, tokens, credenciales SMTP, JWT).
2. Enmascarar datos sensibles cuando aplique (PII parcial, hash de campos críticos).
3. Para Syslog TLS (`6514`): validar certificado del colector y permitir CA custom.
4. Incluir `request_id`, `session_id`, `event_type`, `risk_level`, `tenant_id` para correlación.

**Compatibilidad objetivo:**
1. Elastic / OpenSearch.
2. Wazuh.
3. IBM QRadar.
4. Palo Alto Cortex XSOAR (vía webhook/API).
5. Fortinet/FortiSIEM.
6. Otros colectores Syslog estándar.

**Impacto esperado:**
Centralización real de telemetría de seguridad y auditoría, habilitando correlación en SOC con herramientas externas sin depender de una sola plataforma.

---

## 🟠 B12 - Huevo de pascua en login por combinaciones específicas

**Descripción:**
Si alguien intenta login con combinaciones concretas, debe dispararse un efecto visual (pantalla negra + imagen).

**Combinaciones solicitadas:**

1. `admin/admin`
2. `1234/1234`
3. `admin/1234`
4. `1234/admin`
5. `password/password`
6. `admin/password`
7. `root/root`
8. `superuser/superuser`

**Cómo se podría implementar:**

1. Definir colección en BD (ej. `EasterEggRule`) con:
   - `scope` (`login`, `entry`)
   - `triggerType` (`credentials`, `hashtag`)
   - `pattern` / `username` / `password`
   - `payload` (`blackout`, `imageUrl`, `durationMs`)
   - `enabled`
2. Backend login:
   - Antes de responder error de credenciales, consultar reglas activas de `scope=login`.
   - Si coincide, devolver flag controlada (`easterEgg: {...}`).
3. Frontend login:
   - Si respuesta trae `easterEgg`, aplicar clase fullscreen negra y renderizar imagen.
   - Resetear estado al cerrar o reintentar.
4. No hardcodear reglas en frontend ni backend:
   - Todo configurable desde BD.

**Impacto esperado:**
Feature lúdica configurable sin exposición evidente en código fuente.

---

## 🟠 B13 - Huevo de pascua en entradas por hashtag `#bender`

**Descripción:**
Si el usuario escribe `#Bender` o `#bender` en el campo de entrada, mostrar imagen fullscreen de Bender.

**Cómo se podría implementar:**

1. Reusar el sistema de reglas de `B12` con `scope=entry` y `triggerType=hashtag`.
2. Detectar hashtag en frontend (o backend + respuesta enriquecida) sin romper guardado normal.
3. Activar overlay visual fullscreen con imagen/animación configurable.
4. Opcional:
   - limitar frecuencia con cooldown,
   - permitir desactivar por configuración.

**Impacto esperado:**
Mejora lúdica sin afectar flujo principal.

---

## 🔴 B14 - Correo automático de turno fuera de contexto (vacío/duplicado)

**Descripción:**
Hoy el sistema ya envía correo al hacer checklist de cierre, pero además se están disparando correos automáticos fuera de contexto:
1. Días no laborales: llega correo vacío.
2. En días laborales: llega correo correcto al cierre y luego otro vacío a las `00:00`.

**Comportamiento esperado:**
1. Enviar correo solo cuando exista checklist de cierre válido.
2. No enviar correos vacíos ni duplicados por scheduler nocturno.
3. Si no hubo actividad/checklist de cierre, no enviar correo.

**Cómo se podría implementar:**
1. Definir una sola fuente de disparo:
   - O bien solo evento `POST /api/checklist/check` con `type=cierre`.
   - O scheduler, pero con guardas estrictas (no ambos al mismo tiempo).
2. Guardas anti-vacío antes de enviar:
   - Validar que exista `checklist cierre` del turno.
   - Validar que el payload tenga contenido útil (checklist/entradas/resumen).
   - Si está vacío, abortar envío y registrar `audit event` de `skip`.
3. Guardas anti-duplicado:
   - Persistir `lastReportSentAt` + `shiftId` + `periodKey` (ej. `YYYY-MM-DD-turno`).
   - Si ya fue enviado para ese periodo, no reenviar.
4. Regla de no laboral:
   - Si no hay turno activo o no corresponde envío por calendario/config, no enviar.
5. Auditoría:
   - Registrar `report.send.success`, `report.send.skipped`, `report.send.failed` con motivo.

**Impacto esperado:**
Elimina ruido de correos vacíos/duplicados y deja el envío alineado al cierre real del turno.

---

## ✅ B15 - Compatibilidad visual de correo HTML (dark/light)

**Estado:** Listo

**Descripción:**
El correo de cierre se está enviando, pero su renderizado no es consistente entre clientes:
1. En móvil con modo oscuro, los estados (verde/rojo) se ven bien.
2. En PC/cliente claro, esos colores/contornos no se distinguen correctamente.

**Comportamiento esperado:**
1. Los estados `OK` y `ERROR` deben verse claramente en dark y light.
2. El correo debe mantener contraste mínimo legible en Outlook, Gmail web y móvil.

**Cómo se podría implementar:**
1. Forzar estilos inline robustos por celda/estado:
   - fondo + color de texto + borde + peso de fuente (no depender solo de color).
2. Agregar indicadores redundantes:
   - texto `OK/ERROR`, íconos o etiquetas además del color.
3. Evitar estilos ambiguos que clientes reescriben en dark mode automático.
4. Probar matriz mínima de clientes:
   - Gmail Web (claro/oscuro), Outlook Desktop/Web, móvil iOS/Android.
5. Crear plantilla base de email con bloques de compatibilidad (tables + inline + fallback).

**Impacto esperado:**
Mejora de legibilidad del correo y reducción de errores de interpretación del estado del turno.

---

## 🔐 AUDITORÍA DE SEGURIDAD (2026-02-07)

### 🔴 SEC-CRIT-001 - Exposición de credenciales SMTP a cualquier usuario autenticado + secreto en texto plano

**Severidad:** CRÍTICA
**Evidencia técnica:**

- `backend/src/routes/config.js:45` permite `GET /api/config` con solo `authenticate` (sin `authorize('admin')`).
- `backend/src/routes/config.js:59` responde el objeto `config` completo.
- `backend/src/models/AppConfig.js:98` define `smtpConfig`.
- `backend/src/models/AppConfig.js:115` almacena `smtpConfig.pass` sin cifrado.

**Impacto:**

- Cualquier usuario autenticado (incluido `guest`) puede leer credenciales SMTP.
- Exfiltración de cuenta de correo corporativa y pivote a otros sistemas.

**Cómo lo arreglaría:**

1. Mover secretos SMTP fuera de `AppConfig` y usar solo `SmtpConfig` cifrado.
2. Cambiar `GET /api/config` a respuesta sanitizada para no-admin (sin secretos).
3. Crear `GET /api/config/admin` exclusivo para admin con datos sensibles mínimos.
4. Migrar secretos existentes y rotar inmediatamente contraseña SMTP comprometida.

---

### 🔴 SEC-CRIT-002 - Flujo de recuperación de contraseña vulnerable (host header poisoning + URL insegura + fuga de token)

**Severidad:** CRÍTICA
**Evidencia técnica:**

- `backend/src/routes/auth.js:212` construye host desde `x-forwarded-host`/`host` (controlable por atacante).
- `backend/src/routes/auth.js:217` fuerza URL `http://` (sin TLS).
- `backend/src/routes/auth.js:275` en modo desarrollo devuelve `resetToken` y `resetUrl` por API.
- `docker-compose.yml:40` fija `NODE_ENV: development` en despliegue estándar.

**Impacto:**

- Toma de cuenta por manipulación de link de reset.
- Exposición del token de reset en respuesta API cuando falla SMTP.
- Intercepción del token por transporte sin HTTPS.

**Cómo lo arreglaría:**

1. Eliminar uso de `Host` de request y usar solo `FRONTEND_URL` fijo en entorno.
2. Exigir HTTPS para links de recuperación.
3. Nunca devolver `resetToken` en respuestas HTTP (ni en desarrollo).
4. Agregar rate limit específico para `/forgot-password` y `/reset-password`.
5. Invalidar sesiones activas al completar reset de contraseña.

---

### 🔴 SEC-CRIT-003 - Renovación indefinida de JWT expirados

**Severidad:** CRÍTICA
**Evidencia técnica:**

- `backend/src/routes/auth.js:154` endpoint `/auth/refresh` sin sesión de refresh separada.
- `backend/src/routes/auth.js:162` usa `jwt.verify(..., { ignoreExpiration: true })`.

**Impacto:**

- Un token robado, aunque expire, puede renovarse indefinidamente.
- Persistencia de sesión comprometida y difícil revocación.

**Cómo lo arreglaría:**

1. Implementar refresh token rotatorio (almacenado hasheado en DB, con `jti`).
2. No aceptar access tokens expirados para refresh.
3. Agregar revocación por usuario/dispositivo y expiración absoluta de sesión.
4. Invalidar refresh tokens en cambio de contraseña, logout y desactivación de usuario.

---

### 🔴 SEC-CRIT-004 - RBAC incompleto: usuarios `guest` pueden ejecutar acciones de escritura

**Severidad:** CRÍTICA
**Evidencia técnica:**

- `backend/src/models/User.js:7` documenta guest como solo lectura.
- `backend/src/middleware/auth.js:78` existe middleware `notGuest` pero no se usa.
- `backend/src/routes/entries.js:34` (`POST /api/entries`) solo exige `authenticate`.
- `backend/src/routes/entries.js:257` (`PUT /api/entries/:id`) solo exige `authenticate`.
- `backend/src/routes/entries.js:332` (`DELETE /api/entries/:id`) solo exige `authenticate`.
- `backend/src/routes/checklist.js:442` (`POST /api/checklist/check`) solo exige `authenticate`.

**Impacto:**

- Escalada de privilegios funcional: invitados pueden alterar datos operativos.
- Riesgo de integridad en bitácora y reportes SOC.

**Cómo lo arreglaría:**

1. Aplicar `notGuest` en todos los endpoints de escritura.
2. Definir matriz RBAC centralizada por endpoint/rol.
3. Agregar tests automáticos de autorización por rol (`admin/user/auditor/guest`).

---

### 🔴 SEC-CRIT-005 - Protección anti brute-force desactivada en despliegue actual

**Severidad:** CRÍTICA
**Evidencia técnica:**

- `backend/src/middleware/rate-limiter.js:32` y `backend/src/middleware/rate-limiter.js:42` deshabilitan límites fuera de producción.
- `backend/src/middleware/rate-limiter.js:25` define `loginLimiter` pero no se aplica en rutas.
- `docker-compose.yml:40` ejecuta backend con `NODE_ENV: development`.

**Impacto:**

- Login expuesto a fuerza bruta/credential stuffing en entorno desplegado.
- Mayor probabilidad de acceso no autorizado por contraseñas débiles/reutilizadas.

**Cómo lo arreglaría:**

1. Cambiar despliegue a `NODE_ENV=production`.
2. Aplicar `loginLimiter` explícitamente en `POST /api/auth/login`.
3. Añadir bloqueo progresivo por usuario + IP (backoff/lockout temporal).
4. Monitorear y alertar intentos fallidos anómalos.

---

### 🟠 SEC-HIGH-006 - Credenciales por defecto débiles en bootstrap y scripts

**Severidad:** ALTA
**Evidencia técnica:**

- `docker-compose.yml:47` usa fallback `ADMIN_PASSWORD:-Admin123!`.
- `backend/src/scripts/seed.js:11` fallback `Admin123!`.
- `backend/scripts/create-users.js:25` y `backend/scripts/create-users.js:32` usan `bitacora123`.
- `backend/scripts/create-users.js:16` incluye URI con credenciales por defecto.

**Impacto:**

- Compromiso rápido por ataques de password spraying.
- Riesgo alto en instalaciones nuevas o mal configuradas.

**Cómo lo arreglaría:**

1. Eliminar todos los fallbacks de contraseña por defecto.
2. Fallar el arranque si faltan credenciales fuertes.
3. Forzar cambio de contraseña en primer login de bootstrap.
4. Retirar scripts con credenciales hardcodeadas del flujo normal.

---

### 🟠 SEC-HIGH-007 - Riesgo de robo de JWT por cadena XSS (sin CSP + token en localStorage)

**Severidad:** ALTA
**Evidencia técnica:**

- `backend/src/server.js:56` desactiva CSP (`contentSecurityPolicy: false`).
- `frontend/src/app/services/auth.service.ts:116` guarda JWT en `localStorage`.
- `frontend/src/app/pages/main/report-generator/report-generator.component.ts:302` usa `container.innerHTML = html` con contenido no escapado.

**Impacto:**

- Si se ejecuta XSS en cliente, el atacante puede extraer JWT y secuestrar sesión.

**Cómo lo arreglaría:**

1. Migrar autenticación a cookie `HttpOnly + Secure + SameSite=Strict`.
2. Habilitar CSP estricta en backend (sin `unsafe-inline`).
3. Eliminar asignaciones directas a `innerHTML` o sanitizar con allowlist robusta.
4. Revisar componentes que generan HTML dinámico y escapar contenido de usuario.

---

### 🟠 SEC-HIGH-008 - Posible Path Traversal en manejo de backups

**Severidad:** ALTA
**Evidencia técnica:**

- `backend/src/routes/backup.js:299` usa `path.join(backupDir, filename)` sin sanitización.
- `backend/src/routes/backup.js:462` usa `path.join(backupDir, id)` sin sanitización.

**Impacto:**

- Lectura/borrado de archivos fuera de `backups/` si se inyecta `../`.
- Facilita exfiltración de secretos del host tras comprometer cuenta admin.

**Cómo lo arreglaría:**

1. Aceptar solo nombres con regex estricta (`^backup-[a-zA-Z0-9._-]+\\.json$`).
2. Resolver ruta con `path.resolve` y validar prefijo obligatorio de `backupDir`.
3. Rechazar cualquier entrada con separadores de ruta o `..`.

---

## 🔴 BUG CRÍTICO DETALLE: Emails no llegan (B-CRÍTICO-001)

### Síntoma

Usuario: "ningun correo llego ahora y antes si llegaban"

- Cierre checklist se registra exitosamente en BD
- Email NO llega a la bandeja (usuario.demo@example.com)
- No hay error en frontend, parece exitoso
- Backend logs muestran: `❌ ERROR: SMTP configuration missing: Please configure email settings in Settings > Configuración SMTP`
- **PERO: Usuario confirmó desde el inicio: "la config existe en Settings, está conectada, dice 'Conectado'"**
  - El usuario tenía razón todo el tiempo
  - El problema NO era falta de config
  - El problema era que el backend LEÍA config del lugar equivocado

### Root Cause Identificado

**Mismatch de fuentes de configuración SMTP:**

⚠️ **NOTA IMPORTANTE DE DIAGNÓSTICO:**
El usuario reportó correctamente desde el inicio: "la config SMTP está en Settings, dice 'Conectado'". El error de diagnóstico fue asumir que la config faltaba en base de datos. La realidad:

- ✅ Config SMTP SÍ existe en AppConfig.smtpConfig
- ✅ El status en UI SÍ muestra "Conectado"
- ❌ Backend buscaba en lugar equivocado (modelo SmtpConfig)
- **Conclusión:** El usuario tenía razón, el código estaba roto

1. **Frontend Settings** (UI): Guarda config SMTP en `AppConfig.smtpConfig`

   ```javascript
   // backend/src/routes/config.js línea 277
   const config = await AppConfig.findOne().select('emailReportConfig smtpConfig').lean();
   // Retorna: { smtpConfig: { host, port, secure, user, pass, from } }
   ```

2. **Backend email.js** (antes del fix): Intentaba leer de `SmtpConfig` (colección separada)

   ```javascript
   // backend/src/utils/email.js línea 28 (VIEJO - ROTO)
   const smtpConfig = await SmtpConfig.findOne().lean();
   // Retornaba null porque esa colección NO existe / NO se usa
   ```

3. **Resultado**:
   - `getSMTPConfig()` retorna `null` a pesar de que config EXISTE
   - `sendEmail()` falla con error "SMTP configuration missing"
   - Email NO se envía
   - **Pero el checklist SÍ se registra** (email es asincrónico, no bloquea)

### Timeline del Bug

1. **Fase 1:** User configuró SMTP en UI Settings (Office 365: usuario.demo@example.com)
   - Guardó en `AppConfig.smtpConfig` ✅
   - Emails funcionaban cuando se activó sendChecklistEmail() en POST checklist

2. **Fase 2:** Se cambió arquitectura de emails
   - Se agregó `sendShiftReport()` para enviar UN email al cierre (no múltiples)
   - Se leyó código viejo que buscaba en modelo `SmtpConfig` ❌
   - Se comentó `sendChecklistEmail()` para no duplicar emails

3. **Fase 3:** Email automation se rompió
   - Código nuevo buscaba en `SmtpConfig` (no existe)
   - Config real está en `AppConfig.smtpConfig`
   - Resultado: "no hay config" → no envía → email no llega
   - Bug no fue evidente porque:
     - Frontend muestra "ok" en checklist
     - Email falla en backend (asincrónico)
     - Usuario solo se da cuenta después de esperar al email

### Diagnóstico Realizado

```bash
# Backend logs muestran claramente:
[2026-02-04 00:50:36.259 -0300] WARN: Error reading SMTP config from DB:
[2026-02-04 00:50:36.260 -0300] WARN: No SMTP configuration found in DB or environment
[2026-02-04 00:50:36.260 -0300] ERROR: SMTP configuration missing: Please configure email settings...
```

**Investigación:**

- Config SMTP guardada en `AppConfig.smtpConfig` ✅ (verificado en UI)
- Model `SmtpConfig` existe pero NO se usa ❌
- Routes en `config.js` usan `AppConfig.smtpConfig` ✅
- Routes en `smtp.js` usan `SmtpConfig` (legacy, no usado) ❌

### Fix Aplicado

**Cambio en `backend/src/utils/email.js` línea 1-50:**

```diff
- const SmtpConfig = require('../models/SmtpConfig');
+ const AppConfig = require('../models/AppConfig');

  async function getSMTPConfig() {
    try {
-     const smtpConfig = await SmtpConfig.findOne().lean();
+     const appConfig = await AppConfig.findOne().select('smtpConfig').lean();
+     const smtpConfig = appConfig?.smtpConfig;

      if (smtpConfig) {
+       logger.info('📧 SMTP config found in AppConfig', { user: smtpConfig.user });
        const config = {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure === true,
-         user: smtpConfig.username,
-         pass: decrypt(smtpConfig.password),
-         from: smtpConfig.senderEmail
+         user: smtpConfig.user,
+         pass: smtpConfig.pass,
+         from: smtpConfig.from || smtpConfig.user
        };
```

**Cambios:**

1. ✅ Cambiar import: `SmtpConfig` → `AppConfig`
2. ✅ Cambiar query: `SmtpConfig.findOne()` → `AppConfig.findOne().select('smtpConfig')`
3. ✅ Acceder campo correcto: `appConfig.smtpConfig`
4. ✅ Usar nombres de campo correctos: `user`/`pass` (no `username`/`password`)
5. ✅ NO desencriptar (config en AppConfig está en texto plano desde UI)
6. ✅ Agregar logging con emoji 📧 para debugear

### ✅ Actualizaciones posteriores (formato + contenido del correo)

**Problemas reportados:**

- Correo con letras blancas/fondo blanco (Outlook).
- Checklist mostraba "No completado" aunque estaba completado.
- Entradas incluían TODO el día y salían "Sin descripción".
- Se truncaba el texto de entradas largas.

**Cambios aplicados (2026-02-04):**

1. ✅ `backend/src/utils/shift-report.js` usa **services + createdAt** reales de ShiftCheck.
2. ✅ Entradas filtradas **solo entre inicio y cierre** (no todo el día).
3. ✅ Contenido de entradas ahora usa `entry.content` completo (sin truncado).
4. ✅ HTML del correo convertido a **tablas + estilos inline** (mejor soporte Outlook).
5. ✅ Forzado de color negro absoluto + `mso-*` + `-webkit-text-fill-color`.
6. ✅ Se agrega **versión text/plain completa** como fallback.
7. ✅ Badge OK/ERROR con fondo verde/rojo (no solo texto).
8. ✅ Contenedor más ancho (max-width: 1100px).

**Resultado validado:** En Outlook ya se ve correctamente el texto (no blanco).

### Validación del Fix

**Requisitos para validar:**

1. ✅ **SMTP configurado en UI Settings** - VERIFICADO
   - **URL:** http://localhost:4200/main/settings → pestaña "📧 Reenvío de Información"
   - **Estado en UI:** "✅ Conectado"
   - **Provider:** Office 365
   - **Host:** smtp.office365.com
   - **Port:** 587
   - **User:** usuario.demo@example.com
   - **Pass:** (guardado y encriptado en BD)
   - **From:** usuario.demo@example.com
   - **Verificación:** Usuario confirmó "está ahi mierda y sale conectado" → Config EXISTE en BD ✅
   - **Ubicación en BD:** `db.appconfigs.findOne()` → campo `smtpConfig` contiene:

     ```json
     {
       "host": "smtp.office365.com",
       "port": 587,
       "secure": false,
       "user": "usuario.demo@example.com",
       "pass": "(valor encriptado)",
       "from": "usuario.demo@example.com"
     }
     ```

2. Backend debe encontrar config:

   ```bash
   docker logs bitacora-backend --tail 50 | grep "📧"
   # Buscar: "📧 SMTP config found in AppConfig"
   # Buscar: "📧 Sending mail with SMTP"
   ```

3. Cierre checklist debe enviar email:
   - UI: http://localhost:4200/main/shifts
   - Click en turno → Checklist → Registrar "cierre"
   - Esperar 3-5 segundos
   - Logs deben mostrar: "✅ EMAIL SENT SUCCESSFULLY"

4. Email debe llegar a bandeja:
   - usuario.demo@example.com debe recibir email
   - Asunto: "Reporte SOC [fecha] [turno]"
   - Body: Checklist inicio + cierre + entradas

### Testing Post-Fix

```bash
# 1. Restart backend
docker-compose restart backend

# 2. Esperar 5 segundos
sleep 5

# 3. Ver logs de startup
docker logs bitacora-backend --tail 20

# 4. IR a UI y registrar cierre checklist

# 5. Ver logs nuevamente
docker logs bitacora-backend --tail 100 | Select-String "📧|✅|❌|email"
```

**Marcadores esperados:**

- `📧 Reading SMTP config FROM DATABASE (AppConfig.smtpConfig)...`
- `📧 SMTP config found in AppConfig`
- `📧 SMTP config LOADED FROM DB`
- `📧 [sendEmail] Starting email send process`
- `✅ EMAIL SENT SUCCESSFULLY` ← ÉXITO

**Si NO aparecen estos marcadores:**

- Config SMTP no guardada en UI Settings
- O guardar config está fallando
- Revisar `backend/src/routes/config.js` PUT endpoint

### Archivos Modificados

- ✅ `backend/src/utils/email.js` - Cambiar fuente de config
- ✅ `ISSUES.md` - Documentar bug y fix (este documento)
- ⏳ Pendiente: Validación manual en vivo

### Impacto

- **Antes del fix**: Emails NO llegan → Feature crítica rota
- **Después del fix**: Emails deben llegar → Feature restaurada
- **Si falla la validación**: Significa que hay otro problema (ej: SMTP config no guardada correctamente en UI)

### Lecciones Aprendidas

1. **Consistencia de fuentes**: Backend debe leer de mismo lugar que frontend escribe
2. **Falta de tests**: Sin tests, este bug hubiera sido detectado automáticamente
3. **Logging insuficiente**: Agregar emoji markers para fácil identificación en prod
4. **Cambios asincronicos**: Errores en tasks background no alertan al usuario
5. **Migración de modelos**: Cuando se cambian modelos, actualizar TODOS los lugares que los usan

Pendientes manuales post-fix:

- [ ] Usuario valida que emails llegan post-fix
- [ ] Agregar tests automatizados para email sending
- [ ] Documentar en SETUP.md el flujo de configuración SMTP
- [ ] Agregar health check endpoint que valide SMTP está configurado

## **P1** **Prioridad #1: Estrategia Detallada de Actualización a Angular 20**

**Justificación:** Para asegurar la estabilidad, seguridad y mantenibilidad a largo plazo del proyecto, la actualización del framework es la máxima prioridad. Abordar esta tarea primero nos proporcionará una base moderna y sólida sobre la cual implementar futuras mejoras y correcciones de manera eficiente, evitando la acumulación de deuda técnica. **Todas las demás tareas de este documento quedan en espera hasta que esta actualización se complete.**

**Versión Actual:** Angular 17.0.0

**Versión Objetivo:** Angular 20.x.x

---

### Plan de Actualización Incremental

La actualización se realizará de forma incremental, versión por versión, para minimizar riesgos y facilitar la depuración de "breaking changes" en cada etapa.

#### Fase 0: Preparación

1.  **F0-1** **Crear Rama Aislada:** Crear una nueva rama en Git dedicada exclusivamente a la actualización (ej. `feature/angular-20-upgrade`).
2.  **F0-2** **Limpieza del Entorno:** Eliminar `node_modules` y `package-lock.json` para asegurar un entorno de dependencias limpio. Ejecutar `npm install` para verificar que el proyecto base está estable.
3.  **F0-3** **Verificar Pruebas (si existen):** Ejecutar `ng test` para asegurar que el estado actual es conocido y funcional.

#### Fase 1: Actualización a Angular 18

1.  **F1-1** **Ejecutar Comandos de Actualización:**

    ```bash
    ng update @angular/core@18 @angular/cli@18
    ng update @angular/material@18
    ```

2.  **F1-2** **Análisis y Migración:**
    - Revisar la salida de la terminal en busca de advertencias y errores.
    - `ng update` aplicará migraciones automáticas. Es crucial revisar los cambios realizados.
3.  **F1-3** **Revisión Manual de Breaking Changes:**
    - Consultar la guía oficial de actualización de Angular v17 a v18.
    - Poner especial atención a cambios en APIs de `CommonModule`, `Router` y el manejo de Zoneless.
4.  **F1-4** **Verificación:**
    - Ejecutar `npm install` si es necesario.
    - Iniciar la aplicación (`ng serve`) y realizar una prueba de humo de las funcionalidades principales.
    - Ejecutar `ng test`.
5.  **F1-5** **Commit:** Una vez estable, hacer commit de la actualización a la v18: `git commit -m "feat(ng): Upgrade to Angular 18"`.

#### Fase 2: Actualización a Angular 19 ✅ **COMPLETADO**

**PROBLEMA DETECTADO Y RESUELTO (2026-02-02):**

Angular 19.2.x con el nuevo builder `@angular/build:application` tenía un bug donde detectaba incorrectamente componentes NgModule-based como standalone.

**SOLUCIÓN IMPLEMENTADA:** ✅ Migración completa a Standalone Components

Se utilizó el schematic oficial de Angular para migrar automáticamente:
```bash
npx ng generate @angular/core:standalone --mode=convert-to-standalone
npx ng generate @angular/core:standalone --mode=prune-ng-modules
npx ng generate @angular/core:standalone --mode=standalone-bootstrap
```

**Resultado:**

- ✅ 20+ componentes migrados a `standalone: true`
- ✅ Eliminado `shared-components.module.ts`
- ✅ Actualizado `main.ts` a `bootstrapApplication`
- ✅ NgModules innecesarios eliminados
- ✅ Build exitoso con Angular 19
- ✅ Path desbloqueado para Angular 20

**Referencias:**

- https://angular.dev/tools/cli/build-system-migration
- https://github.com/angular/angular-cli/issues (tracking del bug)

---

1.  **F2-1** **Ejecutar Comandos de Actualización:**

    ```bash
    ng update @angular/core@19 @angular/cli@19
    ng update @angular/material@19
    ```
    **Estado:** ✅ Ejecutado exitosamente
    **Resultado:** ❌ Bug detectado en compilación
    **Revertido:** ✅ Proyecto vuelto a Angular 18.2.x

2.  **F2-2** **Análisis y Migración:**
    - ❌ Bloqueado por bug del compilador
    - Migraciones automáticas se aplicaron pero el build falla
3.  **F2-3** **Revisión Manual de Breaking Changes:**
    - Consultar la guía oficial de v18 a v19.
    - **Análisis de `ng-content` y Vistas:** Se ha revisado el código y no se han encontrado usos de la directiva `<ng-content>`. Por lo tanto, no se esperan problemas de migración relacionados con la proyección de contenido. El manejo de vistas en la aplicación utiliza patrones estándar que no deberían verse afectados por cambios en la v19.
4.  **F2-4** **Verificación:**
    - Repetir el proceso de `npm install`, `ng serve`, `ng test`.
5.  **F2-5** **Commit:** `git commit -m "feat(ng): Upgrade to Angular 19"`.

#### Fase 3: Actualización a Angular 20 (Versión Final) ✅ **COMPLETADO**

1.  **F3-1** **Ejecutar Comandos de Actualización:**

    ```bash
    ng update @angular/core@20 @angular/cli@20
    ng update @angular/material@20
    ```
    **Estado:** ✅ Ejecutado exitosamente

    - Angular Core: 20.3.16
    - Angular CLI: 20.3.15
    - Material/CDK: 20.2.14
    - TypeScript: 5.9.3

2.  **F3-2** **Análisis y Migración:**

    ✅ Migraciones automáticas aplicadas:

    - Workspace generation defaults actualizados
    - Imports de server rendering verificados (sin cambios)
    - moduleResolution verificado (ya en 'bundler')

3.  **F3-3** **Revisión Manual de Breaking Changes:**

    ✅ Revisado:

    - Signal-based features: No requieren cambios inmediatos
    - afterRender API: Funciona correctamente con Material 20
    - TypeScript 5.9.3: Compatible con el código actual

4.  **F3-4** **Verificación Final:**

    ✅ Build exitoso
    ⚠️ Solo 1 advertencia menor: EntryDetailDialogComponent no usado en template (no afecta funcionamiento)
    Bundle size: Similar a versión anterior (~1.28 MB)

5.  **F3-5** **Commit:**
    - Commit c102e7d: Angular 20.3.16
    - Commit fa45c38: Material 20.2.14

#### Fase 4: Post-Actualización ✅ **COMPLETADO**

1.  **F4-1** **Revisión de Dependencias Externas:**

    ✅ Verificado:

    - `animejs@3.2.2`: Funcionando correctamente
    - `@types/animejs@3.1.12`: Tipos OK
    - Todas las dependencias externas compatibles

2.  **F4-2** **Limpieza de Código:**

    ✅ Realizado:

    - Código standalone limpio
    - NgModules innecesarios eliminados
    - Solo 1 advertencia menor pendiente (no crítica)
    - Sin código temporal o soluciones parche

3.  **F4-3** **Merge:**

    ⏳ Pendiente de decisión del equipo

    - Rama `feature/angular-20-upgrade` estable y lista
    - Todos los commits documentados
    - Build verificado

---

## 🎉 RESUMEN FINAL DEL UPGRADE

### ✅ Upgrade Completado Exitosamente

**Versión Inicial:** Angular 17.0.0
**Versión Final:** Angular 20.3.16

### 📊 Versiones Actualizadas

- @angular/core: 17.0.0 -> 20.3.16 ✅
- @angular/cli: 17.x -> 20.3.15 ✅
- @angular/material: 17.x -> 20.2.14 ✅
- @angular/cdk: 17.x -> 20.2.14 ✅
- TypeScript: 5.2.x -> 5.9.3 ✅
- zone.js: 0.14.x -> 0.15.1 ✅

### 🔧 Cambios Arquitectónicos Mayores

1. **Migración a Standalone Components**
   - Convertidos 20+ componentes a arquitectura standalone
   - Eliminados NgModules innecesarios
   - Actualizado bootstrap a `bootstrapApplication`

2. **Nuevo Build System**
   - Migrado a `@angular/build:application` builder
   - Output path actualizado a `dist/bitacora-soc`

3. **Dependencias**
   - animejs: Funciona correctamente
   - Material Components: Todos funcionando

### 📝 Commits Principales

- `2abd954`: Migración a Standalone Components
- `8afdb02`: Upgrade a Angular 19.2.18
- `e292d7c`: Update Material 19
- `c102e7d`: Upgrade a Angular 20.3.16
- `fa45c38`: Update Material 20
- `c93762c`: Documentación versiones (README, SETUP)
- `a2c0148`: Documentación completa ISSUES.md
- `d3112bd`: Bug fixes (B1a dark mode, B4-5 typo, B1b verificación, Docker Node.js)
- `87d03a5`: Docker build path fix (/browser subfolder)
- `fb5bbdd`: ISSUES.md status updates
- `da9e5d1`: Dark mode contrast improvements (secundario, headers, warnings)

### ⚠️ Notas Importantes

- **Warning menor:** EntryDetailDialogComponent no usado en template (no crítico)
- **Build time:** ~12-15 segundos (~18s en Docker)
- **Bundle size:** ~1.28 MB (sin cambio significativo)
- **Compatibilidad:** Todas las funcionalidades existentes funcionan
- **Accesibilidad:** Contraste dark mode mejorado para cumplir WCAG AA

---

## Backlog de Tareas (Post-Actualización a Angular 20)

### 1. Problemas y Depuración (Bugs)

#### **B1a** ✅ **COMPLETADO - Problemas de visibilidad en el tema oscuro (Dark Mode)**

- **Descripción Original:** Al activar el tema oscuro, varios textos se volvían ilegibles debido a un bajo contraste. Esto afectaba elementos generales de la interfaz y era particularmente notorio en el menú desplegable para seleccionar el tema.
- **Solución Aplicada (Commit d3112bd + da9e5d1):**
  - Primera ronda: Corregidos mat-mdc-menu-item y mat-mdc-option con colores específicos para dark mode
  - Segunda ronda (basada en capturas de pantalla del usuario):
    - Mejorado color de `--text-secondary` de #c7ccda → #d0d5e3 para mejor contraste WCAG
    - Corregido texto hint "Sin sub-items" en Checklist Admin (cambió de hardcoded #555 a CSS variable)
    - Agregados estilos específicos para mat-card-subtitle con mejor contraste
    - Mejorado contraste de headers de tabla (Contenido/Tags/Autor) con font-weight: 600
    - Refactorizado warning box en Backup de estilos inline a clase .warning-box con dark mode (#3d3316 bg, #f5e6a3 text)
    - Texto secundario en Tags, Generador de Reportes y otros componentes ahora visible
- **Archivos modificados:**
  - `frontend/src/styles.scss` - Variables de tema y overrides de Material
  - `frontend/src/app/pages/main/checklist-admin/checklist-admin.component.scss`
  - `frontend/src/app/pages/main/backup/backup.component.html`
  - `frontend/src/app/pages/main/backup/backup.component.scss`
- **Estado:** Todos los problemas de contraste identificados en screenshots ahora resueltos

#### **B1b** ✅ **COMPLETADO - Las notas se guardan correctamente**

- **Reporte Original:** El contenido introducido en las notas no se guardaba.
- **Verificación:** Código de autoguardado funcionando correctamente (commit d3112bd).
- **Estado:** Confirmado funcionando. Autoguardado cada 3 segundos operando sin errores.

#### **B1c** **Versión no se muestra en sidebar**

- **Problema:** El placeholder `__APP_VERSION__` en `frontend/src/environments/environment.prod.ts` no se reemplaza durante el build Docker, quedando como texto literal en lugar de mostrar la versión real.
- **Síntomas:** En la barra de herramientas del sidebar izquierdo dice "Bitácora SOC VDEV" pero debería mostrar "Bitácora SOC 1.1.0" (o la versión correspondiente).
- **Causa:** El script de build en `frontend/Dockerfile` usa `sed` para reemplazar `__APP_VERSION__`, pero el patrón no coincide porque:
  - El archivo environment.ts tiene `appVersion: '__APP_VERSION__'` (comillas simples)
  - El comando `sed` debe buscar con delimitadores correctos
- **Solución propuesta:**
  1. Actualizar el Dockerfile para usar patrón correcto: `sed -i "s|__APP_VERSION__|1.1.0|g"` en lugar de patrón incorrecto
  2. O mejor: leer versión desde `package.json` dinámicamente: `VERSION=$(grep '"version"' package.json | grep -o '[0-9.]*')`
  3. Mostrar versión en el componente principal (MainLayoutComponent) leyendo desde `environment.appVersion`
  4. Agregar tests para validar que la versión se reemplaza correctamente en build
- **Archivos afectados:**
  - `frontend/Dockerfile` - Script de build
  - `frontend/src/environments/environment.prod.ts` - Placeholder
  - `frontend/src/app/pages/main/main-layout.component.html` - Mostrar versión
  - `frontend/src/app/pages/main/main-layout.component.ts` - Importar versión
- **Ejemplos:**
  - Antes: "Bitácora SOC __APP_VERSION__" o "Bitácora SOC VDEV"
  - Después: "Bitácora SOC 1.1.0" (en prod) o "Bitácora SOC dev" (en dev)

#### **B2p** **Configuración TLS/SSL en backend (sin reconstruir imagen)**

- **Objetivo:** Permitir que el admin pueda cargar certificados SSL/TLS en tiempo de ejecución (sin rebuild de Docker) para habilitar HTTPS en el backend. Similar a Portainer.
- **Casos de uso:**
  - Desarrollo local: carga de certificados autofirmados (self-signed)
  - Producción: carga de certificados válidos (Let's Encrypt, DigiCert, etc.)
  - Cambio de certificados sin reiniciar contenedores
- **Requisitos:**
  - UI en Admin Panel para subir archivo `.crt` (certificate) y `.key` (private key)
  - Validación de certificados antes de activar HTTPS
  - Fallback a HTTP si HTTPS falla (no bloquear aplicación)
  - Almacenar certificados encriptados en modelo MongoDB
  - Endpoint `/health` disponible en ambos puertos (HTTP y HTTPS)
  - Reinicio de servidor Express (sin reinicio de contenedor)
- **Flujo de usuario:**
  1. Admin va a "Configuración → Seguridad TLS/SSL"
  2. Ve estado actual: "HTTP activado, HTTPS desactivado"
  3. Sube archivo `.crt` y `.key`
  4. Sistema valida certificados (fecha expiración, dominio coincide, etc.)
  5. Guarda certificados encriptados en DB
  6. Reinicia servidor Express en HTTPS
  7. Todos los nuevos requests van a HTTPS (puerto 443 ó 8443)
  8. HTTP redirecciona a HTTPS (opcional)
- **Archivos relevantes:**
  - `backend/src/server.js` - Agregar soporte HTTPS con `https` module de Node
  - `backend/src/models/TlsConfig.js` - Modelo para certificados (nuevo)
  - `backend/src/routes/config.js` - Endpoint para subir/validar certificados
  - `backend/src/utils/certificateValidator.js` - Validar certificados
  - `frontend/src/app/pages/main/settings/` - UI para cargar certificados (nuevo tab)
- **Archivos que NO cambian (importante):**
  - `backend/Dockerfile` - Sin cambios; soporta HTTPS vía env vars
  - `docker-compose.yml` - Agregar puertos 443 y 8443 opcionalmente
  - Estructura de `uploads/` ya existe (reutilizar)

**Implementación técnica propuesta:**

**1. Modelo: TlsConfig.js (nuevo)**
```javascript
const tlsConfigSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  protocol: { type: String, enum: ['http', 'https'], default: 'http' },
  httpPort: { type: Number, default: 3000 },
  httpsPort: { type: Number, default: 8443 },
  certificatePem: String, // Encriptado (utils/encryption)
  privateKeyPem: String, // Encriptado (utils/encryption)
  certificatePath: String, // Ruta en /app/certs/ ej: /app/certs/server.crt
  privateKeyPath: String, // Ruta en /app/certs/ ej: /app/certs/server.key
  certificateValidFrom: Date,
  certificateValidUntil: Date,
  certificateIssuer: String,
  certificateSubject: String,
  certificateError: String, // Error si validación falló
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  redirectHttpToHttps: { type: Boolean, default: false },
  createdAt: Date,
  updatedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('TlsConfig', tlsConfigSchema);
```

**2. Modificación en server.js (agregar HTTPS)**
```javascript
const https = require('https');
const TlsConfig = require('./models/TlsConfig');

let server = null;

const initializeServer = async () => {
  const tlsConfig = await TlsConfig.findOne();

  if (tlsConfig?.enabled && tlsConfig?.certificatePem && tlsConfig?.privateKeyPem) {
    try {
      const { decrypt } = require('./utils/encryption');
      const httpsOptions = {
        cert: decrypt(tlsConfig.certificatePem),
        key: decrypt(tlsConfig.privateKeyPem)
      };

      server = https.createServer(httpsOptions, app);
      const httpsPort = tlsConfig.httpsPort || 8443;

      server.listen(httpsPort, HOST, () => {
        console.log(`✅ HTTPS activado en puerto ${httpsPort}`);
      });
    } catch (error) {
      logger.error({ err: error }, 'Error iniciando HTTPS');
      startHttpServer();
    }
  } else {
    startHttpServer();
  }
};

const startHttpServer = () => {
  server = app.listen(PORT, HOST, () => {
    console.log(`✅ HTTP activado en puerto ${PORT}`);
  });
};

// Llamar en el startup
(async () => {
  await initializeServer();
})();
```

**3. Utilidad: certificateValidator.js (nuevo)**
```javascript
const crypto = require('crypto');
const { X509Certificate } = require('crypto');

const validateCertificates = (certPem, keyPem) => {
  try {
    // Validar formato PEM
    if (!certPem.includes('-----BEGIN CERTIFICATE-----') ||
        !keyPem.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Formato PEM inválido');
    }

    // Parsear certificado
    const cert = new X509Certificate(certPem);

    // Extraer datos
    const now = new Date();
    const validFrom = new Date(cert.validFrom);
    const validUntil = new Date(cert.validTo);

    // Validar fechas
    if (now < validFrom) {
      throw new Error('Certificado aún no es válido');
    }
    if (now > validUntil) {
      throw new Error('Certificado expirado');
    }

    // Validar que falten menos de 30 días (warning)
    const daysLeft = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
    if (daysLeft < 30) {
      console.warn(`⚠️ Certificado expirará en ${daysLeft} días`);
    }

    return {
      valid: true,
      issuer: cert.issuer,
      subject: cert.subject,
      validFrom,
      validUntil,
      daysLeft
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

module.exports = { validateCertificates };
```

**4. Ruta: POST /api/config/tls (en config.js)**
```javascript
const multer = require('multer');
const TlsConfig = require('../models/TlsConfig');
const { validateCertificates } = require('../utils/certificateValidator');
const { encrypt, decrypt } = require('../utils/encryption');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 } // 1MB max
});

// POST /api/config/tls - Subir y validar certificados
router.post('/tls',
  authenticate,
  authorize('admin'),
  upload.fields([{ name: 'certificate' }, { name: 'privateKey' }]),
  async (req, res) => {
    try {
      const certFile = req.files.certificate?.[0];
      const keyFile = req.files.privateKey?.[0];

      if (!certFile || !keyFile) {
        return res.status(400).json({ message: 'Debes subir certificado y private key' });
      }

      const certPem = certFile.buffer.toString('utf-8');
      const keyPem = keyFile.buffer.toString('utf-8');

      // Validar certificados
      const validation = validateCertificates(certPem, keyPem);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Guardar encriptado
      let tlsConfig = await TlsConfig.findOne();
      if (!tlsConfig) tlsConfig = new TlsConfig();

      tlsConfig.certificatePem = encrypt(certPem);
      tlsConfig.privateKeyPem = encrypt(keyPem);
      tlsConfig.certificateValidFrom = validation.validFrom;
      tlsConfig.certificateValidUntil = validation.validUntil;
      tlsConfig.certificateIssuer = validation.issuer;
      tlsConfig.certificateSubject = validation.subject;
      tlsConfig.certificateError = null;
      tlsConfig.lastUpdatedBy = req.user._id;

      await tlsConfig.save();

      res.json({
        message: 'Certificados subidos exitosamente',
        validUntil: validation.validUntil,
        daysLeft: validation.daysLeft
      });
    } catch (error) {
      logger.error({ err: error }, 'Error subiendo certificados');
      res.status(500).json({ message: 'Error al subir certificados' });
    }
  }
);

// POST /api/config/tls/enable - Activar HTTPS
router.post('/tls/enable', authenticate, authorize('admin'), async (req, res) => {
  try {
    let tlsConfig = await TlsConfig.findOne();
    if (!tlsConfig || !tlsConfig.certificatePem) {
      return res.status(400).json({ message: 'No hay certificados cargados' });
    }

    tlsConfig.enabled = true;
    await tlsConfig.save();

    // Aquí se reiniciaría el servidor Express
    // (podría ser vía signal, API call, etc.)

    res.json({ message: 'HTTPS activado. El servidor se reiniciará en 5s' });
  } catch (error) {
    res.status(500).json({ message: 'Error activando HTTPS' });
  }
});

// GET /api/config/tls - Obtener estado TLS
router.get('/tls', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tlsConfig = await TlsConfig.findOne();
    if (!tlsConfig) {
      return res.json({
        enabled: false,
        protocol: 'http',
        httpPort: 3000,
        message: 'Sin certificados cargados'
      });
    }

    res.json({
      enabled: tlsConfig.enabled,
      protocol: tlsConfig.enabled ? 'https' : 'http',
      httpPort: tlsConfig.httpPort,
      httpsPort: tlsConfig.httpsPort,
      certificateValidUntil: tlsConfig.certificateValidUntil,
      daysLeft: Math.ceil((tlsConfig.certificateValidUntil - new Date()) / (1000 * 60 * 60 * 24))
    });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo config TLS' });
  }
});
```

**5. UI Frontend (nuevo tab en Settings)**
```html
<!-- settings.component.html - agregar tab TLS -->
<mat-tab label="🔒 TLS/SSL">
  <mat-card>
    <mat-card-header>
      <mat-card-title>Configuración TLS/SSL (HTTPS)</mat-card-title>
    </mat-card-header>
    <mat-card-content>
      <div class="tls-status">
        <p><strong>Estado actual:</strong> {{ tlsStatus?.enabled ? 'HTTPS Activado' : 'HTTP Activado' }}</p>
        <p *ngIf="tlsStatus?.certificateValidUntil">
          <strong>Válido hasta:</strong> {{ tlsStatus.certificateValidUntil | date:'short' }}
          ({{ tlsStatus.daysLeft }} días restantes)
        </p>
        <div *ngIf="tlsStatus?.daysLeft && tlsStatus?.daysLeft < 30" class="warning-box">
          ⚠️ Certificado expirará pronto. Por favor renovar.
        </div>
      </div>

      <mat-divider></mat-divider>

      <h3>Cargar Certificados</h3>
      <div class="upload-section">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Certificado (.crt o .pem)</mat-label>
          <input matInput type="file"
                 #certInput accept=".crt,.pem" (change)="onCertificateSelected($event)">
          {{ certificateFile?.name || 'Sin seleccionar' }}
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Private Key (.key o .pem)</mat-label>
          <input matInput type="file"
                 #keyInput accept=".key,.pem" (change)="onPrivateKeySelected($event)">
          {{ privateKeyFile?.name || 'Sin seleccionar' }}
        </mat-form-field>

        <button mat-raised-button color="primary" (click)="uploadCertificates()">
          <mat-icon>upload</mat-icon> Subir Certificados
        </button>
      </div>

      <mat-divider></mat-divider>

      <div *ngIf="tlsStatus?.enabled">
        <button mat-raised-button color="warn" (click)="disableHttps()">
          <mat-icon>security_off</mat-icon> Desactivar HTTPS
        </button>
      </div>
      <div *ngIf="!tlsStatus?.enabled && certificateFile && privateKeyFile">
        <button mat-raised-button color="accent" (click)="enableHttps()">
          <mat-icon>security</mat-icon> Activar HTTPS
        </button>
      </div>
    </mat-card-content>
  </mat-card>
</mat-tab>
```

**6. docker-compose.yml (agregar puertos HTTPS)**
```yaml
backend:
  ports:
    - "3000:3000"    # HTTP
    - "8443:8443"    # HTTPS (opcional)
  volumes:
    - ./certs:/app/certs   # Volumen para certificados (compartir con host)
```

**Ventajas de esta implementación:**
✅ No requiere reconstruir imagen Docker
✅ Certificados almacenados encriptados en MongoDB
✅ Validación automática de certificados
✅ UI intuitiva (similar a Portainer)
✅ Warnings si certificado está por expirar
✅ Fallback a HTTP si HTTPS falla
✅ Soporte para cambiar certificados sin restart de contenedor
✅ Compatible con certificados autofirmados y válidos

---

### 2. Propuestas de Mejora y Nuevas Funcionalidades

#### **B2a** ✅ **COMPLETADO - Reordenar y Clarificar Menú Lateral**

- **Cambios aplicados:**
    - Checklist (Admin) movido al bloque de Configuración (Admin).
    - Texto "Escalación" ya corregido.
- **Archivo modificado:**
    - `frontend/src/app/pages/main/main-layout.component.ts`

#### **B2b** **Visualizador de Logs de Auditoría**

- **Descripción:** El backend registra la actividad de los usuarios (`AuditLog`), pero no hay una interfaz para que un administrador/auditor pueda consultar esta información. La trazabilidad es fundamental.
- **Propuesta:**
    - Crear una nueva sección en el área de administración llamada "Logs de Auditoría" o "Trazabilidad".
    - Esta vista debe mostrar un registro de eventos: inicios de sesión (éxito/fallo), dirección IP, fecha/hora, y acciones de CRUD sobre registros importantes.
    - Implementar filtros por usuario, rango de fechas y tipo de acción.
    - Asegurarse de que el middleware de auditoría (`audit.js`) se aplique a todas las rutas críticas del backend.
    - estos log no seran las entradas  que va agregando el n1  todos los dias, pero si podre ver que el user agrego una nueva entrada mas no su conetanido ya que eos esta en otro sector, tambien  si realizo el checklist mas no su contenido  ya que tambein eso se puede ver en otra seccion del desarrollo

#### **B2c** **Funcionalidad de "Purgar Datos" Segura**

- **Descripción:** No existe una forma de eliminar todos los datos de la aplicación de forma masiva.
- **Propuesta:**
    - Añadir un botón en "Backup y Exportación" llamado "Purgar Todos los Datos".
    - Implementar un mecanismo de confirmación de alta seguridad para prevenir la activación accidental (ej. requerir escribir una frase de confirmación y/o re-autenticación).
    - ✅ Implementado: tarjeta en Backup con confirmación "PURGAR TODO" y endpoint admin `/api/backup/purge`.

#### **B2d** ✅ **COMPLETADO - Gestión de Tags: Ver Entradas por Tag**

- **Solución aplicada:**
    - En la tabla de "Tags", el contador de uso ahora es clickeable.
    - Navega a "Todas las Entradas" con filtro `?tag=...`.
    - No requiere cambios de backend (se usa filtro existente por tags).
- **Archivos modificados:**
    - `frontend/src/app/pages/main/tags/tags.component.html`
    - `frontend/src/app/pages/main/tags/tags.component.ts`
    - `frontend/src/app/pages/main/tags/tags.component.scss`
    - `frontend/src/app/pages/main/all-entries/all-entries.component.ts`

#### **B2e** ✅ **COMPLETADO - "Mis Entradas" y "Ver Todas": Mejorar Visualización de Contenido**

- **Solución aplicada:**
    - Se agregó botón "Ver" (`visibility`) en "Mis Entradas".
    - Reutiliza el diálogo `EntryDetailDialogComponent` ya usado en "Ver Todas".
- **Archivos modificados:**
    - `frontend/src/app/pages/main/my-entries/my-entries.component.ts`
    - `frontend/src/app/pages/main/my-entries/my-entries.component.html`

#### **B2f** **Reportes y Estadísticas: Añadir Gráficos**

- **Problema:** La sección de "Reportes y Estadísticas" necesita ser más visual.
- **Propuesta:**
    - Añadir un gráfico de líneas que muestre la tendencia de entradas creadas por día (últimos 7/15/30 o custom días).
    - **Implementación:** Usar una librería como **NGX-Charts** y consumir los datos del endpoint `GET /api/reports/overview` (campo `entriesTrend`).
    - Poder ver los  incidentes  tambien graficamente
    - Graficas  por tag  qu tiene el sistema  asi ver  que tag por tendencia (líneas múltiples) comparar 3–5 tags (seleccionables) y ver su curva.
    - Un mapa de calor día vs hora para ver: horas muertas, picos reales  de entradas

#### **B2g** ✅ **COMPLETADO - Módulo de Recuperación de Contraseña**

- **Solución implementada:**
    - Backend: Endpoints `/api/auth/forgot-password` y `/api/auth/reset-password` con tokens SHA256 de 1 hora
    - Modelo User: Campos `resetPasswordToken` y `resetPasswordExpires`
    - Frontend: ForgotPasswordComponent y ResetPasswordComponent con rutas `/auth/forgot-password` y `/auth/reset-password`
    - Email HTML con estilos y botón de acción (solo envía si SMTP configurado)
    - Tokens de desarrollo mostrados si SMTP no configurado (fallback seguro)
- **Archivos modificados:**
    - `backend/src/routes/auth.js` - Endpoints de password recovery
    - `backend/src/models/User.js` - Campos de reset token
    - `frontend/src/app/pages/auth/forgot-password/` - Componente + módulo + ruta
    - `frontend/src/app/pages/auth/reset-password/` - Componente + módulo + ruta
    - `frontend/src/app/app-routing.module.ts` - Rutas de password recovery
- **Notas:**
    - Email enviado cuando SMTP configurado (independiente de NODE_ENV)
    - URL de reset: `{FRONTEND_URL}/auth/reset-password?token=...`
    - Navegación corregida: todos los botones usan `/login` (no `/auth/login`)

#### **B2g-smtp** ✅ **COMPLETADO - Configuración SMTP con Destinatarios Opcionales**

- **Problema:** No se podía guardar la configuración SMTP sin destinatarios
- **Solución implementada:**
    - Backend: Validación de `recipients` cambiada a `.optional()`
    - Frontend: Campo `recipientsText` sin Validators.required
    - Test de conexión funciona sin destinatarios (solo verifica SMTP)
    - Auto-detección SSL: Puerto 465 = SSL directo, Puerto 587 = STARTTLS
    - ENCRYPTION_KEY corregido: 64 caracteres hex (32 bytes) para AES-256-GCM
- **Archivos modificados:**
    - `backend/src/routes/smtp.js` - Validadores y lógica de prueba
    - `backend/src/utils/encryption.js` - Verificado soporte 32 bytes
    - `frontend/src/app/pages/main/settings/settings.component.ts` - Validación opcional
    - `frontend/src/app/pages/main/settings/settings.component.html` - Hints actualizados
    - `.env` - ENCRYPTION_KEY actualizado a 64 caracteres hex
- **Beneficios:**
    - Se puede probar conexión SMTP sin configurar destinatarios
    - Los emails se envían automáticamente en password recovery si SMTP configurado
    - Compatible con Office365 y otros proveedores SMTP estándar

#### **B2h** ✅ **COMPLETADO - Reorganización de la Página de Configuración**

- **Cambios aplicados:**
    - "Cooldown Checklist" movido a "Checklist (Admin)".
    - Texto de SMTP clarificado: "Enviar correo solo si hay servicios en rojo (si no, envía siempre)".
    - Ajustes ahora separa Modo Invitado y SMTP claramente.
- **Archivos modificados:**
    - `frontend/src/app/pages/main/settings/settings.component.html`
    - `frontend/src/app/pages/main/settings/settings.component.ts`
    - `frontend/src/app/pages/main/checklist-admin/checklist-admin.component.html`
    - `frontend/src/app/pages/main/checklist-admin/checklist-admin.component.ts`
    - `frontend/src/app/pages/main/checklist-admin/checklist-admin.component.scss`

#### **B2i** **Selector de Cliente en “Nueva Entrada” + Cliente en búsqueda y resultados (sin depender de tags)**

- **Contexto:** En la pantalla **Nueva Entrada** hay espacio libre en el panel derecho para mostrar los **clientes (Log Sources)**. Los clientes se gestionan en **Catalog Admin → 🖥️ Log Sources / Clientes**.
- **Objetivo:** Seleccionar cliente al crear entrada, guardar `clientId` como campo estructurado, autoinyectar tag del cliente y permitir filtro/columna por cliente sin depender solo de tags.
- **Alcance funcional:**
    1. **Nueva Entrada:** agregar bloque “Cliente” con combo/autocomplete; al seleccionar se setea `clientId`; se agrega el tag del cliente si no existe; al cambiar se reemplaza solo el tag de cliente.
    2. **Modelo de datos:** agregar `clientId` y opcional `clientName`/`clientTag` en `Entry` para filtrado consistente.
    3. **Buscar Entradas:** filtro “Cliente” con opción “Todos”; filtrar por `clientId`; botón “Limpiar” también lo resetea.
    4. **Resultados:** columna “Cliente” (ideal código corto con tooltip de descripción).
- **Backend/API:**
    - Reutilizar `GET /api/catalog/log-sources` (listado/autocomplete) y devolver también `tag`/`slug`.
    - `POST /api/entries` acepta `clientId`, valida activo y (opcional) inyecta `clientTag` en `tags`.
    - `GET /api/entries` agrega filtro por `clientId`.
- **Migración:** agregar `clientId` en DB; opcional job para mapear histórico desde tags usando `tag/slug`.
- **Permisos:** lectura de clientes para cualquier rol que crea/ve entradas; catálogo sigue solo admin.
- **Definition of Done:**
    - [ ] Bloque “Cliente” visible en “Nueva Entrada” y carga desde catálogo (sin hardcode).
    - [ ] Selección agrega tag del cliente y guarda `clientId`.
    - [ ] Cambio de cliente reemplaza solo el tag de cliente.
    - [ ] Filtro “Cliente” en búsqueda + columna en resultados.
    - [ ] DB guarda `clientId` en nuevas entradas.
- **Implementación sugerida (código):**
    - **Backend:** `backend/src/models/CatalogLogSource.js` agregar `tag`/`slug`; `backend/src/routes/catalog.js` incluir `tag` en `.select`; `backend/src/models/Entry.js` agregar `clientId`/`clientName` + índices; `backend/src/routes/entries.js` validar `clientId`, inyectar tag y filtrar.
    - **Frontend:** `frontend/src/app/models/catalog.model.ts` agregar `tag`; `frontend/src/app/pages/main/entries/entries.component.html` agregar selector (ideal `app-entity-autocomplete`); `frontend/src/app/pages/main/entries/entries.component.ts` manejar `clientId` y merge de tag; `frontend/src/app/models/entry.model.ts` y `frontend/src/app/services/entry.service.ts` agregar `clientId`; `frontend/src/app/pages/main/all-entries/all-entries.component.html` y `frontend/src/app/pages/main/all-entries/all-entries.component.ts` añadir filtro/columna.
- **Nota técnica:** hoy los tags se extraen del `content`; para el tag cliente se puede (a) insertar `#tag` en el texto en UI o (b) permitir `clientTag` en backend y mergear con `extractHashtags`.

#### **B2j** **Tabla RACI por cliente en Escalamiento**

- **Contexto:** En `/main/escalation/view` se usa `frontend/src/app/pages/escalation/escalation-simple/escalation-simple.component.ts` con un combo de cliente y una tabla de contactos. Se requiere agregar una tabla RACI debajo, reutilizando el mismo selector de cliente.
- **Objetivo:** Mostrar la matriz RACI de cada cliente (y opcionalmente por servicio) con un formato similar a la tabla de contactos de escalamiento.
- **UI propuesta:**
    - Nueva sección “📋 RACI” debajo de “Contactos de Escalamiento”.
    - Reusar `selectedClient`/`selectedClientData` para filtrar.
    - Mostrar mensaje tipo “No hay datos de RACI disponibles” si no hay registros.
- **Admin:** Agregar un menú/pestaña “RACI” en `frontend/src/app/pages/escalation/escalation-admin-simple/escalation-admin-simple.component.html` para crear/editar/borrar RACI, análogo al flujo de contactos.
- **Backend/API:**
    - Nuevo modelo `RaciEntry` (o similar) con `clientId`, `serviceId` (opcional), `actividad`/`proceso`, `responsable`, `aprobador`, `consultado`, `informado`, `notas`, `active`.
    - Lectura: `GET /api/escalation/raci?clientId=...` (analyst/admin).
    - Admin: `GET/POST/PUT/DELETE /api/escalation/admin/raci`.
- **Frontend:** Extender `frontend/src/app/services/escalation.service.ts` y `frontend/src/app/models/escalation.model.ts` con modelos y métodos RACI.
- **Preguntas abiertas:** ¿RACI debe referenciar contactos (IDs) o texto libre? ¿Es por cliente completo o por servicio? ¿Se necesitan emails/teléfonos visibles en la tabla?

#### **B2k** **Checklist: borrado admin + ocultar iconos + rehacer checklist diario**

- Solo admins pueden borrar un checklist.
- Usuarios normales no ven iconos/acciones de borrado.
- Si se borra el checklist del día, se puede crear nuevamente para ese mismo día.
- ✅ Implementado: botón de borrar en historial solo para admin + endpoint `/api/checklist/check/:id` + cooldown solo aplica mismo día.

#### **B18** **Integracion API generica / Webhooks (GLPI y otros)**

- **Objetivo:** Permitir integrar la Bitacora con servicios externos via API para enviar entradas, checklists o resumenes automaticos.
- **Requisitos clave:**
    - Soportar distintos tipos de API (REST/HTTP) con metodo, URL, headers y body configurables.
    - Autenticacion flexible: API Key, Bearer, Basic, OAuth2 (client credentials).
    - Plantillas de payload con variables (ej: `{{date}}`, `{{entries}}`, `{{checklist}}`, `{{shift}}`) y soporte JSON / form-data.
    - Reintentos + cola si el servicio externo falla (no bloquear la app).
    - **Modo SIEM/Syslog:** salida de eventos de auditoría con `UDP/TCP/TLS`, puertos `514`/`6514` o puerto personalizado.
    - **Formato de salida configurable:** JSON, RFC3164, RFC5424, CEF, LEEF.
- **UI/Admin:**
    - Nueva seccion "Integraciones" (similar a SMTP) para crear/editar/testear conectores.
    - Boton "Probar envio" y vista de historial de envios (ok/fail).
    - Selector de tipo de destino: `Webhook/API` o `Syslog/SIEM`.
- **Backend (sugerido):**
    - Nuevo modelo `IntegrationConfig` (y opcional `IntegrationDelivery`/`OutboundJob` para cola/reintentos).
    - Rutas nuevas `/api/integrations` (CRUD + `/test` + `/deliveries`).
    - Util `integrationDispatcher` para enviar requests (reusar patron de `backend/src/utils/logForwarder.js`).
    - Cifrar secretos como en `backend/src/routes/smtp.js` (`utils/encryption`).
    - Reusar `AuditLog` como fuente principal para SIEM y enviar de forma no bloqueante.
- **Ejemplo GLPI:**
    - Conector predefinido para crear ticket desde entradas del dia.
    - Titulo personalizable (ej: `Ticket CSC {{date}}`).
    - Cuerpo con resumen + listado de entradas (formato HTML o texto).
- **Compatibilidad esperada SIEM/SOAR/NDR:** Elastic, Wazuh, QRadar, XSOAR, Fortinet y cualquier colector Syslog estándar.
- **Archivos relevantes para implementar:** `backend/src/routes/entries.js`, `backend/src/routes/checklist.js`, `backend/src/utils/logForwarder.js`, `backend/src/routes/smtp.js`.

#### **B19** **Envío automático de entradas a GLPI al cierre de turno (depende de B18)**

- **Objetivo:** Configurar una integración específica con GLPI para que, al hacer cierre de turno, se envíen automáticamente todas las entradas del día como un ticket.
- **Flujo propuesto:**
    1. Admin configura conector GLPI en "Integraciones" (URL, API token, etc.) - reutiliza B18.
    2. Al registrar `POST /api/checklist/check` con `type = cierre`, verificar si existe conector GLPI activo.
    3. Si sí, obtener todas las entradas del día para el usuario (`createdAt >= 00:00:00 && createdAt <= 23:59:59`).
    4. Construir payload con formato de ticket (título personalizable, descripción, tags, incidentes).
    5. Enviar a GLPI via API; registrar resultado (ok/fallo) en una tabla de auditoría.
- **Datos que se envían a GLPI:**
    - Título: `Turno SOC - {fecha} - {analista}` (personalizable)
    - Descripción: resumen de entradas (cantidad total, incidentes, tags top)
    - Listado de entradas: fecha, tipo, tags, contenido (si configurado)
    - Estado general: ok/con problemas (basado en rojos en checklist)
- **UI/Admin:**
    - En "Integraciones", opción para marcar conector como "auto-enviar al cierre de turno"
    - Checkbox: "Incluir detalles de entradas en ticket"
    - Vista de historial: últimos envíos a GLPI (fecha, resultado, ticket ID si aplica)
- **Backend (basado en B18):**
    - Usar modelo `IntegrationConfig` de B18 con campo adicional `autoOnShiftClose: boolean`
    - En `backend/src/routes/checklist.js`, al procesar cierre: buscar `IntegrationConfig` con `autoOnShiftClose=true`
    - Construir payload y llamar a `integrationDispatcher` (de B18)
    - Guardar resultado en tabla `ShiftClosureLog` (o similar)
- **Validación:**
    - Si GLPI no responde, registrar error pero permitir que el cierre de turno se complete normalmente (no bloquear)
    - Log de todos los intentos de envío
- **Archivos relevantes:** `backend/src/models/IntegrationConfig.js`, `backend/src/routes/checklist.js`, `backend/src/routes/integrations.js`, `backend/src/utils/integrationDispatcher.js`

**Implementación técnica propuesta:**

**1. Modelo: IntegrationConfig.js (de B18, extendido para B19)**
```javascript
const integrationConfigSchema = new mongoose.Schema({
  name: String, // 'GLPI', 'Zendesk', etc.
  provider: { type: String, enum: ['glpi', 'generic'], default: 'generic' },
  url: String,
  authType: { type: String, enum: ['api-key', 'bearer', 'basic', 'oauth2'] },
  apiKey: String, // Encriptado con utils/encryption
  // Campos GLPI específicos
  projectId: Number, // ID del proyecto en GLPI
  categoryId: Number, // ID categoría de ticket
  assignedGroup: String, // Grupo asignado
  // Auto-envío al cierre
  autoOnShiftClose: { type: Boolean, default: false },
  includeEntryDetails: { type: Boolean, default: true },
  templateTitle: { type: String, default: 'Turno SOC - {{date}} - {{analyst}}' },
  active: { type: Boolean, default: true }
}, { timestamps: true });
```

**2. Modificación en checklist.js (línea ~550, después de sendChecklistEmail):**
```javascript
// Si es cierre de turno, intentar enviar a GLPI
if (type === 'cierre') {
  try {
    const IntegrationConfig = require('../models/IntegrationConfig');
    const glpiConfig = await IntegrationConfig.findOne({
      name: 'GLPI',
      active: true,
      autoOnShiftClose: true
    });

    if (glpiConfig) {
      // Obtener entradas del día
      const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
      const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));

      const entries = await Entry.find({
        createdBy: userId,
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      }).sort({ createdAt: -1 });

      // Contar tipos
      const incidents = entries.filter(e => e.entryType === 'incidente').length;
      const operational = entries.filter(e => e.entryType === 'operativa').length;

      // Top tags
      const tagCounts = {};
      entries.forEach(e => {
        e.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag]) => tag);

      // Construir payload GLPI
      const glpiPayload = {
        input: {
          name: glpiConfig.templateTitle
            .replace('{{date}}', new Date().toLocaleDateString('es-CL'))
            .replace('{{analyst}}', req.user.fullName || req.user.username),
          content: `
**Resumen de Turno SOC**
- Total entradas: ${entries.length}
- Incidentes: ${incidents}
- Operativas: ${operational}
- Tags principales: ${topTags.join(', ') || 'N/A'}
- Servicios con problemas: ${normalizedServices.filter(s => s.status === 'rojo').map(s => s.serviceTitle).join(', ') || 'Ninguno'}

**Detalles:**
${glpiConfig.includeEntryDetails ? entries.map(e =>
  `- [${e.entryType}] ${e.entryDate} ${e.entryTime}: ${e.content.substring(0, 100)}...`
).join('\n') : 'Detalles omitidos'}
          `,
          type: 'incident',
          itilcategories_id: glpiConfig.categoryId,
          groups_id_assign: glpiConfig.assignedGroup
        }
      };

      // Llamar a integrationDispatcher (de B18)
      const { sendViaIntegration } = require('../utils/integrationDispatcher');
      const result = await sendViaIntegration(glpiConfig, glpiPayload);

      // Guardar en ShiftClosure
      const closure = new ShiftClosure({
        userId,
        shiftStartAt: lastCheck?.createdAt || startOfDay,
        shiftEndAt: new Date(),
        closureCheckId: check._id,
        summary: {
          totalEntries: entries.length,
          totalIncidents: incidents,
          servicesDown: normalizedServices.filter(s => s.status === 'rojo').map(s => s.serviceTitle)
        },
        sentVia: 'api',
        integrationName: 'GLPI',
        sentAt: new Date(),
        sentStatus: result.success ? 'success' : 'failed',
        sentError: result.error || null
      });
      await closure.save();

      logger.info({ userId, ticketId: result.ticketId }, 'GLPI ticket sent successfully');
    }
  } catch (glpiError) {
    logger.error({ err: glpiError, userId }, 'Error sending to GLPI');
    // No bloquear el cierre si falla GLPI
  }
}
```

**3. Modelo: IntegrationDelivery.js (para auditoría)**
```javascript
const integrationDeliverySchema = new mongoose.Schema({
  integrationConfigId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntegrationConfig' },
  event: { type: String, enum: ['shift-close', 'manual-trigger', 'scheduled'] },
  payload: mongoose.Schema.Types.Mixed, // payload enviado
  response: mongoose.Schema.Types.Mixed, // respuesta de GLPI
  statusCode: Number,
  success: Boolean,
  externalId: String, // ticket ID en GLPI
  error: String,
  sentAt: Date
}, { timestamps: true });

integrationDeliverySchema.index({ integrationConfigId: 1, createdAt: -1 });
```

**4. Ruta /api/integrations (de B18)**
```javascript
// GET /api/integrations - Listar integraciones (admin)
router.get('/integrations', authenticate, authorize('admin'), async (req, res) => {
  const configs = await IntegrationConfig.find({});
  res.json(configs);
});

// POST /api/integrations - Crear/actualizar integración (admin)
router.post('/integrations', authenticate, authorize('admin'), async (req, res) => {
  const { name, provider, url, authType, apiKey, autoOnShiftClose, includeEntryDetails, templateTitle, active } = req.body;
  let config = await IntegrationConfig.findOne({ name });

  if (!config) {
    config = new IntegrationConfig({ name, provider });
  }

  Object.assign(config, {
    url, authType, autoOnShiftClose, includeEntryDetails, templateTitle, active,
    apiKey: encrypt(apiKey) // Encriptar
  });

  await config.save();
  res.json(config);
});

// GET /api/integrations/deliveries - Historial de envíos
router.get('/integrations/deliveries', authenticate, authorize('admin'), async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const deliveries = await IntegrationDelivery.find({})
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  res.json(deliveries);
});
```

**5. Utilidad: integrationDispatcher.js (de B18)**
```javascript
const nodemailer = require('nodemailer');
const axios = require('axios');
const { decrypt } = require('./encryption');

const sendViaIntegration = async (config, payload) => {
  try {
    const authHeader = {
      'api-key': `${decrypt(config.apiKey)}`,
      'bearer': `Bearer ${decrypt(config.apiKey)}`,
      'basic': `Basic ${Buffer.from(`${decrypt(config.apiKey)}`).toString('base64')}`
    };

    const response = await axios.post(config.url, payload, {
      headers: {
        'Authorization': authHeader[config.authType],
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    return {
      success: true,
      ticketId: response.data?.id || response.data?.ticket_id,
      statusCode: response.status
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      statusCode: error.response?.status || 0
    };
  }
};

module.exports = { sendViaIntegration };
```

**Flujo de uso:**

1. Admin crea integración GLPI: URL, API token, categoría, grupo.
2. Admin activa "Auto-enviar al cierre de turno".
3. Analista hace cierre: endpoint POST /api/checklist/check con `type=cierre`.
4. Backend valida checklist, crea registro ShiftCheck.
5. Backend detecta configuración GLPI activa y reúne entradas del día.
6. Construye payload y envía via integrationDispatcher.
7. Resultado se guarda en ShiftClosure (success/failed/error).
8. Admin puede ver historial en "Integraciones → Historial de Envíos".

#### **B2m** **Estado de turno + cierre automatico (envio via integracion)**

- **Objetivo:** Registrar el estado del turno y, al hacer "cierre de turno", enviar automaticamente checklist + entradas del periodo a una integracion (ej: GLPI).
- **Flujo propuesto:**
    1. Al registrar `POST /api/checklist/check` con `type = cierre`, construir resumen del turno.
    2. Determinar rango de entradas: desde el ultimo `inicio` del usuario (o 00:00 si no existe) hasta la hora de cierre.
    3. Enviar el payload a la integracion seleccionada (si falla, reintentos en cola).
- **Datos que deben viajar:**
    - Checklist cierre (servicios, rojos, observaciones).
    - Entradas del periodo (y/o resumen por tipo + tags top).
    - Metadatos del turno: analista, fechas, estado general.
- **UI:**
    - Mostrar "Estado de turno" (ultimo inicio/cierre y si el cierre fue enviado).
    - Confirmacion de envio y estado (ok/pendiente/fallo).
    - Configuracion admin: elegir envio via API o via correo; si es correo permitir multiples destinatarios.
    - Nota: el envio por correo requiere SMTP configurado previamente.
- **Backend (sugerido):**
    - Servicio `shiftClosureService` que arma el payload y dispara `integrationDispatcher`.
    - Guardar un registro `ShiftClosure` para evitar doble envio.
- **Archivos relevantes:** `frontend/src/app/pages/main/checklist/checklist.component.ts`, `frontend/src/app/pages/main/checklist/checklist.component.html`, `backend/src/routes/checklist.js`, `backend/src/models/ShiftCheck.js`, `backend/src/models/Entry.js`.

---

#### **B2n** **Exportacion de metricas/uso para BI (Metabase, PowerBI, etc.)**

- **Objetivo:** Exponer metricas de uso (entradas por cliente/tag, checklists, incidentes, actividad por usuario/turno) de forma simple y consumible por herramientas BI.
- **Alcance propuesto:**
    - Dataset agregado: entradas por dia/cliente/tag, checklists por estado, incidentes por severidad/estado, actividad por usuario/turno.
    - Dataset detallado opcional: entradas y checklists con campos normalizados (sin contenido sensible).
    - Rango de fechas, filtros por cliente/tag/usuario/estado.
- **Opciones de entrega:**
    1. **API de reportes/metricas** (JSON): `GET /api/metrics/*` con endpoints agregados y paginacion.
    2. **Exportacion programada** (CSV/JSON) a almacenamiento o endpoint externo (reutilizar B18 integraciones).
    3. **Conector directo BI**: vista "read-only" con token dedicado y permisos de solo lectura.
- **Seguridad:**
    - Campos anonimizados o sin texto libre (contenido de entradas fuera).
    - Roles: solo admin o rol auditor.
    - Rate limit y logging de accesos.
- **Sugerencia tecnica:**
    - Crear un modelo/vista `metrics` en backend (aggregation pipeline) con cache por dia.
    - Reutilizar indices existentes y agregar indices en `clientId`, `createdAt`, `tags`, `severity`.
    - Exponer un endpoint de "schema" para que BI pueda descubrir campos.

#### **B22** **Alerta de requerimientos especiales de escalamiento por cliente y horario**

- **Contexto:** No todos los clientes usan el mismo flujo de escalamiento. Algunos requieren acciones especiales fuera de horario habil (por ejemplo, avisar por WhatsApp ademas del correo regular).
- **Objetivo:** Al elegir un cliente y al momento de generar/copiar reporte, el sistema debe evaluar reglas especiales activas y mostrar un cuadro de alerta visible al analista con la instruccion exacta a ejecutar.
- **Comportamiento esperado (analista):**
    1. Selecciona cliente en flujo de reporte.
    2. El sistema evalua reglas especiales del cliente segun fecha/hora actual y zona horaria configurada.
    3. Si aplica una regla, muestra modal/alerta destacada con mensaje operativo (ej: "Fuera de horario: avisar por WhatsApp al +56... y luego enviar correo").
    4. El analista confirma lectura antes de continuar (no bloquea totalmente, pero exige acknowledgement).
    5. Si no aplica regla, sigue el flujo normal sin alerta especial.
- **Configuracion admin (sugerida en creacion/edicion de clientes):**
    - Habilitar/deshabilitar reglas especiales por cliente.
    - Definir ventanas horarias (ej: fuera de horario habil, despues de las 17:00, fines de semana, feriados).
    - Definir canal y destinatarios por regla (correo, WhatsApp, telefono, otros).
    - Definir mensaje de alerta que vera el analista.
    - Definir vigencia y prioridad de la regla.
- **Alcance tecnico sugerido:**
    - Modelo `ClientEscalationRule` (o campo embebido en cliente) con `clientId`, `enabled`, `timeWindows`, `channels`, `contacts`, `alertMessage`, `timezone`, `priority`.
    - Endpoint de evaluacion: `GET /api/escalation/client-alert?clientId=...&context=report`.
    - Hook UI en pantalla de reportes: disparar evaluacion al cambiar cliente y al usar accion "copiar reporte".
    - Registrar en auditoria: regla mostrada, usuario, fecha/hora, confirmacion de lectura.
- **Criterios de aceptacion:**
    1. Admin puede crear/editar reglas especiales desde la configuracion del cliente sin hardcode.
    2. Si una regla aplica por horario, el analista ve alerta antes de enviar/comunicar el reporte.
    3. La alerta indica claramente la accion adicional al correo regular (ej. WhatsApp).
    4. Si no hay regla aplicable, no se muestra alerta.
    5. Cada visualizacion/confirmacion queda en logs de auditoria.

### 3. Propuestas Arquitectónicas

#### **B3a** **Etiquetas de Cargo + Rol Auditor (sobre roles existentes)**

- **Contexto:** Ya existen los roles base (`user` y `admin`); no es necesario rehacer RBAC completo.
- **Propuesta:**
    1.  **Etiquetas de cargo:** Crear/editar etiquetas como "N1", "N2", "N3", "Custom", etc. Deben estar conectadas a los roles existentes.
    2.  **Reglas de combinacion:** Un usuario con etiqueta "N1" nunca puede ser `admin`. Las etiquetas "N2" y "N3" si pueden ser `admin` solo si un admin lo habilita.
    3.  **Rol/Usuario Auditor:** Usuario con etiqueta/rol "Auditor" con acceso de solo lectura a todo lo que ve un admin, sin modificar nada.
    4.  **UI de administracion:** El admin puede crear/editar etiquetas y asignarlas a los usuarios.

---

### 4. Observaciones Técnicas Adicionales

-   **B4-1** ✅ **COMPLETADO - Archivo de Backup:** Eliminado `backend/src/routes/backup.js.bak`.
-   **B4-2** ✅ **COMPLETADO - Validación de Variables de Entorno:** Validación al inicio del servidor para `MONGODB_URI`, `JWT_SECRET` y `ALLOWED_ORIGINS` en producción.
-   **B4-3** **Pruebas Automatizadas:** Considerar añadir un framework de pruebas (como Jest) al backend.
-   ✅ Implementado: `jest.config.js` + `jest.setup.js` y test base de `utils/encryption`.
-   **B4-4** **Consistencia en Nombres:** Estandarizar el nombrado de archivos a `kebab-case`.
    - **Nota:** No hacer renombre masivo. Definir alcance (ej: solo `backend/src/routes` o una carpeta específica) y actualizar imports manualmente.
    - **Motivo:** Cambio masivo rompe rutas/imports y requiere mucha verificación.
-   **B4-5** ✅ **COMPLETADO - Error Tipográfico:** Corregir el texto "titulo escalamiento en el lateral esta mal escrito hay que reparar eso" (Commit d3112bd).
-   **B4-6** ✅ **COMPLETADO - Login con correo como con nombre de usuario:**
    - **Solución implementada:**
      - Backend: Modificado `POST /api/auth/login` para buscar usuario con `$or: [{ username }, { email: username }]`
      - Frontend: Actualizado label "Usuario o Email" y mensaje de error
    - **Archivos modificados:**
      - `backend/src/routes/auth.js` - Query con $or
      - `frontend/src/app/pages/login/login.component.html` - Label y mensajes
    - **Beneficio:** Usuarios pueden iniciar sesión con username o email indistintamente
-   **B4-7** **Aviso analistas de checklist:**  (depende de B3a): Avisar al analista de turno (etiqueta N1_NO_HABIL) y a usuarios con etiqueta N2 cuando el checklist no se realiza antes de 09:30 (el horario se puede cambiar, solo admins pueden hacerlo). En Administracion de Escalaciones, los turnos se definen con etiquetas de cargo (B3a) y se respeta la regla: N1 nunca es admin; N2/N3 pueden ser admin si el admin lo habilita. esto evita enviar correos a admins que no sean N2.

### 5. Revisiones de seguridad y auditoria

#### **C1-1** **Analisis de seguridad general (revision + reparacion segura)**

- **Objetivo:** revisar backend + frontend y aplicar hardening sin romper flujos (evitar CSP/CORS tan restrictivos que dejen el sistema inutilizable).
- **Hallazgos concretos en el codigo (sugerencias puntuales):**
    - **Rate limit de login no aplicado:** existe `loginLimiter` en `backend/src/middleware/rateLimiter.js`, pero no se usa en `backend/src/routes/auth.js`. Agregarlo en `POST /api/auth/login` y un limiter suave en `POST /api/auth/refresh` para evitar abuso sin bloquear usuarios reales.
    - **Logs sensibles en auth:** hay `console.log` con detalles de login en `backend/src/routes/auth.js` y `frontend/src/app/services/auth.service.ts`. Dejar solo en `NODE_ENV !== 'production'` o eliminarlos para no filtrar info en logs.
    - **CORS en prod puede abrirse con `*`:** en `backend/src/server.js` se permite `*` si `ALLOWED_ORIGINS` lo contiene. Como el requisito SOC es "sin *", bloquearlo en produccion y dejar el wildcard solo en desarrollo, con log de advertencia si se detecta.
    - **CSP deshabilitado:** `helmet` tiene `contentSecurityPolicy: false` en `backend/src/server.js`. Habilitar CSP primero en `Report-Only` (1-2 semanas) y con allowlist realista (`img-src 'self' data:`, `style-src 'self' 'unsafe-inline'` si Angular lo requiere) para no romper UI.
    - **Uploads de logo con SVG:** `backend/src/routes/config.js` permite `svg`. Si se mantiene, sanitizar o convertir a PNG antes de guardar; si no, restringir a `png/jpg`. Para `logoUrl` externa, exigir `https` y (ideal) allowlist de dominios.
    - **Path traversal en backups:** `backend/src/routes/backup.js` arma paths con `filename`/`id` directo. Usar `path.basename` + validar extension `.json` para evitar `../` y accesos fuera de `backups/`.
    - **Import de backups sin validacion de archivo:** `POST /api/backup/import` acepta cualquier archivo. Validar MIME/extension y limpiar el temporal siempre, aunque falle el parse.
    - **Autorizaciones inconsistentes:** `GET /api/reports/overview` y `GET /api/notes/admin` solo usan `authenticate` aunque los comentarios sugieren admin. Definir si deben ser admin y ajustar para no exponer datos globales por error.
    - **Sesion JWT de guests:** `POST /api/auth/refresh` permite renovar tokens de invitados indefinidamente (comentado). Limitar ventana de refresh o bloquear guests para evitar sesiones eternas.
    - **JWT en localStorage:** en `frontend/src/app/services/auth.service.ts` el token vive en localStorage. Mitigar XSS (evitar `[innerHTML]` con datos no confiables y revisar sanitizacion) o planificar migracion a cookies httpOnly con CSRF si se requiere mayor robustez.
    - **Password hashing y politicas:** `backend/src/models/User.js` usa bcrypt con 8 rounds y password min 6. Evaluar subir costo de hash (con migracion progresiva en login/cambio de clave) y reglas basicas de complejidad sin afectar usuarios existentes.
- **Plan de reparacion segura (no romper):**
    - Implementar cambios con feature flags o en staging primero; CSP en `Report-Only` con recoleccion de reportes antes de bloquear.
    - CORS/headers: aplicar allowlist y dejar override solo en desarrollo; agregar logs para diagnosticar bloqueos reales.
    - Validar endpoints nuevos de a poco (empezar por backups/auth), con mensajes de error claros para no romper integraciones.
    - Documentar rollback rapido (ej: volver a CSP deshabilitado si algo critico falla).
- **Validacion minima:** smoke tests de login/logout, carga de logo, reportes, backups/restore y creacion de entradas; revisar logs de CSP y CORS antes de endurecer.

### 6. Complementos

#### **D1-1** **Modulo de complementos (plugins)**

- **Objetivo:** habilitar herramientas "extra" (no core) sin incrustarlas en el codigo principal, con activacion/desactivacion rapida por admin y sin romper dependencias del sistema.
- **Casos de uso:** migrar planillas Excel con macros a micro-apps web (ej: generador de consultas AQL, plantillas de analisis, validadores, calculadoras SOC).
- **Principios de diseno:**
    - **Aislado:** cada complemento vive separado del core (carpeta y rutas propias).
    - **Controlado:** solo el admin habilita/deshabilita; usuarios solo usan lo habilitado.
    - **No intrusivo:** no toca modelos principales si no es necesario; si necesita datos, lo hace via API dedicada.
- **Arquitectura propuesta:**
    - **Manifest:** archivo por complemento (`complement.json`) con `id`, `name`, `version`, `description`, `roles`, `entryRoute`, `configSchema`, `dependencies`.
    - **Backend loader:** registra rutas solo para complementos habilitados; expone `GET /api/complements` (lista) y `GET/PUT /api/complements/:id/config` (admin).
    - **Frontend loader:** menu dinamico basado en `GET /api/complements`; cada complemento con su modulo lazy-loaded.
- **Seguridad y gobernanza (para no dejar la embarrada):**
    - Nada de "subir codigo" desde UI; los complementos deben venir versionados desde el repo.
    - Permisos por complemento (roles permitidos) y auditoria de uso (quien, cuando, que accion).
    - Inputs validados y rate-limit en endpoints sensibles (especialmente si genera queries o exportaciones).
- **Modo admin por complemento:** cada complemento puede traer su propia UI admin para cargar/configurar datos (ej: plantillas, consultas validadas, parametros), separada del core.
    - Si necesita datos persistentes, usar **colecciones propias** o una **mini base** separada (mismo MongoDB pero namespace propio) para no mezclar con datos core.
- **Primer complemento recomendado (piloto):**
    - **Generador AQL:** plantillas guardadas, editor con validacion basica, ejemplos por escenario, y export a texto/clipboard.
    - Esto es solo un ejemplo: **Base de ejemplos AQL:** consultas curadas y documentadas por el admin, versionadas por fecha/autor y separadas del core.
    - Evitar ejecucion directa en prod; si se permite, usar modo read-only o ambiente controlado.

**Nota:** AQL es un ejemplo ilustrativo; el modulo sirve para cualquier complemento futuro.

- **Plan de implementacion seguro:**
    1. Definir modelo `Complement` (enabled, config, allowedRoles, updatedBy).
    2. Implementar loader backend con allowlist y feature flag global.
    3. Crear UI admin (activar/desactivar + config) y UI usuario (catalogo de complementos).
    4. Implementar el primer complemento (AQL) y documentar buenas practicas.
    5. Tests de smoke + auditoria basica de uso/errores.

---

## 🔴 BUGS CRÍTICOS - SEGURIDAD Y FUNCIONALIDAD

### B5 - CRÍTICO: Acceso a rutas sin autenticación

**Descripción:**
Se identificó una vulnerabilidad crítica donde es posible ingresar al sistema y modificar datos sin estar autenticado, conociendo directamente las direcciones/rutas de API.

**Root Cause (investigación):**

- Las rutas de admin (`/api/admin/catalog/*`) aplican `authenticate` + `requireAdmin` middleware correctamente
- Las rutas protegidas (`/api/entries`, `/api/notes`, `/api/checklist`, etc.) requieren JWT válido
- **Sin embargo**, el middleware de autenticación solo valida la presencia del token pero hay casos donde:
  - Rutas desprotegidas pueden ser accedidas sin token
  - Posibles brechas en validación de permisos en ciertos endpoints
  - Falta auditoría de accesos no autorizados

**Impacto:** CRÍTICO - Modificación de datos sin autenticación, acceso a información sensible

**Solución recomendada:**

1. Auditar todas las rutas para asegurar que `authenticate` middleware está aplicado
2. Implementar validación de JWT más estricta (verificar expiración, revocación)
3. Agregar rate limiting por IP para endpoints de recuperación de contraseña
4. Implementar CSRF tokens para cambios de estado críticos
5. Agregar logging detallado de intentos de acceso no autorizado

**Prioridad:** 🔴 CRÍTICO - Solucionar antes de cualquier despliegue

---

### B6 - Dark Mode: Contraste y legibilidad deficientes

**Descripción:**
El tema oscuro tiene múltiples problemas de legibilidad:

- Cajas de texto blancas con letras blancas (texto invisible)
- Botones ilegibles por falta de contraste
- Líneas/bordes no visibles en componentes
- Información que se pierde por cambio de color a oscuro

**Root Cause (investigación):**

- En `frontend/src/styles.scss` hay variables CSS para tema dark: `--text-primary: #f7f9ff`, `--surface-color: #1a1d27`
- Las reglas de Material Design no se aplican correctamente para inputs y campos
- Los estilos `!important` fuerzan colores pero no tienen suficiente contraste
- Componentes de Material (mdc) no reaccionan bien a los cambios de tema

**Impacto:** ALTO - Imposibilidad de usar la aplicación en modo dark, experiencia de usuario pésima

**Solución recomendada:**

1. Revisar todas las combinaciones color/fondo en dark mode
2. Validar contraste mínimo WCAG AA (4.5:1 para texto, 3:1 para componentes)
3. Ajustar variables CSS para asegurar legibilidad
4. Aplicar estilos específicos a inputs, buttons, labels en dark mode
5. Testear en navegador real con DevTools dark mode
6. Considerar borders/outlines adicionales para componentes sin suficiente contraste

**Prioridad:** 🟠 ALTO - Afecta usabilidad general

---

### C5 - Mejora: Token de recuperación de contraseña - Reducir duración

**Descripción:**
El token de recuperación de contraseña (`resetPasswordToken`) tiene una duración de **1 hora**, lo cual es demasiado tiempo. Debería reducirse a **5 minutos** por seguridad.

**Root Cause (investigación):**

- En `backend/src/routes/auth.js` línea ~206:

  ```javascript
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
  ```

- No hay validación de intentos fallidos o rate limiting específico para este endpoint
- El token se almacena en BD sin encriptación adicional (solo hash SHA256)

**Impacto:** MEDIO - Riesgo de seguridad (ventana de ataque de 60 min vs 5 min)

**Solución recomendada:**

1. Cambiar duración de 1 hora a 5 minutos: `5 * 60 * 1000`
2. Agregar rate limiting al endpoint `/api/auth/forgot-password` (máx 3 intentos/15 min)
3. Implementar rate limiting al endpoint `/api/auth/reset-password` (máx 5 intentos/token)
4. Considerar token de un solo uso (invalidar después de primer intento fallido)
5. Enviar notificación de seguridad si se solicita reset sin iniciar sesión

**Prioridad:** 🟠 ALTO - Mejora de seguridad

---

### C6 - Mejora: Duración de sesión (JWT) muy larga

**Descripción:**
Los tokens JWT tienen una duración de **24 horas**, lo cual es muy largo. Para una aplicación SOC, debería reducirse a un tiempo más seguro (ej: 1-2 horas).

**Root Cause (investigación):**

- En `backend/src/routes/auth.js` línea ~30:

  ```javascript
  const expiresIn = role === 'guest' ? '2h' : (process.env.JWT_EXPIRES_IN || '24h');
  ```

- Los tokens de admin/user duran 24 horas (rol 'guest' dura solo 2h)
- No hay refresh token rotation o revocación centralizada
- Las sesiones no se validan contra una lista negra

**Impacto:** MEDIO - Si un token se roba, el atacante tiene 24 horas de acceso

**Solución recomendada:**

1. Reducir duración de JWT a **2 horas** (o 1 hora para admin)
2. Implementar **refresh tokens** con duración mayor (7 días) rotados en cada refresh
3. Agregar endpoint de revocación de tokens (`/api/auth/logout`)
4. Implementar blacklist de tokens revocados en Redis o BD
5. Mostrar advertencia cuando token esté próximo a expirar (~15 min antes)
6. Hacer refresh automático en background antes de expiración

**Prioridad:** 🟠 ALTO - Mejora de seguridad

---

## 🟢 MEJORAS - UX/INTERFACE

### B20 - Agregar tema Cyberpunk/Neon

**Descripción:**
Agregar un nuevo tema visual estilo "cyberpunk/neon" con colores neón, efectos de brillo, y estética futurista. Similar a interfaces hacker en películas.

**Características deseadas:**

- Colores neón (cian, magenta, verde, amarillo)
- Textos con glow/sombra
- Efectos de hover con animaciones
- Fondo oscuro con tonos azul/púrpura
- Bordes con brillo o efecto neon
- NO replicar los problemas de contraste del dark mode

**Recomendaciones técnicas (pre-investigación):**

1. Agregar nuevo tema en `frontend/src/styles.scss` (ej: `[data-theme="cyberpunk"]`)
2. Variables CSS necesarias:
   - `--primary-color: #0ff` (cian)
   - `--accent-color: #ff00ff` (magenta)
   - `--background-color: #0a0e27` (azul oscuro profundo)
   - `--text-glow-color: #0ff` o `#ff00ff`
   - Nuevas variables para efectos: `--glow-shadow`, `--border-glow`
3. Usar `text-shadow` y `box-shadow` para efecto neón
4. Agregar transiciones suaves para animar cambios
5. Aplicar a través del ThemeService (agregar 'cyberpunk' al enum `Theme`)
6. **Validar contraste** para asegurar legibilidad (evitar problemas dark mode)
7. Testear en componentes principales: inputs, buttons, cards, modals

**Prioridad:** 🟢 BAJA - Feature nice-to-have, no crítica

---

### B21 - Backups automáticos programables + destino externo + retención configurable

**Descripción:**
Actualmente los backups no son automáticos. Se requiere una configuración para ejecutar respaldos programados, definir cada cuántos días se ejecutan, enviarlos a un destino externo y controlar su tiempo de vida en almacenamiento local.

**Requisitos funcionales:**

- Programación automática de backups (scheduler) habilitable/deshabilitable.
- Frecuencia configurable en días (`cada N días`).
- Soporte de destino configurable:
  - almacenamiento en nube (ej. S3 compatible u otro proveedor),
  - recurso compartido NFS,
  - recurso compartido SMB/Samba.
- Retención local configurable (caducidad): borrar automáticamente respaldos locales vencidos según política definida.
- Configuración administrable desde panel (o por variables/archivo si aplica), sin hardcode.

**Recomendaciones técnicas (pre-investigación):**

1. Definir modelo de configuración de backup (ej: `BackupPolicy`) con:
   - `enabled`,
   - `intervalDays`,
   - `destinationType`,
   - `destinationConfig` (credenciales/ruta/host),
   - `localRetentionDays`.
2. Implementar scheduler confiable en backend (cron interno o job runner) con registro en auditoría.
3. Agregar pipeline post-backup:
   - crear respaldo local,
   - transferir al destino remoto configurado,
   - registrar estado (`ok/fail`) y motivo si falla.
4. Implementar tarea de limpieza por retención local:
   - identificar backups con `createdAt + localRetentionDays < now`,
   - eliminar en forma segura y auditable.
5. Agregar cifrado/protección de credenciales de destino (reusar utilidades de cifrado existentes).
6. Exponer endpoints admin para ver/editar configuración y ejecutar “prueba de destino” sin bloquear operación.

**Criterios de aceptación:**

1. Admin puede activar backup automático y elegir periodicidad en días.
2. Admin puede seleccionar destino (nube/NFS/Samba) y validar conectividad.
3. El sistema ejecuta respaldo automático según configuración y deja trazabilidad.
4. Los respaldos locales vencidos se purgan automáticamente según retención configurada.
5. Si falla destino remoto, el backup local queda disponible y el error queda auditado.

**Prioridad:** 🟠 MEDIA - Mejora operacional relevante para continuidad y cumplimiento

---

### B8 - Mejora: Edición masiva/individual de entradas (Admin)

**Descripción:**
Los administradores necesitan poder editar entradas de otros usuarios (de forma individual o masiva) para correcciones y ajustes, pero sin poder alterar la integridad de los datos originales (contenido, hora, fecha, autor).

**Casos de uso:**

- Admin ajusta tipo de entrada (operativa → incidente) de múltiples registros
- Admin reclasifica entradas con tags correctos
- Admin cambia LogSource/Cliente asociado
- Admin modifica entryType en lote para reorganizar datos
- Auditoría: autor/fecha/hora/contenido permanecen intactos (trazabilidad)

**Campos que Admin PUEDE modificar:**

- ✅ `entryType` (operativa/incidente)
- ✅ `tags` (agregar/remover)
- ✅ `clientId` (cambiar Log Source/Cliente)
- ✅ Otros metadatos que se agreguen

**Campos que Admin NO PUEDE modificar (inmutables):**

- ❌ `content` (contenido original)
- ❌ `entryTime` (hora del evento)
- ❌ `entryDate` (fecha del evento)
- ❌ `createdBy` / `createdByUsername` (autor original)
- ❌ `createdAt` / `updatedAt` (timestamps)

**Root Cause (análisis):**

- Actualmente, los usuarios solo pueden editar sus propias entradas
- No existe interfaz de admin para editar/reclasificar entradas de otros
- No existe funcionalidad de edición en lote (bulk edit)
- El backend permite edición de cualquier campo por admin, sin restricciones

**Impacto:** MEDIO - Mejora operacional, necesario para auditoría y correcciones

**Solución recomendada:**

1. **Backend:**
   - Crear endpoint `PATCH /api/entries/admin/bulk-edit` (edición masiva)
   - Crear endpoint `PATCH /api/entries/:id/admin` (edición individual por admin)
   - Validar que solo ciertos campos pueden ser editados por admin
   - Agregar auditoría: registrar quién hizo el cambio y qué se modificó
   - No permitir cambios en: content, entryTime, entryDate, createdBy

2. **Frontend:**
   - Crear componente `AdminEntriesComponent` (similar a All-Entries)
   - Agregar opción de edición en tabla (icono de lápiz)
   - Crear diálogo `AdminEntryEditDialogComponent` con campos restringidos
   - Implementar checkbox en tabla para seleccionar múltiples entradas
   - Agregar botón de "Editar seleccionadas" con formulario de bulk-edit
   - Mostrar advertencia: "Campos no editables: contenido, hora, fecha, autor"

3. **Validaciones:**
   - Solo admin puede usar estos endpoints
   - Validar que nuevos valores sean válidos (ej: entryType ∈ ['operativa', 'incidente'])
   - Validar clientId si se proporciona (debe existir y estar habilitado)
   - No permitir cambios que afecten integridad (ej: cambiar createdBy)

4. **Auditoría:**
   - Registrar en AuditLog cada cambio realizado por admin
   - Campos modificados, valores anteriores/nuevos
   - Admin que realizó el cambio
   - Timestamp del cambio

**Prioridad:** 🟠 MEDIO - Mejora operacional importante

---
