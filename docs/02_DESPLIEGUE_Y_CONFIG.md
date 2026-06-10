# Configuración Inicial (Setup)

# 🔧 Instalación y Configuración - BitacoraSOC

Guía detallada para instalar y configurar el sistema desde cero.

> Aviso: Los valores de ejemplo son placeholders. Reemplazarlos por credenciales reales desde `.env` antes de usar en producción.
> Estado: Proyecto en **beta**. Validar los flujos críticos en entorno de pruebas antes de pasar a operación.

---

## Requisitos

- **Node.js** 22 LTS o superior
- **pnpm** 11.x (via Corepack: `corepack enable && corepack prepare pnpm@11.0.0 --activate`)
- **Express** 5.1+
- **MongoDB** 8+ (local o remoto)
- **mongodump/mongorestore** (para backups)
- **Angular CLI** 20+ (ejecutado via scripts o `pnpm exec ng`)

---

## 1. Instalación

### 1.1 Clonar o Extraer

```powershell
cd C:\ruta\a\BitacoraSOC
```

### 1.2 Backend

```powershell
cd backend
pnpm install
```

**Paquetes principales instalados:**
- express, mongoose, jsonwebtoken
- bcryptjs, nodemailer, helmet
- pino (logging), uuid (correlation ID)

### 1.3 Frontend

```powershell
cd ..\frontend
pnpm install
```

**Paquetes principales:**
- @angular/core 20.3.18, @angular/material 20.2.14
- anime.js (animaciones)

### 1.4 MongoDB

Verificar que MongoDB esté corriendo:

```powershell
mongosh --eval "db.version()"
```

**Salida esperada:**
```
8.x
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
ALLOWED_ORIGINS=http://192.168.100.50:4200,http://localhost:4200

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000           # 15 min
RATE_LIMIT_MAX_REQUESTS=1000          # API general
RATE_LIMIT_MAX_AUTH_REQUESTS=2000     # API autenticada
RATE_LIMIT_LOGIN_MAX=20               # Login
RATE_LIMIT_RESET_SECRET=              # Opcional: texto >= 24 chars (openssl rand -base64 32); SECURITY.md

# Complementos
COMPLEMENT_TOKEN_SECRET=GENERAR_CON_OPENSSL
COMPLEMENT_MAX_DBS=5
COMPLEMENT_CIRCUIT_TIMEOUT_MS=3000
COMPLEMENT_CIRCUIT_FAIL_THRESHOLD=3
COMPLEMENT_CIRCUIT_RESET_MS=30000
COMPLEMENT_ALLOW_PRIVATE_URLS=true

# Timezone
TZ=America/Santiago

# Encryption (passwords SMTP y PII)
ENCRYPTION_KEY=GENERAR_CON_OPENSSL    # 64 caracteres hex (32 bytes)
# Nota: La base de datos persistirá un keyring de claves en /app/secrets/encryption-keyring.json
# para permitir descifrar datos históricos en caso de que cambie la ENCRYPTION_KEY actual.

# Single Sign-On (SSO) Google / Microsoft
GOOGLE_CLIENT_ID=
AZURE_CLIENT_ID=
AZURE_TENANT_ID=

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
ENCRYPTION_KEY=a3f5b8c9d2e4f6a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9
```

**JWT_SECRET:**
```powershell
openssl rand -base64 32
```

Copiar salida a `.env`:
```env
JWT_SECRET=XyZ123AbC456DeF789...
```

**⚠️ NUNCA COMMITEAR .env A GIT**

**Nota de sesión web:** La UI usa cookie `auth_token` HttpOnly y rehidrata estado con `GET /api/users/me`, por lo que `ALLOWED_ORIGINS` debe incluir exactamente el origen del frontend en desarrollo.

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
192.168.100.50  Wi-Fi
```

**Linux/Mac:**
```bash
ip addr show | grep inet
```

### 3.2 Configurar CORS Backend

En `backend\.env`:
```env
ALLOWED_ORIGINS=http://192.168.100.50:4200,http://192.168.1.100:4200
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
  apiUrl: 'http://192.168.100.50:3000/api'  // ⚠️ USAR TU IP
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

### Opcion recomendada: seed-admin

Usar el script oficial para crear solo el administrador maestro:

```powershell
docker compose exec backend node src/scripts/seed-admin.js
```

Este script:

- toma usuario/password desde `.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`)
- no inserta datos ficticios adicionales
- no sobreescribe admin existente por seguridad

### Opcion de laboratorio: seed completo

Para demos o QA interno, usar:

```powershell
docker compose exec backend node src/scripts/seed.js
```

`seed.js` inserta datos de prueba (usuarios, turnos, clientes, checklist, historial sanitizado). No usar en produccion.

### Opcion manual en Mongo

Solo para casos especiales. Se recomienda evitar inyecciones manuales directas cuando exista `seed-admin.js`.

---

## 5. Verificación

### Backend

```powershell
cd backend
pnpm run dev
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
pnpm start
```

**Salida esperada:**
```
** Angular Live Development Server is listening on 0.0.0.0:4200 **
✔ Compiled successfully.
```

**Acceder:**
- Local: `http://localhost:4200`
- Por IP: `http://192.168.100.50:4200`

---

## 6. Configuración Inicial Admin

### 6.1 Login

1. Ir a `http://192.168.100.50:4200`
2. Login: `admin` / `CHANGE_ME`
3. **Cambiar password inmediatamente** (Mi Perfil → Cambiar contraseña)

### 6.2 Configuración General

**Admin → Config General:**

- **Nombre de la aplicación:** "Bitácora SOC"
- **Cooldown checklist:** 4 horas (ajustar según operación)
- **Modo invitado:**
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

**Admin → Admin Usuarios → Nuevo:**

- Username (único)
- Email (único)
- Password (mín 6 chars)
- Nombre completo
- Rol:
  - **Admin:** Acceso total
  - **User:** Entradas + checklist
  - **Guest:** Solo entradas (temporal)

**Guests:**
- Si modo invitado habilitado, se calcula `guestExpiresAt` automáticamente
- Expira según configuración (default 2 días)
- Después de expiración, no puede hacer login

---

## 8. Logo Personalizado

**Admin → Config General → Logo:**

1. Click "Cambiar logo"
2. Seleccionar imagen (PNG/JPG, máx 2MB)
3. Upload
4. Se muestra en sidebar

**Path almacenado:** `backend/uploads/logo.png`

---

## 9. Backup Inicial

**Admin → Backup/Restore:**

1. Click "Crear Backup"
2. Esperar (puede tardar según tamaño DB)
3. Descarga automática o lista en "Backups disponibles"

**Path:** `backend/backups/backup-YYYY-MM-DDTHH-MM-SS/`

**Contiene:**
- Usuarios
- Entradas
- Checklist
- Configuración
- Notas

**Frecuencia recomendada:** Diario (automatizar con cron/task scheduler)

---

## 10. Troubleshooting Instalación

### Backend no inicia

**Error: `ENCRYPTION_KEY no configurada`**
```
⚠️ ENCRYPTION_KEY no configurada o muy corta. Usa: openssl rand -hex 32
```

**Solución:**
```powershell
openssl rand -hex 32 | Out-File -Encoding ASCII .encryption_key
# Copiar contenido a .env → ENCRYPTION_KEY=...
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


# Despliegue (Deploy)

# Bitacora SOC - Guía de Despliegue y Operación

> **Nota:** Todos los comandos de esta guía asumen el uso de `docker compose` (V2).
> **Aviso de Seguridad:** Los valores expuestos en esta guía son ejemplos descriptivos. Por favor, asegúrate de reemplazarlos por credenciales fuertes en tu archivo `.env` antes de ir a producción.

---

## 1. Requisitos Previos

- **Docker Desktop** o **Docker Engine** (con plugin Compose).
- **Git** instalado.

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
echo "COMPLEMENT_TOKEN_SECRET=$(openssl rand -base64 32)" >> .env

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

Los scripts de esta carpeta ya incluyen el overlay `docker-compose.complements.yml`, pensado hoy para laboratorio/QA con `complement-stub`.

- **Windows:** `.\scripts\compose-rebuild.ps1`
- **Linux/Mac:** `sh ./scripts/compose-rebuild.sh`
- **Windows (solo levantar):** `.\scripts\compose-up.ps1`
- **Linux/Mac (solo levantar):** `sh ./scripts/compose-up.sh`

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
ALLOWED_ORIGINS=https://soc.midominio.com

# True si sirves bajo HTTPS nativo / False si es solo red local plana
COOKIE_SECURE=true

# Generar mediante 'openssl rand'
JWT_SECRET=super_secret_aleatorio
ENCRYPTION_KEY=clave_encriptacion_hex_32_bytes
COMPLEMENT_TOKEN_SECRET=secret_app_tokens_complementos
COMPLEMENT_MAX_DBS=5
COMPLEMENT_CIRCUIT_TIMEOUT_MS=3000
COMPLEMENT_CIRCUIT_FAIL_THRESHOLD=3
COMPLEMENT_CIRCUIT_RESET_MS=30000
COMPLEMENT_ALLOW_PRIVATE_URLS=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000
RATE_LIMIT_MAX_AUTH_REQUESTS=2000
RATE_LIMIT_LOGIN_MAX=20
# Opcional: cadena >= 24 chars (openssl rand -base64 32). POST /api/system/rate-limit-reset
RATE_LIMIT_RESET_SECRET=

# Configuración SSO (Opcionales)
GOOGLE_CLIENT_ID=google_client_id_aca
AZURE_CLIENT_ID=azure_client_id_aca
AZURE_TENANT_ID=azure_tenant_id_aca

# ============================
# BASE DE DATOS MONGODB
# ============================
MONGO_ROOT_PASSWORD=password_fuerte_bd
MONGO_DATABASE=bitacora_soc

# ============================
# CREDENCIALES SEED
# ============================
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME
ADMIN_EMAIL=admin@example.com
```

### Overlay de complementos

```bash
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
```

Uso recomendado de este overlay:

- laboratorio local
- QA del `complement-stub`
- pruebas de circuit breaker y health-check

Aclaraciones:

- no existe ya `docker-compose.test.yml`
- el backend participa en `bitacora-network` y `bitacora-complements`
- el frontend permanece solo en `bitacora-network`
- MongoDB permanece en la red principal
- los complementos ZIP publicados por la plataforma no necesitan este overlay

---

## 5. Configuración HTTPS y Seguridad TLS (0-Downtime)

Bitácora SOC soporta inyección dinámica TLS directamente desde la Base de Datos, previniendo reinicios del contenedor al rotar certificados.
Los certificados son almacenados internamente bajo un volumen Docker estricto en `.data/tls` (montado en `/app/secrets`).

### Instalación de Certificados Reales

1. Entrar a la plataforma web como Administrador.
2. Navegar a **Configuración > Seguridad**.
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

1. Sube ambos archivos en la consola local y pulsa activar.
2. Node activará su motor criptográfico al vuelo. Verifica accediendo a `https://localhost:3443/health`.

---

## 6. Entorno de Desarrollo Local (Sin Docker)

> **Requisitos:** Node.js 22 LTS o superior, MongoDB 8+, Express 5.1+.

### 6.1 Backend

```bash
cd backend
cp .env.example .env

# Asegúrate de ajustar MONGODB_URI a localhost en tu .env

pnpm install
pnpm run dev             # Levanta API en http://localhost:3000
pnpm run seed            # Crea admin root
pnpm run restart:clean   # Libera forzosamente puertos zombies 3000/3443 en caso de crasheos
```

### 6.2 Frontend

```bash
cd frontend
pnpm install
pnpm run restart:clean   # Mata limpiamente los procesos de Angular zombies en el 4200 (EADDRINUSE)
pnpm start               # Levanta UI proxy en http://localhost:4200
```

> **Configuración Cruzada Local:**
> Asegúrate de que `backend/.env` posea `ALLOWED_ORIGINS=http://localhost:4200`.
> **Sesión Web Actual:** El frontend usa cookie `auth_token` HttpOnly y bootstrap con `GET /api/users/me`, por lo que CORS y `withCredentials` deben quedar correctamente alineados.

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

Nota: los scripts resuelven el servicio `mongodb` usando el `docker compose` de este repositorio, no un contenedor Mongo cualquiera del host.

**Resguardar Subidas Estáticas (Logos, Evidencias):**

```bash
docker run --rm -v bitacorasoc_backend_uploads:/source \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/uploads-$(date +%Y%m%d).tar.gz -C /source .
```

### Restauración vía API (ZIP Integrado)

Si activaste la tarea automática de Backup en el panel, se grabarán respaldos completos `.zip` en `.data/backups/`. Para restaurar alguno:

```powershell
# Obtén tu token Bearer logueándote como Admin, y dispara (solo desarrollo/rescate):
curl -X POST http://TU_IP:3000/api/backup/restore \
  -H "Authorization: Bearer TU_TOKEN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename":"backup-ARCHIVO.zip","clearBeforeRestore":true}'
```

Compatibilidad: el restore sigue aceptando `.json` legacy cuando existan respaldos antiguos.

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

**Solución:** Existen topologías en Linux donde `localhost` colisiona resolviendo directamente en IPv6 (`::1`). Edita los `Dockerfile` de front y back y re-apunta los cURL de Healthcheck hacia `127.0.0.1`.

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
**Solución:** Asignar un "LogSource por defecto" en la interfaz de configuración del Sistema y correr paridad de rescate:

```bash
# Logueo directo en la consola MongoDB
docker exec -it bitacora-mongodb mongosh --username admin --authenticationDatabase admin

# (Ejecutar en la consola DB) Corrección en masa:
db = db.getSiblingDB("bitacora_soc");
const source = db.catalog_log_sources.findOne({ _id: db.appconfigs.findOne({}).defaultLogSourceId });
if(source) db.entries.updateMany({ clientId: null }, { $set: { clientId: source._id, clientName: source.name } });
```



# Respaldos (Backup)

# 💾 Backup y Recuperacion - Bitacora SOC

Procedimientos de respaldo, restauracion e importacion/exportacion.

Para recuperacion completa ante desastre (host perdido, volumen dañado, reconstruccion total), usar `DISASTER-RECOVERY.md`.

---

## ✅ Respaldo Multicolección (ZIP)

### Crear backup

**Endpoint:** `POST /api/backup/create` (admin)

**Respuesta:**
```json
{
  "message": "Backup completo creado exitosamente",
  "filename": "backup-2026-03-06T18-54-19-392Z.zip",
  "collections": 32,
  "documents": 10,
  "sizeBytes": 3489
}
```

### Historial

**Endpoint:** `GET /api/backup/history` (admin)

**Respuesta:**
```json
{
  "backups": [
    {
      "_id": "backup-2026-03-06T18-54-19-392Z.zip",
      "filename": "backup-2026-03-06T18-54-19-392Z.zip",
      "createdAt": "2026-02-08T18:22:10.123Z",
      "size": 2489012
    }
  ]
}
```

Nota: el historial puede mostrar `.json` legacy, pero los respaldos actuales manuales y automáticos se generan como `.zip`.

### Restaurar backup

**Endpoint:** `POST /api/backup/restore` (admin)

**Body:**
```json
{
  "filename": "backup-2026-03-06T18-54-19-392Z.zip",
  "clearBeforeRestore": true
}
```

**Notas:**
- `clearBeforeRestore=true` borra todas las colecciones antes de restaurar.
- El restore descomprime el archivo `.zip` y restaura tanto la base de datos como `uploads/`, `secrets/` y el directorio opcional `global/` cuando existe en el respaldo.
- La restauración recorre subdirectorios, por lo que también repone logos, favicons y artefactos publicados bajo `uploads/complements/`.
- Los certificados TLS guardados por la plataforma via `secrets/` quedan cubiertos dentro del mismo restore.
- `secrets/` también incluye `encryption-keyring.json`, usado para descifrar credenciales históricas (SMTP e integraciones) al restaurar en otro entorno.

### Eliminar backup

**Endpoint:** `DELETE /api/backup/:id` (admin)

Ejemplo: `DELETE /api/backup/backup-2026-03-06T18-54-19-392Z.zip`

---

## 📤 Exportacion CSV

**Endpoint:** `GET /api/backup/export/:type` (admin)

Tipos soportados:
- `entries`
- `checks`
- `all` (exporta multiples archivos)

Ejemplo:
```bash
curl -X GET http://localhost:3000/api/backup/export/entries \
  -H "Authorization: Bearer <token-api>" \
  -o entradas.csv
```

Nota: en uso web normal, la autenticacion principal es por cookie `auth_token` HttpOnly.

---

## 📥 Importacion ZIP Completo o JSON

**Endpoint:** `POST /api/backup/import` (admin)

**Contenido:** `multipart/form-data`
- `file`: archivo `.zip` (completo: BD + uploads + secrets) o `.json` (legacy)
- `clearBeforeRestore`: opcional; si llega en `true`, limpia primero las colecciones antes de importar.

**ZIP:** Contiene `data.json` + directorio `/uploads` + directorio `/secrets` (certificados + keyring de cifrado) + directorio opcional `/global`. Se restauran todos los archivos fisicos de forma recursiva.

**JSON Legacy:** Solo BD, útil para importación puntual de datos antigios.

Independientemente del formato, se importan todas las 32 colecciones de base de datos de forma dinámica.

Nota operativa: el proxy web del frontend acepta importaciones de backup de hasta `100M` y extiende timeouts a `300s` para evitar rechazos `413` en respaldos grandes.

---

## 🧹 Purga controlada

**Endpoint:** `POST /api/backup/purge` (admin)

**Notas:**
- La purga elimina el contenido operativo de base de datos y limpia los directorios fisicos restaurables del Core (`uploads/`, `secrets/` y `global/` si existe).
- Tras la purga, el sistema recrea automaticamente la cuenta administrativa por defecto tomando `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `ADMIN_EMAIL` desde `.env`.
- Este flujo sirve para rearmar una instancia desde cero sin perder el acceso inicial de administracion.

---

## 🗂️ Ubicacion de archivos

Los backups comprimidos `.zip` se guardan en:
- **Local:** `backend/backups/`
- **Docker:** Volumen mapeado a `./.data/backups/` en el host, montado en `/app/backups/` dentro del contenedor.

---

## 🔒 Seguridad

- Solo admin puede crear/restaurar/importar/eliminar.
- Auditoria de operaciones: `admin.backup.*`.
- Sanitizacion de rutas y validacion de nombres de archivo.

## 🧩 Complementos

- El backup general del Core no incluye automáticamente las DB privadas `bitacora_ext_*`.
- Cada complemento debe respaldar su propia base privada.
- El wipe-out de un complemento elimina su DB privada y purga artefactos generales vinculados por `ownerComplementId`.
- El almacenamiento compartido del complemento (`ComplementSharedRecord`) sí queda dentro del backup general del Core.
- El estado guardado vía `/api/complements/:slug/browser-state` también queda dentro del backup general porque usa esa misma colección compartida.
- La configuración GLPI, RACI, turnos de trabajo, cierres, notificaciones de checklist y metadatos de complementos quedan dentro del backup general del Core.
- Los artefactos publicados `uploads/complements/published/<slug>/` deben considerarse parte del respaldo del volumen de uploads.
- Los previews `uploads/complements/preview/<previewId>/` son temporales y hoy no tienen limpieza automática; no conviene tratarlos como artefacto permanente de respaldo.


# Recuperación de Desastres

# Recuperacion Ante Desastres (DR)

Procedimiento oficial para recuperar Bitacora SOC ante perdida parcial o total del servicio.

---

## 1. Alcance

Este runbook cubre:

- perdida de contenedores
- perdida de volumen de MongoDB
- perdida de archivos de uploads y backups
- recuperacion completa desde cero con respaldos

No cubre la recuperacion interna de bases privadas de un complemento externo. Esa responsabilidad recae en cada complemento.

---

## 2. Objetivos de continuidad

- RTO objetivo: restaurar servicio base en menos de 2 horas
- RPO objetivo: perder como maximo la ventana entre ultimo backup valido y la falla

Los valores reales dependen de la frecuencia de backups y del almacenamiento externo disponible.

---

## 3. Inventario minimo a respaldar

Respaldo obligatorio:

- backup de aplicacion (`backup-*.zip`) en `./.data/backups`
- archivo `.env` seguro y versionado fuera del host
- carpeta `./.data/uploads` (logos y artefactos publicados)
- carpeta `./.data/tls` (si se usan certificados propios)

Complementos:

- DB privada `bitacora_ext_*` se respalda fuera del core
- `ComplementSharedRecord` y `browser-state` si quedan en backup core

---

## 4. Escenarios de desastre

## 4.1 Falla de contenedor sin perdida de datos

1. Validar estado:

```bash
docker compose ps
docker compose logs backend --tail=200
```

2. Reconstruir servicio afectado:

```bash
docker compose up -d --build backend
```

3. Validar `health` y login.

## 4.2 Corrupcion o perdida de MongoDB

1. Detener stack:

```bash
docker compose down
```

2. Aislar volumen dañado (renombrar, no borrar de inmediato):

- `./.data/mongodb_data` -> `./.data/mongodb_data_corrupt_YYYYMMDD`

3. Levantar stack limpio:

```bash
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
```

4. Restaurar backup valido por API o proceso manual.

5. Validar consistencia funcional.

## 4.3 Perdida total del host

1. Provisionar nuevo host.
2. Clonar repositorio y restaurar `.env`.
3. Restaurar carpetas persistentes desde almacenamiento externo:

- `.data/backups`
- `.data/uploads`
- `.data/tls`

4. Levantar stack.
5. Ejecutar restore del ultimo backup valido.
6. Verificar usuarios, bitacora, checklist y complementos.

---

## 5. Procedimiento de recuperacion completa

## 5.1 Preparacion

1. confirmar ultimo backup integro (`.zip`)
2. tener hash o checksum si existe
3. notificar ventana de mantenimiento

## 5.2 Restaurar plataforma base

1. copiar `.env` correcto
2. levantar stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
```

3. comprobar `http://localhost:3000/health`

## 5.3 Restaurar datos

Via API (recomendada):

1. login admin
2. `POST /api/backup/restore` con `clearBeforeRestore=true`
3. esperar finalizacion y revisar auditoria `admin.backup.*`

Nota: si no existe admin tras desastre extremo, ejecutar primero:

```bash
docker compose exec backend node src/scripts/seed-admin.js
```

## 5.4 Restaurar complementos

1. validar registros en `Admin > Complementos`
2. validar artefactos publicados en `uploads/complements/published`
3. restaurar por separado DB privada de cada complemento externo
4. ejecutar prueba de conectividad por complemento

---

## 6. Validacion post-recuperacion

Checklist minimo:

- login admin y user
- consulta de entradas historicas
- registro de nueva entrada
- registro de checklist
- `GET /api/backup/history`
- auditoria operativa visible
- complementos activos cargan sin estado `OPEN`

Si algun control falla, mantener sistema en modo mantenimiento y abrir incidente de recuperacion.

---

## 7. Fallas y rollback de recuperacion

## 7.1 Restore incompleto

Sintoma: colecciones faltantes o errores al restaurar.

Accion:

1. revisar logs backend
2. repetir restore con backup anterior
3. documentar backup defectuoso y retirarlo de rotacion

## 7.2 Servicio restaura pero no autentica

Sintoma: login falla tras restaurar.

Accion:

1. validar `JWT_SECRET` y `ENCRYPTION_KEY`
2. confirmar existencia de usuario admin
3. recrear admin con `seed-admin.js` si corresponde

## 7.3 Complementos visibles pero sin contenido

Sintoma: iframe en blanco o mantenimiento permanente.

Accion:

1. validar archivos en `uploads/complements/published/<slug>/`
2. validar healthPath/baseUrl
3. regenerar token y actualizar secreto en servicio externo

---

## 8. Pruebas periodicas de DR

Frecuencia recomendada: mensual en entorno de ensayo.

Ejercicio minimo:

1. restaurar ultimo backup en entorno limpio
2. ejecutar checklist de validacion post-recuperacion
3. medir tiempos reales RTO/RPO
4. ajustar procedimiento si hay desvio

---

## 9. Gobierno de respaldo

- mantener al menos 3 puntos de restauracion
- guardar una copia fuera del host principal
- etiquetar backups por criticidad y fecha
- prohibir uso de backups no verificados en restauraciones de emergencia


