# Bitacora SOC

<!-- Marca de autor en comentarios: Athan Espinoza -->

Plataforma web para operacion SOC con bitacora operativa, checklists de turno, escalacion, auditoria, backup, integraciones y modulo de complementos embebidos.

> Estado del proyecto: beta. Validar siempre los flujos criticos en un entorno controlado antes de pasar a operacion formal.
>
> Version referencial actual (segun `docs/CHANGELOG.md`): v1.5.82-beta

Stack principal:

- frontend: Angular 20
- backend: Express 5 + Node 22 LTS
- base de datos: MongoDB 8
- despliegue: Docker Compose v2

---

## Capacidades principales

- bitacora de entradas operativas, incidentes y ofensas
- checklists de inicio y cierre de turno
- consola admin unificada
- auditoria persistente y forwarding a SIEM
- backups y restore desde la plataforma
- branding, SMTP, catalogos y escalacion
- complementos con iframe seguro, API interna y circuit breaker

---

## Vista rapida de la interfaz

Galeria visual resumida del producto. Para ver el set completo, revisa `docs/SCREENSHOTS.md`.

### Pantallas principales

![Pantalla principal](docs/images/screenshots/01-main-nueva-entrada.png)

![Generador de reportes](docs/images/screenshots/04-generador-reportes.png)

![Configuracion administrativa](docs/images/screenshots/05-menu-configuracion.png)

![Modulo de backup](docs/images/screenshots/06-menu-admin-backup.png)

---

## Novedades recientes (resumen rapido)

### v1.5.82-beta (seguridad y hardening)

- cierre de auditoria de seguridad con mitigaciones de severidad media.
- invalidacion de JWT en logout via denylist persistente en MongoDB.
- eventos forenses de autorizacion denegada (`auth.authorize.fail`) en auditoria.
- rate-limit centralizado en Mongo para escenarios multi-contenedor/multi-replica.
- CORS mas estricto y reducción de superficie para payloads grandes.
- validacion de archivos reforzada para logos/favicons (MIME + estructura interna).

### v1.5.81-beta y v1.5.80-beta (UX reportes y catalogos)

- simplificacion del flujo de destinatarios en boletines/incidentes desde el panel lateral.
- bloqueo de conflictos entre `Para` y `CC` con validacion y feedback inmediato en UI.
- reordenamiento del formulario de reporte de incidentes para captura mas rapida.
- actualizacion de nomenclatura en admin a **Clientes y Catalogos** y reorden operativo de pestanas.

### v1.5.79-beta a v1.5.77-beta (turnos semanales)

- migracion de gestion de turnos semanales hacia `/main/admin/work-shifts`.
- dashboard de turnos con resumen tipo Gantt, proximos turnos y editor lateral.
- timeline extendido para dar visibilidad anticipada de la proxima semana.
- mejoras de selector TI y barras de progreso de turnos proximos.

### Estado IA local

- alcance definido en `docs/ISSUES.md` (epic `AI-SUMMARY-001` y subitems).
- IA planteada como asistencia operativa efimera y controlada (sin chat de usuario final).
- estado actual: planificado/documentado, no activado en produccion.

---

## Quick Start con Docker

```bash
# 1. Preparar variables
cp .env.example .env

# 2. Editar credenciales obligatorias
#    - MONGO_ROOT_PASSWORD
#    - ADMIN_PASSWORD
#    - JWT_SECRET
#    - ENCRYPTION_KEY
#    - COMPLEMENT_TOKEN_SECRET
#    - (Opcional) RATE_LIMIT_RESET_SECRET — cadena >= 24 caracteres para reinicio
#      de contadores 429 sin reiniciar el backend; formato y uso en docs/SECURITY.md

# 3. Levantar stack
docker compose up -d --build

# 4. Inicializar datos base
docker compose exec backend node src/scripts/seed-admin.js
# o, si necesitas ambiente de prueba:
docker compose exec backend node src/scripts/seed.js
```

## Inicio rapido

si ya esta descargado y solo resta levantar

```bash
docker compose build --no-cache && docker compose up -d
```

Para actualizar

```bash
git pull origin main && docker compose build --no-cache && docker compose up -d
```

Acceso por defecto:

- frontend Docker: `http://localhost`
- backend health: `http://localhost:3000/health`
- Swagger: `http://localhost:3000/api-docs`

Notas rapidas:

- el proyecto usa `docker compose`, no `docker-compose`
- el overlay `docker-compose.complements.yml` es opcional y hoy sirve principalmente para el `complement-stub` de laboratorio
- los scripts `scripts/compose-up.*` y `scripts/compose-rebuild.*` ya incluyen ese overlay

Diagnostico rapido si backend no levanta:

```bash
# Estado general
docker compose ps

# Logs del backend y Mongo
docker compose logs backend --tail=200
docker compose logs mongodb --tail=120

# Rebuild completo cuando cambian dependencias
docker compose up -d --build
```

Si ves errores de modulo faltante en backend durante arranque, ejecuta rebuild para forzar reinstalacion de dependencias de la imagen.

---

## Desarrollo local

### Backend

```bash
cd backend
cp .env.example .env
pnpm install
pnpm run dev
```

### Frontend

```bash
cd frontend
pnpm install
pnpm start
```

Politica de gestor de paquetes:

- Este repositorio usa exclusivamente `pnpm@11`.
- No usar `npm` para instalar o ejecutar scripts.
- Ver detalles en `docs/PNPM_POLICY.md`.

Acceso local:

- frontend dev: `http://localhost:4200`
- backend dev: `http://localhost:3000`

El frontend actual usa cookie `auth_token` HttpOnly y bootstrap de sesion via `/api/users/me`, por lo que el backend debe tener `ALLOWED_ORIGINS=http://localhost:4200` en desarrollo.

---

## Complementos

El modulo de complementos soporta hoy dos caminos productivos:

1. registro manual de un servicio o frontend ya desplegado
2. publicacion administrada de un ZIP estatico `HTML/JS simple`

El flujo `validar -> preview -> publicar` ya existe en la consola admin, pero la publicacion automatica hoy solo soporta `static-html`. Los stacks `Vite`, `React + Vite` y `Node.js` se analizan, pero deben desplegarse por fuera y luego registrarse manualmente.

El detalle completo esta en `docs/COMPLEMENTS.md`.

### Complementos en `Extras/`

La carpeta `Extras/` incluye complementos y muestras listos para laboratorio, QA o publicacion como `zip-static`:

- `Extras/doom-browser/`: complemento estatico para ejecutar DOOM en navegador embebido.
- `Extras/diccionario-logs-ciber/`: complemento estatico tipo log helper/diccionario tecnico para analisis SOC.
- `Extras/complement-stub/`: stub minimo de complemento para pruebas de integracion con Docker.
- `Extras/complement-samples/`: ejemplos de referencia (`no-db-static`, `internal-db-local`, `external-db-api`) para acelerar nuevos desarrollos.
- `Extras/Imagenes/`: capturas de apoyo de herramientas/complementos para documentacion operativa.

El catalogo de los complementos de prueba (con imagen y descripcion breve) esta en `docs/COMPLEMENTS_CATALOG.md`.

---

## Estructura del repositorio

```text
BitacoraSOC/
|- backend/                  API Express, modelos, rutas, utilidades
|- frontend/                 SPA Angular
|- docs/                     Documentacion tecnica y operativa
|- scripts/                  Scripts de apoyo para compose y versionado
|- docker-compose.yml        Stack principal
|- docker-compose.complements.yml
`- .env.example             Plantilla de variables globales
```

---

## Documentacion

Documentos principales:

- `docs/OPERATIONS.md`: como levantar desde cero, semillas y validaciones operativas
- `docs/DISASTER-RECOVERY.md`: plan de recuperacion total ante desastre
- `docs/COMPLEMENTS.md`: guia integral del modulo de complementos
- `docs/COMPLEMENTS_CATALOG.md`: catalogo de complementos de prueba (doom-browser, diccionario-logs-ciber)
- `docs/API.md`: referencia de endpoints
- `docs/ARCHITECTURE.md`: arquitectura y flujos
- `docs/DEPLOY.md`: despliegue, actualizacion y operacion
- `docs/SETUP.md`: instalacion y configuracion detallada
- `docs/SECURITY.md`: hardening, auth, rate limiting y secreto `RATE_LIMIT_RESET_SECRET` (reinicio operativo de 429)
- `docs/RUNBOOK.md`: operacion diaria del SOC
- `docs/BACKUP.md`: backup, restore e implicancias para complementos
- `docs/TROUBLESHOOTING.md`: diagnostico de fallas comunes
- `docs/SCREENSHOTS.md`: galeria visual de la interfaz y modulos principales
- `docs/CHANGELOG.md`: cambios relevantes por version

Documentos funcionales complementarios:

- `docs/ESCALATION.md`: escalacion, directorio global, agenda preventiva y turnos
- `docs/CATALOGS.md`
- `docs/LOGGING.md`
- `docs/TLS_SSL_ARCHITECTURE.md`
- `docs/UI-GOVERNANCE.md`
- `backend/scripts/README.md`

---

## Licencia

El proyecto se distribuye bajo Business Source License 1.1. Revisar `LICENSE.md` para el detalle formal.
El archivo incluye el texto base en ingles y una seccion informativa en espanol para facilitar su lectura.
