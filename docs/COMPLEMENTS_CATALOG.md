# Catalogo de Complementos de Prueba

Complementos listos para cargar en la plataforma desde `Extras/`.
Cada uno se publica desde Admin > Complementos usando el flujo `Analizar ZIP → Preview → Publicar`.

---

## doom-browser

Complemento `zip-static` que ejecuta DOOM en el navegador embebido.
Sirve para validar el soporte de runtime avanzado (WebAssembly, workers, canvas) en la plataforma sin levantar servicios adicionales.

- **Tipo**: `zip-static`
- **Archivo**: `Extras/doom-browser.zip`
- **Fuente**: `Extras/doom-browser/`

![DOOM browser](../Extras/Imagenes/DOOM.png)

---

## diccionario-logs-ciber

Complemento `zip-static` de apoyo SOC para consultar tags y campos de logs por fabricante.
Permite busqueda rapida, filtro por nivel de impacto y comparacion de ejemplos reales de log entre marcas (Huawei HiSec, Fortinet FortiOS, Huawei WAC/Cisco WLC).

- **Tipo**: `zip-static`
- **Archivo**: `Extras/diccionario-logs-ciber.zip`
- **Fuente**: `Extras/diccionario-logs-ciber/`

![Log helper — vista principal](../Extras/Imagenes/log-helper-1.png)

![Log helper — detalle de tarjetas](../Extras/Imagenes/log-helper-2.png)

---

## Documentos relacionados

- `docs/COMPLEMENTS.md`: guia tecnica del modulo de complementos (flujos, API, seguridad, despliegue)
- `Extras/README.md`: catalogo completo incluyendo muestras de referencia y stub de integracion
