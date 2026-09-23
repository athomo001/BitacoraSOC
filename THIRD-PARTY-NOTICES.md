# Avisos de terceros — BitacoraSOC 2.0

## Datos territoriales

`seed/territorial_units_chile.json` (y cualquier otro seed generado con `backend-go/cmd/territorial-seed`) se deriva de **countries-states-cities-database** de dr5hn — <https://github.com/dr5hn/countries-states-cities-database> — distribuida bajo **Open Database License (ODbL) v1.0** (<https://opendatacommons.org/licenses/odbl/1-0/>).

> División administrativa cargada desde countries-states-cities-database (dr5hn), licencia ODbL v1.0.

ODbL aplica a la base de datos en sí, no al código de BitacoraSOC que la consume (ver `spec/03b-guia-import-territorial.md` sección 2). La misma atribución se muestra en la pantalla de Administración → Territorio.

## Fuentes tipográficas

Geist Sans, JetBrains Mono, VT323 y Orbitron: SIL Open Font License 1.1. Material Icons: Apache 2.0. Las licencias completas viajan junto a los archivos en `frontend-v2/public/fonts/`.

**Gotham** (`frontend-v2/public/assets/fonts/`, usada por el tema de login "Moderno"): copiada tal cual del frontend legacy (`frontend/src/assets/fonts/`). Es una fuente **comercial** de Hoefler&Co., no de licencia libre — verificar que la organización tiene la licencia web correspondiente antes de publicar el rewrite; si no, reemplazarla (el CSS ya cae a `Segoe UI`/`Roboto`).

## Librerías

- **anime.js 3.2.2** (MIT) — animaciones de encendido/apagado/glitch del tema de login CRT, misma versión que el legacy.
