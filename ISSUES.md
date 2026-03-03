<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

### ⏳ Pendientes

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| B19 | Pendiente | Integraciones | Creación de tickets en GLPI (Correo / API) | Definir flujo final (resumen diario vs evento inmediato), destino y estrategia de reintentos. |
| B28 | Pendiente | Infraestructura/Seguridad | Configuración HTTPS simplificada | Flujo mínimo y estable para cert+key + force HTTPS sin complejidad operativa. |
| SEC-HTTPS-001 | Pendiente | Seguridad CRÍTICA | Exposición de llaves TLS por ruta pública `/uploads` | Mover almacenamiento TLS a ruta privada y bloquear exposición pública. |
| SEC-HTTPS-002 | Pendiente | Seguridad/Operación ALTA | Cambios HTTPS no aplican en caliente | Implementar recarga runtime y estado real del listener. |
| SEC-HTTPS-003 | Pendiente | Frontend/Infraestructura ALTA | `environment` con puertos rígidos | Migrar a `/api` relativo o `API_BASE_URL` explícito por entorno. |
| SEC-HTTPS-004 | Pendiente | Frontend/CORS ALTA | Retry 426 con header bloqueable por CORS | Eliminar header custom o permitirlo explícitamente en CORS. |
| SEC-HTTPS-005 | Pendiente | Seguridad ALTA | Política CORS sobre-permisiva en producción | Aplicar allowlist estricta exacta en producción. |
| SEC-HTTPS-006 | Pendiente | Seguridad/Proxy ALTA | `forceHttps` arma URL no confiable detrás de proxy | Resolver con `X-Forwarded-*`, `PUBLIC_HTTPS_PORT` y validación de host. |
| SEC-HTTPS-007 | Pendiente | Hardening HTTPS MEDIA | Endurecimiento TLS/cookies incompleto | Completar defaults seguros de cookies y parámetros TLS. |
| SEC-HTTPS-008 | Pendiente | Infraestructura/Operación ALTA | Puerto HTTPS UI vs Docker fijo | Evitar drift entre puerto DB/UI y mapeo real de contenedor. |
| SEC-HTTPS-009 | Pendiente | UX/Operación ALTA | Guardado HTTPS con falso positivo | Confirmar estado real del listener antes de reportar éxito. |
| SEC-HTTPS-010 | Pendiente | UI/UX MEDIA | Configuración HTTPS sin flujo progresivo | Crear wizard básico por etapas. |
| SEC-HTTPS-011 | Pendiente | Arquitectura MEDIA | Exceso de fuentes de verdad para HTTPS | Definir una única fuente de verdad por entorno y validar consistencia al inicio. |
| SEC-HTTPS-012 | Pendiente | Backend/Validez ALTA | Validación TLS superficial (solo busca texto PEM) | Validar criptográficamente el par cert/key antes de guardar/aplicar. |
| SEC-HTTPS-013 | Pendiente | Backend/Compatibilidad ALTA | Llaves privadas cifradas aceptadas pero no soportadas en runtime | Rechazar llaves cifradas o soportar passphrase de forma segura. |
| SEC-HTTPS-014 | Pendiente | Backend/Operación MEDIA | Reemplazo de certificados no limpia archivos previos | Eliminar o versionar archivos TLS antiguos para evitar acumulación y riesgo. |
| SEC-HTTPS-015 | Pendiente | Backend/UX MEDIA | Regla de formato inconsistente (`.cer` permitido pero se exige PEM) | Alinear extensión permitida con formato real soportado y mensaje de error. |
| SEC-HTTPS-016 | Pendiente | Flujo Producto ALTA | Objetivo “subir certs y habilitar” no se cumple en un solo paso | Auto-habilitar y aplicar HTTPS al subir cert+key válidos. |
| SEC-HTTPS-017 | Pendiente | Frontend/UX MEDIA | Inputs de archivo sin `accept` ni validación temprana | Reducir errores tardíos con filtros de selección y validación cliente básica. |
| SEC-HTTPS-018 | Pendiente | Frontend/Seguridad MEDIA | Acción destructiva de reset demasiado expuesta | Mover a sección avanzada y usar confirmación fuerte (frase). |
| SEC-HTTPS-019 | Pendiente | Backend/Robustez ALTA | Sin pre-check de puerto antes de persistir configuración HTTPS | Validar disponibilidad/alcance del puerto antes de confirmar guardado. |

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
| P1 | Listo | Angular 20 | Plan general actualización | Completo. |

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

### SEC-HTTPS-001 - Exposición de llaves TLS

1. Mover TLS a almacenamiento privado (fuera de `/uploads`).
2. Bloquear cualquier acceso HTTP directo a archivos TLS.
3. Rotar certificados/llaves tras aplicar fix.

### SEC-HTTPS-002 - Aplicación runtime HTTPS

1. Implementar `applyRuntimeSecurityConfig()` para recargar listener sin reinicio.
2. Ejecutar recarga tras cambios de config/certificados.
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

---

## Orden sugerido de ejecución

1. `SEC-HTTPS-001` (contención y rotación de llaves).
2. `SEC-HTTPS-008` + `SEC-HTTPS-009` (evitar caídas y falsos positivos).
3. `SEC-HTTPS-012` + `SEC-HTTPS-013` + `SEC-HTTPS-015` (validez real de certificados y errores tipo `cannot`).
4. `SEC-HTTPS-016` + `SEC-HTTPS-002` + `SEC-HTTPS-010` + `SEC-HTTPS-017` (flujo simple de habilitación por UI).
5. `SEC-HTTPS-014` + `SEC-HTTPS-018` + `SEC-HTTPS-019` (operación segura y robusta).
6. `SEC-HTTPS-003` + `SEC-HTTPS-005` + `SEC-HTTPS-006` + `SEC-HTTPS-011` + `SEC-HTTPS-004` + `SEC-HTTPS-007` (cierre arquitectura/red/hardening).
