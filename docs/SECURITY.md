# 🔐 Seguridad - Bitácora SOC

Decisiones de seguridad, hardening y checklist pre-producción.

---

## Decisiones de Seguridad

### Autenticación y Autorización

**Sesión Web:**
- La web usa cookie `auth_token` HttpOnly.
- Duración JWT interna: 4h (admin/user), 2h (guest).
- Algoritmo: HS256.
- Secret: `JWT_SECRET` en `.env`.
- El frontend envía credenciales con `withCredentials: true`.
- Al arrancar, Angular rehidrata la sesión con `GET /api/users/me`.

**Application Tokens de Complementos:**
- Se firman con `COMPLEMENT_TOKEN_SECRET`, distinto de `JWT_SECRET`.
- Se envían en `Authorization: Bearer <application_token>` solo hacia `/api/internal/*`.
- Se revocan efectivamente al regenerar token o eliminar el complemento.

**RBAC (Role-Based Access Control):**
- Admin: Acceso completo
- User: Operación diaria (entradas, checklist, notas personales)
- Auditor: Lectura de auditoría y trazabilidad
- Guest: Acceso limitado; entradas marcadas como invitado

**Validación de Roles:**
- Middleware de autenticación para cookie/JWT y autorización por rol.
- Endpoints sensibles protegidos con rol `admin`.

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
ALLOWED_ORIGINS=http://192.168.100.50:4200,http://192.168.1.100:4200
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
- Límite configurable con `RATE_LIMIT_LOGIN_MAX`.
- Ventana: 15 minutos
- Está montado en `POST /api/auth/login`

**API General:**
- Límite configurable con `RATE_LIMIT_MAX_REQUESTS`
- Ventana: 15 minutos
- Endpoints: `/api/**` (solo en producción)

**API autenticada:**
- Límite configurable con `RATE_LIMIT_MAX_AUTH_REQUESTS`
- Útil para reducir ruido en usuarios autenticados sin castigar el login

**SMTP Test (prevención abuso):**
- Límite: 3 intentos
- Ventana: 15 minutos
- Endpoint: `POST /api/smtp/test`

### Configuración

Variables `.env`:
```env
RATE_LIMIT_WINDOW_MS=900000      # 15 min
RATE_LIMIT_MAX_REQUESTS=1000     # API general
RATE_LIMIT_MAX_AUTH_REQUESTS=2000
RATE_LIMIT_LOGIN_MAX=20          # Login
RATE_LIMIT_SMTP_MAX=3            # SMTP test
RATE_LIMIT_RESET_SECRET=         # Opcional; ver subsección siguiente
```

### `RATE_LIMIT_RESET_SECRET` (opcional)

- **Tipo de dato:** cadena de texto (`string`). **No es un número** ni un identificador con formato obligatorio: puede contener letras, dígitos y símbolos según cómo la generes (alfanumérico, Base64, etc.).
- **Regla en aplicación:** si la variable falta o tiene **menos de 24 caracteres**, el endpoint de reinicio de contadores **no se publica** (el servidor responde `404` en esa ruta, comportamiento “oculto”).
- **Generación recomendada (aleatoria, alta entropía):**
  ```bash
  openssl rand -base64 32
  ```
  Eso produce típicamente **44 caracteres** en [A–Z, a–z, 0–9, `+`, `/`] y a veces `=` al final (padding Base64). Es válido pegar el resultado **completo** en `.env` sin comillas, salvo que tu shell requiera escapar `$` u otros caracteres raros.
- **Uso en peticiones:** el valor debe enviarse **idéntico** en la cabecera HTTP `X-Rate-Limit-Reset-Secret` (texto UTF-8). Evita espacios al inicio/final al copiar desde `.env`.
- **Riesgo:** quien conozca el secreto puede vaciar el limiter global de API; tratar como **credencial operativa** (no versionar en git, rotar si se filtra). Detalle de uso: `docs/API.md` (Rate limiting) y `docs/ISSUES.md` (SEC-RL-018).

### Reinicio de contadores de rate limit (sin reiniciar el backend)

Si `RATE_LIMIT_RESET_SECRET` cumple la longitud mínima, existe `POST /api/system/rate-limit-reset` (montado **antes** del middleware que aplica el límite global a `/api/`, para que un `429` no bloquee la propia llamada de rescate).

| Elemento | Detalle |
|----------|---------|
| Método | `POST` |
| Ruta | `/api/system/rate-limit-reset` |
| Cabecera | `X-Rate-Limit-Reset-Secret: <mismo valor que RATE_LIMIT_RESET_SECRET>` |
| Cuerpo JSON | `{"ip":"<IPv4 o IPv6>"}` opcionalmente con `"username":"..."` para limpiar también el limiter de login para `ip:usuario`; **o** `{"all":true}` para vaciar **todo** el store en memoria del limiter global de API (útil si **no** conoces la IP del analista o hay NAT compartido; afecta a todas las claves de ese store). |

Uso típico desde el servidor o bastión: `curl` con HTTPS al puerto del API. Si el secreto no está configurado o es inválido: `404` / `403` según el caso. La operación queda auditada (`system.rate_limit.reset`).

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
- Excepción controlada: los artefactos publicados bajo `/uploads/complements/*` remueven `DENY` para permitir carga en el `iframe` de la plataforma.

**X-Content-Type-Options:**
- Valor: `nosniff`
- Previene MIME sniffing

**X-XSS-Protection:**
- Valor: `1; mode=block`
- Filtro XSS legacy (navegadores antiguos)

### Verificación

```bash
curl -I http://192.168.100.50:3000/health | grep -E "X-|Content-Security"
```

Debe mostrar:
```
Content-Security-Policy: ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
```

---

## Aislamiento de Complementos

- Los complementos usan `Application Token` firmado con `COMPLEMENT_TOKEN_SECRET`, distinto de `JWT_SECRET`.
- La API interna valida firma, expiración, `slug` activo, hash del último token emitido y scopes requeridos.
- El iframe de complemento corre con `sandbox="allow-scripts allow-same-origin allow-forms"`.
- El bridge de frontend acepta `postMessage` solo desde el `origin` registrado del complemento.
- El wipe-out solo permite `dropDatabase()` sobre nombres `bitacora_ext_*`.
- Los artefactos publicados y previews no quedan expuestos de forma anónima: la ruta `/uploads/complements/*` exige autenticación y valida visibilidad.
- `COMPLEMENT_ALLOW_PRIVATE_URLS` controla si se aceptan hosts privados/loopback para complementos en escenarios internos o de laboratorio.

## Respuesta a Complemento Comprometido

1. Poner el complemento en `maintenance` o eliminarlo desde `Admin > Complementos`.
2. Regenerar token o completar el wipe-out.
3. Revisar `complement.api.denied`, `complement.circuit.*` y `complement.wipe.*` en auditoría.
4. Validar que no queden artefactos `ownerComplementId` en la BD general.

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
MONGODB_URI=mongodb://10.0.101.200:27017/bitacora

# Configurar CORS (IPs reales, NO localhost)
ALLOWED_ORIGINS=http://192.168.100.50:4200,http://192.168.1.100:4200
```

**❌ NO usar valores por defecto:**
- `ENCRYPTION_KEY=your-32-char...`
- `JWT_SECRET=super-secret-jwt-key`
- `ALLOWED_ORIGINS=http://localhost:4200`

#### 2. Rate Limiting

**✅ Verificar activo:**
```bash
curl -X POST http://192.168.100.50:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}' \
  --write-out "\n%{http_code}\n"
# Repetir 6 veces → debe retornar 429
```

#### 3. CORS

**✅ Verificar rechazo orígenes no permitidos:**
```bash
curl -X GET http://192.168.100.50:3000/api/users/me \
  -H "Origin: http://malicious.com" \
  -H "Authorization: Bearer $TOKEN" \
  -I
# Debe retornar 403 Forbidden
```

#### 4. MongoDB

**✅ Autenticación habilitada:**
```bash
mongosh mongodb://10.0.101.200:27017/bitacora
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
curl -I http://192.168.100.50:3000/health
# Debe incluir: X-Frame-Options, X-Content-Type-Options, CSP
```

### Frontend

#### 1. Configuración API URL

**✅ IP real (NO localhost):**
```typescript
// src/environments/environment.ts
export const environment = {
  production: true,
  apiUrl: 'http://192.168.100.50:3000/api'  // IP real del servidor
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
  pwd: "SECURE_PASSWORD_HERE",
  roles: [{ role: "readWrite", db: "bitacora" }]
})
```

**✅ Actualizar MONGODB_URI:**
```env
MONGODB_URI=mongodb://bitacora_admin:SECURE_PASSWORD_HERE@10.0.101.200:27017/bitacora
```

#### 2. Firewall

**✅ Solo permitir IP del servidor backend:**
```bash
# Windows Firewall
netsh advfirewall firewall add rule name="MongoDB" dir=in action=allow protocol=TCP localport=27017 remoteip=192.168.100.50
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
curl -X POST http://192.168.100.50:3000/api/logging/test \
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
   netsh advfirewall firewall add rule name="Block Attacker" dir=in action=block remoteip=192.168.1.100
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
