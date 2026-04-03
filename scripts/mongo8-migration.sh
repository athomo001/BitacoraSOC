#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
BACKUP_ROOT="$ROOT_DIR/.data/mongo8-migration"

compose() {
  docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.complements.yml" "$@"
}

mongo_container_id() {
  container_id="$(compose ps -q mongodb)"
  if [ -z "$container_id" ]; then
    echo "No se pudo resolver el contenedor mongodb del compose de Bitacora." >&2
    exit 1
  fi
  printf '%s' "$container_id"
}

usage() {
  cat <<EOF
Uso:
  sh ./scripts/mongo8-migration.sh backup
  sh ./scripts/mongo8-migration.sh restore <ruta-backup>

Acciones:
  backup   Crea respaldo lógico de MongoDB y copia artefactos críticos del host.
  restore  Levanta Mongo limpio, restaura dump y repone uploads/tls/backups.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta comando requerido: $1" >&2
    exit 1
  fi
}

ensure_backup_root() {
  mkdir -p "$BACKUP_ROOT"
}

archive_host_dir() {
  src_name="$1"
  dest_file="$2"
  src_path="$ROOT_DIR/.data/$src_name"
  if [ -d "$src_path" ]; then
    tar -czf "$dest_file" -C "$ROOT_DIR/.data" "$src_name"
  fi
}

wait_for_mongo() {
  attempts=60
  while [ "$attempts" -gt 0 ]; do
    if compose exec -T mongodb sh -lc 'mongosh --host localhost --port 27017 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "db.runCommand({ ping: 1 }).ok" | grep 1' >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done

  echo "MongoDB no quedó listo a tiempo" >&2
  exit 1
}

ensure_mongo8_declared() {
  if ! grep -q 'image: mongo:8' "$ROOT_DIR/docker-compose.yml"; then
    echo "Advertencia: docker-compose.yml no parece apuntar a mongo:8." >&2
    echo "Restaura solo después de confirmar que el pull dejó la imagen correcta." >&2
  fi
}

do_backup() {
  require_command docker
  require_command tar
  require_command date

  ensure_backup_root
  timestamp="$(date +%Y%m%d-%H%M%S)"
  target_dir="$BACKUP_ROOT/$timestamp"
  mkdir -p "$target_dir"

  echo "[mongo8-migration] Creando dump lógico en $target_dir"
  compose exec -T mongodb sh -lc 'rm -rf /tmp/mongo8-migration && mkdir -p /tmp/mongo8-migration && mongodump --uri="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin" --out=/tmp/mongo8-migration/dump'
  docker cp "$(mongo_container_id):/tmp/mongo8-migration/dump" "$target_dir/dump"

  if [ -f "$ROOT_DIR/.env" ]; then
    cp "$ROOT_DIR/.env" "$target_dir/.env.backup"
  fi

  archive_host_dir uploads "$target_dir/uploads.tar.gz"
  archive_host_dir tls "$target_dir/tls.tar.gz"
  archive_host_dir backups "$target_dir/backups.tar.gz"

  cat > "$target_dir/manifest.txt" <<EOF
created_at=$timestamp
project_root=$ROOT_DIR
mongo_container=$(mongo_container_id)
includes=dump,env.backup,uploads.tar.gz,tls.tar.gz,backups.tar.gz
restore_with=sh ./scripts/mongo8-migration.sh restore $target_dir
EOF

  echo "[mongo8-migration] Backup completado: $target_dir"
  echo "[mongo8-migration] Antes del pull productivo, copia esta carpeta fuera del host si es posible."
}

restore_host_archive() {
  archive_file="$1"
  ts_suffix="$2"
  if [ ! -f "$archive_file" ]; then
    return 0
  fi

  base_name="$(basename "$archive_file" .tar.gz)"
  current_dir="$ROOT_DIR/.data/$base_name"
  if [ -d "$current_dir" ]; then
    mv "$current_dir" "$ROOT_DIR/.data/${base_name}_pre_restore_$ts_suffix"
  fi
  tar -xzf "$archive_file" -C "$ROOT_DIR/.data"
}

do_restore() {
  require_command docker
  require_command tar
  require_command date

  source_dir="${2:-}"
  if [ -z "$source_dir" ]; then
    echo "Debes indicar la ruta del backup." >&2
    usage
    exit 1
  fi

  if [ ! -d "$source_dir/dump" ]; then
    echo "No existe dump en: $source_dir" >&2
    exit 1
  fi

  ensure_mongo8_declared

  ts_suffix="$(date +%Y%m%d-%H%M%S)"
  echo "[mongo8-migration] Deteniendo stack para restauración controlada"
  compose down

  for dir_name in mongodb_data mongodb_config; do
    current_dir="$ROOT_DIR/.data/$dir_name"
    if [ -d "$current_dir" ]; then
      mv "$current_dir" "$ROOT_DIR/.data/${dir_name}_pre_restore_$ts_suffix"
    fi
    mkdir -p "$current_dir"
  done

  echo "[mongo8-migration] Levantando MongoDB limpio"
  compose up -d mongodb
  wait_for_mongo

  compose exec -T mongodb sh -lc 'rm -rf /tmp/mongo8-restore && mkdir -p /tmp/mongo8-restore'
  docker cp "$source_dir/dump" "$(mongo_container_id):/tmp/mongo8-restore/dump"

  echo "[mongo8-migration] Restaurando dump en Mongo"
  compose exec -T mongodb sh -lc 'mongorestore --drop --uri="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@localhost:27017/?authSource=admin" /tmp/mongo8-restore/dump'

  restore_host_archive "$source_dir/uploads.tar.gz" "$ts_suffix"
  restore_host_archive "$source_dir/tls.tar.gz" "$ts_suffix"
  restore_host_archive "$source_dir/backups.tar.gz" "$ts_suffix"

  if [ -f "$source_dir/.env.backup" ]; then
    cp "$source_dir/.env.backup" "$ROOT_DIR/.env.from-mongo8-backup"
  fi

  echo "[mongo8-migration] Levantando stack completo"
  compose up -d --build

  echo "[mongo8-migration] Restore completado"
  echo "[mongo8-migration] Verifica login, entradas, checklist y complementos antes de abrir operación."
  if [ -f "$ROOT_DIR/.env.from-mongo8-backup" ]; then
    echo "[mongo8-migration] Se dejó copia de variables en .env.from-mongo8-backup (no se sobreescribió .env automáticamente)."
  fi
}

action="${1:-}"
case "$action" in
  backup)
    do_backup
    ;;
  restore)
    do_restore "$@"
    ;;
  *)
    usage
    exit 1
    ;;
esac