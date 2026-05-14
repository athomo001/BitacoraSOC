# 🔧 Troubleshooting - Bitácora SOC (Docker)

Solución de problemas comunes categorizados por área, asumiendo un despliegue estándar usando **Docker Compose**.

---

## 🐋 Comandos Docker Esenciales

Antes de entrar en problemas específicos, aquí tienes los comandos básicos para diagnosticar:

```bash
# Ver estado de los contenedores (debe decir "Up" y "healthy")
docker compose ps

# Ver logs en tiempo real de un servicio específico
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mongodb

# Reiniciar un servicio
docker compose restart backend

# Entrar a un contenedor para diagnosticar
docker compose exec backend sh
```

---

## 🖥️ Backend

### Contenedor Backend se reinicia constantemente (Crash Loop)

**Síntoma:** `docker compose ps` muestra el backend "restarting" o "exited".

**1. Ver el motivo exacto del crash:**
```bash
docker compose logs --tail=50 backend
```

**2. Error "MongoServerSelectionError" (no conecta a BD):**
- Verificar que MongoDB esté `healthy`: `docker compose ps`
- Verificar las credenciales en el `.env`
- Si la IP cambió (en caso de usar MongoDB externo), actualizar `MONGODB_URI` y reiniciar: `docker compose up -d backend`

**3. Error "ENCRYPTION_KEY must be 32 bytes" o "JWT_SECRET missing":**
- El archivo `.env` está incompleto.
- Editar `.env`, generar las claves necesarias (`openssl rand -hex 32`) y reiniciar: `docker compose restart backend`

### EADDRINUSE: Puertos 3000 o 3443 en uso

**Síntoma:** Falla al levantar el docker compose con error `bind: address already in use`.

**Causa:** Otra aplicación (como un servidor Node.js local sin Docker, u otra instancia) está usando el puerto en la máquina host.

**Solución:**
1. Identificar qué usa el puerto en el host:
   - Windows: `netstat -ano | findstr :3000`
   - Linux: `sudo lsof -i :3000`
2. Matar el proceso host problemático.
3. Alternativa: Cambiar el puerto en el `.env` (ej: `BACKEND_PORT=3001`) y hacer `docker compose up -d`.

### HTTP 429 — demasiadas peticiones (login o API)

**Síntoma:** El frontend o `curl` recibe `429` con mensaje de límite por IP o de intentos de login.

**Causas típicas:** se alcanzó el umbral de `RATE_LIMIT_*`; varios analistas comparten la misma IP pública (NAT); tráfico legítimo muy alto.

**Qué hacer (en orden práctico):**

1. Esperar la ventana (`RATE_LIMIT_WINDOW_MS`, por defecto 15 minutos).
2. **Sin reiniciar el contenedor:** si en `.env` existe `RATE_LIMIT_RESET_SECRET` como **texto de al menos 24 caracteres** (no es un número; suele generarse con `openssl rand -base64 32`), usar `POST /api/system/rate-limit-reset` con la cabecera `X-Rate-Limit-Reset-Secret` y cuerpo JSON `{"ip":"..."}` o `{"all":true}` si no tienes la IP. Detalle: `docs/SECURITY.md`, `docs/API.md`; caso NAT / falsos positivos: `docs/ISSUES.md` (SEC-RL-018).
3. **Último recurso:** `docker compose restart backend` (limpia contadores en memoria de todos los limiters del proceso).

---

## 💾 MongoDB (Base de Datos)

### Contenedor de BD no está "healthy"

**Síntoma:** `docker compose ps` muestra `mongodb` como `unhealthy`.

**Causa:** Volumen dañado, permisos incorrectos en `.data/mongodb_data`, o RAM insuficiente.

**Diagnóstico:**
```bash
docker compose logs mongodb
```

**Permisos en Linux (si es un problema EACCES):**
```bash
sudo chown -R 999:999 .data/mongodb_data
docker compose restart mongodb
```

### Problemas haciendo Backup JSON/ZIP

**Síntoma:** El endpoint de crear backup desde el frontend falla o genera un backup de 0 bytes.

**1. Verificar permisos de la carpeta de backups:**
En Docker, la carpeta host `.data/backups` está mapeada a `/app/backups`.
- **Linux:** Asegúrate de que el usuario del host pueda escribir en `.data/backups`, o dale `chmod 777 .data/backups` si hay problemas de mapeo de UID (el backend corre como usuario `nodejs` interno).

**2. Verificar logs de error:**
```bash
docker compose logs backend | grep backup
```

---

## 🌐 Frontend (Nginx/Angular)

### Frontend no carga datos (API Error) u "Host de API inalcanzable"

**Síntoma:** El login falla, o los request muestran error CORS/502 en la consola del navegador.

**Causa 1: CORS incorrecto en backend:**
El `.env` del backend debe incluir la IP pública/dominio actual en `ALLOWED_ORIGINS`.
- Si accedes vía `http://192.168.1.50`, el `.env` debe tener `ALLOWED_ORIGINS=http://192.168.1.50`.
- Modifica el `.env` y aplica: `docker compose restart backend`

**Causa 2: URL de las APIs en el frontend:**
El frontend Angular está inyectado con una URL en tiempo de build o mediante variables. Si configuraste `apiUrl` hacia "localhost" en los environments, fallará para otros equipos en la red.
- Edita en `frontend/src/environments/environment.prod.ts` la directiva `apiUrl` para que apunte a la IP o dominio real del servidor (`http://IP_SERVIDOR:3000/api`).
- Como Nginx sirve archivos estáticos compilados, debes reconstruir el frontend:
  ```bash
  docker compose build frontend --no-cache
  docker compose up -d frontend
  ```

### Logo personalizado roto

**Síntoma:** Subes el logo corporativo desde admin, dice "éxito", pero la imagen carga rota.

**Causa:** El volumen de uploads no está sincronizando correctamente o Nginx/URL apunta al lugar incorrecto.
- Verifica si la imagen está en el contenedor backend:
  ```bash
  docker compose exec backend ls -l /app/uploads/logos
  ```
- Si tu Reverse Proxy o Nginx expone HTTPS, asegúrate de que el frontend cargue los logos con el esquema correcto de HTTP/HTTPS.

### La UI de complementos no refleja cambios recientes

**Síntoma:** El código ya cambió, pero en navegador sigue apareciendo la vista vieja del complemento o del contenedor.

**Causa común:** Estás viendo el frontend Docker en `:80/:4200` y no el `pnpm start` local, o el navegador quedó con caché fuerte.

**Acciones:**
```bash
docker compose ps
docker compose build frontend --no-cache
docker compose up -d frontend
```

Luego forzar recarga del navegador con `Ctrl+F5`.

### En boletines, al pegar texto queda "achochlonado" (sin saltos/estructura)

**Síntoma:** al pegar contenido desde web/PDF/Word en `Resumen Ejecutivo`, `Impacto` o `Mitigación`, aparece texto corrido o palabras pegadas.

**Contexto:** el módulo de boletín ya incluye normalización de pegado enriquecido (`text/html`) para preservar estructura.

**Acciones recomendadas (en orden):**

1. Forzar recarga dura del frontend (`Ctrl+F5`) para asegurar el bundle más reciente.
2. Pegar nuevamente en el campo objetivo (el parser intenta separar etiquetas y bloques semánticos).
3. Si persiste solo con una fuente concreta, probar pegar primero en editor intermedio plano (Notepad) para aislar origen.
4. Verificar versión desplegada en `docs/CHANGELOG.md` y reconstruir frontend si aplica:
   ```bash
   docker compose build frontend --no-cache
   docker compose up -d frontend
   ```
5. Si el problema continúa, reportar ejemplo exacto de texto origen (sin datos sensibles) para ajustar heurísticas de parseo.

### Abrir directo `/uploads/complements/...` devuelve 401/403

**Síntoma:** Un artefacto publicado parece “caído” si se abre directo por URL.

**Causa:** Es comportamiento esperado. Los artefactos publicados y previews están protegidos por autenticación y visibilidad.

**Verificar:**
- preview: solo admin
- published: usuario autenticado con acceso al complemento

### Un complemento queda en Mantenimiento

**Causa posible 1:** `healthPath` incorrecto o servicio caído.

**Causa posible 2:** Para `zip-static`, falta `index.html` o el artefacto publicado fue eliminado.

**Acciones:**
```bash
docker compose logs backend
docker compose exec backend sh
ls -la /app/uploads/complements/published
```

Luego usar `Probar` desde `Admin > Complementos` o esperar la transición `HALF_OPEN`.

### El complemento pierde datos tras cerrar sesión

**Causa común:** El complemento guarda solo en `localStorage` del navegador.

**Acción recomendada:** Migrar a `GET/PUT /api/complements/:slug/browser-state` o a `/api/internal/v1/storage` si el propio microservicio administra el estado.

---

## 📧 Servidor SMTP (Correos)

**Síntoma:** "Test SMTP" falla o los turnos no envían correos.

**1. Ver el error exacto:**
```bash
docker compose logs backend | grep smtp
```

**2. Connection Refused / Timeout:**
- Docker tiene su propia red. Si el servidor SMTP es interno de la empresa, asegúrate de que el firewall corporativo deje salir conexiones en el puerto 587/465 al segmento de red de Docker.
- A veces bloquear IP v6 en Docker Compose es necesario si tu SMTP no lo soporta.

**3. Autenticación fallida:**
- Pasa seguido en Office365/Google Workspace: usar contraseña de "Aplicación" cifrada, NO la clave de la cuenta web regular.

---

## 🔒 Certificados TLS/HTTPS

**Síntoma:** Advertencia roja de "No seguro" en el navegador o Nginx falla al levantar.

**Causa:** Los certificados mapeados en `./.data/tls` son los autofirmados generados por defecto o han expirado.

**Solución para certificados reales:**
1. Copiar tu certificado empresarial a `.data/tls/cert.pem` y `.data/tls/key.pem`
2. Reiniciar el frontend para que Nginx tome la recarga:
   ```bash
   docker compose restart frontend
   # o recargar nginx online:
   docker compose exec frontend nginx -s reload
   ```

---

## 🧹 Limpiar y Reempezar (Modo Nuclear)

Si alguna actualización grande corrompió la estructura, el gestor de paquetes se bloqueó en caché docker, o simplemente todo se rompió irremediablemente (excepto la BD):

```bash
# Bajar todos los contenedores
docker compose down

# Reconstruir limpiamente las imágenes SIN usar caché (demorará unos minutos)
docker compose build --no-cache

# Levantar
docker compose up -d
```

*(No te preocupes, tus BD están a salvo en `.data/mongodb_data`)*
