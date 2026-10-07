# frontend-v2

Aplicación web de Bitácora Ops: Angular 22 con componentes standalone, signals y sin `zone.js`. En producción no se sirve sola: se compila y queda **embebida en el binario Go** (ver [backend-go](../backend-go/README.md)).

## Carpetas

| Ruta | Qué hay |
| --- | --- |
| `src/app/app.routes.ts` | Rutas y guards: `/setup`, `/login`, enlace público de tickets `/p/tickets/:token` y las pantallas con sesión. |
| `src/app/core/` | Servicios HTTP por área, autenticación, i18n, preferencias (idioma, tema, dislexia) y eventos en vivo (SSE). |
| `src/app/features/` | Pantallas: `entries` (Bitácora), `shifts`, `escalation`, `directory`, `reports`, `tickets`, `complements`, `admin`, `setup`, `login`, `territory`. |
| `src/app/shared/` | Componentes reutilizables: `modal`, botones, tabla densa y Markdown. |
| `src/app/shell/` | Marco de la app: menú lateral, Mi perfil, idioma y tema. |
| `src/styles/` | Estilos globales: `tokens.css` (variables de los 3 temas), `admin-kit.css`, `forms.css`, `pills.css` y `fonts.css`. |
| `scripts/copy-seed.mjs` | Copia `../seed/territorial_units_chile.json` a `public/seed/` antes de compilar. |
| `scripts/check-css-vars.mjs` | Verifica que toda `var(--…)` usada exista en los 3 temas. |

## Comandos

```bash
pnpm install                                   # dependencias
pnpm run build                                 # build de producción → dist/frontend-v2/browser
pnpm exec ng test --watch=false                # pruebas (Vitest)
pnpm exec tsc -p tsconfig.app.json --noEmit    # tipos
pnpm run lint:css                              # lint de estilos + variables de tema
```

> `pnpm start` (`ng serve`) levanta solo el frontend **sin proxy a la API**. Para ver la app funcionando usa el stack de Docker (<http://127.0.0.1:8081>) o `../scripts/sync-frontend.sh` + `go run` (ver [desarrollo.md](../docs/desarrollo.md#1-entorno-local)).

## Reglas rápidas

- Componentes standalone con `ChangeDetectionStrategy.OnPush` y signals.
- Todo texto visible pasa por `i18n.t('clave')`, con la clave en ES y EN. Los textos de un área van en `core/i18n/packs/<área>.ts` y el componente importa ese pack.
- Colores solo con variables de tema (`var(--accent)`…): el lint rechaza los hexadecimales.
- Lo que el usuario no puede usar (módulo apagado, sin permiso) no se muestra.

Más detalle en [desarrollo.md](../docs/desarrollo.md) y [arquitectura.md](../docs/arquitectura.md#4-frontend-angular).
