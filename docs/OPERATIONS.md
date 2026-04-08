# Operacion Completa - Desde Cero

Guia operativa integral para instalar, inicializar y dejar Bitacora SOC funcional desde cero.

---

## 1. Objetivo

Este documento define un camino unico para:

- preparar entorno nuevo
- levantar stack Docker
- inicializar datos con semilla correcta segun entorno
- validar modulos criticos
- dejar base lista para operacion de SOC

Si hay conflicto con otro documento, este archivo tiene prioridad operativa junto con `DEPLOY.md` y `DISASTER-RECOVERY.md`.

---

## 2. Prerrequisitos

- Docker Engine + Docker Compose v2
- OpenSSL disponible en host
- puertos libres `80`, `443`, `3000`, `3443`, `27017`
- acceso al repositorio y permisos de escritura en:
  - `./.data/mongodb_data`
  - `./.data/uploads`
  - `./.data/backups`
  - `./.data/tls`

---

## 3. Flujo oficial de bootstrap

### 3.1 Preparar variables

1. Copiar plantilla:

```bash
cp .env.example .env
```

2. Definir al menos:

- `MONGO_ROOT_PASSWORD`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `COMPLEMENT_TOKEN_SECRET`
- `ALLOWED_ORIGINS`

3. Generar secretos recomendados:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY
openssl rand -base64 32   # COMPLEMENT_TOKEN_SECRET
```

### 3.2 Levantar servicios

Opciones equivalentes:

```bash
docker compose -f docker-compose.yml -f docker-compose.complements.yml up -d --build
```

o con script:

```bash
./scripts/compose-up.sh
```

Windows:

```powershell
.\scripts\compose-up.ps1
```

### 3.3 Confirmar salud base

```bash
docker compose ps
curl http://localhost:3000/health
```

Esperado:

- `mongodb` healthy
- `backend` up
- `frontend` up
- `health` responde `ok`

---

## 4. Semillas: cuando usar cada una

Bitacora SOC no se auto-semilla al arrancar contenedores. La inicializacion de datos es manual y controlada.

### 4.1 `seed-admin.js` (produccion o base limpia)

Crea solo el usuario administrador si no existe.

```bash
docker compose exec backend node src/scripts/seed-admin.js
```

Uso recomendado:

- produccion
- preproduccion limpia
- recuperacion posterior a restore cuando falta admin

### 4.2 `seed.js` (laboratorio y QA)

Carga datos ficticios de prueba:

- usuarios de ejemplo
- turnos y asignaciones
- clientes y catalogos basicos
- plantillas de checklist
- historial operativo sanitizado

```bash
docker compose exec backend node src/scripts/seed.js
```

Uso recomendado:

- ambientes demo
- validacion funcional interna
- pruebas de flujo SOC sin datos reales

No usar en produccion.

---

## 5. Validacion funcional minima

## 5.1 Autenticacion y sesion

- login correcto en frontend
- cookie `auth_token` presente
- `GET /api/users/me` responde perfil

## 5.2 Modulos SOC

- crear entrada operativa
- registrar checklist de inicio y cierre
- revisar auditoria en consola admin

## 5.3 Backup y restore

- ejecutar `POST /api/backup/create`
- confirmar archivo en `./.data/backups`
- verificar historial con `GET /api/backup/history`

## 5.4 Complementos

- entrar a `Admin > Complementos`
- validar que se pueda crear complemento manual
- validar flujo `validar -> preview -> publicar` para ZIP estatico

## 5.5 Report Generator / Boletín

- cambiar a modo `Boletín de Seguridad` y completar campos obligatorios
- generar vista previa y validar secciones mínimas (`Resumen`, `Impacto`, `Mitigación`)
- probar envío 1:1 con al menos 2 destinatarios y verificar `successCount/failCount`
- validar pegado enriquecido en `Resumen Ejecutivo` y `Impacto` (que no quede texto corrido)

---

## 6. Complementos: instalacion y despliegue

La plataforma soporta dos modos:

1. registro manual de servicio ya desplegado
2. publicacion ZIP estatico administrada por el core

Reglas importantes:

- la publicacion automatica hoy es solo `static-html`
- stacks `Node.js`, `Vite` o `React + Vite` deben desplegarse externamente y luego registrarse
- el overlay `docker-compose.complements.yml` es opcional y hoy esta orientado a QA/laboratorio con `complement-stub`

Ver detalle completo en `COMPLEMENTS.md`.

---

## 7. Fallas comunes y recuperacion rapida

## 7.1 Backend no inicia por secretos

Sintoma: errores de `JWT_SECRET` o `ENCRYPTION_KEY`.

Accion:

1. corregir `.env`
2. reiniciar backend:

```bash
docker compose restart backend
```

## 7.2 Mongo unhealthy

Accion:

1. revisar logs `docker compose logs mongodb`
2. revisar permisos de `./.data/mongodb_data`
3. si el volumen esta corrupto, aplicar procedimiento de `DISASTER-RECOVERY.md`

## 7.3 Complemento en mantenimiento

Accion:

1. revisar healthPath o artefacto publicado
2. revisar eventos `complement.circuit.*`
3. probar desde consola admin y esperar `HALF_OPEN`

## 7.4 UI no refleja cambios recientes

Accion:

1. reconstruir frontend:

```bash
docker compose build frontend --no-cache
docker compose up -d frontend
```

2. recarga dura en navegador

---

## 8. Orden documental recomendado

Para operar sin ambiguedad:

1. `OPERATIONS.md`
2. `DEPLOY.md`
3. `RUNBOOK.md`
4. `BACKUP.md`
5. `DISASTER-RECOVERY.md`
6. `COMPLEMENTS.md`

---

## 9. Checklist de salida a operacion

- `.env` con secretos no default
- backup de prueba validado
- restore de prueba validado en entorno separado
- usuario admin confirmado
- SMTP test OK (si aplica)
- complementos criticos probados
- politica de rotacion de respaldos definida
- procedimientos de DR socializados con el equipo
