# Diccionario Interactivo de Logs (Complemento Estatico)

Complemento `zip-static` para Bitacora SOC orientado a analistas. Permite interpretar tags de logs de ciberseguridad por fabricante, sin backend adicional y sin Docker.

## 1) Alcance funcional (COMP-DICT-083)

El complemento incluye:

- Vista por fabricante o consolidada (todos)
- Fabricantes/categorias actuales:
  - Huawei HiSec Insight
  - Fortinet FortiOS
  - Huawei Router (VRP / Info-Center)
  - Cisco Router (IOS XE / ACL Syslog)
- Buscador por texto libre (tag, significado o valores)
- Filtro por impacto (`High`, `Medium`, `Low`, `Info`, `Variable`)
- Tabla operativa por fabricante con:
  - tag
  - significado tecnico
  - valores comunes
  - badge de impacto
- Ejemplo de log por fabricante
- Exportacion a CSV por fabricante
- Estado resumido de resultados y atajo de teclado (`/` enfoca buscador)

## 2) Estructura del complemento

- `index.html` -> UI principal
- `styles.css` -> estilo responsive y visual
- `app.js` -> dataset embebido + logica de filtros/render

## 3) Instalacion y prueba local (sin plataforma)

### Opcion rapida

Abre `index.html` en el navegador.

### Opcion recomendada (simular uso web real)

Desde `tools/diccionario-logs-ciber/`:

```powershell
python -m http.server 8087
```

Luego abre [http://localhost:8087](http://localhost:8087).

## 4) QA funcional recomendado (checklist)

1. Cambiar fabricante y confirmar que:
   - cambia la tabla de tags
   - cambia ejemplo de log
2. Buscar por palabras como `ips`, `blocked`, `signal` y validar filtrado.
3. Probar filtro de impacto (`High`, `Medium`, `Low`, `Info`).
4. Usar `Limpiar` y confirmar reinicio de filtros.
5. Probar `Exportar a CSV` por fabricante y abrir el archivo generado.
6. Validar responsive en ancho movil (< 620 px).
7. Validar accesibilidad base:
   - foco visible en controles
   - `aria-live` actualiza contador/estado
   - tecla `/` enfoca buscador

## 5) Empaquetado ZIP (compresion)

El ZIP debe contener directamente `index.html`, `styles.css`, `app.js` (sin carpeta intermedia extra en la raiz del ZIP).

Desde la raiz del repo:

```powershell
if (Test-Path "tools/diccionario-logs-ciber.zip") { Remove-Item "tools/diccionario-logs-ciber.zip" }
Compress-Archive -Path "tools/diccionario-logs-ciber/*" -DestinationPath "tools/diccionario-logs-ciber.zip" -CompressionLevel Optimal
```

## 6) Publicacion en Bitacora SOC (Admin > Complementos)

1. Ir a `Admin > Complementos`.
2. `Analizar ZIP` y cargar `tools/diccionario-logs-ciber.zip`.
3. Revisar resultado de analisis (debe detectar `static-html`).
4. Ejecutar `Preview`.
5. Validar en preview:
   - selector
   - busqueda
   - filtro impacto
   - tabla y log
6. Ejecutar `Publicar`.
7. Confirmar que el `iframePath` del complemento publicado apunta a `index.html`.

## 7) Prueba despues de publicar

1. Ingresar como usuario con visibilidad al complemento.
2. Abrir el complemento desde sidebar.
3. Verificar que carga en `iframe` sin errores visuales.
4. Validar nuevamente filtros y exportacion CSV.

## 8) Uso operativo

Flujo sugerido para analista SOC:

1. Selecciona fabricante del dispositivo que emitio el log.
2. Busca el campo observado (tag) o palabra clave asociada.
3. Revisa impacto y valores frecuentes.
4. Compara con el ejemplo de log para interpretar contexto rapidamente.

## 9) Notas tecnicas

- No usa Docker.
- No requiere backend propio.
- Mantiene seguridad basica de render (escape de HTML para contenido dinamico).
- Diseñado para consulta visual y entrenamiento operativo.
- Se alinea visualmente a formato de tabla operativa (estilo documento tecnico).
- Huawei Router y Cisco Router estan separados porque el formato/tagging de logs es distinto.
- Huawei Router incluye guia tecnica de severidad VRP + patron de log para analisis rapido.

## 10) Fuentes de referencia para enriquecimiento de campos

- Fortinet Log Message Reference (campos `srcip`, `dstip`, `policyid`, `service`):
  - [Fortinet Docs - Log message fields](https://docs.fortinet.com/document/fortigate/6.4.0/fortios-log-message-reference/357866/log-message-fields)
- Cisco Wireless eventos/disassociation (contexto de `RSSI`, timeout de sesion, razones):
  - [Cisco Meraki - Common Wireless Event Log Messages](https://documentation.meraki.com/MR/Monitoring_and_Reporting/Common_Wireless_Event_Log_Messages)
  - [Cisco - Catalyst 9800 troubleshooting](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/213970-catalyst-9800-wireless-controllers-commo.html)
- Huawei security/log fields (campos de evento y red):
  - [Huawei Cloud - Log Field Description](https://support.huaweicloud.com/intl/en-us/usermanual-cfw/cfw_01_0147.html)
- Huawei VRP / Info-Center (formato de eventos tipo `%%01SECE/4/ARPMISS...`):
  - [Huawei Support - ejemplo de logbuffer ARPMISS](https://info.support.huawei.com/network/ptmngsys/Web/tsrev_s/en/content/s/25_edesk_ARP_Attack/edesk_ARP_Attack_edesk003.html)
- Cisco IOS XE (formato syslog `%FACILITY-SEVERITY-MNEMONIC` y severidades 0-7):
  - [Cisco IOS XE - Configuring System Message Logs](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-8/configuration_guide/sys_mgmt/b_178_sys_mgmt_9300_cg/configuring_system_message_logs.html)
  - [Cisco IOS XE - ACL Syslog Correlation](https://www.cisco.com/c/en/us/td/docs/routers/ios/config/17-x/sec-vpn/b-security-vpn/m_sec-acl-syslog-0.html)

## 11) Modulos de conocimiento incluidos en UI

- Correlacion cruzada entre Huawei HiSec, Fortinet, Cisco IOS y Huawei VRP.
- Troubleshooting rapido para codigos WLC/WAC (212/216, 1, 22).
- Guia rapida de anatomia para Huawei VRP y Cisco IOS.
- Tips de mitigacion operativa por fabricante.

## 12) Prompt maestro para version Angular (referencia)

```text
Contexto:
Estoy desarrollando una aplicacion en Angular para analistas de SOC.
La app tiene un Combobox para seleccionar un fabricante:
Huawei HiSec, Fortinet, Huawei Router, Cisco Router.

Tarea:
Genera el componente de visualizacion de "Diccionario Tecnico" con:

1) Data estructurada (JSON):
- Tag
- Significado (espanol tecnico)
- Valores (ejemplos reales)
- Impacto (High, Medium, Low) con colores

2) Logica de Quick Search:
- Filtrar por Tag y Significado.

3) Seccion Anatomia del Log:
- Cisco: [Seq]: [Time]: %[Facility]-[Sev]-[Mnemonic]: [Message]
- Huawei: %%[Version][Module]/[Sev]/[EventName]([Type]): [Content]

4) Estilo UI:
- Angular Material Cards para tags (si aplica)
- Dark mode tipo terminal SOC
- Impacto High con estilo visual fuerte
```
