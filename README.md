# Bitácora Ops

<!-- Marca de autor en comentarios: Athan Espinoza -->

Bitácora de operaciones para centros **SOC** (ciberseguridad) y **NOC** (red). En un mismo lugar está:

- el registro del turno,
- el checklist de relevo,
- las guardias,
- el escalamiento a contratas y equipos,
- una ticketera ITIL,
- los reportes a clientes,
- la auditoría de todo lo anterior.

Es la **versión 2.0** del sistema que antes se llamaba BitacoraSOC. Es una reescritura completa en **Go + Angular + PostgreSQL**.

> **Estado (2026-10):** la 2.0 está completa salvo el orquestador y se está ensayando la migración de datos. En producción sigue corriendo el legacy v1.x hasta el día del corte. Ese día se elige cuando la 2.0 esté lista, sin fecha fija (ver [Migración desde el legacy](docs/migracion-legacy.md)).

---

## Qué hace

| Pantalla | Para qué sirve |
| --- | --- |
| **Bitácora** | Registrar lo que pasa en el turno: entradas operativas, incidentes y ofensas, con etiquetas, cliente o servicio, imágenes y comentarios. Una entrada puede convertirse en ticket. |
| **Turnos y Checklist** | Abrir y cerrar el turno con su checklist. Al cerrar se envía un reporte por correo. También muestra quién está de guardia y la dotación del día. |
| **Escalamiento** | Saber a quién llamar según el servicio, el activo o la zona, y registrar cada intento (contestó, no contestó…). La app **no hace llamadas**: avisa por correo y deja constancia. |
| **Directorio** | Contactos internos y externos con sus canales (teléfono, WhatsApp, correo). |
| **Reportes** | Informes de incidente y boletines para clientes, con vista previa y envío por correo. |
| **Ticketera** | Incidentes y requerimientos ITIL con SLA, tareas, resolutores, padre/hijo, unir duplicados y un enlace público con PIN para el cliente. |
| **Complementos** | Mini-aplicaciones propias embebidas en un origen aislado. |
| **Administración** | Usuarios y permisos, guardias, turnos, checklist, escalamiento, correo, organizaciones, territorio, equipos, marca, módulos, respaldos y auditoría. |

La aplicación está en **español e inglés**. Tiene 3 temas (claro, oscuro y rosa), una fuente para dislexia (OpenDyslexic) y 6 temas de pantalla de login.

**Módulos.** Una instalación puede ser solo **SOC**, solo **NOC**, ambos, o **solo Ticketera**. Lo que está apagado no aparece en los menús.

Guía completa por pantalla: **[docs/guia-de-uso.md](docs/guia-de-uso.md)**.

---

## Inicio rápido (desarrollo)

Necesitas Docker, y para migrar la base, [`golang-migrate`](https://github.com/golang-migrate/migrate).

```bash
# 1. Variables (solo la primera vez). Los valores de ejemplo sirven para desarrollo.
cp .env.example .env

# 2. Levantar base de datos, aplicación y proxy
docker compose up -d --build

# 3. Crear las tablas (la aplicación NO migra sola)
migrate -path backend-go/sql/migrations \
  -database "postgres://bitacora:bitacora_dev_local@127.0.0.1:25432/bitacora?sslmode=disable" up

# 4. Abrir la aplicación
#    http://127.0.0.1:8081  → la primera vez abre el asistente /setup
```

El **asistente de configuración** (`/setup`) aparece mientras la base está vacía. Ahí eliges los módulos y creas el primer administrador.

Instalación paso a paso, producción con HTTPS y solución de problemas: **[docs/instalacion.md](docs/instalacion.md)**.

---

## Cómo está hecho

```mermaid
flowchart LR
    U[Navegador] -->|"HTTP :8081"| C[Caddy]
    U -->|":8082 complementos"| C
    C --> A["bitacora-app<br/>Go + Angular embebido"]
    A --> D[("PostgreSQL 18<br/>bitacora-db")]
    A -->|SMTP| M[Servidor de correo]
```

Son tres contenedores:

- **Caddy** es la única puerta de entrada.
- **bitacora-app** es un binario Go que sirve la API y el frontend Angular compilado dentro del mismo binario.
- **PostgreSQL 18** guarda los datos.

No hay Redis, ni colas, ni Kubernetes. Detalle en **[docs/arquitectura.md](docs/arquitectura.md)**.

| Pieza | Tecnología |
| --- | --- |
| Backend | Go 1.27, `net/http` estándar, `sqlc` + `pgx` (SQL tipado, sin ORM) |
| Frontend | Angular 22 (standalone, signals, zoneless), Angular CDK, pnpm |
| Base de datos | PostgreSQL 18, migraciones con `golang-migrate` |
| Proxy | Caddy 2 (en producción también termina HTTPS) |
| Seguridad | JWT con lista de revocación, bcrypt costo 12, MFA TOTP, AES-256-GCM para secretos en reposo, límite de intentos en Postgres |

---

## Estructura del repositorio

| Carpeta | Qué contiene |
| --- | --- |
| [`backend-go/`](backend-go/README.md) | API en Go, migraciones SQL, consultas `sqlc` y herramientas de línea de comandos (ETL, comparador de escalamiento, semilla territorial). |
| [`frontend-v2/`](frontend-v2/README.md) | Aplicación Angular. |
| `seed/` | Datos opcionales para cargar, como la división territorial de Chile. |
| `scripts/` | Utilidades: compilar el frontend para correr Go en local y recrear la base de ensayo del ETL. |
| `docs/` | Esta documentación, decisiones de arquitectura (`adr/`) e historial (`history/`). |
| `respaldos/` | Copias y datos del legacy para el ETL. **No se sube a git**: contiene datos personales. |
| `spec/` | Especificación interna de la reescritura. **No se sube a git.** |

---

## Documentación

| Documento | Para quién | Contenido |
| --- | --- | --- |
| [Guía de uso](docs/guia-de-uso.md) | Analistas y administradores | Qué hace cada pantalla y cómo se usa |
| [Instalación](docs/instalacion.md) | Quien instala | Desarrollo y producción, paso a paso |
| [Configuración](docs/configuracion.md) | Quien instala | Todas las variables de entorno y lo que se configura desde la app |
| [Operación](docs/operacion.md) | Quien mantiene el servidor | Respaldos, actualizaciones, monitoreo y problemas comunes |
| [Arquitectura](docs/arquitectura.md) | Desarrolladores | Cómo se conectan las piezas, seguridad y permisos |
| [API](docs/api.md) | Desarrolladores e integraciones | Las 277 rutas, quién puede usarlas y el formato de errores |
| [Desarrollo](docs/desarrollo.md) | Desarrolladores | Entorno local, pruebas, convenciones y cómo agregar cosas |
| [Migración desde el legacy](docs/migracion-legacy.md) | Quien hace el corte | ETL, verificación y comparador de escalamiento |
| [Decisiones (ADR)](docs/adr/) | Todos | Por qué se eligió cada cosa |
| [Changelog](docs/history/CHANGELOG.md) | Todos | Qué se construyó y cuándo |

---

## Licencia

Business Source License 1.1, ver [`LICENSE.md`](LICENSE.md). Los avisos de terceros (datos territoriales ODbL, fuentes y librerías) están en [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
