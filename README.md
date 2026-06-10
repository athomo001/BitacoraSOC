# Bitacora SOC

<!-- Marca de autor en comentarios: Athan Espinoza -->

Plataforma web para operacion SOC con bitacora operativa, checklists de turno, escalacion, auditoria, backup, integraciones y modulo de complementos embebidos.

> Estado del proyecto: beta. Validar siempre los flujos criticos en un entorno controlado antes de pasar a operacion formal.
>
> Version referencial actual (segun `docs/history/CHANGELOG.md`): **v1.5.94-beta**

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

## Comparativa con herramientas similares

| Característica / Enfoque | Bitácora SOC | TheHive / Cortex |
| :--- | :--- | :--- |
| **Objetivo Principal** | Registro del turno, control de inicio/cierre de analistas y continuidad operacional. | Gestión profunda de incidentes, triage de malware e investigación forense. |
| **Gobernanza del Turno** | **Sí** (Checklist de inicio/cierre con cooldown por turno. Opera como indicador de cumplimiento/KPI operativo y de preparación diaria). | No (Se enfoca en incidentes individuales, sin controles de guardia ni KPIs de cumplimiento diario). |
| **Gestión Operativa y de Equipo** | **Automatización Interna** (Generación automática de minutas/informes de turno para N2 o superiores con lo que pasó en el turno, notificaciones automáticas de turnos a otras áreas, visibilidad en tiempo real de quién está en teletrabajo/vacaciones en el área, y estadísticas de uso del SOC abiertas a todo el equipo). | **Gestión de Casos** (No gestiona dotación de personal, estado presencial de analistas, turnos de guardia, minutas de relevo ni estadísticas operativas del equipo). |
| **Enfoque de Escalación** | **Humana y Organizacional** (Directorio de contactos, matriz RACI, y flujos definidos de quién llamar o enviar correos ante incidentes). | **Técnica y Automatizada** (Orquestación mediante Cortex para análisis de IOCs y acciones automatizadas en sistemas). |
| **Flexibilidad de Entrada** | **Bitácora general y libre** (Permite anotar incidentes, pero también tareas de mantenimiento, bitácora de guardias de seguridad o eventos de rutina. Clasificación rápida por hashtags `#` para búsquedas inmediatas). | **Estructurada y Rígida** (Enfocada estrictamente en casos de incidentes, tareas asignadas, logs de auditoría técnica y observables). |
| **Búsqueda y Respaldos** | **Histórico y Narrativo Humano** (Búsqueda por texto y hashtags del relato redactado por el analista. Diseñado como respaldo legal e histórico de lo que pasó en el turno, no orientado a correlación automatizada). | **Técnico y Basado en IOCs** (Búsqueda técnica de observables e indicadores de compromiso correlacionables y estructurados en bases como MISP). |
| **Reportes y Clientes** | Generador de boletines y reportes ejecutivos. Permite exportar reportes como imágenes para respaldar o enviar directamente a clientes, con unificación opcional de destinatarios por dominio. | No (Requiere herramientas complementarias para reportes de cara al cliente). |
| **Herramientas de Analista** | **Complementos Flexibles** (Módulo de plugins embebidos en iframe para cualquier utilidad del analista que no pertenezca estrictamente a la bitácora: traductores de logs, explicaciones de comandos Linux, o incluso entretenimiento como DOOM). | **Análisis Técnico Estricto** (Integración exclusiva con Cortex para consulta automatizada de reputación e inteligencia de amenazas sobre IOCs). |
| **Tematización y Apariencia** | **Optimización para Turnos** (Múltiples temas como Cyberpunk, Matrix, Sepia, etc., diseñados para reducir la fatiga visual de analistas y personal de guardia en turnos de 12/24 horas, además de branding personalizado de logos). | **Estándar** (Interfaz visual rígida con soporte básico de modo claro/oscuro). |
| **Respaldos y Resiliencia** | **Respaldos Completos Cifrados** (Módulo integrado en UI para crear, restaurar y descargar backups cifrados con AES-256/PBKDF2 que incluyen base de datos, archivos de evidencias y secretos de configuración). | **De Infraestructura** (Delegado a herramientas externas de base de datos o scripts del administrador de sistemas). |
| **Curva de Aprendizaje** | Baja/Inmediata (Diseñado para el operador de primer nivel N1 o personal de guardia). | Alta (Diseñado para analistas de incidentes N2/N3 y cazadores de amenazas). |

---

## Vista rapida de la interfaz

Galeria visual resumida del producto. Para ver el set completo, revisa `docs/SCREENSHOTS.md`.

### Pantallas principales

![Pantalla principal](docs/images/screenshots/01-main-nueva-entrada.png)

![Generador de reportes](docs/images/screenshots/04-generador-reportes.png)
![Generador de reportes](docs/images/screenshots/04.1-generador-reportes.png?v=1)
![Generador de reportes](docs/images/screenshots/04.2-generador-reportes.png?v=1)

![Configuracion administrativa](docs/images/screenshots/05-menu-configuracion.png)
![Configuracion administrativa](docs/images/screenshots/05.1-menu-configuracion.png?v=1)

![Modulo de Turnos](docs/images/screenshots/11-Turnos.png?v=1)

![Modulo de backup](docs/images/screenshots/06-menu-admin-backup.png)

---

## Novedades recientes (resumen rapido)

### v1.5.94-beta (seguridad, MFA, SSO, PII y robustez)

- **MFA (TOTP):** Autenticación multifactor por software configurable por usuario (activable por administrador) con enrolamiento de código QR.
- **SSO Google/Microsoft:** Soporte integrado de Single Sign-On para proveedores corporativos mediante variables de entorno.
- **Cifrado de PII:** Almacenamiento seguro AES-256-GCM para datos personales (email, teléfono) en BD y hashes deterministas SHA-256 para búsquedas rápidas.
- **Cifrado de Backups:** Opción de cifrar respaldos con contraseña en UI y descifrado en caliente al importar.
- **Zip Slip y Sanitización CSV:** Mitigaciones contra path traversal en restauración de copias de seguridad y prevención de inyección de fórmulas en reportes CSV.
- **Restricciones del Rol Auditor:** Implementación de lista blanca para restringir backups, envíos de correo y datos sensibles al rol Auditor e Invitado.
- **Segregación de Checklists por Turno:** Soporte para ejecuciones de checklist en paralelo agregando el campo `shiftId`.

### v1.5.93-beta (permisos de asignaciones y tabla de teletrabajo)

- nueva ruta publica `GET /api/escalation/assignments` para que analistas autenticados consulten asignaciones sin requerir rol admin.
- separados los metodos `getAssignments()` (vista operativa) y `getAssignmentsAdmin()` (administracion de turnos) en el servicio frontend para evitar errores `403`.
- estilos CSS completos para la tabla `excel-table` en la vista operativa: fila completa en rojo para vacaciones activas, azul para pronto-vacaciones.

### v1.5.92-beta (teletrabajo y vacaciones en administracion de turnos)

- roles `TELEWORK` y `VACATION` disponibles en el formulario de asignacion de `/main/admin/work-shifts`.
- validacion de conflictos adaptativa: teletrabajo coexiste con turnos regulares; vacaciones dispara autoliberacion de turnos previos en backend.
- notificacion al guardar vacaciones si se liberaron turnos automaticamente.
- etiquetas en espanol en tabla, Gantt y tarjetas de proximidad.
- importacion CSV acepta `Teletrabajo` y `Vacaciones` como roles validos.

### v1.5.91-beta (UX y tabla de teletrabajo escalable)

- autocomplete de clientes sin necesidad de borrar texto ni presionar X; el panel despliega todos los clientes si el valor actual ya coincide exactamente con la seleccion.
- tabla escalable para el listado de personal en teletrabajo y apoyo con columnas Nombre, Correo (copiable), Telefono (copiable), Cargo y Situacion con badges de color.
- soporte de estados: En Teletrabajo, En Oficina, VACACIONES (rojo), Pronto Vacaciones (azul, dentro de 2 semanas).

### v1.5.89-beta (auditoria QA y UX/UI)

- ajuste de contraste en flujo de recuperacion de contrasena en tema Matrix.
- aviso de privacidad con branding dinamico desde la base de datos; consentimiento persistente en `localStorage`.
- rediseno asimetrico de la vista de backups con layout de dos columnas.
- easter egg `#bat` con HUD cyberpunk y mecanica de caceria interactiva.
- correccion de texto borroso en el panel central (remocion de `will-change: transform`).
- limites de recursos CPU/RAM en `docker-compose.yml` para todos los contenedores.
- refactorizacion de helpers duplicados: `cookie-helper.js`, `boolean-helper.js`, `time-helper.js`, `date-utils.js`.
- cierre de hallazgos de auditoria de seguridad: JWT denylist, rate-limit en MongoDB, CORS estricto, guards robustecidos.

### v1.5.88-beta (ortografia y v1.5.87 / historial compartido)

- correccion masiva de tildes y acentos en la UI (labels, placeholders, snackbars).
- historial de reportes/boletines migrado a backend compartido para que todos los usuarios autenticados vean los envios del equipo.
- borrado de historial restringido a rol admin.

### v1.5.86-beta (hora oficial del servidor en turnos)

- la vista de turnos semanales ahora usa hora oficial del backend como fuente de verdad.
- el endpoint `GET /api/work-shifts/current` entrega `currentDateTime` y `currentTimestamp` para sincronizacion temporal robusta.
- el Gantt calcula linea de dia actual y estados (`Pasado`, `En Curso`, `Proximo`) con tiempo de servidor.

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
#    - (Opcional) GOOGLE_CLIENT_ID / AZURE_CLIENT_ID / AZURE_TENANT_ID (para SSO)
#    - (Opcional) RATE_LIMIT_RESET_SECRET — reinicio de rate limit; ver docs/06_SEGURIDAD.md

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

Documentos principales (Gobernanza Armonizada):

- `docs/01_ARQUITECTURA.md`: Arquitectura del sistema, flujos Mermaid y diseño de TLS/SSL.
- `docs/02_DESPLIEGUE_Y_CONFIG.md`: Guía de instalación, variables de entorno (.env) y despliegue con Docker Compose.
- `docs/03_OPERACIONES.md`: Guía operativa general, bitácoras, checklists de turno, roles de usuario, backup/restore y runbook del SOC.
- `docs/04_DESARROLLO_Y_API.md`: Documentación de la API REST, Swagger y endpoints integrados.
- `docs/05_MODULOS_EXTRAS.md`: Gestión e integración del módulo de complementos e iframe sandbox.
- `docs/06_SEGURIDAD.md`: Hardening, Helmet, rate limiting, mitigación de Zip Slip y directivas de seguridad.
- `docs/SCREENSHOTS.md`: Galería visual de la interfaz y módulos principales.
- `docs/history/CHANGELOG.md`: Historial de cambios relevantes por versión.
- `docs/history/ISSUES.md`: Plan de trabajo y control de issues del SOC.

Documentos funcionales complementarios:

- `docs/UI-GOVERNANCE.md`: Estándares de desarrollo de interfaz y componentes.

---

## Licencia

El proyecto se distribuye bajo Business Source License 1.1. Revisar `LICENSE.md` para el detalle formal.
El archivo incluye el texto base en ingles y una seccion informativa en espanol para facilitar su lectura.
