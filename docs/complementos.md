# Cómo hacer un complemento

Para quien quiere sumar algo a Bitácora Ops sin tocar el núcleo: un informe distinto, una pestaña con datos de otro sistema, una integración propia de un área. Un complemento puede ser una mini-app estática (un ZIP) o un servicio aparte con su propio servidor. Los dos se instalan y aprueban en **Administración → Complementos** (solo el admin).

El diseño y sus decisiones están en `spec/11-complementos.md` (§12 para lo que un complemento agrega a la app). Las rutas, en [api.md](api.md#complementos).

---

## 1. Qué puede agregar

Un complemento declara en un archivo **`complement.json`** qué agrega. Sin ese archivo es una pestaña en «Complementos», como siempre (así siguen funcionando los del sistema anterior). El admin aprueba cada cosa por separado; lo que una versión nueva agrega queda esperando su revisión y no aparece hasta que lo apruebe. Un complemento apagado o en mantenimiento desaparece de todos lados.

**En pantalla** (siempre dentro de un iframe aislado: el complemento nunca ve la sesión de la persona):

| En `complement.json` | Dónde aparece |
| --- | --- |
| `pages` con `module` | Una pestaña en Reportes o Turnos, un acceso en la Ticketera o Escalamiento, o una sección en Administración (`admin`, solo complementos «de la casa») |
| `panels` con `target` | Una pestaña en el detalle de un ticket (`ticket`), la ficha del cliente en Gestión (`client`) o la ficha de un equipo (`asset`); en una entrada (`entry`), una sección plegable de su detalle |
| `actions` con `target` | «Más acciones» en el detalle de una entrada o un ticket; abre el complemento en un diálogo |
| `topbar` | Una franja de 32 px sobre toda la app, una por instalación (solo «de la casa») |
| `settings` | La pestaña «Configuración» de su ficha en Administración → Complementos |

**Detrás** (solo complementos con servidor):

| En `complement.json` | Qué pasa |
| --- | --- |
| `events` | La app le manda esos eventos a `POST <servicio>/hooks/events`, por la misma cola que el reenvío a un SIEM: con reintentos y en orden |
| `schedules` | La app llama `POST <servicio>/hooks/schedule/<nombre>` cuando toca; un solo nodo la dispara |

**Datos** (`data`): permisos de la [API de integraciones](api-integraciones.md): `entries:read`, `entries:write`, `tickets:read`, `tickets:write`, `clients:read`, `oncall:read`.

### `complement.json` completo

```json
{
  "version": "1.3.0",
  "pages":   [{ "id": "incidentes", "module": "reports", "title": "Incidentes por cliente", "path": "index.html" }],
  "panels":  [{ "id": "reputacion", "target": "ticket", "title": "Reputación", "path": "panel.html" }],
  "actions": [{ "id": "buscar", "target": "entry", "title": "Buscar en VirusTotal", "path": "accion.html" }],
  "topbar":  { "path": "barra.html" },
  "settings": [
    { "key": "apiKey", "label": "Llave de VirusTotal", "type": "secret", "required": true },
    { "key": "umbral", "label": "Malicioso desde", "type": "number", "default": 5, "help": "Motores que lo detectan" }
  ],
  "events":    ["entry.created", "ticket.sla_breached"],
  "schedules": [{ "name": "revisar", "every": "6h" }, { "name": "lunes", "at": "08:00", "days": ["mon"] }],
  "data":      ["entries:read", "entries:write"]
}
```

- `id` y `name`: minúsculas, números y guiones. `title`: hasta 60 caracteres.
- `path`: relativo a la carpeta del complemento (sin `/` al inicio ni `..`); vacío = su archivo de entrada. En un ZIP, el archivo tiene que venir en el ZIP.
- `module`: `reports`, `shifts`, `tickets`, `escalation` o `admin`. `target` de una pestaña: `entry`, `ticket`, `client` o `asset`; de una acción: `entry` o `ticket`.
- `settings[].type`: `text`, `secret`, `number`, `boolean` o `select` (con `options`). Un secreto se guarda cifrado y no vuelve a la pantalla.
- `events`: `entry.created`, `entry.comment_added`, `entry.follow_up.closed`, `ticket.created`, `ticket.assigned`, `ticket.updated`, `ticket.comment_added`, `ticket.sla_breached`, `escalation.incident.opened`, `escalation.incident.closed`.
- `schedules`: `every` de 5 minutos a 7 días (`15m`, `6h`, `1d`), o `at` (`HH:MM`, hora de la instalación) con `days` opcionales (`mon`…`sun`).

---

## 2. Complemento estático (ZIP)

HTML, CSS y JavaScript que corren en el navegador. Un proyecto Vite o React se compila afuera y se sube su carpeta `dist`.

1. Arma la carpeta con `index.html`, tus archivos, `complement.json` y una copia de [`complementos/sdk/bitacora-complemento.js`](complementos/sdk/bitacora-complemento.js).
2. Comprímela en un ZIP (con la carpeta adentro o sin ella).
3. Administración → Complementos → **Subir ZIP**: revisa el análisis, mira la vista previa y publica.
4. En su ficha, pestaña **Qué agrega**: aprueba lo que corresponda.

Ejemplo completo: [`complementos/informe-incidentes/`](complementos/informe-incidentes/) (el ZIP listo está en `complementos/informe-incidentes.zip`). Es un informe en Reportes que cuenta, por cliente y mes, las entradas de incidente y los tickets de incidente, con su cierre promedio y el SLA vencido.

**Datos**: un complemento estático no guarda llaves. Pide los datos a la app con `Bitacora.api(...)` y la app consulta `/api/v1` **como la persona que lo tiene abierto**: solo lee lo aprobado en `data` y nunca muestra más de lo que esa persona ve en la app (por ejemplo, los tickets de las colas de sus áreas). Solo lectura: para escribir están `addNote` y `createEntry`.

**Límites**: ZIP de hasta 25 MB y 400 archivos; se sirve desde otro origen (otro puerto) con una CSP propia. Para llamar a un sitio externo, el admin autoriza ese sitio en la ficha.

---

## 3. Complemento con servidor

Un servicio en cualquier lenguaje que la app solo conoce por HTTP. Va en tu `docker-compose` como un contenedor más.

1. El servicio sirve `GET /complement.json`, `GET /health` (200 si está bien) y las páginas que declara.
2. Administración → Complementos → **Registrar servicio**: su dirección pública (la que abre el navegador), la interna si el backend lo alcanza por otra (por ejemplo `http://mi-servicio:8090`), la ruta de salud y la de entrada. Copia el **token de aplicación**: se muestra una vez.
3. La app lee su `complement.json` al registrarlo (si todavía no responde, después: **Qué agrega → Leer de nuevo**). Aprueba lo que corresponda.
4. Configura el servicio con el token. Con él pide a la app:
   - `GET /api/internal/v1/settings`: su configuración, con los secretos.
   - `GET /api/internal/v1/credentials`: `apiBaseUrl`, su **llave de la API de integraciones** (con los permisos de `data` aprobados) y el `hookSecret` con que se firman los ganchos. Pídelas de nuevo si una llamada responde 401 o una firma no coincide: cambian cuando el admin vuelve a aprobar.

Ejemplo completo: [`complementos/servicio-ejemplo/`](complementos/servicio-ejemplo/) (Node 20, sin dependencias): una pestaña en el ticket, una acción en la entrada, configuración, el evento `entry.created` (deja un seguimiento en cada incidente nuevo) y una tarea cada 15 minutos.

```sh
APP_TOKEN=<token de aplicación> BITACORA_URL=http://bitacora-app:8080 node servidor.mjs
```

### Ganchos firmados

Todo lo que la app manda al servicio (eventos y tareas) va con:

```
X-Bitacora-Timestamp: 1793023054
X-Bitacora-Signature: sha256=<HMAC-SHA256 en hex de "<timestamp>.<cuerpo>" con hookSecret>
```

Rechaza lo que no coincida o tenga más de 5 minutos. Responde 2xx: con otro código, un evento se reintenta (1 s, 2 s, 4 s… hasta 5 minutos entre intentos, y se pierde a los 7 días) y la tarea queda con su error en la ficha.

**Evento** (`/hooks/events`): el mismo JSON que recibe un SIEM (ver [API de integraciones](api-integraciones.md)): `event`, `ts`, `actor`, `client`, `object` (`{type, id, ref}`) y `data` (por ejemplo, el texto y el tipo de la entrada). **Tarea** (`/hooks/schedule/<nombre>`): `{"name", "scheduledAt", "firedAt"}`.

Al eliminar un complemento servicio, la app llama `POST <servicio>/hook/cleanup` (como el sistema anterior).

---

## 4. El puente con la app

El iframe y la app se hablan con `postMessage` (`{type, version: 1, payload}`). Con [`bitacora-complemento.js`](complementos/sdk/bitacora-complemento.js) no hace falta tocarlo:

| Desde el complemento | Qué hace | Respuesta |
| --- | --- | --- |
| `Bitacora.onContext(fn)` | Recibe `user` (nombre y rol), `theme` (`dark`, `light`, `pink`), `dyslexiaFont`, `language`, `slot`, `object` (`{type, id}` de la ficha abierta) y `settings` (sin los secretos) | `CONTEXT_UPDATE` al cargar; `THEME_CHANGE` si cambia el tema |
| `await Bitacora.api('/tickets?status=new')` | `API_REQUEST`: lee `/api/v1` (GET) como la persona | El cuerpo de `/api/v1` (`{data, meta}`) |
| `await Bitacora.apiAll('/entries?since=…')` | Lo mismo, siguiendo las páginas | La lista completa (hasta 2000) |
| `await Bitacora.addNote('texto')` | `ADD_NOTE`: seguimiento en la entrada o comentario interno en el ticket abierto, a nombre de la persona y firmado «con <complemento>» | `NOTE_ADDED` |
| `Bitacora.createEntry({content, entryType})` | `CREATE_ENTRY`: una entrada nueva a nombre de la persona | `ENTRY_CREATED` |
| `Bitacora.close()` | `CLOSE`: cierra el diálogo de una acción | — |
| `Bitacora.onPrint` | La app manda `PRINT` con «Descargar PDF»; por defecto abre la impresión del navegador (Guardar como PDF). Prepara tu CSS con `@media print` | — |

El SDK pone `data-theme` y la clase `dyslexia` en `<html>` para que tu CSS siga el tema de la app. Más de 100 mensajes en 10 segundos desconectan el iframe.

---

## 5. Antes de aprobar (para el admin)

- **De la casa**: márcalo solo en complementos que hizo o revisó el equipo. Habilita la barra superior y las páginas en Administración.
- **Datos**: un complemento con servidor recibe una llave propia, que aparece en Administración → Integraciones con el nombre del complemento, y cada llamada queda registrada. Quitar todos sus permisos de datos la revoca.
- **Eventos**: lo que reciba sale de la Bitácora hacia ese servicio. Aprueba solo los que necesita.
- Todo lo que apruebas o quitas queda en Auditoría (`complement.approvals`), igual que los cambios de configuración (solo los nombres de los campos, nunca los valores).
