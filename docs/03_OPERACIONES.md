# Operaciones Generales

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

## 5.5 Reportes / Boletín

- cambiar a modo `Boletín de Seguridad` y completar campos obligatorios
- generar vista previa y validar secciones mínimas (`Resumen`, `Impacto`, `Mitigación`)
- probar envío con `Unir destinatarios por dominio` activado y verificar `processedGroups` + `successCount/failCount`
- desactivar `Unir destinatarios por dominio` y validar retorno a modo 1:1
- validar bloqueo de error cuando exista el mismo correo en `Para` y `CC`
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


# Runbook SOC

# 📖 Runbook Operativo - Bitácora SOC

Guía de operación diaria para analistas y administradores del Security Operations Center.

Documentos base para operación:

- `OPERATIONS.md` para levantamiento e inicialización desde cero
- `DISASTER-RECOVERY.md` para recuperación total ante desastre

---

## Roles y Responsabilidades

### Admin
- Gestión de usuarios
- Configuración SMTP, catálogo servicios, cooldown
- Backups y restore
- Reportes y KPIs
- Configuración log forwarding (SIEM)
- Gestión de complementos

### Auditor (Rol de Solo Lectura con Restricción Estricta)
- Lectura de logs de auditoría en la consola.
- Consulta de actividad operativa del SOC.
- **Restricción de Seguridad:** El rol Auditor no tiene autorización para descargar copias de seguridad (backups), enviar reportes o boletines por correo, o modificar ninguna configuración. Toda la información PII (correos, teléfonos) en la lista de usuarios y directorios es enmascarada u ocultada para este rol.

### User (Analista)
- Registrar entradas operativas/incidentes
- Checklist de turno (inicio/cierre)
- Ver entradas
- Editar perfil propio

### Guest (Temporal)
- Registrar entradas (marcadas como guest)
- Ver entradas
- Expira automáticamente (default 2 días)

---

## Flujo de Turno

### 1. Inicio de Turno

**Responsable:** Analista entrante

**Pasos:**

1. **Login** → `http://IP_SERVIDOR:4200`
   - En despliegue Docker por defecto: `http://IP_SERVIDOR` (puerto 80)
   - Permite autenticación local (`Username/Password`) o vía Single Sign-On (**SSO Google o Microsoft**).
   - **Autenticación Multifactor (MFA/TOTP):** Si el administrador habilitó MFA para su cuenta:
     - En el primer inicio de sesión se le presentará una pantalla de enrolamiento con un **código QR**. Escanee este código QR usando una aplicación de autenticación TOTP (e.g. Google Authenticator, Microsoft Authenticator o Bitwarden) e introduzca el código de verificación para completar el enlace. Guarde de forma segura los códigos de recuperación generados.
     - En inicios de sesión posteriores, tras ingresar sus credenciales básicas o SSO, se le solicitará el código TOTP temporal generado en su aplicación móvil.
   - Si guest: verificar que no haya expirado

2. **Revisar Notas del Administrador** (sidebar derecho)
   - Alertas importantes
   - Cambios en servicios
   - Instrucciones especiales

3. **Registrar Checklist Inicio** (acordeón lateral)
   - Click "Inicio de turno"
   - Evaluar **TODOS** los servicios activos:
     - Verde: Servicio operativo
     - Rojo: Servicio con problema
   - Si servicio en ROJO:
     - Observación **OBLIGATORIA** (máx 1000 chars)
     - Ejemplo: "Alerta de CPU en servidor prod-01. Se está investigando con equipo de infra."
   - Click "Registrar"

**Validaciones automáticas:**
- ❌ NO puedes hacer dos "inicio" consecutivos (debe alternar)
- ❌ Cooldown no cumplido (default 4h entre checks)
- ❌ Servicio en rojo sin observación

**Email automático:**
- Si SMTP configurado:
  - `sendOnlyIfRed=true` → envía solo si hay rojos
  - `sendOnlyIfRed=false` → envía siempre

### 2. Durante el Turno

**Registrar Entradas:**

1. **Escribir → Nueva Entrada**
2. Fecha/hora precargadas (Chile timezone)
3. Clasificación:
   - **Entrada operativa:** Monitoreo, alertas normales, revisiones
   - **Incidente:** Evento de seguridad, brecha, ataque
   - **Ofensa:** Registro asociado a ofensas/casos
4. Contenido:
   - Descripción detallada
   - Usa `#hashtags` para tags automáticos
   - Ejemplo: `#Trellix`, `#hunting`, `#malware`
5. **Subir**

**Hashtags:**
- Se extraen automáticamente del texto
- Se convierten a lowercase
- Máx 100 tags únicos por entrada
- Autocompletado mientras escribes

**Notas Personales:**
- Sidebar derecho → "Notas Personales"
- Solo tú las ves
- Autosave cada 3 segundos

### 3. Cierre de Turno

**Responsable:** Analista saliente

**Pasos:**

1. **Registrar Checklist Cierre** (acordeón lateral)
   - Click "Cierre de turno"
   - Evaluar todos los servicios nuevamente
   - Observaciones si hay cambios respecto al inicio

2. **Resumir Turno en Nota Personal** (opcional)
   - Incidentes atendidos
   - Pendientes para próximo turno

3. **Logout**

**Nota:** El cierre de turno puede disparar el reporte por correo si el turno tiene `emailReportConfig.enabled`.

---

## Boletín de Seguridad (operación diaria)

### Cuándo usarlo

- cuando se requiere comunicar riesgo técnico en formato ejecutivo para cliente
- cuando un mismo contenido debe enviarse a múltiples destinatarios, priorizando agrupación por dominio

### Flujo recomendado

1. Ir a `Reportes` y cambiar a modo `Boletín de Seguridad`.
2. Completar campos mínimos:
   - `Título`
   - `Criticidad`
   - `Resumen Ejecutivo`
   - `Impacto`
   - `Acciones Recomendadas`
3. Generar y revisar vista previa.
4. Cargar destinatarios en `Para` y, si aplica, copias internas en `CC`.
5. Revisar el selector `Unir destinatarios por dominio`:
   - activado (default): 1 envio por dominio exacto en `Para`
   - desactivado: envio 1:1 por destinatario
6. Validar que no existan correos repetidos entre `Para` y `CC`.
7. Enviar y confirmar resultado (`successCount` / `failCount` y `processedGroups` cuando aplique).

### Reglas operativas de envío

- no se usa `CCO`; el flujo opera solo con `Para` y `CC`
- si un correo aparece en `Para` y `CC`, el sistema bloquea el envío hasta corregir
- en modo agrupado por dominio, un destinatario con dominio único genera su propio envío
- ante fallos SMTP parciales, el backend devuelve conteo por destinatario real para facilitar diagnóstico

### Buenas prácticas de contenido

- mantener texto breve y accionable para clientes no técnicos
- usar listas en mitigación cuando existan pasos secuenciales
- validar que no se expongan datos internos sensibles del SOC

### Incidencia conocida: pegado de texto desde fuentes ricas

- si pegas texto desde web/PDF/Word y notas formato extraño, aplicar `Ctrl+F5` y reintentar.
- el formulario ya incluye normalización de pegado para preservar estructura básica (saltos, viñetas, filas).
- si una fuente específica sigue fallando, registrar ejemplo en `docs/ISSUES.md` para ajuste dirigido.

---

## Complementos

### Alta Operativa

1. Definir el modo de alta:
   - manual, si el servicio/frontend ya está desplegado
   - ZIP estático, si es un paquete HTML/JS simple que la plataforma publicará
2. En `Admin > Complementos`, validar el ZIP o completar el formulario manual.
3. Configurar solo los scopes mínimos necesarios.
4. Restringir visibilidad por rol/cargo si no es un complemento global.
5. Guardar el token emitido solo en el servicio correspondiente.
6. Ejecutar `Probar` antes de habilitar uso operativo.
7. Confirmar que aparezca en el menú lateral del usuario destino sin requerir `F5` prolongado; si el usuario usa el frontend Docker y sigue viendo UI vieja, forzar `Ctrl+F5`.

### Publicación ZIP recomendada

1. Subir ZIP en la pestaña de código fuente.
2. Revisar stack detectado y configuración sugerida.
3. Generar preview temporal.
4. Publicar solo si el stack detectado es `HTML/JS simple`.
5. Si el analizador detecta `Vite`, `React + Vite` o `Node.js`, desplegar fuera y registrar manualmente.

### Si aparece en Mantenimiento

1. Revisar el estado del circuito y el último error.
2. Filtrar auditoría por categoría `Complementos` o por slug.
3. Validar `healthPath`, tiempos de respuesta y reachability del microservicio.
4. Si es `zip-static`, verificar que exista el artefacto publicado en `uploads/complements/published/<slug>/`.
5. Esperar transición automática `HALF_OPEN` o usar `Probar` desde la consola admin.

### Si el complemento pierde datos visuales tras logout/login

1. Verificar si el complemento usa solo `localStorage` del navegador.
2. Si el dato debe persistir para el equipo, usar `browser-state` o `storage` de API interna.
3. Confirmar respuesta `200` en `GET/PUT /api/complements/:slug/browser-state`.
4. Recordar que `browser-state` es compartido por complemento, no por usuario.

---

## Reglas de Negocio Checklist

### Anti-spam (Previene errores)

❌ **NO permitido:**
- Dos "inicio" consecutivos sin "cierre" intermedio
- Dos "cierre" consecutivos sin "inicio" intermedio

✅ **Flujo correcto:**
```
inicio → cierre → inicio → cierre → inicio → ...
```

**Mensaje de error:**
```
No puedes registrar dos "inicio" consecutivos.
Debes hacer "cierre" primero.
```

### Cooldown Configurable

**Default:** 4 horas entre checks

**Configurable por admin:** 1-24 horas

**Cálculo:**
```
Tiempo desde último check >= cooldownHours
```

**Mensaje de error:**
```
Debes esperar 4 horas entre checks.
Tiempo restante: 2.3h
```

### Validación de Servicios

1. **Todos los servicios activos DEBEN incluirse**
   - Si catálogo tiene 5 servicios activos → deben evaluarse los 5

2. **Todos DEBEN tener estado (verde/rojo)**

3. **Si está en rojo:**
   - Observación OBLIGATORIA
   - Mínimo 10 caracteres, máximo 1000

**Ejemplo observación:**
```
Alerta de disco en servidor-logs-01.
Capacidad al 95%. Se solicitó ampliación a infra.
Ticket #12345.
```

### Indicador Visual del Acordeón

Muestra el **último check registrado**:

```
✅ Inicio: OK (sin rojos)
⛔ Inicio: Con problemas (al menos un rojo)
✅ Cierre: OK
⛔ Cierre: Con problemas
— Sin registro
```

---

## Clasificación de Entradas

### Entrada Operativa

**Uso:** Eventos normales del día a día

**Ejemplos:**
- Revisión de alertas en QRadar
- Actualización de reglas Wazuh
- Análisis de logs Zabbix
- Monitoreo de tráfico FortiGate
- Revisión de backups
- Cambios de configuración

**Tags comunes:**
- `#monitoreo`
- `#alertas`
- `#revisión`
- `#configuración`

### Incidente

**Uso:** Eventos de seguridad que requieren acción

**Ejemplos:**
- Intento de intrusión detectado
- Malware en estación de trabajo
- Acceso no autorizado
- Exfiltración de datos
- Ataque DDoS
- Phishing exitoso
- Vulnerabilidad crítica explotada

**Tags comunes:**
- `#incidente`
- `#malware`
- `#intrusión`
- `#phishing`
- `#vulnerabilidad`
- `#respuesta`

**Procedimiento adicional:**
- Escalar según playbook SOC
- Notificar a responsables
- Documentar paso a paso
- Adjuntar evidencias (IPs, hashes, logs)

---

## Notas Duales

### Notas del Administrador

**Sidebar derecho → superior**

**Características:**
- 🌍 **Globales:** Todos las ven
- ✏️ Solo admin puede editar
- 💾 Autosave cada 3 segundos

**Uso:**
- Avisos importantes
- Cambios en servicios
- Instrucciones de turno
- Contactos de emergencia
- Playbooks rápidos

**Ejemplo:**
```
🚨 IMPORTANTE:
- QRadar en mantenimiento 14:00-16:00 hoy
- Si alarma crítica, llamar a Juan (+56 9 1234 5678)
- Nueva regla Wazuh para detectar Log4Shell activa
```

### Notas Personales

**Sidebar derecho → inferior**

**Características:**
- 🔒 **Privadas:** Solo el usuario las ve
- ✏️ Cada usuario escribe las suyas
- 💾 Autosave cada 3 segundos

**Uso:**
- Pendientes personales
- Investigaciones en curso
- Links útiles
- Credenciales temporales (⚠️ no guardar passwords reales)

**Ejemplo:**
```
Pendientes turno:
- [ ] Revisar alarma de ayer (ticket #123)
- [ ] Actualizar regla FortiGate
- [x] Backup completado

Links:
- Dashboard Grafana: http://...
```

---

## Reportes y KPIs (Solo Admin)

**Admin → Reportes:**

### Dashboard

1. **Entradas operativas vs incidentes** (últimos N días)
   - Gráfico de barras
   - Filtro por rango de fechas

2. **Incidentes por analista** (top 10)
   - Ranking

3. **Top tags** (top 15 más usados)
   - Nube de palabras

4. **Checks con rojos por servicio**
   - Identifica servicios problemáticos

5. **Tendencia de entradas** (últimos 30 días)
   - Gráfico de línea

6. **Totales:**
   - Usuarios activos
   - Checks de turno registrados
   - Entradas totales

### Export CSV

**Admin → Reportes → Export Entradas:**

1. Seleccionar rango fechas
2. Click "Exportar CSV"
3. Descarga archivo: `bitacora_YYYY-MM-DD_YYYY-MM-DD.csv`

**Columnas:**
- Fecha, Hora
- Tipo (operativa/incidente)
- Contenido
- Tags
- Usuario
- Es Guest

**Uso:**
- Auditorías
- Análisis externo
- Respaldo adicional

---

## Configuración Avanzada (Admin)

### Catálogo de Servicios

**Admin → Checklist → Servicios:**

**Agregar servicio:**
1. Click "Nuevo servicio"
2. Título (ej: "QRadar")
3. Orden (opcional, drag & drop después)
4. Guardar

**Editar/Eliminar:**
- Click sobre servicio → Editar/Eliminar
- ⚠️ Si eliminas servicio, checks pasados lo mantienen

**Activar/Desactivar:**
- Toggle "Activo"
- Inactivos no aparecen en checklist nuevo
- Checks pasados siguen visibles

### Cooldown

**Admin → Config General:**

- **Cooldown entre checks:** 1-24 horas
- Default: 4 horas
- Afecta a todos los usuarios

**Caso de uso:**
- Turnos 8h → cooldown 7h
- Turnos 12h → cooldown 11h

### Modo Invitado

**Admin → Config General:**

- **Habilitar modo invitado:** Sí/No
- **Duración máxima:** 1-30 días (default 2)

**Creación guest:**
1. Admin → Admin Usuarios → Nuevo
2. Role: Guest
3. Se calcula automáticamente `guestExpiresAt`

**Expiración:**
- Login bloqueado después de fecha
- Mensaje: "Cuenta de invitado expirada"

---

### Autenticación Multifactor (MFA) - Administración

**Admin → Administración de Usuarios:**
1. El administrador puede habilitar o deshabilitar la autenticación multifactor individualmente para cualquier usuario del sistema desde el panel de edición de usuarios.
2. Al crearse una cuenta nueva o por defecto, la autenticación MFA se encuentra **desactivada**.
3. Al activar la opción **"Habilitar MFA por TOTP"** y guardar el perfil del usuario, el backend requerirá de forma obligatoria que el usuario complete su enrolamiento y verifique su código en su siguiente login.
4. Si el usuario pierde su dispositivo móvil o su llave TOTP, el administrador puede desactivar el flag MFA en el perfil del usuario para **restablecer** el acceso, permitiéndole ingresar nuevamente solo con contraseña o SSO y volver a enrolarse si es necesario.

### Cifrado de Respaldos (Backups)

**Admin → Backup/Restore:**
1. Al momento de generar un backup manual (`Crear Backup`) o configurar un backup automático, el administrador tiene la opción de cifrar el archivo de salida `.zip` ingresando una **Passphrase** (Frase de paso).
2. Si se ingresa una Passphrase, el sistema aplicará cifrado fuerte **AES-256-GCM** sobre el archivo empaquetado, derivando la clave criptográfica mediante **PBKDF2**.
3. **⚠️ IMPORTANTE:** El administrador es responsable de almacenar de forma segura la Passphrase. El SOC no podrá restaurar o importar el archivo de respaldo sin la clave exacta ingresada al momento de la creación.
4. Al importar o restaurar un backup cifrado, el sistema detectará el cifrado y solicitará la Passphrase para descifrar el flujo de datos en caliente antes de restaurarlo a MongoDB.

---

## Historial y Búsqueda

### Ver entradas

**🌍 Ver todas:**

**Filtros disponibles:**
- Búsqueda texto completo (contenido)
- Por tags (multiselect)
- Por tipo (operativa/incidente)
- Por rango fechas
- Por usuario (admin ve selector, users no)
- Paginación (20 por página)

**Ordenamiento:**
- Más recientes primero (default)

**Acciones:**
- Ver detalle
- Editar (solo creador o admin)
- Eliminar (solo creador o admin)

### Historial Checklist

**Checklist → Historial:**

**Filtros:**
- Por tipo (inicio/cierre)
- Por rango fechas
- Por usuario (admin only)

**Vista:**
- Fecha/hora
- Tipo
- Usuario
- Resumen (cuántos rojos)
- Click para ver detalle completo

---

## Troubleshooting Operativo

### Checklist no permite registrar

**Error: "No puedes registrar dos inicio consecutivos"**

**Causa:** Ya hiciste "inicio" y estás intentando otro "inicio"

**Solución:** Registra "cierre" primero

---

**Error: "Debes esperar X horas entre checks"**

**Causa:** Cooldown no cumplido

**Solución:**
- Esperar tiempo restante, O
- Pedir a admin que reduzca cooldown temporalmente

---

**Error: "Debes evaluar todos los servicios"**

**Causa:** Faltan servicios en la lista

**Solución:** Asegurar que lista tenga todos los servicios activos (acordeón muestra cuáles faltan)

---

**Error: "Servicio QRadar está en rojo y requiere observación"**

**Causa:** No pusiste observación en servicio rojo

**Solución:** Agregar observación (mín 10 chars)

### Email no se envía

**Verificar:**
1. Admin configuró SMTP (Admin → SMTP)
2. Configuración es válida (test OK)
3. Toggle "Enviar solo si hay rojos" coincide con tu check

**Log error:**
- Console backend muestra: "Error sending checklist email"
- Check se registra igual (email es opcional)

### No puedo editar entrada

**Causa:** Solo el creador o admin pueden editar

**Solución:**
- Si eres admin: editar normalmente
- Si no eres el creador: pedir al admin

---

## Checklist Pre-Turno

### Analista Entrante

- [ ] Verificar que MongoDB está corriendo
- [ ] Login exitoso
- [ ] Leer notas del administrador
- [ ] Registrar checklist inicio
- [ ] Revisar últimas entradas (30 min antes)
- [ ] Abrir dashboards SOC (QRadar, Zabbix, etc.)

### Analista Saliente

- [ ] Registrar checklist cierre
- [ ] Documentar incidentes no resueltos
- [ ] Actualizar notas personales (pendientes)
- [ ] Verificar que no quedan alertas críticas sin documentar
- [ ] Logout

### Admin

- [ ] Revisar reportes diarios
- [ ] Verificar backups automáticos
- [ ] Revisar logs de auditoría (si log forwarding activo)
- [ ] Actualizar notas del administrador si hay cambios
- [ ] Gestionar usuarios (activar/desactivar, renovar guests)

---

## Referencias

- **Despliegue:** [DEPLOY.md](./DEPLOY.md)
- **Instalación:** [SETUP.md](./SETUP.md)
- Fecha, Hora
- Tipo (operativa/incidente)
- Contenido
- Tags
- Usuario
- Es Guest

**Uso:**
- Auditorías
- Análisis externo
- Respaldo adicional

---

## Configuración Avanzada (Admin)

### Catálogo de Servicios

**Admin → Checklist → Servicios:**

**Agregar servicio:**
1. Click "Nuevo servicio"
2. Título (ej: "QRadar")
3. Orden (opcional, drag & drop después)
4. Guardar

**Editar/Eliminar:**
- Click sobre servicio → Editar/Eliminar
- ⚠️ Si eliminas servicio, checks pasados lo mantienen

**Activar/Desactivar:**
- Toggle "Activo"
- Inactivos no aparecen en checklist nuevo
- Checks pasados siguen visibles

### Cooldown

**Admin → Config General:**

- **Cooldown entre checks:** 1-24 horas
- Default: 4 horas
- Afecta a todos los usuarios

**Caso de uso:**
- Turnos 8h → cooldown 7h
- Turnos 12h → cooldown 11h

### Modo Invitado

**Admin → Config General:**

- **Habilitar modo invitado:** Sí/No
- **Duración máxima:** 1-30 días (default 2)

**Creación guest:**
1. Admin → Admin Usuarios → Nuevo
2. Role: Guest
3. Se calcula automáticamente `guestExpiresAt`

**Expiración:**
- Login bloqueado después de fecha
- Mensaje: "Cuenta de invitado expirada"

---

## Historial y Búsqueda

### Ver entradas

**🌍 Ver todas:**

**Filtros disponibles:**
- Búsqueda texto completo (contenido)
- Por tags (multiselect)
- Por tipo (operativa/incidente)
- Por rango fechas
- Por usuario (admin ve selector, users no)
- Paginación (20 por página)

**Ordenamiento:**
- Más recientes primero (default)

**Acciones:**
- Ver detalle
- Editar (solo creador o admin)
- Eliminar (solo creador o admin)

### Historial Checklist

**Checklist → Historial:**

**Filtros:**
- Por tipo (inicio/cierre)
- Por rango fechas
- Por usuario (admin only)

**Vista:**
- Fecha/hora
- Tipo
- Usuario
- Resumen (cuántos rojos)
- Click para ver detalle completo

---

## Troubleshooting Operativo

### Checklist no permite registrar

**Error: "No puedes registrar dos inicio consecutivos"**

**Causa:** Ya hiciste "inicio" y estás intentando otro "inicio"

**Solución:** Registra "cierre" primero

---

**Error: "Debes esperar X horas entre checks"**

**Causa:** Cooldown no cumplido

**Solución:**
- Esperar tiempo restante, O
- Pedir a admin que reduzca cooldown temporalmente

---

**Error: "Debes evaluar todos los servicios"**

**Causa:** Faltan servicios en la lista

**Solución:** Asegurar que lista tenga todos los servicios activos (acordeón muestra cuáles faltan)

---

**Error: "Servicio QRadar está en rojo y requiere observación"**

**Causa:** No pusiste observación en servicio rojo

**Solución:** Agregar observación (mín 10 chars)

### Email no se envía

**Verificar:**
1. Admin configuró SMTP (Admin → SMTP)
2. Configuración es válida (test OK)
3. Toggle "Enviar solo si hay rojos" coincide con tu check

**Log error:**
- Console backend muestra: "Error sending checklist email"
- Check se registra igual (email es opcional)

### No puedo editar entrada

**Causa:** Solo el creador o admin pueden editar

**Solución:**
- Si eres admin: editar normalmente
- Si no eres el creador: pedir al admin

---

## Checklist Pre-Turno

### Analista Entrante

- [ ] Verificar que MongoDB está corriendo
- [ ] Login exitoso
- [ ] Leer notas del administrador
- [ ] Registrar checklist inicio
- [ ] Revisar últimas entradas (30 min antes)
- [ ] Abrir dashboards SOC (QRadar, Zabbix, etc.)

### Analista Saliente

- [ ] Registrar checklist cierre
- [ ] Documentar incidentes no resueltos
- [ ] Actualizar notas personales (pendientes)
- [ ] Verificar que no quedan alertas críticas sin documentar
- [ ] Logout

### Admin

- [ ] Revisar reportes diarios
- [ ] Verificar backups automáticos
- [ ] Revisar logs de auditoría (si log forwarding activo)
- [ ] Actualizar notas del administrador si hay cambios
- [ ] Gestionar usuarios (activar/desactivar, renovar guests)

---

## Referencias

- **Despliegue:** [DEPLOY.md](./DEPLOY.md)
- **Instalación:** [SETUP.md](./SETUP.md)
- **API:** [API.md](./API.md)
- **Logging:** [LOGGING.md](./LOGGING.md)
- **Backup:** [BACKUP.md](./BACKUP.md)
- **Seguridad:** [SECURITY.md](./SECURITY.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Backlog y roadmap:** [ISSUES.md](./ISSUES.md)


# Matriz de Escalación

1. **Crear Clientes** (Tab "Clientes")
   ```json
   POST /api/escalation/admin/clients
   {
     "name": "ACME Corp",
     "code": "ACME",
     "description": "ACME Corporation International",
     "active": true
   }
   ```

2. **Crear Servicios** (Tab "Servicios")
   ```json
   POST /api/escalation/admin/services
   {
     "clientId": "64a1b2c3d4e5f6a7b8c9d0e1",
     "name": "ACME - Service A",
     "code": "ACME_SERVICE_A",
     "active": true
   }
   ```

3. **Crear Contactos** (Tab "Contactos")
   ```json
   POST /api/escalation/admin/contacts
   {
     "name": "John Doe",
     "email": "john.doe@example.com",
     "organization": "Service Provider Inc.",
     "role": "Jefe Operaciones",
     "active": true
   }
   ```

4. **Configurar Regla de Escalación** (Tab "Reglas de Escalación")
   ```json
   POST /api/escalation/admin/rules
   {
     "serviceId": "64a1b2c3d4e5f6a7b8c9d0e2",
     "recipientsTo": ["64a1b2c3d4e5f6a7b8c9d0e3"],
     "recipientsCC": ["64a1b2c3d4e5f6a7b8c9d0e4"],
     "emergencyPhone": "+1234567890",
     "active": true
   }
   ```

5. **Configurar Ciclo de Rotación** (Tab "Ciclos de Rotación")
   ```json
   POST /api/escalation/admin/cycles
   {
     "roleCode": "N2",
     "startDayOfWeek": 5,
     "startTimeUTC": "11:00",
     "durationDays": 7,
     "timezone": "America/Santiago",
     "active": true
   }
   ```
   Esto significa: Turnos N2 comienzan Viernes a las 08:00 Chile (11:00 UTC).

6. **Asignar Persona a Turno** (Tab "Turnos")
   ```json
   POST /api/escalation/admin/assignments
   {
     "roleCode": "N2",
     "userId": "64a1b2c3d4e5f6a7b8c9d0e5",
     "weekStartDate": "2026-01-03T11:00:00Z",
     "weekEndDate": "2026-01-10T11:00:00Z",
     "notes": "Semana 1 de enero"
   }
   ```

7. **Crear Override Temporal** (Tab "Turnos" → Overrides)
   ```json
   POST /api/escalation/admin/overrides
   {
     "roleCode": "N2",
     "replacementUserId": "64a1b2c3d4e5f6a7b8c9d0e6",
     "startDate": "2026-01-05T00:00:00Z",
     "endDate": "2026-01-12T23:59:59Z",
     "reason": "Vacaciones del titular",
     "active": true
   }
   ```

### Consulta (Analista)

1. Abrir `http://localhost:4200/main/escalation/view`
2. Seleccionar Cliente (ej: "ACME Corp")
3. Seleccionar Servicio (ej: "ACME - Service A")
4. Ver información:
   - **Contactos Externos**: Para/CC/Emergencia
   - **Turnos Internos**: Quién está de turno AHORA con badges de override

### Directorio Global (`/main/escalation/directory`)

1. Usa el formulario superior solo para crear un contacto nuevo.
2. Para modificar un contacto existente, pulsa **Editar** en su fila: el formulario se abre inline justo debajo del registro seleccionado.
3. Si vuelves a pulsar **Editar** sobre la misma fila, el editor contextual se cierra sin sacarte del lugar actual de la tabla.
4. El modulo sigue ofreciendo filtros operativos por busqueda, tipo y empresa, ademas de acciones de sincronizacion/consolidacion para mantener el directorio como fuente de verdad.

---

## 🔒 Seguridad

- **Vista de consulta**: Requiere autenticación (cualquier usuario)
- **Vista admin**: Requiere rol `admin`
- **Backend**: Middleware `requireAdmin` valida permisos en todas las rutas `/admin/*`
- **Directorio Global**: Requiere autenticacion; la escritura y eliminacion se gobiernan por RBAC segun cargo/rol operativo, por lo que algunos perfiles quedan en solo lectura y otros pueden crear/editar sin ser `admin` global.

---

## 🕐 Manejo de Fechas

- **Backend**: Guarda todas las fechas en ISO 8601 UTC
- **Frontend**: Convierte y muestra en zona horaria `America/Santiago` (-03:00)
- **Resolución de turnos**: El backend calcula "quién está de turno" usando:
  1. Overrides activos (prioridad máxima)
  2. Asignaciones regulares
  3. Si no hay nadie, devuelve `null`

---

## 📊 Ejemplos de Payloads

### GET Escalation View (Principal)

**Request:**
```
GET /api/escalation/view/64a1b2c3d4e5f6a7b8c9d0e2
```

**Response:**
```json
{
  "service": {
    "id": "64a1b2c3d4e5f6a7b8c9d0e2",
    "name": "ACME - Service A",
    "code": "ACME_SERVICE_A",
    "clientName": "ACME Corp"
  },
  "externalContacts": {
    "to": [
      { "id": "...", "name": "John Doe", "email": "john.doe@example.com" }
    ],
    "cc": [
      { "id": "...", "name": "Jane Smith", "email": "jane.smith@example.com" }
    ],
    "emergency": {
      "phone": "+1234567890",
      "contactName": null
    }
  },
  "internalShifts": [
    {
      "role": "N2",
      "roleName": "Nivel 2",
      "currentUser": {
        "id": "...",
        "name": "Juan Pérez",
        "email": "juan.perez@example.com"
      },
      "shiftPeriod": {
        "start": "2026-01-03T11:00:00Z",
        "end": "2026-01-10T11:00:00Z"
      },
      "isOverride": false
    },
    {
      "role": "TI",
      "roleName": "Soporte TI",
      "currentUser": {
        "id": "...",
        "name": "María González (Reemplazo)",
        "email": "maria.gonzalez@example.com"
      },
      "shiftPeriod": {
        "start": "2026-01-05T00:00:00Z",
        "end": "2026-01-12T23:59:59Z"
      },
      "isOverride": true,
      "overrideReason": "Vacaciones del titular"
    }
  ],
  "timestamp": "2026-01-03T18:30:00Z"
}
```

---

## 🛠️ Troubleshooting

### No aparece información de turnos

1. Verificar que existan asignaciones:
   ```
   GET /api/escalation/admin/assignments?roleCode=N2
   ```
2. Verificar fechas:
   - Las fechas deben estar en UTC
   - `weekStartDate <= now <= weekEndDate`

### Override no se aplica

1. Verificar que `active: true`
2. Verificar fechas: `startDate <= now <= endDate`
3. Los overrides tienen prioridad sobre asignaciones regulares

### Error al crear cliente/servicio con código duplicado

- Los campos `code` son únicos
- Usar códigos diferentes o modificar el existente

---

## 📝 TODO (Mejoras Futuras)

- [ ] Dialogs CRUD en admin (actualmente solo delete funciona)
- [ ] Filtros avanzados en tablas (búsqueda, paginación)
- [ ] Exportar configuración a Excel/CSV
- [ ] Notificaciones cuando cambia el turno
- [ ] Integración con calendario (Google Calendar, Outlook)
- [ ] Historial de cambios (auditoría de overrides)


# Troubleshooting

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

**Causa común:** Estás viendo el frontend Docker en `:80/:443` y no el `pnpm start` local (`:4200`), o el navegador quedó con caché fuerte.

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

### Boletín no envía: conflicto entre `Para` y `CC` (error 400)

**Síntoma:** al enviar boletín aparece error indicando que hay correos repetidos entre `Para` y `CC`.

**Causa:** el sistema bloquea por diseño cualquier correo duplicado entre ambos campos para evitar ambigüedad de entrega.

**Acciones:**

1. Revisar lista de correos reportados en el mensaje de error.
2. Dejar cada correo en un solo campo (`Para` o `CC`).
3. Reintentar envío.

**Nota operativa:** no se usa `CCO`; el flujo de boletines opera solo con `Para` y `CC`.

### Boletín envía más/menos correos de los esperados

**Síntoma:** el operador esperaba un envío 1:1, pero ve menos correos; o esperaba agrupación y se envían más.

**Causa típica:** estado del selector `Unir destinatarios por dominio` en `/main/report-generator`.

- activado (default): 1 envío por dominio exacto en `Para`
- desactivado: envío 1:1 por destinatario

**Acciones:**

1. Confirmar estado del selector antes de enviar.
2. Verificar dominios de los destinatarios en `Para`.
3. Validar resultado con `processedGroups`, `successCount` y `failCount`.

### Boletín con éxito parcial SMTP

**Síntoma:** la UI muestra enviados y fallidos en el mismo intento.

**Contexto:** el backend contabiliza éxito/fallo por destinatario real en `Para`; con algunos servidores SMTP puede haber aceptación parcial.

**Acciones:**

1. Revisar métricas de respuesta (`successCount`, `failCount`, `processedGroups`).
2. Consultar logs backend para causa técnica:
   ```bash
   docker compose logs --tail=200 backend | grep newsletter/send
   ```
3. Corregir direcciones inválidas/rechazadas y reintentar solo los faltantes.

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


# Sistema de Logging

# 📊 Sistema de Logging y Auditoría - BitacoraSOC

## Arquitectura

El sistema implementa 3 capas de observabilidad:

1. **Logs estructurados** (pino): JSON para stdout/stderr
2. **Auditoría persistente** (MongoDB): AuditLog collection con TTL
3. **Forwarding a SIEM** (TCP/TLS): Envío a colector externo

---

## 1. Logs Estructurados (pino)

### Formato

```json
{
  "level": 30,
  "time": 1704067200000,
  "pid": 12345,
  "hostname": "soc-server",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "event": "auth.login.success",
  "userId": "507f1f77bcf86cd799439011",
  "role": "admin",
  "msg": "User logged in"
}
```

### Niveles

- `trace` (10): Debug muy detallado
- `debug` (20): Debug general
- `info` (30): Eventos informativos (default)
- `warn` (40): Advertencias
- `error` (50): Errores
- `fatal` (60): Errores fatales

### Uso en código

```javascript
const { logger, requestLogger, actorLogger, sanitize } = require('./utils/logger');

// Log básico
logger.info({ event: 'user.login', userId: '123' }, 'User logged in');

// Con request context
const reqLogger = requestLogger(req);
reqLogger.info({ event: 'entry.create' }, 'Entry created');

// Con actor context
const actorLog = actorLogger(req.user);
actorLog.warn({ event: 'permission.denied' }, 'Access denied');

// Sanitizar objeto (remove secrets)
const safe = sanitize({ password: '123', data: 'public' });
// → { data: 'public' } (password removido)
```

### Variables de entorno

```bash
LOG_LEVEL=info          # Nivel mínimo (info, debug, warn, error)
NODE_ENV=production     # Si es "production", no usa pretty print
```

---

## 2. Auditoría Persistente (MongoDB)

### Colección: AuditLog

```javascript
{
  _id: ObjectId,
  timestamp: Date,           // indexed
  event: String,             // namespace.action (ej: "auth.login.success")
  level: String,             // info | warn | error
  actor: {
    userId: ObjectId,
    username: String,
    role: String,
    isGuest: Boolean
  },
  request: {
    requestId: String,       // correlation ID
    ip: String,
    userAgent: String,
    method: String,
    path: String
  },
  result: {
    success: Boolean,
    reason: String,
    statusCode: Number
  },
  metadata: Object,          // flexible (sanitizado)
  forwarded: Boolean         // true si se envió a SIEM
}
```

### TTL (Time To Live)

Los logs se eliminan automáticamente después de **90 días** (configurable):

```bash
AUDIT_TTL_DAYS=90
```

### Inmutabilidad

Los registros de auditoría **NO se pueden modificar ni eliminar** manualmente. Mongoose hooks lo previenen.

### Uso en código

```javascript
const { audit } = require('./utils/audit');

// En una ruta
await audit(req, {
  event: 'entry.create',
  level: 'info',
  result: { success: true },
  metadata: {
    entryId: entry._id,
    entryType: 'incidente',
    tagCount: 5
  }
});
```

### Eventos auditados


| Namespace            | Acción                                                                                   | Nivel           | Descripción                |
| -------------------- | ---------------------------------------------------------------------------------------- | --------------- | -------------------------- |
| `auth.login`         | `.success` / `.fail`                                                                     | info/warn       | Login de usuario           |
| `entry.create`       | `.update` / `.delete`                                                                    | info            | CRUD de entradas           |
| `shiftcheck.submit`  | -                                                                                        | info            | Registro de check de turno |
| `shiftcheck.block`   | `.consecutive` / `.cooldown`                                                             | warn            | Bloqueos de validación     |
| `admin.users`        | `.create` / `.update` / `.delete`                                                        | info            | Gestión de usuarios        |
| `admin.backup`       | `.create` / `.restore`                                                                   | info            | Backups                    |
| `admin.logging`      | `.view` / `.update` / `.test`                                                            | info            | Config de forwarding       |
| `complement.install` | -                                                                                        | info            | Alta de complemento        |
| `complement.update`  | `.permissions` / `.config`                                                               | info            | Cambios administrativos    |
| `complement.delete`  | `.initiated` / `.completed`                                                              | warn            | Baja y wipe-out            |
| `complement.wipe`    | `.hook_sent` / `.hook_timeout` / `.db_dropped` / `.general_purged` / `.orphans_detected` | info/warn/error | Trail forense de borrado   |
| `complement.api`     | `.denied` / `.log_entry`                                                                 | warn/info       | API interna y denegaciones |
| `complement.circuit` | `.open` / `.half_open` / `.close`                                                        | warn/info       | Estado de resiliencia      |


### API de auditoría (admin/auditor)

```
GET /api/audit-logs
GET /api/audit-logs/events
GET /api/audit-logs/stats
```

**Roles:** `admin` y `auditor`.

Los eventos de complementos se registran con `source="complement"` y `sourceId="<slug>"` para facilitar filtros operativos y forwarding a SIEM.

---

## 3. Log Forwarding (SIEM)

### Configuración

Solo **admin** puede configurar forwarding:

**GET** `/api/logging/config`

```json
{
  "enabled": false,
  "host": "siem.example.com",
  "port": 5140,
  "mode": "plain",
  "tls": {
    "rejectUnauthorized": true,
    "caCert": "-----BEGIN CERTIFICATE-----...",
    "clientCert": null
  },
  "retry": {
    "enabled": true,
    "maxRetries": 5,
    "backoffMs": 1000
  },
  "forwardLevel": "audit-only"
}
```

**PUT** `/api/logging/config`

```json
{
  "enabled": true,
  "host": "10.0.101.200",
  "port": 5140,
  "mode": "tls",
  "forwardLevel": "audit-only"
}
```

**POST** `/api/logging/test` → Envía log de prueba

### Formato enviado (NDJSON)

Cada línea es un JSON completo:

```json
{"timestamp":"2024-01-01T12:00:00.000Z","event":"auth.login.success","level":"info","actor":{"userId":"507f...","username":"admin","role":"admin","isGuest":false},"request":{"requestId":"550e8400...","ip":"10.0.101.10","userAgent":"Mozilla/5.0...","method":"POST","path":"/api/auth/login"},"result":{"success":true,"reason":"Login successful"},"metadata":{"isGuest":false}}
{"timestamp":"2024-01-01T12:05:00.000Z","event":"entry.create","level":"info","actor":{...},"request":{...},"result":{...},"metadata":{...}}
```

### Protocolos

#### TCP Plain

```bash
# Test receptor (netcat)
nc -l 5140
```

Usar solo en desarrollo o redes internas aisladas.

#### TCP + TLS

```bash
# Test receptor (openssl)
openssl s_server -accept 5140 -cert server.pem -key server-key.pem
```

Producción DEBE usar TLS con certificado válido.

### mTLS (Mutual TLS)

Si el SIEM requiere client certificate:

1. Admin sube `clientCert` (PEM) en config
2. Admin configura `LOG_FORWARD_CLIENT_KEY` en `.env`:

```bash
LOG_FORWARD_CLIENT_KEY=/path/to/client-key.pem
```

⚠️ **NUNCA** guardar `clientKey` en MongoDB (solo en env).

### Filtrado por nivel

- `audit-only`: Solo eventos de AuditLog (default)
- `info`: AuditLog + logs info
- `warn`: AuditLog + logs warn/error
- `error`: Solo logs error

### Backoff exponencial

Si el colector está down:

- Intento 1: wait 1s
- Intento 2: wait 2s
- Intento 3: wait 4s
- Intento 4: wait 8s
- Intento 5: wait 16s
- Intento 6+: desiste

### Queue

Si conexión está caída, los logs se encolan en memoria (max 1000). Cuando reconecta, se envían todos.

---

## Seguridad

### Sanitización automática

Estas claves se **eliminan** antes de loggear:

- `password`
- `token`
- `jwt`
- `secret`
- `apiKey`
- `authorization`
- `cookie`

### Límite de metadata

Metadata de audit se trunca a **10KB** para evitar payloads gigantes.

### Certificados

- **CA Cert**: validar identidad del servidor SIEM
- **Client Cert**: autenticación mTLS (opcional)
- **rejectUnauthorized**: `true` por defecto (NO aceptar self-signed en prod)

---

## Correlation ID (X-Request-Id)

Cada request tiene un UUID v4 único:

- Cliente puede enviar header `X-Request-Id` (se reutiliza)
- Si no existe, backend genera uno nuevo
- Aparece en **todos** los logs de ese request
- Se retorna en response header

Permite tracing end-to-end: Frontend → Backend → Logs → SIEM

---

## Troubleshooting

### Los logs no aparecen en stdout

Verificar `LOG_LEVEL`:

```bash
LOG_LEVEL=debug node src/server.js
```

### AuditLog no persiste

Verificar conexión MongoDB:

```bash
mongo
> use bitacora_soc
> db.auditlogs.find().limit(5)
```

### Forwarding no funciona

1. Test conexión:
  ```bash
   curl -X POST http://localhost:3000/api/logging/test \
     -H "Authorization: Bearer <admin-token>"
  ```
2. Verificar logs del forwarder:
  ```bash
   grep "logforward" logs/combined.log
  ```
3. Test manual (netcat):
  ```bash
   # Terminal 1
   nc -l 5140

   # Terminal 2 (admin UI o API)
   # Habilitar forwarding → host localhost, port 5140
  ```

### TLS handshake fails

Verificar certificados:

```bash
openssl s_client -connect siem.example.com:5140 -showcerts
```

Si usa self-signed en dev, set `rejectUnauthorized: false` (⚠️ NO en prod).

---

## Integración SIEM

### Logstash

```ruby
input {
  tcp {
    port => 5140
    codec => json_lines
  }
}

filter {
  mutate {
    add_field => { "[@metadata][source]" => "bitacora-soc" }
  }
}

output {
  elasticsearch {
    hosts => ["http://localhost:9200"]
    index => "bitacora-%{+YYYY.MM.dd}"
  }
}
```

### Graylog

1. **System / Inputs** → Create Input
2. Type: **Raw/Plaintext TCP**
3. Port: 5140
4. Codec: **JSON Lines** (extractor)

### Splunk

```bash
# inputs.conf
[tcp://5140]
sourcetype = _json
source = bitacora-soc
```

---

## Performance

### pino (logger)

- **3x más rápido** que winston
- Writes asíncronos a stdout (non-blocking)
- Pretty print solo en dev (prod es JSON puro)

### logForwarder

- **Queue in-memory**: 1000 logs max (previene memory leak)
- **No blocking**: `process.nextTick` para forwarding
- **Connection pooling**: reutiliza socket TCP/TLS

### AuditLog

- **Indexes**: timestamp, event, actor.userId
- **TTL index**: auto-delete después de 90 días
- **Immutable**: no se puede UPDATE/DELETE (solo INSERT)

---

## Desarrollo

### Test sin SIEM real

```bash
# Terminal 1: Start backend
cd backend
pnpm run dev

# Terminal 2: Start netcat collector
nc -l 5140

# Terminal 3: Configure forwarding (admin)
curl -X PUT http://localhost:3000/api/logging/config \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "host": "localhost",
    "port": 5140,
    "mode": "plain",
    "forwardLevel": "audit-only"
  }'

# Terminal 4: Trigger audit event
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME"}'

# Ver en Terminal 2: JSON llegando a netcat
```

### Pretty logs en dev

```bash
NODE_ENV=development pnpm run dev
```

Output:

```
[12:00:00.123] INFO (12345): User logged in
    event: "auth.login.success"
    userId: "507f1f77bcf86cd799439011"
    requestId: "550e8400-e29b-41d4-a716-446655440000"
```

### Modo JSON puro

```bash
NODE_ENV=production pnpm start
```

Output:

```json
{"level":30,"time":1704067200123,"pid":12345,"event":"auth.login.success","userId":"507f1f77bcf86cd799439011","msg":"User logged in"}
```

---

## Referencias

- [pino documentation](https://getpino.io/)
- [NDJSON specification](http://ndjson.org/)
- [RFC 4122 (UUID)](https://datatracker.ietf.org/doc/html/rfc4122)
- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/signals/traces/#context-propagation)



