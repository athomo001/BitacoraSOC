#!/usr/bin/env bash
# Compila frontend-v2 y copia el resultado al directorio que embebe el
# binario Go (internal/web/dist/browser) — spec/07-backend-arquitectura-go.md
# sección 1, Fase 3 del roadmap ("//go:embed sirviendo el build de Angular").
# Correr antes de `go build`/`go run` cuando cambie algo en frontend-v2.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$(cd "$BACKEND_DIR/../frontend-v2" && pwd)"
DEST_DIR="$BACKEND_DIR/internal/web/dist/browser"

echo "==> pnpm build (frontend-v2)"
(cd "$FRONTEND_DIR" && pnpm run build)

echo "==> Copiando dist/frontend-v2/browser -> internal/web/dist/browser"
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
cp -r "$FRONTEND_DIR/dist/frontend-v2/browser/." "$DEST_DIR/"

echo "==> listo"
