# BITACORA_SOC_FULL_DOCUMENTATION.md

Single Source of Truth (SSOT) para el proyecto **BitacoraSOC**.

Objetivo:
- Onboarding de nuevos desarrolladores (cómo está hecho el sistema).
- Onboarding de analistas SOC (cómo operarlo sin errores).
- Referencia de administración (admin/root) y seguridad (crítico).

> Nota de seguridad: En los ejemplos incluidos por los documentos originales se reemplazaron valores sensibles evidentes por `[SENSITIVE_DATA_REDACTED]` (por ejemplo: secretos/keys y credenciales de ejemplo).

---

## Índice Interactivo

1. [docs/ARCHITECTURE.md](#docs-architecture)
2. [docs/API.md](#docs-api)
3. [docs/TLS_SSL_ARCHITECTURE.md](#docs-tls-ssl-architecture)
4. [docs/SETUP.md](#docs-setup)
5. [docs/TROUBLESHOOTING.md](#docs-troubleshooting)
6. [docs/BACKUP.md](#docs-backup)
7. [docs/DEPLOY.md](#docs-deploy)
8. [docs/LOGGING.md](#docs-logging)
9. [docs/SECURITY.md](#docs-security)
10. [docs/RUNBOOK.md](#docs-runbook)
11. [docs/ESCALATION.md](#docs-escalation)
12. [docs/WORK-SHIFTS.md](#docs-work-shifts)
13. [docs/CATALOGS.md](#docs-catalogs)
14. [docs/CHANGELOG.md](#docs-changelog)
15. [docs/SCREENSHOTS.md](#docs-screenshots)
16. [docs/ISSUES.md](#docs-issues)
17. [docs/images/screenshots/README.md](#docs-images-screenshots-readme)
18. [backend/scripts/README.md](#backend-scripts-readme)
19. [Apéndice: Verificación contra Código](#appendix-code-verification)
20. [Apéndice: Glosario y Reglas de Redacción](#appendix-glossary-redaction)

---

<a name="docs-architecture"></a>

# 🧭 Arquitectura y Flujos - Bitacora SOC

Documentacion visual del funcionamiento general del sistema.

> Estado: Arquitectura en evolución (beta). Los módulos clave ya están operativos y separados por dominio funcional.

---

## 🗺️ Mapa Conceptual (alto nivel)

```mermaid
flowchart LR
  U[Usuarios SOC] -->|UI Web| FE[Angular 20 SPA]
  FE -->|REST| BE[Express API]
  BE --> DB[(MongoDB)]
  BE --> SMTP[Servidor SMTP]
  BE --> SIEM[SIEM/SOAR Syslog/TLS]
  BE --> FS[Uploads y Backups]
  subgraph Schedulers
    CRON[Shift Scheduler] --> BE
    ALERT[Checklist Alert Scheduler] --> BE
  end
```

---

## 🧩 Módulos Administrativos (Frontend)

```mermaid
flowchart TD
  A[/main/admin/] --> B[Users]
  A --> C[Checklist Admin]
  A --> D[Work Shifts]
  A --> E[Catalog Admin]
  A --> F[Escalación Admin]
  A --> G[SMTP]
  A --> H[Integraciones SIEM/SOAR/NDR]
  A --> I[GLPI]
```

- Integraciones SIEM/SOAR/NDR y GLPI quedaron separados por diseño.
- GLPI opera como módulo independiente (API REST o correo collector).

---

## 🔐 Flujo de Autenticacion y Auditoria

```mermaid
sequenceDiagram
  participant User as Usuario
  participant FE as Frontend
  participant API as Backend
  participant DB as MongoDB
  participant AUD as AuditLog

  User->>FE: Login
  FE->>API: POST /api/auth/login
  API->>DB: Verifica usuario
  API->>AUD: Registra auth.login.*
  API-->>FE: JWT
  FE->>API: Request con Bearer token
  API->>AUD: Registra evento (entry.create, shiftcheck.submit, etc.)
  API-->>FE: Respuesta
```

---

## 📧 Flujo de Reporte de Turno

```mermaid
flowchart TD
  A[Fin de turno] --> B{Scheduler o Cierre manual}
  B --> C[Recolecta check inicio/cierre]
  C --> D[Recolecta entradas del periodo]
  D --> E[Genera HTML + texto]
  E --> F[Envia correo SMTP]
```

---

## 🔌 Flujo de Integraciones (SIEM + GLPI)

```mermaid
flowchart LR
  AUD[AuditLog] --> FW[logForwarder]
  FW --> SIEM1[Conector SIEM #1]
  FW --> SIEM2[Conector SOAR/NDR #2]
  FW --> SIEMN[Conector N]

  ADMIN[Admin > GLPI] --> GLPIAPI[/api/glpi/config,/test]
  GLPIAPI --> GLPIREST[GLPI REST apirest.php]
  GLPIAPI --> GLPIMAIL[Correo collector GLPI]
```

- Forwarding SIEM soporta múltiples destinos activos en paralelo.
- GLPI tiene configuración propia y prueba de conectividad independiente.

---

<a name="docs-api"></a>

# 🌐 Documentación API - Bitácora SOC

Guía para consumir la API REST del sistema.

> Aviso: Todos los valores de ejemplo son placeholders. Reemplazarlos por credenciales reales desde `.env` antes de usar en producción.
> Estado: El proyecto se encuentra en **beta**; algunos endpoints y flujos pueden evolucionar.

---

## Acceso a Swagger UI

**URL:** `http://IP_SERVIDOR:3000/api-docs`

**Ejemplo:** `http://[SENSITIVE_DATA_REDACTED]:3000/api-docs`

**Contenido:**
- Todos los endpoints documentados
- Schemas completos
- Try it out interactivo

---

## Autenticación

### JWT Bearer Token

Todos los endpoints (excepto `/auth/login`) requieren header:

```
Authorization: Bearer <tu_token_jwt>
```

### Obtener Token

**POST** `/api/auth/login`

```bash
curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "CHANGE_ME"
  }'

> Nota: `username` acepta nombre de usuario o email.
> Nota: `CHANGE_ME` es un placeholder. Usa tu valor real desde `.env` (`ADMIN_PASSWORD`).
```

**Respuesta:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "[SENSITIVE_DATA_REDACTED]",
    "username": "admin",
    "email": "[SENSITIVE_DATA_REDACTED]",
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

### Autenticación

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

### Reportes

| Método | Endpoint | Descripción | Rol |
|--------|----------|-------------|-----|
| GET | `/api/reports/overview?days=30` | KPIs generales | Admin |
| GET | `/api/reports/export-entries?startDate=...&endDate=...` | Export CSV | Admin |
| GET | `/api/reports/tags-trend?days=30&tags=a,b` | Tendencia de tags | Admin/User |
| GET | `/api/reports/heatmap?days=30` | Mapa de calor día/hora | Admin/User |
| GET | `/api/reports/entries-by-logsource?days=30` | Entradas por Log Source | Admin/User |

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
| POST | `/api/backup/create` | Crear backup JSON | Admin |
| POST | `/api/backup/restore` | Restaurar backup | Admin |
| GET | `/api/backup/download/:filename` | Descargar backup JSON | Admin |
| GET | `/api/backup/export/:type` | Exportar CSV | Admin |
| POST | `/api/backup/import` | Importar CSV/JSON | Admin |
| POST | `/api/backup/purge` | Purgar datos (con confirmación) | Admin |
| DELETE | `/api/backup/:id` | Eliminar backup | Admin |

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

curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/entries \
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
    "_id": "[SENSITIVE_DATA_REDACTED]",
    "content": "Revisión de alertas en #Trellix...",
    "entryType": "operativa",
    "entryDate": "2025-12-17T00:00:00.000Z",
    "entryTime": "14:30",
    "tags": ["trellix", "fw-001", "hunting"],
    "createdBy": "[SENSITIVE_DATA_REDACTED]",
    "createdByUsername": "admin",
    "isGuestEntry": false,
    "createdAt": "2025-12-17T14:30:00.000Z"
  }
}
```

### Registrar Checklist Inicio

```bash
curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/checklist/check \
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
    "_id": "[SENSITIVE_DATA_REDACTED]",
    "userId": "[SENSITIVE_DATA_REDACTED]",
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

curl -X GET "http://[SENSITIVE_DATA_REDACTED]:3000/api/entries?entryType=incidente&tags=malware&startDate=${START_DATE}&endDate=${END_DATE}&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:**
```json
{
  "entries": [
    {
      "_id": "[SENSITIVE_DATA_REDACTED]",
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
curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/smtp/test \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (éxito):**
```json
{
  "message": "Email de prueba enviado exitosamente",
  "recipient": "[SENSITIVE_DATA_REDACTED]"
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
curl -X GET "http://[SENSITIVE_DATA_REDACTED]:3000/api/reports/overview?days=30" \
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
curl -X PUT http://[SENSITIVE_DATA_REDACTED]:3000/api/logging/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "enabled": true,
    "host": "[SENSITIVE_DATA_REDACTED]",
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

---

## Correlation ID (X-Request-Id)

Cada request tiene un UUID único para tracing:

**Request:**
```bash
curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/entries \
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
ALLOWED_ORIGINS=http://[SENSITIVE_DATA_REDACTED]:4200,http://localhost:4200
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

Backend interno: America/Santiago (Chile)

Conversión automática: Backend convierte a UTC para respuestas API

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
   - Swagger URL: `http://[SENSITIVE_DATA_REDACTED]:3000/api-docs`
   - Postman → Import → Link → Pegar URL

2. **Configurar Environment:**
   - Variable: `baseUrl` = `http://[SENSITIVE_DATA_REDACTED]:3000/api`
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

<a name="docs-tls-ssl-architecture"></a>

# Arquitectura TLS/SSL en Bitácora SOC (Implementación Detallada)

Este documento explica en profundidad técnica el diseño, la implementación y el funcionamiento de la capa de seguridad TLS/SSL en el proyecto **Bitácora SOC**. Este sistema fue diseñado para ofrecer máxima seguridad (E2E encryption), alta disponibilidad (cero caídas al rotar certificados) y tolerancia a fallos en el arranque inicial.

---

## 1. Diagrama de Arquitectura Global

El siguiente diagrama ilustra cómo se estructuran y se comunican los componentes en la red de Docker para proveer una conexión cifrada, así como el flujo de recarga de certificados "En Caliente" (Hot Reload):

```mermaid
sequenceDiagram
    participant Admin as Administrador
    participant Nginx as Frontend (Nginx Proxy)
    participant API as Backend (Node.js)
    participant DB as MongoDB (AppConfig)
    
    Note over Nginx: Arranque Inicial<br/>Si no hay certs, genera Dummy Cert auto-firmado
    
    Admin->>Nginx: Accede a panel HTTPS (Auto-firmado)
    Nginx->>API: /api/config/security/certificates (POST)
    Note over API: 1. tls-validator.js (Validación Matemática)
    Note over API: 2. Guarda en disco (.data/tls)
    API->>DB: Guarda paths en colección AppConfig
    Note over API: 3. Ejecuta applyRuntimeSecurityConfig()
    Note over API: 4. SNICallback actualiza SecureContext en memoria
    API-->>Admin: 200 OK - HTTPS Activado
    
    Note over Nginx: Siguiente Petición
    Admin->>Nginx: Usa API
    Nginx->>API: Petición HTTPS Nativa proxy_pass
    Note over API: Responde con el nuevo certificado sin reiniciar
```

---

## 2. Capa Frontend: Proxy Nginx y Contenedor Tolerante a Fallos

Nginx sirve como el servidor perimetral que presenta la interfaz SPA de Angular y hace de proxy reverso hacia el backend.

### 2.1. Problema del Huevo y la Gallina en Docker

Si configuras Nginx para escuchar en el puerto `443` activando `ssl_certificate`, Nginx fallará catastróficamente **si esos archivos no existen en disco** al momento del arranque. En un despliegue virgen, el usuario aún no ha tenido oportunidad de subir certificados.

### 2.2. Solución: Generación de Certificados Dummy en el Arranque

Para asegurar que el contenedor inicie siempre, el `Dockerfile` del frontend incluye el binario `openssl`, y el `docker-compose.yml` inyecta un script de comprobación antes de arrancar Nginx:

**En `docker-compose.yml`:**
```yml
    command: >
      sh -c ' if [ ! -f /etc/nginx/certs/cert.pem ]; then
        echo "Generando certificados autofirmados dummy para arranque inicial...";
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/nginx/certs/key.pem -out /etc/nginx/certs/cert.pem -subj "/CN=localhost";
      fi; nginx -g "daemon off;" '
```
**Resultado**: Si el directorio `/etc/nginx/certs` está vacío, se crea un certificado autofirmado que permite que Nginx arranque. Luego, el administrador accederá (aceptando la advertencia del navegador) y usará la app para subir los certificados reales.

---

## 3. Capa Backend: Hot Reloading y SNICallback en Express.js

La "magia" para poder recargar certificados y habilitar/deshabilitar HTTPS **sin reiniciar ni detener el backend** reside en el uso del contexto de servidor dual y el `SNICallback`.

### 3.1 Servidor Dual Plegable

El backend de Bitácora levanta en HTTP (por defecto puerto 3000) de manera obligatoria. El servidor HTTPS (por defecto 3443) solo se instancia si la propiedad `httpsEnabled` en base de datos es `true`.

### 3.2. Recarga en Caliente (Hot Reloading) con SNICallback

El protocolo TLS permite que el servidor decida qué certificado proveer dependiendo del dominio que solicitó el cliente (SNI). Nosotros abusamos de este mecanismo para actualizar el certificado completo del servidor.

**Snippet en `server.js`:**
```javascript
let currentSecureContext = null;

httpsServer = https.createServer({
  SNICallback: (domain, cb) => {
    // Si hay un contexto seguro cargado en memoria, se despacha.
    // Si no lo hay, falla la negociación TLS.
    if (currentSecureContext) {
      cb(null, currentSecureContext);
    } else {
      cb(new Error('Contexto TLS no disponible'));
    }
  }
}, app);
```

Cuando un usuario sube un nuevo certificado desde el Admin Panel:
1. Se guarda en base de datos la ubicación (`secrets/...`).
2. Se llama a la función global `app.locals.applyRuntimeSecurityConfig()`.
3. Esta función lee los nuevos archivos de disco y recrea la variable `currentSecureContext` usando `tls.createSecureContext({ cert, key })`.
4. Listo. **La siguiente petición milisegundos después** recibirá el nuevo certificado, sin interrupciones.

---

## 4. Validación Matemática Estricta de Certificados (Pre-guardado)

Node.js es extremadamente frágil si le entregas un certificado y una llave que no coinciden matemáticamente; un error fatal arrojará una excepción "Uncaught Exception" que botará el proceso `node`.

Para evitar que un error humano de un admin tire la plataforma, se diseñó `backend/src/utils/tls-validator.js`:

```javascript
const validateCryptoPair = ({ certPem, keyPem, caPem }) => {
    // 1. Evitar llaves privadas cifradas con contraseña
    const keyString = String(keyPem);
    if (keyString.includes('ENCRYPTED')) {
        throw new Error('Llave privada cifrada no soportada. Sube una llave PEM sin passphrase.');
    }

    try {
        // 2. Simulamos la creación del SecureContext en un bloque try/catch
        const contextOptions = { cert: certPem, key: keyPem };
        tls.createSecureContext(contextOptions);
        return true;
    } catch (err) {
        throw new Error(`Los certificados TLS son inválidos o no corresponden: ${err.message}`);
    }
};
```

La ruta POST `/api/config/security/certificates` invoca `validateCryptoPair()` en un bloque seguro. Si los certificados no encajan, se borran inmediatamente de `/tmp/` y la API devuelve HTTP 400.

Además, con el método asíncrono `isPortFree()`, el backend intenta enlazar un socket silencioso al nuevo puerto HTTPS antes de guardarlo; si el puerto ya está en uso, se bloquea la configuración para prevenir caídas de colisión de red (EADDRINUSE).

---

## 5. Middleware de Redirección Inteligente: CORS y Status 426

Cuando el administrador marca el switch `Forzar HTTPS en Backend` (`forceHttps = true`), el backend no debe procesar nada que venga por HTTP.

**El problema con `307 Redirect`**:
Generalmente, para forzar HTTPS se devuelve un status `301` o `307` redirigiendo hacia la url con `https://`. Sin embargo, esto es veneno para SPAs (Angular) realizando peticiones AJAX/Fetch. Cuando un navegador sigue un HTTP Redirect ciego por CORS, elimina las cabeceras de `Authorization` o descarta las cookies (`withCredentials`). El usuario terminará con errores `401 Unauthorized` inexplicables y la UI colapsará.

**La Solución Amigable API - Status 426**:
El backend distingue si la petición HTTP proviene del navegador directo o de la API:

```javascript
// Si es una petición API o un Fetch XHR
if (req.path.startsWith('/api') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
  // En lugar de redirigir, abortamos con un error semánticamente correcto: "Upgrade Required"
  return res.status(426).json({
    message: 'HTTPS requerido para esta operación',
    targetUrl: `https://${targetHost}${req.originalUrl}`
  });
}

// Si es una petición de navegador normal (GET /) redirigimos tradicionalmente
if (req.method === 'GET' || req.method === 'HEAD') {
  return res.redirect(307, targetUrl);
}
```

El **HttpInterceptor de Angular** captura los errores `426 Upgrade Required`, e informa limpiamente al usuario internamente, o en un futuro podría re-intentar la petición ajustando la URL con las credenciales intactas, haciendo la UX mucho más resistente.

---

## 6. Experiencia de Usuario (Frontend): Validación y Cuenta Atrás

Dado que cambiar la configuración HTTPS del sistema (especialmente pasar de HTTP a HTTPS o cambiar el puerto) invoca un cambio drástico en la URL donde se aloja el frontend, el panel de administración (`admin-security.component.ts`) implementa un flujo a prueba de fallos de red.

**El Flujo UI:**
Cuando el administrador hace clic en "Guardar", se emite el request al backend. Inmediatamente el backend aplica el `SNICallback`, pero el navegador del usuario sigue atado a la URL HTTP/HTTPS antigua.

Para solucionar esto, Angular inicia un proceso de rescate automatizado:
1. Se despliega un SnackBar informando `Reiniciando frontend... (espere 15s)`.
2. El método interno `startCountdownAndRedirect()` bloquea el botón de guardar e inicia un `setInterval` rebajando cada segundo la cuenta atrás.
3. Al llegar a `0`, Angular manda un **Hard Redirect** a través de `window.location.href = targetUrl;`. En esa `targetUrl` Angular computa el protocolo esperado (`http://` o `https://`) basándose en los switches recién guardados.

```typescript
// admin-security.component.ts
private startCountdownAndRedirect(targetUrl: string, seconds: number = 15): void {
  this.isSaving = true;
  let remaining = seconds;
  this.countdownMessage = `(espere ${remaining}s)`;

  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      this.countdownMessage = `(espere ${remaining}s)`;
    } else {
      this.countdownMessage = `(Recargando...)`;
      clearInterval(interval);
      window.location.href = targetUrl; // Hard reload a la nueva configuración HTTPS
    }
  }, 1000);
}
```

Esta técnica visual brinda confianza al administrador, dándole tiempo al backend a procesar la recarga TLS antes de arrastrar al navegador hacia la nueva URL segura.

---

## Resumen de Buenas Prácticas Aplicadas

- **Resiliencia al Inicio**: El contenedor se "auto-sana" generando dummy certs (Nginx/Openssl).
- **Zero-Downtime TLS Rotation**: SNICallback evita que las recargas rompan el uptime.
- **Fail-Fast Validation**: Validación matemática criptográfica previene corrupciones y caídas del core de Node.js.
- **API First Redirect**: Abandono de 3xx redirects para endpoints AJAX en favor del estado explícito 426, mejorando la fiabilidad de CORS y la retención de Sesión.
- **UX Segura (Countdown)**: Transición amigable en el Frontend para no perder al administrador durante el cambio de contexto HTTP a HTTPS.

---

<a name="docs-setup"></a>

# 🔧 Instalación y Configuración - BitacoraSOC

Guía detallada para instalar y configurar el sistema desde cero.

> Aviso: Los valores de ejemplo son placeholders. Reemplazarlos por credenciales reales desde `.env` antes de usar en producción.
> Estado: Proyecto en **beta**. Validar los flujos críticos en entorno de pruebas antes de pasar a operación.

---

## Requisitos

- **Node.js** 24+ LTS y npm
- **Express** 5.1+
- **MongoDB** 7+ (local o remoto)
- **mongodump/mongorestore** (para backups)
- **Angular CLI** 20+ `npm install -g @angular/cli`

---

## 1. Instalación

### 1.1 Clonar o Extraer

```powershell
cd C:\ruta\a\BitacoraSOC
```

### 1.2 Backend

```powershell
cd backend
npm install
```

**Paquetes principales instalados:**
- express, mongoose, jsonwebtoken
- bcryptjs, nodemailer, helmet
- pino (logging), uuid (correlation ID)

### 1.3 Frontend

```powershell
cd ..\frontend
npm install
```

**Paquetes principales:**
- @angular/core 20.3.16, @angular/material 20.2.14
- anime.js (animaciones)

### 1.4 MongoDB

Verificar que MongoDB esté corriendo:

```powershell
mongosh --eval "db.version()"
```

**Salida esperada:**
```
6.0.x
```

Si no está instalado:
- **Windows:** [Descargar MongoDB Community](https://www.mongodb.com/try/download/community)
- **Instalación:** Incluir MongoDB Compass (GUI opcional)
- **Servicio:** Configurar como servicio Windows (auto-start)

---

## Verificación rápida post-instalación

1. Backend arriba: `http://localhost:3000/health`
2. Frontend arriba: `http://localhost:4200`
3. Login admin exitoso y acceso a consola unificada: `/main/admin`
4. Revisar módulos admin clave:
  - `/main/admin/integrations` (SIEM/SOAR/NDR)
  - `/main/admin/glpi` (GLPI separado)
  - `/main/admin/smtp` y `/main/backup`
5. Validar API docs: `http://localhost:3000/api-docs`

### Nota de GLPI (modo API)

- Para guardar configuración GLPI en modo API se requieren `App-Token` y `User Token` configurados.
- El backend valida esos campos al guardar (`PUT /api/glpi/config`).

---

## 2. Configuración Backend (.env)

### 2.1 Copiar Template

```powershell
cd backend
cp .env.example .env
```

### 2.2 Editar .env

```env
# Server
NODE_ENV=development
HOST=0.0.0.0                          # Escucha todas las interfaces
PORT=3000

# Frontend (para links de reset password)
HOST_DOMAIN=tu-dominio-o-ip
FRONTEND_PORT=4200

# MongoDB
MONGODB_URI=mongodb://localhost:27017/bitacora_soc

# JWT
JWT_SECRET=CAMBIAR_EN_PRODUCCION      # Ver sección 2.3

# Nota: la expiración se define en backend (4h admin/user, 2h guest)

# CORS (IPs frontend permitidas)
# En producción usa allowlist; en desarrollo permite cualquier origen
# Ejemplo sanitizado: reemplaza por tus orígenes reales.
ALLOWED_ORIGINS=http://[SENSITIVE_DATA_REDACTED]:4200,http://localhost:4200

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000           # 15 min
RATE_LIMIT_MAX_REQUESTS=100           # 100 requests/15min

# Timezone
TZ=America/Santiago

# Encryption (passwords SMTP)
ENCRYPTION_KEY=GENERAR_CON_OPENSSL    # 64 caracteres hex (32 bytes)

# Logging
LOG_LEVEL=info                        # info | debug | warn | error
AUDIT_TTL_DAYS=90                     # Retención logs auditoría
LOG_FORWARD_CLIENT_KEY=               # Path a client.key para mTLS (opcional)
```

### 2.3 Generar Secrets (CRÍTICO)

**ENCRYPTION_KEY (AES-256-GCM):**
```powershell
openssl rand -hex 32
```

Copiar salida (64 chars hex) a `.env`:
```env
ENCRYPTION_KEY=[SENSITIVE_DATA_REDACTED]
```

**JWT_SECRET:**
```powershell
openssl rand -base64 32
```

Copiar salida a `.env`:
```env
JWT_SECRET=[SENSITIVE_DATA_REDACTED]
```

⚠️ NUNCA COMMITEAR .env A GIT

---

## 3. Configuración por IP

### 3.1 Obtener IP Local

**Windows PowerShell:**
```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -like "*Ethernet*" -or $_.InterfaceAlias -like "*Wi-Fi*"} | Select-Object IPAddress, InterfaceAlias
```

**Ejemplo salida:**
```
IPAddress     InterfaceAlias
---------     --------------
[SENSITIVE_DATA_REDACTED]  Wi-Fi
```

**Linux/Mac:**
```bash
ip addr show | grep inet
```

### 3.2 Configurar CORS Backend

En `backend\.env`:
```env
ALLOWED_ORIGINS=http://[SENSITIVE_DATA_REDACTED]:4200,http://[SENSITIVE_DATA_REDACTED]:4200
```

**Reglas:**
- Separar múltiples IPs con comas
- Incluir puerto `:4200` (Angular)
- Incluir `localhost` solo para desarrollo

### 3.3 Configurar API URL Frontend

Editar `frontend\src\environments\environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://[SENSITIVE_DATA_REDACTED]:3000/api'  // ⚠️ USAR TU IP
};
```

**Producción** (`environment.prod.ts`):
```typescript
export const environment = {
  production: true,
  apiUrl: 'http://IP_SERVIDOR_PROD:3000/api'
};
```

---

## 4. Primer Usuario Admin

### Opción A: Registro Manual en MongoDB

```javascript
// Ejecutar en mongosh
use bitacora_soc

db.users.insertOne({
  username: "admin",
  email: "[SENSITIVE_DATA_REDACTED]",
  // Password: "CHANGE_ME" hasheado con bcrypt
  password: "<bcrypt_hash>",
  fullName: "Administrador",
  role: "admin",
  isActive: true,
  theme: "light",
  createdAt: new Date(),
  updatedAt: new Date()
})
```

⚠️ Cambiar password inmediatamente después del primer login.

### Opción B: Script Seed (Recomendado)

Crear `backend/src/scripts/seed.js`:

```javascript
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const adminExists = await User.findOne({ role: 'admin' });
  if (adminExists) {
    console.log('❌ Admin ya existe');
    process.exit(0);
  }
  
  const admin = new User({
    username: 'admin',
    email: '[SENSITIVE_DATA_REDACTED]',
    password: 'CHANGE_ME',  // Se hashea automáticamente
    fullName: 'Administrador',
    role: 'admin',
    isActive: true
  });
  
  await admin.save();
  console.log('✅ Admin creado: admin / CHANGE_ME');
  process.exit(0);
}

seed().catch(console.error);
```

Ejecutar:

```powershell
node backend\src\scripts\seed.js
```

---

## 5. Verificación

### Backend

```powershell
cd backend
npm run dev
```

**Salida esperada:**
```
╔════════════════════════════════════════╗
║     🛡️  BITÁCORA SOC - BACKEND       ║
╠════════════════════════════════════════╣
║  Host:     0.0.0.0                     ║
║  Port:     3000                        ║
║  Timezone: America/Santiago            ║
║  API Docs: http://0.0.0.0:3000/api-docs║
╚════════════════════════════════════════╝
✅ MongoDB conectado correctamente
```

**Test endpoint:**
```powershell
curl http://localhost:3000/health
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-17T12:00:00.000Z",
  "timezone": "America/Santiago"
}
```

### Frontend

```powershell
cd frontend
npm start
```

**Salida esperada:**
```
Angular Live Development Server is listening on 0.0.0.0:4200 **
✔ Compiled successfully.
```

Acceder:
- Local: `http://localhost:4200`
- Por IP: `http://[SENSITIVE_DATA_REDACTED]:4200`

---

## 6. Configuración Inicial Admin

### 6.1 Login

1. Ir a `http://[SENSITIVE_DATA_REDACTED]:4200`
2. Login: `admin` / `CHANGE_ME`
3. Cambiar password inmediatamente (Mi Perfil → Cambiar contraseña)

### 6.2 Configuración General

Admin → Config General:
- Nombre de la aplicación: "Bitácora SOC"
- Cooldown checklist: 4 horas (ajustar según operación)
- Modo invitado:
  - Habilitado: Sí/No
  - Duración: 2 días (1-30 días)

### 6.3 Catálogo de Servicios

**Checklist → Servicios (admin):**

Agregar servicios SOC:
- QRadar
- Zabbix
- Wazuh
- Splunk
- FortiGate
- etc.

**Orden:** Drag & drop para reordenar

### 6.4 SMTP (Opcional)

Si quieres notificaciones email de checklist:

**Admin → SMTP:**

1. Seleccionar proveedor (Office 365, Google, AWS SES, etc.)
2. Ingresar credenciales
3. Configurar remitente
4. Agregar destinatarios
5. Toggle: "Enviar solo si hay rojos" (Sí/No)
6. **Probar configuración** (envía test email)
7. Guardar

**Seguridad:** Password se cifra con AES-256-GCM, nunca se retorna al frontend.

---

## 7. Usuarios Adicionales

Admin → Admin Usuarios → Nuevo:
- Username (único)
- Email (único)
- Password (mín 6 chars)
- Nombre completo
- Rol:
  - Admin: Acceso total
  - User: Entradas + checklist
  - Guest: Solo entradas (temporal)

**Guests:**
- Si modo invitado habilitado, se calcula `guestExpiresAt` automáticamente
- Expira según configuración (default 2 días)
- Después de expiración, no puede hacer login

---

## 8. Logo Personalizado

Admin → Config General → Logo:
1. Click "Cambiar logo"
2. Seleccionar imagen (PNG/JPG, máx 2MB)
3. Upload
4. Se muestra en sidebar

Path almacenado: `backend/uploads/logo.png`

---

## 9. Backup Inicial

Admin → Backup/Restore:
1. Click "Crear Backup"
2. Esperar (puede tardar según tamaño DB)
3. Descarga automática o lista en "Backups disponibles"

Path: `backend/backups/backup-YYYY-MM-DDTHH-MM-SS/`

---

## 10. Troubleshooting Instalación

### Backend no inicia

Error: `ENCRYPTION_KEY no configurada`
```
⚠️ ENCRYPTION_KEY no configurada o muy corta. Usa: openssl rand -hex 32
```

Solución:
```powershell
openssl rand -hex 32 | Out-File -Encoding ASCII .encryption_key
```

**Error: `MongoDB connection failed`**
```
MongooseError: connect ECONNREFUSED 127.0.0.1:27017
```

**Solución:**
```powershell
# Verificar MongoDB corriendo
net start MongoDB

# O iniciar manualmente
mongod --dbpath C:\data\db
```

### Frontend no compila

**Error: `Port 4200 is already in use`**

**Solución:**
```powershell
# Cambiar puerto en package.json
"start": "ng serve --host 0.0.0.0 --port 4201"
```

### CORS Error

**Error en console browser:**
```
Access to XMLHttpRequest blocked by CORS policy
```

**Solución:**
1. Verificar IP en `backend\.env` → `ALLOWED_ORIGINS`
2. Verificar IP en `frontend\src\environments\environment.ts` → `apiUrl`
3. Reiniciar backend

---

## 11. Siguiente Paso

Ver [RUNBOOK.md](./RUNBOOK.md) para operación diaria SOC.

---

<a name="docs-troubleshooting"></a>

# 🔧 Troubleshooting - Bitácora SOC (Docker)

Solución de problemas comunes categorizados por área, asumiendo un despliegue estándar usando **Docker Compose**.

---

## 🐋 Comandos Docker Esenciales

Antes de entrar en problemas específicos, aquí tienes los comandos básicos para diagnosticar:

```bash
# Ver estado de los contenedores (debe decir "Up" y "healthy")
docker compose ps

# Ver logs en tiempo real de un servicio específico
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mongodb

# Reiniciar un servicio
docker compose restart backend

# Entrar a un contenedor para diagnosticar
docker compose exec backend sh
```

---

## 🖥️ Backend

### Contenedor Backend se reinicia constantemente (Crash Loop)

Síntoma: `docker compose ps` muestra el backend "restarting" o "exited".

1. Ver el motivo exacto del crash:
```bash
docker compose logs --tail=50 backend
```

2. Error "MongoServerSelectionError" (no conecta a BD):
- Verificar que MongoDB esté `healthy`: `docker compose ps`
- Verificar las credenciales en el `.env`
- Si la IP cambió (en caso de usar MongoDB externo), actualizar `MONGODB_URI` y reiniciar: `docker compose up -d backend`

3. Error "ENCRYPTION_KEY must be 32 bytes" o "JWT_SECRET missing":
- El archivo `.env` está incompleto.
- Editar `.env`, generar las claves necesarias (`openssl rand -hex 32`) y reiniciar: `docker compose restart backend`

---

### EADDRINUSE: Puertos 3000 o 3443 en uso

Síntoma: Falla al levantar el docker compose con error `bind: address already in use`.

Causa: Otra aplicación está usando el puerto en la máquina host.

Solución:
1. Identificar qué usa el puerto en el host:
   - Windows: `netstat -ano | findstr :3000`
   - Linux: `sudo lsof -i :3000`
2. Matar el proceso host problemático.
3. Alternativa: Cambiar el puerto en el `.env` y hacer `docker compose up -d`.

---

## 💾 MongoDB (Base de Datos)

### Contenedor de BD no está "healthy"

Síntoma: `docker compose ps` muestra `mongodb` como `unhealthy`.

Causa: Volumen dañado, permisos incorrectos en `.data/mongodb_data`, o RAM insuficiente.

Diagnóstico:
```bash
docker compose logs mongodb
```

---

## 🌐 Frontend (Nginx/Angular)

### Frontend no carga datos (API Error) u "Host de API inalcanzable"

Síntoma: login falla, requests con error CORS/502 en consola del navegador.

Causa 1: CORS incorrecto en backend:
- El `.env` del backend debe incluir la IP pública/dominio actual en `ALLOWED_ORIGINS`.
- Reiniciar backend: `docker compose restart backend`

Causa 2: URL de las APIs en el frontend:
- Editar `frontend/src/environments/environment.prod.ts` la directiva `apiUrl` hacia IP/dominio real del servidor.
- Como Nginx sirve estáticos compilados, reconstruir el frontend.

---

## 📧 Servidor SMTP (Correos)

Síntoma: "Test SMTP" falla o los turnos no envían correos.

1. Ver el error exacto:
```bash
docker compose logs backend | grep smtp
```

2. Connection Refused / Timeout:
- Ajustar firewall corporativo para permitir salida en puertos SMTP.
- Considerar bloqueos IPv6 si SMTP no lo soporta.

3. Autenticación fallida:
- Usar contraseña de "Aplicación" cifrada (según proveedor).

---

## 🔒 Certificados TLS/HTTPS

Síntoma: Advertencia roja en navegador o Nginx falla al levantar.

Causa: certificados mapeados en `./.data/tls` son autofirmados por defecto o expirados.

Solución para certificados reales:
1. Copiar certificado empresarial a `.data/tls/cert.pem` y `.data/tls/key.pem`
2. Reiniciar frontend:
```bash
docker compose restart frontend
```

---

## 🧹 Limpiar y Reempezar (Modo Nuclear)

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

*(No te preocupes, tus BD están a salvo en `.data/mongodb_data`)*

---

<a name="docs-backup"></a>

# 💾 Backup y Recuperacion - Bitacora SOC

Procedimientos de respaldo, restauracion e importacion/exportacion.

---

## ✅ Respaldo Multicolección (ZIP)

### Crear backup

Endpoint: `POST /api/backup/create` (admin)

Respuesta:
```json
{
  "message": "Backup completo creado exitosamente",
  "filename": "backup-2026-03-06T18-54-19-392Z.zip",
  "collections": 24,
  "documents": 10,
  "sizeBytes": 3489
}
```

### Historial

Endpoint: `GET /api/backup/history` (admin)

Respuesta:
```json
{
  "backups": [
    {
      "_id": "backup-2026-02-08T18-22-10-123Z.json",
      "filename": "backup-2026-02-08T18-22-10-123Z.json",
      "createdAt": "2026-02-08T18:22:10.123Z",
      "size": 2489012
    }
  ]
}
```

### Restaurar backup

Endpoint: `POST /api/backup/restore` (admin)

Body:
```json
{
  "filename": "backup-2026-03-06T18-54-19-392Z.zip",
  "clearBeforeRestore": true
}
```

Notas:
- `clearBeforeRestore=true` borra todas las colecciones antes de restaurar.
- El restore descomprime el archivo `.zip` en memoria y valida la estructura de cada `.json` internamente antes de aplicar.

### Eliminar backup

Endpoint: `DELETE /api/backup/:id` (admin)

Ejemplo: `DELETE /api/backup/backup-2026-02-08T18-22-10-123Z.json`

---

## 📤 Exportacion CSV

Endpoint: `GET /api/backup/export/:type` (admin)

Tipos soportados:
- `entries`
- `checks`
- `all` (exporta multiples archivos)

Ejemplo:
```bash
curl -X GET http://localhost:3000/api/backup/export/entries \
  -H "Authorization: Bearer $TOKEN" \
  -o entradas.csv
```

---

## 📥 Importacion CSV/JSON

Endpoint: `POST /api/backup/import` (admin)

Contenido: `multipart/form-data`
- `file`: archivo `.json` o `.csv`
- `type`: `entries` | `checks` | `users` | `catalogs` (segun el formato)

---

## 🗂️ Ubicacion de archivos

Los backups comprimidos `.zip` se guardan en:
- Local: `backend/backups/`
- Docker: Volumen mapeado a `./.data/backups/` en el host, montado en `/app/backups/` dentro del contenedor.

---

## 🔒 Seguridad

- Solo admin puede crear/restaurar/importar/eliminar.
- Auditoria de operaciones: `admin.backup.*`.
- Sanitizacion de rutas y validacion de nombres de archivo.

<a name="docs-deploy"></a>

# Bitacora SOC - Guía de Despliegue y Operación

> **Nota:** Todos los comandos de esta guía asumen el uso de `docker compose` (V2). Si tu instalación aún utiliza la versión antigua, reemplaza el comando por `docker-compose`.
> **Aviso de Seguridad:** Los valores expuestos en esta guía son ejemplos descriptivos. Por favor, asegúrate de reemplazarlos por credenciales fuertes en tu archivo `.env` antes de ir a producción.

---

## 1. Requisitos Previos

*   **Docker Desktop** o **Docker Engine** (con plugin Compose).
*   **Git** instalado.

---

## 2. Despliegue Rápido (Quick Start - Producción)

El flujo ideal para levantar la plataforma desde cero en un entorno servidor.

```bash
# 1. Clonar el repositorio y entrar al directorio
git clone <URL_DEL_REPOSITORIO> bitacora-soc
cd bitacora-soc

# 2. Configurar variables de entorno
cp .env.example .env
nano .env  # Editar TODAS las credenciales (Revisar Sección 4)

# 3. Generar secretos criptográficos obligatorios
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 4. Construir y levantar los servicios en segundo plano
docker compose up -d --build

# 5. Inicializar la Base de Datos (Elegir una opción)

# OPCIÓN A (Producción Recomentada): Instalar SOLO al usuario Administrador en limpio
docker compose exec backend node src/scripts/seed-admin.js

# OPCIÓN B (Pruebas/Desarrollo): Instalar Admin + Datos de Prueba (Turnos, Clientes, Checklists)
docker compose exec backend node src/scripts/seed.js

# 6. Acceder a la plataforma
# Abrir navegador en http://IP-SERVIDOR:FRONTEND_PORT (Por defecto 80)
```

---

## 3. Actualización de Versiones

Para mantener la Bitácora actualizada obteniendo los últimos cambios de la rama principal (`main`).

### Actualización Normal (Recomendada)
Descarga los cambios y recompila solo las capas de caché afectadas.

```bash
git pull origin main
docker compose build --no-cache
docker compose up -d
```

### Reconstrucción Forzada (Clean Recreate)
Si hay cambios estructurales complejos o problemas de caché adherida.

```bash
git pull origin main
docker compose build --no-cache
docker compose up -d --force-recreate
```

### Automatización Integrada (Versionado Git)
Si cuentas con Bash o PowerShell, puedes utilizar los scripts nativos adjuntos, los cuales inyectan la variable `APP_VERSION` basada en los últimos commits de Git (ej: `v1.2.3-5-gabc1234`) y la visibiliza en la plataforma.

*   **Windows:** `.\scripts\compose-rebuild.ps1`
*   **Linux/Mac:** `sh ./scripts/compose-rebuild.sh`

### Inyección de Datos Semilla (Posterior a Actualización)
Si en las notas de la nueva versión se han agregado nuevos catálogos base, configuraciones o roles por defecto, es recomendable volver a ejecutar el comando de "siembra" para inyectar estos datos en la base de datos sin afectar tu data existente:

```bash
docker compose exec backend node src/scripts/seed.js
```

---

## 4. Variables Clave Globales (`.env`)

```bash
# ============================
# PUERTOS EXTERNOS
# ============================
FRONTEND_PORT=80
BACKEND_PORT=3000
BACKEND_HTTPS_PORT=3443

# ============================
# SEGURIDAD Y DOMINIOS
# ============================
# (Obligatorio en Prod) Dominio principal exacto
ALLOWED_ORIGINS=https://[SENSITIVE_DATA_REDACTED]

# True si sirves bajo HTTPS nativo / False si es solo red local plana
COOKIE_SECURE=true

# Generar mediante 'openssl rand'
JWT_SECRET=[SENSITIVE_DATA_REDACTED]
ENCRYPTION_KEY=[SENSITIVE_DATA_REDACTED]

# ============================
# BASE DE DATOS MONGODB
# ============================
MONGO_ROOT_PASSWORD=[SENSITIVE_DATA_REDACTED]
MONGO_DATABASE=bitacora_soc

# ============================
# CREDENCIALES SEED
# ============================
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME
ADMIN_EMAIL=[SENSITIVE_DATA_REDACTED]
```

---

## 5. Configuración HTTPS y Seguridad TLS (0-Downtime)

Bitácora SOC soporta inyección dinámica TLS directamente desde la Base de Datos, previniendo reinicios del contenedor al rotar certificados.

Los certificados son almacenados internamente bajo un volumen Docker estricto en `.data/tls` (montado en `/app/secrets`).

### Instalación de Certificados Reales
1. Entrar a la plataforma web como Administrador.
2. Navegar a **Configuración > HTTPS / Seguridad**.
3. Seleccionar los archivos `.crt` (Certificado) y `.key` (Llave Privada).
4. Activar check de **Habilitar listener HTTPS del backend**.
5. Apretar **"Subir SSL y Activar (0-Downtime)"**.
6. El backend levantará HTTPS inmediatamente. Por precaución, recarga el backend: `docker compose restart backend`.
7. Si todo opera de forma estable, puedes **Forzar HTTPS** desde la consola para redireccionar el tráfico de forma permanente.
   > **Importante:** Actualiza el `.env` => `ALLOWED_ORIGINS=https://DOMINIO` antes de forzar, para prevenir auto-bloqueos CORS.

### Cómo probar TLS local (Certificados Autofirmados)
```bash
# 1. Generar llaves locales autofirmadas
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout local.key -out local.crt -subj "/CN=localhost"
```
2. Sube ambos archivos en la consola local y pulsa activar.
3. Node activará su motor criptográfico al vuelo. Verifica accediendo a `https://localhost:3443/health`.

---

## 6. Entorno de Desarrollo Local (Sin Docker)

> **Requisitos:** Node.js 24+ LTS, MongoDB 7+, Express 5.1+.

### 6.1 Backend
```bash
cd backend
cp .env.example .env

# Asegúrate de ajustar MONGODB_URI a localhost en tu .env

npm install
npm run dev             # Levanta API en http://localhost:3000
npm run seed            # Crea admin root
npm run restart:clean   # Libera forzosamente puertos zombies 3000/3443 en caso de crasheos
```

### 6.2 Frontend
```bash
cd frontend
npm install
npm run restart:clean   # Mata limpiamente los procesos de Angular zombies en el 4200 (EADDRINUSE)
npm start               # Levanta UI proxy en http://localhost:4200
```

> **Configuración Cruzada Local:** 
> Asegúrate de que `backend/.env` posea `ALLOWED_ORIGINS=http://localhost:4200`.

---

## 7. Gestión de Datos y Backups

### Backups Funcionales (Archivos Crudos)
**Resguardar Archivos de la Base de Datos (MongoDump):**
```bash
docker compose exec mongodb mongodump \
  --uri="mongodb://admin:${MONGO_ROOT_PASSWORD}@localhost/bitacora_soc?authSource=admin" \
  --out=/data/backup/$(date +%Y%m%d)

docker cp bitacora-mongodb:/data/backup ./backups/
```

**Resguardar Subidas Estáticas (Logos, Evidencias):**
```bash
docker run --rm -v bitacorasoc_backend_uploads:/source \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/uploads-$(date +%Y%m%d).tar.gz -C /source .
```

### Restauración vía API (JSON Integrado)
Si activaste la tarea automática de Backup en el panel, se grabarán archivos consolidados JSON en `.data/backups/`. Para restaurar alguno:
```powershell
# Obtén tu token Bearer logueándote como Admin, y dispara (solo desarrollo/rescate):
curl -X POST http://TU_IP:3000/api/backup/restore \
  -H "Authorization: Bearer TU_TOKEN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename":"backup-ARCHIVO.json","clearBeforeRestore":true}'
```

### Herramientas de Ingesta (CSV)
```bash
# Transformar CSV legacy en JSON local
node backend/scripts/csv-to-json-entries.js ruta_origen.csv salida.json

# Cargar masivamente en la BD en caliente
node backend/scripts/import-entries.js salida.json <username_que_creara_las_entradas>
```

---

## 8. Troubleshooting (Solución de Conflictos)

### Error de Permisos EACCES (Carpetas de volumen)
**Síntoma:** El Backend se reinicia constantemente diciendo `EACCES: permission denied, mkdir '/app/backups/temp'`
**Solución:** Los directorios del *host* carecen de validación de permisos requerida por el usuario no-raíz del contenedor.

```bash
sudo chown -R 1001:1001 .data/backups .data/uploads .data/logs
sudo chmod -R ug+rwX .data/backups .data/uploads .data/logs
mkdir -p .data/backups/temp
docker compose up -d --build
```

### Contenedores "Unhealthy" a pesar de Pings
**Solución:** Existen topologías donde `localhost` colisiona resolviendo directamente en IPv6 (`::1`). Edita los `Dockerfile` de front y back y re-apunta los cURL de Healthcheck hacia `127.0.0.1`.

### No puedo ingresar, dejé la contraseña del Admin perdida
**Solución:** Borra el usuario directamente en la base de datos en caliente y vuélvelo a inicializar:

```bash
# Eliminar admin
docker compose exec backend node -e "const mongoose=require('mongoose'); const User=require('./src/models/User'); mongoose.connect(process.env.MONGODB_URI).then(async()=>{ await User.deleteOne({username:'admin'}); console.log('Usuario admin borrado'); process.exit(0); })"

# Volver a inyectar Semilla
docker compose exec backend node src/scripts/seed.js
```

### Frontend en Blanco / Error NGINX
**Síntoma:** Docker Compose dice que frontend está "Running", pero el puerto 80 web no muestra nada o tira 404/502.
**Acciones:**
```bash
docker compose logs -f frontend                                  # Analizar salidas en rojo
docker compose exec frontend ls -la /usr/share/nginx/html      # Verificar si existe compilador
docker compose exec frontend nginx -t                            # Verificar integridad del daemon
```

### Corrección Masiva (Clientes sin asignar)
**Síntoma:** Tras actualizar versiones, las entradas web viejas carecen de campo `clientId`.
**Solución:** Asignar un "LogSource por defecto" y correr paridad de rescate.
```bash
# Logueo directo en la consola MongoDB
docker exec -it bitacora-mongodb mongosh --username admin --authenticationDatabase admin

# (Ejecutar en la consola DB) Corrección en masa:
db = db.getSiblingDB("bitacora_soc");
const source = db.catalog_log_sources.findOne({ _id: db.appconfigs.findOne({}).defaultLogSourceId });
if(source) db.entries.updateMany({ clientId: null }, { $set: { clientId: source._id, clientName: source.name } });
```

---

<a name="docs-logging"></a>

# 📊 Sistema de Logging y Auditoría - BitacoraSOC

## Arquitectura

El sistema implementa 3 capas de observabilidad:

1. **Logs estructurados** (pino): JSON para stdout/stderr
2. **Auditoría persistente** (MongoDB): AuditLog collection con TTL
3. **Forwarding a SIEM** (TCP/TLS): Envío a colector externo

---

## 1. Logs Estructurados (pino)

### Formato

```json
{
  "level": 30,
  "time": 1704067200000,
  "pid": 12345,
  "hostname": "soc-server",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "auth.login.success",
  "userId": "507f1f77bcf86cd799439011",
  "role": "admin",
  "msg": "User logged in"
}
```

### Niveles

- `trace` (10): Debug muy detallado
- `debug` (20): Debug general
- `info` (30): Eventos informativos (default)
- `warn` (40): Advertencias
- `error` (50): Errores
- `fatal` (60): Errores fatales

---

### Uso en código

```javascript
const { logger, requestLogger, actorLogger, sanitize } = require('./utils/logger');

// Log básico
logger.info({ event: 'user.login', userId: '123' }, 'User logged in');

// Con request context
const reqLogger = requestLogger(req);
reqLogger.info({ event: 'entry.create' }, 'Entry created');

// Con actor context
const actorLog = actorLogger(req.user);
actorLog.warn({ event: 'permission.denied' }, 'Access denied');

// Sanitizar objeto (remove secrets)
const safe = sanitize({ password: '123', data: 'public' });
// → { data: 'public' } (password removido)
```

---

## 2. Auditoría Persistente (MongoDB)

### Colección: AuditLog

```javascript
{
  _id: ObjectId,
  timestamp: Date,           // indexed
  event: String,             // namespace.action (ej: "auth.login.success")
  level: String,             // info | warn | error
  actor: {
    userId: ObjectId,
    username: String,
    role: String,
    isGuest: Boolean
  },
  request: {
    requestId: String,       // correlation ID
    ip: String,
    userAgent: String,
    method: String,
    path: String
  },
  result: {
    success: Boolean,
    reason: String,
    statusCode: Number
  },
  metadata: Object,          // flexible (sanitizado)
  forwarded: Boolean         // true si se envió a SIEM
}
```

### TTL (Time To Live)

Los logs se eliminan automáticamente después de **90 días** (configurable):

```bash
AUDIT_TTL_DAYS=90
```

### Inmutabilidad

Los registros de auditoría **NO se pueden modificar ni eliminar** manualmente. Mongoose hooks lo previenen.

### Uso en código

```javascript
const { audit } = require('./utils/audit');

// En una ruta
await audit(req, {
  event: 'entry.create',
  level: 'info',
  result: { success: true },
  metadata: {
    entryId: entry._id,
    entryType: 'incidente',
    tagCount: 5
  }
});
```

### Eventos auditados

| Namespace | Acción | Nivel | Descripción |
|-----------|--------|-------|-------------|
| `auth.login` | `.success` / `.fail` | info/warn | Login de usuario |
| `entry.create` | `.update` / `.delete` | info | CRUD de entradas |
| `shiftcheck.submit` | - | info | Registro de check de turno |
| `shiftcheck.block` | `.consecutive` / `.cooldown` | warn | Bloqueos de validación |
| `admin.users` | `.create` / `.update` / `.delete` | info | Gestión de usuarios |
| `admin.backup` | `.create` / `.restore` | info | Backups |
| `admin.logging` | `.view` / `.update` / `.test` | info | Config de forwarding |

### API de auditoría (admin/auditor)

```
GET /api/audit-logs
GET /api/audit-logs/events
GET /api/audit-logs/stats
```

**Roles:** `admin` y `auditor`.

---

## 3. Log Forwarding (SIEM)

### Configuración

Solo **admin** puede configurar forwarding:

**GET** `/api/logging/config`
```json
{
  "enabled": false,
  "host": "siem.example.com",
  "port": 5140,
  "mode": "plain",
  "tls": {
    "rejectUnauthorized": true,
    "caCert": "-----BEGIN CERTIFICATE-----...",
    "clientCert": null
  },
  "retry": {
    "enabled": true,
    "maxRetries": 5,
    "backoffMs": 1000
  },
  "forwardLevel": "audit-only"
}
```

**PUT** `/api/logging/config`
```json
{
  "enabled": true,
  "host": "[SENSITIVE_DATA_REDACTED]",
  "port": 5140,
  "mode": "tls",
  "forwardLevel": "audit-only"
}
```

**POST** `/api/logging/test` → Envía log de prueba

### Formato enviado (NDJSON)

Cada línea es un JSON completo:

```json
{"timestamp":"2024-01-01T12:00:00.000Z","event":"auth.login.success","level":"info","actor":{"userId":"507f...","username":"admin","role":"admin","isGuest":false},"request":{"requestId":"550e8400...","ip":"[SENSITIVE_DATA_REDACTED]","userAgent":"Mozilla/5.0...","method":"POST","path":"/api/auth/login"},"result":{"success":true,"reason":"Login successful"},"metadata":{"isGuest":false}}
{"timestamp":"2024-01-01T12:05:00.000Z","event":"entry.create","level":"info","actor":{...},"request":{...},"result":{...},"metadata":{...}}
```

### Protocolos

#### TCP Plain

```bash
# Test receptor (netcat)
nc -l 5140
```

Usar solo en desarrollo o redes internas aisladas.

#### TCP + TLS

```bash
# Test receptor (openssl)
openssl s_server -accept 5140 -cert server.pem -key server-key.pem
```

Producción DEBE usar TLS con certificado válido.

### mTLS (Mutual TLS)

Si el SIEM requiere client certificate:

1. Admin sube `clientCert` (PEM) en config
2. Admin configura `LOG_FORWARD_CLIENT_KEY` en `.env`:

```bash
LOG_FORWARD_CLIENT_KEY=/path/to/client-key.pem
```

⚠️ **NUNCA** guardar `clientKey` en MongoDB (solo en env).

### Filtrado por nivel

- `audit-only`: Solo eventos de AuditLog (default)
- `info`: AuditLog + logs info
- `warn`: AuditLog + logs warn/error
- `error`: Solo logs error

### Backoff exponencial

Si el colector está down:

- Intento 1: wait 1s
- Intento 2: wait 2s
- Intento 3: wait 4s
- Intento 4: wait 8s
- Intento 5: wait 16s
- Intento 6+: desiste

### Queue

Si conexión está caída, los logs se encolan en memoria (max 1000). Cuando reconecta, se envían todos.

---

## Seguridad

### Sanitización automática

Estas claves se **eliminan** antes de loggear:

- `password`
- `token`
- `jwt`
- `secret`
- `apiKey`
- `authorization`
- `cookie`

### Límite de metadata

Metadata de audit se trunca a **10KB** para evitar payloads gigantes.

### Certificados

- **CA Cert**: validar identidad del servidor SIEM
- **Client Cert**: autenticación mTLS (opcional)
- **rejectUnauthorized**: `true` por defecto (NO aceptar self-signed en prod)

---

## Correlation ID (X-Request-Id)

Cada request tiene un UUID v4 único:

- Cliente puede enviar header `X-Request-Id` (se reutiliza)
- Si no existe, backend genera uno nuevo
- Aparece en **todos** los logs de ese request
- Se retorna en response header

Permite tracing end-to-end: Frontend → Backend → Logs → SIEM

---

## Troubleshooting

### Los logs no aparecen en stdout

Verificar `LOG_LEVEL`:

```bash
LOG_LEVEL=debug node src/server.js
```

### AuditLog no persiste

Verificar conexión MongoDB:

```bash
mongo
> use bitacora_soc
> db.auditlogs.find().limit(5)
```

### Forwarding no funciona

1. Test conexión:
   ```bash
   curl -X POST http://localhost:3000/api/logging/test \
     -H "Authorization: Bearer <admin-token>"
   ```

2. Verificar logs del forwarder:
   ```bash
   grep "logforward" logs/combined.log
   ```

3. Test manual (netcat):
   ```bash
   # Terminal 1
   nc -l 5140

   # Terminal 2 (admin UI o API)
   # Habilitar forwarding → host localhost, port 5140
   ```

### TLS handshake fails

Verificar certificados:

```bash
openssl s_client -connect siem.example.com:5140 -showcerts
```

Si usa self-signed en dev, set `rejectUnauthorized: false` (⚠️ NO en prod).

---

## Integración SIEM

### Logstash

```ruby
input {
  tcp {
    port => 5140
    codec => json_lines
  }
}

filter {
  mutate {
    add_field => { "[@metadata][source]" => "bitacora-soc" }
  }
}

output {
  elasticsearch {
    hosts => ["http://localhost:9200"]
    index => "bitacora-%{+YYYY.MM.dd}"
  }
}
```

### Graylog

1. **System / Inputs** → Create Input
2. Type: **Raw/Plaintext TCP**
3. Port: 5140
4. Codec: **JSON Lines** (extractor)

### Splunk

```bash
# inputs.conf
[tcp://5140]
sourcetype = _json
source = bitacora-soc
```

---

## Performance

### pino (logger)

- **3x más rápido** que winston
- Writes asíncronos a stdout (non-blocking)
- Pretty print solo en dev (prod es JSON puro)

### logForwarder

- **Queue in-memory**: 1000 logs max (previene memory leak)
- **No blocking**: `process.nextTick` para forwarding
- **Connection pooling**: reutiliza socket TCP/TLS

### AuditLog

- **Indexes**: timestamp, event, actor.userId
- **TTL index**: auto-delete después de 90 días
- **Immutable**: no se puede UPDATE/DELETE (solo INSERT)

---

## Desarrollo

### Test sin SIEM real

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start netcat collector
nc -l 5140

# Terminal 3: Configure forwarding (admin)
curl -X PUT http://localhost:3000/api/logging/config \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "host": "localhost",
    "port": 5140,
    "mode": "plain",
    "forwardLevel": "audit-only"
  }'

# Terminal 4: Trigger audit event
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME"}'

# Ver en Terminal 2: JSON llegando a netcat
```

### Pretty logs en dev

```bash
NODE_ENV=development npm run dev
```

Output:
```bash
[12:00:00.123] INFO (12345): User logged in
    event: "auth.login.success"
    userId: "507f1f77bcf86cd799439011"
    requestId: "550e8400-e29b-41d4-a716-446655440000"
```

### Modo JSON puro

```bash
NODE_ENV=production npm start
```

Output:
```json
{"level":30,"time":1704067200123,"pid":12345,"event":"auth.login.success","userId":"507f1f77bcf86cd799439011","msg":"User logged in"}
```

---

## Referencias

- [pino documentation](https://getpino.io/)
- [NDJSON specification](http://ndjson.org/)
- [RFC 4122 (UUID)](https://datatracker.ietf.org/doc/html/rfc4122)
- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/signals/traces/#context-propagation)

<a name="docs-security"></a>

# 🔐 Seguridad - Bitácora SOC

Decisiones de seguridad, hardening y checklist pre-producción.

---

## Decisiones de Seguridad

### Autenticación y Autorización

**JWT Tokens:**
- Duración: 4h (admin/user), 2h (guest)
- Algoritmo: HS256
- Secret: `JWT_SECRET` en `.env` (generado con `openssl rand -base64 32`)
- Clock skew tolerance: ±60 segundos

**RBAC (Role-Based Access Control):**
- Admin: Acceso completo
- User: Operación diaria (entradas, checklist, notas personales)
- Auditor: Lectura de auditoría y trazabilidad
- Guest: Acceso limitado; entradas marcadas como invitado

**Validación de Roles:**
- Middleware: `authMiddleware` + `roleMiddleware`
- Endpoints sensibles protegidos con `role(['admin'])`

### Cifrado de Datos

**Passwords de Usuarios:**
- Algoritmo: bcrypt
- Rounds: 8
- No se loguean nunca

**Passwords SMTP:**
- Algoritmo: AES-256-GCM
- Key: `ENCRYPTION_KEY` en `.env`
- Generación: `openssl rand -hex 32` (64 chars hex = 32 bytes)
- IV: Aleatorio por cada cifrado (almacenado con datos)
- Auth tag: Verificación de integridad

**Generación de Claves:**
```powershell
# JWT_SECRET (32 bytes base64)
openssl rand -base64 32

# ENCRYPTION_KEY (32 bytes hex)
openssl rand -hex 32
```

### CORS (Cross-Origin Resource Sharing)

**Configuración:**
- En desarrollo, CORS permite cualquier origen
- En producción, usa allowlist en `ALLOWED_ORIGINS`
- Si `ALLOWED_ORIGINS` contiene `*`, permite todos (no recomendado)

**Ejemplo:**
```env
ALLOWED_ORIGINS=http://[SENSITIVE_DATA_REDACTED]:4200,http://[SENSITIVE_DATA_REDACTED]:4200
```

**Headers permitidos:**
- Authorization
- Content-Type
- X-Request-Id

**Credentials:** `true` (permite cookies)

**Rechazo:**
- Orígenes no listados reciben 403 Forbidden
- Localhost debe agregarse manualmente si se requiere en producción

---

## Rate Limiting

### Límites Diferenciados

**Login (prevención brute-force):**
- Límite: 5 intentos (producción)
- Ventana: 15 minutos
- Nota: `loginLimiter` existe pero debe montarse explícitamente en la ruta de login

**API General:**
- Límite: 100 requests
- Ventana: 15 minutos
- Endpoints: `/api/**` (solo en producción)

**SMTP Test (prevención abuso):**
- Límite: 3 intentos
- Ventana: 15 minutos
- Endpoint: `POST /api/smtp/test`

### Configuración

Variables `.env`:
```env
RATE_LIMIT_WINDOW_MS=900000      # 15 min
RATE_LIMIT_MAX_REQUESTS=100      # API general
RATE_LIMIT_LOGIN_MAX=5           # Login
RATE_LIMIT_SMTP_MAX=3            # SMTP test
```

### Respuesta 429

```json
{
  "message": "Too many requests, please try again later."
}
```

Headers incluidos:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1702814400
```

---

## Sanitización de Logs

### Datos NO Logueados

**Palabras clave bloqueadas:**
- `password`
- `token`
- `jwt`
- `secret`
- `apiKey`
- `authorization`
- `cookie`
- `encryptionKey`

**Middleware:**
- `logSanitizer.js` reemplaza con `[REDACTED]`
- Aplica a req.body, req.query, req.headers

**Ejemplo:**
```javascript
// Request original
{ "username": "admin", "password": "CHANGE_ME" }

// Log generado
{ "username": "admin", "password": "[REDACTED]" }
```

**Verificación:**
```bash
# Buscar passwords en logs (NO debe haber resultados)
grep -i "password.*:" backend/logs/*.log
```

---

## Hardening con Helmet

### Headers de Seguridad

**Content Security Policy (CSP):**
- En backend, CSP esta deshabilitado (`contentSecurityPolicy: false`).
- Se recomienda aplicar CSP en el reverse proxy (Nginx) para Angular y APIs.

**HTTP Strict Transport Security (HSTS):**
- Fuerza HTTPS
- Max-Age: 1 año
- includeSubDomains: true

**X-Frame-Options:**
- Valor: `DENY`
- Previene clickjacking

**X-Content-Type-Options:**
- Valor: `nosniff`
- Previene MIME sniffing

**X-XSS-Protection:**
- Valor: `1; mode=block`
- Filtro XSS legacy (navegadores antiguos)

### Verificación

```bash
curl -I http://[SENSITIVE_DATA_REDACTED]:3000/health | grep -E "X-|Content-Security"
```

Debe mostrar:
```
Content-Security-Policy: ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
```

---

## Prevención de Ataques

### Command Injection

**Problema (ANTES):**
```javascript
// ❌ VULNERABLE
const { exec } = require('child_process');
exec(`mongodump -d ${dbName}`);
// Input malicioso: "bitacora; rm -rf /"
```

**Solución (DESPUÉS):**
```javascript
// ✅ SEGURO
const { spawn } = require('child_process');
const sanitizePath = require('../utils/sanitizePath');

const dbName = sanitizePath(req.body.dbName);
spawn('mongodump', ['-d', dbName]);
```

**Validación de Paths:**
- Función: `sanitizePath.js`
- Bloquea: `..`, `/`, `\`, `;`, `|`, `&`, `$`, `` ` ``, `*`
- Permite: alfanuméricos, `-`, `_`, `.`

**Archivos afectados:**
- `backend/src/controllers/backupController.js`

### NoSQL Injection

**Problema (ANTES):**
```javascript
// ❌ VULNERABLE
User.findOne({ username: req.body.username });
// Input malicioso: { "$ne": null }
```

**Solución (DESPUÉS):**
```javascript
// ✅ SEGURO
if (typeof req.body.username !== 'string') {
  return res.status(400).json({ message: 'Invalid username' });
}
User.findOne({ username: req.body.username });
```

**Sanitización:**
- Middleware: `sanitizeInput.js`
- Valida: Todos los inputs son strings (no objects)
- Bloquea: Operadores MongoDB (`$ne`, `$gt`, `$regex`, etc.)

**Archivos afectados:**
- `backend/src/routes/authRoutes.js`
- `backend/src/routes/entryRoutes.js`
- `backend/src/routes/userRoutes.js`

### ReDoS (Regular Expression Denial of Service)

**Problema:**
- Regex complejos con backtracking exponencial
- Input malicioso colapsa CPU

**Solución:**
```javascript
// Límite de iteraciones
const MAX_ITERATIONS = 500;

// Timeout en operaciones regex
const { timeout } = require('regex-safety');
timeout(1000); // 1 segundo máximo

// Límite de tamaño de input
const MAX_TEXT_SIZE = 100 * 1024; // 100 KB

if (req.body.content.length > MAX_TEXT_SIZE) {
  return res.status(400).json({ message: 'Text too large' });
}
```

**Regex seguros (sin backtracking):**
```javascript
// Hashtags
const hashtagRegex = /#[a-z0-9_-]{1,50}/gi;

// Email
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

---

## Checklist Pre-Producción

### Backend

#### 1. Variables de Entorno

**✅ Verificar `.env`:**
```bash
# Generar ENCRYPTION_KEY
openssl rand -hex 32

# Generar JWT_SECRET
openssl rand -base64 32

# Configurar MongoDB
MONGODB_URI=mongodb://[SENSITIVE_DATA_REDACTED]:27017/bitacora

# Configurar CORS (IPs reales, NO localhost)
ALLOWED_ORIGINS=http://[SENSITIVE_DATA_REDACTED]:4200,http://[SENSITIVE_DATA_REDACTED]:4200
```

**❌ NO usar valores por defecto:**
- `ENCRYPTION_KEY=your-32-char...`
- `JWT_SECRET=super-secret-jwt-key`
- `ALLOWED_ORIGINS=http://localhost:4200`

#### 2. Rate Limiting

**✅ Verificar activo:**
```bash
curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}' \
  --write-out "\n%{http_code}\n"
# Repetir 6 veces → debe retornar 429
```

#### 3. CORS

**✅ Verificar rechazo orígenes no permitidos:**
```bash
curl -X GET http://[SENSITIVE_DATA_REDACTED]:3000/api/users/me \
  -H "Origin: http://malicious.com" \
  -H "Authorization: Bearer $TOKEN" \
  -I
# Debe retornar 403 Forbidden
```

#### 4. MongoDB

**✅ Autenticación habilitada:**
```bash
mongosh mongodb://[SENSITIVE_DATA_REDACTED]:27017/bitacora
# Debe pedir credenciales (no permitir conexión anónima)
```

**✅ Índices TTL creados:**
```javascript
// Verificar en MongoDB
db.auditlogs.getIndexes();
// Debe mostrar índice TTL en 'timestamp' con expireAfterSeconds
```

#### 5. Sanitización de Logs

**✅ Passwords NO logueados:**
```bash
grep -ri "password.*:" backend/logs/*.log
# NO debe haber resultados
```

#### 6. Helmet Headers

**✅ Verificar headers de seguridad:**
```bash
curl -I http://[SENSITIVE_DATA_REDACTED]:3000/health
# Debe incluir: X-Frame-Options, X-Content-Type-Options, CSP
```

### Frontend

#### 1. Configuración API URL

**✅ IP real (NO localhost):**
```typescript
// src/environments/environment.ts
export const environment = {
  production: true,
  apiUrl: 'http://[SENSITIVE_DATA_REDACTED]:3000/api'  // IP real del servidor
};
```

#### 2. Disable DevTools

**✅ Production mode:**
```typescript
// main.ts
if (environment.production) {
  enableProdMode();
}
```

#### 3. Build Optimizado

**✅ Compilar con AOT:**
```bash
ng build --configuration production
# Genera dist/ con archivos minificados
```

### MongoDB

#### 1. Autenticación

**✅ Crear usuario admin:**
```javascript
use admin
db.createUser({
  user: "bitacora_admin",
  pwd: "[SENSITIVE_DATA_REDACTED]",
  roles: [{ role: "readWrite", db: "bitacora" }]
})
```

**✅ Actualizar MONGODB_URI:**
```env
MONGODB_URI=mongodb://[SENSITIVE_DATA_REDACTED]@[SENSITIVE_DATA_REDACTED]:27017/bitacora
```

#### 2. Firewall

**✅ Solo permitir IP del servidor backend:**
```bash
# Windows Firewall
netsh advfirewall firewall add rule name="MongoDB" dir=in action=allow protocol=TCP localport=27017 remoteip=[SENSITIVE_DATA_REDACTED]
```

#### 3. Backup Automático

**✅ Configurar cron/task:**
```powershell
# Task Scheduler (Windows)
# Acción: mongodump -d bitacora -o C:\backups\bitacora\
# Frecuencia: Diaria 02:00 AM
```

Ver detalles en [BACKUP.md](./BACKUP.md)

### Red

#### 1. Firewall Corporativo

**✅ Permitir puertos necesarios:**
- Backend: TCP 3000
- Frontend: TCP 4200 (o 80/443 con reverse proxy)
- MongoDB: TCP 27017 (solo IP del backend)

#### 2. SIEM Forwarding (opcional)

**✅ Verificar conectividad:**
```bash
curl -X POST http://[SENSITIVE_DATA_REDACTED]:3000/api/logging/test \
  -H "Authorization: Bearer $TOKEN"
# Debe retornar éxito
```

Ver detalles en [LOGGING.md](./LOGGING.md)

---

## Auditoría de Seguridad

### Logs de Acceso

**Eventos auditados:**
- Login exitoso/fallido
- CRUD usuarios
- CRUD entradas
- CRUD checklist
- Cambios en configuración
- Backup/restore
- Pruebas SMTP

**Ubicación:**
- JSON logs: `backend/logs/app.log`
- MongoDB: colección `auditlogs`
- SIEM: forwarding TCP/TLS (opcional)

**Consulta:**
```javascript
// MongoDB
db.auditlogs.find({ action: "login", result: "failed" }).limit(10);

// Últimos logins
db.auditlogs.find({ action: "login", result: "success" })
  .sort({ timestamp: -1 })
  .limit(10);
```

### Retención

**Logs en disco:**
- Rotación: Diaria
- Compresión: gzip
- Retención: 30 días

**AuditLog en MongoDB:**
- TTL: 90 días (configurable)
- Índice automático en `timestamp`

**SIEM (si configurado):**
- Retención según política corporativa

---

## Incidentes de Seguridad

### Respuesta a Brute-Force

**Síntoma:** Rate limit 429 en `/api/auth/login`

**Acciones:**
1. Revisar logs de login fallidos:
   ```javascript
   db.auditlogs.find({ 
     action: "login", 
     result: "failed", 
     timestamp: { $gte: new Date(Date.now() - 3600000) } 
   });
   ```

2. Identificar IP atacante en logs JSON:
   ```bash
   grep "POST /api/auth/login" backend/logs/app.log | grep "401"
   ```

3. Bloquear IP en firewall:
   ```powershell
   netsh advfirewall firewall add rule name="Block Attacker" dir=in action=block remoteip=[SENSITIVE_DATA_REDACTED]
   ```

### Respuesta a Token Comprometido

**Síntoma:** Actividad sospechosa de un usuario

**Acciones:**
1. Invalidar sesión (cambiar JWT_SECRET):
   ```env
   # .env
   JWT_SECRET=<nuevo_secret>
   ```

2. Reiniciar backend:
   ```powershell
   # Task Manager → Terminar proceso Node.js
   # Iniciar nuevamente: npm run dev
   ```

3. Forzar re-login de todos los usuarios

4. Revisar audit logs:
   ```javascript
   db.auditlogs.find({ 
     userId: "675e...", 
     timestamp: { $gte: new Date("2025-12-17") } 
   });
   ```

### Respuesta a NoSQL Injection

**Síntoma:** Logs con objetos en lugar de strings

**Acciones:**
1. Verificar middleware `sanitizeInput` activo
2. Revisar logs de entrada sospechosa:
   ```bash
   grep "typeof.*object" backend/logs/app.log
   ```
3. Actualizar código si se encuentra bypass

---

## Referencias

- **Instalación segura:** [SETUP.md](./SETUP.md#configuracion-env)
- **Logging y auditoría:** [LOGGING.md](./LOGGING.md)
- **Backup seguro:** [BACKUP.md](./BACKUP.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Operación diaria:** [RUNBOOK.md](./RUNBOOK.md)

---

## Recursos Externos

- **OWASP Top 10 (2021):** https://owasp.org/Top10/
- **OWASP API Security Top 10:** https://owasp.org/API-Security/
- **Node.js Security Best Practices:** https://nodejs.org/en/docs/guides/security/
- **MongoDB Security Checklist:** https://www.mongodb.com/docs/manual/administration/security-checklist/
- **Express Security Best Practices:** https://expressjs.com/en/advanced/best-practice-security.html

---

<a name="docs-runbook"></a>

# 📖 Runbook Operativo - Bitácora SOC

Guía de operación diaria para analistas y administradores del Security Operations Center.

---

## Roles y Responsabilidades

### Admin
- Gestión de usuarios
- Configuración SMTP, catálogo servicios, cooldown
- Backups y restore
- Reportes y KPIs
- Configuración log forwarding (SIEM)

### Auditor
- Lectura de logs de auditoría
- Consulta de actividad (sin cambios de configuración)

### User (Analista)
- Registrar entradas operativas/incidentes
- Checklist de turno (inicio/cierre)
- Ver todas las entradas
- Editar perfil propio

### Guest (Temporal)
- Registrar entradas (marcadas como guest)
- Ver todas las entradas
- Expira automáticamente (default 2 días)

---

## Flujo de Turno

### 1. Inicio de Turno

**Responsable:** Analista entrante

**Pasos:**

1. **Login** → `http://[SENSITIVE_DATA_REDACTED]:4200`
   - Username / Password
   - Si guest: verificar que no haya expirado

2. **Revisar Notas del Administrador** (sidebar derecho)
   - Alertas importantes
   - Cambios en servicios
   - Instrucciones especiales

3. **Registrar Checklist Inicio** (acordeón lateral)
   - Click "Inicio de turno"
   - Evaluar **TODOS** los servicios activos:
     - Verde: Servicio operativo
     - Rojo: Servicio con problema
   - Si servicio en ROJO:
     - Observación **OBLIGATORIA** (máx 1000 chars)
     - Ejemplo: "Alerta de CPU en servidor prod-01. Se está investigando con equipo de infra."
   - Click "Registrar"

**Validaciones automáticas:**
- ❌ NO puedes hacer dos "inicio" consecutivos (debe alternar)
- ❌ Cooldown no cumplido (default 4h entre checks)
- ❌ Servicio en rojo sin observación

**Email automático:**
- Si SMTP configurado:
  - `sendOnlyIfRed=true` → envía solo si hay rojos
  - `sendOnlyIfRed=false` → envía siempre

### 2. Durante el Turno

**Registrar Entradas:**

1. **Escribir → Nueva Entrada**
2. Fecha/hora precargadas (Chile timezone)
3. Clasificación:
   - **Entrada operativa:** Monitoreo, alertas normales, revisiones
   - **Incidente:** Evento de seguridad, brecha, ataque
   - **Ofensa:** Registro asociado a ofensas/casos
4. Contenido:
   - Descripción detallada
   - Usa `#hashtags` para tags automáticos
   - Ejemplo: `#Trellix`, `#hunting`, `#malware`
5. **Subir**

**Hashtags:**
- Se extraen automáticamente del texto
- Se convierten a lowercase
- Máx 100 tags únicos por entrada
- Autocompletado mientras escribes

**Notas Personales:**
- Sidebar derecho → "Notas Personales"
- Solo tú las ves
- Autosave cada 3 segundos

### 3. Cierre de Turno

**Responsable:** Analista saliente

**Pasos:**

1. **Registrar Checklist Cierre** (acordeón lateral)
   - Click "Cierre de turno"
   - Evaluar todos los servicios nuevamente
   - Observaciones si hay cambios respecto al inicio

2. **Resumir Turno en Nota Personal** (opcional)
   - Incidentes atendidos
   - Pendientes para próximo turno

3. **Logout**

**Nota:** El cierre de turno puede disparar el reporte por correo si el turno tiene `emailReportConfig.enabled`.

---

## Reglas de Negocio Checklist

### Anti-spam (Previene errores)

❌ **NO permitido:**
- Dos "inicio" consecutivos sin "cierre" intermedio
- Dos "cierre" consecutivos sin "inicio" intermedio

✅ **Flujo correcto:**
```
inicio → cierre → inicio → cierre → inicio → ...
```

**Mensaje de error:**
```
No puedes registrar dos "inicio" consecutivos.
Debes hacer "cierre" primero.
```

### Cooldown Configurable

**Default:** 4 horas entre checks

**Configurable por admin:** 1-24 horas

**Cálculo:**
```
Tiempo desde último check >= cooldownHours
```

**Mensaje de error:**
```
Debes esperar 4 horas entre checks.
Tiempo restante: 2.3h
```

### Validación de Servicios

1. **Todos los servicios activos DEBEN incluirse**
   - Si catálogo tiene 5 servicios activos → deben evaluarse los 5

2. **Todos DEBEN tener estado (verde/rojo)**

3. **Si está en rojo:**
   - Observación OBLIGATORIA
   - Mínimo 10 caracteres, máximo 1000

**Ejemplo observación:**
```
Alerta de disco en servidor-logs-01.
Capacidad al 95%. Se solicitó ampliación a infra.
Ticket #12345.
```

### Indicador Visual del Acordeón

Muestra el **último check registrado**:
```
✅ Inicio: OK (sin rojos)
⛔ Inicio: Con problemas (al menos un rojo)
✅ Cierre: OK
⛔ Cierre: Con problemas
— Sin registro
```

---

## Clasificación de Entradas

### Entrada Operativa

**Uso:** Eventos normales del día a día

**Ejemplos:**
- Revisión de alertas en QRadar
- Actualización de reglas Wazuh
- Análisis de logs Zabbix
- Monitoreo de tráfico FortiGate
- Revisión de backups
- Cambios de configuración

**Tags comunes:**
- `#monitoreo`
- `#alertas`
- `#revisión`
- `#configuración`

### Incidente

**Uso:** Eventos de seguridad que requieren acción

**Ejemplos:**
- Intento de intrusión detectado
- Malware en estación de trabajo
- Acceso no autorizado
- Exfiltración de datos
- Ataque DDoS
- Phishing exitoso
- Vulnerabilidad crítica explotada

**Tags comunes:**
- `#incidente`
- `#malware`
- `#intrusión`
- `#phishing`
- `#vulnerabilidad`
- `#respuesta`

**Procedimiento adicional:**
- Escalar según playbook SOC
- Notificar a responsables
- Documentar paso a paso
- Adjuntar evidencias (IPs, hashes, logs)

---

## Notas Duales

### Notas del Administrador

**Sidebar derecho → superior**

**Características:**
- 🌍 **Globales:** Todos las ven
- ✏️ Solo admin puede editar
- 💾 Autosave cada 3 segundos

**Uso:**
- Avisos importantes
- Cambios en servicios
- Instrucciones de turno
- Contactos de emergencia
- Playbooks rápidos

**Ejemplo:**
```
🚨 IMPORTANTE:
- QRadar en mantenimiento 14:00-16:00 hoy
- Si alarma crítica, llamar a Juan ([SENSITIVE_DATA_REDACTED])
- Nueva regla Wazuh para detectar Log4Shell activa
```

### Notas Personales

**Sidebar derecho → inferior**

**Características:**
- 🔒 **Privadas:** Solo el usuario las ve
- ✏️ Cada usuario escribe las suyas
- 💾 Autosave cada 3 segundos

**Uso:**
- Pendientes personales
- Investigaciones en curso
- Links útiles
- Credenciales temporales (⚠️ no guardar passwords reales)

**Ejemplo:**
```
Pendientes turno:
- [ ] Revisar alarma de ayer (ticket #123)
- [ ] Actualizar regla FortiGate
- [x] Backup completado

Links:
- Dashboard Grafana: http://...
```

---

## Reportes y KPIs (Solo Admin)

**Admin → Reportes:**

### Dashboard
1. **Entradas operativas vs incidentes** (últimos N días)
   - Gráfico de barras
   - Filtro por rango de fechas
2. **Incidentes por analista** (top 10)
   - Ranking
3. **Top tags** (top 15 más usados)
   - Nube de palabras
4. **Checks con rojos por servicio**
   - Identifica servicios problemáticos
5. **Tendencia de entradas** (últimos 30 días)
   - Gráfico de línea
6. **Totales:**
   - Usuarios activos
   - Checks de turno registrados
   - Entradas totales

### Export CSV

**Admin → Reportes → Export Entradas:**
1. Seleccionar rango fechas
2. Click "Exportar CSV"
3. Descarga archivo: `bitacora_YYYY-MM-DD_YYYY-MM-DD.csv`

**Columnas:**
- Fecha, Hora
- Tipo (operativa/incidente)
- Contenido
- Tags
- Usuario
- Es Guest

**Uso:**
- Auditorías
- Análisis externo
- Respaldo adicional

---

## Configuración Avanzada (Admin)

### Catálogo de Servicios

**Admin → Checklist → Servicios:**

**Agregar servicio:**
1. Click "Nuevo servicio"
2. Título (ej: "QRadar")
3. Orden (opcional, drag & drop después)
4. Guardar

**Editar/Eliminar:**
- Click sobre servicio → Editar/Eliminar
- ⚠️ Si eliminas servicio, checks pasados lo mantienen

**Activar/Desactivar:**
- Toggle "Activo"
- Inactivos no aparecen en checklist nuevo
- Checks pasados siguen visibles

### Cooldown

**Admin → Config General:**
- **Cooldown entre checks:** 1-24 horas
- Default: 4 horas
- Afecta a todos los usuarios

**Caso de uso:**
- Turnos 8h → cooldown 7h
- Turnos 12h → cooldown 11h

### Modo Invitado

**Admin → Config General:**
- **Habilitar modo invitado:** Sí/No
- **Duración máxima:** 1-30 días (default 2)

**Creación guest:**
1. Admin → Admin Usuarios → Nuevo
2. Role: Guest
3. Se calcula automáticamente `guestExpiresAt`

**Expiración:**
- Login bloqueado después de fecha
- Mensaje: "Cuenta de invitado expirada"

---

## Historial y Búsqueda

### Ver Todas las Entradas

**🌍 Ver todas:**

**Filtros disponibles:**
- Búsqueda texto completo (contenido)
- Por tags (multiselect)
- Por tipo (operativa/incidente)
- Por rango fechas
- Por usuario (admin ve selector, users no)
- Paginación (20 por página)

**Ordenamiento:**
- Más recientes primero (default)

**Acciones:**
- Ver detalle
- Editar (solo creador o admin)
- Eliminar (solo creador o admin)

### Historial Checklist

**Checklist → Historial:**

**Filtros:**
- Por tipo (inicio/cierre)
- Por rango fechas
- Por usuario (admin only)

**Vista:**
- Fecha/hora
- Tipo
- Usuario
- Resumen (cuántos rojos)
- Click para ver detalle completo

---

## Troubleshooting Operativo

### Checklist no permite registrar

**Error: "No puedes registrar dos inicio consecutivos"**

**Causa:** Ya hiciste "inicio" y estás intentando otro "inicio"

**Solución:** Registra "cierre" primero

---

### Error: "Debes esperar X horas entre checks"**

**Causa:** Cooldown no cumplido

**Solución:**
- Esperar tiempo restante, O
- Pedir a admin que reduzca cooldown temporalmente

---

### Error: "Debes evaluar todos los servicios"**

**Causa:** Faltan servicios en la lista

**Solución:** Asegurar que lista tenga todos los servicios activos (acordeón muestra cuáles faltan)

---

### Error: "Servicio QRadar está en rojo y requiere observación"**

**Causa:** No pusiste observación en servicio rojo

**Solución:** Agregar observación (mín 10 chars)

### Email no se envía

**Verificar:**
1. Admin configuró SMTP (Admin → SMTP)
2. Configuración es válida (test OK)
3. Toggle "Enviar solo si hay rojos" coincide con tu check

**Log error:**
- Console backend muestra: "Error sending checklist email"
- Check se registra igual (email es opcional)

### No puedo editar entrada

**Causa:** Solo el creador o admin pueden editar

**Solución:**
- Si eres admin: editar normalmente
- Si no eres el creador: pedir al admin

---

## Checklist Pre-Turno

### Analista Entrante
- [ ] Verificar que MongoDB está corriendo
- [ ] Login exitoso
- [ ] Leer notas del administrador
- [ ] Registrar checklist inicio
- [ ] Revisar últimas entradas (30 min antes)
- [ ] Abrir dashboards SOC (QRadar, Zabbix, etc.)

### Analista Saliente
- [ ] Registrar checklist cierre
- [ ] Documentar incidentes no resueltos
- [ ] Actualizar notas personales (pendientes)
- [ ] Verificar que no quedan alertas críticas sin documentar
- [ ] Logout

### Admin
- [ ] Revisar reportes diarios
- [ ] Verificar backups automáticos
- [ ] Revisar logs de auditoría (si log forwarding activo)
- [ ] Actualizar notas del administrador si hay cambios
- [ ] Gestionar usuarios (activar/desactivar, renovar guests)

---

## Referencias

- **Despliegue:** [DEPLOY.md](./DEPLOY.md)
- **Instalación:** [SETUP.md](./SETUP.md)
- **API:** [API.md](./API.md)
- **Logging:** [LOGGING.md](./LOGGING.md)
- **Backup:** [BACKUP.md](./BACKUP.md)
- **Seguridad:** [SECURITY.md](./SECURITY.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Backlog y roadmap:** [ISSUES.md](./ISSUES.md)

---

<a name="docs-escalation"></a>

# 📞 Módulo de Escalaciones - Bitácora SOC

Sistema centralizado para gestionar información de escalación: contactos externos por cliente/servicio y turnos internos con rotaciones semanales configurables.

---

## 🎯 Funcionalidades

### Para Analistas (Vista de Consulta)
- **Búsqueda rápida**: Seleccionar Cliente → Servicio
- **Contactos externos**:
  - Correos Para/CC
  - Teléfono de emergencia
- **Turnos internos actuales**:
  - N2 (Nivel 2)
  - TI (Soporte TI)
  - N1 No Hábil
  - Muestra quién está de turno AHORA
  - Incluye overrides temporales (vacaciones, licencias, etc.)

### Para Administradores (Gestión Completa)
- **CRUD de Clientes**: Organizaciones ([SENSITIVE_DATA_REDACTED], etc.)
- **CRUD de Servicios**: Servicios por cliente ([SENSITIVE_DATA_REDACTED] - Service A, etc.)
- **CRUD de Contactos**: Base de datos de personas con email/teléfono
- **Reglas de Escalación**: Configurar Para/CC/Emergencia por servicio
- **Asignaciones de Turno**: Planificar turnos semanales por rol
- **Overrides Manuales**: Reemplazos temporales con vigencia y motivo
- **Ciclos de Rotación**: Definir hora/día de inicio de semanas (NO fijos a 00:00)

---

## 🚀 Instalación y Configuración

### 1. Inicializar Roles de Turno

```powershell
cd backend
node src/scripts/seed-shift-roles.js
```

Esto crea los 3 roles predefinidos: N2, TI, N1_NO_HABIL.

### 2. Acceder al Módulo

**Frontend:**
- Vista Analista: `http://localhost:4200/main/escalation/view`
- Vista Admin: `http://localhost:4200/main/escalation/admin`

**Backend API:**
- Base: `/api/escalation`
- Swagger: `http://localhost:3000/api-docs` (buscar "escalation")

---

## 📚 Guía de Uso

### Flujo Inicial (Administrador)

1. **Crear Clientes** (Tab "Clientes")
   ```json
   POST /api/escalation/admin/clients
   {
     "name": "[SENSITIVE_DATA_REDACTED]",
     "code": "[SENSITIVE_DATA_REDACTED]",
     "description": "[SENSITIVE_DATA_REDACTED]",
     "active": true
   }
   ```

2. **Crear Servicios** (Tab "Servicios")
   ```json
   POST /api/escalation/admin/services
   {
     "clientId": "64a1b2c3d4e5f6a7b8c9d0e1",
     "name": "[SENSITIVE_DATA_REDACTED] - Service A",
     "code": "[SENSITIVE_DATA_REDACTED]",
     "active": true
   }
   ```

3. **Crear Contactos** (Tab "Contactos")
   ```json
   POST /api/escalation/admin/contacts
   {
     "name": "[SENSITIVE_DATA_REDACTED]",
     "email": "[SENSITIVE_DATA_REDACTED]",
     "organization": "[SENSITIVE_DATA_REDACTED]",
     "role": "[SENSITIVE_DATA_REDACTED]",
     "active": true
   }
   ```

4. **Configurar Regla de Escalación** (Tab "Reglas de Escalación")
   ```json
   POST /api/escalation/admin/rules
   {
     "serviceId": "64a1b2c3d4e5f6a7b8c9d0e2",
     "recipientsTo": ["64a1b2c3d4e5f6a7b8c9d0e3"],
     "recipientsCC": ["64a1b2c3d4e5f6a7b8c9d0e4"],
     "emergencyPhone": "[SENSITIVE_DATA_REDACTED]",
     "active": true
   }
   ```

5. **Configurar Ciclo de Rotación** (Tab "Ciclos de Rotación")
   ```json
   POST /api/escalation/admin/cycles
   {
     "roleCode": "N2",
     "startDayOfWeek": 5,
     "startTimeUTC": "11:00",
     "durationDays": 7,
     "timezone": "America/Santiago",
     "active": true
   }
   ```
   Esto significa: Turnos N2 comienzan Viernes a las 08:00 Chile (11:00 UTC).

6. **Asignar Persona a Turno** (Tab "Turnos")
   ```json
   POST /api/escalation/admin/assignments
   {
     "roleCode": "N2",
     "userId": "64a1b2c3d4e5f6a7b8c9d0e5",
     "weekStartDate": "2026-01-03T11:00:00Z",
     "weekEndDate": "2026-01-10T11:00:00Z",
     "notes": "[SENSITIVE_DATA_REDACTED]"
   }
   ```

7. **Crear Override Temporal** (Tab "Turnos" → Overrides)
   ```json
   POST /api/escalation/admin/overrides
   {
     "roleCode": "N2",
     "replacementUserId": "64a1b2c3d4e5f6a7b8c9d0e6",
     "startDate": "2026-01-05T00:00:00Z",
     "endDate": "2026-01-12T23:59:59Z",
     "reason": "[SENSITIVE_DATA_REDACTED]",
     "active": true
   }
   ```

### Consulta (Analista)

1. Abrir `http://localhost:4200/main/escalation/view`
2. Seleccionar Cliente (ej: "[SENSITIVE_DATA_REDACTED]")
3. Seleccionar Servicio (ej: "[SENSITIVE_DATA_REDACTED] - Service A")
4. Ver información:
   - **Contactos Externos**: Para/CC/Emergencia
   - **Turnos Internos**: Quién está de turno AHORA con badges de override

---

## 🔒 Seguridad

- **Vista de consulta**: Requiere autenticación (cualquier usuario)
- **Vista admin**: Requiere rol `admin`
- **Backend**: Middleware `requireAdmin` valida permisos en todas las rutas `/admin/*`

---

## 🕐 Manejo de Fechas

- **Backend**: Guarda todas las fechas en ISO 8601 UTC
- **Frontend**: Convierte y muestra en zona horaria `America/Santiago` (-03:00)
- **Resolución de turnos**: El backend calcula "quién está de turno" usando:
  1. Overrides activos (prioridad máxima)
  2. Asignaciones regulares
  3. Si no hay nadie, devuelve `null`

---

## 📊 Ejemplos de Payloads

### GET Escalation View (Principal)

**Request:**
```
GET /api/escalation/view/64a1b2c3d4e5f6a7b8c9d0e2
```

**Response:**
```json
{
  "service": {
    "id": "64a1b2c3d4e5f6a7b8c9d0e2",
    "name": "[SENSITIVE_DATA_REDACTED] - Service A",
    "code": "[SENSITIVE_DATA_REDACTED]",
    "clientName": "[SENSITIVE_DATA_REDACTED]"
  },
  "externalContacts": {
    "to": [
      { "id": "...", "name": "[SENSITIVE_DATA_REDACTED]", "email": "[SENSITIVE_DATA_REDACTED]" }
    ],
    "cc": [
      { "id": "...", "name": "[SENSITIVE_DATA_REDACTED]", "email": "[SENSITIVE_DATA_REDACTED]" }
    ],
    "emergency": {
      "phone": "[SENSITIVE_DATA_REDACTED]",
      "contactName": null
    }
  },
  "internalShifts": [
    {
      "role": "N2",
      "roleName": "Nivel 2",
      "currentUser": {
        "id": "...",
        "name": "[SENSITIVE_DATA_REDACTED]",
        "email": "[SENSITIVE_DATA_REDACTED]"
      },
      "shiftPeriod": {
        "start": "2026-01-03T11:00:00Z",
        "end": "2026-01-10T11:00:00Z"
      },
      "isOverride": false
    },
    {
      "role": "TI",
      "roleName": "Soporte TI",
      "currentUser": {
        "id": "...",
        "name": "[SENSITIVE_DATA_REDACTED]",
        "email": "[SENSITIVE_DATA_REDACTED]"
      },
      "shiftPeriod": {
        "start": "2026-01-05T00:00:00Z",
        "end": "2026-01-12T23:59:59Z"
      },
      "isOverride": true,
      "overrideReason": "[SENSITIVE_DATA_REDACTED]"
    }
  ],
  "timestamp": "2026-01-03T18:30:00Z"
}
```

---

## 🛠️ Troubleshooting

### No aparece información de turnos

1. Verificar que existan asignaciones:
   ```
   GET /api/escalation/admin/assignments?roleCode=N2
   ```

2. Verificar fechas:
   - Las fechas deben estar en UTC
   - `weekStartDate <= now <= weekEndDate`

### Override no se aplica

1. Verificar que `active: true`
2. Verificar fechas: `startDate <= now <= endDate`
3. Los overrides tienen prioridad sobre asignaciones regulares

### Error al crear cliente/servicio con código duplicado
- Los campos `code` son únicos
- Usar códigos diferentes o modificar el existente

---

## 📝 TODO (Mejoras Futuras)

- [ ] Dialogs CRUD en admin (actualmente solo delete funciona)
- [ ] Filtros avanzados en tablas (búsqueda, paginación)
- [ ] Exportar configuración a Excel/CSV
- [ ] Notificaciones cuando cambia el turno
- [ ] Integración con calendario (Google Calendar, Outlook)
- [ ] Historial de cambios (auditoría de overrides)

---

<a name="docs-work-shifts"></a>

# 🕐 Módulo de Turnos de Trabajo - BitacoraSOC

## 📋 Descripción

Sistema de gestión de **turnos de trabajo** con horarios personalizados, diferenciando entre:
- **Turnos regulares**: Horarios normales de oficina (ej: mañana, tarde, noche)
- **Turnos de emergencia**: Para atención fuera de horario hábil (no confundir con N1_NO_HABIL de escalación)

## ✨ Características

✅ **Configuración flexible de horarios** (ej: 9-18, 18-2, 2-9)
✅ **Asignación opcional de usuarios** a turnos específicos
✅ **Asociación con checklists** diferentes por turno
✅ **Detección automática** del turno actual según hora
✅ **Soporte para cruces de medianoche** (ej: 22:00 - 06:00)
✅ **Gestión completa** (crear, editar, eliminar, reordenar)
✅ **Reportes por correo** configurables por turno

---

## 🏗️ Arquitectura

### Backend

**Modelo:** `backend/src/models/WorkShift.js`
```javascript
{
  name: String,              // "Turno Mañana"
  code: String,              // "MORNING" (único)
  type: 'regular' | 'emergency',
  startTime: String,         // "09:00" (HH:MM)
  endTime: String,           // "18:00" (HH:MM)
  timezone: String,          // "America/Santiago"
  assignedUserId: ObjectId,      // Usuario asignado (opcional)
  checklistTemplateId: ObjectId, // Checklist asociado (opcional)
  emailReportConfig: {
    enabled: Boolean,
    includeChecklist: Boolean,
    includeEntries: Boolean,
    recipients: [String],
    subjectTemplate: String
  },
  order: Number,
  active: Boolean,
  color: String                  // Color hex para UI
}
```

**Rutas:** `backend/src/routes/work-shifts.js`
```
GET    /api/work-shifts              - Listar turnos
GET    /api/work-shifts/current      - Obtener turno actual
GET    /api/work-shifts/:id          - Obtener turno específico
POST   /api/work-shifts              - Crear turno (admin)
PUT    /api/work-shifts/:id          - Actualizar turno (admin)
DELETE /api/work-shifts/:id          - Eliminar turno (admin)
PUT    /api/work-shifts/reorder      - Reordenar turnos (admin)
POST   /api/work-shifts/:id/send-report - Enviar reporte manual (admin)
```

### Frontend

**Modelos:** `frontend/src/app/models/work-shift.model.ts`
**Servicio:** `frontend/src/app/services/work-shift.service.ts`
**Componente Admin:** `frontend/src/app/pages/work-shifts/work-shifts-admin/`

**Ruta:** `/main/work-shifts` (solo admin)
**Menú:** Configuración (Admin) → Turnos de Trabajo

---

## 🚀 Configuración Inicial

### 1. Crear turnos de ejemplo
```bash
# Desde backend/
node src/scripts/seed-work-shifts.js
```

El script incluye dos configuraciones:

**Opción 1: Turno único (actual - 9 a 18)**
- Turno Diurno (9:00 - 18:00)
- Emergencia No Hábil (18:00 - 09:00)

**Opción 2: Tres turnos (24h dividido en 3)**
- Turno Mañana (09:00 - 17:00)
- Turno Tarde (17:00 - 01:00)
- Turno Noche (01:00 - 09:00)
- Emergencia (backup, inactivo)

Editar `seed-work-shifts.js` línea 108 para cambiar entre opciones.

### 2. Acceder desde frontend
1. Login como **admin**
2. Menú lateral → **Configuración (Admin)** → **Turnos de Trabajo**
3. Crear/editar/eliminar turnos según necesidad

---

## 📖 Casos de Uso

### Caso 1: Turno único (configuración actual)
```json
POST /api/work-shifts
{
  "name": "Turno Diurno",
  "code": "DAY",
  "type": "regular",
  "startTime": "09:00",
  "endTime": "18:00",
  "timezone": "America/Santiago",
  "active": true
}
```

### Caso 2: Asignar usuario a turno
```json
PUT /api/work-shifts/{id}
{
  "assignedUserId": "507f1f77bcf86cd799439011"
}
```

### Caso 3: Asociar checklist específico
```json
PUT /api/work-shifts/{id}
{
  "checklistTemplateId": "507f1f77bcf86cd799439012"
}
```

### Caso 4: Obtener turno actual
```bash
GET /api/work-shifts/current
```

Respuesta:
```json
{
  "shift": {
    "_id": "...",
    "name": "Turno Diurno",
    "code": "DAY",
    "startTime": "09:00",
    "endTime": "18:00",
    "assignedUserName": "[SENSITIVE_DATA_REDACTED]",
    "assignedUserEmail": "[SENSITIVE_DATA_REDACTED]"
  },
  "currentTime": "14:30",
  "timezone": "America/Santiago"
}
```

---

## 📧 Reporte de Turno por Correo (Email Reports)

### Descripción

Envía un reporte HTML al finalizar el turno con checklist de inicio/cierre y entradas del periodo.

### Configuración (por turno)
```typescript
emailReportConfig: {
  enabled: boolean,
  includeChecklist: boolean,
  includeEntries: boolean,
  recipients: string[],
  subjectTemplate: string // Variables: [fecha], [turno], [hora]
}
```

### Variables del asunto
| Variable   | Descripción | Ejemplo |
|------------|-------------|---------|
| `[fecha]`  | Fecha del turno | 03/02/2026 |
| `[turno]`  | Nombre del turno | Turno Mañana |
| `[hora]`   | Hora fin del turno | 18:00 |

### Envío automático (scheduler)
- Se ejecuta **cada minuto**.
- Condiciones:
  - `type: regular`
  - `active: true`
  - `emailReportConfig.enabled: true`
  - `hora actual == endTime` del turno

### Envío manual (admin)
```http
POST /api/work-shifts/:id/send-report
Authorization: Bearer {admin-token}
Content-Type: application/json

{ "date": "2026-02-03T12:00:00Z" }
```

### Criterio de datos incluidos
- Checklist de entrada/salida: último `inicio` y `cierre` dentro del rango del turno.
- Entradas: entre el `inicio` y el `cierre` (si no existen, usa el rango horario del turno).

---

## 🔄 Diferencias con Sistema de Escalación
| Concepto | Turnos de Trabajo | Escalación (N2/TI/N1_NO_HABIL) |
|----------|-------------------|--------------------------------|
| **Propósito** | Organizar trabajo diario | Contactos de escalación |
| **Horarios** | Flexibles por turno | Semanas completas |
| **Asignación** | Opcional | Obligatoria por semana |
| **Checklists** | Diferentes por turno | Independiente |
| **Tipo** | Regular/Emergencia | Roles fijos |

**Ejemplo:**
- **Turno de Trabajo**: [SENSITIVE_DATA_REDACTED] trabaja turno mañana (9-17), [SENSITIVE_DATA_REDACTED] trabaja turno tarde (17-01)
- **Escalación N2**: [SENSITIVE_DATA_REDACTED] está de guardia N2 toda la semana (24/7)

---

## 🛠️ Funcionalidades Futuras
- [ ] Integración con checklist (seleccionar checklist según turno actual)
- [ ] Integración con envío de correos (usar turno actual para filtrar destinatarios)
- [ ] Dashboard de turnos (visualización calendario)
- [ ] Estadísticas por turno
- [ ] Intercambio de turnos entre usuarios
- [ ] Notificaciones automáticas de cambio de turno

---

## 🔧 Mantenimiento
### Agregar nuevo tipo de turno
1. Editar `backend/src/models/WorkShift.js` → `type` enum
2. Editar `frontend/src/app/models/work-shift.model.ts` → `ShiftType`
3. Actualizar `SHIFT_TYPE_OPTIONS` en frontend

### Cambiar validaciones de horario
Editar función `isTimeInRange()` en `backend/src/routes/work-shifts.js`

---

## 📝 Notas Técnicas
- **Cruces de medianoche**: El sistema detecta si `startTime > endTime` y ajusta lógica
- **Zona horaria**: Configurable por turno (por defecto: `America/Santiago`)
- **Orden**: Campo `order` para ordenar visualización (drag & drop en UI)
- **Color**: Hex color para identificar turnos en UI (`#1976d2`, `#f44336`, etc.)
- **Código único**: El campo `code` debe ser único (validación en backend)

---

## ✅ Testing
### Probar API
```bash
# Listar turnos
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/work-shifts

# Turno actual
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/work-shifts/current

# Crear turno
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Turno Noche","code":"NIGHT","type":"regular","startTime":"22:00","endTime":"06:00","timezone":"America/Santiago"}' \
  http://localhost:3000/api/work-shifts
```

---

## 📚 Referencias
- [Modelo WorkShift](../backend/src/models/WorkShift.js)
- [Rutas API](../backend/src/routes/work-shifts.js)
- [Servicio Frontend](../frontend/src/app/services/work-shift.service.ts)
- [Componente Admin](../frontend/src/app/pages/work-shifts/work-shifts-admin/)
- [Script Seed](../backend/src/scripts/seed-work-shifts.js)

---
<a name="docs-catalogs"></a>

# 📚 Sistema de Catálogos con Autocomplete

Sistema de autocomplete reutilizable con Angular Material para datasets grandes (1900+ items).

## 🎯 Componentes Implementados

### Backend (Express + MongoDB)

#### Modelos:
- **CatalogEvent** - Eventos SOC (phishing, malware, vulnerabilidades, etc)
- **CatalogLogSource** - Fuentes de logs / Clientes
- **CatalogOperationType** - Tipos de operación SOC

#### Endpoints:
```
GET /api/catalog/events?search={q}&enabled=true&limit=20
GET /api/catalog/log-sources?search={q}&enabled=true&limit=20
GET /api/catalog/operation-types?search={q}&enabled=true&limit=20
```

**Características**:
- ✅ Búsqueda server-side con índice de texto MongoDB
- ✅ Máximo 20 resultados por request (performance)
- ✅ Cursor-based pagination (opcional)
- ✅ Solo registros `enabled=true`
- ✅ Ordenamiento por relevancia (textScore)

### Frontend (Angular 20 + Material)

#### Componente Reutilizable:
**EntityAutocompleteComponent** - `<app-entity-autocomplete>`

**Features UX**:
- ✅ Typeahead con debounce 250ms
- ✅ Spinner "Buscando..."
- ✅ Mensaje "Sin resultados"
- ✅ Keyboard friendly (↑↓, Enter, Esc)
- ✅ Mouse friendly (click)
- ✅ Botón "X" para limpiar
- ✅ Paste support (Ctrl+V)
- ✅ Muestra name, parent, description truncada

**Performance**:
- ✅ ChangeDetectionStrategy.OnPush
- ✅ trackBy en *ngFor
- ✅ RxJS switchMap (cancela requests anteriores)
- ✅ Sin filtrado en frontend

## 🚀 Instalación

### 1. Seed de Datos

Poblar catálogos con datos de ejemplo:

```bash
cd backend
node src/scripts/seed-catalogs.js
```

Esto insertará:
- 8 eventos SOC de ejemplo
- 8 log sources / clientes
- 6 tipos de operación

### 2. Verificar Índices MongoDB

Los índices de texto se crean automáticamente al insertar el primer documento. Verificar:

```javascript
db.catalog_events.getIndexes()
db.catalog_log_sources.getIndexes()
db.catalog_operation_types.getIndexes()
```

Deberías ver índices:
- `catalog_event_search_index` (text search)
- `enabled_1_name_1` (queries rápidas)

## 📖 Uso

### Ejemplo Básico

```typescript
// Component
import { CatalogService } from '@app/services/catalog.service';
import { CatalogEvent } from '@app/models/catalog.model';

export class MyComponent {
  searchEventsFn = (query: string) => this.catalogService.searchEvents(query);
  
  displayEventFn = (item: CatalogEvent): string => {
    return item.parent ? `${item.name} (${item.parent})` : item.name;
  };

  onEventSelected(event: CatalogEvent): void {
    console.log('Evento seleccionado:', event);
    // Autocompletar otros campos
    this.form.patchValue({
      eventId: event._id,
      motivo: event.motivoDefault
    });
  }
}
```

```html
<!-- Template -->
<app-entity-autocomplete
  label="Evento"
  placeholder="Buscar evento..."
  [apiFn]="searchEventsFn"
  [displayFn]="displayEventFn"
  [minChars]="2"
  (selected)="onEventSelected($event)"
  (cleared)="onEventCleared()"
></app-entity-autocomplete>
```

### Ejemplo Completo

Ver: `frontend/src/app/pages/main/report-generator/`

Componente demo con 3 autocompletes integrados:
- Evento → autocompleta "Motivo"
- Log Source → selección simple
- Operation Type → autocompleta "Info Adicional"

**Ruta**: `/main/report-generator`

## 🔧 API Reference

### EntityAutocompleteComponent

**Inputs**:
- `label: string` - Label del campo
- `placeholder: string` - Placeholder del input
- `apiFn: (query: string) => Observable<{items, nextCursor}>` - Función de búsqueda
- `displayFn: (item) => string` - Función para mostrar texto en input
- `minChars: number = 2` - Mínimo caracteres para buscar
- `disabled: boolean = false` - Deshabilitar input

**Outputs**:
- `selected: EventEmitter<AutocompleteItem>` - Emite cuando se selecciona un item
- `cleared: EventEmitter<void>` - Emite cuando se limpia la selección

**Interfaces**:
```typescript
interface AutocompleteItem {
  _id: string;
  name: string;
  parent?: string | null;
  description?: string;
  [key: string]: any; // Campos adicionales
}

interface AutocompleteResponse {
  items: AutocompleteItem[];
  nextCursor?: string | null;
}
```

### CatalogService

```typescript
// Buscar eventos
searchEvents(query: string, cursor?: string, limit = 20): Observable<CatalogSearchResponse<CatalogEvent>>

// Buscar log sources
searchLogSources(query: string, cursor?: string, limit = 20): Observable<CatalogSearchResponse<CatalogLogSource>>

// Buscar tipos de operación
searchOperationTypes(query: string, cursor?: string, limit = 20): Observable<CatalogSearchResponse<CatalogOperationType>>
```

## 🎨 Customización

### Cambiar Estilos

Editar: `frontend/src/app/components/entity-autocomplete/entity-autocomplete.component.scss`

Variables CSS disponibles:
- `--mat-primary-color` - Color principal del tema

### Cambiar Límite de Resultados

En el componente:
```typescript
searchEventsFn = (query: string) => this.catalogService.searchEvents(query, undefined, 30); // 30 items
```

En backend: editar límite máximo en `routes/catalog.js`:
```javascript
const limitNum = Math.min(parseInt(limit) || 20, 50); // Max 50
```

## 📊 Performance

### Métricas Esperadas:
- Query MongoDB con text search: **< 50ms**
- Request completa: **< 200ms**
- Renderizado de 20 items: **< 100ms**

### Optimizaciones Implementadas:
1. **Índices MongoDB**: text search + compuesto (enabled + name)
2. **Debounce 250ms**: reduce requests innecesarias
3. **switchMap**: cancela requests anteriores
4. **Cursor pagination**: carga incremental (si se necesita)
5. **OnPush**: reduce ciclos de detección de cambios
6. **trackBy**: evita re-render de items ya renderizados

## 🔒 RBAC / Permisos

### Lectura (GET):
✅ Todos los usuarios autenticados pueden buscar catálogos

### Escritura (POST/PUT/DELETE):
❌ Solo rol `admin` (endpoints en `/api/admin/catalog/*` - no implementados en esta versión)

### Regla:
No se borran registros, solo se marcan como `enabled: false`

## 🧪 Testing

### Test Manual:
1. Iniciar backend: `cd backend && npm start`
2. Iniciar frontend: `cd frontend && npm start`
3. Login en `/login`
4. Navegar a `/main/report-generator`
5. Probar los 3 autocompletes

### Test de Performance:
```bash
# Insertar 2000 eventos para probar performance
node backend/src/scripts/seed-large-catalog.js
```

## 📝 Notas de Implementación

### MongoDB Text Search:
- Busca en: `name` (peso 10), `parent` (peso 5), `description` (peso 1)
- Case-insensitive
- Acepta múltiples palabras
- Ordenamiento automático por relevancia

### RxJS Pipeline:
```typescript
valueChanges.pipe(
  map(v => typeof v === 'string' ? v.trim() : ''),
  distinctUntilChanged(),
  filter(q => q.length >= minChars),
  debounceTime(250),
  switchMap(q => apiFn(q).pipe(
    catchError(() => of({ items: [], nextCursor: null }))
  ))
)
```

### Angular Material:
- `mat-autocomplete` con `displayWith`
- `mat-form-field` con appearance="outline"
- `mat-progress-spinner` para loading
- `mat-icon` para botón de limpiar

## 🐛 Troubleshooting

### "Sin resultados" siempre:
- Verificar que existen registros con `enabled: true`
- Verificar índice de texto en MongoDB
- Verificar que el backend está corriendo
- Verificar CORS en backend

### Performance lenta:
- Verificar índices: `db.catalog_events.getIndexes()`
- Reducir límite de resultados
- Verificar red/latencia

### Errores en consola:
- Verificar que `SharedComponentsModule` está importado
- Verificar que `CatalogService` está en `providedIn: 'root'`
- Verificar ruta de API en `environment.ts`

## 📦 Archivos Creados

### Backend:
```
backend/src/models/
  ├── CatalogEvent.js
  ├── CatalogLogSource.js
  └── CatalogOperationType.js

backend/src/routes/
  └── catalog.js

backend/src/scripts/
  └── seed-catalogs.js

backend/src/server.js (modificado)
```

### Frontend:
```
frontend/src/app/models/
  └── catalog.model.ts

frontend/src/app/services/
  └── catalog.service.ts

frontend/src/app/components/
  ├── entity-autocomplete/
  │   ├── entity-autocomplete.component.ts
  │   ├── entity-autocomplete.component.html
  │   └── entity-autocomplete.component.scss
  └── shared-components.module.ts

frontend/src/app/pages/main/
  ├── report-generator/ (ejemplo completo)
  │   ├── report-generator.component.ts
  │   ├── report-generator.component.html
  │   └── report-generator.component.scss
  └── main.module.ts (modificado)
```

## 🚀 Próximos Pasos
1. **Admin Panel**: Implementar CRUD de catálogos para rol admin
2. **Import CSV**: Importación masiva de eventos desde CSV/Excel
3. **Analytics**: Dashboard de eventos más usados
4. **Cache**: Implementar cache en Redis para queries frecuentes
5. **Infinite Scroll**: Usar `nextCursor` para load-more
6. **Multi-Select**: Variante para selección múltiple

## 📞 Soporte

Para issues o dudas:
1. Revisar esta documentación
2. Verificar logs de backend (consola)
3. Verificar logs de frontend (DevTools)
4. Revisar código de ejemplo en `report-generator.component.ts`

---
<a name="docs-changelog"></a>

# Changelog

Registro de cambios relevantes del proyecto.

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

---
<a name="docs-screenshots"></a>

# 📸 Capturas de Pantalla - BitacoraSOC

Documentación visual de las principales funcionalidades del sistema.

> Nota: Las capturas son referenciales y pueden variar respecto a la versión actual.

## 📑 Índice de Capturas

1. [Pantalla Principal - Nueva Entrada](#-pantalla-principal---nueva-entrada)
2. [Temas Visuales](#-temas-visuales)
3. [Escalación y Turnos](#-escalación-y-turnos)
4. [Buscar Entradas](#-buscar-entradas)
5. [Generador de Reportes SOC](#-generador-de-reportes-soc)
6. [Configuración de Administrador](#-configuración-de-administrador)
7. [Menú Admin - Backup](#-menú-admin---backup)
8. [Sidebar - Menú de Navegación](#-sidebar---menú-de-navegación)

---

## 🏠 Pantalla Principal - Nueva Entrada

![Pantalla Principal](images/screenshots/01-main-nueva-entrada.png)
![Pantalla Principal](images/screenshots/01.1-main-nueva-entrada.png)

**Funcionalidades visibles:**
- **Menú Lateral Izquierdo:**
  - ✍️ Escribir (página actual)
  - 📋 Historial Checklists
  - 📞 Escalaciones
  - 📊 Generar Reporte
  - ⏰ Mis Entradas
  - 🌐 Ver todas
  - 👤 Mi Perfil
  - ✅ Administracion Checklist
  - 📈 Reportes
  - ⚙️ Configuración (Admin)

- **Panel Central - Nueva Entrada:**
  - Fecha del Evento (dd-mm-aaaa)
  - Hora del Evento (HH:mm)
  - Clasificación:
    - 📋 **Operativa**: Eventos rutinarios
    - 🚨 **Incidente**: Eventos que requieren respuesta
  - Campo de texto para descripción con soporte de hashtags (#Trellix #hunting)
  - Autosave activado

- **Panel Derecho - Notas:**
  - 💡 Nota del Administrador (compartida)
  - 🗒️ Mi Nota Personal (privada)

- **Checklist de Turno:**
  - Estado del último check
  - Mensaje si no hay checklist activo asignado

---

## ✅ Temas Visuales

![Temas Visuales](images/screenshots/08-style-menu.png)

| Icono | Opción |
|-------|--------|
| 👥 | **Ligth** |
| 📚 | **Dark** |
| 📞 | **Sepia** |
| 🏷️ | **Pastel** |
| ☁️ | **Cyberpunk** |

![Ligth](images/screenshots/01.1-main-nueva-entrada.png)
![Dark](images/screenshots/08.2-style-menu.png)
![Sepia](images/screenshots/08.3-style-menu.png)
![Pastel](images/screenshots/08.4-style-menu.png)
![Cyberpunk](images/screenshots/08.5-style-menu.png)

---

## 📞 Escalación y Turnos

![Escalación y Turnos](images/screenshots/02-escalacion-turnos.png)

**Vista Semanal de Turnos (12/1 al 18-01-2026):**

- **Roles visibles:**
  - 👥 **N2 - Soporte Técnico** (púrpura) - No asignado
  - 💻 **TI - Infraestructura** (rosa) - No asignado
  - ⏰ **N1 - No Hábil** (cyan) - No asignado

- **Navegación:**
  - Flechas para cambiar semana
  - Fecha actual destacada

- **Contactos de Escalación:**
  - Lista de contactos por servicio
  - ⚠️ Mensaje: "No hay datos de escalación disponibles"
  - Requiere configuración por admin

**Funcionalidad:** Permite visualizar quién está de turno en cada rol durante la semana actual, facilitando la coordinación del equipo SOC.

---

## 🔍 Buscar Entradas

![Buscar Entradas](images/screenshots/03-buscar-entradas.png)

**Filtros de Búsqueda:**
- 🔍 **Buscar texto**: Búsqueda en el contenido
- 📑 **Tipo**: Dropdown (Todos/Operativa/Incidente)
- 📅 **Fecha desde**: dd-mm-aaaa
- 📅 **Fecha hasta**: dd-mm-aaaa
- 🏷️ **Tags**: Filtro por etiquetas
- 🔵 **Botón Buscar**
- ❌ **Limpiar**: Resetear filtros

**Tabla de Resultados (78 entradas):**

| Columna | Descripción |
|---------|-------------|
| **Fecha** | dd/mm/aaaa |
| **Hora** | HH:mm |
| **Tipo** | 🟢 operativa / 🔴 incidente |
| **Contenido** | Texto truncado de la entrada |
| **Tags** | Hashtags en chips (qradar, dpp, 0002296, 2214, etc.) |
| **Autor** | Usuario que creó la entrada |

**Ejemplo visible:**
- 14/01/2026 18:28 - Operativa - "#Qradar #dpp [[QRADAR] #0002296] Nuevo incidente D..."
- Tags: qradar, dpp, 0002296, 2214
- Autor: mfuentes

**Funcionalidad:** Permite buscar y filtrar entradas históricas con múltiples criterios para análisis y auditoría.

---

## 📊 Generador de Reportes SOC

![Generador de Reportes](images/screenshots/04-generador-reportes.png)

**Formulario para Reportes HTML:**

**Campos del formulario:**
1. **Tipo de operación** *
   - Dropdown con autocomplete
   - Validación: "Escribe al menos 0 caracteres para buscar"

2. **Ofensa/Código interno**
   - Campo de texto libre
   - Ejemplo: Número de offense o ticket

3. **Nombre de Ofensa/Evento** *
   - Dropdown con autocomplete
   - Validación: "Escribe al menos 0 caracteres para buscar"

4. **Motivo de la Ofensa/Evento** **
   - Textarea multilínea
   - Descripción detallada del evento

**Funcionalidad:** 
- Genera reportes en formato HTML estructurados
- Utiliza catálogos predefinidos (Tipos de operación, Eventos)
- Facilita la documentación estandarizada de incidentes
- Exportable para compartir con otras áreas o clientes

---

## ⚙️ Configuración de Administrador

![Configuración Admin](images/screenshots/05-menu-configuracion.png)

**Menú de Configuración (Admin):**

Sección expandida con opciones administrativas:

| Icono | Opción | Descripción |
|-------|--------|-------------|
| 👥 | **Admin Usuarios** | Gestión de usuarios, roles y permisos |
| 📚 | **Admin Catálogos** | Configuración de catálogos de eventos, fuentes de logs, tipos de operación |
| 📞 | **Admin Escalaci...** | Configuración de reglas de escalación y contactos |
| 🏷️ | **Tags** | Gestión de etiquetas del sistema |
| 🖼️ | **Logo** | Personalización del logo de la aplicación |
| ☁️ | **Backup** | Creación y restauración de backups (seleccionado) |
| 📧 | **SMTP / Config** | Configuración de servidor SMTP para notificaciones por email |

**Acceso:** Solo usuarios con rol `admin` pueden ver y acceder a esta sección.

**Seguridad:** 
- Requiere autenticación previa
- Operaciones sensibles registradas en audit logs
- Backups protegidos con control de acceso

---

## 💾 Menú Admin - Backup

![Menú Admin Backup](images/screenshots/06-menu-admin-backup.png)

**Detalle del menú administrativo:**

Opciones visibles en la sección de configuración:
- **Admin Usuarios** - Gestión completa de cuentas
- **Admin Catálogos** - Taxonomías y diccionarios
- **Admin Escalaci...** - Matriz de contactos
- **Tags** - Sistema de etiquetado
- **Logo** - Branding corporativo
- **Backup** ← **(seleccionado)** - Sistema de respaldo
- **SMTP / Config** - Notificaciones email

**Funcionalidad de Backup:**
- Crear backup completo de todas las colecciones (23 colecciones)
- Descargar backups en formato JSON
- Restaurar desde backup existente
- Modo incremental o completo (clearBeforeRestore)
- Historial de backups con timestamps
- Validación de integridad de datos

Ver documentación completa en [backend/scripts/README.md](../backend/scripts/README.md#5-restaurar-un-backup)

---

## 📂 Sidebar - Menú de Navegación

![Sidebar Menu](images/screenshots/07-sidebar-menu.png)

**Menú lateral izquierdo completo:**

| Icono | Opción | Rol | Descripción |
|-------|--------|-----|-------------|
| ✏️ | **Escribir** | Todos | Crear nueva entrada (operativa/incidente) |
| 📋 | **Historial Checklists** | Todos | Ver todos los checklists completados del equipo |
| 📞 | **Escalaciones** | Todos | Vista de turnos y contactos de escalación |
| 📊 | **Generar Reporte** | Admin/User | Crear reportes HTML estructurados |
| ⏰ | **Mis Entradas** | Admin/User | Entradas propias del usuario |
| 🌐 | **Ver todas** | Todos | Búsqueda y filtrado de todas las entradas |
| 📈 | **Reportes** | Admin/User | Dashboard y estadísticas |
| 👤 | **Mi Perfil** | Todos | Editar información personal |

**Configuración (Admin) ▼**

| Icono | Opción | Descripción |
|-------|--------|-------------|
|👥|**Consola admin**| Toda la configuraciond e un admin|
| 📞 | **Log auditoria** | informacion de uso de  log en la Herramienta |
| 🏷️ | **Tags** | Etiquetas globales |
| 🖼️ | **Branding** | Personalización |
| ☁️ | **Backup** | Respaldos |

**Interacción:**
- Sección colapsable con indicador de expansión (▼/►)
- Items activos resaltados
- Íconos intuitivos con Material Icons
- Responsive: Se convierte en drawer en móvil

---

## 📋 Resumen de Funcionalidades

### Usuario Operador
- ✅ Crear entradas operativas e incidentes  
- ✅ Usar hashtags para categorización  
- ✅ Ver todas las entradas del equipo  
- ✅ Buscar y filtrar entradas históricas  
- ✅ Ver turnos y escalaciones  
- ✅ Completar checklists de turno  
- ✅ Generar reportes HTML  
- ✅ Notas personales privadas  

### Usuario Administrador
- ✅ Todas las funciones de operador  
- ✅ Gestionar usuarios y permisos  
- ✅ Configurar catálogos y taxonomías  
- ✅ Definir reglas de escalación  
- ✅ Configurar turnos y roles  
- ✅ Crear y restaurar backups  
- ✅ Configurar SMTP y notificaciones  
- ✅ Ver auditorías del sistema  
- ✅ Personalizar logo corporativo  

---

## 🎨 Diseño y UX

**Características del diseño:**
- 🎨 Material Design con Angular Material
- 🌈 Esquema de colores: Azul primario, Rosa/Fucsia secundario
- 📱 Diseño responsive (desktop, tablet, mobile)
- 🌙 Modo oscuro disponible
- ♿ Accesibilidad: ARIA labels, navegación por teclado
- ⚡ Autosave para prevenir pérdida de datos
- 🔔 Notificaciones en tiempo real
- 📊 Visualización clara de tipos (operativa = verde, incidente = rojo)
- 🏷️ Tags visuales como chips de colores

---

## 📊 Estadísticas del Sistema

**Capturas documentadas:** 7  
**Última actualización:** 16 de enero de 2026  
**Funcionalidades cubiertas:** ~85%  

**Áreas documentadas:**
- ✅ Navegación y menús
- ✅ Formulario de entradas
- ✅ Sistema de búsqueda
- ✅ Escalación y turnos
- ✅ Generación de reportes
- ✅ Configuración administrativa
- ✅ Sistema de backup

---

## 📝 Notas Técnicas

**Stack tecnológico visible:**
- Frontend: Angular 17+ con Material Design
- Componentes standalone
- Diseño modular y escalable
- Sistema de rutas protegidas por roles
- Formularios reactivos con validación

**Patrones de diseño:**
- Sidebar navigation con secciones colapsables
- Floating action buttons para acciones principales
- Cards para agrupación de contenido
- Chips para tags y categorías
- Dropdowns con autocomplete para catálogos extensos
- Notificaciones inline (⚠️ advertencias, ℹ️ información)

---

*Última actualización: 30 de febrero de 2123  XD*

---
<a name="docs-issues"></a>

# 📌 Issues (Backlog y Roadmap)

El contenido completo y actualizado se mantiene en `docs/ISSUES.md`.

Ver: `docs/ISSUES.md`

---

<a name="backend-scripts-readme"></a>

# 📁 Documentación de Scripts (backend/scripts/README.md)

El contenido completo y actualizado se mantiene en `backend/scripts/README.md`.

Ver: `backend/scripts/README.md`

---

## Apéndice: Verificación contra Código

Esta sección describe una verificación práctica para asegurar que la documentación siga alineada con la implementación (rutas, esquemas y nombres de módulos):

1. **API Routes**
   - Revisar el `backend/src/routes/*` contra `docs/API.md`.
   - Confirmar que cada ruta documentada existe y que el `request/response` esperado coincide.

2. **Esquemas de BD (MongoDB / Mongoose)**
   - Comparar colecciones y campos críticos mencionados en la documentación con `backend/src/models/*`.
   - Validar índices relevantes (text search, TTL, unique) contra lo que documenta cada módulo.

3. **Flujos Operativos SOC**
   - Para checklist/turnos/entradas, validar el comportamiento final revisando los componentes y rutas asociados en:
     - `frontend/src/app/pages/main/*`
     - `backend/src/routes/*`

4. **Seguridad y Sanitización**
   - Confirmar que los middlewares citados existen y se aplican donde corresponde:
     - `authMiddleware`
     - sanitización (p. ej. `logSanitizer`, `sanitizeInput`)
     - rate limiters
   - Verificar que los ejemplos de la documentación no incluyan secretos reales.

5. **Integraciones**
   - Confirmar que endpoints y configuración referenciados (GLPI, SIEM forwarding, SMTP) coinciden con lo implementado en:
     - `backend/src/routes/*`
     - `backend/src/utils/*`

---

## Apéndice: Glosario y Reglas de Redacción

### Glosario (términos clave)

- **Entrada (Entry):** Registro operativo o incidente dentro de la bitácora.
- **Checklist:** Conjunto de ítems (inicio/cierre) que un analista completa por turno.
- **Turno (WorkShift / Work Shift):** Periodo de trabajo con reglas de horarios (regular/emergency) y reporte por correo.
- **Escalación:** Módulo para gestionar contactos externos y turnos internos (rotaciones) usados ante alertas.
- **Auditoría (AuditLog):** Evento persistente en MongoDB que permite trazabilidad y análisis forense.
- **Forwarding SIEM:** Envío de eventos auditados a un colector externo (TCP/TLS/UDP/HTTP según configuración).
- **RBAC:** Roles y permisos (admin/user/auditor/guest) controlando acceso a endpoints.
- **Correlation ID (`X-Request-Id`):** Identificador usado para correlacionar logs y auditoría de una request.

### Reglas de redacción (para mantener la documentación segura)

1. **Datos sensibles:** IPs reales, credenciales, tokens y nombres de clientes/personas deben reemplazarse por `[SENSITIVE_DATA_REDACTED]`.
2. **Ejemplos:** cuando un ejemplo use correo, usuario o host, debe ser ficticio o redaccionado.
3. **Consistencia:** nombres de endpoints, modelos y colecciones deben coincidir exactamente con el código.
4. **Sin omisiones:** cuando se liste un procedimiento paso a paso, se deben incluir todos los pasos del origen.


