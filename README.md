# Bitacora SOC

Plataforma web para operacion SOC con bitacora operativa, checklists de turno, escalacion, auditoria, backup, integraciones y modulo de complementos embebidos.

> Estado del proyecto: beta. Validar siempre los flujos criticos en un entorno controlado antes de pasar a operacion formal.

Stack principal:

- frontend: Angular 20
- backend: Express 5 + Node 24
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

## Novedades recientes (resumen rapido)

### UX y operacion diaria

- `Ver guía rápida` ahora da feedback visual claro y desplazamiento automatico en modulos principales.
- chips de salud de servicios se muestran solo para `admin`, separados del toolbar y con mejor contraste.
- exportacion de auditoria ahora es mas clara (`N dias`, `N meses`, modo por filtros actuales).

### Report Generator / Boletines

- flujo dual consolidado (`Reporte Tecnico` / `Boletin de Seguridad`) en la misma pantalla.
- envio de boletin 1:1 por destinatario (sin CC/BCC masivo).
- precheck previo al envio (logo valido, secciones minimas, color legible).
- pegado enriquecido mejorado en campos de boletin (`Resumen`, `Impacto`, `Mitigacion`, `Referencias`) para evitar texto corrido sin estructura.

### Seguridad y estabilidad

- backend robustecido en configuracion SMTP (compatibilidad con config legacy y mensajes de error accionables).
- trazabilidad de reintentos SMTP/GLPI en auditoria (`retryAttempt`, `retryCount`).
- sincronizacion de indices criticos en Mongo al arranque (incluye TTL de auditoria).

### IA local (estado actual)

- planificacion avanzada de `AI-SUMMARY-001` documentada en `docs/ISSUES.md`.
- alcance confirmado: IA sin chat con usuario final; analisis de eventos del turno -> resumen sugerido -> envio por correo + trazabilidad operativa.
- estado: preparacion/documentacion, sin activacion productiva aun.

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

Acceso por defecto:

- frontend Docker: `http://localhost`
- backend health: `http://localhost:3000/health`
- Swagger: `http://localhost:3000/api-docs`

Notas rapidas:

- el proyecto usa `docker compose`, no `docker-compose`
- el overlay `docker-compose.complements.yml` es opcional y hoy sirve principalmente para el `complement-stub` de laboratorio
- los scripts `scripts/compose-up.*` y `scripts/compose-rebuild.*` ya incluyen ese overlay

---

## Desarrollo local

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm start
```

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
- `docs/API.md`: referencia de endpoints
- `docs/ARCHITECTURE.md`: arquitectura y flujos
- `docs/DEPLOY.md`: despliegue, actualizacion y operacion
- `docs/SETUP.md`: instalacion y configuracion detallada
- `docs/SECURITY.md`: hardening, auth, rate limiting y secreto `RATE_LIMIT_RESET_SECRET` (reinicio operativo de 429)
- `docs/RUNBOOK.md`: operacion diaria del SOC
- `docs/BACKUP.md`: backup, restore e implicancias para complementos
- `docs/TROUBLESHOOTING.md`: diagnostico de fallas comunes
- `docs/CHANGELOG.md`: cambios relevantes por version

Documentos funcionales complementarios:

- `docs/WORK-SHIFTS.md`
- `docs/ESCALATION.md`
- `docs/CATALOGS.md`
- `docs/LOGGING.md`
- `backend/scripts/README.md`

---

## Licencia

El proyecto se distribuye bajo Business Source License 1.1. Revisar `LICENSE.md` para el detalle formal.
