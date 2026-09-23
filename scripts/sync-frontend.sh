#!/usr/bin/env sh
# Compila frontend-v2/ y copia el resultado a
# backend-go/internal/web/dist/browser/ (el //go:embed de internal/web/spa.go)
# para poder correr `go run`/`go build` en local SIN pasar por Docker.
#
# El Dockerfile hace lo mismo dentro del build multi-stage (stage
# `frontend-build` + COPY); este script existe para el flujo de desarrollo
# local fuera de Docker.
set -eu
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

cd "$repo_root/frontend-v2"
pnpm install --frozen-lockfile
pnpm run build

target="$repo_root/backend-go/internal/web/dist/browser"
rm -rf "$target"
mkdir -p "$target"
cp -r "$repo_root/frontend-v2/dist/frontend-v2/browser/." "$target/"

printf 'Frontend sincronizado en %s\n' "$target"
