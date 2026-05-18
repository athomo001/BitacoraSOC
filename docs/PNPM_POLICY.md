# Politica de Package Manager: pnpm v11

Este repositorio usa exclusivamente `pnpm` major `11`.

## Reglas obligatorias

- Usar `pnpm install` para instalar dependencias.
- Usar `pnpm run <script>` para ejecutar scripts.
- Usar `pnpm exec <binario>` para CLIs locales.
- No usar `npm install`, `npm run`, `npx` ni generar `package-lock.json`.

## Estandar tecnico

- Todos los `package.json` definen `packageManager: "pnpm@11.0.0"`.
- `preinstall` valida el user agent y bloquea gestores distintos de `pnpm@11`.
- Docker build usa `corepack` + `pnpm` con lockfile congelado (`--frozen-lockfile`).

## Configuracion base recomendada

```bash
corepack enable
corepack prepare pnpm@11.0.0 --activate
pnpm --version
```
