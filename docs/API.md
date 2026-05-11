# 🌐 Documentación API - Bitácora SOC

Guía para consumir la API REST del sistema.

> Aviso: Todos los valores de ejemplo son placeholders. Reemplazarlos por credenciales reales desde `.env` antes de usar en producción.
> Estado: El proyecto se encuentra en **beta**; algunos endpoints y flujos pueden evolucionar.

---

## Acceso a Swagger UI

**URL:** `http://IP_SERVIDOR:3000/api-docs`

**Ejemplo:** `http://192.168.100.50:3000/api-docs`

**Contenido:**

- Todos los endpoints documentados
- Schemas completos
- Try it out interactivo

---

## Autenticación

### Modelo principal (Web)

La aplicacion web usa cookie HttpOnly `auth_token` y sesion rehidratada por `GET /api/users/me`.

En frontend Angular, las llamadas se realizan con credenciales (`withCredentials`) y no requieren inyectar el token manualmente en cada request.

### Modelo para clientes API (manual)

Para scripts o integraciones fuera del frontend, se puede usar:

```text
Authorization: Bearer <token_jwt>
```

### Obtener Token

**POST** `/api/auth/login`

```bash
curl -X POST http://192.168.100.50:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "CHANGE_ME"
  }'
```

Notas:

- `username` acepta nombre de usuario o email.
- `CHANGE_ME` es placeholder; usar credencial real de entorno.

**Respuesta:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "675e12345...",
    "username": "admin",
    "email": "admin@example.com",
    "fullName": "Administrador",
    "role": "admin",
    "theme": "dark",
    "guestExpiresAt": null
  }
}
```

**Duración:**

- Admin/User: 4h
- Guest: 2h

### Clock Skew Tolerance

El servidor acepta tokens con diferencia de ±60 segundos (previene errores por desincronización de relojes).

---

## Endpoints Principales

### Endpoints de auth

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login | No |
| POST | `/api/auth/refresh` | Renovar token | No |
| POST | `/api/auth/forgot-password` | Solicitar reseteo | No |
| POST | `/api/auth/reset-password` | Resetear contraseña | No |

### Usuarios

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/users` | Listar usuarios | Admin |
| POST | `/api/users` | Crear usuario | Admin |
| GET | `/api/users/me` | Perfil actual | Todos |
| PUT | `/api/users/me` | Actualizar perfil | Todos |
| PUT | `/api/users/:id` | Actualizar usuario | Admin |
| DELETE | `/api/users/:id` | Eliminar usuario | Admin |

### Entradas

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/entries` | Listar con filtros | Todos |
| POST | `/api/entries` | Crear entrada | Todos |
| GET | `/api/entries/:id` | Obtener por ID | Todos |
| PUT | `/api/entries/:id` | Actualizar | Creador o Admin |
| DELETE | `/api/entries/:id` | Eliminar | Creador o Admin |
| GET | `/api/entries/tags/suggest?q=xxx` | Autocompletar tags | Todos |

### Checklist

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/checklist/services` | Servicios activos | Todos |
| GET | `/api/checklist/services/all` | Todos los servicios | Admin |
| POST | `/api/checklist/services` | Crear servicio | Admin |
| PUT | `/api/checklist/services/:id` | Actualizar servicio | Admin |
| DELETE | `/api/checklist/services/:id` | Eliminar servicio | Admin |
| POST | `/api/checklist/check` | Registrar check | User/Admin |
| GET | `/api/checklist/check/last` | Último check usuario | User/Admin |
| GET | `/api/checklist/check/history` | Historial checks | User/Admin |

### Notas

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/notes/admin` | Nota del administrador | Todos |
| PUT | `/api/notes/admin` | Actualizar nota admin | Admin |
| GET | `/api/notes/personal` | Nota personal | Todos |
| PUT | `/api/notes/personal` | Actualizar nota personal | Todos |

### SMTP

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/smtp` | Obtener config | Admin |
| POST | `/api/smtp` | Guardar config | Admin |
| POST | `/api/smtp/test` | Probar (rate-limited 3/15min) | Admin |

Notas operativas SMTP:

- `GET /api/smtp` devuelve la ultima configuracion guardada aunque este desactivada.
- `POST /api/smtp` acepta `isActive`; cuando se guarda en `false`, la configuracion queda persistida pero sin habilitar envios.
- Si el campo password se deja vacio y ya existe una configuracion previa, el backend reutiliza la contraseña cifrada almacenada.
- Una configuracion SMTP desactivada bloquea el envio real de correos hasta reactivarse.

### Reportes

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/reports/overview?days=30` | KPIs generales | Admin |
| GET | `/api/reports/export-entries?startDate=...&endDate=...` | Export CSV | Admin |
| GET | `/api/reports/tags-trend?days=30&tags=a,b` | Tendencia de tags | Admin/User |
| GET | `/api/reports/heatmap?days=30` | Mapa de calor día/hora | Admin/User |
| GET | `/api/reports/entries-by-logsource?days=30` | Entradas por Log Source | Admin/User |
| POST | `/api/reports/newsletter/send` | Envío de boletín 1:1 por destinatario | Admin/User autenticado |

Notas operativas de boletín:

- El endpoint envía un correo por destinatario (privacidad por diseño, sin envío masivo en copia).
- Requiere `html` del boletín y arreglo `recipients`.
- Acepta opcionalmente `cc[]` para copias internas compartidas; cada correo 1:1 hereda ese `CC` filtrando auto-copias del destinatario principal.
- Puede responder mezcla de éxitos/fallos (`successCount`, `failCount`).
- Si no hay éxitos y sí fallos SMTP, retorna error con `detail` para diagnóstico.

Estado IA (planificado):

- Aún no existe endpoint público de resumen IA para boletín en esta versión.
- El diseño objetivo de `AI-SUMMARY-001` está detallado en `docs/ISSUES.md` (preparación).

### Configuración

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/config` | Config general | Todos |
| PUT | `/api/config` | Actualizar config | Admin |
| POST | `/api/config/logo` | Subir logo | Admin |
| GET | `/api/config/logo` | Obtener logo (público) | No |
| GET | `/api/config/favicon` | Obtener favicon (público) | No |
| POST | `/api/config/favicon` | Subir favicon | Admin |

### Backup

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/backup/config` | Obtener config de backups automáticos | Admin |
| PUT | `/api/backup/config` | Guardar config de backups automáticos | Admin |
| POST | `/api/backup/test-auto` | Ejecutar prueba de backup automático | Admin |
| GET | `/api/backup/history` | Historial de backups | Admin |
| POST | `/api/backup/create` | Crear backup ZIP completo | Admin |
| POST | `/api/backup/restore` | Restaurar backup ZIP o JSON | Admin |
| GET | `/api/backup/download/:filename` | Descargar backup ZIP o JSON legacy | Admin |
| GET | `/api/backup/export/:type` | Exportar CSV | Admin |
| POST | `/api/backup/import` | Importar backup ZIP o JSON | Admin |
| POST | `/api/backup/purge` | Purgar datos (con confirmación) | Admin |
| DELETE | `/api/backup/:id` | Eliminar backup | Admin |

Notas operativas de backup:

- Los ZIP completos cubren base de datos + `uploads/` + `secrets/` + `global/` si existe en la instancia.
- `POST /api/backup/import` acepta `multipart/form-data` y puede recibir `clearBeforeRestore=true` junto al archivo.
- `POST /api/backup/purge` limpia tambien el filesystem restaurable del Core y recrea la cuenta admin por defecto desde `.env`.

### Logging (SIEM)

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/logging/config` | Config forwarding | Admin |
| PUT | `/api/logging/config` | Actualizar config | Admin |
| POST | `/api/logging/test` | Probar conexión SIEM | Admin |
| GET | `/api/logging/configs` | Listar integraciones SIEM/SOAR/NDR | Admin |
| POST | `/api/logging/configs` | Crear integración | Admin |
| PUT | `/api/logging/configs/:id` | Actualizar integración | Admin |
| DELETE | `/api/logging/configs/:id` | Eliminar integración | Admin |
| POST | `/api/logging/configs/:id/test` | Probar integración específica | Admin |

### GLPI

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/glpi/config` | Obtener configuración GLPI | Admin |
| PUT | `/api/glpi/config` | Guardar configuración GLPI | Admin |
| POST | `/api/glpi/test` | Probar conexión GLPI (API/correo) | Admin |

### Audit Logs

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/audit-logs` | Listar logs de auditoría | Admin/Auditor |
| GET | `/api/audit-logs/events` | Eventos disponibles | Admin/Auditor |
| GET | `/api/audit-logs/stats` | Estadísticas de auditoría | Admin/Auditor |

### Turnos de Trabajo

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/work-shifts` | Listar turnos | Todos |
| GET | `/api/work-shifts/current` | Turno actual | Todos |
| POST | `/api/work-shifts` | Crear turno | Admin |
| PUT | `/api/work-shifts/:id` | Actualizar turno | Admin |
| DELETE | `/api/work-shifts/:id` | Eliminar turno | Admin |
| PUT | `/api/work-shifts/reorder` | Reordenar | Admin |
| POST | `/api/work-shifts/:id/send-report` | Enviar reporte | Admin |

### Complementos (Admin)

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/complements` | Listar complementos registrados | Admin |
| POST | `/api/complements` | Registrar complemento | Admin |
| GET | `/api/complements/:slug` | Ver detalle del complemento si el usuario tiene acceso | Autenticado |
| PUT | `/api/complements/:slug` | Actualizar configuración/permisos | Admin |
| POST | `/api/complements/:slug/test` | Ejecutar prueba de health-check | Admin |
| POST | `/api/complements/:slug/token` | Regenerar Application Token | Admin |
| DELETE | `/api/complements/:slug` | Ejecutar wipe-out completo | Admin |
| GET | `/api/complements/active` | Listar complementos activos para UI | Todos |
| GET | `/api/complements/:slug/browser-state` | Leer estado compartido de navegador del complemento | Autenticado con acceso |
| PUT | `/api/complements/:slug/browser-state` | Guardar estado compartido de navegador del complemento | Autenticado con acceso |
| GET | `/api/complements/source/limits` | Consultar límites del analizador ZIP | Admin |
| POST | `/api/complements/source/validate` | Analizar ZIP y detectar stack soportado | Admin |
| POST | `/api/complements/source/preview` | Generar preview temporal del ZIP | Admin |
| POST | `/api/complements/source/publish` | Publicar ZIP estático y crear/actualizar complemento | Admin |

### API Interna (Complementos)

Autenticación: `Authorization: Bearer <application_token>`

Notas operativas:

- El token es independiente de la cookie `auth_token` usada por la web.
- `v1` es la única versión funcional hoy.
- `v2` existe como placeholder y hoy responde `501` en `/api/internal/v2/context`.

| Método | Endpoint | Scope | Descripción |
|--------|----------|-------|-------------|
| GET | `/api/internal/versions` | - | Discovery de versiones disponibles |
| GET | `/api/internal/v1/context` | `READ_CONTEXT` | Contexto de turno activo |
| POST | `/api/internal/v1/log-entry` | `WRITE_ENTRIES` | Crear entrada marcada con `ownerComplementId` |
| GET | `/api/internal/v1/query-general` | `READ_LOGS` | Consultar colección autorizada |
| POST | `/api/internal/v1/storage` | `WRITE_STORAGE` | Guardar registro en almacenamiento compartido |
| GET | `/api/internal/v1/storage` | `READ_STORAGE` | Leer almacenamiento propio |
| POST | `/api/internal/v1/log` | `WRITE_LOGS` | Centralizar log del complemento en `AuditLog` |

Headers de versión:

```text
X-API-Version: v1
X-API-Latest: v1
```

La guía completa del módulo está en `docs/COMPLEMENTS.md`.

### Escalación

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/escalation/view/:serviceId` | Vista escalación por servicio | Todos |
| GET | `/api/escalation/clients` | Clientes activos | Todos |
| GET | `/api/escalation/services` | Servicios (por cliente) | Todos |
| GET | `/api/escalation/contacts` | Contactos públicos | Todos |
| GET | `/api/escalation/internal-shifts` | Turnos internos actuales | Todos |
| GET | `/api/escalation/raci` | Matriz RACI por cliente/servicio | Todos |

**Admin CRUD:**
- `/api/escalation/admin/clients`
- `/api/escalation/admin/services`
- `/api/escalation/admin/contacts`
- `/api/escalation/admin/raci`
- `/api/escalation/admin/rules`
- `/api/escalation/admin/cycles`
- `/api/escalation/admin/assignments`
- `/api/escalation/admin/overrides`
- `/api/escalation/admin/external-people`

---

## Ejemplos cURL

### Crear Entrada Operativa

```bash
TOKEN="eyJhbGciOiJIUzI1NiIs..."  # Tu token

curl -X POST http://192.168.100.50:3000/api/entries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "content": "Revisión de alertas en #Trellix. Todo operativo. Se identificó falso positivo en regla #FW-001. #hunting",
    "entryType": "operativa",
    "entryDate": "2025-12-17",
    "entryTime": "14:30"
  }'
```

**Respuesta:**
```json
{
  "message": "Entrada creada exitosamente",
  "entry": {
    "_id": "675e123...",
    "content": "Revisión de alertas en #Trellix...",
    "entryType": "operativa",
    "entryDate": "2025-12-17T00:00:00.000Z",
    "entryTime": "14:30",
    "tags": ["trellix", "fw-001", "hunting"],
    "createdBy": "675e...",
    "createdByUsername": "admin",
    "isGuestEntry": false,
    "createdAt": "2025-12-17T14:30:00.000Z"
  }
}
```

### Registrar Checklist Inicio

```bash
curl -X POST http://192.168.100.50:3000/api/checklist/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "type": "inicio",
    "services": [
      {
        "serviceId": "675e1234567890abcdef1234",
        "serviceTitle": "QRadar",
        "status": "verde",
        "observation": ""
      },
      {
        "serviceId": "675e1234567890abcdef1235",
        "serviceTitle": "Zabbix",
        "status": "rojo",
        "observation": "Alerta de CPU en servidor prod-01. Escalado a infra. Ticket #12345."
      },
      {
        "serviceId": "675e1234567890abcdef1236",
        "serviceTitle": "Wazuh",
        "status": "verde",
        "observation": ""
      }
    ]
  }'
```

**Respuesta:**
```json
{
  "message": "Checklist registrado exitosamente",
  "check": {
    "_id": "675e456...",
    "userId": "675e...",
    "username": "admin",
    "type": "inicio",
    "services": [...],
    "hasRedServices": true,
    "checkDate": "2025-12-17T14:00:00.000Z"
  }
}
```

### Listar Entradas con Filtros

**Filtros disponibles:**
- `page`, `limit` (paginación)
- `search` (búsqueda texto completo)
- `tags` (ej: `trellix,hunting`)
- `entryType` (`operativa` o `incidente`)
- `startDate`, `endDate` (formato ISO8601)
- `userId` (solo admin)

**Ejemplo: Incidentes con tag 'malware' últimos 7 días**

```bash
START_DATE=$(date -d '7 days ago' +%Y-%m-%d)
END_DATE=$(date +%Y-%m-%d)

curl -X GET "http://192.168.100.50:3000/api/entries?entryType=incidente&tags=malware&startDate=${START_DATE}&endDate=${END_DATE}&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:**
```json
{
  "entries": [
    {
      "_id": "675e...",
      "content": "Detección de malware en estación WS-045...",
      "entryType": "incidente",
      "tags": ["malware", "trellix", "respuesta"],
      "createdByUsername": "admin",
      "createdAt": "2025-12-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 3,
    "totalEntries": 45,
    "limit": 20
  }
}
```

### Probar Configuración SMTP

```bash
curl -X POST http://192.168.100.50:3000/api/smtp/test \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (éxito):**
```json
{
  "message": "Email de prueba enviado exitosamente",
  "recipient": "soc@example.com"
}
```

**Respuesta (error):**
```json
{
  "message": "Error al enviar email de prueba",
  "error": "Invalid login: 535 Authentication failed"
}
```

### Obtener Reportes

```bash
curl -X GET "http://192.168.100.50:3000/api/reports/overview?days=30" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:**
```json
{
  "summary": {
    "totalEntries": 450,
    "totalIncidents": 23,
    "totalOperational": 427,
    "activeUsers": 5,
    "totalChecks": 120
  },
  "incidentsByUser": [
    {"username": "juan", "count": 12},
    {"username": "maria", "count": 8}
  ],
  "topTags": [
    {"tag": "trellix", "count": 89},
    {"tag": "hunting", "count": 56}
  ],
  "checksByService": [
    {"service": "QRadar", "totalReds": 3},
    {"service": "Zabbix", "totalReds": 8}
  ]
}
```

### Configurar Log Forwarding (SIEM)

```bash
curl -X PUT http://192.168.100.50:3000/api/logging/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "enabled": true,
    "host": "10.0.101.200",
    "port": 5140,
    "mode": "tls",
    "tls": {
      "rejectUnauthorized": true
    },
    "forwardLevel": "audit-only",
    "retry": {
      "enabled": true,
      "maxRetries": 5,
      "backoffMs": 1000
    }
  }'
```

---

## Paginación

**Query params:**
- `page`: Número de página (default: 1)
- `limit`: Items por página (default: 20, máx: 100)

**Respuesta incluye:**
```json
{
  "entries": [...],
  "pagination": {
    "currentPage": 2,
    "totalPages": 10,
    "totalEntries": 195,
    "limit": 20
  }
}
```

---

## Rate Limiting

### Límites por Endpoint

| Endpoint | Límite | Ventana |
|----------|--------|---------|
| `/api/auth/login` | 5 intentos | 15 min |
| `/api/smtp/test` | 3 intentos | 15 min |
| `/api/**` (general) | 100 requests | 15 min |

### Headers de Rate Limit

**Respuesta incluye:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1702814400
```

### Respuesta 429 (Too Many Requests)

```json
{
  "message": "Too many requests, please try again later."
}
```

### Reinicio operativo de contadores (sin reiniciar el proceso)

Solo disponible si en el backend está definida la variable de entorno `RATE_LIMIT_RESET_SECRET` como **cadena de texto de al menos 24 caracteres** (no es un número: suele generarse con `openssl rand -base64 32`, resultado alfanumérico + símbolos Base64). Si no cumple, la ruta se comporta como no existente (`404`).

| Método | Ruta | Autenticación |
|--------|------|----------------|
| `POST` | `/api/system/rate-limit-reset` | Cabecera `X-Rate-Limit-Reset-Secret` igual al valor de `RATE_LIMIT_RESET_SECRET` |

**Cuerpo JSON (elige uno):**

- `{"ip":"<IPv4|IPv6>"}` — Limpia el bucket del limiter global de API para esa IP. Opcional: `"username":"correo@dominio"` para limpiar también el limiter de login asociado a `ip:usuario`.
- `{"all":true}` — Vacía **todo** el store en memoria del limiter global de API (p. ej. cuando no tienes la IP del cliente o muchas personas comparten la misma IP pública).

**Respuestas frecuentes:** `200` + `{ "ok": true, "reset": [...] }`; `400` si falta `ip` válida y no enviaste `all:true`; `403` si el secreto en cabecera no coincide; `404` si el endpoint está deshabilitado (secret ausente o corto).

Referencia de seguridad y buenas prácticas del secreto: `docs/SECURITY.md` (Rate limiting). Caso de uso / falsos positivos: `docs/ISSUES.md` (SEC-RL-018).

---

## Errores Estándar

### Formato de Error

```json
{
  "message": "Descripción del error",
  "errors": [
    {
      "field": "entryType",
      "message": "Tipo de entrada inválido"
    }
  ]
}
```

### Códigos HTTP

| Código | Descripción |
|--------|-------------|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request (validación fallida) |
| 401 | Unauthorized (sin token o token inválido) |
| 403 | Forbidden (sin permisos) |
| 404 | Not Found |
| 409 | Conflict (duplicado) |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

### Ejemplo: Validación Fallida

**Request:**
```bash
curl -X POST http://192.168.100.50:3000/api/entries \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content": ""}'
```

**Respuesta 400:**
```json
{
  "message": "Errores de validación",
  "errors": [
    {
      "field": "content",
      "message": "El contenido es requerido"
    },
    {
      "field": "entryType",
      "message": "El tipo de entrada es requerido"
    }
  ]
}
```

---

## Correlation ID (X-Request-Id)

Cada request tiene un UUID único para tracing:

**Request:**
```bash
curl -X POST http://192.168.100.50:3000/api/entries \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Request-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{...}'
```

**Response incluye:**
```
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

Si no envías X-Request-Id, el backend genera uno automáticamente.

**Uso:**
- Debugging
- Logs correlacionados
- Tracing end-to-end

---

## CORS

**Orígenes permitidos:** Configurados en `backend/.env`

```env
ALLOWED_ORIGINS=http://192.168.100.50:4200,http://192.168.1.100:4200
```

**Headers permitidos:**
- Authorization
- Content-Type
- X-Request-Id

**Credentials:** `true` (cookies permitidas)

---

## Timezone

**Todas las fechas en respuesta:** ISO8601 con timezone UTC

**Ejemplo:**
```json
"createdAt": "2025-12-17T14:30:00.000Z"
```

**Backend interno:** America/Santiago (Chile)

**Conversión automática:** Backend convierte a UTC para respuestas API

---

## Schemas

Ver Swagger UI para schemas completos:
- User
- Entry
- ShiftCheck
- Service
- AdminNote
- PersonalNote
- SmtpConfig
- AppConfig

**URL:** `http://IP_SERVIDOR:3000/api-docs` → Components → Schemas

---

## Testing con Postman

1. **Importar colección:**
   - Swagger URL: `http://192.168.100.50:3000/api-docs`
   - Postman → Import → Link → Pegar URL

2. **Configurar Environment:**
   - Variable: `baseUrl` = `http://192.168.100.50:3000/api`
   - Variable: `token` = `<tu_token_jwt>`

3. **Pre-request script (Auth):**
   ```javascript
   pm.request.headers.add({
     key: 'Authorization',
     value: 'Bearer ' + pm.environment.get('token')
   });
   ```

---

## Referencias

- **Swagger UI:** `http://IP_SERVIDOR:3000/api-docs`
- **Health Check:** `http://IP_SERVIDOR:3000/health`
- **Instalación:** [SETUP.md](./SETUP.md)
- **Operación:** [RUNBOOK.md](./RUNBOOK.md)
- **Logging:** [LOGGING.md](./LOGGING.md)
