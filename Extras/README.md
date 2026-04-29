# Catalogo de Complementos y Herramientas (Extras)

Este documento lista lo disponible en `Extras/` con enlace de descarga/acceso, foto y descripcion breve.

## Complementos listos para publicar

| Nombre | Descarga | Foto | Descripcion breve |
|---|---|---|---|
| doom-browser | [Descargar ZIP](doom-browser.zip) · [Ver carpeta fuente](doom-browser/) | ![DOOM](Imagenes/DOOM.png) | Complemento `zip-static` para ejecutar DOOM en navegador embebido y validar runtime avanzado (WASM/workers/canvas) en la plataforma. |
| diccionario-logs-ciber (log helper) | [Descargar ZIP](diccionario-logs-ciber.zip) · [Ver carpeta fuente](diccionario-logs-ciber/) | ![Log helper 1](Imagenes/log-helper-1.png)<br>![Log helper 2](Imagenes/log-helper-2.png) | Complemento `zip-static` de apoyo SOC para consultar tags/campos de logs por fabricante con filtros de impacto y busqueda rapida. |

## Herramientas y muestras de referencia

| Nombre | Descarga / acceso | Foto | Descripcion breve |
|---|---|---|---|
| complement-stub | [Ver carpeta](complement-stub/) | Sin captura dedicada | Stub minimo para pruebas de integracion del contrato de complementos (registro, health-check y token). |
| complement-samples/no-db-static | [Ver carpeta](complement-samples/no-db-static/) | Sin captura dedicada | Ejemplo estatico sin backend para pruebas rapidas de embedding. |
| complement-samples/internal-db-local | [Ver carpeta](complement-samples/internal-db-local/) | Sin captura dedicada | Ejemplo con almacenamiento local/controlado para validaciones funcionales. |
| complement-samples/external-db-api | [Ver carpeta](complement-samples/external-db-api/) | Sin captura dedicada | Ejemplo de integracion con API o base externa para patrones de conectividad. |

## Nota operativa

- Para publicar en Admin > Complementos, usar preferentemente los ZIP listados arriba.
- Para carpetas de muestra sin ZIP, se puede comprimir el contenido y usar el flujo de analisis/preview/publicacion cuando corresponda al tipo de stack.
