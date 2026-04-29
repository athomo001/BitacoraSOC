# DOOM Browser (Complemento Estatico)

Complemento `zip-static` para ejecutar DOOM clasico en navegador dentro de Bitacora SOC, sin Docker y sin backend extra.

## Estructura

- `index.html`
- `styles.css`
- `app.js`

## Uso local rapido

1. **Recomendado (HTTP local, Windows):** doble clic en **`run-local.cmd`** (usa Python o `npx` via CMD; evita el bloqueo de PowerShell a `npx.ps1`). Alternativa: `python -m http.server 5173` en esta carpeta. Si insistes en PowerShell y `npx` falla por *ExecutionPolicy*, usa **`npx.cmd --yes serve -l 5173`**. Luego abre `http://127.0.0.1:5173/` **solo con la ventana del servidor abierta** (error -102 = nada escuchando en ese puerto).
2. Presionar `Iniciar DOOM`.
3. Usar `Pantalla completa` si se desea.

### QA: por que `file://` a veces "no cuenta"

Abrir `index.html` con doble clic (`file:///...`) usa origen opaco y politicas distintas. En **Chrome, Brave y Edge** suele fallar el encadenamiento **Worker + WASM + lectura de archivos** que usa js-dos, aunque los archivos esten en disco. No es que "el sistema no aguante": es **seguridad del navegador**. Por eso el flujo soportado para prueba local es **servir la carpeta por HTTP** (un comando, sin Docker).

### Bug corregido (v0.7.0)

No mezclar **js-dos v8** (CDN) con **`vendor/js-dos-622.js`**: el segundo redefine `window.Dos` y las opciones tipo `{ url: ...jsdos }` de v8 sobre la API 6.22 producen **promesas rechazadas** y estados incoherentes (mensaje "v8" pero pie "6.22").

## Publicacion en plataforma

1. Comprimir el contenido de `tools/doom-browser/` en ZIP (sin carpeta contenedora extra).
2. Ir a `Admin > Complementos`.
3. Ejecutar `Analizar ZIP`.
4. Ejecutar `Preview`.
5. Ejecutar `Publicar`.
6. Verificar carga del `iframe` y controles de inicio.

### Preset recomendado en Admin > Complementos (runtime policy)

Para este complemento (emulador WASM/js-dos), usar este preset minimo:

- `CSP > script-src unsafe-eval`: **Activado**
- `CSP > worker-src blob:`: **Activado**
- `CSP > extra connect-src`: vacio
- `CSP > extra child-src`: vacio
- `Iframe sandbox > allowPointerLock`: **Activado**
- `Iframe sandbox > allowPopups`: Desactivado
- `Iframe sandbox > allowDownloads`: Desactivado

### Checklist de salida (publicacion)

1. Confirmar que el complemento publicado muestra `Build v0.8.0`.
2. Iniciar DOOM y verificar:
   - carga completa sin quedarse en 0%.
   - teclado operativo tras clic en el canvas.
   - `FPS` visible en la barra de controles.
3. Probar `Pantalla completa`.
4. Confirmar que no aparecen errores en consola del navegador relacionados a CSP/sandbox/WASM.

## Notas operativas

- Runtime alineado **npm `js-dos@6.22.60`**: `vendor/js-dos.js`, `vendor/wdosbox.js`, **`vendor/wdosbox.wasm.js`** (sin este archivo el progreso queda ~0% y en el servidor HTTP se ve **404**), mas `vendor/DOOM-@evilution.zip`.
- El contenedor raiz de `Dos(...)` debe ser un **`<canvas>`** (no un `div`): de lo contrario aparece `canvas.getContext is not a function`.
- **Teclado:** js-dos monta un teclado virtual (`.qwerty-input`, `tabIndex=1`) que hace `stopPropagation` de teclas; si el foco cae ahi tras deshabilitar el boton Iniciar, el juego no recibe teclas. En `app.js` se fuerza `blur`/`tabIndex=-1` y foco al canvas; en iframe hace falta `allow-pointer-lock` si usas `autolock`.
- El UI muestra `Build vX.Y.Z` para validar el ZIP publicado.
- En Bitacora SOC el complemento se sirve por `http(s)://`; conviene activar politicas de runtime si el host las aplica (eval/workers).

## Licencia y contenido

- El runtime del emulador y los assets del juego pueden tener licencias propias.
- Para redistribucion comercial/estricta, validar siempre licencias del paquete de juego usado.
