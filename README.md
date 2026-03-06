# Bitácora SOC

Sistema completo de registro y gestión de actividades para Security Operations Center (SOC).

> ⚠️ **ESTADO DEL PROYECTO: BETA (OBLIGATORIO/IMPORTANTE)**
> Este proyecto está en fase **beta**. Puede tener cambios, ajustes y comportamientos no finales.

**Stack:** Angular 20 + Express + MongoDB  
**Despliegue:** Docker Compose (Frontend + Backend + MongoDB)  
**Producción:** Uso recomendado con validación previa en entorno de pruebas (beta)

**Versiones declaradas (`package.json`)**
- Angular (`@angular/core`): `^20.3.17`
- backend (Node/Express): `Node 24 LTS`
- Mongo (Mongoose): `^8.0.3`

**Versiones exactas instaladas (`package-lock.json`)**
- Angular (`@angular/core`): `20.3.17`
- Express: `4.22.1`
- Mongo (Mongoose): `8.22.0`

> Aviso: Los valores de ejemplo son placeholders. Reemplazarlos por credenciales reales desde `.env` antes de usar en producción.

---

## Quick Start

```bash
# Con Docker (recomendado para producción)
cp .env.example .env          # Configurar variables
docker-compose up -d          # Levantar servicios
docker-compose exec backend npm run seed  # Crear admin

# Sin Docker (desarrollo)
cd backend && npm install && npm start
cd frontend && npm install && npm start
```

**Acceso:** http://localhost (Docker) o http://localhost:4200 (desarrollo)

---

## Funcionalidades principales

### Estado actual (cambios recientes)
- Proyecto en fase **beta** (features y flujos aún en ajuste)
- **Consola Admin unificada** en `/main/admin` (Users, Checklist, Turnos, Catálogos, Escalación, SMTP, Integraciones, GLPI)
- **Integraciones SIEM/SOAR/NDR** con múltiples conectores simultáneos (`udp/tcp/tls/http`)
- **GLPI separado** en menú propio (`Admin > GLPI`) con modo API y modo correo
- **Backups automáticos** con `intervalDays`, `localRetentionDays` y destino `local/smb/nfs`
- **Auditoría reforzada** (mail/admin/user/security, metadata de red/dispositivo y cambio de IP de sesión)

### Gestión de usuarios
- **4 roles:** Admin, User, Auditor, Guest
- **Admin:** CRUD completo de usuarios, configuración, backups y SIEM
- **User:** Registro de entradas, checklists y reportes
- **Auditor:** Lectura de auditoría y trazabilidad
- **Guest:** Acceso limitado, entradas marcadas como invitado

### Bitácora de entradas
- Registro de incidentes, ofensas y eventos operativos
- Autocompletado inteligente con catálogos personalizables
- Tags y búsqueda por fecha
- Filtros por tipo, fuente de logs y operación
- Vista completa para todos, "Mis Entradas" para admins

### Checklists de turno
- Plantillas personalizables con estructura padre/hijo
- Check de inicio y cierre de turno
- Estados: Verde (OK), Rojo (Con problema - observación obligatoria)
- **Historial completo:** Todos los usuarios ven todos los checklists del equipo
- Validación automática de servicios

### Escalaciones y contactos
- Directorio de contactos por cliente/servicio
- Matriz de escalación por nivel y horario
- Búsqueda rápida de contactos
- Gestión de clientes y servicios

### Reportes
- Vista general con estadísticas
- Exportación CSV de entradas y checklists
- Gráficos de actividad (tendencias, heatmap, tags, log sources)
- Accesible para usuarios autenticados

### Administración (Admin)
- **Catálogos:** Eventos, fuentes de logs, tipos de operación
- **Plantillas de Checklist:** Editor visual con preview
- **Configuración SMTP:** Email para notificaciones
- **Integraciones SIEM/SOAR/NDR:** Múltiples conectores en paralelo
- **GLPI:** Módulo independiente para configuración y pruebas
- **Backup/Restore:** Exportar e importar datos
- **Branding:** Logo y favicon
- **Tags:** Etiquetas personalizadas

### Notas
- **Nota del Admin:** Visible para todos (solo admin edita)
- **Nota Personal:** Privada de cada usuario
- Autosave automático

---

## Instalación rápida

```powershell
# 1. Backend
cd backend
npm install
# Copiar .env.example a .env y configurar MONGODB_URI
npm run seed    # Crear usuario admin inicial
npm start       # Puerto 3000

# 2. Frontend
cd frontend
npm install
npm start       # Puerto 4200
```

> **Importante:** Cambiar la contraseña del administrador después del primer login.

### Cuando no se reflejan cambios en local

En desarrollo local, no siempre necesitas `npm install`.

- `npm install`: úsalo solo si cambiaste dependencias (`package.json` o `package-lock.json`).
- `npm run build -- --configuration development`: fuerza compilación completa para validar que todo compile.
- `npm start`: levanta el servidor de desarrollo (watch mode) y toma cambios de código automáticamente.

Si hiciste cambios y no aparecen en pantalla:

```bash
# 1) Detener el servidor actual (Ctrl + C)

# 2) Verificar compilación limpia
cd frontend
npm run build -- --configuration development

# 3) Levantar nuevamente el frontend
npm start
```

Nota sobre backend:

- El backend no requiere compilación TypeScript/transpilación para correr.
- `cd backend && npm start` inicia directamente `node src/server.js`.
- `cd backend && npm run build` solo valida flujo (no genera artefactos).

Si aún persiste comportamiento extraño (cache/dependencias):

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm start
```

---

## Estructura del proyecto

```
BitacoraSOC/
|-- backend/              # API REST Express
|   |-- src/
|   |   |-- models/       # Modelos MongoDB (User, Entry, ChecklistTemplate, etc.)
|   |   |-- routes/       # Endpoints API
|   |   |-- middleware/   # Auth, validación, rate limiting
|   |   `-- utils/        # Logger, audit, encryption
|   |-- server.js         # Entry point
|   `-- package.json
|-- frontend/             # Angular 20 SPA
|   |-- src/app/
|   |   |-- pages/        # Componentes principales
|   |   |-- services/     # HTTP services
|   |   |-- models/       # Interfaces TypeScript
|   |   `-- guards/       # Protección de rutas
|   `-- package.json
`-- docs/                 # Documentación técnica detallada
```

---

## Despliegue con Docker (producción)

### Requisitos
- Docker 20.10+
- Docker Compose 2.0+

### Instalación

```bash
# 1. Clonar repositorio
git clone <repo-url>
cd BitacoraSOC

# 2. Configurar variables de entorno
cp .env.docker.example .env

# 3. Editar .env y cambiar:
#    - MONGO_ROOT_PASSWORD (contraseña MongoDB)
#    - JWT_SECRET (32+ caracteres aleatorios)
#    - ENCRYPTION_KEY (64 caracteres hex = 32 bytes)
#    - FRONTEND_PORT (puerto público, default: 80)

# 4. Generar secrets seguros (Linux/Mac)
openssl rand -base64 32  # Para JWT_SECRET
openssl rand -hex 32     # Para ENCRYPTION_KEY

# 5. Construir y levantar servicios
docker-compose up -d

# 6. Ver logs
docker-compose logs -f

# 7. Crear usuario administrador inicial
docker-compose exec backend npm run seed
```

### Servicios incluidos
- **Frontend:** Nginx sirviendo Angular (puerto configurable)
- **Backend:** Node.js + Express (puerto interno 3000)
- **MongoDB:** Base de datos con persistencia

### Volúmenes persistentes
- `mongodb_data`: Datos de la base de datos
- `mongodb_config`: Configuración interna de MongoDB
- `backend_uploads`: Logos y archivos subidos
- `backend_logs`: Logs del sistema (si se habilita salida a archivo)
- `backend_backups`: Backups JSON creados desde la API `/api/backup/*`

### Comandos útiles

```bash
# Ver estado
docker-compose ps

# Detener servicios
docker-compose stop

# Reiniciar servicios
docker-compose restart

# Ver logs de un servicio específico
docker-compose logs -f backend

# Backup de MongoDB
docker-compose exec mongodb mongodump --uri="mongodb://admin:PASSWORD@localhost:27017/bitacora_soc?authSource=admin" --out=/data/backup

# Actualizar servicios
docker-compose pull
docker-compose up -d --build

# Limpiar todo (¡cuidado! elimina volúmenes)
docker-compose down -v
```

---

## Documentación técnica

Para detalles técnicos completos, consulta:

- **[SETUP.md](docs/SETUP.md)**: Instalación y configuración avanzada
- **[API.md](docs/API.md)**: Referencia completa de endpoints
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**: Mapas conceptuales y flujos
- **[CHANGELOG.md](docs/CHANGELOG.md)**: Registro cronológico de cambios
- **[WORK-SHIFTS.md](docs/WORK-SHIFTS.md)**: Turnos y reportes por correo
- **[BACKUP.md](docs/BACKUP.md)**: Backups JSON, export e import
- **[SECURITY.md](docs/SECURITY.md)**: Seguridad, hardening y checklist
- **[CATALOGS.md](docs/CATALOGS.md)**: Sistema de catálogos y autocompletado
- **[ESCALATION.md](docs/ESCALATION.md)**: Módulo de escalaciones
- **[SCREENSHOTS.md](docs/SCREENSHOTS.md)**: Capturas de pantalla del sistema
- **[backend/scripts/README.md](backend/scripts/README.md)**: Importación masiva de datos

## Plantillas de correo (dónde están y cómo modificarlas)

El sistema usa más de una plantilla HTML, según el tipo de correo:

### 1) Reporte de cierre de turno (resumen con checklist + entradas)
- **Archivo:** `backend/src/utils/shift-report.js`
- **Función HTML:** `generateReportHTML(...)`
- **Función texto plano:** `generateReportText(...)`
- **Asunto del correo:** se arma con `replaceSubjectVariables(...)` usando `[fecha]`, `[turno]`, `[hora]`
- **Envío:** `sendShiftReport(...)` llama al servicio central `sendEmail(...)`

### 2) Correos SMTP de checklist y alertas (flujo legacy/directo)
- **Archivo:** `backend/src/routes/smtp.js`
- **Checklist enviado al guardar:** helper `sendChecklistEmail(...)`
- **Alerta por checklist no realizado:** helper `sendChecklistAlertEmail(...)`
- **Correo de prueba SMTP:** función `verifyAndTest(...)`

### 3) Servicio central de envío SMTP
- **Archivo:** `backend/src/utils/email.js`
- **Función principal:** `sendEmail({ to, subject, text, html, from })`
- **Qué hace:** lee configuración SMTP desde BD (`SmtpConfig` / fallback `AppConfig`), crea transporter y envía.

### Cómo modificar una plantilla (pasos recomendados)
1. Identifica primero qué correo quieres cambiar (reporte de turno vs checklist/alerta).
2. Edita el bloque HTML en el archivo correspondiente.
3. Si cambias estilos, prioriza estilos inline (`style="..."`) para compatibilidad en clientes de correo.
4. Mantén también versión `text` cuando exista (en reportes, `generateReportText`).
5. Prueba en entorno local:
   - Configura SMTP en `Settings > Configuración SMTP`.
   - Ejecuta un envío real de prueba desde el flujo afectado.
   - Verifica visualización en cliente claro y oscuro (web y móvil).

### Recomendación técnica de mantenimiento
- Extraer HTML a un módulo único de templates (por ejemplo `backend/src/utils/email-templates/`) para evitar duplicidad entre `shift-report.js` y `smtp.js`.
- Centralizar todos los envíos en `sendEmail(...)` para logging/auditoría homogénea.

## Capturas de pantalla

![Vista Principal](docs/images/screenshots/01-main-nueva-entrada.png)
*Pantalla principal con formulario de nueva entrada, notas y checklist de turno*

Ver más capturas en **[docs/SCREENSHOTS.md](docs/SCREENSHOTS.md)**:
- Pantalla principal con nueva entrada
- Vista de escalación y turnos semanales
- Búsqueda avanzada de entradas (78 entradas importadas)
- Generador de reportes HTML
- Panel de configuración administrativa
- Sistema de backup y restauración

---

## Changelog v1.1.0 (15-01-2026)

### Nuevas funcionalidades
- **Historial de Checklists:** Vista completa de todos los checklists del equipo (entrada/salida de turno)
- **Gestión de Usuarios:** Edición y activación/desactivación de cuentas
- **Reportes para Users:** Acceso a reportes de overview para usuarios normales
- **Docker Ready:** Configuración completa para despliegue en contenedores

### Correcciones
- Fix: Validación de IDs en servicios de checklist (generación automática de ObjectId)
- Fix: Normalización de items y children en plantillas al cargar checklist activo
- Mejora: Badges de estado con colores consistentes (admin: pink, user: blue, guest: orange)

### Docker
- Multi-stage builds para imágenes optimizadas
- Health checks en todos los servicios
- Persistencia con volúmenes (MongoDB, uploads, logs)
- Nginx optimizado con gzip y cache control
- Variables de entorno seguras con .env

---

## Issues y roadmap

El estado actual de bugs conocidos y tareas pendientes se mantiene en **[ISSUES.md](ISSUES.md)**.

## Licencia

Este proyecto se distribuye bajo la **Business Source License 1.1 (BSL 1.1)**.
Ver archivo **[LICENSE.md](LICENSE.md)** para más detalles sobre permisos de uso comercial y no comercial.

---

## Troubleshooting Docker (Permisos EACCES en /app/backups/temp)

Si ves este error en backend:
`Error: EACCES: permission denied, mkdir '/app/backups/temp'`

Causa:
- Volumen bind mount (`./.data/backups`) sin permisos de escritura para el usuario `nodejs` del contenedor (uid 1001).

Mitigación:
- Preparar permisos en host para los volúmenes bind usados por backend:
  - `./.data/backups`
  - `./.data/uploads`
  - `./.data/logs`

Recuperación manual (si ya está roto):
```bash
sudo chown -R 1001:1001 .data/backups .data/uploads .data/logs
sudo chmod -R ug+rwX .data/backups .data/uploads .data/logs
mkdir -p .data/backups/temp
docker compose up -d --build
```
