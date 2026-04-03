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
ALLOWED_ORIGINS=https://soc.midominio.com

# True si sirves bajo HTTPS nativo / False si es solo red local plana
COOKIE_SECURE=true

# Generar mediante 'openssl rand'
JWT_SECRET=super_secret_aleatorio
ENCRYPTION_KEY=clave_encriptacion_hex_32_bytes

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

> **Requisitos:** Node.js 24+ LTS, MongoDB 8+, Express 5.1+.

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

### Migración Mayor MongoDB 7 a 8

Antes de cambiar la imagen en `docker-compose.yml` desde `mongo:7` a `mongo:8`, no reutilices a ciegas los archivos `.wt` del volumen existente.

1. Ejecuta `mongodump` completo desde el contenedor actual y copia el dump al host.
2. Detén el stack con `docker compose down`.
3. Respalda o renombra `./.data/mongodb_data` y `./.data/mongodb_config`.
4. Levanta MongoDB 8 con el volumen limpio para que inicialice archivos nuevos.
5. Restaura con `mongorestore` y valida la aplicación antes de reabrir operación.

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
