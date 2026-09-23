# Bitácora Ops

<!-- Marca de autor en comentarios: Athan Espinoza -->

Bitácora de operaciones para centros SOC y NOC: registro de turnos, checklist de relevo, escalamiento a contratas y equipos, ticketera ITIL nativa y auditoría. Es la **versión 2.0** (reescritura completa en Go + Angular + PostgreSQL) del sistema que antes se llamaba BitacoraSOC.

> **Estado:** en desarrollo, Fase 5 de 14 cerrada (ver `docs/history/CHANGELOG.md`). Producción sigue corriendo el legacy v1.x en su propio servidor hasta el corte de la Fase 14.

## Estructura

| Carpeta | Qué es |
| --- | --- |
| `backend-go/` | API en Go 1.27 (`net/http` + `sqlc` + `pgx`), migraciones en `sql/migrations/`. Embebe el build de Angular. |
| `frontend-v2/` | Angular 22 (standalone, zoneless, pnpm). |
| `seed/` | Datos de carga opcional (ej. división territorial de Chile). |
| `docs/adr/` | Decisiones de arquitectura. |
| `docs/history/CHANGELOG.md` | Qué se construyó en cada fase. |
| `spec/` | Especificación completa (local, fuera de git a propósito). |

## Levantar en desarrollo

Requisitos: Docker, Go 1.27, Node ≥ 24.15 con pnpm, `golang-migrate` y `sqlc`.

```bash
# 1. Base de datos, app y Caddy (http://127.0.0.1:8081)
docker compose -f docker-compose.rewrite.yml up -d --build

# 2. Migraciones (Postgres expuesto en 127.0.0.1:25432)
cd backend-go
migrate -path sql/migrations -database "postgres://bitacora:bitacora_dev_local@127.0.0.1:25432/bitacora?sslmode=disable" up
```

En una base vacía, cualquier ruta lleva al **asistente de configuración** (`/setup`): ahí se eligen los módulos (SOC, NOC o ambos) y se crea el primer administrador. El sistema nuevo **no** usa las variables `ADMIN_*` de los `.env` del legacy.

Tests: `cd backend-go && go test ./...` · `cd frontend-v2 && pnpm test` · `pnpm run lint:css`.

## Código legacy (v1.x)

El código del sistema anterior (`backend/` Node + Mongo, `frontend/` Angular, documentación y respaldos locales) ya no vive en esta carpeta. Está congelado en el tag `legacy-v1-final` y disponible para consulta en la carpeta hermana `../BitacoraSOC-legacy/` (un `git worktree` de ese tag, con las mismas rutas que cita la spec):

```bash
git worktree add --detach ../BitacoraSOC-legacy legacy-v1-final   # si hay que recrearla
```

Se sigue usando como referencia para portar pantallas y lógica en las fases que faltan y para la migración de datos de la Fase 14. Se retira definitivamente 14 días después del corte (`docs/adr/0003`).

## Licencia

Business Source License 1.1 — ver `LICENSE.md`. Avisos de terceros (datos territoriales ODbL, fuentes, librerías) en `THIRD-PARTY-NOTICES.md`.
