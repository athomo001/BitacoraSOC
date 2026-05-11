# Bitacora SOC

<!-- Marca de autor en comentarios: Athan Espinoza -->

Plataforma web para operacion SOC con bitacora operativa, checklists de turno, escalacion, auditoria, backup, integraciones y modulo de complementos embebidos.

> Estado del proyecto: beta. Validar siempre los flujos criticos en un entorno controlado antes de pasar a operacion formal.
>
> Version referencial actual: 1.5.68-beta

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

### v1.5.68-beta

- backup ZIP endurecido para operacion real: importacion por archivo hasta `100M`, soporte correcto de `clearBeforeRestore`, historial de fechas robusto y restauracion fisica de `uploads`, `secrets` y `global`.
- purge total mas seguro: al limpiar la plataforma se recrea automaticamente la cuenta admin por defecto definida en `.env`.
- SMTP puede quedar desactivado sin borrar host/usuario/credenciales; al reactivar se reutiliza la password cifrada almacenada cuando corresponde.
- el Directorio Global ahora edita contactos existentes inline en la misma fila, evitando volver al inicio de la pagina en listas largas.

### v1.5.47-beta

- correcciones visuales en temas Dark y Cyberpunk para checklist history, sidebar y acordeones laterales.
- tipografia cyberpunk ajustada para uso operativo real: menos ruido visual y mejor lectura.
- pantalla de backups depurada con textos mas cortos y encabezado mas limpio.
- stack Docker estabilizado con imagen base Node 22 Alpine para frontend y backend.

### UX y operacion diaria

- `Ver guía rápida` ahora da feedback visual claro y desplazamiento automatico en modulos principales.
- chips de salud de servicios se muestran solo para `admin`, separados del toolbar y con mejor contraste.
- exportacion de auditoria ahora es mas clara (`N dias`, `N meses`, modo por filtros actuales).

### Report Generator / Boletines

- flujo dual consolidado (`Reporte Tecnico` / `Boletin de Seguridad`) en la misma pantalla.
- envio de boletin 1:1 por destinatario, con `CC` interno opcional compartido por cada correo individual.
- selector rapido de destinatarios desde agenda preventiva y panel dedicado de listas de correo para casillas grupales.
- precheck previo al envio (logo valido, secciones minimas, color legible).
- pegado enriquecido mejorado en campos de boletin (`Resumen`, `Impacto`, `Mitigacion`, `Referencias`) para evitar texto corrido sin estructura.

### Seguridad y estabilidad

- backend robustecido en configuracion SMTP (compatibilidad con config legacy, switch activo/inactivo y mensajes de error accionables).
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

- `docs/WORK-SHIFTS.md`
- `docs/ESCALATION.md`: escalacion, directorio global, agenda preventiva y turnos
- `docs/CATALOGS.md`
- `docs/LOGGING.md`
- `backend/scripts/README.md`

---

## Licencia

El proyecto se distribuye bajo Business Source License 1.1. Revisar `LICENSE.md` para el detalle formal.
El archivo incluye el texto base en ingles y una seccion informativa en espanol para facilitar su lectura.
