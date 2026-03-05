# Bitacora SOC - Docker Deploy Guide

> Nota: Los comandos usan `docker compose`. Si tu instalacion usa `docker-compose`, reemplaza el comando.
> Aviso: Los valores de ejemplo son placeholders. Reemplazarlos por credenciales reales desde `.env` antes de usar en producción.

## Requisitos
- Docker Desktop / Docker Engine
- Git

## Quick Start (primer despliegue)
```bash
# 1. Clonar y entrar
cd /ruta/del/proyecto

# 2. Variables de entorno
cp .env.example .env
nano .env  # Cambia TODAS las credenciales y secrets

# 3. Generar secrets (ejemplos)
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"

# 4. Levantar servicios
docker compose up -d --build

# 5. Crear admin inicial (IMPORTANTE)
docker compose exec backend node src/scripts/seed.js

# 6. Abrir UI
# http://IP-SERVIDOR:PUERTO
```

## Desarrollo local (sin Docker)
> Requiere: Node.js 18+, MongoDB 6+ y (opcional) Angular CLI `npm install -g @angular/cli`

### 1) Backend
```powershell
cd backend
copy .env.example .env
# Editar .env: MONGODB_URI, JWT_SECRET, ENCRYPTION_KEY, ALLOWED_ORIGINS

npm install
npm run dev     # API en http://localhost:3000
npm run seed    # Crea admin inicial (si no existe)
```

### 2) Frontend
```powershell
cd ..\frontend
npm install
npm start       # UI en http://localhost:4200
```

**Tip:** si accedes desde otra PC/IP, ajusta:
- `backend\.env` → `ALLOWED_ORIGINS=http://TU_IP:4200`
- `frontend\src\environments\environment.ts` → `apiUrl: 'http://TU_IP:3000/api'`

### 3) Cargar data local
**Opción A: Restaurar backup JSON (recomendado si ya tienes backup)**
```powershell
# Ver backups disponibles
Get-ChildItem backend\backups

# Restaurar (requiere token de admin)
curl -X POST http://localhost:3000/api/backup/restore `
  -H "Authorization: Bearer TU_TOKEN" `
  -H "Content-Type: application/json" `
  -d "{`"filename`":`"backup-AAAA-MM-DDTHH-MM-SS-fffZ.json`",`"clearBeforeRestore`":true}"
```
> El archivo debe estar dentro de `backend/backups/`.

**Opción B: Importar CSV/JSON**
```powershell
# CSV -> JSON
node backend\scripts\csv-to-json-entries.js ruta\archivo.csv salida.json

# Importar entradas
node backend\scripts\import-entries.js salida.json nombre-usuario
```
Para más detalle: `docs/SETUP.md` y `backend/scripts/README.md`.

## Version automatica (recomendado)
Para evitar editar numeros a mano, usa los scripts que calculan la version desde Git:

```bash
# PowerShell (Windows)
.\scripts\compose-up.ps1

# Bash (Linux/Mac)
sh ./scripts/compose-up.sh
```

Esto inyecta `APP_VERSION` al build (ej: `v1.2.3-5-gabc1234`) y lo muestra en login y /health.

## Actualizar la aplicacion
### Actualizacion normal (recomendada)
```bash
cd /ruta/del/proyecto
git pull origin main

docker compose build --no-cache
docker compose up -d
```

### Rebuild forzado (sin cache y recreando contenedores)
```bash
cd /ruta/del/proyecto
git pull origin main

docker compose build --no-cache
docker compose up -d --force-recreate
```
Alternativa automatica:
```bash
# PowerShell
.\scripts\compose-rebuild.ps1

# Bash
sh ./scripts/compose-rebuild.sh
```

### Solo cambios de .env (sin rebuild)
```bash
cd /ruta/del/proyecto
docker compose up -d
```

## Variables clave (.env)
```bash
# Puerto publico del frontend
FRONTEND_PORT=80

# Backend HTTP/HTTPS
BACKEND_PORT=3000
BACKEND_HTTPS_PORT=3443
HTTPS_PORT=3443

# CORS (OBLIGATORIO en producción)
# Incluye la URL exacta desde donde abres el frontend
ALLOWED_ORIGINS=https://soc.midominio.cl

# Cookie de sesión
# - Si usas HTTPS real: true
# - Si usas HTTP en red local: false
COOKIE_SECURE=true

# MongoDB
MONGO_ROOT_PASSWORD=tu_password_seguro
MONGO_DATABASE=bitacora_soc

# Backend - generar valores nuevos
JWT_SECRET=...
ENCRYPTION_KEY=...

# Version (opcional si usas scripts)
APP_VERSION=dev

# Admin inicial
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME
ADMIN_EMAIL=admin@example.com
```

## HTTPS en Docker (automático)

La configuración HTTPS se guarda en base de datos desde `Consola Admin > HTTPS / Seguridad` y se aplica al reiniciar el backend.

Pasos recomendados en producción:
1. Subir `SSL/TLS certificate` y `SSL/TLS private key` en la consola admin.
2. Guardar y activar `Habilitar listener HTTPS del backend`.
3. Reiniciar backend: `docker compose restart backend`.
4. Verificar `https://TU_HOST:${BACKEND_HTTPS_PORT}`.
5. Activar `Forzar HTTPS` solo cuando HTTPS ya responda correctamente.

Notas:
- Los archivos TLS quedan persistidos en `./.data/tls` (ruta interna `/app/secrets`).
- Si cambias dominio/puerto HTTPS, actualiza `ALLOWED_ORIGINS` con la URL real del frontend para evitar bloqueo CORS.

### Cómo probar TLS/SSL en Entorno Local (0-Downtime)

Para verificar que la reconexión en caliente y validación profunda de certificados funciona en tu PC sin necesidad de dominios reales:

1. **Generar certificados autofirmados de prueba:**
   Abre una terminal y ejecuta OpenSSL para crear un par de llaves:
   `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout local.key -out local.crt -subj "/CN=localhost"`
2. **Entrar al Administrador de SOC:**
   Ve a la vista **Configuración > HTTPS / Seguridad**.
3. **Subir Archivos:**
   - Selecciona `local.crt` en **SSL/TLS certificate**.
   - Selecciona `local.key` en **SSL/TLS private key**.
4. **Activar Magia:**
   - Oprime **"Subir SSL y Activar (0-Downtime)"**.
   - El backend validará matemáticamente la relación entre `.crt` y `.key`, e inyectará TLS en < 1ms.
5. **Verificar Backend Seguro (HTTPS):**
   - Abre una pestaña nueva hacia 👉 `https://localhost:3443/health` (👈 Exacto así, sin el `/api/`).
   - *Nota: Dale "Avanzado > Continuar" al aviso de "No Seguro", y verás la respuesta RAW JSON del Healthcheck demostrando que Express está escuchando SSL nativamente.*
6. **Usar la Interfaz (Frontend Local):**
   - El Desarrollo local UI no usa HTTPS, es un proxy de Node que corre en otra ventana (`npm start` en la carpeta `frontend/`).
   - Sigue usando la app normalmente abriendo en otra pestaña 👉 `http://localhost:4200`
7. **Desmontaje rápido:**
   - Usa el botón rojo **"Desactivar y limpiar archivos TLS"**, tipea `RESET` y el servidor matará el listener seguro volviendo a la normalidad de HTTP plano.

## Health checks (importante)
- Backend y frontend tienen health checks en sus Dockerfile.
- En algunos entornos, `localhost` resuelve a IPv6 (`::1`) y el health check marca `unhealthy`.
- Solucion: usar `127.0.0.1` en los health checks y reconstruir imagenes.

## Comandos utiles
```bash
# Estado
docker compose ps

# Logs
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend

# Reiniciar
docker compose restart

docker compose restart backend
```

## Backups
### MongoDB
```bash
docker compose exec mongodb mongodump \
  --uri="mongodb://admin:PASSWORD@localhost/bitacora_soc?authSource=admin" \
  --out=/data/backup/$(date +%Y%m%d)

docker cp bitacora-mongodb:/data/backup ./backups/
```

### Archivos (logos, logs)
```bash
# Ver volumenes
docker volume ls

# Backup uploads
docker run --rm -v bitacorasoc_backend_uploads:/source \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/uploads-$(date +%Y%m%d).tar.gz -C /source .

# Backup JSON de la app (ruta /app/backups del backend)
docker run --rm -v bitacorasoc_backend_backups:/source \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/app-backups-$(date +%Y%m%d).tar.gz -C /source .
```

## Troubleshooting
### Backend/Frontend unhealthy
```bash
# Verificar respuesta directa
docker compose exec backend wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health
```
Si responde OK pero sigue unhealthy, revisa el health check (localhost vs 127.0.0.1).

### Error 401 en login
```bash
# Eliminar admin y recrear

docker compose exec backend node -e "const mongoose=require('mongoose'); const User=require('./src/models/User'); mongoose.connect(process.env.MONGODB_URI).then(async()=>{ await User.deleteOne({username:'admin'}); console.log('Usuario admin eliminado'); process.exit(0); })"

docker compose exec backend node src/scripts/seed.js
```

### Frontend no carga
```bash
docker compose logs -f frontend

docker compose exec frontend ls -la /usr/share/nginx/html

docker compose exec frontend nginx -t
```

### Puerto ocupado
```bash
# Cambiar en .env
FRONTEND_PORT=8080

docker compose up -d
```

## Produccion (checklist)
- .env configurado y secretos seguros
- Servicios healthy
- Admin inicial creado y password cambiado
- Backups configurados
- Firewall/HTTPS configurado si aplica

## Soporte rapido
- Logs: `docker compose logs -f`
- Estado: `docker compose ps`

---

## LogSource por defecto (AppConfig)

El sistema usa `defaultLogSourceId` en `AppConfig` para asignar LogSource cuando una entrada no especifica cliente.

### Pasos recomendados
1. Crear el LogSource en Admin Catalogos.
2. Ir a Configuracion (Admin) y seleccionar el LogSource por defecto.
3. Verificar creando una entrada sin cliente (debe asignar el valor configurado).

### Migracion de entradas existentes (opcional)

Si quieres actualizar entradas antiguas sin LogSource, puedes ejecutar una actualizacion directa en MongoDB:

```bash
docker exec bitacora-mongodb mongosh \
  --username admin \
  --password YOUR_MONGO_PASSWORD \
  --authenticationDatabase admin \
  --eval '
    db = db.getSiblingDB("bitacora_soc");
    const def = db.appconfigs.findOne({});
    if (!def || !def.defaultLogSourceId) {
      print("❌ No hay defaultLogSourceId configurado");
      quit(1);
    }
    const source = db.catalog_log_sources.findOne({ _id: def.defaultLogSourceId });
    if (!source) {
      print("❌ LogSource no existe");
      quit(1);
    }
    const res = db.entries.updateMany(
      { clientId: null },
      { $set: { clientId: source._id, clientName: source.name } }
    );
    print(`✅ ${res.modifiedCount} entradas actualizadas`);
  '
```

## Error EACCES en backend (/app/backups/temp)

Síntoma:
- Backend reinicia en bucle con:
`EACCES: permission denied, mkdir '/app/backups/temp'`

Mitigación:
- Preparar permisos de volúmenes bind en host antes de levantar backend.

Comandos de recuperación:
```bash
sudo chown -R 1001:1001 .data/backups .data/uploads .data/logs
sudo chmod -R ug+rwX .data/backups .data/uploads .data/logs
mkdir -p .data/backups/temp
docker compose up -d --build
```
