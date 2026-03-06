<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

### ⏳ Pendientes

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| INFRA-NODE-001 | Pendiente | Infraestructura / Seguridad CRÍTICA | Upgrade Docker Alpine Base (Node 24) | Al cambiar de `node:18-alpine` a `node:24-alpine`, el SO anfitrión salta varias versiones de Alpine Linux, introduciendo **OpenSSL 3.x** y un nuevo compilador `musl libc`. Esto rompe arquitecturas C++ antiguas. Se debe validar rigurosamente la construcción del contenedor para asegurar que la máquina virtual subyacente sigue compilando limpiamente. |
| INFRA-NODE-002 | Pendiente | Backend / Base de Datos CRÍTICA | Compatibilidad Driver MongoDB (Mongoose 8) | Node 24 incluye actualizaciones masivas en V8. Mongoose 8.0.3 tiene un driver nativo de MongoDB en su núcleo. Investigar si el driver oficial actual requiere obligatoriamente un bump de versión a nivel de `package.json` para no perder la conexión al clúster, prevenir memory leaks o caídas de Timeouts (`MongoTimeoutError`). |
| INFRA-NODE-003 | Pendiente | Backend / Seguridad CRÍTICA | Impacto en Motor TLS/SSL (Zero-Leak) | Node 20/22/24 han endurecido radicalmente los defaults criptográficos (ej. deprecación de TLS v1.0/v1.1, suites de cifrado más estrictos). Investigar cómo el nuevo motor asimila nuestro actual listener dinámico de `SNICallback` y `tls.createSecureContext`. Validar que `crypto.createCipheriv` (usado para inyectar credenciales) sigue siendo compatible. |
| INFRA-NODE-004 | Pendiente | Backend / Seguridad ALTA | Revisión de Dependencias Sensibles | Verificar `jsonwebtoken` (firmas HMAC en Node 24), `bcryptjs` (salt generation on new V8), y `express-rate-limit` (gestión de memoria/timers). Un cambio de motor JS puede afectar asincronía y el Event Loop interno de estas librerías. |
| INFRA-NODE-005 | Pendiente | Frontend / Build CRÍTICA | Compatibilidad Webpack/Angular 20 con Node 24 | Angular CLI 20 certifica oficialmente ciertas versiones LTS de Node. Probar agresivamente si `ng build --configuration production` (nuestro builder) sobre `node:24-alpine` explota al minificar código o requiere flags adicionales (ej. `--legacy-peer-deps`), evitando así un desastre de despliegue donde el Frontend no cargue. |
| INFRA-NODE-006 | Pendiente | QA / Pruebas E2E (Sistema Falso Promovido) | Batería de Pruebas de Sistema en Sandbox | Levantar entorno completo (`--force-recreate` en PC desarrollador). Probar: Login/Token, Cifrado de parámetros SMTP/GLPI, Subida de archivos (`multer` Buffer chunks dependientes del SO), Rotación en caliente de SSL (Carga de PEMs en módulo de Seguridad). |
| INFRA-NODE-007 | Pendiente | Despliegue Producción CRÍTICA | Protocolo Zero-Downtime Data / Recreación | El salto EOL exige destruir los contenedores y redes `bridge` actuales pero **conservando el volumen `.data` que aisla MongoDB**. Protocolo: 1) Respaldo Raw DB Externo por precaución; 2) Limpieza agresiva de contenedores huérfanos (`docker system prune -f`); 3) Build No-Cache Front/Back; 4) `Up -d`. |
| B19 | Pendiente | Integraciones | Creación de tickets en GLPI (Correo / API) | Definir flujo final (resumen diario vs evento inmediato), destino y estrategia de reintentos. |
| AI-SUMMARY-001 | Pendiente | IA/Operación ALTA | Módulo de Resumen Ejecutivo Efímero (IA On-Demand) | Integrar Ollama+llama3.2:3b en modo efímero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`, salida editable en campo "Resumen Sugerido por IA" y botón "Generar con IA". |

### ✅ Listas

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
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
| OPS-ASSIGN-009 | Listo | QA/Pruebas MEDIA | Faltan pruebas completas de integración | Compilación frontend OK y refactor a utilities. |
| B28 | Listo | Infraestructura/Seguridad | Configuración HTTPS simplificada | Wizard fluido y seguro implementado en Angular. |
| SEC-HTTPS-ALL | Listo | Seguridad/Operación CRÍTICA | 19 Vulnerabilidades y Fallos de Arquitectura TLS (001 a 019) | Hot-reloading con SNI, volúmenes de Docker estancos, validaciones criptográficas previas a guardado, CORS estricto y UX de 1 paso logrados con 0-downtime. |

---

## Información de Pendientes (solo pendientes)

### B19 - GLPI (Correo/API)

1. Definir modo operativo final: resumen diario o ticket inmediato.
2. Cerrar contrato técnico de integración (`apirest.php`, tokens, sesión, payload y reintentos).
3. Agregar trazabilidad de entrega/fracaso por cada intento de ticket.

### B28 - HTTPS simplificado

1. Mantener flujo mínimo: cargar cert+key, habilitar HTTPS, opcional forzar HTTPS.
2. Evitar estados confusos y falsos positivos en UI.
3. Alinear comportamiento en local, docker y proxy.

### 🔐 INVESTIGACIÓN TLS EN DOCKER (Resultados y Arquitectura)
Tras un análisis profundo del módulo SSL/TLS frente a su comportamiento real en Docker (`server.js` y `config.js`), se han detectado **3 problemas estructurales y arquitectónicos críticos** que impiden su correcto funcionamiento y seguridad:

1. **Riesgo Crítico de Fuga (`SEC-HTTPS-001`)**: Actualmente los certificados (.pem/.key) subidos desde el Admin se guardan en la carpeta web `/uploads/tls`, la cual es servida *públicamente* por el backend. Esto permite extraer la llave privada del SOC con un simple GET. **Solución:** Mapear un nuevo volumen privado en Docker (`./.data/tls:/app/secrets`) e independizarlo totalmente del router de archivos estáticos.
2. **Caídas (Crash) del Contenedor (`SEC-HTTPS-012`, `SEC-HTTPS-013`)**: El backend actual asume que un archivo de texto con la palabra "BEGIN PRIVATE KEY" es mágicamente válido. Al inyectar llaves encriptadas (con passphrase) o certificados que matemáticamente no conectan, Node.js suelta un `Unhandled Exception` al intentar construir el `tls.createSecureContext()`, reiniciando violentamente el contenedor. **Solución:** Implementar cripto-validación *antes* de persistir la configuración en DB.
3. **El Problema del Re-Binding "En Caliente" (`SEC-HTTPS-002`, `SEC-HTTPS-019`)**: Express/Node no maneja bien hacer `server.close()` y volver a hacer `server.listen()` al vuelo. Choca con los sockets abiertos o el Time-Wait TCP de Linux. **Solución Magistral:** Aprovechar el Server Name Indication (`SNICallback`). El servidor HTTPS escuchará el puerto desde que arranca (aunque sin llave), y al recibir la subida de un PEM, cambiamos dinámicamente el "Contexto TLS en Memoria" en menos de 1 milisegundo, inyectando los certificados nuevos en vivo sin tumbar la red entera.

A continuación, el detalle táctico exhaustivo de cada issue levantado para reparar este módulo.

---

### SEC-HTTPS-001 - Exposición de llaves TLS

1. Mover TLS a almacenamiento privado (fuera de `/uploads` a `/app/secrets`).
2. Bloquear cualquier acceso HTTP directo a archivos TLS.
3. Rotar certificados/llaves tras aplicar fix.

### SEC-HTTPS-002 - Aplicación runtime HTTPS (SNI Callback)

1. Implementar `SNICallback` en `https.createServer` para inyectar contexto TLS dinámico.
2. Evitar apagar el puerto (`server.close()`), usando en su lugar hot-reloading de `tls.createSecureContext`.
3. Publicar endpoint de estado real (`httpsReady`, `port`, `lastError`).

### SEC-HTTPS-003 - Frontend sin puertos rígidos

1. Usar `/api` relativo por defecto.
2. Permitir `apiBaseUrl` por `window.__APP_CONFIG__` o build-time env.
3. Documentar despliegue recomendado detrás de reverse proxy.

### SEC-HTTPS-004 - Retry 426 y CORS

1. Quitar header custom de retry y usar `HttpContextToken`.
2. Si se mantiene header, permitirlo explícitamente en `allowedHeaders`.
3. Cubrir con pruebas de flujos `forceHttps=true` en métodos no GET.

### SEC-HTTPS-005 - CORS estricto en producción

1. Aplicar allowlist exacta de orígenes configurados.
2. Eliminar inferencias automáticas por host/protocolo/puertos en producción.
3. Mantener modo flexible solo en desarrollo.

### SEC-HTTPS-006 - Redirección `forceHttps` segura en proxy

1. Construir destino con `X-Forwarded-Host`/`X-Forwarded-Proto` en proxy confiable.
2. Soportar `PUBLIC_HTTPS_PORT` para topologías no estándar.
3. Validar host de destino contra lista permitida.

### SEC-HTTPS-007 - Hardening TLS/cookies

1. Asegurar `COOKIE_SECURE=true` en producción.
2. Endurecer nombre/parámetros de cookie de sesión.
3. Configurar `minVersion` TLS y validar handshake/headers.

### SEC-HTTPS-008 - Puerto HTTPS vs Docker

1. Definir modo oficial: puerto fijo contenedor o realmente configurable.
2. Bloquear en UI cambios incompatibles con despliegue Docker fijo.
3. Mostrar advertencia operativa cuando puerto elegido no sea publicable.

### SEC-HTTPS-009 - Evitar falso positivo al guardar HTTPS

1. Tras guardar, aplicar config y validar bind real del listener.
2. Si falla, devolver error al frontend con causa útil.
3. En frontend, confirmar estado real antes de mostrar éxito.

### SEC-HTTPS-010 - UX progresiva en configuración HTTPS

1. Paso 1: activar HTTPS y subir cert+key.
2. Paso 2: configurar puerto y aplicar.
3. Paso 3: habilitar `forceHttps` solo cuando `httpsReady=true`.

### SEC-HTTPS-011 - Fuente única de verdad HTTPS

1. Definir matriz por entorno (`local`, `docker`, `prod/proxy`).
2. Eliminar hardcodes restantes de puertos en frontend.
3. Añadir validación de drift DB/env al iniciar backend.

### SEC-HTTPS-012 - Validación TLS real (cert/key)

1. Reemplazar validación por texto (`BEGIN ...`) con validación criptográfica real.
2. Al subir o guardar, construir contexto TLS con cert+key y fallar si no son par válido.
3. Reportar error claro al usuario con causa precisa.

Reparación propuesta:

```js
const tls = require('tls');
const validateTlsPair = ({ certPem, keyPem, caPem }) => {
  try {
    tls.createSecureContext({ cert: certPem, key: keyPem, ca: caPem || undefined });
    return null;
  } catch (err) {
    return err.message;
  }
};
```

### SEC-HTTPS-013 - Llaves cifradas (`ENCRYPTED PRIVATE KEY`)

1. Hoy se aceptan en validación pero runtime no envía `passphrase`, por lo que puede fallar con error tipo `cannot`.
2. Definir una política: rechazar llaves cifradas (más simple) o agregar campo passphrase cifrado.
3. Si se rechazan, devolver guía concreta para convertir la llave a formato soportado.

Reparación propuesta (modo simple/estable):

```js
if (pem.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
  throw new Error('Llave privada cifrada no soportada. Sube una llave PEM sin passphrase.');
}
```

### SEC-HTTPS-014 - Limpieza de certificados antiguos

1. Al subir nuevo cert/key/ca, capturar rutas previas.
2. Guardar nueva configuración.
3. Si guarda OK, borrar archivos antiguos reemplazados.
4. Si falla guardado, borrar solo archivos recién subidos.

### SEC-HTTPS-015 - Consistencia de formato TLS

1. Actualmente se permite `.cer` pero la validación exige contenido PEM.
2. Elegir una sola regla: soportar PEM únicamente (`.pem/.crt/.key`) o convertir DER→PEM.
3. Ajustar mensajes de UI/backend para evitar confusión operativa.

### SEC-HTTPS-016 - Habilitación automática con cert+key

1. En upload exitoso de cert+key, marcar `httpsEnabled=true` automáticamente.
2. Aplicar runtime inmediatamente (sin paso manual adicional).
3. Responder con estado real del listener (`httpsReady`, `port`, `lastError`).

### SEC-HTTPS-017 - Validación temprana en UI (archivos)

1. Agregar `accept` a inputs: `.pem,.crt,.key,.cer`.
2. Validar tamaño y extensión en frontend antes de subir.
3. Mostrar errores por campo (cert/key/ca) con mensaje específico.

Reparación propuesta:

```html
<input type="file" accept=".pem,.crt,.key,.cer" />
```

### SEC-HTTPS-018 - Hardening de acción “reset HTTPS/TLS”

1. Mover botón de reset a bloque avanzado colapsable.
2. Reemplazar `window.confirm` por diálogo con confirmación de frase.
3. Auditar explícitamente la operación de reset (actor, timestamp, motivo).

### SEC-HTTPS-019 - Pre-check de puerto antes de persistir

1. Antes de confirmar `PUT /api/config`, validar que el puerto HTTPS objetivo es usable.
2. En Docker/proxy, validar también que el puerto sea publicable/compatible con el modo.
3. Si falla pre-check, no persistir y devolver error accionable.

Reparación propuesta:

```js
const net = require('net');
const isPortFree = (port, host = '0.0.0.0') => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.once('listening', () => srv.close(() => resolve(true)));
  srv.listen(port, host);
});
```

### OPS-ASSIGN-002 - API de asignaciones operativas

1. Backend de turnos no tiene endpoints `/work-shifts/assignments`.
2. Crear CRUD admin para asignaciones:
   - `GET /api/work-shifts/assignments`
   - `POST /api/work-shifts/assignments`
   - `PUT /api/work-shifts/assignments/:id`
   - `DELETE /api/work-shifts/assignments/:id`
3. Responder datos populados (`user`, `shift`) para render inmediato.

### OPS-ASSIGN-003 - Modelo de datos insuficiente para recurrencia

1. `WorkShift` solo soporta `assignedUserId` único y opcional.
2. Agregar modelo `WorkShiftAssignment`:
   - `userId`
   - `workShiftId`
   - `weekdays` (0-6)
   - `active`
   - `validFrom`/`validTo` (opcionales)
3. Mantener herencia de horario desde el turno vinculado.

### OPS-ASSIGN-005 - Refresco en vivo con Observable

1. Reemplazar patrones `setInterval` por `interval(60000).pipe(startWith(0))`.
2. Usar `takeUntil(this.destroy$)` para evitar fugas al destruir componente.
3. Recalcular estado operativo local cada minuto sin recarga de página.

### OPS-ASSIGN-006 - Pipe/utilidad de horario

1. Crear `shift-time` pipe o utility compartida:
   - `toMinutes('HH:mm')`
   - `isOvernight(start,end)`
   - `isActiveNow(start,end,now)`
2. Reutilizarla en tabla, validaciones y estado operativo.

### OPS-ASSIGN-007 - Validación anti-solapamiento

1. Impedir que un mismo usuario quede asignado a dos turnos activos solapados en mismo día.
2. Validar colisión en backend antes de `POST/PUT`.
3. Devolver `409 Conflict` con detalle de asignación que choca.

### OPS-ASSIGN-008 - Timezone operativa consistente

1. `GET /work-shifts/current` usa hora local del servidor.
2. Debe calcularse en la timezone del turno o en una timezone operativa global definida.
3. Estandarizar con `Intl`/`luxon` para evitar drift entre servidor y operación SOC.

### OPS-ASSIGN-009 - Pruebas mínimas obligatorias

1. Caso diurno: 09:00-18:00.
2. Caso nocturno: 20:00-06:00 a las 02:00.
3. Cambio de día: 23:59 a 00:01.
4. Rechazo de solapamiento.
5. Refresco por minuto sin recarga.

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

---

## Orden sugerido de ejecución

1. `SEC-HTTPS-001` (contención y rotación de llaves).
2. `SEC-HTTPS-008` + `SEC-HTTPS-009` (evitar caídas y falsos positivos).
3. `SEC-HTTPS-012` + `SEC-HTTPS-013` + `SEC-HTTPS-015` (validez real de certificados y errores tipo `cannot`).
4. `SEC-HTTPS-016` + `SEC-HTTPS-002` + `SEC-HTTPS-010` + `SEC-HTTPS-017` (flujo simple de habilitación por UI).
5. `SEC-HTTPS-014` + `SEC-HTTPS-018` + `SEC-HTTPS-019` (operación segura y robusta).
6. `SEC-HTTPS-003` + `SEC-HTTPS-005` + `SEC-HTTPS-006` + `SEC-HTTPS-011` + `SEC-HTTPS-004` + `SEC-HTTPS-007` (cierre arquitectura/red/hardening).

## Orden sugerido de ejecución (Asignación Operativa)

1. `OPS-ASSIGN-001` + `OPS-ASSIGN-002` + `OPS-ASSIGN-003` (habilitar base funcional: usuarios + API + modelo).
2. `B29` + `OPS-ASSIGN-006` (construir UI de vinculación y tabla heredando horario).
3. `OPS-ASSIGN-004` + `OPS-ASSIGN-008` (estado operativo correcto con overnight y timezone).
4. `OPS-ASSIGN-010` + `OPS-ASSIGN-005` (consolidado UI correcto + refresco por minuto robusto).
5. `OPS-ASSIGN-007` + `OPS-ASSIGN-009` (consistencia de negocio y pruebas operativas).
