# Desarrollo

Cómo trabajar en el código de Bitácora Ops: entorno local, pruebas, convenciones y recetas para agregar cosas.

- [1. Entorno local](#1-entorno-local)
- [2. Pruebas y verificaciones](#2-pruebas-y-verificaciones)
- [3. Recetas](#3-recetas)
- [4. Convenciones](#4-convenciones)
- [5. Antes de entregar un cambio](#5-antes-de-entregar-un-cambio)

---

## 1. Entorno local

Requisitos: Docker, Go 1.27, Node ≥ 24.15 con pnpm 12, `golang-migrate` y `sqlc`. Primero levanta el stack como en [instalacion.md](instalacion.md#3-instalación-en-desarrollo).

Hay dos formas de trabajar:

### A. Todo en Docker (lo más simple)

Cada vez que cambias código, reconstruye la app y vuelve a levantar el stack:

```bash
docker compose up -d --build bitacora-app
docker compose up -d          # asegura que Caddy también esté arriba
```

Abre <http://127.0.0.1:8081>.

### B. Backend con `go run` (más rápido para iterar en Go)

La base sigue en Docker y el binario corre en tu máquina. El frontend se compila una vez y se embebe:

```bash
# 1. Compilar Angular y copiarlo a backend-go/internal/web/dist/browser
./scripts/sync-frontend.sh          # en Windows: scripts/sync-frontend.ps1

# 2. Correr el servidor contra la base de Docker
cd backend-go
set -a && . ../.env && set +a
DATABASE_URL="postgres://bitacora:${POSTGRES_PASSWORD}@127.0.0.1:25432/bitacora?sslmode=disable" \
HTTP_ADDR=":8090" \
PUBLIC_BASE_URL="http://127.0.0.1:8090" \
COMPLEMENTS_ADDR=":8092" COMPLEMENTS_PUBLIC_URL="http://127.0.0.1:8092" \
go run ./cmd/server
```

Queda en <http://127.0.0.1:8090>. Los puertos 8090 y 8092 evitan chocar con Caddy, que ya ocupa 8081 y 8082. Si cambias el frontend, vuelve a ejecutar `sync-frontend`.

> **Tip:** con `RATE_LIMIT_DISABLED=true` en `.env` no te bloquea el login mientras pruebas. Solo funciona con `PUBLIC_BASE_URL` local.

---

## 2. Pruebas y verificaciones

| Qué | Comando | Dónde |
| --- | --- | --- |
| Pruebas Go | `go test ./...` | `backend-go/` |
| Análisis Go | `go vet ./...` y `gofmt -l .` | `backend-go/` |
| Pruebas frontend | `pnpm exec ng test --watch=false` | `frontend-v2/` |
| Solo algunas pruebas | `pnpm exec ng test --watch=false --include=src/app/features/admin/admin-guards.spec.ts` | `frontend-v2/` |
| Tipos TypeScript | `pnpm exec tsc -p tsconfig.app.json --noEmit` | `frontend-v2/` |
| Lint de CSS | `pnpm run lint:css` | `frontend-v2/` |
| Build de producción | `pnpm exec ng build` | `frontend-v2/` |

Pruebas de Go que **protegen convenciones** (fallan si se rompe la regla):

| Prueba | Exige |
| --- | --- |
| `audit_coverage_test` | Toda ruta que escribe (POST, PUT, PATCH, DELETE) llama a `AuditLog.Log`. |
| `routes_test` | Toda capacidad `cap…` usada en `main.go` está en `KnownCapabilities` (para que aparezca en la pantalla de permisos). |

Las pruebas de frontend usan Vitest con `HttpTestingController`: se simulan las respuestas del servidor sin levantar nada.

---

## 3. Recetas

### Agregar una migración

```bash
cd backend-go
migrate create -ext sql -dir sql/migrations -seq nombre_corto
```

1. Escribe `NNNNNN_nombre_corto.up.sql` y su `down.sql` (que deshaga exactamente lo mismo).
2. Agrega el mismo contenido del `up` al final de `sql/schema/0001_init_schema.sql`, porque `sqlc` tipa contra ese archivo.
3. Aplica: `migrate -path sql/migrations -database "postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" up`.
4. Si la migración toca datos que vienen del legacy, revisa también el ETL (`internal/legacyetl`).

### Agregar una consulta SQL

1. Escríbela en `sql/queries/<área>.sql` con su anotación:

   ```sql
   -- name: ListGuardSlotsBetween :many
   SELECT … WHERE s.starts_at < sqlc.arg('to_at')::timestamptz …;
   ```

2. Genera el código: `sqlc generate` (en `backend-go/`).
3. Úsala desde el handler: `h.Queries.ListGuardSlotsBetween(ctx, db.ListGuardSlotsBetweenParams{…})`.

> Si una columna es ambigua entre tablas (`id`), califícala (`tickets.id`). En `LEFT JOIN`, envuelve con `COALESCE` las columnas que `sqlc` debe tratar como no nulas.

### Agregar una ruta de API

1. Crea o extiende un handler en `internal/handler/` (struct con `Queries`, `AuditLog`, etc.).
2. Valida la entrada y responde con `writeData(w, status, valor)` o `problemdetails.Write(…)`.
3. Si escribe algo, llama a `h.AuditLog.Log(ctx, "area.accion", …)`.
4. Regístrala en `cmd/server/main.go` con el nivel de acceso correcto:

   ```go
   mux.Handle("POST /api/guards/slots", admin(guardsHandler.CreateSlot))
   ```

5. Si usa una capacidad nueva, agrégala a `KnownCapabilities`.
6. Actualiza [api.md](api.md). La tabla de rutas sale de `main.go`, así que basta con regenerarla.

### Agregar una pantalla o sección

1. Servicio HTTP en `core/<área>/<área>.service.ts`.
2. Componente en `features/<área>/` (standalone, `OnPush`, signals) con su `.html` y `.css`.
3. Ruta en `app.routes.ts` (pantalla) o entrada en el menú de `features/admin/admin-shell.ts` (sección de Administración).
4. Textos en ES y EN (siguiente receta).
5. Prueba `.spec.ts`.

> Por regla del proyecto, toda pantalla nueva o rediseñada se aprueba primero en el canvas de diseño ("BitacoraSOC UI Base") antes de programarla.

### Textos (ES / EN)

- **Comunes** (shell, botones genéricos): `core/i18n/messages.ts` (ES) y `messages-en.ts` (EN).
- **De un área**: `core/i18n/packs/<área>.ts`, con un objeto `ES` y otro `EN` registrados con `registerTexts`.
- El componente que usa claves de un pack debe importarlo: `import '../../core/i18n/packs/admin';`.
- En la plantilla: `{{ i18n.t('guards.title') }}`. Con un valor: `i18n.tf('clave', valor)` reemplaza `{v}`.
- Las dos versiones deben tener **las mismas claves**: el tipo `MessageKey` lo verifica al compilar.

### Estilos

- Usa siempre variables de tema (`var(--bg-surface)`, `var(--accent)`, `var(--status-critical)`…). El lint rechaza colores en hexadecimal y `check-css-vars` verifica que cada variable exista en los 3 temas.
- Las clases comunes de Administración (`adm-card`, `adm-btn`, `adm-input`…) están en `src/styles/admin-kit.css`; los segmentados (`seg`), píldoras (`pill`) e interruptores (`switch`) en `src/styles/`.
- Una declaración por línea (`pnpm exec stylelint --fix` lo corrige solo).

---

## 4. Convenciones

| Tema | Regla |
| --- | --- |
| Idioma | Código en inglés; comentarios, mensajes de error, documentación y textos de interfaz en español (con traducción al inglés en la interfaz). |
| Comentarios | Explican el **porqué**, no el qué. |
| Errores de API | Siempre Problem Details con `detail` en español, apto para mostrar. |
| Permisos | Se verifican en el servidor. El frontend solo esconde. |
| Módulos apagados | Desaparecen de menús y pantallas: no se muestra "desactivado". |
| Correos | Se reutilizan las plantillas del legacy (`internal/mailtpl`). No se diseñan correos nuevos. |
| Llamadas | La app no llama por teléfono: avisa por correo y registra resultados. |
| Dependencias | Nada deprecado: un aviso de deprecación en el build o en CI es un defecto. |
| Datos sensibles | Respaldos del legacy y del ETL van en `respaldos/` (fuera de git). Nunca en el repositorio ni en carpetas hermanas. |
| Pruebas con correo | El SMTP de desarrollo puede ser real: las pruebas de punta a punta no deben enviar correos. |
| Commits | Los hace el dueño del repositorio. |
| Historial | Cada cambio relevante se anota en [CHANGELOG](history/CHANGELOG.md) con su fecha. |

---

## 5. Antes de entregar un cambio

```bash
# Backend
cd backend-go && gofmt -l . && go vet ./... && go test ./...

# Frontend
cd ../frontend-v2 && pnpm exec tsc -p tsconfig.app.json --noEmit \
  && pnpm run lint:css && pnpm exec ng test --watch=false && pnpm exec ng build

# Probar en el stack real
cd .. && docker compose up -d --build bitacora-app && docker compose up -d
```

Y además:

- Si agregaste una migración, aplícala y verifica que el `down` funcione.
- Si cambió una ruta, actualiza [api.md](api.md).
- Anota el cambio en el [CHANGELOG](history/CHANGELOG.md).
