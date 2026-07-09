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
* **Descripción:** Procesa el JSON de un incidente, incrusta evidencias y compila el HTML autoadaptable de la Bitácora (usando MJML). El SOAR puede enviar este HTML por correo de forma limpia.
* **Payload JSON:**
   ```json
  {
    "to": ["destinatario@dominio-soc.com"], // Requerido (Array). Correos autorizados
    "subject": "Alerta de Incidente de Seguridad - Prioridad Alta", // Opcional (String)
    "sendEmail": true, // Opcional (Boolean). Si es true, envía el correo directamente usando el SMTP de la Bitácora
    "paletteKey": "cdc-verde", // Opcional (String: cdc-verde, noche-azul, slate-pro, carbon, indigo, bosque)
    "reportData": {
      "logSource": "Firewall Principal",   // Requerido (String)
      "criticidad": "alta",                // Requerido (String: critica, alta, media, baja, informativa)
      "ofensa": "99812",                   // Opcional
      "tipoOperacion": "Exfiltración",     // Opcional
      "nombreEvento": "Tráfico hacia IP maliciosa", // Opcional
      "motivoEvento": "Conexión a puerto 4444 de C2", // Opcional
      "origenConexion": "192.168.10.15",   // Opcional
      "destino": "203.0.113.5",            // Opcional
      "reputacionOrigen": "Interno",       // Opcional
      "observaciones": "Se detectó transferencia inusual de archivos.", // Opcional
      "recomendacion": "Bloquear la IP de destino en el Firewall perimetral y aislar el host local.", // Opcional
      "evidenciaTexto": "Logs del Firewall:\nJul 09 14:40:00 192.168.10.15 -> 203.0.113.5:4444" // Opcional
    },
    "images": [ // Opcional (Array). Evidencias gráficas adjuntas
      {
        "name": "captura_trafico.png",
        "contentType": "image/png",
        "contentBase64": "iVBORw0KGgoAAAANS..." // String Base64 puro sin el prefijo "data:image/..."
      }
    ]
  }
  ```
* **Respuesta Exitosa (JSON - HTTP 200):**
  ```json
  {
    "success": true,
    "emailSent": true, // Indica si el correo fue despachado por el servidor SMTP
    "emailError": null, // Mensaje de error detallado en caso de falla de envío SMTP
    "subject": "Alerta de Incidente de Seguridad - Prioridad Alta",
    "html": "<!doctype html><html xmlns=\"http://www.w3.org/1999/xhtml\">...</html>", // HTML compilado listo para enviar
    "text": "Información del Evento...\nOfensa: 99812\nCriticidad: Alta\nFuente: Firewall Principal..."
  }
  ```

---

## 3. Códigos de Estado Comunes

* **`200 OK`**: Petición procesada de forma correcta.
* **`201 Created`**: Recurso creado exitosamente (ej: evento registrado).
* **`400 Bad Request`**: Datos de entrada inválidos o campos obligatorios faltantes (ej: falta `logSource` en `reportData`).
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

---

## 5. Guía de Inicio Rápido con Postman (Paso a Paso)

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

### Paso 4: Dejar la pestaña Params Vacía
1. Asegúrate de que la pestaña **`Params`** (Query Params) no tenga ninguna clave o valor configurado. La tabla debe estar completamente limpia.

### Paso 5: Enviar la Petición
1. Haz clic en el botón azul **`Send`**.
2. Deberías recibir una respuesta con código de estado `200 OK` y el JSON que confirma el envío.

