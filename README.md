# Bitacora SOC

<!-- Marca de autor en comentarios: Athan Espinoza -->

Plataforma web para operacion SOC con bitacora operativa, checklists de turno, escalacion, auditoria, backup, integraciones y modulo de complementos embebidos.

> Estado del proyecto: estable. Validar siempre los flujos en un entorno de pruebas antes de pasar a operación formal.
>
> Version referencial actual (segun `docs/history/CHANGELOG.md`): **v1.6.10**

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

| Característica / Enfoque          | Bitácora SOC                                                                                                                                                                                  | TheHive / Cortex                                                                                    | ITSM / Ticketing Genérico (JSM, ServiceNow, GLPI, etc.)                                                                    |
| :-------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Objetivo Principal**            | Continuidad operacional por turno: qué pasó, quién lo tomó, qué quedó pendiente y a quién llamar.                                                                                             | Gestión de incidentes de ciberseguridad e investigación técnica profunda (IOC, forense, respuesta). | Gestión de solicitudes/incidentes de servicio con trazabilidad administrativa y SLA.                                       |
| **Centro de Gravedad**            | **Operación en tiempo real y relevo de guardia** (SOC, NOC, TI on-call y equipos de emergencia).                                                                                              | **Investigación de amenazas** y respuesta técnica especializada orientada a la ciberseguridad.      | **Proceso de atención** (tickets, colas, aprobaciones, catálogo de servicios).                                             |
| **Naturaleza de la Escalada**     | **Humana y directa**: la bitácora documenta a quién llamar, qué equipo contactar y qué ruta seguir; no depende de un ticket para disparar la ayuda inmediata.                                 | **Técnica y orientada a caso**: prioriza el análisis y la orquestación sobre la llamada operativa.  | **Automática por flujo de atención**: el ticket se enruta al área o cola definida y puede escalarse por reglas de proceso. |
| **Gobernanza del Turno**          | **Sí** (checklist de inicio/cierre, segregación por `shiftId`, métricas de cumplimiento y disciplina operativa diaria).                                                                       | No nativo (el foco está en casos; no en rituales de apertura/cierre de guardia).                    | Parcial (se puede modelar con customización, pero no suele venir listo como flujo operativo de relevo).                    |
| **Gestión Operativa y de Equipo** | **Sí** (minutas/informes de turno, visibilidad de teletrabajo/vacaciones, asignaciones internas y recordatorios automatizados).                                                               | No orientado a dotación y coordinación de guardias.                                                 | Parcial (fuerte en asignación de tickets; más débil en vista táctica de dotación en turno).                                |
| **Analíticas y KPI Operativos**   | **Sí** (métricas de uso por usuario, volumen de entradas, acciones registradas, alertas atendidas y trazabilidad de actividad para medir disciplina operativa).                               | Enfoque más orientado a casos e investigación que a KPI de relevo diario.                           | Sí, pero centradas en SLAs, colas y tiempos de atención, no en bitácora de turno.                                          |
| **Alertas y Confirmaciones**      | **Sí** (avisos para checklist, alertas NOK, recordatorios y alertas por cliente; el usuario puede confirmar lectura/cierre cuando corresponda y volver a cerrarlas según el flujo operativo). | Sí, pero orientadas a incidentes/casos de seguridad.                                                | Sí, normalmente mediante notificaciones y estados del ticket.                                                              |
| **Flexibilidad de Entrada**       | **Alta** (bitácora narrativa con hashtags para incidentes, mantenimiento, guardias físicas y operación multiárea).                                                                            | Media-baja (estructura centrada en caso de ciber).                                                  | Media (campos estructurados y formularios; menos natural para narrativa cronológica de guardia).                           |
| **Modelo de Datos Operativo**     | **Evento + narrativa + checklist + auditoría** (prioriza contexto de turno, continuidad entre personas y seguimiento de acciones).                                                            | **Caso + observable + tarea** (prioriza investigación y evidencia técnica).                         | **Ticket + estado + SLA** (prioriza ciclo de vida de atención).                                                            |
| **Búsqueda y Trazabilidad**       | Búsqueda textual/narrativa por contenido y hashtags, útil para reconstrucción operativa y respaldo histórico.                                                                                 | Búsqueda técnica por observables/IOCs para correlación de amenazas.                                 | Búsqueda por ticket, campos, estados y reportes de servicio.                                                               |
| **Reportes y Comunicación**       | Boletines/reportes ejecutivos con envío por correo, agrupación por dominio y historial de envíos para saber cuándo se avisó a clientes o equipos.                                             | Requiere capas adicionales para reporteo ejecutivo orientado a cliente.                             | Muy fuerte en reportes de servicio/SLA; menos enfocado en narrativa de relevo de guardia.                                  |
| **Auditoría y Cumplimiento**      | Auditoría persistente transversal (acciones operativas y administrativas) + control de acceso por roles (admin/user/auditor/guest).                                                           | Auditoría orientada a investigación y acciones sobre casos.                                         | Auditoría administrativa madura, generalmente centrada en proceso ITSM.                                                    |
| **Resiliencia y Backups**         | Backups/restores desde UI con cifrado y alcance integral (BD + evidencias + secretos).                                                                                                        | Normalmente delegado a estrategia de infraestructura/plataforma.                                    | Depende del producto y plan; suele manejarse a nivel plataforma/instancia.                                                 |
| **Extensibilidad del Operador**   | Complementos embebidos con sandbox, bridge de contexto y circuit breaker para utilidades de terreno.                                                                                          | Extensible a través de integraciones orientadas a seguridad.                                        | Marketplace e integraciones robustas, usualmente orientadas a flujos ITSM corporativos.                                    |
| **Cobertura de Dominio**          | **SOC-first pero no SOC-only**: también aplica a NOC, mesas TI, guardias físicas y equipos con múltiples escalamientos/monitoreo.                                                             | **Ciberseguridad-first y especializada**.                                                           | **Empresa-first y transversal**, con foco en gobierno de servicios más que en bitácora de turno.                           |
| **Curva de Aprendizaje**          | Baja a media (entrada rápida para N1/operador de guardia, con crecimiento progresivo).                                                                                                        | Media-alta (perfil analista de seguridad N2/N3).                                                    | Media (requiere adopción de procesos y configuración de catálogo/flujo).                                                   |

---

## Vista rapida de la interfaz

Galeria visual resumida del producto. Para ver el set completo, revisa `docs/SCREENSHOTS.md`.

### Pantallas principales

![Pantalla principal](docs/images/screenshots/01-main-nueva-entrada.png)

![Pantalla de Login Retro CRT](docs/images/screenshots/13.1-Login.png)

![Generador de reportes](docs/images/screenshots/04-generador-reportes.png)
![Generador de reportes](docs/images/screenshots/04.1-generador-reportes.png?v=1)
![Generador de reportes](docs/images/screenshots/04.2-generador-reportes.png?v=1)

![Configuracion administrativa](docs/images/screenshots/05-menu-configuracion.png)
![Configuracion administrativa](docs/images/screenshots/05.1-menu-configuracion.png?v=1)

![Modulo de Turnos](docs/images/screenshots/11-Turnos.png?v=1)

![Modulo de backup](docs/images/screenshots/06-menu-admin-backup.png)

![Configuración de Seguridad (HTTPS & SSO)](docs/images/screenshots/15-HTTPS-SSO.png)

> 💡 **Nota sobre la Consola de Seguridad (HTTPS & SSO):** El panel unificado de HTTPS y Single Sign-On (SSO) está completamente integrado. El soporte para la inyección y rotación de certificados **HTTPS** (0-Downtime) es altamente funcional y estable, mientras que el inicio de sesión vía SSO (Google/Microsoft) está disponible como opción de autenticación.

---

## Novedades recientes (resumen rapido)

### v1.6.10 (confirmación visual mejorada y notificación de cambio de contraseña a usuarios internos)

- **Diálogo de Confirmación Bonito**: Rediseño del componente de confirmación con ícono contextual, tipografía clara, botones visibles y bloqueo de cierre accidental. Reemplaza completamente los `alert()` nativos de JavaScript.
- **Mensaje Explícito de Forzado Masivo**: El diálogo de confirmación en `/main/admin/users` ahora comunica que se enviará correo a todos los usuarios internos. Botón: "Sí, Forzar y Notificar".
- **Notificación por Correo a Usuarios Internos**: Cuando el administrador ejecuta "Forzar Cambio Masivo", el sistema envía automáticamente un correo individual a cada usuario interno activo (admin, user, auditor) informando que debe cambiar su contraseña en el próximo ingreso. Se registran métricas de envío en auditoría (enviados, fallidos).

### v1.6.09 (obligatoriedad de cumpleaños, contraseña forzada y felicitaciones con CIDs)

- **Forzado de Cambio de Contraseña**: Capacidades para exigir el restablecimiento de contraseñas de forma individual o masiva a todos los usuarios del sistema. Bloqueo reactivo total mediante un formulario de configuración inicial obligatoria de contraseña y fecha de cumpleaños.
- **Automatización de Correos de Cumpleaños**: Scheduler diario (`birthdayEmailScheduler.js`) para el envío automático de felicitaciones en formato HTML en base a la hora de envío local configurada.
- **Solución a Imágenes Rotas (MIME Inline + CID)**: Reestructuración de la lógica de envío de correos para adjuntar la ilustración kawaii (`birthday_kawaii.png`) y el logotipo de branding en línea mediante Content-ID (CID). Movimiento de la ilustración a los recursos estáticos del código (`src/assets/branding/`) para evitar enmascaramientos del volumen de Docker uploads.
- **Optimización y Testabilidad del Programador**: Disminución del intervalo de comprobación a 2 minutos y reinicio del bloqueo del envío diario de hoy de forma transparente cuando el administrador modifica la hora de envío o reactiva el servicio.

### v1.6.08 (actualización a pnpm 11.7.0 y dependencias)

- **Migración a pnpm v11.7.0:** Actualización del gestor de paquetes de la v11.0.0 a la v11.7.0 y dependencias en frontend y backend.
- **Habilitación de compilaciones con allowBuilds:** Migración de la directiva obsoleta `onlyBuiltDependencies` hacia el nuevo esquema `allowBuilds` en los archivos `pnpm-workspace.yaml` de ambos componentes, permitiendo compilación nativa de dependencias críticas en entornos Docker.

### v1.6.07 (prevención de caché y recarga automática ante actualizaciones)

- **Prevención de Caché en index.html (Nginx):** Configuración de directivas `Cache-Control` en Nginx (puertos 80 y 443) para servir el archivo `index.html` con `no-cache, no-store, must-revalidate`. Esto garantiza que los navegadores web obtengan de inmediato el nuevo frontend al subir cambios, mientras los archivos estáticos hasheados siguen usando caché persistente.
- **Recarga Automática en Caliente (Angular):** Implementación de un `GlobalErrorHandler` que detecta fallas al importar módulos perezosos descatalogados en caliente (`ChunkLoadError`) tras un despliegue de Docker, forzando un refresco transparente para el operador sin cerrar su sesión (manteniendo cookie JWT).

### v1.6.06 (permisos de directorio para N1 y flexibilización de contraseñas de admin)

- **Escritura en Directorio para Analistas N1:** Habilitación de permisos en backend y frontend para que los analistas N1 puedan crear, modificar e importar contactos (CSV) en el Directorio Central. La eliminación permanece bloqueada únicamente para perfiles superiores (N2, N3, Jefe de Área, etc.).
- **Flexibilización de Contraseña para el Administrador:** Eliminación del requisito mínimo de 6 caracteres en la contraseña para las vistas de creación/edición exclusivas del administrador, permitiendo asignaciones de contraseñas de cualquier longitud (ej: `.`).


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
- `docs/07_MONGO_REPLICA_SET.md`: Guía opcional para la configuración de réplicas de base de datos (Replica Set) en alta disponibilidad.
- `docs/SCREENSHOTS.md`: Galería visual de la interfaz y módulos principales.
- `docs/history/CHANGELOG.md`: Historial de cambios relevantes por versión.
- `docs/history/ISSUES.md`: Plan de trabajo y control de issues del SOC.

Documentos funcionales complementarios:

- `docs/UI-GOVERNANCE.md`: Estándares de desarrollo de interfaz y componentes.

---

## Licencia

El proyecto se distribuye bajo Business Source License 1.1. Revisar `LICENSE.md` para el detalle formal.
El archivo incluye el texto base en ingles y una seccion informativa en espanol para facilitar su lectura.
