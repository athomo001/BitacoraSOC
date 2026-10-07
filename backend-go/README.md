# backend-go

Servidor de Bitácora Ops: API REST + eventos en vivo (SSE), frontend embebido, origen aislado de complementos y tareas programadas, todo en **un binario Go**.

| | |
| --- | --- |
| Lenguaje | Go 1.27 |
| HTTP | `net/http` estándar (enrutador de Go 1.22+) |
| Base de datos | PostgreSQL 18 vía `pgx/v5`; consultas tipadas con `sqlc` |
| Migraciones | `golang-migrate` (`sql/migrations/`), se aplican aparte |
| Módulo | `github.com/athomo001/BitacoraSOC/backend-go` |

## Carpetas

| Ruta | Qué hay |
| --- | --- |
| `cmd/server/` | El servidor. `main.go` lee el entorno, arma las dependencias, registra **todas las rutas** con su nivel de acceso y lanza las tareas programadas. |
| `cmd/legacy-etl/` | Migración de datos del legacy ([guía](../docs/migracion-legacy.md#3-etl-legacy-etl)). |
| `cmd/escalation-shadow-diff/` | Comparador de escalamiento legacy vs. 2.0 ([guía](../docs/migracion-legacy.md#4-comparador-de-escalamiento-escalation-shadow-diff)). |
| `cmd/territorial-seed/` | Genera la semilla territorial de un país ([guía](../docs/migracion-legacy.md#5-semilla-territorial-territorial-seed)). |
| `internal/handler/` | Controladores HTTP por área. |
| `internal/<área>/` | Reglas puras (escalation, rotation, tickets…), seguridad (auth, crypto, ratelimit), correo (mailtpl), respaldos y más. Ver [arquitectura](../docs/arquitectura.md#3-backend-go). |
| `internal/repository/db/` | Código **generado** por `sqlc`. No se edita a mano. |
| `internal/web/dist/browser/` | Frontend compilado que se embebe (lo llena el Dockerfile o `scripts/sync-frontend.sh`). |
| `sql/migrations/` | Migraciones `NNNNNN_nombre.up.sql` / `.down.sql`. |
| `sql/queries/` | Consultas con anotaciones `sqlc`, una por área. |
| `sql/schema/0001_init_schema.sql` | Esquema completo (espejo de las migraciones) para que `sqlc` tipe. |

## Comandos

```bash
go test ./...                      # pruebas
go vet ./...                       # análisis estático
gofmt -l .                         # archivos sin formatear
sqlc generate                      # regenerar internal/repository/db tras tocar sql/
go run ./cmd/server                # servidor (requiere variables, ver abajo)
```

Para correr el servidor fuera de Docker:

```bash
../scripts/sync-frontend.sh        # compila Angular y lo deja para embeber
set -a && . ../.env && set +a
DATABASE_URL="postgres://bitacora:${POSTGRES_PASSWORD}@127.0.0.1:25432/bitacora?sslmode=disable" \
HTTP_ADDR=":8090" COMPLEMENTS_ADDR=":8092" \
go run ./cmd/server
```

Variables de entorno: [configuracion.md](../docs/configuracion.md). Rutas: [api.md](../docs/api.md). Recetas (migración, consulta, ruta nueva): [desarrollo.md](../docs/desarrollo.md#3-recetas).

## Imagen Docker

`Dockerfile` (contexto: la raíz del repositorio) hace tres etapas:

1. compila Angular,
2. compila Go con el frontend embebido (`CGO_ENABLED=0`, binario estático),
3. lo copia a `gcr.io/distroless/static-debian12:nonroot`, sin shell y con usuario sin privilegios.
