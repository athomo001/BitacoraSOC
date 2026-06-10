# Documentación de la API

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

### Autenticación con Proveedor Externo (SSO)

**POST** `/api/auth/sso`

Permite iniciar sesión utilizando tokens válidos de Google o Microsoft.

```bash
curl -X POST http://192.168.100.50:3000/api/auth/sso \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "token": "ID_TOKEN_PROVISTO_POR_EL_PROVEEDOR"
  }'
```

**Respuesta (Login Exitoso sin MFA):**
Igual a `/api/auth/login`.

**Respuesta (Login con MFA Pendiente):**
HTTP `200 OK`
```json
{
  "mfaPending": true,
  "userId": "675e12345...",
  "message": "Se requiere código TOTP de verificación"
}
```

### Configuración e Inicialización de MFA

**POST** `/api/auth/mfa/setup` (Autenticado)

Genera la clave secreta TOTP y los códigos de recuperación si el usuario no tiene MFA configurado.

```bash
curl -X POST http://192.168.100.50:3000/api/auth/mfa/setup \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCode": "data:image/png;base64,iVBORw0KGgo...",
  "backupCodes": [
    "1234-5678",
    "9012-3456"
  ]
}
```

**POST** `/api/auth/mfa/verify` (Autenticado)

Verifica y activa definitivamente el MFA para la cuenta utilizando el primer código temporal.

```bash
curl -X POST http://192.168.100.50:3000/api/auth/mfa/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "code": "123456"
  }'
```

**Respuesta:**
```json
{
  "message": "Autenticación de doble factor configurada exitosamente"
}
```

**POST** `/api/auth/mfa/validate`

Valida el código TOTP temporal para finalizar el inicio de sesión cuando se recibió el estado `mfaPending`.

```bash
curl -X POST http://192.168.100.50:3000/api/auth/mfa/validate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "675e12345...",
    "code": "123456"
  }'
```

**Respuesta:**
Retorna la cookie de sesión `auth_token` y el objeto usuario idéntico a `/api/auth/login`.

---

## Endpoints Principales (Autogenerado)

### Módulo: admin-catalog

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| POST | `/api/admin-catalog/events` | Todos |
| PUT | `/api/admin-catalog/events/:id` | Todos |
| DELETE | `/api/admin-catalog/events/:id` | Todos |
| GET | `/api/admin-catalog/events` | Todos |
| POST | `/api/admin-catalog/events/import` | Todos |
| POST | `/api/admin-catalog/log-sources` | Todos |
| PUT | `/api/admin-catalog/log-sources/:id` | Todos |
| DELETE | `/api/admin-catalog/log-sources/:id` | Todos |
| GET | `/api/admin-catalog/log-sources` | Todos |
| POST | `/api/admin-catalog/operation-types` | Todos |
| PUT | `/api/admin-catalog/operation-types/:id` | Todos |
| DELETE | `/api/admin-catalog/operation-types/:id` | Todos |
| GET | `/api/admin-catalog/operation-types` | Todos |

### Módulo: audit-logs

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/audit-logs` | Autenticado |
| GET | `/api/audit-logs/export` | Autenticado |
| GET | `/api/audit-logs/events` | Autenticado |
| GET | `/api/audit-logs/stats` | Autenticado |

### Módulo: auth

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| POST | `/api/auth/login` | Todos |
| POST | `/api/auth/refresh` | Todos |
| POST | `/api/auth/logout` | Todos |
| POST | `/api/auth/forgot-password` | Todos |
| POST | `/api/auth/reset-password` | Todos |
| POST | `/api/auth/sso` | Todos |
| POST | `/api/auth/mfa/setup` | Autenticado |
| POST | `/api/auth/mfa/verify` | Autenticado |
| POST | `/api/auth/mfa/validate` | Todos |

### Módulo: backup

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/backup/config` | Admin |
| PUT | `/api/backup/config` | Admin |
| POST | `/api/backup/test-auto` | Admin |
| GET | `/api/backup/history` | Admin |
| POST | `/api/backup/create` | Admin |
| POST | `/api/backup/restore` | Admin |
| GET | `/api/backup/download/:filename` | Admin |
| GET | `/api/backup/export/:type` | Admin |
| POST | `/api/backup/import` | Todos |
| POST | `/api/backup/purge` | Admin |
| DELETE | `/api/backup/:id` | Admin |

### Módulo: catalog

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/catalog/events` | Autenticado |
| GET | `/api/catalog/log-sources` | Autenticado |
| GET | `/api/catalog/operation-types` | Autenticado |

### Módulo: checklist

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/checklist/templates/active` | Autenticado |
| GET | `/api/checklist/templates` | Admin |
| POST | `/api/checklist/templates` | Todos |
| PUT | `/api/checklist/templates/:id` | Todos |
| DELETE | `/api/checklist/templates/:id` | Admin |
| PUT | `/api/checklist/templates/:id/activate` | Admin |
| PUT | `/api/checklist/templates/:id/deactivate` | Admin |
| GET | `/api/checklist/services` | Autenticado |
| GET | `/api/checklist/services/all` | Admin |
| POST | `/api/checklist/services` | Todos |
| PUT | `/api/checklist/services/:id` | Todos |
| DELETE | `/api/checklist/services/:id` | Admin |
| POST | `/api/checklist/audit-event` | Todos |
| POST | `/api/checklist/check` | Todos |
| GET | `/api/checklist/check/last` | Autenticado |
| GET | `/api/checklist/check/history` | Autenticado |
| GET | `/api/checklist/alerts/weekly-log` | Admin |
| DELETE | `/api/checklist/check/:id` | Admin |
| POST | `/api/checklist/closure` | Todos |
| GET | `/api/checklist/closures` | Todos |

### Módulo: complements

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/complements/active` | Autenticado |
| GET | `/api/complements/:slug/browser-state` | Autenticado |
| PUT | `/api/complements/:slug/browser-state` | Autenticado |
| GET | `/api/complements/source/limits` | Admin |
| POST | `/api/complements/source/validate` | Admin |
| POST | `/api/complements/source/preview` | Admin |
| POST | `/api/complements/source/publish` | Admin |
| GET | `/api/complements/:slug` | Autenticado |
| GET | `/api/complements` | Todos |
| POST | `/api/complements` | Todos |
| PUT | `/api/complements/:slug` | Todos |
| POST | `/api/complements/:slug/test` | Todos |
| POST | `/api/complements/:slug/token` | Todos |
| DELETE | `/api/complements/:slug` | Todos |

### Módulo: config

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/config` | Autenticado |
| PUT | `/api/config` | Todos |
| POST | `/api/config/security/certificates` | Todos |
| DELETE | `/api/config/security/certificates` | Todos |
| GET | `/api/config/logo` | Todos |
| GET | `/api/config/favicon` | Todos |
| POST | `/api/config/logo` | Todos |
| DELETE | `/api/config/logo` | Todos |
| POST | `/api/config/favicon` | Todos |
| DELETE | `/api/config/favicon` | Todos |
| GET | `/api/config/debug/check` | Admin |
| GET | `/api/config/shift-reminders` | Admin |
| POST | `/api/config/shift-reminders` | Admin |
| PUT | `/api/config/shift-reminders/:id` | Admin |
| DELETE | `/api/config/shift-reminders/:id` | Admin |

### Módulo: directory

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/directory/search` | Autenticado |
| POST | `/api/directory/rebuild-from-escalation` | Admin |
| POST | `/api/directory/merge-duplicates` | Autenticado |
| POST | `/api/directory/sync-users-from-directory` | Autenticado |
| GET | `/api/directory` | Autenticado |
| GET | `/api/directory/:id` | Autenticado |
| POST | `/api/directory` | Autenticado |
| PUT | `/api/directory/:id` | Autenticado |
| DELETE | `/api/directory/:id` | Autenticado |

### Módulo: entries

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| POST | `/api/entries` | Todos |
| GET | `/api/entries` | Todos |
| GET | `/api/entries/:id` | Autenticado |
| PUT | `/api/entries/:id` | Todos |
| DELETE | `/api/entries/:id` | Autenticado |
| GET | `/api/entries/tags/suggest` | Autenticado |
| PUT | `/api/entries/admin/edit` | Todos |

### Módulo: escalation

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/escalation/view/:serviceId` | Autenticado |
| GET | `/api/escalation/clients` | Autenticado |
| GET | `/api/escalation/services` | Autenticado |
| GET | `/api/escalation/contacts` | Autenticado |
| GET | `/api/escalation/internal-shifts` | Autenticado |
| GET | `/api/escalation/assignments` | Autenticado |
| GET | `/api/escalation/raci` | Autenticado |
| GET | `/api/escalation/flow/:clientId` | Autenticado |
| PUT | `/api/escalation/flow/:clientId` | Admin |
| POST | `/api/escalation/flow/:clientId` | Admin |
| GET | `/api/escalation/client-alert` | Autenticado |
| POST | `/api/escalation/client-alert/ack` | Autenticado |
| GET | `/api/escalation/admin/clients` | Admin |
| POST | `/api/escalation/admin/clients` | Admin |
| PUT | `/api/escalation/admin/clients/:id` | Admin |
| DELETE | `/api/escalation/admin/clients/:id` | Admin |
| GET | `/api/escalation/admin/client-alert-rules` | Admin |
| POST | `/api/escalation/admin/client-alert-rules` | Admin |
| PUT | `/api/escalation/admin/client-alert-rules/:id` | Admin |
| DELETE | `/api/escalation/admin/client-alert-rules/:id` | Admin |
| GET | `/api/escalation/maintenance-rules` | Autenticado |
| POST | `/api/escalation/maintenance-rules` | Autenticado |
| PUT | `/api/escalation/maintenance-rules/:id` | Autenticado |
| DELETE | `/api/escalation/maintenance-rules/:id` | Autenticado |
| GET | `/api/escalation/admin/services` | Admin |
| POST | `/api/escalation/admin/services` | Admin |
| PUT | `/api/escalation/admin/services/:id` | Admin |
| DELETE | `/api/escalation/admin/services/:id` | Admin |
| GET | `/api/escalation/admin/contacts` | Admin |
| GET | `/api/escalation/admin/contacts/export-csv` | Admin |
| POST | `/api/escalation/admin/contacts/import-csv` | Admin |
| POST | `/api/escalation/admin/contacts` | Admin |
| PUT | `/api/escalation/admin/contacts/:id` | Admin |
| DELETE | `/api/escalation/admin/contacts/:id` | Admin |
| GET | `/api/escalation/admin/raci` | Admin |
| POST | `/api/escalation/admin/raci` | Admin |
| PUT | `/api/escalation/admin/raci/:id` | Admin |
| DELETE | `/api/escalation/admin/raci/:id` | Admin |
| GET | `/api/escalation/admin/rules` | Admin |
| POST | `/api/escalation/admin/rules` | Admin |
| PUT | `/api/escalation/admin/rules/:id` | Admin |
| DELETE | `/api/escalation/admin/rules/:id` | Admin |
| GET | `/api/escalation/admin/cycles` | Admin |
| POST | `/api/escalation/admin/cycles` | Admin |
| PUT | `/api/escalation/admin/cycles/:id` | Admin |
| DELETE | `/api/escalation/admin/cycles/:id` | Admin |
| GET | `/api/escalation/admin/assignments` | Admin |
| GET | `/api/escalation/admin/assignments/template-csv` | Admin |
| POST | `/api/escalation/admin/assignments/import-csv` | Admin |
| POST | `/api/escalation/admin/assignments` | Admin |
| PUT | `/api/escalation/admin/assignments/:id` | Admin |
| DELETE | `/api/escalation/admin/assignments/:id` | Admin |
| GET | `/api/escalation/admin/overrides` | Admin |
| POST | `/api/escalation/admin/overrides` | Admin |
| PUT | `/api/escalation/admin/overrides/:id` | Admin |
| DELETE | `/api/escalation/admin/overrides/:id` | Admin |
| GET | `/api/escalation/admin/external-people` | Admin |
| POST | `/api/escalation/admin/external-people` | Admin |
| PUT | `/api/escalation/admin/external-people/:id` | Admin |
| DELETE | `/api/escalation/admin/external-people/:id` | Admin |
| POST | `/api/escalation/admin/reminder/test` | Admin |
| POST | `/api/escalation/admin/automation/trigger-send` | Admin |


### Módulo: glpi

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/glpi/config` | Admin |
| PUT | `/api/glpi/config` | Admin |
| POST | `/api/glpi/test` | Admin |
| GET | `/api/glpi` | Admin |
| PUT | `/api/glpi` | Admin |

### Módulo: logging

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/logging/config` | Admin |
| PUT | `/api/logging/config` | Admin |
| POST | `/api/logging/test` | Admin |
| GET | `/api/logging/configs` | Admin |
| POST | `/api/logging/configs` | Admin |
| PUT | `/api/logging/configs/:id` | Admin |
| DELETE | `/api/logging/configs/:id` | Admin |
| POST | `/api/logging/configs/:id/test` | Admin |

### Módulo: notes

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/notes/admin` | Autenticado |
| PUT | `/api/notes/admin` | Todos |
| GET | `/api/notes/personal` | Autenticado |
| PUT | `/api/notes/personal` | Todos |

### Módulo: reports

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/reports/overview` | Autenticado |
| GET | `/api/reports/export-entries` | Admin |
| GET | `/api/reports/tags-trend` | Autenticado |
| GET | `/api/reports/heatmap` | Autenticado |
| GET | `/api/reports/entries-by-logsource` | Autenticado |
| GET | `/api/reports/mail-analytics` | Autenticado |
| POST | `/api/reports/newsletter/validate` | Autenticado |
| POST | `/api/reports/newsletter/send` | Autenticado |
| POST | `/api/reports/incident/preview` | Autenticado |
| POST | `/api/reports/incident/send` | Autenticado |

### Módulo: smtp

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/smtp` | Admin |
| GET | `/api/smtp/password` | Admin |
| POST | `/api/smtp` | Todos |
| POST | `/api/smtp/test` | Todos |

### Módulo: system

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/system/health-summary` | Admin |

### Módulo: tags

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/tags` | Autenticado |
| GET | `/api/tags/stats` | Admin |
| GET | `/api/tags/list` | Autenticado |
| GET | `/api/tags/suggest` | Autenticado |
| PUT | `/api/tags/:tag` | Admin |
| DELETE | `/api/tags/:tag` | Admin |

### Módulo: users

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/users/list` | Autenticado |
| GET | `/api/users` | Admin |
| GET | `/api/users/me` | Autenticado |
| PUT | `/api/users/me` | Todos |
| POST | `/api/users` | Todos |
| PUT | `/api/users/:id` | Todos |
| DELETE | `/api/users/:id` | Admin |

### Módulo: work-shift-assignments

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/work-shift-assignments` | Autenticado |
| POST | `/api/work-shift-assignments` | Admin |
| PUT | `/api/work-shift-assignments/:id` | Admin |
| DELETE | `/api/work-shift-assignments/:id` | Admin |

### Módulo: work-shifts

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/work-shifts/current` | Autenticado |
| GET | `/api/work-shifts` | Todos |
| GET | `/api/work-shifts/:id` | Todos |
| PUT | `/api/work-shifts/reorder` | Todos |
| POST | `/api/work-shifts` | Todos |
| PUT | `/api/work-shifts/:id` | Todos |
| DELETE | `/api/work-shifts/:id` | Todos |
| POST | `/api/work-shifts/:id/send-report` | Todos |
| POST | `/api/work-shifts/:id/send-report-poc` | Todos |

### Módulo: versions

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api/versions` | Todos |

### Módulo: index

| Método | Endpoint | Acceso (Aprox) |
|--------|----------|----------------|
| GET | `/api//context` | Todos |
| POST | `/api//log-entry` | Todos |
| GET | `/api//query-general` | Todos |
| POST | `/api//storage` | Todos |
| GET | `/api//storage` | Todos |
| POST | `/api//log` | Todos |
| GET | `/api//context` | Todos |


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

### Crear Backup (Cifrado Opcional)

**POST** `/api/backup/create` (Solo Admin)

Crea un archivo de respaldo empaquetado ZIP con base de datos, uploads y secretos. Si se pasa `passphrase` en el cuerpo de la petición, se cifra utilizando AES-256-GCM.

```bash
curl -X POST http://192.168.100.50:3000/api/backup/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "passphrase": "MI_CLAVE_SECRETA_OPCIONAL"
  }'
```

**Respuesta:**
```json
{
  "message": "Backup completo creado exitosamente",
  "filename": "backup-2026-06-10T04-00-00-000Z.zip",
  "collections": 32,
  "documents": 120,
  "sizeBytes": 142345,
  "encrypted": true
}
```

### Restaurar Backup (Cifrado Opcional)

**POST** `/api/backup/restore` (Solo Admin)

Restaura el archivo ZIP especificado. Si el respaldo original fue cifrado con frase de paso, se debe proveer la `passphrase` idéntica.

```bash
curl -X POST http://192.168.100.50:3000/api/backup/restore \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "filename": "backup-2026-06-10T04-00-00-000Z.zip",
    "clearBeforeRestore": true,
    "passphrase": "MI_CLAVE_SECRETA_OPCIONAL"
  }'
```

**Respuesta:**
```json
{
  "message": "Restauración completada exitosamente",
  "restoredUploads": true,
  "restoredSecrets": true,
  "keyringPresentAfterRestore": true
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


# Gobernanza de UI

# Gobernanza UI — Bitácora SOC

Documento operativo asociado principalmente a **UI-GOV-058** (entregable “guía publicada”). Los issues **`UI-CHK-044` … `UI-MIG-060`** y la remediación visual **`UI-VIS-066`..`071`** figuran como **Listos** en `docs/ISSUES.md` (cierre de tabla 2026-04-10 / 2026-04-11). Obligaciones por PR: **`QA-UI-061`–`065`** (**Recurrente**). Mejora continua: **§9** (`!important`, hex, reconteos) y **`docs/wcag-audit-handoff.md`**. El epic **`AI-SUMMARY-001` … `001G`** no se prioriza aquí: ver `ISSUES.md` → *Tablas de Control*.

## 1. Fuentes de verdad

| Recurso | Uso |
| --- | --- |
| `frontend/src/styles/semantic-tokens.scss` | Tokens `--surface-*`, `--outline-*`, `--space-*`, `--radius-*`, `--audit-cat-*`, tipografía semántica |
| `frontend/src/styles.scss` | Overrides globales Material; preferir clase contenedora + selectores acotados antes que `::ng-deep` en componentes |
| `docs/ISSUES.md` | **Listas** = cerrados (incl. `UI-CHK-044`…`UI-MIG-060` y `UI-VIS-066`..`071`); **En progreso** = nuevos `UI-*` cuando se abran; **Recurrente** = QA por PR; **Archivo IA** = epic IA sin priorización operativa |

## 2. Backlog UI/QA (misma fuente que `ISSUES.md`)

`docs/ISSUES.md` manda. El cierre **`UI-CHK-044` … `UI-MIG-060`** y **`UI-VIS-066`..`071`** permanece en **Listas**; la tabla **En progreso** queda para nuevas olas.

**Resumen de lo cerrado (2026-04-10):** checklist admin (asistente + guardado único), sin `mat-card` contenedor en rutas core (oleadas 1–11), tokens/hex en app acotados a CRT, sin `::ng-deep` en SCSS de app, baseline §6, handoff WCAG en `docs/wcag-audit-handoff.md`, `!important` remanente solo en overrides globales (métrica §9).

### Recurrente (cada PR con UI)

| ID | Obligación |
| --- | --- |
| `QA-UI-061` | Quien toca UI actúa como QA; no cerrar solo con “compila”. |
| `QA-UI-062` | Probar **5 temas** en rutas tocadas; anotar en PR qué se probó. |
| `QA-UI-063` | Regresión formularios (labels, errores, disabled, tablas, paginador). |
| `QA-UI-064` | Contraste texto/fondo, inputs, placeholders, hover/focus, chips/badges. |
| `QA-UI-065` | No saltarse estos estándares “por ir rápido”; evidencia o checklist en PR. |

**IA:** `AI-SUMMARY-001` … `001G` están en `ISSUES.md` como **archivo de referencia**; **no** entran en §2 como trabajo operativo.

## 3. Reglas de implementación

1. **Color:** en vistas funcionales, evitar `#hex` sueltos; usar `var(--…)` del tema o tokens semánticos.
2. **Contención visual (regla del programa, antes UI-ARCH-045):** como norma, **máximo dos niveles** legibles de “caja” por pantalla (superficie de página + bloque funcional). Evitar `mat-card` anidada solo por decoración; preferir secciones con título, borde sutil o `--surface-variant`.
3. **Estados:** reutilizar clases globales (`badge-pill`, `badge-surface-success|warning|error|info|neutral`, etc.) en lugar de duplicar estilos por módulo.
4. **Angular Material:** no añadir `::ng-deep` en componentes; subir a `styles.scss` con prefijo de clase en el template (`catalog-tabs`, `reports-period-toggle`, etc.).
5. **Accesibilidad:** respetar `prefers-reduced-motion` en animaciones decorativas; mantener foco visible en controles custom.

## 4. Layout estándar admin (regla viva; antes UI-LAYOUT-053)

Orden recomendado por pantalla de administración:

1. **Cabecera de contexto** (título + una línea de descripción).
2. **Barra de acciones primaria** (un botón principal claro por contexto cuando sea posible).
3. **Filtros** (opcional, agrupados).
4. **Contenido principal** (tabla, formulario o maestro-detalle).

Patrones ya alineados en el código: `page-header` + `admin-section` + `admin-section__toolbar` (p. ej. checklist-admin, catálogos).

## 5. Densidad (regla viva; antes UI-DENS-054)

- Usar escala `--space-1` … `--space-6` para gaps y padding de sección.
- En viewports &lt; 960px, reducir padding lateral del contenedor y priorizar scroll vertical sobre columnas estrechas paralelas.
- Tablas: envolver en `.table-responsive` o equivalente cuando haya muchas columnas.

## 6. Baseline visual (regla viva; antes UI-QA-059)

No se exigen capturas en el repo por defecto; sí se define **qué** revisar al cambiar estilos o tokens. Opcional: convención y carpeta en `docs/ui-baselines/README.md`.

| Ruta / área | Temas |
| --- | --- |
| Login (CRT + infoflow si aplica) | 5 |
| `/main/report-generator` | 5 |
| `/main/admin/checklist` | 5 |
| `/main/admin/catalogs` | 5 |
| `/main/audit-logs` | 5 |
| Layout principal (menú, tema, barra salud) | 5 |

**Tema:** `light`, `dark`, `sepia`, `pastel`, `cyberpunk` (`data-theme` en documento).

Guardar capturas en artefacto de PR o carpeta de equipo si se requiere evidencia formal.

## 7. Contraste y WCAG (QA-UI-064 + `docs/wcag-audit-handoff.md`)

- Objetivo: **WCAG 2.1 AA** donde aplique (texto normal ≥ 4.5:1; texto grande ≥ 3:1).
- Comprobar: texto principal y secundario sobre `--background-color` y `--surface-color` / `--surface-card`; placeholders y hints; estados hover/focus/disabled en `mat-form-field`.
- Herramientas sugeridas: inspector del navegador, **WebAIM Contrast Checker**, **axe DevTools** (o similar).

**Pasada sugerida (registro en PR o hoja de hallazgos):**

1. Por cada tema, abrir al menos las rutas de la tabla **§6** y ejecutar **axe** (o Lighthouse accesibilidad) en una vista representativa.
2. Anotar violaciones por tema (ID regla, selector aproximado, captura si aplica).
3. Priorizar: contraste texto/fondo, foco visible, nombres accesibles en icon-buttons sin `aria-label`.
4. Corregir o crear issue enlazado; registrar en PR qué temas/rutas se pasaron con herramienta.

## 8. Obligaciones QA por cambio UI (QA-UI-061 a QA-UI-065)

No son cierres únicos: aplican **cada vez** que se modifique CSS, tokens o maquetación.

| ID | Obligación |
| --- | --- |
| **QA-UI-061** | Actuar como **QA**: legibilidad, errores, foco, flujos reales; la interfaz debe ser usable en condiciones SOC, no solo compilar. |
| **QA-UI-062** | Tras tocar `styles.scss`, `semantic-tokens.scss` o SCSS de pantalla: probar la ruta en **light, dark, sepia, pastel, cyberpunk**. Documentar en PR qué rutas y temas se probaron. |
| **QA-UI-063** | Regresión de **formularios**: labels, hints/errores, `touched`/`invalid`, selects, diálogos, tablas, paginador; nada que parezca deshabilitado sin estarlo (o al revés). |
| **QA-UI-064** | **Contraste y theming:** texto vs fondo de página y card; `mat-form-field` / textarea / input (fondo, borde, texto, placeholder) en 5 temas; hover/focus/disabled; tooltips, chips y badges sobre superficies claras y oscuras. |
| **QA-UI-065** | **Gobernanza:** estos puntos no se omiten al codificar; merge con evidencia (checklist marcado o línea en PR). |

### Checklist mínimo antes de dar por cerrado el cambio

- [ ] **QA-UI-062:** vista afectada en los **5 temas**.
- [ ] **QA-UI-063:** formularios y controles de la zona tocada revisados.
- [ ] **QA-UI-064:** sin combinaciones ilegibles (texto/fondo/inputs).
- [ ] **QA-UI-065:** PR o release note con una línea: rutas + temas probados.
- [ ] Sin regresión obvia en rutas de la tabla **§6** (smoke visual).

## 9. Métricas de deuda UI (mejora continua; histórico UI-MIG-060 / UI-MAT-052)

**Reconteo tras cada lote** (desde raíz del repo, con [ripgrep](https://github.com/BurntSushi/ripgrep) instalado):

```bash
rg "!important" frontend/src/styles.scss --count-matches
rg "::ng-deep" frontend/src/app --glob "*.scss"
rg "#[0-9a-fA-F]{3,8}" frontend/src/app --glob "*.scss" | head -80
```

El tercer comando es muestra orientativa; para **hex por carpeta**: `rg "#[0-9a-fA-F]{3,8}" frontend/src/app/pages --glob "*.scss" --stats`. Excluir manualmente valores en comentarios o datos dinámicos justificados (**UI-COLOR-049** / **§11**).

Instantánea **2026-04-10** (actualizar al cerrar lotes):

| Métrica | Valor (aprox.) | Nota |
| --- | --- | --- |
| `!important` en `frontend/src/styles.scss` | ~100 | Objetivo: bajar con theming Material y mayor especificidad sin `!important`. Recontar con `rg '!important' styles.scss`. |
| `::ng-deep` en `frontend/src/app/**/*.scss` | 0 usos activos | Comentarios en catálogos no cuentan. |
| Oleadas cualitativas | 11 | Ver lista siguiente. |

Oleadas ya aplicadas en código:

1. Report-generator — tokens, globos de ayuda, correo sin inline fijo en panel operativo.
2. Checklist-admin — secciones numeradas, paneles `.admin-panel` (sin `mat-card` en bloques principales), sticky, tabla responsive, badges globales.
3. Catalog-admin — tabs Material globales, badges reglas.
4. Audit-logs — categorías vía `--audit-cat-*`.
5. Main-layout — acordeón, menú, chips salud con tokens.
6. Cabeceras admin con gradiente — `escalation-admin-simple`, `escalation-simple`, `work-shifts-admin`: `<header class="page-header">` sin `mat-card` (UI-ARCH-045).
7. `report-generator` — contenedor `.report-generator-panel` sin `mat-card` raíz; checklist recordatorios — apilado móvil &lt; 640px (UI-ARCH-045 / UI-CHK-044).
8. `admin-security` / `admin-appearance` — panel tokenizado sin `mat-card` raíz; **login CRT** — `$crt-neon`, `$crt-danger`, uso de `$crt-text` (UI-ARCH-045 / UI-LAYOUT-053 / UI-LOGIN-055 / UI-COLOR-049).
9. **Lote pantallas core:** `settings`, `integrations`, `users`, `entries`, `profile`, `audit-logs`, `work-shifts-admin` (form + panel lista), `forgot-password`, `reset-password` — paneles semánticos sin `mat-card` contenedor (v1.5.39-beta).
10. **`backup`** / **`logo` (Branding)** — `.backup-panel` / `.logo-panel` sin `mat-card` (v1.5.40-beta).
11. **`reports`**, **`all-entries`**, **`catalog-admin`**, **`checklist`** (operador), **`glpi-integration`**, **`escalation-simple`** / **`escalation-admin-simple`** (`<section>` formularios), **`admin-complements`**, **`current-shift`**, legado **`escalation-view`** / **`escalation-admin`** — paneles tokenizados; **`MatCardModule`** retirado de `main.module.ts` si no hay templates con `mat-card` (v1.5.42-beta).

## 10. Clases globales de estado (regla viva; antes UI-COMP-048)

No hay paquete Angular aparte: el “shared set” vive en `styles.scss` y `semantic-tokens.scss`.

| Clase | Uso |
| --- | --- |
| `.badge-pill` | Forma base pill |
| `.badge-pill-muted` | Variante discreta |
| `.badge-surface-success` / `warning` / `error` / `info` / `neutral` | Combinar con `.badge-pill` para semántica |

Preferir estas clases antes de inventar badges locales por pantalla.

## 11. Excepciones a “sin inline” (regla viva; antes UI-REF-051)

Está bien usar **`[style.*]`** cuando el valor es **dato dinámico** del modelo (no tema):

- Heatmap en `/main/reports`: color de celda según valor.
- Selector de color en catálogos y turnos: muestra del HEX elegido por el usuario.

El issue sigue siendo relevante para **estilos estáticos** en HTML (mover a SCSS con tokens).

---

*Última actualización: 2026-05-18 — documento vigente para gobernanza UI/QA; obligaciones Recurrente (`QA-UI-061` a `QA-UI-065`) y métricas de §9 se mantienen activas.*


# Política de pnpm

# Politica de Package Manager: pnpm v11

Este repositorio usa exclusivamente `pnpm` major `11`.

## Reglas obligatorias

- Usar `pnpm install` para instalar dependencias.
- Usar `pnpm run <script>` para ejecutar scripts.
- Usar `pnpm exec <binario>` para CLIs locales.
- No usar `npm install`, `npm run`, `npx` ni generar `package-lock.json`.

## Estandar tecnico

- Todos los `package.json` definen `packageManager: "pnpm@11.0.0"`.
- `preinstall` valida el user agent y bloquea gestores distintos de `pnpm@11`.
- Docker build usa `corepack` + `pnpm` con lockfile congelado (`--frozen-lockfile`).

## Configuracion base recomendada

```bash
corepack enable
corepack prepare pnpm@11.0.0 --activate
pnpm --version
```


# Marcas de Autor

# Watermarks locales de autor

Autor referenciado: Athan Espinoza

Objetivo:
- Mantener un inventario privado de marcas de autor insertadas solo como comentarios.
- No exponer este mapa en el repositorio remoto.

Ubicaciones registradas:
- .gitignore
- backend/src/server.js
- backend/src/config/database.js
- backend/Dockerfile
- docker-compose.yml
- frontend/src/main.ts
- frontend/src/index.html
- frontend/src/styles.scss
- frontend/Dockerfile
- scripts/compose-up.ps1
- README.md
- docs/CATALOGS.md

Patrón usado:
- "Marca de autor en comentarios: Athan Espinoza"

Nota:
- Mantener futuras inserciones en comentarios no funcionales para evitar impacto en runtime.

