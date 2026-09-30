#!/usr/bin/env bash
# Recrea la base de ensayo del ETL (spec/13-etl.md): borra bitacora_etl, la
# crea vacía y le aplica todas las migraciones. Nunca toca la base de
# desarrollo (bitacora) ni el legacy.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
. ./.env
set +a

DB_NAME="${ETL_DB_NAME:-bitacora_etl}"
case "$DB_NAME" in
  *etl*) ;;
  *) echo "Por seguridad la base de ensayo debe tener 'etl' en el nombre" >&2; exit 1 ;;
esac

docker compose exec -T bitacora-db psql -U bitacora -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)" \
  -c "CREATE DATABASE ${DB_NAME} OWNER bitacora"

migrate -path backend-go/sql/migrations \
  -database "postgres://bitacora:${POSTGRES_PASSWORD}@127.0.0.1:25432/${DB_NAME}?sslmode=disable" up

echo "Lista: ${DB_NAME} vacía y con todas las migraciones."
