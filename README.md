# Bitacora SOC

<!-- Marca de autor en comentarios: Athan Espinoza -->

> 🌐 **Idioma:** Español | [English](README.en.md)

Plataforma web para operacion SOC con bitacora operativa, checklists de turno, escalacion, auditoria, backup, integraciones y modulo de complementos embebidos.

> Estado del proyecto: estable. Validar siempre los flujos en un entorno de pruebas antes de pasar a operación formal.
>
> Version referencial actual (segun `CHANGELOG.md`): **v1.10.1**

Stack principal:

- frontend: Angular 20
- backend: Express 5 + Node 22 LTS
- base de datos: MongoDB 8
- despliegue: Docker Compose v2

---

## Índice

- [Capacidades principales](#capacidades-principales)
- [Comparativa con herramientas similares](#comparativa-con-herramientas-similares)
- [Novedades recientes](#novedades-recientes-resumen-rapido)
- [Quick Start con Docker](#quick-start-con-docker)
- [Vista rapida de la interfaz](#vista-rapida-de-la-interfaz)
- [Desarrollo local](#desarrollo-local)
- [Complementos](#complementos)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Documentacion](#documentacion)
- [Licencia](#licencia)

---

## Capacidades principales

- **Bitácora Operativa Integral**: Registro continuo de eventos en tiempo real, incidentes críticos, mantenciones y ofensas de seguridad, estructurados mediante narrativa y hashtags.
- **Disciplina Operativa y Checklists**: Gestión del relevo de guardia mediante checklists obligatorios de inicio y cierre de turno, con alertas reactivas e impedimentos de cierre si quedan hallazgos no conformes (NOK) abiertos.
- **Ruta de Escalación Visual e Interactiva**: Mapa de contactos y diagramas jerárquicos interactivos por cliente y servicio que permiten identificar visualmente a quién llamar primero en caso de incidencias.
- **Visualización de Flujos de Escalación**: Monitoreo y consulta del flujo de llamadas, flujo de correos y la matriz de responsabilidades RACI editable desde el panel de control.
- **Directorio Centralizado**: Agenda de correos y teléfonos unificada para la búsqueda veloz de contactos de clientes, analistas de guardia y enlaces a servicios web críticos.
- **Automatización de Turnos y Correos de Guardia**: Programación automatizada del reporte periódico de turnos para analistas y clientes. Los correos (HTML premium responsivo) se envían con badges y colores corporativos de acuerdo a la condición de turno (Guardia, Teletrabajo, Vacaciones, Licencias o Trámites Médicos).
- **Pruebas de Correo Interactivas**: Panel para realizar envíos de prueba inmediatos en base a la configuración en caliente de la interfaz, sin alterar el histórico ni las fechas de envío de producción.
- **Gestión SMTP y Personalización de Marca (Branding)**: Ajuste de servidores de correo, configuración del remitente y opción de subir logotipos y modificar títulos de la aplicación para adaptar la plataforma a la identidad institucional.
- **Celebración de Cumpleaños**: Mapeo diario automático de cumpleaños de analistas del SOC con felicitaciones estructuradas y envío de imágenes kawaii embebidas en línea (CID).
- **Seguridad y Acceso Robusto**:
  - Soporte de Doble Factor de Autenticación (TOTP - Google Authenticator, Authy, etc.).
  - Integración Single Sign-On (SSO) referencial mediante Google y Microsoft Azure AD _(módulo base implementado; requiere validación, credenciales de API del proveedor y pruebas de configuración en producción)_.
  - Consola de gestión HTTPS con inyección y rotación de certificados TLS sin detención del servicio (0-Downtime).
- **Estadísticas y Reportes Automatizados**: Generación de informes ejecutivos e indicadores de uso basados en las entradas de la bitácora para evaluar la actividad y el cumplimiento operacional del equipo.
- **Resiliencia con Backups Cifrados**: Creación y restauración de copias de seguridad de la base de datos MongoDB y evidencias de disco con empaquetado cifrado por contraseña descargable desde la UI.
- **Extensibilidad mediante Complementos (Plugins)**: Carga y ejecución de utilidades estáticas (ZIP) y URLs externas integradas por iframes seguros con aislamiento Sandbox, control selectivo de accesos a la API compartida y protección Circuit Breaker contra caídas del complemento.
- **Integraciones y API Keys (SOAR / Automática)**: CRUD administrativo de credenciales seguras (SHA-256) con permisos granulares (scopes), logs de auditoría en tiempo real y soporte para renderizado MJML de reportes y envío SMTP automático de alertas de incidentes para integración con herramientas externas.
- **Integración Bidireccional con GLPI**: vincula una entrada de bitácora a un ticket GLPI ya existente (o deja que un incidente cree uno automáticamente) sin reescribir el mismo contenido dos veces; importación automática configurable que trae tickets/seguimientos nuevos de las entidades GLPI mapeadas y los convierte en entradas de bitácora, con tipo (operativa/incidente) configurable por entidad.

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

## Novedades recientes (resumen rapido)

> Historial completo y detallado en [`docs/history/CHANGELOG.md`](docs/history/CHANGELOG.md).

### v1.10.1 (Soporte Markdown en la bitácora + formulario asistido de Inicio/Cierre de Turno)

- **Markdown al ver una entrada**: el modal "Ver evento" (`/main/all-entries`) renderiza el contenido como Markdown (negrita, listas, títulos, código, citas, tablas, enlaces) en vez de texto plano, con sanitización vía `DOMPurify`. Un `#` sin espacio al inicio de línea también se trata como título (necesario porque los hashtags de la bitácora van sin espacio; un tag a mitad de texto no se ve afectado).
- **Formulario asistido de Inicio/Cierre de Turno**: nuevo panel "Plantillas de Turno" junto a "Nueva Entrada" que arma el reporte de turno (métricas, tickets/incidentes, observaciones) siguiendo la plantilla estándar de traspaso de guardia; el texto se inserta en el cajón principal para revisar antes de subir. El cajón de tickets acepta tanto el dump crudo de CDC/GLPI como el formato `// ticket, cliente[, severidad], descripción`.
- **Optimización de espacio en `/main/checklist`**: se quitan títulos redundantes, se fusiona el título del panel de checklist con su descripción y se reduce el espaciado para que el botón "Subir" quede visible sin scroll.

### v1.10.0 (Saneamiento del sistema de temas + nuevo tema "Windows 95" con íconos pixel-art)

- **Nuevo tema "Windows 95"**: cuarta opción en el selector de temas, con paleta gris/azul marino, botones y campos con bisel 3D, barra de título degradada y esquinas cuadradas. Aditivo por diseño — no modifica Light/Pastel/Cyberpunk.
- **Íconos pixel-art**: 157 íconos Material reemplazados por su equivalente `pixelarticons` (MIT) solo bajo el tema Windows 95, vía un servicio que sincroniza el ícono actual sin interferir con la reactividad de Angular.
- **Bugfix**: varios componentes (`work-shifts-admin`, `not-found`, `api-keys`, badges de severidad, íconos de calendario) tenían colores hardcodeados que rompían el cambio de tema — el caso más grave usaba variables CSS que no existían en ningún lado. Corregidos con los tokens del sistema de temas existente.
- **Ronda de pulido tras pruebas manuales**: contraste de texto en cabeceras, colisión de etiquetas con bordes de campos, tamaño de íconos, alcance de la tipografía retro, y el bug más visible — botones de solo-ícono (enviar/editar/eliminar) que quedaban convertidos en cuadrados beige biselados por compartir clase base con los botones de texto.

### v1.9.1 (Mejoras menores en Directorio de Contactos)

- Renombrado "Directorio Centralizado" / "Fuente de Verdad de Contactos" a **"Directorio de Contactos"** en el menú lateral y el título de la página.
- El campo "Empresa" del formulario de contacto ahora es un combobox (`mat-autocomplete`) que sugiere las empresas ya registradas, sin dejar de permitir texto libre.
- Nuevo filtro "Sin empresa" para ubicar rápido los contactos con ese campo vacío.

### v1.9.0 (Integración GLPI bidireccional: vincular entradas a tickets existentes + importación automática de tickets)

- **Saliente**: vincula una entrada de bitácora a un ticket GLPI ya existente y reenvía actualizaciones como seguimientos (`ITILFollowup`), sin duplicar tickets. El ticket creado automáticamente para incidentes/ofensas ahora queda registrado en la propia entrada.
- **Entrante**: sondeo automático configurable (activable/desactivable) que trae tickets y seguimientos nuevos de las entidades GLPI mapeadas y los convierte en entradas de bitácora — con tipo de entrada (operativa/incidente) configurable por entidad, y sin loops entre ambas direcciones.
- Compatible con GLPI 9.x-11.x (resuelve los campos de búsqueda dinámicamente, sin IDs hardcodeados). Pendiente de validar contra una instancia GLPI real.

### v1.8.2 (Bugfix: contactos eliminados del Directorio o de Usuarios seguían apareciendo en Escalamiento)

- **Bugfix (Backend)**: `escalationFlow` guardaba una copia del nombre/teléfono del contacto en vez de una referencia, por lo que borrar un contacto del directorio general o de Usuarios no lo quitaba de las Líneas de Escalamiento de los clientes. Se agregó limpieza en cascada (`removeContactFromEscalationFlows`) en los cuatro caminos de borrado/purga de contactos.

### v1.8.1 / v1.8.0 (Logs de Auditoría: calendario de rango de fechas, filtro por Usuario, layout de filtros y bugfix de zona horaria)

- **Rango de fechas con calendario único**: reemplaza los campos separados "Fecha inicio"/"Fecha fin" por un selector Material (`mat-date-range-picker`) que permite elegir el día de inicio y fin en una sola interacción.
- **Filtro por Usuario en vez de "Evento"**: lista a las personas por su nombre real en vez del listado crudo de eventos técnicos.
- **Layout de filtros reordenado**: "Buscar" tiene su propia fila con más ancho; "Categoría", "Usuario", "Nivel" y "Rango de fechas" comparten la fila siguiente.
- **Fecha/Hora en formato 24 horas** en la tabla de auditoría (antes mostraba AM/PM).
- **Bugfix (Backend)**: el filtro de rango de fechas no devolvía resultados del día actual en zonas horarias detrás de UTC (ej. `America/Santiago`); corregido en `buildDateRange`.

### Estado IA local

- alcance definido en `docs/history/ISSUES.md` (epic `AI-SUMMARY-001` y subitems).
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

### Ya esta descargado: solo levantar o actualizar

```bash
# Levantar (ya descargado, solo resta levantar)
docker compose build --no-cache && docker compose up -d

# Actualizar a la ultima version
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

> 💡 **Nota sobre la Consola de Seguridad (HTTPS & SSO):** El panel unificado de HTTPS y Single Sign-On (SSO) está completamente integrado. El soporte para la inyección y rotación de certificados **HTTPS** (0-Downtime) es altamente funcional y estable, mientras que el inicio de sesión vía SSO (Google/Microsoft) está disponible como esquema base (sujeto a configuración y pruebas finales con el proveedor de identidad corporativo).

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
- `docs/api-v1-manual.md`: Manual técnico de la API externa v1 y ejemplos de integración con Postman y SOAR.
- `CHANGELOG.md`: Historial de cambios relevantes y control de versiones del proyecto.
- `docs/history/ISSUES.md`: Plan de trabajo y control de issues del SOC.

Documentos funcionales complementarios:

- `docs/UI-GOVERNANCE.md`: Estándares de desarrollo de interfaz y componentes.

---

## Licencia

El proyecto se distribuye bajo Business Source License 1.1. Revisar `LICENSE.md` para el detalle formal.
El archivo incluye el texto base en ingles y una seccion informativa en espanol para facilitar su lectura.
