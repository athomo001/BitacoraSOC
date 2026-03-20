<!-- markdownlint-disable MD013 MD007 MD030 MD031 MD034 MD036 MD050 MD032 -->
# Plan de Trabajo: Bitácora SOC

## Tablas de Control

### ⏳ Pendientes

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| INFRA-MONGO-001 | Pendiente | Infraestructura / Datos CRÍTICA | Upgrade MongoDB (7 → 8) | El motor base de `mongo:7` en el docker-compose termina su soporte LTS oficial en Agosto de 2026. Se debe planificar un salto a `mongo:8`. Dado que los archivos de base de datos `.wt` no siempre son retrocompatibles entre versiones mayores, el protocolo a documentar e investigar requerirá: 1) `mongodump` completo; 2) Borrar el contenedor y limpiar el volumen físico `.data/mongodb_data`; 3) Levantar el nuevo `mongo:8` vacío; 4) Inyectar los datos de vuelta con `mongorestore`. |
| B19 | Pendiente | Integraciones | Creación de tickets en GLPI (Correo / API) | Definir flujo final (resumen diario vs evento inmediato), destino y estrategia de reintentos. |
| AI-SUMMARY-001 | Pendiente | IA/Operación ALTA | Módulo de Resumen Ejecutivo Efímero (IA On-Demand) | Integrar Ollama+llama3.2:3b en modo efímero `docker start -> healthcheck -> generate -> docker stop` con `try/finally`, salida editable en campo "Resumen Sugerido por IA" y botón "Generar con IA". |
| DEP-NPM-012 | Pendiente | Deuda Técnica / Backend MEDIA | Dependencias npm deprecadas en build Docker (`glob`/`inflight`) | Durante `npm install --omit=dev` en backend aparecen warnings por paquetes deprecados (`glob@7.2.3`, `glob@10.5.0`, `inflight@1.0.6`). Se requiere trazar árbol de dependencias, actualizar paquetes raíz y regenerar lockfile para eliminar dependencias sin soporte y riesgo de seguridad/memoria. |
| FE-SASS-013 | Pendiente | Deuda Técnica / Frontend MEDIA | Migrar `@import` Sass a `@use/@forward` en login | Build Angular reporta deprecación en `src/app/pages/login/login.component.scss` por `@import 'login-infoflow';`. Sass eliminará `@import` en Dart Sass 3.0.0; se debe migrar a módulos `@use/@forward` para compatibilidad futura. |
| AUDIT-014 | Pendiente | Auditoría / Backend+Frontend ALTA | Login exitoso no muestra actor real en Auditoría | Hallazgo operativo: al autenticarse un usuario, el registro aparece como `Sistema` en columna Actor y sin contexto suficiente del usuario autenticado. Se debe corregir la atribución para que `auth.login.success` persista/renderice `actorId/username` reales (sin exponer secretos) y permita trazabilidad forense confiable. |
| MAIL-AUDIT-015 | Pendiente | Email / Observabilidad ALTA | Error `❌ [CORREO] Para: sin destinatarios` sin contexto diagnóstico | Hallazgo operativo: en auditoría se observan múltiples WARN/ERROR de correo con texto genérico `Para: sin destinatarios`, sin identificar origen exacto (módulo, turno/checklist, trigger, destinatarios calculados, config SMTP). Se requiere enriquecer metadata y razón visible para identificar por qué falla y desde qué flujo se dispara. |
| BACKUP-AUTO-016 | Pendiente | Backup / Operación ALTA | Backup automático no se ejecuta según intervalo configurado | Hallazgo operativo: con backups automáticos habilitados (`cada 7 días`) no aparecen ejecuciones automáticas en historial aun habiendo transcurrido más de 9 días; solo se observan backups manuales. Se debe validar scheduler, persistencia de última ejecución y timezone/frecuencia real del job. |
| B34 | Pendiente | Operación/Alertas | Alerta por ítems NOK (Rojo) en Checklist | Añadir switch en config global para activar/desactivar alerta por ítems en rojo. Agregar selector de cargo (ej. N2) a notificar. Al guardar el checklist, si el analista marca ítems NOK (rojo), enviar email automático a todos los usuarios del cargo seleccionado incluyendo el detalle/observación ingresada por el analista. |
| SEC-HIGH-009 | Pendiente | Seguridad ALTA | Riesgo de Regex Injection / ReDoS en búsquedas de catálogo y tags (NoSQL) | Hallazgo QA: existen regex construidas directo desde input sin escape (`new RegExp(search, 'i')`, `new RegExp('^' + q, 'i')`, `$regex` con `topic` sin escapar) en rutas autenticadas/admin. Un patrón malicioso puede disparar backtracking costoso y degradar el backend (DoS lógico). Archivos detectados: `backend/src/routes/admin-catalog.js`, `backend/src/routes/tags.js`, `backend/src/routes/entries.js`, `backend/src/controllers/escalationController.js`. |
| SEC-HIGH-010 | Pendiente | Seguridad ALTA | OWASP A10 SSRF: URLs salientes configurables sin allowlist en integraciones | Hallazgo QA: endpoints de integración permiten destinos salientes controlados por configuración (`GLPI api.baseUrl` y `logging http.url`) sin validación estricta de red interna/loopback/protocolos. Riesgo: Server-Side Request Forgery desde backend hacia servicios internos/metadatos si una cuenta admin se compromete. Archivos detectados: `backend/src/routes/glpi.js`, `backend/src/routes/logging.js`, `backend/src/utils/logForwarder.js`. |
| SEC-MED-011 | Pendiente | Seguridad MEDIA | OWASP A09/A02: Logging sensible en autenticación (username + estado de password) | Hallazgo QA: en login se registran por consola datos sensibles de autenticación (`LOGIN REQUEST`, `Usuario encontrado`, `Password match`) sin condicionamiento por entorno. Riesgo: exposición de telemetría de credenciales/intentos en logs operativos. Archivo detectado: `backend/src/routes/auth.js`. |

### ✅ Listas

| ID | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- |
| INFRA-NODE-ALL | Listo | Infraestructura / Seguridad CRÍTICA | Upgrade Completo y Pruebas a Node 24 LTS | Se migraron las imágenes Docker a `node:24-alpine`. Mongoose 8 y Bcrypt compilaron sus bindings nativos exitosamente bajo el nuevo musl libc. Webpack de Angular funcionó perfecto. Levantamiento de contenedores estable. |
| B-CRÍTICO-001 | Listo | Bugs CRÍTICO | Emails no llegan en cierre checklist | Corregido y validado. |
| SEC-CRIT-001 | Listo | Seguridad CRÍTICA | Exposición de credenciales SMTP en `/api/config` | Respuesta sanitizada y endpoints sensibles restringidos. |
| SEC-CRIT-002 | Listo | Seguridad CRÍTICA | Recuperación de contraseña vulnerable | Link seguro y sin fuga de token en respuesta. |
| SEC-CRIT-003 | Listo | Seguridad CRÍTICA | Refresh indefinido de JWT expirados | Corregido. |
| SEC-CRIT-004 | Listo | Seguridad CRÍTICA | RBAC incompleto para `guest` | Endpoints críticos endurecidos. |
| SEC-CRIT-005 | Listo | Seguridad CRÍTICA | Anti brute-force login | Rate-limits aplicados en auth. |
| SEC-HIGH-006 | Listo | Seguridad ALTA | Credenciales por defecto débiles | Eliminadas del flujo principal. |
| SEC-HIGH-007 | Listo | Seguridad ALTA | Riesgo de robo JWT por XSS | Sesión en cookie `HttpOnly` y ajuste de flujo auth. |
| SEC-HIGH-008 | Listo | Seguridad ALTA | Path Traversal en backups | Validación estricta de filename/ruta. |
| B5 | Listo | Bugs CRÍTICO | Acceso a rutas sin autenticación | Rutas críticas protegidas. |
| B6 | Listo | UI/UX | Dark mode contraste | Refactor con tokens y mejoras de legibilidad. |
| B8 | Listo | Mejoras | Edición admin de entradas | Implementado con whitelist + auditoría. |
| B9 | Listo | Mejoras | Checklist por tipo/turno | Implementado en backend + UI. |
| B10 | Listo | Mejoras | Branding favicon configurable | Implementado con endpoints y UI. |
| B11 | Listo | Mejoras | Auditoría de correo y acciones | Eventos y filtros ampliados. |
| B12 | Listo | Mejoras | Huevo de pascua login | Implementado. |
| B13 | Listo | Mejoras | Huevo de pascua por hashtag | Implementado. |
| B15 | Listo | Bugs | Compatibilidad visual correo HTML | Ajustado para clientes dark/light. |
| B16 | Listo | Seguridad/Arquitectura | Auditoría avanzada | Implementado según alcance actual. |
| B18 | Listo | Integraciones | Módulo general de integraciones | Implementado en consola admin. |
| B21 | Listo | Backup/Operación | Backups automáticos + retención | Implementado. |
| B25 | Listo | UI/UX + Operación | Log Sources/Clientes activos vs inactivos | Implementado. |
| B27 | Listo | UI/UX + Arquitectura | Consola Admin unificada | Implementado. |
| B30 | Listo | UI/UX Escalación | `/main/admin/escalation` compacta por meses | Mes actual visible, mes anterior en acordeón e histórico on-demand con filtro backend (`fromDate/toDate/limit`). |
| B31 | Listo | Arquitectura/Datos Escalación | Fuente única de clientes con `CatalogLogSource` | Escalación unificada a Log Sources habilitados + cascada de limpieza al borrar log source + script de migración. |
| B32 | Listo | Usuarios/Notificaciones | Campo `cargo` en CRUD de usuarios (base + custom) | Backend/frontend end-to-end con validación, persistencia, edición y columna de cargo en listado. Cargos base: N1, N2, N3, QA Nivel 1/2, Pentester N1/N2, Arquitecto SIEM, CSM, Jefe Área, Gerente Área. |
| B33 | Listo | Operación/Alertas | Recordatorio simple de escalación interna por cargo | Configuración desde Escalación Interna para seleccionar cargos (ej. N2/N3) y envío diario simple a usuarios activos con esos cargos. |
| P1 | Listo | Angular 20 | Plan general actualización | Completo. |
| B29 | Listo | Turnos/Operación | Módulo de Asignación Operativa (usuario ↔ turno) debajo de tabla de turnos | UI implementada. |
| OPS-ASSIGN-001 | Listo | Frontend/Integración ALTA | Selector de usuarios no funcional en Admin Turnos | Integrado con API. |
| OPS-ASSIGN-002 | Listo | Backend/API ALTA | No existe API dedicada | Creado CRUD `work-shifts/assignments`. |
| OPS-ASSIGN-003 | Listo | Modelo de Datos ALTA | Modelo sin recurrencia por días | Creada colección `WorkShiftAssignment`. |
| OPS-ASSIGN-004 | Listo | Lógica Operativa ALTA | Falta cálculo de estado `EN TURNO / FUERA DE TURNO` | Implementado estado local y remoto. |
| OPS-ASSIGN-005 | Listo | Frontend/Arquitectura MEDIA | Refresco en vivo con observable | Implementado `interval(60000)`. |
| OPS-ASSIGN-006 | Listo | Frontend/Calidad MEDIA | Lógica duplicada de comparación | Creado `shift-time.util.ts`. |
| OPS-ASSIGN-007 | Listo | Backend/Validaciones ALTA | Reglas anti-solapamiento de asignaciones | Validación robustecida en POST/PUT backend. |
| OPS-ASSIGN-008 | Listo | Backend/Timezone ALTA | Ignora timezone del turno | Refactor a `get/current` con `moment-timezone`. |
| OPS-ASSIGN-010 | Listo | UI/UX + Datos MEDIA | Columna "Asignado a" desactualizada | Resumen adaptado en tabla principal. |
| OPS-ASSIGN-011 | Listo | Operación/Turnos ALTA | Asignaciones de turno aparentan perderse después de deploy | Corregida la resolución post-reinicio: el turno actual ahora reconstruye analistas desde `WorkShiftAssignment` según día/horario/vigencia, y la columna `Asignado a` en Admin Turnos deja de depender del campo legacy `assignedUserId` del `WorkShift`. Validación real en DB confirmó que las asignaciones persistían y el problema era de lectura/UI. |
| OPS-ASSIGN-009 | Listo | QA/Pruebas MEDIA | Faltan pruebas completas de integración | Compilación frontend OK y refactor a utilities. |
| B28 | Listo | Infraestructura/Seguridad | Configuración HTTPS simplificada | Wizard fluido y seguro implementado en Angular. |
| SEC-HTTPS-ALL | Listo | Seguridad/Operación CRÍTICA | 19 Vulnerabilidades y Fallos de Arquitectura TLS (001 a 019) | Hot-reloading con SNI, volúmenes de Docker estancos, validaciones criptográficas previas a guardado, CORS estricto y UX de 1 paso logrados con 0-downtime. |
| B37 | Listo | Seguridad / Infra BLOQUEANTE | Error SSL tras reinicio (ERR_SSL_PROTOCOL_ERROR) | Se añadió lógica de auto-recuperación en SNICallback para recargar certificados en caliente si se pierde el contexto tras un reinicio. |
| B38 | Listo | Backend / Bug | Error 400 en `/api/work-shifts/assignments` | Se corrigió el orden de rutas en el servidor y se actualizó el frontend a una ruta más específica para evitar conflicto con el validador de IDs. |
| B39 | Listo | UI/UX + Lógica | Checklist: ocultar estado de item padre con sub-items | Frontend y backend ajustados: el padre ya no pide estado/observación manual, su estado se deriva desde los hijos y la API solo exige observación para nodos hoja en rojo. Validado end-to-end con plantilla temporal padre/hijo y envío real del checklist. |
| B40 | Listo | UI/UX + Bug | Report Generator: búsqueda de ofensas no encuentra nuevas ni coincide por texto | Se cerró el ajuste completo backend+frontend: búsqueda rankeada para términos cortos, refresh del autocomplete sin cache stale y validación viva por API confirmando que `TOR` aparece correctamente como coincidencia principal. |
| B42 | Listo | UI/UX + Bug | Report Generator: imágenes de evidencia pierden nitidez al enviarse por correo | Se mantuvo el layout técnico fijo y se mejoró la nitidez al evitar upscaling de evidencia (usa dimensiones reales de la imagen), preservando proporción y permitiendo abrir la evidencia original al hacer clic. |
| B43 | Listo | Email / UX / Mantenibilidad | Email de turno: refactorizar a MJML y rediseñar como dashboard escaneable | `generateReportHTML` migrado a MJML con compatibilidad robusta para clientes de correo, nuevo header con branding y favicon opcional (`AppConfig.faviconUrl`), resumen ejecutivo (OK/NO OK/Entradas), checklist en tarjetas escaneables, bitácora en bloques jerárquicos y observaciones mostradas solo cuando existen. |
| B44 | Listo | Email / UX | Reporte de turno: mostrar estado "REPARADO" (amarillo) cuando entrada fue ERROR y salida fue OK | Implementado en el correo de turno: `REPARADO` aparece solo en salida cuando entrada fue rojo y salida verde, únicamente si inicio/cierre corresponden a la misma checklist (ID o fallback por nombre). Si salida es rojo, siempre queda `ERROR`. |
| B45 | Listo | Operación/Turnos + Email | Correo de fin de turno debe posponerse hasta checklist de cierre real (si analista se atrasa) | Implementado en backend: el trigger automático de fin de turno ya no envía si no existe checklist de cierre (`PENDIENTE_POR_CIERRE`), el envío se ejecuta al registrar cierre incluso fuera de la hora fin (ventana extendida en trigger manual), y se mantiene control anti-duplicado con `lastReportSentAt` más trazabilidad `ENVIADO_DIFERIDO`/`PENDIENTE_POR_CIERRE`. |
| B35 | Listo | UI/UX + Bug | Ajuste Header Checklist y Fix "Último Check" | H1 cambiado a título fijo "Checklist del Turno"; nombre de plantilla se muestra como subtítulo. Accordion usa el nombre de la plantilla. Backend `GET /check/last` corregido para retornar el último check del equipo (sin filtro por usuario), garantizando que siempre se muestre el registro más reciente real. |
| B36 | Listo | UI/UX | Aprovechamiento de ancho de pantalla | Cajón de notas (right sidebar) cambiado a `mode="over"` (overlay sobre el contenido, sin empujar). Cuando las notas se abren, el contenido recibe `margin-right: 350px` vía clase `.with-notes-open` para evitar solapamiento. El contenido principal usa `transition` suave y ocupa el ancho completo disponible en pantallas grandes. Eliminado `max-width: 900px` del contenedor del Checklist. |
| EE-BAT-001 | Listo | UI/UX + Frontend MEDIA | Easter Egg: Murciélago Pixel-Art (#bat) | Implementar animación pixel-art retro que se active escribiendo `#bat` exacto en el textarea de entradas. Murciélago en estilo box-shadow con aleteo (`@keyframes steps(2)`), movimiento circular por 15s, desaparición con F5. Solo acepta hashtag exacto (#bat, #BAT, #Bat) — rechaza variaciones. Referencia visual: pixel-art con 2 fotogramas. |
---

## Información de como solucionar los Pendientes

### EE-BAT-001 - Easter Egg: Murciélago Pixel-Art (#bat)

**Descripción técnica:**
Implementar un easter egg interactivo que muestre un murciélago animado en pixel-art **apenas** el usuario escribe exactamente `#bat` en el textarea de entradas. El murciélago aparece **inmediatamente en tiempo real** (no espera al envío de la entrada), comienza su movimiento circular **por toda la pantalla/web** y **persiste indefinidamente** hasta que el usuario recargue la página (F5).

**Requerimientos:**
1. **Ubicación del Trigger:**
   - **Sección**: `/main/entries` (Nueva Entrada)
   - **Componente**: Campo textarea en la tarjeta de "Nueva Entrada"
   - **FormControl**: `formControlName="content"`

2. **Trigger (Activación) - EN TIEMPO REAL:**
   - Hashtag exacto: Solo `#bat` (case-insensitive: `#BAT`, `#Bat`, `#bAt` válidos)
   - NO se activa con variaciones: `#batimovil`, `#bat123`, `#batman` = NO disparan
   - **TIMING CRÍTICO**: Se activa apenas se escribe "#bat" (no al enviar la entrada)
   - Ubicación: En el textarea del componente `entries.component`
   - Detección: Usa `valueChanges` para monitoreo en tiempo real de `formControlName="content"`
   - **Comportamiento**: El murciélago aparece INMEDIATAMENTE y comienza animado al mismo instante

3. **Animación Visual (Mejorado):**
   - **Estilo**: Pixel-art retro con box-shadow generado
   - **Fotogramas**: 2 estados (alas abiertas/cerradas)
   - **Duración por frame**: 0.4s (alternancia cada 400ms)
   - **Técnica CSS**: `@keyframes` con `steps(2)` para look retro
   - **Aparición**: Inmediata (sin delay) cuando se detecta "#bat"
   - **Efecto Glow/Brillo**: Box-shadow con blur para halo luminoso alrededor del murciélago
   - **Rastro Visual**: Trail effect con opacidad decreciente (sombras fantasma siguiendo la trayectoria)
   - **Sombra Dinámica**: Cambiar intensidad de sombra según la posición (simular profundidad 3D)
   - **Rotación del Cuerpo**: Girar el cuerpo del murciélago según la dirección del movimiento (izq/derecha/arriba/abajo)

4. **Movimiento (Mejorado - Con Comportamiento Inteligente):**
   - **Inicio**: Esquina superior izquierda (top-left)
   - **Duración total**: **INFINITA** - No tiene límite de tiempo
   - **Tipo de movimiento base**: Circular/fluido **por toda la pantalla visible**
   - **Alcance**: Se mueve a través de toda la web/página (no confinado a un área)
   - **Sincronización**: Comienza al mismo tiempo que el murciélago aparece (no espera)
   - **Z-index**: Por encima de los logs pero sin bloquear UI
   - **Variabilidad del movimiento**: 
     - Agregar caminos **aleatorios** además del circular para evitar predictibilidad
     - **Cambios de velocidad**: Alterna entre vuelo rápido y lento (20-150% de velocidad base)
     - **Pausas ocasionales**: Se detiene 1-2 segundos en puntos aleatorios (como si buscara comida/insectos)
     - **Zigzag adicional**: Oscilaciones laterales suave durante el movimiento (patrón natural de murciélago)

5. **Limpieza/Desaparición:**
   - **NO DESAPARECE AUTOMÁTICAMENTE**: La animación persiste indefinidamente
   - **Única forma de eliminar**: F5 (refresco de la página) resetea todo
   - **Comportamiento post-recarga**: Si el usuario recarga (F5) y vuelve a escribir "#bat", vuelve a aparecer con su animación de nuevo

6. **Interactividad (Pick-the-Bat!):**
   - **Clickeable**: Los usuarios pueden intentar clickear el murciélago
   - **Mecanismo de Evasión**: Si el usuario intenta capturarlo:
     - El murciélago se vuelve más rápido (acelera 50% más)
     - Cambia trayectoria al azar para evitar ser atrapado
     - Emite visual feedback (parpadeo, cambio de color temporal)
   - **Hover Effect**: 
     - Tooltip aparece al pasar el cursor: "¿Intentas atraparme?" o "¡Todavía estoy aquí!"
     - El murciélago ocasionalmente vuela **hacia** el cursor (como si jugara)
     - O lo evita calculando distancia y huyendo si el cursor se aproxima mucho
   - **Contador (Bonus)**: Mostrar en la consola o log cuántas veces el usuario intentó capturarlo (ej: "Intentos fallidos: 3")

**Archivos a modificar:**
- `frontend/src/app/pages/main/entries/entries.component.ts`
- `frontend/src/app/pages/main/entries/entries.component.scss`
- `frontend/src/app/pages/main/entries/entries.component.html` (si necesita ajustes)

**Implementación paso a paso:**

1. **Ya existe la lógica base** en `entries.component.ts`:
   - Sistema de detección de hashtags en `triggerEntryEasterEggIfNeeded()`
   - Overlay HTML/CSS para mostrar la animación
   - Timer de desaparición
   
2. **Lo que FALTA:**
   - Validación exacta de `#bat` (no otras variaciones)
   - Animación pixel-art con box-shadow (2 fotogramas: alas abiertas/cerradas)
   - @keyframes de aleteo con `steps(2)`
   - @keyframes de movimiento circular **INFINITO** (SIN límite de 15s, se repite indefinidamente)
   - **Efectos Visuales Avanzados**:
     - Glow/Brillo (box-shadow con blur)
     - Rastro visual (trail effect con opacity decreciente)
     - Sombra dinámica (profundidad según posición)
     - Rotación del cuerpo según dirección
   - **Comportamiento Mejorado**:
     - Movimiento aleatorio + circular mix
     - Cambios de velocidad dinámicos (20-150%)
     - Pausas ocasionales (1-2s)
     - Zigzag oscilante
   - **Interactividad**:
     - Detección de clicks (evasión inteligente)
     - Seguimiento del cursor (evitar o atraer)
     - Tooltip al hover
     - Contador de intentos fallidos
   - **Estética Pixel-Art (Impacto Alto / Fácil)**:
     - Diseño visual retro sprite 8-bit/16-bit authentic
     - Paleta de colores limitada (máx 4-6 colores primarios) para efecto pixel fidelidad
     - Box-shadow coordenadas manuales para forma rectangular pixelada exacta
     - Proporciones 1:1 (cuadrado base) con escalado x80-100 para legibilidad
     - CSS `image-rendering: pixelated` para edges nítidos sin antialiasing
     - Animación de aleteo: 2 fotogramas discretos sin transición suave (steps(2))
     - Sombra pixelada: múltiples box-shadow rectangulares stacked (NO blur suave, bordes rectos)
     - Trail effect pixelado: sombras fantasma discretas en pixeles, no gradientes
   - **NOTA IMPORTANTE**: El sistema ya monitorea `valueChanges` en tiempo real → solo falta agregar la validación específica de "#bat" y las animaciones CSS
   - **DIFERENCIA CLAVE**: NO hay `setTimeout()` para desaparición - la animación es PERMANENTE hasta F5

3. **CSS @keyframes requeridos (Expandido con Efectos Visuales):**

```scss
// Aleteo del murciélago (2 fotogramas: alas abiertas/cerradas)
@keyframes bat-flap {
  0%, 100% { 
    // Alas abiertas (fotograma 1)
    box-shadow: /* coordenadas del murciélago con alas abiertas */;
  }
  50% { 
    // Alas cerradas (fotograma 2)
    box-shadow: /* coordenadas del murciélago con alas cerradas */;
  }
}

// Movimiento circular por toda la pantalla (INFINITO - sin límite de tiempo)
// Se repite continuamente hasta que el usuario haga F5
@keyframes bat-move {
  0% { left: 20px; top: 50px; }     // Esquina superior izquierda
  25% { left: 80vw; top: 100px; }   // Arriba derecha
  50% { left: 80vw; top: 80vh; }    // Abajo derecha
  75% { left: 20px; top: 70vh; }    // Abajo izquierda
  100% { left: 20px; top: 50px; }   // Vuelve a inicio (se repite infinitamente)
}

// Glow/Brillo dinámico del murciélago
@keyframes bat-glow {
  0% { filter: drop-shadow(0 0 10px rgba(255,100,100,0.3)); }
  50% { filter: drop-shadow(0 0 20px rgba(255,100,100,0.6)); }
  100% { filter: drop-shadow(0 0 10px rgba(255,100,100,0.3)); }
}

// Rotación del cuerpo (seguir dirección)
@keyframes bat-rotate-left {
  0% { transform: scale(80) rotateY(0deg); }
  100% { transform: scale(80) rotateY(-15deg); }
}

@keyframes bat-rotate-right {
  0% { transform: scale(80) rotateY(0deg); }
  100% { transform: scale(80) rotateY(15deg); }
}

// Zigzag oscilante
@keyframes bat-zigzag {
  0%, 100% { margin-left: 0px; }
  25% { margin-left: 15px; }
  50% { margin-left: -15px; }
  75% { margin-left: 15px; }
}

.bat-pixel {
  width: 1px;
  height: 1px;
  background: transparent;
  transform: scale(80);
  animation: bat-flap 0.8s steps(2) infinite;
  
  // Agregar glow dinámico
  filter: drop-shadow(0 0 15px rgba(255,100,100,0.4));
}

.bat-animation {
  // Movimiento infinito + glow + zigzag
  animation: 
    bat-move 15s ease-in-out infinite,
    bat-glow 2s ease-in-out infinite,
    bat-zigzag 3s ease-in-out infinite;
  
  // Para interacción: cuando el murciélago está siendo perseguido
  &.bat-evading {
    animation-duration: 10s; // Más rápido cuando huye
  }
  
  // Rastro visual (trail effect)
  &::before {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    box-shadow: 
      -5px 0 10px rgba(255,100,100,0.2),
      -10px 0 15px rgba(255,100,100,0.1),
      -15px 0 20px rgba(255,100,100,0.05);
    opacity: 0.6;
  }
}
```

4. **Lógica TypeScript (Expandida con Interactividad):**

```typescript
export class EntriesComponent implements OnInit {
  // ... propiedades existentes
  private mouseX = 0;
  private mouseY = 0;
  private batClickAttempts = 0;
  private batIsEvading = false;
  
  ngOnInit() {
    // ... código existente
    
    // Rastrear movimiento del mouse
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      
      // Si el murciélago está visible, evaluar proximidad al cursor
      if (this.showEasterEggOverlay) {
        this.evaluateBatProximity();
      }
    });
  }

  private triggerEntryEasterEggIfNeeded(content: string): void {
    const tags = this.extractTagsFromContent(content);
    const hasBatTag = tags.includes('bat');
    
    if (hasBatTag && !this.showEasterEggOverlay) {
      // Aparecer inmediatamente
      this.easterEggImageUrl = 'bat';
      this.showEasterEggOverlay = true;
      this.batClickAttempts = 0;
      this.batIsEvading = false;
      
      console.log('[EASTER_EGG] Unidentified flying object (UFO) detected in the SOC. Shadow protocol active.');
      // La animación persiste indefinidamente hasta F5
    }
  }

  // Detectar proximidad del cursor al murciélago
  private evaluateBatProximity(): void {
    const batElement = document.querySelector('.bat-animation');
    if (!batElement) return;
    
    const rect = batElement.getBoundingClientRect();
    const distance = Math.sqrt(
      Math.pow(this.mouseX - rect.left, 2) + 
      Math.pow(this.mouseY - rect.top, 2)
    );
    
    // Si el cursor está muy cerca, el murciélago huye (se vuelve más rápido)
    if (distance < 150 && !this.batIsEvading) {
      this.batIsEvading = true;
      batElement.classList.add('bat-evading');
      
      // Después de 3 segundos, vuelve a la velocidad normal
      setTimeout(() => {
        this.batIsEvading = false;
        batElement.classList.remove('bat-evading');
      }, 3000);
    }
  }

  // Click en el murciélago: intento de captura (falla)
  onBatClick(): void {
    this.batClickAttempts++;
    const batElement = document.querySelector('.bat-animation');
    
    if (batElement) {
      // Destello visual de evasión exitosa
      batElement.classList.add('bat-dodge');
      setTimeout(() => batElement.classList.remove('bat-dodge'), 500);
      
      // Cambiar velocidad al azar para confundir
      this.batIsEvading = true;
      batElement.classList.add('bat-evading');
      
      console.log(`[EASTER_EGG] ¡Intento fallido! Intentos: ${this.batClickAttempts}`);
      console.log('[EASTER_EGG] El murciélago escapa volando más rápido...');
      
      setTimeout(() => {
        this.batIsEvading = false;
        batElement.classList.remove('bat-evading');
      }, 4000);
    }
  }

  // Hover: mostrar tooltip y evaluar comportamiento
  onBatHover(): void {
    console.log('[EASTER_EGG] ¿Intentas atraparme?');
  }

  onBatHoverLeave(): void {
    console.log('[EASTER_EGG] ¡Todavía estoy aquí!');
  }
}
```

**TIMING CRÍTICO:**
- `showEasterEggOverlay = true` → Murciélago visible INMEDIATAMENTE
- **NO hay `setTimeout()`** → La animación NO desaparece automáticamente
- Las animaciones CSS (@keyframes) comienzan al mismo instante que `showEasterEggOverlay` se activa y continúan **indefinidamente** (`infinite`)
- **Mouse tracking activo**: Se evalúa la proximidad del cursor en tiempo real
- **Click detection**: Intenta capturar → Falla + aceleración + feedback visual
- **Única forma de parar**: F5 (refresco de página) o cerrar la sesión

5. **HTML (Expandido con Interactividad):**

```html
<div class="easter-egg-overlay bat-animation" 
     *ngIf="showEasterEggOverlay"
     (click)="onBatClick()"
     (mouseenter)="onBatHover()"
     (mouseleave)="onBatHoverLeave()"
     [title]="'Intentos de captura: ' + batClickAttempts">
  <div class="bat-pixel"></div>
  <!-- Tooltip al hover (opcional, puede ser via CSS tooltip) -->
  <div class="bat-tooltip">¿Intentas atraparme?</div>
</div>
```

**Testing (Expandido):**
- **Escribir "#bat"** (carácter por carácter) → Murciélago debe aparecer INMEDIATAMENTE al completar "#bat"
- **Verificar movimiento continuo** → El murciélago debe comenzar su animación circular desde el mismo instante de aparición y **NUNCA DETENERSE** (se repite indefinidamente)
- **Verificar efectos visuales**:
  - ✅ Glow/brillo alrededor del murciélago (pulsante)
  - ✅ Rastro visual (trail effect con sombra decreciente)
  - ✅ Cambios de velocidad dinámicos (ralentización y aceleración al azar)
  - ✅ Pausas ocasionales durante el movimiento (1-2 segundos)
  - ✅ Zigzag oscilante en la trayectoria
- **Interactividad - Perseguir al murciélago**:
  - Mover el cursor cerca del murciélago → Debe alejarse (evasión)
  - ✅ Al hover: Mostrar tooltip "¿Intentas atraparme?"
  - ✅ Clickear el murciélago → Se acelera y cambia trayectoria (fallo en captura)
  - ✅ Incrementar contador de intentos fallidos en consola
  - ✅ Destello visual al intentar captura (dodge visual)
- **Escribir "#batman"** → NO debe aparecer (rechaza variación)
- **Escribir "#bat #otros"** → Debe aparecer (contiene #bat exacto)
- **Esperar 30+ segundos** → El murciélago sigue moviéndose sin desaparecer (confirma que es infinito)
- **Navegar a otra sección de la aplicación** → El murciélago sigue visible y en movimiento (persiste en toda la web)
- **Intentar capturar múltiples veces** → Cada intento incrementa velocidad y contador
- **F5** → Resetea todo el componente y el murciélago desaparece (única forma de eliminar, contador se resetea)
- **Escribir "#bat" de nuevo DESPUÉS de F5** → Vuelve a aparecer con contador reiniciado
- **Consola de navegador** → Verificar logs: "[EASTER_EGG]" con mensajes de detección, intentos, etc.

**Estimado**: 4-6 horas (CSS animaciones avanzadas + efectos visuales + lógica de mouse tracking + interactividad + testing comprehensive)

### B19 - GLPI (Correo/API)

1. Definir modo operativo final: resumen diario o ticket inmediato.
2. Cerrar contrato técnico de integración (`apirest.php`, tokens, sesión, payload y reintentos).
3. Agregar trazabilidad de entrega/fracaso por cada intento de ticket.

### AI-SUMMARY-001 - Resumen Ejecutivo Efímero (IA On-Demand)

1. Backend: implementar método de orquestación efímera para Ollama:
   - `docker start ollama`
   - healthcheck en `http://localhost:11434`
   - consulta a `/api/generate` con modelo `llama3.2:3b`
   - `docker stop ollama` en bloque `finally` (siempre).
2. Prompt del sistema: forzar estructura de salida con:
   - tabla de tickets
   - incidentes críticos
   - tareas en curso.
3. Payload: incluir todas las entradas de bitácora del turno actual.
4. Frontend:
   - agregar campo de texto editable `Resumen Sugerido por IA`
   - agregar botón `✨ Generar con IA`
   - completar el campo al terminar la respuesta sin bloquear edición manual.
5. Recursos/operación del contenedor:
   - memoria limitada a `--memory=\"2g\"`
   - volumen persistente `-v ollama_data:/root/.ollama`
   - contenedor apagado fuera de uso (superficie mínima y ahorro de RAM).

### INFRA-MONGO-001 - Upgrade MongoDB (7 → 8)

1. **Respaldar Datos:** Crear un script bash temporal que entre al contenedor `mongo:7` actual y ejecute `mongodump` completo hacia `/data/db/dump`. Mover este dump al host.
2. **Destrucción Segura:** Bajar el stack completo (`docker-compose down`). Renombrar o hacer backup físico de la carpeta host `./.data/mongodb_data` por precaución.
3. **Actualización de Imágen:** Modificar `docker-compose.yml` apuntando el tag a `mongo:8`.
4. **Levantamiento y Restauración:** Arrancar el nuevo servicio `mongo:8`. Las bases estarán limpias porque se generará un nuevo volumen o carpeta de datos. Entrar al contenedor y ejecutar `mongorestore` apuntando al dump generado en el paso 1. Validar integridad visual de la Bitácora.
5. **Documentación:** Registrar la ventana de mantenimiento y las versiones finales en `README.md` o documentación operativa.

### BACKUP-AUTO-016 - Backup automático no se ejecuta según intervalo configurado

1. **Reproducir con evidencia:** Confirmar en UI que `Habilitar Backups Automáticos` está activo, intervalo `7`, retención y destino guardados; capturar timestamp de última ejecución real en historial.
2. **Validar persistencia de configuración:** Revisar en DB (colección de configuración) que el flag de backup automático y el intervalo quedaron almacenados correctamente tras `Guardar Configuración`.
3. **Inspeccionar scheduler backend:** Verificar que el job de backup automático se inicializa al arrancar backend y no depende de ruta manual. Confirmar frecuencia efectiva del cron/timer.
4. **Corregir cálculo temporal:** Auditar lógica de próximo disparo (`lastRunAt + intervalDays`) con timezone del sistema para evitar desfases UTC/local que bloqueen ejecución.
5. **Trazabilidad obligatoria:** Registrar en auditoría eventos `BACKUP_AUTO_SCHEDULED`, `BACKUP_AUTO_TRIGGERED`, `BACKUP_AUTO_SKIPPED` y motivo de skip para diagnóstico operativo.
6. **Prueba controlada:** Bajar temporalmente intervalo a 1 día (o modo test en minutos), validar creación automática y luego restaurar 7 días.
7. **Criterio de cierre:** Sin interacción manual, el sistema debe crear backup automático cuando vence el intervalo y mostrarlo en historial con etiqueta de origen `automático`.

### DEP-NPM-012 - Dependencias npm deprecadas en build Docker (`glob`/`inflight`)

1. **Trazar el origen real:** Ejecutar en `backend` comandos como `npm ls glob inflight` para identificar qué dependencias raíz introducen cada versión deprecada.
2. **Actualizar dependencias raíz:** Subir versiones de los paquetes de primer nivel que arrastran `glob@7`/`glob@10.5.0` e `inflight@1.0.6`.
3. **Regenerar lockfile limpio:** Borrar `node_modules` + `package-lock.json`, reinstalar (`npm install`) y confirmar que el árbol nuevo elimina los paquetes sin soporte.
4. **Validar build Docker:** Re-ejecutar `docker compose build backend` y verificar que desaparezcan warnings de deprecación relevantes.
5. **Control de regresión:** Correr smoke tests backend (arranque API, rutas críticas y scripts de correo/reportes) para confirmar que los upgrades no rompen compatibilidad.

### FE-SASS-013 - Migrar `@import` Sass a `@use/@forward` en login

1. **Archivo afectado inicial:** Reemplazar `@import 'login-infoflow';` en `frontend/src/app/pages/login/login.component.scss` por `@use` (o `@forward` según arquitectura de estilos compartidos).
2. **Normalizar módulos Sass:** Si `login-infoflow` exporta variables/mixins, moverlos a formato modular y referenciarlos con namespace para evitar colisiones globales.
3. **Compatibilidad Angular build:** Compilar frontend (`ng build` o build Docker) y confirmar desaparición de warning `Deprecation [plugin angular-sass]`.
4. **Validación visual login:** Revisar que el tema login (incluido infoflow/cyber) conserve estilos exactos tras la migración.
5. **Prevención futura:** Buscar otros `@import` en `frontend/src/**/*.scss` para cerrar la deuda técnica antes de Dart Sass 3.0.0.

### AUDIT-014 - Login exitoso no muestra actor real en Auditoría

1. **Reproducir y capturar evidencia:** Iniciar sesión con usuario real y verificar en `/main/audit-logs` si el evento de login queda con `Actor=Sistema` en vez de usuario autenticado.
2. **Backend (emisión de evento):** Revisar punto exacto donde se registra `auth.login.success` para asegurar que incluya `actorId`, `username` y `requestId` desde contexto autenticado.
3. **Persistencia de metadata:** Validar que el modelo/DAO de `AuditLog` no esté sobrescribiendo actor con fallback `system` cuando sí hay usuario.
4. **Frontend (render):** Ajustar `isSystemAction()` y resolución de columnas `Actor/Username` para priorizar actor humano cuando exista en payload.
5. **Criterio de cierre:** Login exitoso debe mostrar usuario real en la fila y conservar clasificación de autenticación sin exponer credenciales/tokens.

### MAIL-AUDIT-015 - Error `❌ [CORREO] Para: sin destinatarios` sin contexto diagnóstico

1. **Normalizar razón de error:** Cambiar el texto genérico por mensaje estructurado con causa explícita (`destinatarios vacíos por filtro`, `rol sin usuarios activos`, `config SMTP incompleta`, etc.).
2. **Enriquecer metadata de auditoría:** Incluir en evento de correo campos mínimos: `sourceModule`, `triggerType`, `shiftId`, `checklistId`, `entryType`, `resolvedRecipientsCount`, `resolvedRecipientsPreview` (sanitizado) y `smtpConfigId`.
3. **Trazar origen de disparo:** Registrar si proviene de cierre de checklist, scheduler, escalación, PoC o envío manual para evitar confusión cuando solo se esperaba 1 correo.
4. **Frontend (razón visible):** Mejorar `Tipo / Razón / Detalles` para mostrar resumen útil en una línea y detalle expandible con contexto operativo.
5. **Control de ruido:** Aplicar deduplicación/ratelimit de logs repetidos para el mismo fallo en ventana corta (ej. 5-10 min) y mantener contador de repeticiones.
6. **Criterio de cierre:** Ante fallo de correo, auditoría debe permitir responder en menos de 1 minuto: qué intentó enviar, desde dónde, a quién, por qué falló y qué configuración estaba activa.

### B34 - Alerta por ítems NOK (Rojo) en Checklist

1. **Modelo y Base de Datos:**
   - En `AppConfig` (o `ChecklistTemplate` dependiendo de la granularidad requerida), agregar propiedades: `alertNokEnabled: Boolean`, `alertNokRoleTarget: [String]` (array referenciando los roles, ej: `['N2', 'N3']`).
2. **Lógica de Backend (Guardado de Checklist):**
   - Interceptar la ruta `POST/PUT` o el servicio de cierre/guardado del `Checklist`.
   - Después de validar, iterar el array de ítems buscando `status === 'NOK'`.
   - Si existen y la config local `alertNokEnabled` está en true, extraer la lista de `alertNokRoleTarget`.
3. **Motor de Envíos y Usuarios:**
   - Hacer un query de la colección `Users` buscando a las personas que tengan esos cargos activos (`Usuarios.find({ cargo: { $in: alertNokRoleTarget } })`).
   - Construir el cuerpo HTML del correo donde se Listen iterativamente los ítems fallidos incluyendo las propiedades (Texto del check y el "Detalle u Observación" llenado por el analista).
4. **Experiencia de Usuario (Frontend):**
   - En `Global Configuration` o en Configuración de Checklists, agregar el toggle switch "Habilitar alertas NOK".
   - Al lado, un Mat-Select con selección múltiple (checkboxes) que cargue el diccionario de cargos permitidos.
   - Guardar estas variables de vuelta al modelo usando el servicio existente de `ConfigService`.

### B45 - Correo de fin de turno pospuesto hasta checklist de cierre real

1. **Regla operativa (backend):**
   - En el trigger automático de fin de turno, si no existe checklist de cierre (`type: 'cierre'`) para ese turno/sesión, no enviar correo y marcar envío como pendiente.
2. **Disparador diferido:**
   - Al registrar checklist de cierre (ruta de guardado de checklist), evaluar si existe reporte pendiente para ese turno y ejecutar `sendShiftReport(...)` inmediatamente.
3. **Antiduplicado:**
   - Reusar/fortalecer la lógica de `lastReportSentAt` para impedir doble envío cuando coincidan cron + envío diferido.
4. **Ventana y correlación:**
   - Correlacionar checklist inicio/cierre y entradas usando la sesión real del turno (incluyendo casos de cruce de medianoche y checklist de cierre tardío).
5. **Trazabilidad:**
   - Registrar en logs/auditoría estados `PENDIENTE_POR_CIERRE`, `ENVIADO_DIFERIDO` y motivo de no envío en trigger horario.

### SEC-HIGH-009 - Regex Injection / ReDoS en búsquedas (NoSQL)

1. **Corrección de construcción regex (obligatoria):**
   - Nunca construir regex con input crudo. Crear helper común `escapeRegex()` y usarlo en:
   - `backend/src/routes/admin-catalog.js` (campo `search`)
   - `backend/src/routes/tags.js` (endpoint `/suggest`)
   - `backend/src/routes/entries.js` (endpoint `/tags/suggest`)
2. **Límites de entrada y paginación:**
   - Restringir longitud de `search/q` (ej. max 64) y rechazar vacío/whitespace puro.
   - Aplicar `limit` máximo estricto con clamp en todos los listados (`Math.min(..., 50)` o menor según endpoint).
3. **Defensa adicional anti-ReDoS:**
   - Rechazar patrones con metacaracteres no esperados si el caso de uso es búsqueda literal.
   - Mantener búsquedas por prefijo seguro (`^textoEscapado`) para autocomplete.
4. **Pruebas de seguridad QA:**
   - Agregar test de regresión con payloads tipo `(a+)+$`, `(.+)+`, `(?:a|aa)+` verificando respuesta controlada y sin degradación.
5. **Nota de clasificación:**
   - No se encontraron vectores de SQL injection clásico (el proyecto usa MongoDB/Mongoose), pero este hallazgo califica como riesgo de inyección/DoS en capa NoSQL por regex no saneada.

### SEC-HIGH-010 - OWASP A10 SSRF en integraciones salientes

1. **Validación estricta de destino URL:**
   - Restringir `api.baseUrl` (GLPI) y `http.url` (log forwarding) a `https://` por defecto y rechazar esquemas no permitidos.
2. **Bloqueo de redes internas y loopback:**
   - Resolver DNS y bloquear destinos privados/reservados (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, link-local/ULA IPv6).
3. **Allowlist operativa opcional/obligatoria en producción:**
   - Introducir `OUTBOUND_ALLOWLIST` y validar host destino contra dominios/IPs aprobados por seguridad.
4. **Controles de transporte:**
   - Forzar `verifyTls=true` por defecto en GLPI, timeout bajo, y denegar redirecciones automáticas.
5. **Auditoría y alertas:**
   - Registrar cambios de destino (host/URL) y generar evento de seguridad cuando apunten a redes no corporativas.

### SEC-MED-011 - OWASP A09/A02 logging sensible en login

1. **Eliminar logs sensibles de autenticación:**
   - Quitar `console.log` de `username`, `Usuario encontrado` y `Password match` en `auth.js`.
2. **Logging seguro por niveles:**
   - Reemplazar por `logger` estructurado, sin PII/secretos, usando `requestId` y resultado genérico (`success/fail`).
3. **Política por entorno:**
   - Si se requiere diagnóstico en desarrollo, habilitar solo detrás de flag explícito (`AUTH_DEBUG_LOGS=false` por defecto).
4. **Revisión histórica:**
   - Verificar pipelines de logs existentes y limpiar retención de registros que hayan capturado esta telemetría.

### B35 - Header Checklist y Fix "Último Check"

1. **Frontend (Header):**
   - Localizar el componente en `frontend/src/app/pages/main/checklist` (o similar).
   - Cambiar el texto estático `Checklist Diario Analistas N1` por `Checklist del turno`.
2. **Frontend/Backend (Dato de Último Check):**
   - Revisar la suscripción o el servicio que trae el `lastCheck`. Asegurar que se invalide la caché o que el backend devuelva el documento más reciente por `createdAt` sin filtros que excluyan al usuario actual o a otros.
   - Si es un problema de visualización, asegurar que el `DatePipe` sea correcto y el binding del `username` venga del registro real de la DB.

### B36 - Aprovechamiento de ancho de pantalla

1. **Estructura Layout (CSS):**
    - En `main-layout.component.scss`, identificar el contenedor principal (`.main-container` o `.content`).
    - Ajustar el `max-width` o los márgenes laterales.
2. **Interactividad con Cajón de Notas:**
    - Usar una clase dinámica (ej: `.with-notes-open`) en el contenedor principal.
    - Cuando `showNotes` sea `false`, aplicar `width: 100%` o un ancho mayor.
    - Cuando `showNotes` sea `true`, aplicar el padding/margen necesario para no solapar el cajón de notas.

### B39 - Checklist: ocultar estado de item padre con sub-items

1. **UI (Checklist):**
   - En `frontend/src/app/pages/main/checklist/checklist.component.html`, ocultar el `mat-radio-group` del item padre cuando `service.children?.length` es true (hoy aparece dentro del panel).
   - Mantener solo el icono/estado en el header para indicar el estado agregado.
2. **Cálculo de estado agregado (TS):**
   - En `checklist.component.ts`, al cambiar un sub-item, recalcular el estado del padre: `rojo` si algún hijo rojo, `verde` si todos verdes, `null` si hay pendientes.
   - Propagar el cálculo hacia arriba (ancestros) usando un helper (ej. `getAggregateStatus(node)`).
3. **Validación y observaciones:**
   - Ajustar la validación `allHaveStatus` para exigir estado solo a hojas (items sin hijos).
   - La observación obligatoria debe aplicar solo al item rojo hoja, no al padre derivado.
4. **Payload:**
   - Antes de enviar, asegurar que el estado del padre ya esté calculado; enviar ese estado derivado (o, si el backend lo permite, excluir nodos padre del payload).

### B40 - Report Generator: búsqueda de ofensas no encuentra nuevas ni coincide por texto

**Hecho (backend):**
- Se reemplazó el filtro simple por regex con un ranking por relevancia en `/api/catalog/*` para priorizar exact/prefix y reducir ruido en términos cortos.

**Falta validar / completar:**
- Probar en `/main/report-generator` que “TOR” aparece correctamente y por encima de resultados no relacionados.
- Verificar si el selector mantiene cache local y forzar refresh tras crear nuevas ofensas.
- Ejecutar pruebas o smoke test de búsqueda en catálogo.

1. **Reproducción y datos:**
   - Crear ofensa nueva (ej. "TOR") y abrir `/main/report-generator`.
   - Confirmar si el selector usa cache local o datos remotos paginados.
2. **Backend/API:**
   - Revisar endpoint de búsqueda/listado de ofensas: normalizar `q` (lowercase, trim, quitar tildes) y usar `contains` o `startsWith` en `name/title`.
   - Verificar si hay ranking por relevancia que esté priorizando resultados no relacionados.
   - Asegurar índice en campo `name/title` para búsquedas parciales (si usa Mongo, `text` o regex con collation).
3. **Frontend:**
   - Revisar lógica de filtro en el selector/autocomplete (case-insensitive).
   - Forzar refresco del dataset luego de crear una nueva ofensa (re-fetch o invalidar cache).
4. **UX:**
   - Mostrar mensaje "Sin coincidencias" cuando no haya resultados reales.
   - Opcional: mostrar el término buscado y un botón "Refrescar" si el dataset está desactualizado.

### B43 - Email de turno: refactorización a MJML y rediseño como dashboard

**Contexto del código actual:**
- Archivo principal: `backend/src/utils/shift-report.js`
- Función que genera el HTML: `generateReportHTML({ shift, checklistEntry, checklistExit, entries, periodStart, periodEnd, appTitle })`
- Función de texto plano (fallback): `generateReportText(...)` — NO debe modificarse
- Función de envío: `sendShiftReport(shiftId, shiftDate, options)` — su interfaz NO debe cambiar
- Variable de branding: `appTitle` → viene de `AppConfig.appTitle` (DB) con fallback `'Bitácora SOC'`; dentro de `generateReportHTML` se llama `brandedAppTitle`
- Problema de texto redundante: `renderStatusCell()` muestra `'OK (Verde)'` / `'ERROR (Rojo)'` — eliminar redundancia
- Las observaciones vacías se muestran como `Obs: -` — solo mostrar si `service.observation` existe

**Problemas a solucionar en esta refactorización:**
1. Texto redundante en estados (OK Verde / ERROR Rojo)
2. No existe sección de Resumen Ejecutivo (conteos visuales)
3. Checklist es tabla plana de 3 columnas — difícil de escanear
4. Entradas de Bitácora sin jerarquía visual clara
5. Observaciones siempre visibles aunque vacías
6. HTML frágil sin framework — incompatible con dark-mode, Outlook, Gmail

**Dependencia nueva:**
- Añadir `mjml` a `backend/package.json` (`npm install mjml`)
- El paquete compila plantillas MJML a HTML compatible con Outlook/Gmail en tiempo de ejecución (Node)
- Uso: `const mjml2html = require('mjml'); const { html } = mjml2html(mjmlTemplate);`

**Estructura de la nueva plantilla MJML (`generateReportHTML`):**

1. **Header** (`<mj-section>` fondo oscuro o primario)
   - **Favicon/Logo:** Si `AppConfig.faviconUrl` existe, mostrarlo como imagen pequeña (max-width: 32px o 48px) en la esquina izquierda del header, alineado verticalmente con el título
   - Título: `🛡️ Reporte de Turno — ${brandedAppTitle}` (el guión largo separa el subtítulo); posicionar al lado del favicon si existe
   - Subtítulo: `${shift.name} • ${shift.startTime}–${shift.endTime} • ${dateLabel}`
   - Si `periodLabel` existe, mostrarlo en una tercera línea más pequeña (Periodo: [rango completo])

2. **Resumen Ejecutivo** (`<mj-section>` con 3 columnas `<mj-column>`)
   - Calcular antes de renderizar:
     - `totalOk` = servicios con `status === 'verde'` en entry + exit (contar sin duplicados por `serviceId`)
     - `totalError` = servicios con `status === 'rojo'` en entry o exit
     - `totalEntries` = `entries.length`
   - Cada columna: número grande (tipografía gruesa) + etiqueta debajo (`OK`, `NO OK`, `Entradas`); fondos sutiles para claridad

3. **Checklist — tarjetas por servicio** (`<mj-section>` por servicio, NO tabla)
   - Iterar `buildServiceRows(checklistEntry, checklistExit)` y renderizar cada servicio como una tarjeta visual
   - Nombre del servicio en header destacado
   - Columnas visuales Entrada / Salida lado a lado (no filas de tabla, sino bloques)
   - **Estados columna Entrada:**
     - `🟢 OK` → si `row.entry.status === 'verde'`
     - `🔴 ERROR` → si `row.entry.status === 'rojo'`
     - `—` gris → si sin registro
   - **Estados columna Salida:** (Por ahora OK / ERROR; B44 añadirá REPARADO)
     - `🟢 OK` → si `row.exit.status === 'verde'`
     - `🔴 ERROR` → si `row.exit.status === 'rojo'`
     - `—` gris → si sin registro
   - Observación: mostrar **solo si existe** (`service.observation`), con formato `Obs: [texto]`; no mostrar si está vacía

4. **Bitácora — bloques independientes** (`<mj-section>` por cada entrada, con jerarquía visual)
   - Iterar `entries` (igual que antes)
   - Cada entrada como bloque independiente con:
     - Header: hora + fecha (tipografía media/bold)
     - Subtítulo: tipo + cliente (tipografía pequeña, gris)
     - Cuerpo: `content` completo sin resumir, respetando saltos de línea (`\n` → `<br>`)
   - Separación visual clara entre bloques (espaciado, bordes sutiles)

5. **Footer** (`<mj-section>`)
   - `Este correo fue generado automáticamente por ${brandedAppTitle}`
   - `No responder a este mensaje`

**Reglas de implementación:**
- **SOLO** reemplazar la función `generateReportHTML()` — no tocar `generateReportText()`, `sendShiftReport()` ni los modelos
- No modificar `renderStatusCell()` en esta fase (B44 lo hará)
- La lógica de datos (buildServiceRows, formatTime, formatDate, escapeHtml, etc.) se mantiene sin cambios
- El MJML se construye como template literal: `const mjmlTemplate = \`<mjml>...\`; const { html } = mjml2html(mjmlTemplate).html;`
- Si `mjml2html` lanza error de compilación, capturarlo y lanzar error descriptivo (no silenciar)
- Fondo: `#ffffff` (claro), tipografía simple, sin CSS moderno ni JavaScript
- Compatibilidad: probar viewport móvil y outlook desktop antes de mergear

### B44 - Reporte de turno: estado REPARADO (amarillo) en celda de salida

**Alcance estricto:** Solo aplica a `backend/src/utils/shift-report.js`, función `generateReportHTML()`. Ningún otro correo, controlador ni módulo debe modificarse.

**Lógica de negocio:**
- La comparación se hace por servicio, usando `buildServiceRows()` que ya empareja `row.entry` y `row.exit` por `serviceId`
- Antes de comparar estados, validar si checklist de inicio y cierre son la misma plantilla/checklist (prioridad: mismo `checklistId/templateId`; fallback: mismo nombre normalizado)
- Condición REPARADO: `row.exit.status === 'verde'` **y** `row.entry.status === 'rojo'`
- Condición ERROR: `row.exit.status === 'rojo'` (sin importar el estado de entrada)
- El estado REPARADO solo puede aparecer en la columna **Salida**, nunca en Entrada
- Si solo existe checklist de salida (sin entrada), NO aplica REPARADO — mostrar el estado normal de salida
- Si inicio y cierre pertenecen a plantillas/checklists distintos, NO aplica REPARADO: se muestran como registros separados (ejemplo: servicio X rojo en inicio se mantiene rojo con su observación; servicio Y verde en cierre se mantiene verde)

**Implementación sugerida:**
1. Crear función `renderExitCell(exitService, entryService)` en el mismo archivo, a continuación de `renderStatusCell()`
2. La función evalúa la condición y retorna:
   - REPARADO: badge amarillo (`#f57f17`) con texto `REPARADO` + nota `⚠ Fue ERROR en entrada`; observación de salida solo si existe
   - Cualquier otro caso: delegar a `renderStatusCell(exitService)` sin cambios
3. En el `forEach` de `serviceRows`, usar `renderExitCell(row.exit, row.entry)` para la columna de Salida y mantener `renderStatusCell(row.entry)` para la de Entrada
4. No modificar `renderStatusCell()` ni ninguna otra función existente

---
