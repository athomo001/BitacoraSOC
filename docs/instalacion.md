# Instalación

Cómo levantar Bitácora Ops en un equipo de desarrollo y en un servidor de producción.

- [1. Qué se instala](#1-qué-se-instala)
- [2. Requisitos](#2-requisitos)
- [3. Instalación en desarrollo](#3-instalación-en-desarrollo)
- [4. Primer ingreso: el asistente /setup](#4-primer-ingreso-el-asistente-setup)
- [5. Instalación en producción](#5-instalación-en-producción)
- [6. Después de instalar](#6-después-de-instalar)
- [7. Problemas comunes](#7-problemas-comunes)

---

## 1. Qué se instala

```mermaid
flowchart TB
    subgraph host["Servidor (docker compose, proyecto bitacora-rewrite)"]
        caddy["bitacora-caddy<br/>Caddy 2<br/>:8081 app · :8082 complementos"]
        app["bitacora-app<br/>binario Go + Angular<br/>:8080 app · :8082 complementos"]
        db[("bitacora-db<br/>PostgreSQL 18<br/>:25432 solo localhost")]
        caddy --> app --> db
    end
    user[Usuarios] --> caddy
```

| Contenedor | Imagen | Puerto en el servidor | Para qué |
| --- | --- | --- | --- |
| `bitacora-caddy` | `caddy:2-alpine` | `127.0.0.1:8081` → app, `127.0.0.1:8082` → complementos | Único punto de entrada. En producción también termina HTTPS. |
| `bitacora-app` | se construye con `backend-go/Dockerfile` | ninguno (solo red interna) | API + frontend. Corre como usuario sin privilegios en una imagen *distroless*. |
| `bitacora-db` | `postgres:18` | `127.0.0.1:25432` | Base de datos `bitacora`, usuario `bitacora`. Datos en el volumen `bitacora-rewrite_bitacora-db-data`. |

> Los puertos se publican **solo en 127.0.0.1** a propósito: desde otra máquina no se llega hasta que configures el acceso en producción (sección 5).

---

## 2. Requisitos

| Para | Necesitas | Versión |
| --- | --- | --- |
| Correr la aplicación | Docker con Docker Compose v2 | reciente |
| Crear o actualizar la base | [`golang-migrate`](https://github.com/golang-migrate/migrate) (comando `migrate`) | con driver `postgres` |
| Desarrollar el backend | Go | 1.27 |
| Desarrollar el frontend | Node.js y pnpm | Node ≥ 24.15, pnpm 12 |
| Regenerar consultas SQL | [`sqlc`](https://sqlc.dev) | reciente |

Para solo **usar** la aplicación basta con Docker y `migrate`. La imagen compila Go y Angular por dentro.

---

## 3. Instalación en desarrollo

### Paso 1. Variables de entorno

```bash
cp .env.example .env
```

Los valores de ejemplo funcionan para desarrollo tal cual. Qué significa cada uno: [configuracion.md](configuracion.md).

### Paso 2. Levantar los contenedores

```bash
docker compose up -d --build
```

La primera construcción tarda varios minutos (instala dependencias de Angular y compila todo). Comprueba que quedaron arriba:

```bash
docker compose ps
```

```text
NAME             STATUS                  PORTS
bitacora-app     Up 20 seconds           8080/tcp
bitacora-caddy   Up 20 seconds           127.0.0.1:8081->80/tcp, 127.0.0.1:8082->8082/tcp
bitacora-db      Up 30 seconds (healthy) 127.0.0.1:25432->5432/tcp
```

### Paso 3. Crear las tablas

La aplicación **no migra la base sola**: hay que aplicar las migraciones con `migrate`.

```bash
migrate -path backend-go/sql/migrations \
  -database "postgres://bitacora:bitacora_dev_local@127.0.0.1:25432/bitacora?sslmode=disable" up
```

Si cambiaste `POSTGRES_PASSWORD` en `.env`, usa esa contraseña en la URL. La salida termina con la última migración aplicada:

```text
29/u guard_timeline (512.3ms)
```

Reinicia la aplicación para que arranque con las tablas ya creadas:

```bash
docker compose restart bitacora-app
```

### Paso 4. Abrir la aplicación

Entra a **<http://127.0.0.1:8081>**. Con la base vacía, cualquier ruta lleva al asistente `/setup` (siguiente sección).

Para comprobar que responde sin abrir el navegador:

```bash
curl http://127.0.0.1:8081/api/health/ready
```

```json
{"status":"ready"}
```

---

## 4. Primer ingreso: el asistente /setup

El asistente aparece **una sola vez**, mientras no exista ningún administrador.

```mermaid
flowchart LR
    A["Entrar a la app"] --> B{"¿Ya hay<br/>administrador?"}
    B -- No --> C["/setup"]
    C --> D["Elegir módulos:<br/>SOC · NOC · Ticketera"]
    D --> E["Crear el primer<br/>administrador"]
    E --> F["/login"]
    B -- Sí --> F
```

1. **Módulos.** Marca SOC, NOC, Ticketera o cualquier combinación. Si marcas solo Ticketera, la instalación queda "solo Ticketera". Se pueden cambiar después en *Administración → Módulos*.
2. **Administrador.** Usuario, correo y contraseña del primer admin. Para esta cuenta la contraseña debe tener **al menos 12 caracteres**. El resto de los usuarios sigue el mínimo configurable (6 por defecto).

### Alternativa: crear el admin desde `.env`

En pruebas automáticas o ambientes desechables puedes saltarte el asistente. Si al arrancar la base no tiene administrador y están definidas estas variables, la aplicación lo crea y da el setup por hecho:

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_EMAIL=admin@ejemplo.cl
BOOTSTRAP_ADMIN_PASSWORD=una-clave-de-12-o-mas
BOOTSTRAP_MODULES=both        # both | soc | noc | tickets
```

Si ya existe un administrador, estas variables **se ignoran**: no crean usuarios ni cambian claves. En producción déjalas vacías y usa el asistente.

---

## 5. Instalación en producción

Es la misma composición de desarrollo con cinco cambios: secretos propios, HTTPS, URLs públicas, respaldos fuera del contenedor y acceso desde la red.

### Paso 1. Secretos propios

Genera valores nuevos. **Nunca** uses los del ejemplo.

```bash
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SIGNING_KEY
openssl rand -base64 32   # APP_ENCRYPTION_KEY (exactamente 32 bytes en base64)
```

> **Guarda `APP_ENCRYPTION_KEY` en un lugar seguro fuera del servidor.** Con ella se cifran la contraseña SMTP, los secretos MFA y los respaldos automáticos sin frase. Si se pierde, esos datos quedan ilegibles.

### Paso 2. `.env` de producción

```dotenv
POSTGRES_PASSWORD=<generada>
JWT_SIGNING_KEY=<generada>
APP_ENCRYPTION_KEY=<generada>
PUBLIC_BASE_URL=https://bitacora.ejemplo.cl
COMPLEMENTS_PUBLIC_URL=https://bitacora.ejemplo.cl:8443
RATE_LIMIT_DISABLED=
RATE_LIMIT_RESET_SECRET=
BOOTSTRAP_ADMIN_USERNAME=
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=
```

- `PUBLIC_BASE_URL` es la dirección con la que los usuarios entran. Se usa en los enlaces de los correos (restablecer contraseña, enlace público de tickets).
- `COMPLEMENTS_PUBLIC_URL` debe ser **otro origen**: otro puerto u otro subdominio (por ejemplo `https://complementos.ejemplo.cl`). Así un complemento no puede leer la sesión de la aplicación.

### Paso 3. HTTPS con Caddy

Reemplaza el `Caddyfile` por uno con tu dominio. Caddy obtiene y renueva el certificado solo (Let's Encrypt):

```caddyfile
bitacora.ejemplo.cl {
    reverse_proxy bitacora-app:8080 {
        flush_interval -1
    }
}

bitacora.ejemplo.cl:8443 {
    reverse_proxy bitacora-app:8082
}
```

> `flush_interval -1` es **obligatorio**: sin él, Caddy retiene los eventos en vivo (`/api/stream/events`) y la pantalla no se actualiza sola.

### Paso 4. Publicar los puertos y guardar los respaldos fuera del contenedor

Crea un `docker-compose.override.yml` junto al `docker-compose.yml`. Compose lo combina solo:

```yaml
services:
  caddy:
    ports: !override
      - "80:80"
      - "443:443"
      - "8443:8443"
    volumes:
      - caddy-data:/data          # certificados de Caddy

  bitacora-app:
    environment:
      BACKUP_DIR: /backups
    volumes:
      - ./respaldos-app:/backups  # copias de seguridad en el servidor

volumes:
  caddy-data:
```

La aplicación corre con el usuario sin privilegios `65532`. Dale la carpeta antes de arrancar:

```bash
mkdir -p respaldos-app && sudo chown 65532:65532 respaldos-app
```

> **Por qué importa:** sin `BACKUP_DIR` en un volumen, las copias se guardan **dentro del contenedor** y se pierden al recrearlo (por ejemplo, al actualizar). Después de instalar, prueba con *Administración → Respaldos → Crear copia ahora* y revisa que el archivo aparezca en `respaldos-app/`.

### Paso 5. Levantar, migrar y configurar

```bash
docker compose up -d --build
migrate -path backend-go/sql/migrations \
  -database "postgres://bitacora:<POSTGRES_PASSWORD>@127.0.0.1:25432/bitacora?sslmode=disable" up
docker compose restart bitacora-app
```

Entra a `https://bitacora.ejemplo.cl` y completa el asistente `/setup`.

---

## 6. Después de instalar

Orden recomendado. Todo se hace desde **Administración**:

| # | Dónde | Qué |
| --- | --- | --- |
| 1 | **Correo** | Servidor SMTP y remitente; envía un correo de prueba. Sin esto no salen reportes, avisos ni restablecimientos de contraseña. |
| 2 | **Marca** | Logo, favicon, nombre y fuente. |
| 3 | **Usuarios y grupos** | Usuarios, grupos de permisos, cargos y largo mínimo de contraseña (6 por defecto). |
| 4 | **Organizaciones y servicios** | Clientes, sus servicios y fuentes de log. |
| 5 | **Equipos** | Equipos internos, contratas y equipos de guardia con sus integrantes. |
| 6 | **Turnos** | Turnos de trabajo (horario y destinatarios del reporte de cierre) y las guardias. |
| 7 | **Checklist** | Plantillas de inicio y cierre de turno. |
| 8 | **Escalamiento** | Políticas y grupos de contacto. |
| 9 | **Respaldos** | Copia automática diaria y su destino. |

Si vienes del legacy, la mayoría de estos datos se cargan con el ETL: [migracion-legacy.md](migracion-legacy.md).

---

## 7. Problemas comunes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `bitacora-app` se reinicia y el log dice `DATABASE_URL no configurada`, `JWT_SIGNING_KEY no configurada` o `APP_ENCRYPTION_KEY no configurada` | Falta la variable. | Defínela en `.env` y ejecuta `docker compose up -d`. |
| El log dice que la clave de cifrado es inválida | `APP_ENCRYPTION_KEY` no son 32 bytes en base64. | Genera una con `openssl rand -base64 32`. |
| La página muestra errores 500 o "relation … does not exist" | No se aplicaron las migraciones. | Ejecuta `migrate … up` (sección 3, paso 3) y reinicia `bitacora-app`. |
| `migrate: no such host` o `connection refused` | La base no está arriba o el puerto no es el 25432. | `docker compose ps`; espera a que `bitacora-db` diga `healthy`. |
| `Dirty database version N` | Una migración falló a medias. | Revisa el error, corrige y ejecuta `migrate … force N-1`, luego `up` de nuevo. Haz un respaldo antes. |
| No llega a `127.0.0.1:8081` | Caddy no está arriba (por ejemplo, después de reconstruir solo la app). | `docker compose up -d` (sin nombre de servicio) para levantar los tres. |
| La pantalla no se actualiza sola (hay que recargar) | El proxy retiene los eventos en vivo. | Agrega `flush_interval -1` en el `reverse_proxy` de la app. |
| Al probar, "demasiados intentos" bloquea el login 15 minutos | Límite de 5 intentos por IP. | En desarrollo: `RATE_LIMIT_DISABLED=true`. En producción: espera, o usa `RATE_LIMIT_RESET_SECRET` (ver [operacion.md](operacion.md#desbloquear-el-login)). |
| En Windows con OneDrive, el build falla con "invalid file request" en una carpeta nueva | OneDrive bloquea archivos que todavía está sincronizando. | Borra y vuelve a crear la carpeta, o pausa la sincronización mientras construyes. Después, `docker compose up -d`. |
| Los correos no salen | SMTP sin configurar o mal configurado. | *Administración → Correo → Enviar prueba*; el error aparece ahí. Los reportes fallidos quedan en *Reportes de turno* con su causa. |
