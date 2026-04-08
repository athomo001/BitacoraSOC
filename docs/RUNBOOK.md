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

### Auditor
- Lectura de logs de auditoría
- Consulta de actividad (sin cambios de configuración)

### User (Analista)
- Registrar entradas operativas/incidentes
- Checklist de turno (inicio/cierre)
- Ver todas las entradas
- Editar perfil propio

### Guest (Temporal)
- Registrar entradas (marcadas como guest)
- Ver todas las entradas
- Expira automáticamente (default 2 días)

---

## Flujo de Turno

### 1. Inicio de Turno

**Responsable:** Analista entrante

**Pasos:**

1. **Login** → `http://IP_SERVIDOR:4200`
   - Username / Password
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
- cuando un mismo contenido debe enviarse a múltiples destinatarios en forma 1:1

### Flujo recomendado

1. Ir a `Report Generator` y cambiar a modo `Boletín de Seguridad`.
2. Completar campos mínimos:
   - `Título`
   - `Criticidad`
   - `Resumen Ejecutivo`
   - `Impacto`
   - `Acciones Recomendadas`
3. Generar y revisar vista previa.
4. Cargar destinatarios y enviar (un correo por destinatario, sin CC/BCC masivo).
5. Confirmar resultado de envío (`successCount` / `failCount`).

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

## Historial y Búsqueda

### Ver Todas las Entradas

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
