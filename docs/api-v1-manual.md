# Manual de Integración - API Externa v1 (Bitácora SOC)

Este manual documenta de forma técnica y exhaustiva la integración con la API pública externa de la Bitácora SOC (versión 1) orientada a sistemas externos, automatizaciones y plataformas SOAR.

---

## 1. Construcción de la URL Base (Base URL)

Todos los endpoints listados en esta documentación son rutas relativas (ej. `/api/v1/users`). Para consumirlos programáticamente o mediante clientes REST (ej: Postman, Insomnia, SOAR, etc.), debe anteponer la dirección del servidor Backend de la Bitácora.

La URL final se construye como: `[URL_BASE] + [ENDPOINT]`

### Ejemplos de URLs Completas:
* **Entorno Local (Desarrollo):**
  * Servidor Base: `http://localhost:3000`
  * URL en Postman: `http://localhost:3000/api/v1/templates/render`
* **Entorno de Servidor (Producción):**
  * Servidor Base: `http://<IP_DE_TU_SERVIDOR>:3000` (o `https://<DOMINIO_DE_TU_BITACORA>` si está detrás de un proxy como Nginx)
  * URL en Postman/SOAR: `https://dominio-bitacora.com/api/v1/templates/render`

---

## 2. Autenticación y Seguridad

Todas las solicitudes a la API externa deben incluir una clave de API válida y en estado activo. La clave debe enviarse en todas las solicitudes utilizando cualquiera de las siguientes opciones de cabecera HTTP:

1. **Cabecera `X-API-KEY` (Recomendada):**
   ```http
   X-API-KEY: bsoc_key_tu_token_aqui
   ```
2. **Cabecera `Authorization` (Bearer Token):**
   ```http
   Authorization: Bearer bsoc_key_tu_token_aqui
   ```

*Nota: Las claves de API tienen el prefijo `bsoc_key_` seguido de una cadena alfanumérica segura.*

---

## 2. Endpoints Disponibles y Permisos (Scopes)

Cada clave de API posee un conjunto granular de permisos configurados por el Administrador. Si intenta consumir un recurso sin contar con el permiso adecuado, la API responderá con un error `403 Forbidden`.

### A. Consultar Usuarios Activos del SOC
* **Endpoint:** `GET /api/v1/users`
* **Permiso requerido (Scope):** `users:read`
* **Descripción:** Retorna una lista simplificada de los usuarios activos del SOC.
* **Respuesta Exitosa (JSON):**
  ```json
  {
    "success": true,
    "count": 1,
    "users": [
      {
        "username": "analista1",
        "fullName": "Athan Espinoza",
        "role": "admin",
        "email": "aespinoza@soc.com",
        "createdAt": "2026-01-10T12:00:00.000Z"
      }
    ]
  }
  ```

---

### B. Listar y Consultar Eventos de Bitácora
* **Endpoint:** `GET /api/v1/events` (Lista eventos) o `GET /api/v1/events/:id` (Busca un evento por ID)
* **Permiso requerido (Scope):** `events:read`
* **Parámetros de consulta (Query params):**
  * `page` (opcional, default: 1): Número de página.
  * `limit` (opcional, default: 20, máx: 100): Cantidad de registros por página.
* **Respuesta Exitosa (JSON):**
  ```json
  {
    "success": true,
    "pagination": {
      "total": 120,
      "page": 1,
      "limit": 20,
      "pages": 6
    },
    "events": [
      {
        "_id": "603f7f8b9b1c2b001f3e4e5d",
        "content": "Evento operativo registrado durante el turno.",
        "entryType": "operativa",
        "entryDate": "2026-07-09T14:40:00.000Z",
        "entryTime": "14:40",
        "tags": ["Incidente", "Malware"],
        "createdByUsername": "analista1",
        "createdAt": "2026-07-09T14:40:05.000Z"
      }
    ]
  }
  ```

---

### C. Registrar Nuevo Evento en Bitácora (Ingesta Automática)
* **Endpoint:** `POST /api/v1/events`
* **Permiso requerido (Scope):** `events:write`
* **Descripción:** Permite a alarmas automáticas o parsers de Syslog inyectar un log directamente en el turno activo.
* **Payload JSON:**
  ```json
  {
    "content": "Alerta automática: Enlace ISP primario inestable. Pérdida de paquetes 45%.", // Requerido (String)
    "entryType": "operativa",                                                           // Opcional (String: operativa, administrativa, etc.)
    "tags": ["Infraestructura", "Alerta"],                                             // Opcional (Array de Strings)
    "clientName": "SOC Global"                                                         // Opcional (String)
  }
  ```
* **Respuesta Exitosa (JSON - HTTP 201):**
  ```json
  {
    "success": true,
    "message": "Evento registrado exitosamente en la bitácora",
    "event": {
      "_id": "603f7f8b9b1c2b001f3e4e5e",
      "content": "Alerta automática: Enlace ISP primario...",
      "entryType": "operativa",
      "entryDate": "2026-07-09T14:42:00.000Z",
      "entryTime": "14:42",
      "tags": ["Infraestructura", "Alerta"],
      "createdByUsername": "Integracion-SIEM"
    }
  }
  ```

---

### D. Consultar Contactos y Turnos de Escalación
* **Endpoint:** `GET /api/v1/escalations`
* **Permiso requerido (Scope):** `escalations:read`
* **Descripción:** Obtiene los turnos operativos activos (N1, N2, TI) y el directorio completo de contactos válidos.
* **Respuesta Exitosa (JSON):**
  ```json
  {
    "success": true,
    "timestamp": "2026-07-09T14:42:10.000Z",
    "internalShifts": [
      {
        "role": "N2",
        "assignedUser": "Carlos Mendoza",
        "email": "cmendoza@soc.com"
      }
    ],
    "contacts": [
      {
        "_id": "603f7f8b9b1c2b001f3e4e5f",
        "name": "Mesa de Ayuda Cliente A",
        "email": "soporte@clientea.com",
        "phone": "+56912345678"
      }
    ]
  }
  ```

---

### E. Renderizar Plantilla de Incidentes (Integración SOAR / HTML)
* **Endpoint:** `POST /api/v1/templates/render`
* **Permiso requerido (Scope):** `templates:render`
* **Descripción:** Genera el HTML final del correo de incidente (MJML -> HTML). También puede enviarlo por SMTP de la Bitácora si se usa `sendEmail: true`.

> [!IMPORTANT]
> Para que la Bitácora efectivamente despache el correo al destinatario final, debes enviar `sendEmail: true`.
> Si no envías ese campo (o va en `false`), solo obtendrás la plantilla `html`/`text` en la respuesta, pero no se enviará ningún correo.

#### Contrato real del endpoint (importante)

**Regla de oro para entrega real de correo desde Bitácora:**

* Debe venir `sendEmail: true`
* Debe venir `to` como arreglo con al menos 1 correo
* Debe existir SMTP configurado y activo en la Bitácora

**Campos obligatorios para que procese correctamente:**

* `reportData` (objeto)
* Dentro de `reportData`, al menos uno de estos campos con valor: `logSource` o `clientName` o `cliente`

**Campos obligatorios solo si quieres que la Bitácora envíe el correo (`sendEmail: true`):**

* `to` como arreglo con al menos 1 destinatario

> Si `sendEmail` no se envía o es `false`, el endpoint igual responde con `html` y `text` para que los envíes desde n8n/SOAR/otro sistema.

#### Campos soportados (request)

| Campo | Tipo | Requerido | Detalle |
|---|---|---|---|
| `to` | `string[]` | Condicional | Requerido solo cuando `sendEmail=true`. |
| `subject` | `string` | No | Asunto. Si no viene, se autogenera. |
| `sendEmail` | `boolean` | No | `true`: intenta envío SMTP interno. `false`/omitido: solo renderiza. |
| `paletteKey` | `string` | No | Valores: `cdc-verde`, `noche-azul`, `slate-pro`, `carbon`, `indigo`, `bosque`. |
| `reportData` | `object` | Si | Datos del incidente. |
| `images` | `object[]` | No | Evidencias embebidas en base64. |

**Subcampos de `reportData`:**

| Campo | Tipo | Requerido | Uso en plantilla |
|---|---|---|---|
| `logSource` | `string` | Condicional | Sirve para validar el reporte y se muestra como fuente/log source. |
| `clientName` | `string` | Condicional | Alternativa válida a `logSource` para cumplir validación. |
| `cliente` | `string` | Condicional | Alternativa válida a `logSource` para cumplir validación. |
| `criticidad` | `string` | No | Recomendado: `critica`, `alta`, `media`, `baja`, `informativa`. |
| `ofensa` | `string` | No | Número/código de ofensa. |
| `tipoOperacion` | `string` | No | Tipo de operación. |
| `nombreEvento` | `string` | No | Nombre principal del evento. |
| `motivoEvento` | `string` | No | Motivo del evento. |
| `origenConexion` | `string` | No | IP/FQDN origen. |
| `destino` | `string` | No | IP/FQDN destino. |
| `reputacionOrigen` | `string` | No | Etiqueta de reputación. |
| `observaciones` | `string` | No | Texto libre, se escapa en HTML. |
| `recomendacion` | `string` | No | Recomendación operativa. |
| `evidenciaTexto` | `string` | No | Texto técnico para la sección de evidencia. |

**Subcampos de `images[]`:**

| Campo | Tipo | Requerido | Regla |
|---|---|---|---|
| `name` | `string` | Recomendado | Nombre de archivo (ej: `captura_1.png`). |
| `contentType` | `string` | Recomendado | Mime image: `image/png`, `image/jpeg`, etc. |
| `contentBase64` | `string` | Sí (si hay imagen) | Base64 puro, sin prefijo `data:image/...;base64,`. |

#### Payload mínimo válido (solo renderizar HTML)

```json
{
  "reportData": {
    "logSource": "Firewall Principal",
    "criticidad": "alta",
    "nombreEvento": "Conexion sospechosa a C2"
  }
}
```

#### Payload válido para renderizar y enviar por SMTP interno

```json
{
  "to": ["soc@cliente.com", "oncall@cliente.com"],
  "subject": "Alerta de Incidente - Prioridad Alta",
  "sendEmail": true,
  "paletteKey": "cdc-verde",
  "reportData": {
    "logSource": "WindowsAuthServer",
    "criticidad": "alta",
    "ofensa": "1784295590",
    "tipoOperacion": "Acceso no autorizado",
    "nombreEvento": "Acceso a objeto sensible",
    "motivoEvento": "Evento 4663 con patron inusual",
    "origenConexion": "172.16.170.1",
    "destino": "172.16.170.1",
    "reputacionOrigen": "Interno",
    "observaciones": "Se detectaron multiples accesos sobre ruta critica en corto intervalo.",
    "recomendacion": "Revisar usuario, aislar host comprometido y validar integridad del endpoint.",
    "evidenciaTexto": "EventID=4663, AccessMask=0x50, Host=SCJFPSPS01"
  },
  "images": [
    {
      "name": "evidencia-1.png",
      "contentType": "image/png",
      "contentBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

#### Respuesta (HTTP 200)

```json
{
  "success": true,
  "emailSent": true,
  "emailError": null,
  "subject": "Alerta de Incidente - Prioridad Alta",
  "html": "<!doctype html><html ...>...</html>",
  "text": "Reporte de Deteccion..."
}
```

> Nota operacional: el endpoint puede responder `success: true` y `emailSent: false` si el render fue exitoso pero el envío SMTP falló. En ese caso revisa `emailError`.

---

## 3. Códigos de Estado Comunes

* **`200 OK`**: Petición procesada de forma correcta.
* **`201 Created`**: Recurso creado exitosamente (ej: evento registrado).
* **`400 Bad Request`**: Datos inválidos o faltantes. Casos típicos:
  * Falta `reportData`.
  * Dentro de `reportData` no viene ninguno entre `logSource`, `clientName` o `cliente`.
  * `sendEmail=true` y falta `to` (arreglo) o está vacío.
* **`401 Unauthorized`**: Token de API ausente, mal formateado, inválido, expirado o revocado.
* **`403 Forbidden`**: La clave de API es válida pero no tiene asignado el scope necesario para el endpoint.
* **`500 Internal Server Error`**: Ocurrió un error inesperado al procesar la solicitud en el servidor.

---

## 4. Ejemplos de Implementación Práctica

### Ejemplo en Python (librería `requests`)
```python
import requests

url = "http://localhost:3000/api/v1/templates/render"
headers = {
    "X-API-KEY": "bsoc_key_tu_token_aqui",
    "Content-Type": "application/json"
}

payload = {
    "to": ["seguridad@empresa.com"],
    "subject": "Incidente detectado por SOAR",
    "reportData": {
        "logSource": "CrowdStrike_EDR",
        "criticidad": "critica",
        "nombreEvento": "Ejecución de credenciales Mimikatz",
        "origenConexion": "10.0.10.45",
        "observaciones": "Se detectó volcado de memoria de LSASS en el controlador de dominio principal.",
        "recomendacion": "Aislar de inmediato el Host comprometido y forzar cambio de contraseña corporativa."
    }
}

response = requests.post(url, json=payload, headers=headers)

if response.status_code == 200:
    data = response.json()
    html_content = data["html"]
    print("Plantilla compilada exitosamente!")
    # Aquí puede enviar el HTML mediante el servicio de correo del SOAR
else:
    print(f"Error ({response.status_code}): {response.text}")
```

### Ejemplo cURL (rápido para validar JSON)

```bash
curl -X POST "http://localhost:3000/api/v1/templates/render" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: bsoc_key_tu_token_aqui" \
  -d '{
    "reportData": {
      "logSource": "Firewall Principal",
      "criticidad": "media",
      "nombreEvento": "Prueba de integracion"
    }
  }'
```

---

## 5. Integración detallada con n8n

Esta es la forma recomendada para evitar errores de formato y controlar mejor el correo final.

### Flujo recomendado en n8n (2 modos)

> [!IMPORTANT]
> Si tu objetivo es que llegue un correo real desde Bitácora, usa siempre el Modo A con `sendEmail: true`.
> Si usas Modo B, n8n (o tu herramienta externa) es quien debe enviarlo después; Bitácora no lo enviará automáticamente.

**Modo A: Render + envío desde Bitácora**

1. Nodo `HTTP Request` a `POST /api/v1/templates/render`.
2. En Body JSON envía `sendEmail: true` y `to: [...]`.
3. Revisa en salida `emailSent` y `emailError`.

**Modo B: Render en Bitácora + envío desde n8n (más flexible)**

1. Nodo `HTTP Request` a `POST /api/v1/templates/render` con `sendEmail: false` (o sin el campo).
2. Toma `{{$json.html}}` como cuerpo HTML.
3. Nodo de correo en n8n (`Email Send`, SMTP, Outlook, Gmail, etc.) usando ese HTML.

Modo B es ideal cuando quieres agregar bloques personalizados (tablas, firmas, disclaimers) antes de enviar.

### Configuración del nodo HTTP Request en n8n

* Method: `POST`
* URL: `http://localhost:3000/api/v1/templates/render` (o tu URL productiva)
* Headers:
  * `X-API-KEY`: `bsoc_key_...`
  * `Content-Type`: `application/json`
* Body Content Type: `JSON`
* JSON Body (ejemplo base):

```json
{
  "sendEmail": false,
  "paletteKey": "cdc-verde",
  "reportData": {
    "logSource": "SIEM-QRadar",
    "criticidad": "alta",
    "nombreEvento": "Multiple failed logons",
    "observaciones": "Se detecta alza de autenticaciones fallidas en servidor critico.",
    "recomendacion": "Bloquear origen temporalmente y revisar cuenta comprometida."
  }
}
```

### Enviar el HTML en n8n

En tu nodo de correo:

* Subject: `{{$json.subject || "Reporte de Deteccion"}}`
* HTML: `{{$json.html}}`
* Text (opcional): `{{$json.text}}`

### Agregar una tabla HTML personalizada (caso imagen 1)

Si necesitas una tabla como bloque adicional, usa un nodo `Code` entre el render y el nodo de correo:

```javascript
const baseHtml = $json.html || '';

const statsTable = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:16px 0;font-family:Arial,sans-serif;">
  <tr>
    <th align="left" style="background:#0b3a6e;color:#ffffff;padding:8px;border:1px solid #d9d9d9;">Metrica</th>
    <th align="left" style="background:#0b3a6e;color:#ffffff;padding:8px;border:1px solid #d9d9d9;">Valor</th>
  </tr>
  <tr>
    <td style="padding:8px;border:1px solid #d9d9d9;">Total Eventos</td>
    <td style="padding:8px;border:1px solid #d9d9d9;">17</td>
  </tr>
  <tr>
    <td style="padding:8px;border:1px solid #d9d9d9;">Cantidad IPs Origen</td>
    <td style="padding:8px;border:1px solid #d9d9d9;">1</td>
  </tr>
</table>`;

// Inserta la tabla antes del cierre del body
const mergedHtml = baseHtml.includes('</body>')
  ? baseHtml.replace('</body>', `${statsTable}</body>`)
  : `${baseHtml}${statsTable}`;

return [{
  json: {
    ...$json,
    html: mergedHtml
  }
}];
```

Con esto evitas que la tabla llegue "como texto plano" y aseguras estructura compatible con clientes de correo.

---

## 6. Errores comunes (y cómo evitarlos)

### Error 1: JSON inválido

**Síntoma:** 400 o parsing error.

**Causa típica:** enviar JSON con comentarios (`//`), comas finales, o comillas mal cerradas.

**Regla:** JSON de API siempre debe ir sin comentarios.

### Error 2: `Se requiere cliente o logSource...`

**Síntoma:** 400 con mensaje de validación.

**Causa:** `reportData` sin `logSource`, `clientName` ni `cliente`.

**Solución:** incluir al menos uno de esos campos con texto no vacío.

### Error 3: `sendEmail=true` pero no envía

**Síntoma:** respuesta con `success: true`, `emailSent: false`, `emailError` con detalle.

**Causa:** configuración SMTP faltante/incorrecta, destinatarios vacíos o bloqueo de relay.

**Solución:** revisar configuración SMTP del sistema y campo `to`.

### Error 4: imágenes no se ven

**Síntoma:** evidencia en blanco o adjunto roto.

**Causas típicas:**

* `contentBase64` viene con prefijo `data:image/...;base64,` (no debe venir).
* `contentType` no corresponde al contenido real.
* Base64 cortado o con caracteres inválidos.

### Error 5: tablas o HTML llegan mal (caso imagen 2)

**Síntoma:** se ve desordenado o se pierde contenido.

**Causas típicas:**

* Intentar insertar HTML dentro de campos de texto de `reportData` (se escapan por seguridad).
* CSS complejo no compatible con clientes de correo.

**Solución recomendada:** renderizar primero con `/templates/render`, luego inyectar tabla en `html` desde n8n (nodo `Code`) y enviar con nodo SMTP/Email.

---

## 7. Guía de Inicio Rápido con Postman (Paso a Paso)

Si vas a realizar pruebas manuales o validar tus credenciales usando **Postman**, sigue este procedimiento exacto paso a paso para evitar errores comunes de formato:

### Paso 1: Configurar el Tipo de Petición y la URL
1. En Postman, abre una nueva pestaña de petición.
2. Cambia el método HTTP a **`POST`** (en el selector desplegable de la izquierda).
3. En la barra de direcciones, ingresa la URL completa sin agregar signos `=` ni llaves:
   * **Desarrollo Local:** `http://localhost:3000/api/v1/templates/render`
   * **Servidor de Producción:** `https://tu-dominio-soc.com/api/v1/templates/render`

> [!CAUTION]
> **Error Común:** Nunca coloques el JSON del mensaje o el signo de igualdad `=` dentro de la barra de direcciones de la URL. La URL debe terminar limpia exactamente en la palabra `/render`.

### Paso 2: Configurar la Clave de API (Autenticación)
1. Ve a la pestaña **`Authorization`** (debajo de la barra de la URL).
2. En el campo **`Type`**, selecciona **`Bearer Token`** en el menú desplegable.
3. En el campo **`Token`** que aparece a la derecha, pega tu API Key completa (`bsoc_key_...`).

> [!NOTE]
> Postman se encargará de inyectar la cabecera `Authorization: Bearer bsoc_key_...` de forma automática al momento de enviar la solicitud.

### Paso 3: Configurar los Datos del Cuerpo (JSON Payload)
1. Ve a la pestaña **`Body`** (ubicada entre *Headers* y *Pre-request Script*).
2. Selecciona el botón de opción **`raw`**.
3. En el selector de formato que aparece a la derecha (donde dice *Text* de forma predeterminada), cámbialo a **`JSON`**.
4. Pega el payload JSON sin comentarios de línea en el área de texto:
   ```json
   {
     "to": ["tu-correo@netics.cl"],
     "sendEmail": true,
     "reportData": {
       "logSource": "Firewall Principal",
       "criticidad": "alta",
       "nombreEvento": "Detección de malware"
     }
   }
   ```

> [!TIP]
> Si estás validando solo formato/plantilla, usa `sendEmail: false` (o elimina el campo) y revisa `html` en la respuesta.

### Paso 4: Dejar la pestaña Params Vacía
1. Asegúrate de que la pestaña **`Params`** (Query Params) no tenga ninguna clave o valor configurado. La tabla debe estar completamente limpia.

### Paso 5: Enviar la Petición
1. Haz clic en el botón azul **`Send`**.
2. Deberías recibir una respuesta con código de estado `200 OK` y el JSON que confirma el envío.

