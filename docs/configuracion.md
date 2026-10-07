# Configuración

Bitácora Ops se configura en dos lugares:

1. **Variables de entorno** (archivo `.env`). Son lo que el servidor necesita para arrancar: secretos, direcciones y carpetas. Se cambian editando `.env` y reiniciando.
2. **Administración** dentro de la aplicación. Ahí está todo lo demás: correo, marca, módulos, turnos, permisos y respaldos. Se guarda en la base, se cambia sin reiniciar y queda en la Auditoría.

- [1. Variables de entorno](#1-variables-de-entorno)
- [2. Variables de las herramientas de línea de comandos](#2-variables-de-las-herramientas-de-línea-de-comandos)
- [3. Lo que se configura desde la aplicación](#3-lo-que-se-configura-desde-la-aplicación)
- [4. Módulos y funcionalidades](#4-módulos-y-funcionalidades)

---

## 1. Variables de entorno

Docker Compose lee el `.env` de la raíz del repositorio y le pasa los valores al contenedor `bitacora-app`. La plantilla es [`.env.example`](../.env.example).

### Obligatorias

Sin estas, el servidor no arranca y escribe en el log cuál falta.

| Variable | Tipo | Descripción |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | texto | Contraseña del usuario `bitacora` de PostgreSQL. Compose arma con ella `DATABASE_URL`. |
| `JWT_SIGNING_KEY` | texto largo aleatorio | Firma las sesiones (JWT) y los accesos de los complementos. Si la cambias, todas las sesiones abiertas se cierran. |
| `APP_ENCRYPTION_KEY` | 32 bytes en base64 | Clave AES-256-GCM para los secretos guardados en la base: contraseña SMTP, secretos MFA y frase de los respaldos automáticos. Genérala con `openssl rand -base64 32`. **Cambiarla con datos cargados deja esos secretos ilegibles.** |

### Recomendadas

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost` (en el compose: `http://127.0.0.1:8081`) | Dirección pública de la aplicación. Se usa en los enlaces de los correos (restablecer contraseña, enlace público de tickets, dotación compartida). |
| `COMPLEMENTS_PUBLIC_URL` | `http://127.0.0.1:8082` | Dirección pública del origen aislado de los complementos. Debe ser **otro origen** que la app (otro puerto u otro subdominio). |
| `BACKUP_DIR` | `backups` (dentro del contenedor) | Carpeta de las copias de seguridad. **En producción, apúntala a un volumen** (ver [instalacion.md](instalacion.md#paso-4-publicar-los-puertos-y-guardar-los-respaldos-fuera-del-contenedor)). |

### Opcionales

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `HTTP_ADDR` | `:8080` | Dirección donde escucha la aplicación dentro del contenedor. |
| `COMPLEMENTS_ADDR` | `:8082` | Dirección del origen de los complementos dentro del contenedor. |
| `DATABASE_URL` | la arma el compose | Cadena de conexión a PostgreSQL. Solo hace falta definirla al correr el binario fuera de Docker. |
| `BACKUP_PASSPHRASE` | vacío | Frase para cifrar o abrir respaldos cuando la petición no trae una. |
| `RATE_LIMIT_RESET_SECRET` | vacío | Secreto para `POST /api/system/rate-limit-reset`, la válvula de emergencia para desbloquear el login. Vacío = la ruta responde 404 (no existe). |
| `RATE_LIMIT_DISABLED` | vacío | `true`, `1`, `yes` o `sí` apaga los límites de intentos. **Solo funciona si `PUBLIC_BASE_URL` es local** (`localhost` o `127.0.0.1`); en cualquier otro caso se ignora y queda un error en el log. |
| `APP_VERSION` | vacío | Versión que se informa a los complementos por su API interna. |

### Administrador inicial automático

Solo se usan si la base **no tiene ningún administrador**. Si ya existe uno, se ignoran.

| Variable | Descripción |
| --- | --- |
| `BOOTSTRAP_ADMIN_USERNAME` | Usuario del primer administrador. |
| `BOOTSTRAP_ADMIN_EMAIL` | Su correo. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Su contraseña, de al menos 12 caracteres. |
| `BOOTSTRAP_MODULES` | `both` (por defecto), `soc`, `noc` o `tickets` (instalación solo Ticketera). |

Si se **purga** la base desde Respaldos y estas variables están definidas, el administrador se vuelve a crear solo. Si no lo están, vuelve el asistente `/setup`.

### Ejemplo completo (producción)

```dotenv
POSTGRES_PASSWORD=Qm4m...generada
JWT_SIGNING_KEY=x9Jc...generada
APP_ENCRYPTION_KEY=dkbE1vL8G50ufsA0EsATSDDsu+F1LAhKNNykSrG9Z3w=
PUBLIC_BASE_URL=https://bitacora.ejemplo.cl
COMPLEMENTS_PUBLIC_URL=https://complementos.ejemplo.cl
RATE_LIMIT_RESET_SECRET=
RATE_LIMIT_DISABLED=
BOOTSTRAP_ADMIN_USERNAME=
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=
BOOTSTRAP_MODULES=both
```

> La `APP_ENCRYPTION_KEY` del ejemplo es la de desarrollo. En producción genera una propia.

---

## 2. Variables de las herramientas de línea de comandos

Las leen las herramientas de `backend-go/cmd/`, no el servidor. Detalle en [migracion-legacy.md](migracion-legacy.md).

| Variable | Herramienta | Descripción |
| --- | --- | --- |
| `ETL_DATABASE_URL` | `legacy-etl` | Base destino del ETL. Es el valor por defecto de `-database-url`. |
| `LEGACY_BACKUP_PASSPHRASE` | `legacy-etl` | Frase del respaldo del legacy, si viene cifrado. Va como variable y no como parámetro para que no quede en el historial de la terminal. |
| `ETL_OUTPUT_PASSPHRASE` | `legacy-etl` | Frase opcional del respaldo 2.0 que genera `-output-dir`. |
| `ETL_DB_NAME` | `scripts/etl-reset.sh` | Nombre de la base de ensayo (por defecto `bitacora_etl`; debe contener "etl"). |
| `SHADOW_DIFF_TOKEN` | `escalation-shadow-diff` | JWT de un usuario de la 2.0 para consultar el motor de escalamiento. |

---

## 3. Lo que se configura desde la aplicación

Todo esto está en **Administración** (solo administradores) y queda registrado en la Auditoría.

| Sección | Qué se configura |
| --- | --- |
| **Usuarios y grupos** | Usuarios, roles, grupos de permisos (alcance SOC/NOC y capacidades), cargos, largo mínimo de contraseña, forzar cambio de clave a todos y correos de cumpleaños. |
| **Turnos** | **Guardias** (línea de tiempo, rotación, quién debe estar siempre cubierto, día y hora de cambio, CSV), **turnos de trabajo** (horario, destinatarios del reporte de cierre, personas), **dotación programada** (correo periódico) y **recordatorios** por correo. |
| **Checklist** | Plantillas de inicio y cierre de turno, ítems y quién recibe las alertas de un ítem en rojo. |
| **Escalamiento** | Políticas por servicio, activo o zona; pasos y grupos de contacto. |
| **Avisos por cliente** | Alertas que aparecen al trabajar con un cliente y el catálogo de eventos del informe. |
| **Correo** | Servidor SMTP (con plantillas para Gmail, Microsoft 365 y otros), remitente y correo de prueba. |
| **Reportes de turno** | Formato y estado de los reportes de cierre enviados. |
| **Organizaciones y servicios** | Clientes, tipos de organización, servicios y fuentes de log. |
| **Territorio** (NOC) | Regiones, zonas y sitios; importación y activación masiva. |
| **Equipos** | Equipos internos, contratas, guardias e integrantes; cobertura territorial (NOC). |
| **Marca** | Nombre, logo, favicon y fuente. |
| **Módulos** | SOC, NOC y Ticketera. |
| **Funcionalidades** | Interruptores de funciones opcionales (sección 4). |
| **Respaldos** | Copias manuales y automáticas, destino, retención, restauración, exportación delta y purga. |
| **Auditoría** | Consulta y exportación del registro de eventos. |
| **Complementos** | Subir, publicar y administrar mini-aplicaciones. |

> Un módulo o funcionalidad apagado **desaparece** de los menús. No queda un aviso de "desactivado".

---

## 4. Módulos y funcionalidades

**Módulos** (*Administración → Módulos*). Definen qué tipo de centro es la instalación.

| Módulo | Qué habilita |
| --- | --- |
| **SOC** | Bitácora, turnos, checklist y escalamiento con enfoque de ciberseguridad (servicios y fuentes de log). |
| **NOC** | Lo mismo con enfoque de red: territorio, activos, cobertura de equipos y ventanas de mantención. |
| **Ticketera** | Tickets ITIL. Puede usarse sola. |

Cada usuario tiene además su propio **alcance** (SOC, NOC o ambos) según sus grupos de permisos.

**Funcionalidades** (*Administración → Funcionalidades*, tabla `system_features`).

| Código | Nombre | Para qué |
| --- | --- | --- |
| `native_tickets` | Ticketera nativa | La Ticketera. Se maneja desde *Módulos*. |
| `complements` | Complementos | Mini-aplicaciones embebidas. Apagada corta el menú, la administración y su API. |
| `allow_purge` | Permitir purga | Muestra "Purgar base de datos" en Respaldos. **Solo para ambientes de prueba.** |
| `zabbix_inbound` | Ingesta de alertas Zabbix | Reservada para después del corte. |
| `glpi_sync` | Sincronización con GLPI | Reservada para después del corte. |
