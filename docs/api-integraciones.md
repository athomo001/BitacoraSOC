# API de integraciones y reenvío de eventos

Para quien conecta Bitácora Ops con un SIEM, un SOAR o un flujo de n8n. Hay dos piezas, y las dos se configuran en **Administración → Integraciones** (solo el admin):

- **Reenvío de eventos**: la app manda sus eventos a uno o varios SIEM por syslog o HTTP.
- **API de integraciones** (`/api/v1`): un sistema externo lee y crea entradas de la Bitácora y tickets, consulta quién está de guardia y arma el informe de incidente, con una llave de API.

La referencia de todas las rutas está en [api.md](api.md#api-de-integraciones). El diseño y sus decisiones, en `spec/19-integraciones-externas.md`.

---

## 1. Reenvío de eventos a un SIEM

### Cómo se envía

| Transporte | Para qué | Puerto típico |
| --- | --- | --- |
| Syslog UDP | Colectores que solo escuchan UDP. No confirma la entrega: si el SIEM está caído, los eventos se pierden. | 514 |
| Syslog TCP | Red interna de confianza. Un evento por línea. | 514 |
| Syslog TLS | Lo recomendado. TLS 1.2 o más; el certificado del SIEM se verifica siempre. Admite una CA propia y certificado de cliente (mTLS). | 6514 |
| HTTP | Splunk HEC, Elastic, un webhook, n8n. Solo `https://`. Un POST por evento (JSON) o en lotes (NDJSON, un evento por línea). Las cabeceras propias (token) van cifradas. | 443 / 8088 |

**Formato**: JSON (una línea por evento) o RFC 5424 con el JSON como mensaje (`APP-NAME` = `bitacora`, `MSGID` = el tipo de evento, facility local0, severidad según el nivel: 6 informativo, 4 advertencia, 3 error).

### Qué se manda

Cada destino elige sus grupos:

| Grupo (`group`) | Eventos |
| --- | --- |
| `auditoria` | Todo lo de Administración → Auditoría desde un nivel mínimo: ingresos y fallos, cambios de configuración, accesos denegados, respaldos. |
| `bitacora` | `entry.created`, `entry.updated`, `entry.deleted`, `entry.resolved`, `entry.comment_added`… con el texto completo, el tipo, las etiquetas, el autor y el cliente. |
| `escalamiento` | `escalation.incident.opened` y `closed`, `escalation.action` (cada llamado con su resultado), `escalation.notify.sent`. |
| `ticketera` | `ticket.created`, `ticket.updated`, `ticket.assigned`, `ticket.derived`, `ticket.comment_added`, `ticket.sla_breached`, `ticket.glpi_synced` (un ticket de GLPI que llegó o cambió)… con número, título, estado, prioridad, área y cliente. |

### Forma de un evento

```json
{"v":1,"ts":"2026-10-21T14:03:11.402Z","source":"bitacora","group":"ticketera","event":"ticket.sla_breached",
 "level":"warn","success":true,"actor":{"id":"…","name":"camila.rojas","role":"user"},
 "client":{"id":"…","name":"Casinos"},"object":{"type":"ticket","id":"…","ref":"TKT-2026-00039"},
 "data":{"sla":"resolution","title":"Fuerza bruta en VPN","status":"in_progress","priority":"p2_high","area":"SOC"},
 "node":"bitacora-1"}
```

- `v` cambia solo si se rompe la forma. Los campos nuevos se agregan sin cambiarla.
- `request` (IP, método, ruta) viene en los eventos de auditoría que salen de una llamada.
- Contraseñas, tokens y secretos nunca salen: pasan por el mismo saneado de la auditoría.
- Lo que hace una llave de API lleva `actor.role: "api"` y `actor.name: "jorge (API · n8n alarmas)"`.

### Si el SIEM se cae

Cada evento queda en la base antes de salir. Si un destino no responde, se reintenta (1 s, 2 s, 4 s… hasta 5 minutos) y los eventos esperan **hasta 7 días**; cuando vuelve, salen en orden. Lo que pasa de 7 días se cuenta como perdido. Tras **15 minutos** sin poder enviar llega un aviso a la campana de los administradores, y otro cuando vuelve. Con dos nodos, cada destino lo envía uno solo.

Un destino nuevo, o uno que se vuelve a encender, parte desde ese momento: no recibe lo anterior.

### Configuración del lado del SIEM

**Wazuh** (`/var/ossec/etc/ossec.conf` del manager), para Syslog TCP o UDP:

```xml
<remote>
  <connection>syslog</connection>
  <port>514</port>
  <protocol>tcp</protocol>
  <allowed-ips>10.20.0.10/32</allowed-ips> <!-- la IP de Bitácora Ops -->
</remote>
```

Con formato JSON, el decodificador `json` de Wazuh lee los campos solo. Una regla de ejemplo:

```xml
<group name="bitacora,">
  <rule id="100500" level="10">
    <decoded_as>json</decoded_as>
    <field name="source">bitacora</field>
    <field name="event">ticket.sla_breached</field>
    <description>Bitácora Ops: SLA vencido en $(object.ref)</description>
  </rule>
</group>
```

**Graylog**: crear un input **Syslog TCP** (o **Syslog TLS** con su certificado) en el puerto elegido y, en Bitácora Ops, formato **RFC 5424**. Para leer el JSON del mensaje, un extractor JSON sobre el campo `message`, o un input **Raw/Plaintext TCP** con un extractor JSON si se usa el formato JSON.

**Splunk HEC**: transporte HTTP, URL `https://splunk:8088/services/collector/raw`, cabecera `Authorization: Splunk <token>`, formato JSON y, si se quiere, **En lotes**.

**Elastic**: transporte HTTP a un pipeline de ingesta o a Logstash con `input { http { … } }`, cabecera `Authorization: ApiKey <llave>`.

Para probar: **Probar** en el destino manda un evento `bitacora.test` y muestra si llegó (o el error: conexión rechazada, certificado no válido, HTTP 403…).

---

## 2. API de integraciones (`/api/v1`)

### Llaves

- Se crean en **Administración → Integraciones → Llaves de API**: nombre, para qué sirve, permisos, clientes (todos o algunos), área de los tickets que crea y vencimiento (90 días, 1 año o sin vencimiento).
- La llave (`bop_` + 43 caracteres) **se muestra una sola vez**. La app guarda solo su huella. Si se pierde, se revoca y se crea otra.
- Lo que crea una llave queda a nombre de quien la creó, con la marca **API · nombre de la llave** en la Bitácora y la Ticketera. Si esa persona se da de baja, la llave se revoca sola.
- Cada llamada queda en el registro de la llave (90 días): ruta, permiso, estado, milisegundos e IP, incluidos los intentos con llave inválida.

### Permisos

| Permiso | Qué permite |
| --- | --- |
| `entries:read` | Leer entradas de la Bitácora de sus clientes. |
| `entries:write` | Crear entradas. |
| `oncall:read` | Ver quién está de guardia ahora y sus contactos (descifrados; canales `call`, `whatsapp`, `sms`, `email`, `other`). |
| `tickets:read` | Leer tickets con su estado, SLA y los comentarios visibles al cliente. |
| `tickets:write` | Crear tickets y comentarlos. |
| `reports:render` | Armar el informe de incidente (devuelve el HTML). |
| `reports:send` | Además, enviarlo por correo (solo a los dominios válidos de Reportes). |

### Reglas

- **Llave**: `X-API-Key: bop_…` o `Authorization: Bearer bop_…`; las dos valen igual.
- **Límite**: 600 llamadas cada 15 minutos por llave. Al pasarse, `429` con `Retry-After`.
- **Versión**: cada respuesta lleva `X-API-Version: v1`. Una versión que se retire avisa antes con la cabecera `Sunset`.
- **Respuestas**: `{"data": …, "meta": …}`. Errores en RFC 7807 (`application/problem+json`) con `type` (termina en el código de la tabla de abajo), `title`, `status` y `detail`.
- **Listados**: `limit` (1 a 100, 50 por defecto) y `cursor` (el `meta.nextCursor` de la página anterior).
- **Reintentos seguros**: los `POST` aceptan `Idempotency-Key`. La misma llave con la misma clave en 24 horas devuelve la misma respuesta sin repetir la acción (con `Idempotent-Replayed: true`). La misma clave con otro cuerpo responde `422`.
- **Clientes**: una llave limitada a algunos clientes no ve ni crea nada de los demás. `client` acepta el id o el nombre del cliente.

### Ejemplos con curl

Qué puede hacer la llave:

```bash
curl -s https://bitacora.ejemplo.cl/api/v1 -H "X-API-Key: $BOP_KEY"
```

Crear una entrada desde una alarma (el reintento con la misma `Idempotency-Key` no la duplica):

```bash
curl -s -X POST https://bitacora.ejemplo.cl/api/v1/entries \
  -H "X-API-Key: $BOP_KEY" \
  -H "Idempotency-Key: wazuh-5712" \
  -H "Content-Type: application/json" \
  -d '{"content":"Wazuh 5712: fuerza bruta en VPN desde 185.220.101.4","entryType":"incidente","scope":"soc","client":"Casinos","tags":["wazuh","vpn"]}'
```

`entryType`: `operativa` (por defecto), `incidente` u `ofensa`. `scope`: `soc`, `noc` o `general` (por defecto). Si el cliente tiene un solo servicio, la entrada queda en ese servicio; si no, con la etiqueta `cliente:Nombre`.

Abrir un ticket (va a la cola del área de la llave):

```bash
curl -s -X POST https://bitacora.ejemplo.cl/api/v1/tickets \
  -H "X-API-Key: $BOP_KEY" \
  -H "Idempotency-Key: wazuh-5712-ticket" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fuerza bruta en VPN","description":"312 intentos fallidos en 10 minutos","type":"incident","client":"Casinos","impact":"medium","urgency":"high"}'
```

`type`: `incident` o `service_request`. `impact`: `low`, `medium` o `high`; `urgency` además `critical`.

Comentarlo (por defecto es una nota interna; con `"public": true` lo ve el cliente). Un ticket `GLPI-…` responde `409 glpi-readonly`: se comenta en GLPI.

```bash
curl -s -X POST https://bitacora.ejemplo.cl/api/v1/tickets/TKT-2026-00061/comments \
  -H "X-API-Key: $BOP_KEY" -H "Content-Type: application/json" \
  -d '{"content":"IP bloqueada en el firewall perimetral."}'
```

Consultar un ticket y los que cambiaron desde una hora:

```bash
curl -s https://bitacora.ejemplo.cl/api/v1/tickets/TKT-2026-00061 -H "X-API-Key: $BOP_KEY"
curl -s "https://bitacora.ejemplo.cl/api/v1/tickets?since=2026-10-21T13:00:00Z&status=in_progress" -H "X-API-Key: $BOP_KEY"
```

A quién llamar ahora:

```bash
curl -s https://bitacora.ejemplo.cl/api/v1/oncall -H "X-API-Key: $BOP_KEY"
```

```json
{"data":[{"id":"…","name":"Guardia N2 SOC","client":null,"onCall":[{"name":"camila.rojas","since":"2026-10-20T12:00:00Z","until":"2026-10-27T12:00:00Z",
  "channels":[{"type":"call","value":"+56 9 1234 5678","preferred":true},{"type":"email","value":"camila@ejemplo.cl","preferred":false}]}]}]}
```

Armar el informe de incidente (los mismos campos que Reportes → Informe de incidente) y, con `reports:send`, enviarlo:

```bash
curl -s -X POST https://bitacora.ejemplo.cl/api/v1/reports/incident \
  -H "X-API-Key: $BOP_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"<id del cliente>","incident":{"nombreEvento":"Fuerza bruta en VPN","criticidad":"Alta","fecha":"21-10-2026 11:03","motivoEvento":"…","recomendacion":"…"},
       "send":true,"to":["soc@cliente.cl"],"subject":"Incidente de seguridad · Casinos"}'
```

El envío pasa por las mismas reglas que la pantalla: los destinatarios tienen que ser de los dominios válidos de Reportes y, si el cliente tiene un aviso que pide «Leí el aviso», quien creó la llave tiene que haberlo confirmado (si no, `409 client-alert-pending`).

### Un flujo de n8n

1. **Webhook** (o el nodo del SIEM): recibe la alarma.
2. **IF**: solo las de nivel alto (por ejemplo, `rule.level >= 10` en Wazuh).
3. **HTTP Request** → `POST /api/v1/entries`, con la credencial **Header Auth** (`X-API-Key`) y la cabecera `Idempotency-Key` = el id de la alarma.
4. **HTTP Request** → `POST /api/v1/tickets` con la misma idea (`Idempotency-Key` = id de la alarma + `-ticket`).
5. **HTTP Request** → `GET /api/v1/oncall` para avisar por el canal que se use.

Con `Idempotency-Key` en los pasos 3 y 4, si n8n reintenta (o se ejecuta dos veces) no se duplica nada.

### Códigos de error

| Estado | `type` | Qué pasó |
| --- | --- | --- |
| 401 | `api-key-required`, `api-key-invalid`, `api-key-revoked`, `api-key-expired` | Falta la llave, no existe, se revocó o venció. |
| 403 | `insufficient-scope` | La llave no tiene el permiso de esa ruta. |
| 403 | `module-disabled` | La Ticketera está apagada. |
| 400 | `invalid-client`, `invalid-payload`, `invalid-query` | Cliente fuera de los de la llave, cuerpo o parámetros inválidos (el `detail` dice cuál). |
| 409 | `glpi-readonly`, `idempotency-in-progress`, `invalid-area` | Ticket de GLPI, la misma clave todavía en curso, o el área de la llave ya no recibe tickets. |
| 422 | `idempotency-key-reused` | Esa `Idempotency-Key` ya se usó con otro cuerpo. |
| 429 | `rate-limited` | Límite de llamadas; esperar lo que dice `Retry-After`. |
