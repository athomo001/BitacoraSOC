# Changelog

Registro de cambios relevantes del proyecto.

## [v1.6.15] - 2026-06-29

### Gestión Avanzada de Turnos, Cobertura N2, Pausas por Vacaciones y Borrado Masivo Seguro

- **Validación Inclusiva de Solapamientos**:
  - Se modificaron los operadores de colisión de turnos a inclusivos (`$lte` y `$gte` en backend, y `<=` y `>=` en frontend) para evitar superposiciones no detectadas en los límites de inicio/término de las asignaciones de guardia.
- **Pausa Automática por Vacaciones**:
  - Se añadió el campo `pausedByVacationId` en el esquema de Mongoose `ShiftAssignment` con su respectivo índice.
  - Al registrar o editar asignaciones de vacaciones (`ROLE_VACATION`), el sistema ahora pausa automáticamente las asignaciones regulares de menor jerarquía solapadas en lugar de eliminarlas físicamente, manteniendo la integridad del calendario.
- **Reactivación Automática de Turnos**:
  - Se implementaron restauraciones encadenadas al eliminar o modificar ausencias (vacaciones o licencias médicas), devolviendo los turnos previamente pausados a su estado activo (`isPaused: false`).
- **Borrado Masivo de Asignaciones**:
  - Nuevo endpoint `POST /api/escalation/admin/assignments/bulk-delete` en el backend.
  - Modificación de la UI del administrador con checkboxes de selección múltiple e incorporación de la acción de borrado masivo "Borrar Seleccionados (N)" con confirmación explícitamente.
- **Rotación y Retención de Backups por Cantidad**:
  - Se añadió el campo `localRetentionCount` al esquema de `backupConfig` en `AppConfig.js` para retención por cantidad máxima de respaldos (por defecto 10).
  - Se reescribió `cleanupOldLocalBackups()` en `backup-scheduler.js` para ordenar cronológicamente los backups de más nuevo a más antiguo y realizar la purga física de aquellos que excedan la cantidad máxima configurada, complementando la limpieza temporal por días de retención y previniendo el consumo excesivo de disco en el servidor.
- **Correcciones en Reporte y Envío de Correos Automáticos**:
  - **Múltiples Turnos por Analista**: Se eliminó la deduplicación del mapa `latestAssignmentByRole` en `sendEscalationScheduleInternal`, garantizando que si un analista tiene varios turnos de teletrabajo en la misma semana (ej. Miércoles y Viernes), aparezcan todos correctamente.
  - **Alineación de Periodo Semanal**: Se ajustó el periodo de cálculo semanal de Guardia de lunes 09:00 a lunes subsiguiente 08:59:59. Esto evita que turnos ya finalizados (ej. que terminen el lunes a las 08:59) se listen erróneamente en el reporte de la semana entrante que inicia a las 09:00.
  - **Protección de Privacidad de Ausencias**: Se implementó una exclusión automática para evitar que personas con licencias médicas o vacaciones activas figuren en los reportes de correos de guardia operativos o generales.
  - **Reporte Selectivo de Ausencias**: Se adaptó el filtro del correo de modo que, si el reporte fue configurado explícitamente para notificar "Vacaciones" o "Licencias Médicas" (ej: "Activos Fuera de la Oficina"), la interfaz sí incluya de manera oportuna dichos registros en el cuerpo del correo.
- **Identificación Visual por Colores en Panel**:
  - **Colores Llamativos**: Se implementó el método `getRoleBadgeStyle()` en el frontend que pinta con colores vivos y de alto contraste las distintas condiciones: **Rojo vivo** para Licencia Médica, **Naranja brillante** para Vacaciones, **Verde** para Teletrabajo y **Púrpura** para Trámite Médico, facilitando la identificación visual de las novedades en el panel de administrador.
- **Control Selectivo de Especialista TI (TI)**:
  - Se separó el rol `TI` (Especialista TI) del filtro "Guardia" en la UI de configuraciones, permitiendo al administrador elegir si desea o no informar este rol externo en los reportes de guardia.
  - Por defecto, el checkbox de "Especialista TI" en los formularios de notificaciones se inicializa apagado.
  - Se modificó la migración de datos legacy y se incorporó una rutina de limpieza automática que remueve el rol `TI` del schedule predeterminado "Envío General de Guardia".
- **Listado Semanal de Teletrabajo**:
  - Corrección en `loadTeleworkStaff()` en el frontend para evitar que las ausencias futuras de un analista bloqueen incorrectamente la visualización de su teletrabajo de la semana en curso.
- **Rediseño UI/UX de Asignaciones por Ciclos y Coberturas**:
  - **Pestañas de Ciclo de Vida**: Estructuración del listado en tres pestañas separadas según estado (`En Curso`, `Próximo` y `Pasado`) para focalizar la visualización y reducir la carga cognitiva del administrador.
  - **Consolidación Inteligente (Acordeones)**: Agrupación en el frontend de registros consecutivos del mismo analista (ej. múltiples filas individuales de teletrabajo) en un único acordeón expandible/colapsable con los límites del periodo consolidado, sin alterar los datos del backend.
  - **Enlace de Cobertura N2**: Si se presenta un turno de ausencia (Licencia médica o Vacación), la interfaz escanea y acopla visualmente una sub-fila de nivel secundario con la información del analista asignado en paralelo para el reemplazo en modo `N2`.
  - **Alertas de Guardia Descubierta**: Visualización destacada en rojo de alertas críticas de cobertura en caso de que una ausencia carezca de un reemplazo N2 activo en la misma franja horaria.
- **Optimización de Visualización Histórica**:
  - Limitación de la cantidad de registros históricos pasados a un máximo de 4 en la vista principal de `/main/admin/work-shifts` para mantener la interfaz de usuario limpia y enfocada en lo operacional actual y próximo.

## [v1.6.14] - 2026-06-26

### Corrección de Importación de CSV y Gestión de Solapamiento de Turnos

- **Importación Robusta de CSV de Turnos**:
  - Se optimizó el parseador de CSV en el backend para omitir correctamente aquellas líneas explicativas o comentarios que vienen envueltos en comillas dobles (por ejemplo, `"# Columna ""condicion"": ..."`), resolviendo el error `400 Bad Request` al cargar plantillas modificadas.
- **Sobrescritura Automática de Turnos en Conflicto**:
  - Se modificó la validación de colisiones de turnos para evaluar solapamientos de tiempo reales (usando operadores `$lt` y `$gt`) en lugar de coincidencias exactas de fechas.
  - Al registrar o importar asignaciones, el sistema ahora sobrescribe/actualiza automáticamente el registro conflictivo del mismo rol exclusivo en el mismo período, eliminando la duplicación en la base de datos.
- **Mejoras Visuales y de UX en la Gestión de Turnos**:
  - Se añadió un contenedor con scroll vertical de altura máxima (`max-height: 380px`) en las listas de proximidad ("Próximos Turnos a Iniciar" y "Turnos Próximos a Terminar") en la pantalla de administración para evitar que la UI se extienda innecesariamente.
  - Se solucionó un bug en el tooltip de conflictos visuales en el frontend donde no se mostraba el nombre del analista en conflicto por una variable local no definida.
  - **Alineación de Botones de Acciones**: Se corrigió el centrado geométrico estricto del elemento `mat-icon` dentro de los botones de acción de la tabla (`mat-icon-button`), alineando correctamente el círculo de hover y ripple sobre el icono. Se incrementó la separación (`gap: 12px`) entre los botones de "Editar" y "Eliminar" para prevenir pulsaciones accidentales de eliminación.

## [v1.6.13] - 2026-06-26

### Mejora en Automatización de Turnos, Formato de Correo Dinámico y Condición de Trámite Médico

- **Nueva Condición de Asignación: "Trámite Médico" (`MEDICAL_APPOINTMENT`)**:
  - Incorporada en el backend en los modelos `ShiftAssignment` y `ShiftNotificationSchedule`.
  - Integrada con comportamiento no exclusivo para coexistir con guardias normales sin reemplazo destructivo, manteniendo la independencia de la "Licencia médica" (`MEDICAL_LEAVE`) y su lógica compleja.
  - Soportada en el parser de importación/plantilla CSV de turnos mapeando `"Trámite Médico"`.
- **Sección Interactiva de Correo de Prueba**:
  - Añadida sección `🧪 Probar Envío de Correo` en el panel de control de turnos (`/main/admin/work-shifts`).
  - Permite disparar inmediatamente el envío de prueba a cualquier destinatario sin guardar la configuración en BD y sin alterar `lastSentAt`.
  - El frontend envía temporalmente el nombre y la selección de roles en tiempo real para que la prueba refleje exactamente el formulario en pantalla.
- **Rediseño del Formato de Correo de Turnos**:
  - **Cabecera Dinámica**: Se eliminó la repetición del nombre de la notificación en el encabezado superior derecho. Ahora se calcula una etiqueta de categorías agrupando los roles tradicionales en `"GUARDIA"` y el resto en sus nombres específicos (`TELETRABAJO`, `VACACIONES`, `LICENCIA MÉDICA`, `TRÁMITE MÉDICO`, `CHARLA/CAPACITACIÓN`) separados por `" / "`. Muestra `"CALENDARIO"` si no hay filtro activo.
  - **Badges de Asignación**: Se reemplazaron los badges de estado temporal `"EN TURNO"` / `"PRÓXIMO"` por badges dinámicos con el concepto real en el que estará el analista esa semana, implementando colores premium específicos (Verde para guardias, Azul para teletrabajo, Marrón para capacitaciones, Naranja para vacaciones, Rojo para licencias médicas y Púrpura para trámites médicos).
- **Mejoras Visuales y UX en Frontend**:
  - Iconos diferenciados para teletrabajo (`home`), charla (`school` 🎓), licencia médica (`healing` 🩹) y trámite médico (`local_hospital` 🏥).
  - Corregido el solapamiento visual e interferencia de clics (hitboxes) entre los botones "Modificar" y "Eliminar" en la tabla de asignaciones de turnos.

## [v1.6.12] - 2026-06-23

### Auto-Población de Empresa para Usuarios Internos desde Cliente Interno Configurado

- **Lógica de Sincronización Mejorada**: Se actualizó la función `syncUserAsDirectoryInternal()` en la ruta de usuarios para:
  - Obtener el `defaultLogSourceId` configurado en AppConfig (cliente/LogSource por defecto asignado en `/main/logo`).
  - Buscar el CatalogLogSource correspondiente y extraer su nombre (ej: "Netics", "AIEP", "BeyondTrust").
  - Incluir automáticamente ese nombre como la empresa en la sincronización al DirectoryContact.
  - Esto sincroniza la información del cliente interno ya configurado en `/main/admin/catalogs` sin requerir campo adicional.
- **Integración Transparente**: Aprovecha la jerarquía existente:
  - Admin configura cliente interno en `/main/admin/catalogs` con `isInternal: true`
  - Asigna ese cliente como "Cliente / LogSource por Defecto" en `/main/logo`
  - Todos los usuarios internos creados/editados heredan automáticamente la empresa del cliente asignado
- **Sincronización Retroactiva desde Directorio**: Se añadió un flujo de re-sincronización para usuarios internos existentes.
  - Nuevo endpoint backend: `POST /api/directory/sync-users-to-directory`.
  - El botón **"Sincronizar y consolidar"** ahora ejecuta también esta etapa para empujar usuarios internos al directorio con la empresa vigente del cliente por defecto.
  - Esto corrige casos donde contactos internos antiguos quedaban con `EMPRESA` vacía (`-`) aun teniendo catálogos y branding correctamente configurados.
- **Nueva Condición Operativa OL (Charla/Capacitación)**:
  - Se agregó `OL` como condición válida de asignación en backend y frontend.
  - Se incorporó en formularios/filtros de asignación y en plantilla/importación CSV de turnos.
  - En la sección **🏡 Personal en Teletrabajo y Apoyo** se muestra con estado específico de capacitación/charla, indicando que la persona está fuera de oficina.
- **Beneficios**:
  - Single source of truth: solo un lugar donde vive la configuración (catálogos).
  - Sincronización automática sin campos adicionales.
  - Coherencia: usuarios siempre reflejan el cliente/empresa asignado globalmente.

## [v1.6.11] - 2026-06-23

### Corrección de Error 400 al Crear Usuarios de Forma Consecutiva

- **Fix de validación al crear usuarios (`POST /api/users`)**: Se corrigió un bug que provocaba `400 Bad Request` con mensaje genérico `Errores de validación` al crear un segundo usuario consecutivo desde la UI de administración. El problema se activaba cuando el campo `phone` quedaba en `null` tras un `reset()` del formulario y luego era reenviado al backend.
- **Normalización defensiva en frontend**: En el formulario de administración de usuarios se normaliza el teléfono antes de enviar la solicitud. Si el valor viene vacío o nulo, se omite del payload (`undefined`) para evitar validaciones falsas.
- **Compatibilidad endurecida en backend**: Se actualizaron validaciones en rutas de usuarios para aceptar `phone` nullable en:
  - `POST /api/users`
  - `PUT /api/users/:id`
  - `PUT /api/users/me`
  Esto evita rechazos cuando algún cliente legítimo envía `null` en lugar de string vacío.
- **Mejora de experiencia de error en UI**: Cuando el backend responde con `errors[]` de `express-validator`, ahora se muestra en snackbar el primer mensaje específico de validación (`errors[0].msg`) en vez de solo el mensaje genérico.

## [v1.6.10] - 2026-06-22

### Confirmación Visual Mejorada y Notificación de Cambio de Contraseña a Usuarios Internos

- **Diálogo de Confirmación Bonito con Botones (Sin alert() de JS)**: Se rediseñó el componente `ConfirmDialogComponent` en el frontend para ofrecer una interfaz visual moderna y clara, reemplazando cualquier dependencia a ventanas modales nativas de JavaScript (`alert`, `confirm`). El diálogo ahora incluye:
  - Ícono contextual en el encabezado (rojo con `warning` para acciones destructivas, azul con `help_outline` para confirmaciones normales).
  - Tipografía clara con adecuado espaciado y contraste (ancho mínimo 320px, máximo 460px).
  - Botones visibles: "Cancelar" (stroked) y "Confirmar" (raised, con colores diferenciados según criticidad).
  - Directiva `disableClose: true` en el modal para obligar al usuario a tomar una decisión explícita mediante botones, evitando cierres accidentales.

- **Actualización de Mensaje de Forzado Masivo de Contraseña**: El diálogo de confirmación para "Forzar Cambio Masivo" en `/main/admin/users` ahora comunica de forma clara que:
  - Se forzará el cambio de contraseña a TODOS los usuarios internos activos (roles admin, user, auditor).
  - Se enviará un correo de notificación a cada usuario informando que debe actualizar su clave en el próximo ingreso.
  - El botón de confirmación pasó de "Forzar Masivo" a "Sí, Forzar y Notificar" para dejar explícito el doble impacto (forzado + correo).

- **Envío Automático de Correos a Usuarios Internos**: Al ejecutar el endpoint `POST /api/users/force-password-change-all` (forzado masivo de contraseñas), el backend ahora:
  - Obtiene la lista de usuarios internos activos (excluyendo el admin que ejecuta la acción).
  - Envía un correo individual a cada usuario con asunto personalizado (p. ej., "[Bitácora SOC] Cambio obligatorio de contraseña") y cuerpo HTML amigable que explica la política de seguridad.
  - Registra métricas en auditoría: cantidad de usuarios notificados, correos exitosos y correos fallidos.
  - Devuelve un mensaje de resumen (p. ej., "Se ha forzado el cambio a X usuarios internos activos. Correos enviados: Y. Fallidos: Z.").
  - Utiliza el mismo servicio centralizado de email (`sendEmail()`) y contexto de auditoría (`sourceModule: 'users'`, `triggerType: 'admin-force-password-reset-all'`) para mantener trazabilidad completa.

- **Validaciones y Seguridad**:
  - Solo usuarios con rol 'admin' pueden ejecutar el forzado masivo (autorización `authorize('admin')`).
  - Los correos se envían únicamente a usuarios internos (admin, user, auditor) que estén activos y tengan email válido.
  - Fallos individuales de correo NO detienen el proceso masivo; se registran en auditoría y se reportan en el resumen.

## [v1.6.09] - 2026-06-21

### Obligatoriedad de Cumpleaños, Contraseña Forzada y Envío de Correo de Felicitaciones con CIDs

- **Forzado Masivo e Individual de Contraseña**: Se implementó una funcionalidad en el módulo de usuarios que permite obligar a un usuario de forma individual o de manera masiva (para todos los usuarios activos a la vez, excluyendo al administrador que ejecuta la acción) a realizar un cambio de contraseña y establecer su fecha de cumpleaños en el primer inicio de sesión, bloqueando la navegación mediante un panel completo de configuración obligatoria.
- **Envío de Correo de Cumpleaños**: Se programó un scheduler en el backend (`birthdayEmailScheduler.js`) para enviar de forma automática y diaria un correo estéticamente atractivo al usuario en el día de su cumpleaños (en su hora local definida).
- **Corrección de Imágenes Rotas en Correos mediante CIDs**: Se reestructuró la plantilla de correos de felicitación y el scheduler para leer e incrustar la ilustración kawaii de cumpleaños (`birthday_kawaii.png`) y el logotipo de branding personalizado del sistema directamente desde el sistema de archivos del servidor, adjuntándolos en el email como adjuntos en línea mediante **Content-ID (CID)** (`src="cid:..."`), lo cual previene que los clientes de correo externos bloqueen o muestren las imágenes rotas por URLs locales.
- **Optimización y Estabilidad del Scheduler**:
  - Se movió la ilustración kawaii al directorio de recursos estáticos del código de la app (`src/assets/branding/birthday_kawaii.png`) para evitar que se oculte por el volumen `/app/uploads` en Docker.
  - Se redujo el intervalo de revisión de cumpleaños de 5 a 2 minutos.
  - Se reinicia el bloqueo de envío de hoy (`lastBirthdayEmailsDate = null`) de forma transparente al guardar una hora de envío modificada o reactivar el servicio, permitiendo pruebas inmediatas en el mismo día.
- **Ajustes en UI de Administración**:
  - Se amplió la columna de configuración lateral de usuarios a **`340px`** en el frontend para evitar espaciados verticales comprimidos y mejorar el aspecto visual.
  - Se mantiene el control de hora siempre visible en la interfaz, inhabilitándolo de manera reactiva mediante `[disabled]` en lugar de usar `*ngIf`.

## [v1.6.08] - 2026-06-18

### Actualización de Motor de Paquetes a pnpm v11.7.0 y Dependencias Generales

- **Migración a pnpm v11.7.0:** Se actualizó el gestor de paquetes de `v11.0.0` a `v11.7.0` en los archivos de configuración del proyecto (`package.json` del frontend y backend, Dockerfiles de frontend, backend y complement-stub).
- **Habilitación de compilaciones con allowBuilds (pnpm v11):** Se estructuraron los archivos `pnpm-workspace.yaml` tanto en `frontend/` como en `backend/` reemplazando la directiva obsoleta `onlyBuiltDependencies` por la nueva propiedad `allowBuilds` nativa de pnpm v11, autorizando explícitamente los scripts de compilación para `sharp`, `unrs-resolver`, `@parcel/watcher`, `core-js`, `esbuild`, `lmdb` y `msgpackr-extract`.
- **Actualización de Dependencias:** Se ejecutó una actualización general de paquetes mediante `pnpm update` en el frontend (incluyendo actualizaciones de Angular CLI/build v20.3.29) y en el backend (actualizaciones de Mongoose, Helmet, Nodemailer, MJML y Multer), regenerando los archivos de bloqueo `pnpm-lock.yaml`.

## [v1.6.07] - 2026-06-18

### Prevención de Caché Web en Despliegues y Control Automático de Chunk Load Failures

- **Encabezados Cache-Control en Nginx:** Se añadieron y homologaron directivas de expiración y almacenamiento en caché en el archivo de configuración global de Nginx (`frontend/nginx.conf`). El archivo de entrada principal `index.html` se configuró con `Cache-Control "no-cache, no-store, must-revalidate"` en el bloque de servidor HTTP (puerto 80) e HTTPS (puerto 443), previniendo que los navegadores retengan el HTML antiguo tras despliegues de Docker. Los archivos dinámicos generados por la compilación con hashes únicos (`.js`, `.css`) se configuran para ser cacheados persistentemente con `Cache-Control "public, immutable"` por 1 año.
- **Global Error Handler en Angular para Carga de Chunks:** Se desarrolló un manejador global de excepciones (`GlobalErrorHandler` en `frontend/src/app/utils/global-error-handler.ts`) y se integró en la inicialización de la aplicación en `frontend/src/main.ts`. Este componente intercepta errores de tipo `ChunkLoadError` o fallos en importación dinámica de módulos (típicos de despliegues en caliente de contenedores donde los archivos hasheados antiguos son eliminados de disco) y fuerza de manera transparente una recarga limpia del navegador (`window.location.reload()`) para resolver el problema sin interrumpir ni cerrar la sesión autenticada activa (gracias al token JWT persistido en la cookie segura HttpOnly).

## [v1.6.06] - 2026-06-18

### Habilitación de Permisos de Directorio Central para Perfil N1 y Flexibilización de Contraseñas del Administrador

- **Escritura en Directorio para Analistas N1:** Se modificaron los permisos de acceso en el backend (`backend/src/routes/directory.js`) y en el frontend (`escalation-admin-simple.component.ts`) para permitir que los analistas con cargo N1 (`cargoLabel = 'n1'`) puedan crear, modificar e importar de manera masiva contactos en el Directorio Central. La funcionalidad de eliminación de contactos sigue estando restringida únicamente a perfiles de jerarquía superior (N2, N3, Jefe de Área, Gerente y Arquitecto SIEM), respondiendo con error `403 Forbidden` a nivel de API.
- **Eliminación de Mínimo de Contraseña para el Administrador:** Se removió la validación de longitud mínima de contraseña (`.isLength({ min: 6 })`) de los endpoints exclusivos de administración (`POST /api/users` y `PUT /api/users/:id`). Esto permite que el Administrador cree y edite usuarios asignándoles contraseñas de cualquier longitud (por ejemplo, un punto `.`), resolviendo la inconsistencia con la interfaz de usuario.

## [v1.6.05] - 2026-06-18

### Creación del Tema de Login "Surrealismo Digital"

- **Diseño Surrealista Lateral:** Se desarrolló una nueva interfaz de login (`'surrealism'`) inspirada en el arte digital. El panel de autenticación, verificación de MFA y recuperación se ubica en una barra lateral izquierda (sidebar) de altura completa (`380px` de ancho y `100vh`), manteniendo el resto de la pantalla totalmente libre y nítida para revelar la imagen de fondo con el monitor iluminado sobre la colina.
- **Optimización de Contraste y Legibilidad:** Se ajustaron los colores del cuadro de alertas e instrucciones de recuperación (`.info-alert-box`), el indicador de expiración del turno (`.session-info-text`) y el pie de página (`.surreal-footer`) mediante overrides del tema con `!important` para evitar la herencia oscura de componentes Material y garantizar una lectura de alto contraste.
- **Actualización en API y Configuración:** El backend (`AppConfig.js`, validación de rutas) y el frontend fueron adaptados para soportar y persistir el nuevo tema en el módulo de Branding del Administrador y de Apariencia General.

## [v1.6.04] - 2026-06-18

### Rediseño e Integración del Login Retro CRT a Pantalla Completa con Anime.js

- **Login CRT a Pantalla Completa:** Se modificaron los estilos del tema retro CRT para que el monitor analógico `.crt-monitor` abarque todo el viewport (`position: fixed; inset: 0`) con un bisel de 24px de ancho (8px en dispositivos móviles). La pantalla curvada `.crt-screen` ocupa ahora el 100% de la ventana, centrando el formulario con Flexbox.
- **Efectos de Tubo Catódico y Glitches Totales:** Se reconfiguraron los selectores de las animaciones en `login.component.ts` para apuntar a `.crt-screen`, permitiendo que el efecto de encendido inicial, la animación de colapso catódico de apagado al cambiar de vista y las distorsiones visuales por glitches afecten a todo el viewport del navegador.
- **Tipografía y Cursor Terminal:** Se importó la fuente `VT323` de Google Fonts y se estilizó un cursor terminal parpadeante en los inputs enfocados.
- **Actualización de Documentación Visual:** Se agregaron las capturas de los tres estilos de login (`13.1-Login.png`, `13.2-Login.png`, `13.3-Login.png`) al manual `docs/SCREENSHOTS.md` y se integró la primera de ellas en el `README.md` principal.

## [v1.6.03] - 2026-06-18

### Optimización de Fuentes, Contraste de Controles y Prevención de Desbordes en Cyberpunk y Dark

- **Corrección de Colores y Visibilidad en Datepicker (Calendario):** Se añadieron reglas de sobrescritura específicas para `.mat-datepicker-content` y `.mat-calendar` en los temas `cyberpunk` y `dark`. En Cyberpunk se aplica fondo negro puro con bordes y botones cian/amarillo, forzando texto de días en blanco (`#ffffff`) y el día seleccionado en fondo magenta (`#ff0055`) con texto negro para garantizar un contraste óptimo.
- **Ajuste de Contraste en Tags/Chips de Tablas:** Se añadieron overrides de estilos para `.mat-mdc-chip` y `.mdc-evolution-chip` en los temas `cyberpunk` y `dark` para prevenir la herencia de texto oscuro sobre fondo oscuro en las tablas, forzando bordes e indicación de brillo neón en cian y gris militar táctico.
- **Corrección del Fondo de Nueva Entrada:** Se reemplazó el color de fondo del bloque informativo `.entry-type-hint` en `entries.component.scss` utilizando la variable `--surface-muted` en lugar de `--hover-bg` (que era asignada al magenta chillón en Cyberpunk), neutralizando el fondo y asegurando la lectura de las pautas de entrada.
- **Prevención de Desbordes y Colapso de Iconos:**
  - Se añadieron propiedades de flexbox (`flex-shrink: 0` en `mat-icon` y `min-width: 0` en los contenedores de texto) en las cabeceras e items de `checklist.component.scss` para evitar que los títulos largos de checklist aplasten y recorten los iconos de estado de forma vertical.
  - Se redujeron las fuentes y el letter-spacing del sidebar en el tema Cyberpunk en `styles.scss` (a `0.78rem`/`0.82rem` and `0.01em`) para que las secciones colapsables como "Historial y Entradas" y "Complementos" no se solapen ni corten sus indicadores.
- **Creación de Nuevo Tema de Login 'Moderno / Split-Screen':** Se implementó un tercer tema de login independiente llamado `'modern'` con un diseño split-screen (pantalla dividida), panel izquierdo interactivo con soporte para login/MFA/recuperación, y panel derecho con fondo arquitectónico de alta resolución y reloj sincronizado. Se modificó el backend (`AppConfig.js`, validación de rutas en `config.js`) y el frontend para dar soporte completo a este nuevo tema sin alterar la maquetación cyberpunk clásica del tema `'infoflow'`. Adicionalmente, se corrigió el contraste y legibilidad de la caja de información en la pantalla de recuperación de contraseña forzando la visualización del texto en color cian neón sobre el fondo oscuro.

## [v1.6.02] - 2026-06-17

### Aislamiento de Previsualizaciones en Cyberpunk, Márgenes del Logotipo y Navegación por Teclado

- **Aislamiento de Previsualización de Informes:** Se agregaron reglas específicas de exclusión y reseteo en la hoja de estilos global para evitar que el contenedor `.html-preview` y sus elementos hijos hereden colores negros, scanlines o tipografías neón del tema Cyberpunk. Esto garantiza que las vistas previas de boletines de seguridad e informes de incidentes mantengan sus paletas de colores y estilos inline originales para su revisión fiel antes del envío a clientes.
- **Optimización de Márgenes del Logotipo en Sidebar:** Se modificó la cabecera `mat-toolbar` de la barra lateral para permitir una altura dinámica (`height: auto !important`) y un min-height de `84px !important`, aplicando un padding respirable de `16px 20px !important`. Se limitó la altura del logotipo `.sidebar-logo` a `52px !important` para que quepa de forma balanceada y sin recortes en ningún tema visual.
- **Navegación Táctica por Teclado en Escalamientos:** Se implementó una directiva de teclado en la vista de escalamientos (`/main/escalation/view`) para alternar pestañas (Turnos SOC, Contactos, Matriz RACI, Mantenimientos) de manera fluida utilizando las teclas de dirección izquierda/derecha (`ArrowLeft` / `ArrowRight`), previniendo capturas del evento si el foco del usuario se encuentra en un campo de texto interactivo.
- **Refinamiento Estético Cyberpunk Edgerunners:** Ajustes tipográficos generales, asignación de paleta amarillo Edgerunners (`#fcee0a`) y cian táctico (`#00f0ff`) para títulos y elementos activos, y corrección de contraste en los roles del pie del sidebar sobre fondos oscuros.

## [v1.6.01] - 2026-06-17

### Rediseño de Perfil, Carga de Avatar y Sincronización de Contacto Centralizado

- **Rediseño del Panel de Perfil:** Se reestructuró la página de perfil `/main/profile` a un layout responsivo moderno de dos columnas, ubicando una tarjeta de información rápida del usuario con su foto de avatar a la izquierda, y los paneles de edición de datos, cambio de contraseña y doble factor (MFA) a la derecha.
- **Subida de Avatar Física:** Se implementó el endpoint `PUT /api/users/me/avatar` para cargar imágenes de avatar y servirlas de forma estática en `/uploads/avatars/`. Las cargas están validadas mediante `multer` y la biblioteca `sharp` en el backend para verificar la firma de imagen e impedir desbordamiento de recursos (límite estricto de 2MB).
- **Sincronización del Teléfono en Directorio:** Se añadió el campo `phone` al formulario reactivo de actualización de perfil y en el endpoint `PUT /api/users/me` del backend. Cualquier cambio del número de teléfono se propaga síncronamente al directorio centralizado `DirectoryContact` a través de `syncUserAsDirectoryInternal()` mediante el hash de correo del usuario.
- **Barra Lateral Reactiva:** Se modificó el layout de la aplicación para suscribirse reactivamente al observable `currentUser$` de `AuthService`. Esto permite que el avatar circular pequeño (o el placeholder de iniciales de repuesto) en el menú lateral izquierdo se actualice instantáneamente sin recargar la página tras subir una nueva foto o modificar el nombre completo.

## [v1.6.00] - 2026-06-16

### Simplificación de Temas Visuales, Alta Disponibilidad y Extracción de Fuentes Tipográficas (Branding)

- **Extracción Automática de Fuentes Tipográficas:** Se diseñó e implementó un flujo completo para que los administradores suban archivos de fuentes físicas (`.ttf`, `.otf`, `.woff`, `.woff2`) en el panel de Branding. El backend analiza binariamente las cabeceras SFNT de la fuente y extrae de forma automática el nombre de la familia tipográfica real (`Font Family Name`) soportando codificación UTF-16BE (Windows/Unicode) y ASCII (Macintosh), eliminando la necesidad de que el usuario lo escriba a mano.
- **Gestión Visual de Fuentes Integrada:** Se integró el gestor de fuentes directamente debajo del selector de fuentes de la "Barra Superior" de forma colapsable en la tarjeta de Personalización, permitiendo instalar y eliminar fuentes en caliente con inyección dinámica de reglas `@font-face` en el DOM de la aplicación.
- **Simplificación de Temas Visuales:** Se eliminaron los temas "oscuro" (dark) y "sepia" del tipo `Theme` en los modelos de datos, en el listado de temas activos del servicio en el frontend y en los selectores de la barra superior del layout principal y de la edición de perfil. Esto reduce sobreingeniería y el peso de mantenimiento visual de hojas de estilo.
- **Guía de Réplicas (MongoDB Replica Set):** Se diseñó e implementó la guía técnica opcional `docs/07_MONGO_REPLICA_SET.md` para configurar MongoDB en alta disponibilidad (1 primario + 2 secundarios) con failover automático usando Docker Compose, enlazándola en el índice del README y en el manual de instalación.
- **Corrección de Solapamiento en SMTP:** Se reparó un error visual en el formulario de configuración SMTP (`main/admin/smtp`) donde el texto aclaratorio largo (`mat-hint`) de la contraseña se solapaba con el campo de entrada siguiente ("Email Remitente"). Se corrigió forzando que el subscript-wrapper de Angular Material sea relativo en el contenedor de ajustes, reservando espacio de forma dinámica e impidiendo el desbordamiento flotante.

## [v1.5.99-beta] - 2026-06-15

### Optimización de Rendimiento de PDF Nativo y Ajuste de Márgenes Físicos A4

- **Impresión Nativa y Alto Rendimiento:** Se eliminaron las librerías `jsPDF` y `html2canvas` del flujo y dependencias del frontend, las cuales provocaban bloqueos del navegador de hasta 4 minutos debido a conflictos de renderizado con los gradientes SVG dinámicos de `ngx-charts`. Se delegó la descarga del PDF al motor de impresión nativo del navegador (`window.print()`), logrando una generación instantánea, fluida y con texto/gráficos vectoriales 100% nítidos.
- **Simplificación del Flujo de Usuario:** Se removió el overlay de carga con barra de progreso (`.pdf-export-overlay`) del generador de reportes. El botón de exportación se unificó en un único botón de llamada a la acción: **"Generar PDF / Imprimir"**.
- **Ajuste de Altura y Márgenes Físicos Simétricos:** Se agregaron estilos CSS de impresión (`@media print`) en el componente de reportes para obligar a cada una de las 4 páginas lógicas del informe (`.report-pdf-page`) a ocupar la altura total del papel (`100vh`) y a aplicar un padding perimetral de respeto idéntico (`20mm` arriba/abajo y `15mm` a los lados).
- **Consistencia de Márgenes Globales:** Se anuló el padding de la hoja contenedora del reporte (`.print-report-sheet` a `padding: 0 !important;`) bajo `@media print` en los estilos globales, evitando duplicidad de espaciados y garantizando que cada sección empiece limpiamente en una nueva página A4 física sin cabeceras ni pies de página del navegador (gracias al margen cero en `@page`).

## [v1.5.98-beta] - 2026-06-15

### Ajustes de Visualización de Reportes Enviados y Encabezado en PDF

- **Gráfica de Torta (Reportes Enviados) alineada con su leyenda:** Se corrigió la inconsistencia visual entre segmentos de la torta y elementos listados en la leyenda del informe de período. Ahora la leyenda refleja la totalidad de clientes presentes en `mailClientsBreakdown` y se mantiene en el mismo orden del gráfico.
- **Numeración explícita de la leyenda:** Se añadió numeración correlativa en cada ítem para mejorar lectura rápida y trazabilidad visual en reportes ejecutivos impresos.
- **Conectores visuales del pie chart restaurados y reforzados:** Se reactivaron las etiquetas del pie (`labels=true`) y se mejoró el contraste/grosor de líneas conectoras y textos para que el vínculo segmento-etiqueta sea claramente visible en previsualización e impresión.
- **Redimensionamiento del bloque gráfico en informe consolidado:** Se incrementó el área de render del gráfico de torta dentro del bloque “Reportes Enviados” para evitar compresión visual y mejorar legibilidad.
- **Logo de encabezado en PDF ampliado:** Se ajustó el layout de impresión del encabezado del informe consolidado (`@media print`) aumentando de forma significativa el contenedor del logo, fallback y escala visual del branding para evitar apariencia subdimensionada.
- **Reglas de impresión depuradas para evitar contenido oculto residual:** Se reforzó el filtrado de elementos no imprimibles (`display:none`) para reducir riesgo de espacio fantasma en paginación al exportar a PDF.

## [v1.5.97-beta] - 2026-06-15

### Generador de Informe de Período Consolidado en PDF y Motor de Narrativa Heurística

- **Informe de Período en PDF (Impresión Web):** Se diseñó e implementó una sección en `/main/statistics` para configurar y generar informes consolidados por rango de fechas (con presets rápidos semanal, quincenal y mensual). Al presionar el botón "Imprimir / Guardar como PDF", se utiliza la vista de impresión del navegador mediante una hoja de estilos `@media print` altamente estilizada que remaqueta el informe en formato de documento ejecutivo multipágina A4/Carta, ocultando barras de navegación y botones interactivos.
- **Gráfica de Tendencia Consolidada en PDF:** Se integró un gráfico de líneas (`ngx-charts-line-chart`) sin animaciones y con dimensiones fijas (`840x220`) dentro del PDF de impresión para visualizar la distribución temporal y volumen diario de eventos (operativas, incidentes, ofensas) del período evaluado.
- **Remoción de Firmas de Cierre:** Se removió el bloque redundante de firmas de analista/coordinador en el pie del informe ejecutivo consolidado por requerimiento operativo.
- **Resolución de PDF en Blanco al Imprimir:** Se corrigió un fallo que provocaba que la previsualización de impresión saliera vacía (en blanco). La causa eran las propiedades restrictivas de altura (`height: 100vh`) y desbordamiento (`overflow: hidden`) del layout de la consola y contenedores de Angular Material (`mat-sidenav-container`, `.main-container`, `.content-wrapper`). Se solucionó forzando en `@media print` que todos los contenedores padres tengan altura automática, posición estática y desbordamiento visible.
- **Motor de Narrativa Heurística (Backend):** Se desarrolló el endpoint `GET /api/reports/period-summary` en el backend para agrupar métricas y redactar en español un análisis detallado en lenguaje humano de los acontecimientos del período. El motor heurístico analiza la distribución de bitácoras, usuarios más activos, tags recurrentes y checklists en estado NOK (con problemas) citando los diagnósticos de los operadores SOC y evaluando el estado operacional en tiempo real.
- **Correcciones y Compatibilidad de Tipado en Frontend:** Se implementó el casting de variables de bucles con pipe mediante `$any(...)` en la plantilla de estadísticas para asegurar la compatibilidad con el compilador estricto de Angular.
- **Parche de Consola en Login (`_rawValidators`):** Se corrigió un error de ejecución `TypeError` al iniciar sesión. Se reubicó la instanciación de los formularios reactivos de login, recuperación y MFA al inicio de `ngOnInit()` para evitar que se renderice la plantilla con controles `undefined` ante respuestas síncronas del endpoint de branding y logotipos.

## [v1.5.96-beta] - 2026-06-15

### Ajustes en Checklist, Consistencia de Condición en Turnos y Parche de Consulta de Entradas

- **Optimización de Checklist (/checklist):** Se centró el título "Nueva Entrada", se redujo la altura por defecto de la caja de texto (`textarea` a 7 filas) y se redujo el espacio en blanco vertical y paddings generales de los contenedores para evitar desplazamientos verticales (scroll) innecesarios en la pantalla. Además, se eliminó el encabezado redundante "TOP tags".
- **Consistencia visual en Turnos ("Condición"):** Se renombraron las etiquetas y cabeceras de la vista Gantt, filtros rápidos y formularios del panel de asignación semanal (`/main/admin/work-shifts`) para utilizar el término "Condición" en lugar de "Rol", reflejando adecuadamente la naturaleza mixta (roles técnicos y estados administrativos) de las opciones. La compatibilidad técnica con las variables de base de datos y la API se mantuvo intacta.
- **Plantilla CSV y Leyendas Explicativas:** Se actualizaron la plantilla CSV descargable de turnos y el procesador de importación del backend (`parseShiftAssignmentsCsv`). La plantilla incluye ahora leyendas explicativas de los valores válidos para el campo de condición (anteponiendo `#` para comentarios) y el backend ignora limpiamente estas líneas comentadas además de mapear de forma transparente la columna `condicion`/`condición` a `rol` internamente para retrocompatibilidad.
- **Resolución de Error 500 en Listado de Entradas:** Se corrigió un error `500 (Internal Server Error)` al consultar el listado de entradas (`GET /api/entries`) provocado por el paso de parámetros de paginación (`page` y `limit`) como strings en la etapa `$limit` de agregación de MongoDB. Se implementó el casteo explícito a enteros (`parseInt`) en el backend y se reinició el servicio para aplicar el parche.

## [v1.5.95-beta] - 2026-06-10

### Importación CSV de Directorio, Plantilla de Datos y Consolidación de Seguridad (SSO)

- **Importación Masiva de Directorio (CSV):** Se implementó la importación masiva de contactos del directorio en `/main/escalation/directory` a través de archivos CSV con parseo adaptativo de campos comunes y alias de idioma, previniendo sobreescrituras en contactos de sistema (`source === 'User'`).
- **Descarga de Plantilla CSV:** Se incorporó un botón "Plantilla CSV" interactivo en el frontend para descargar un CSV de muestra con formato BOM UTF-8 y codificación de columnas para evitar fallos de importación.
- **Consolidación del Panel de Seguridad:** Se reorganizó la configuración de SSO (Google y Microsoft) moviéndola desde el panel de Configuración General al panel de Seguridad (`/main/admin/security`), implementando un diseño premium de dos columnas simétricas (HTTPS y SSO).
- **Vinculación Inteligente de SSO:** Se optimizó la autenticación de SSO en el backend para realizar una búsqueda flexible (`$or` por email y username), vinculando de manera automática perfiles de usuario manuales preexistentes con sus correspondientes inicios de sesión de SSO y evitando cuentas duplicadas.
- **Optimización Estética de Tabla:** Se ajustó la altura y el espaciado vertical (`padding`) de la tabla del directorio, así como el tamaño de las fuentes, para brindar una presentación de datos más profesional y compacta.

## [v1.5.94-beta] - 2026-06-10

### Seguridad, Autenticación (MFA, SSO), Cifrado de Datos y Robustez en Turnos (QA-REMEDIATIONS)

- **Autenticación Multifactor (MFA TOTP):** Se implementó autenticación multifactor mediante TOTP (RFC 6238) desactivada por defecto. El administrador puede activarla por usuario en la sección de usuarios del sistema. En el primer inicio de sesión tras ser habilitado, se exige enrolamiento obligatorio por código QR y verificación posterior persistente en perfil y login.
- **Single Sign-On (SSO):** Se integró soporte nativo de SSO para Google y Microsoft Azure AD/Entra ID configurado con variables de entorno (`GOOGLE_CLIENT_ID`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`).
- **Cifrado de Datos Personales (PII):** Los campos de contacto (correos y teléfonos) ahora se almacenan cifrados en base de datos con AES-256-GCM y se descifran transparentemente en el backend antes de enviarlos a la UI. Búsquedas deterministicas integradas vía hashes SHA-256.
- **Cifrado de Respaldos (Backups):** Se añadió opción de cifrar backups con AES-256-GCM y clave derivada por PBKDF2 mediante passphrase ingresada en UI, y descifrado transparente en caliente al importar.
- **Resiliencia ante Zip Slip:** Mitigación del hallazgo Zip Slip en importación/restauración de copias de seguridad mediante validación estricta de rutas relativas dentro del archivo ZIP.
- **Keyring de Cifrado Resiliente:** Clave persistente en `/secrets/encryption-keyring.json` que sobrevive a purgas de base de datos y permite descifrado multi-llave tras restauraciones.
- **Segregación de Checklists por Turno:** Se introdujo el campo indexado `shiftId` en Mongoose `ShiftCheck` y la lógica para admitir checklists concurrentes/segregados por turno, evitando bloqueos si ocurren en paralelo.
- **Restricción de Rol de Auditor:** Se aplicó la lista blanca `AUDITOR_GET_WHITELIST` en middleware, bloqueando la descarga de copias de seguridad, el envío de correos, y ocultando datos sensibles de contacto en directorios a los roles Auditor e Invitado.
- **Prevención de CSV Injection:** Las exportaciones de bitácoras ahora sanitizan celdas agregando comilla simple de escape en caracteres iniciales (`=`, `+`, `-`, `@`).
- **Validación de URL de Logos:** Control estricto con `isValidImageConfigUrl` para evitar SSRF o rutas inválidas al configurar logotipos.

## [v1.5.93-beta] - 2026-06-09

### Correcciones y Mejoras en Teletrabajo, Vacaciones y Permisos de Asignaciones

- **Ruta Pública de Asignaciones (`/assignments`):** Se añadió una nueva ruta GET `/api/escalation/assignments` accesible para analistas autenticados (sin requerir rol admin). Esto permite que la tabla operativa de "Personal en Teletrabajo y Apoyo" en `/main/escalation/view` cargue correctamente para todos los usuarios sin recibir un `403 Forbidden`.
- **Separación de Métodos en EscalationService:** Se creó el método `getAssignmentsAdmin()` que apunta a la ruta protegida `/admin/assignments`, reservado exclusivamente para la pantalla de administración de turnos. El método `getAssignments()` ahora apunta a la ruta pública, utilizada por el panel operativo.
- **Corrección de Permisos en `/main/admin/work-shifts`:** Los dos puntos de carga (`loadWeeklyAssignments` y `loadHistoricalAssignments`) del componente admin fueron actualizados para invocar `getAssignmentsAdmin()`, manteniéndose correctamente sobre la ruta protegida de administración.
- **Fila Completa en Rojo para Vacaciones:** La tabla de teletrabajo en `/main/escalation/view` aplica el estilo `row-vacation` (fondo rojo) a toda la fila cuando el analista está de vacaciones activas, haciéndolas visibles de inmediato.
- **Estado "Pronto Vacaciones" en Azul:** Se implementó la detección de vacaciones futuras (dentro de las próximas 2 semanas) mostrando el badge en azul con la etiqueta "Pronto Vacaciones". Las vacaciones que inician en más de 2 semanas no aparecen en esta lista, evitando ruido innecesario.
- **Orden de Prioridad en la Tabla:** El orden de aparición es fijo: Vacaciones (primero, rojo) → Pronto Vacaciones (azul) → Teletrabajo → En Oficina.

## [v1.5.92-beta] - 2026-06-09

### Gestión de Teletrabajo y Vacaciones en Administración de Turnos

- **Roles de Asignación Expandidos:** Incorporación de los roles de "Teletrabajo" (`TELEWORK`) y "Vacaciones" (`VACATION`) en el formulario de edición y en el selector de filtros de `/main/admin/work-shifts`.
- **Validación de Conflictos Adaptativa:** Se ajustaron las alertas de solapes de rol y disponibilidad locales para permitir que las asignaciones de "Teletrabajo" coexistan con turnos regulares. Asimismo, se omiten bloqueos locales al registrar "Vacaciones", permitiendo que el backend maneje el flujo de autoliberación.
- **Notificación de Autolimpieza de Vacaciones:** Se integró la captura de la respuesta del backend durante el guardado de Vacaciones, alertando al administrador mediante snackbars descriptivos cuando se liberan/eliminan automáticamente turnos normales del analista en ese mismo rango de fechas.
- **Visualización y Mapeo Amigable en UI/Gantt:** Se modificó la visualización en la tabla de asignaciones, diagrama Gantt de resumen semanal y tarjetas de proximidad para mostrar etiquetas formateadas en español ("Teletrabajo", "Vacaciones") en lugar de los códigos internos de BD y se agregaron sus respectivos carriles en el Gantt.
- **Guía de Importación CSV:** Se actualizaron los paneles de ayuda del frontend para notificar a los operadores que el importador CSV acepta "Teletrabajo" y "Vacaciones" como roles de asignación válidos.

## [v1.5.91-beta] - 2026-06-09

### Mejoras de Usabilidad en Filtro de Clientes y Tabla de Teletrabajo

- **Lógica declarativa de autocompletado libre de flags:** Se eliminaron los flags inestables de foco y se rediseñó el getter de clientes filtrados (`filteredClients`/`filteredRaciClients`). Ahora, si el término de búsqueda coincide exactamente con el cliente seleccionado (indicando que no hay cambios o que recién se abrió el panel), se despliega de inmediato la totalidad de los clientes activos del sistema. Esto elimina por completo el tener que presionar la "X" o borrar letras.
- **Rediseño a Tabla Escalable de Teletrabajo:** Se reemplazó el diseño de tarjetas por una tabla limpia (`excel-table`) con columnas de Nombre, Contacto, Cargo y Ubicación Actual. Esto soluciona la escalabilidad de visualización ante grandes volúmenes de personal (e.g. 50+ registros) y se agregaron insignias con código de colores HSL (`badge-status`) con iconos contextuales.
- **Mocks realistas integrados:** Se incorporaron 8 registros de prueba en `teleworkStaff` para simular la visualización a escala (incluyendo estados en oficina, en teletrabajo, vacaciones en color rojo de alerta y no asignados).

## [v1.5.90-beta] - 2026-06-09

### Corrección de legibilidad del HUD del Easter Egg (#bat)

- **Corrección de color y contraste del HUD:** Se solucionó un problema por el cual los números del minijuego de murciélagos (`#bat`) aparecían de color negro/gris oscuro (invisibles) debido a la regla global de estilos `p, span, label` en `styles.scss` que sobrescribía el color en cascada. Se implementó el color blanco directo con `!important` y se simplificaron las etiquetas `span` para evitar conflictos de especificidad CSS.
- **Fondo sólido para contraste:** Se reemplazó el fondo semitransparente por un fondo oscuro sólido (`#1e1e1e`) con borde visible (`#333333`), asegurando que las letras verdes dinámicas del fondo del Easter Egg no afecten la lectura de los contadores.

## [v1.5.89-beta] - 2026-06-09

### Auditoría de QA y UX/UI: Contraste, Aviso de Privacidad Dinámico, Rediseño Premium de Backups y Resolución de Backlog de QA

- **Contraste de Recuperación en Tema Matrix (QA-UI-064):** Ajustado el contraste del texto descriptivo del flujo de recuperación de contraseña bajo el tema `infoflow` a un color blanco puro (`#ffffff !important`) para asegurar una correcta lectura en pantallas oscuras.
- **Branding Dinámico en Aviso de Privacidad (QA-COMPLIANCE-PRIVACY-NOTICE):** Implementada la inyección en caliente del nombre del branding (`appTitle`) configurado en la base de datos en `/uploads/aviso-privacidad.html`, eliminando cualquier referencia estática a "Bitácora SOC".
- **Persistencia de Consentimiento de Privacidad:** El consentimiento aceptado ahora se almacena en `localStorage`, evitando que la casilla y link de aceptación aparezcan recurrentemente a los analistas después del primer login exitoso.
- **Rediseño Asimétrico Premium de Backups:** Rediseñada la vista de `/main/backup` bajo un layout asimétrico de dos columnas (65% principal / 35% lateral), eliminando la distribución simétrica repetitiva de IA. Se reemplazó el control de automatización clásico por `mat-slide-toggle` y se estilizó la zona de peligro y las tarjetas con sombreados y transiciones modernas.
- **Mejora del Huevo de Pascua (#bat):** Implementación de una mecánica de cacería interactiva para el Easter Egg de murciélagos en `EntriesComponent`. Ahora, hacer clic sobre un murciélago otorga una probabilidad del 35% de capturarlo con éxito (lo que remueve la instancia de la pantalla). Se integró un HUD Cyberpunk persistente en la parte superior central de la pantalla que se activa junto al minijuego para mostrar de forma nítida la cantidad de murciélagos activos, los intentos realizados y el total de capturas exitosas.
- **Solución a Texto Borroso (HD Text):** Se corrigió la borrosidad del texto del panel central causada por la aceleración 3D del navegador. Se removió la directiva `will-change: transform` de la transición de rutas (`router-outlet + *`) y se cambió el destino de `pageTransition` a `transform: none`, permitiendo el suavizado de fuentes subpíxel (ClearType). Se removió la animación redundante en `backup.component.scss`.
- **Límites de Recursos en Infraestructura (QA-INFRA-DOCKER-LIMITS-001):** Incorporación de límites estrictos de CPU y memoria RAM en `docker-compose.yml` para los contenedores de frontend, backend y base de datos, resguardando la estabilidad del servidor host.
- **Refactorización y Eliminación de Código Redundante:**
  - **Centralización de Cookies (QA-CODE-REDUNDANCY-001):** Creada la utilidad común `cookie-helper.js` para extraer tokens JWT desde cookies y cabeceras de autorización de forma centralizada.
  - **Helper de Parseo de Booleanos (QA-CODE-DUPLICATION-BOOLEAN-001):** Unificada la lógica de parsing de flags en `boolean-helper.js`.
  - **Helper de Rango Horario (QA-CODE-TIME-RANGE-001):** Centralizada la lógica de validación de horas que cruzan la medianoche en `time-helper.js`.
  - **Configuración de Zona Horaria (QA-CODE-CONFIG-003):** Centralizada la constante y formateador de la zona horaria `America/Santiago` en `date-utils.js`.
  - **Desacoplamiento de Lógica de Reportes (QA-CODE-SPAGHETTI-002):** Separadas las funciones auxiliares de limpieza de HTML y procesamiento de imágenes a `email-templates-helper.js`.
  - **SMTP Centralizado en Forgot-Password (QA-CODE-SMTP-001):** Refactorizado el flujo de olvido de contraseña para invocar al transporte centralizado de `utils/email.js`.
- **Seguridad y Trazabilidad (Backend):**
  - **Restricción de Directorio (QA-USERLIST-INFO-001):** Ocultos los campos sensibles de correo y teléfono en `GET /api/users/list` si el rol es de solo lectura (`guest` o `auditor`).
  - **Políticas de Contraseña Unificadas (QA-USERS-PASSWORD-POLICY):** Establecida una longitud mínima obligatoria de 6 caracteres para contraseñas de usuarios creados por administradores.
  - **Escritura de Notas Personales (QA-NOTES-GUEST-WRITE-BLOCKED):** Permitidas peticiones mutadoras de tipo `PUT /api/notes/personal` para invitados y auditores en su propia nota personal.
  - **Autorización en Historial y Envíos (QA-REPORTS-ACCESS-001, QA-REPORTS-HISTORY-AUTH):** Implementado el middleware de validación de rol `authorize('admin', 'user')` en creación de historial de reportes e incidentes.
  - **Prevención de Inyección de Fórmulas CSV (QA-REPORTS-CSV-INJECTION):** Sanitizadas las celdas en la exportación de bitácoras forzando una comilla simple inicial en valores que comiencen con `=`, `+`, `-` o `@`.
  - **DoS Payload Limits en Logos (QA-SERVER-DOS-001):** Limitado el parse de Express a 2MB con validación temprana de cabeceras en rutas de carga de logos y favicons.
- **Confiabilidad y Rendimiento (Backend & Frontend):**
  - **Manejo de Creadores Nulos (QA-ENTRIES-NULL-CREATOR-001):** Protegido el borrado y edición de entradas contra errores de pertenencia de creador nulo/huérfano en base de datos.
  - **Optimización de Autocompletado de Tags (QA-ENTRIES-TAGS-SUGGEST-PERF):** Reordenados los pipelines de agregación colocando `$match` antes del `$unwind` para evitar escaneos de colección completos (COLLSCANs).
  - **Resiliencia ante Fechas Corruptas (QA-ENTRIES-DATE-FORMAT-CRASH):** Añadido fallback robusto contra fechas nulas o corruptas durante la transformación local en `toChecklistEntryLikeRecord`.
  - **Caché Reactiva de Configuración (QA-FRONTEND-REDUNDANT-REQUESTS-001):** Implementado `shareReplay(1)` en `ConfigService` del frontend para evitar múltiples peticiones HTTP redundantes a `/api/config/logo`.
- **Animaciones Premium Globales (Frontend):**
  - **Transición de Rutas (QA-ANIM-ROUTE-001):** Agregada transición fluida fade-in y slide-up en el cambio de páginas en `router-outlet + *`.
  - **Transiciones de Selectores y Menús (QA-ANIM-OVERLAYS-002):** Implementada animación `@keyframes menuFadeIn` con escala vertical y opacidad en overlays de Material.
  - **Modales y Diálogos Elásticos (QA-ANIM-DIALOG-003):** Aplicada animación con curva de rebote sutil (`cubic-bezier(0.34, 1.56, 0.64, 1)`) en la apertura de modales.

## [v1.5.88-beta] - 2026-06-01

### Correcciones ortográficas y de redacción en correos y UI (UI-ORTHO-FIX)

- **Corrección de redacción de turnos de escalamiento:** Se reemplazó el término "Escalación" por "Escalamiento" en el asunto y cuerpo de las plantillas de correo (`Turnos de Escalamiento SOC`), normalizando su redacción y eliminando el término erróneo.
- **Correcciones ortográficas masivas en la UI:** Se corrigieron etiquetas de texto, placeholders, labels de formulario y snackbars en el frontend para agregar tildes y caracteres correctos (por ejemplo: `Configuracion` -> `Configuración`, `contrasenas` -> `contraseñas`, `telefono` -> `teléfono`, `informacion` -> `información`, `operacion` -> `operación`, `sesion` -> `sesión`, `categoria` -> `categoría`, `analisis` -> `análisis`, `minimo` -> `mínimo`).
- **Validación de empaquetado:** Se validó la compilación del frontend (`pnpm run build`) asegurando que los templates de Angular no tengan errores sintácticos tras los cambios.

## [v1.5.87-beta] - 2026-05-25

### Historial compartido en /main/reports y borrado solo admin

- **Historial global para todos los usuarios autenticados:** Se reemplazó el historial local por navegador (`localStorage`) por persistencia centralizada en backend, permitiendo que todos vean los reportes/boletines enviados por el equipo.
- **API de historial de reportes:** Se incorporaron endpoints `GET /api/reports/history` y `POST /api/reports/history` para listar y registrar elementos del historial compartido.
- **Borrado restringido a administradores:** Se agregaron `DELETE /api/reports/history/:id` y `DELETE /api/reports/history` protegidos con `authorize('admin')`, manteniendo la política de que solo admin puede eliminar historial.
- **Frontend alineado al backend:** El módulo de `Report Generator` ahora consume la API compartida para cargar, agregar y paginar historial (`Cargar Más`), en vez de usar almacenamiento local por usuario.
- **Validación técnica y despliegue:** Se verificó compilación y levantamiento de `backend` y `frontend` en Docker Compose tras los cambios.

## [v1.5.86-beta] - 2026-05-25

### Hora oficial del servidor en Gantt de Turnos (SHIFT-DASH-146)

- **Fuente de tiempo oficial (backend/NTP):** Se reforzó `GET /api/work-shifts/current` para entregar referencia temporal completa del servidor (`currentDateTime` y `currentTimestamp`) además de `currentTime` y `timezone`, evitando depender del reloj del navegador para la vista operativa.
- **Timeline semanal anclado al servidor:** El panel de administración de turnos semanales ahora calcula la línea de "Día Actual" y los estados (`Pasado`, `En Curso`, `Próximo`) usando hora oficial sincronizada desde backend.
- **Endurecimiento anti-manipulación local:** El frontend dejó de proyectar la hora con `Date.now()` del cliente y pasó a usar base oficial de servidor + reloj monotónico (`performance.now()`), reduciendo impacto de cambios manuales de hora en el equipo del operador.
- **Contrato tipado actualizado:** Se extendió `CurrentShiftResponse` en frontend para soportar los nuevos campos temporales oficiales sin romper compatibilidad con consumidores existentes.
- **Validación de despliegue:** Se verificó compilación y levantamiento de contenedores con `docker compose build backend frontend && docker compose up -d backend frontend` y rebuild posterior de frontend exitoso.

## [v1.5.84-beta] - 2026-05-25

### Simplificación del CSV de Asignación de Turnos (SHIFT-CSV-146)

- **Formato reducido del CSV:** La importación de turnos ahora usa únicamente `rol, usuario, fechaInicio, horaInicio, fechaFin, horaFin`, eliminando columnas técnicas innecesarias como `userType` y `notes`.
- **Resolución automática de usuario:** El campo `usuario` se resuelve internamente por `username` como primera opción; también acepta correo o nombre completo si coincide con un usuario interno o una persona externa.
- **Mapeo funcional de roles:** El rol visible `N1` se traduce automáticamente a `N1_NO_HABIL` en backend, manteniendo la semántica operativa sin obligar al usuario a conocer la nomenclatura interna.
- **Ejemplos y ayuda alineados a UX:** Se actualizaron las ayudas del panel y la plantilla descargable para mostrar usernames como ejemplo recomendado, evitando confusión con correos electrónicos.

## [v1.5.83-beta] - 2026-05-22

### Auditoría Exhaustiva de Documentación y Limpieza de Repositorio

- **Sincronización de Documentación API:** Se implementó un script automatizado para extraer endpoints directamente del router de Express, reconstruyendo la documentación maestra (`docs/04_DESARROLLO_Y_API.md`) con más de 100 rutas operativas validadas.
- **Consolidación Operativa UI:** Se estandarizó la nomenclatura en la documentación general (`03_OPERACIONES.md` y `SCREENSHOTS.md`) para coincidir de manera estricta con las etiquetas actuales de la UI.
- **Unificación de Entornos (`.env`):** Se eliminó la duplicidad de configuración entre la raíz y el backend. `backend/src/server.js` fue refactorizado para resolver automáticamente el archivo `.env` de la raíz del proyecto, permitiendo que un único archivo actúe como fuente de verdad absoluta tanto para la orquestación Docker como para la ejecución local de Node.js.
- **Depuración de Scripts Heredados (Clean-up):**
  - Se eliminaron fragmentos obsoletos de inicialización de BD (`seed-escalation-example.js`, `seed-services.js`, `seed-shift-roles.js`, `seed-work-shifts.js`) para consolidar la estrategia en el sembrado oficial (`seed.js` y `seed-admin.js`).
  - Se borraron scripts manuales de único uso que generaban ruido operativo (`add-netics.js`, `create-users.js`, `shift-dates.js`, `import-sanitized.js`).
  - Se removieron los scripts de migración `mongo8-migration` (y su documentación en `02_DESPLIEGUE_Y_CONFIG.md`), al considerarse un procedimiento puntual ya ejecutado y superado por la arquitectura nativa en Mongo 8.
- **Resiliencia de Easter Eggs:** Se restituyó y validó la dependencia funcional de `scripts/Bender.png` para los triggers de UI basados en el hashtag `#bender`.

## [v1.5.82-beta] - 2026-05-22

### Cierre de Auditoría de Seguridad: Mitigación de Hallazgos MEDIA (SEC-PENTEST-AUDIT-145)

- **Control de Sesiones (SEC-FIX-145-03):** Implementada lista negra de tokens (`TokenDenylist`) respaldada en MongoDB para invalidar de manera inmediata y centralizada los JWT tras el cierre de sesión, bloqueando accesos posteriores con tokens capturados.
- **Auditoría 403 (SEC-FIX-145-13):** Agregada trazabilidad forense explícita (`auth.authorize.fail`) cuando un usuario intenta acceder a endpoints para los que no tiene rol autorizado.
- **Rate Limit Multi-Réplica (SEC-FIX-145-07):** Reemplazado `MemoryStore` local por `rate-limit-mongo`, centralizando la prevención de abusos por fuerza bruta (login y API) en todos los nodos/contenedores del sistema.
- **CORS Estricto (SEC-FIX-145-06):** Eliminada la configuración permisiva global; el backend ahora valida el origen explícitamente (`ALLOWED_ORIGINS` y trusted hosts) independientemente del entorno.
- **Límite de Payload Global (SEC-FIX-145-08):** Reducido el límite del parser de cuerpos JSON/URL-encoded de 50MB a un valor razonable (2MB) globalmente para mitigar payload bombing, manteniendo 10MB dedicados para cargas de imágenes seguras.
- **Validación de Magic Bytes (SEC-FIX-145-09):** `multer` ahora es complementado por `sharp` y revisión de cabeceras binarias (para `.ico`) para validar la estructura interna de los archivos subidos, evitando bypass por spoofing de extensiones en logos y favicons.
- **Frontend Guards Robustecidos (SEC-FIX-145-05):** Eliminados los retornos estáticos incondicionales en los guards (`AuthGuard`, `AdminGuard`, `NotGuestGuard`), implementando validaciones front-end reales apoyadas en el estado de autenticación y RBAC del sistema.
- **Contenedor Nginx No-Root (SEC-FIX-145-12):** Modificado el `Dockerfile` del frontend para delegar los permisos al usuario nativo `nginx`, operando el demonio sin privilegios de sistema (`USER nginx`).

## [v1.5.81-beta] - 2026-05-22

### Ajustes en Destinatarios y Alineación del Panel de Contactos (UI-REPORT-REC-141)

- **Eliminación de campos de autocompletar redundantes:** Se removieron los inputs de autocompletar individuales ("Autocompletar destinatarios (Para)" y "Autocompletar CC") en Boletines e Incidentes dentro del generador de reportes, dejando la gestión completa de envíos rápidos a través de la barra lateral de contactos guardados.
- **Alineación del Directorio de Contactos en el Sidebar:** Se añadió estilo a `.newsletter-contact-meta` con `flex-grow: 1; text-align: left; min-width: 0;` para que la información del contacto se mantenga ordenada y unificada junto al checkbox y no se desplace forzadamente a la derecha.
- **Validación y Bloqueo de Solapamientos (Para vs CC):**
  - Se modificó `toggleIncidentContact` en el controlador para remover proactivamente a un contacto de la lista opuesta (Para <-> CC) al ser seleccionado.
  - Se implementó validación en `sendIncidentReport` que detiene el flujo de envío del reporte e informa el conflicto mediante `snackBar` si hay correos duplicados entre los destinatarios y las copias.
  - Se integró la advertencia dinámica en la UI y se bloqueó la interacción del botón "Enviar reporte por correo" en caso de conflicto.
- **Compilación del sistema:** Verificado el empaquetado de producción de toda la aplicación ejecutando `docker compose build --no-cache && docker compose up -d` de forma exitosa.

## [v1.5.80-beta] - 2026-05-21

### Reordenamiento de campos en Generador de Reportes de Incidentes (UI-REPORT-GEN-140)

- **Fila superior de 4 columnas al inicio:** Se ubicaron al comienzo del formulario de reporte los campos **Código Ticket**, **Ofensa**, **Tipo de operación** y **Fecha**, facilitando el flujo rápido de ingreso de datos clave.
- **Búsqueda de eventos reubicada:** Se movió la búsqueda de **Nombre de Ofensa/Evento** desde la fila completa del principio a la columna central de la segunda fila (junto a _Fuente / Log Source_ y _MRSC (Criticidad)_), sustituyendo la posición del campo _Ofensa_.
- **Limpieza de campos duplicados:** Se eliminaron las entradas duplicadas de _Código Ticket_, _Tipo de operación_ y _Fecha_ en la sección inferior de detalles adicionales, dejando únicamente los campos de origen, destino, reputación y carga de evidencia.
- **Estilos responsivos:** Se incorporó la clase `.row-four-cols` en el SCSS para adaptar la nueva fila de 4 columnas de forma fluida a todo tipo de pantallas (desktop, tableta y móviles).

### Nomenclatura y reorden de Catálogos en Admin (CAT-NOMEN-REORG-144)

- **Título principal actualizado:** en `/main/admin/catalogs` se cambió el encabezado a **"Administración de Clientes y Catálogos"** para reflejar el alcance real del módulo.
- **Etiqueta de navegación renombrada:** en la consola administrativa, el acceso lateral se actualizó de **"Catálogos"** a **"Clientes y Catálogos"**.
- **Pestañas reorganizadas en orden operativo:** el `mat-tab-group` quedó en el orden **Clientes**, **Tipos de Operación**, **Alertas y Mantenimientos**, **Tipo de Eventos**.
- **Renombre funcional de Eventos:** la pestaña **"Eventos"** se renombró a **"Tipo de Eventos"** y su encabezado interno también fue actualizado para mantener consistencia visual y semántica.

## [v1.5.79-beta] - 2026-05-21

### Ampliación de Timeline en Vista Resumen Semanal (SHIFT-GANTT-TIMELINE)

- **Timeline extendido de 7 a 10 días:** Se modificó la vista de resumen semanal (Gantt) para mostrar la semana actual completa + 3 días de la próxima semana, proporcionando mayor visibilidad anticipada de asignaciones próximas.
- **Mejor distribución visual:** La semana próxima ahora ocupa ~30% del espacio timeline en lugar de ~14%, permitiendo una mejor visualización de turnos y asignaciones en el corto plazo.
- **Mantención de funcionalidad:** Se preservó toda la lógica de cálculo de posiciones, colores de estado y línea del día actual, escalando proporcionalmente los 10 días en lugar de 7.

## [v1.5.78-beta] - 2026-05-20

### Mejoras en Selector de Asignación para Especialista TI (SHIFT-TI-SEL-136)

- **Fuente correcta del directorio centralizado:** Se corrigió el selector de rol Especialista TI (`TI`) para cargar contactos internos desde el **directorio centralizado** en lugar de limitarse a 3 usuarios del sistema. Ahora muestra 20+ personas reales con datos completos.
- **Visualización de nombre completo + teléfono:** Las opciones del dropdown ahora muestran formato `Nombre Completo • Teléfono` (ej: "Oscar Ortiz • +56976783378"), facilitando la identificación correcta de personas. Se agregó clase CSS `.option-phone` para estilos legibles en gris secundario.
- **Asignación directa desde directorio para TI:** Se modificó la lógica de validación en `saveWeeklyAssignment()` para permitir que TI asigne contactos internos del directorio sin buscar coincidencia en tabla de usuarios del sistema, evitando error "Asígnalo desde Analistas Internos (Usuarios)".
- **Organización visual mejorada:** Se separó visualmente "Personas Externas" de "Directorio Interno" en secciones distintas del selector cuando aplica, mejorando la experiencia de selección.

### Corrección de Barras de Progreso en Turnos Próximos a Iniciar (SHIFT-PROX-137)

- **Barras funcionales:** Se implementó cálculo de progreso para la sección "Próximos Turnos a Iniciar" utilizando la fórmula `progress = (tiempo restante hasta inicio) / (duración total) × 100`. Anteriormente estaban hardcodeadas a 0% y no se llenaban.
- **Consistencia visual:** Ambas secciones (Próximos a Terminar y Próximos a Iniciar) ahora aplican el mismo sistema de colores dinámicos: verde para >80%, amarillo para 50-80%, rojo para <50%.
- **Cálculo preciso:** El progreso refleja qué tan cercano está el turno a su inicio en relación a su duración total, proporcionando feedback temporal correcto al operador.

## [v1.5.77-beta] - 2026-05-21

### Migración y mejoras UX de Gestión de Turnos Semanales (SHIFT-MOVE-124 a SHIFT-NAV-135)

- **Migración de Turnos Semanales (SHIFT-MOVE-124):** Se migró la funcionalidad de turnos semanales desde Escalación hacia `/main/admin/work-shifts`, eliminando dependencias obsoletas y manteniendo total compatibilidad de datos.
- **Layout Dashboard en 2 Columnas (SHIFT-UX-125):** Rediseñado `/main/admin/work-shifts` con una estructura visual moderna de 2 columnas (panel central y editor lateral) adaptativa y con micro-animaciones premium.
- **Vista Resumen Semanal en Gantt (SHIFT-GANTT-126):** Implementado un timeline tipo Gantt para el resumen semanal, con visualización por rol/analista, colores según estado (En Curso, Próximo, Pasado) y una línea roja vertical destacada para el Día Actual con su fecha legible.
- **Tarjetas de Turnos por Proximidad (SHIFT-PROX-127):** Agregadas tarjetas de "Turnos Próximos a Terminar" y "Próximos Turnos a Iniciar" ordenadas cronológicamente, con barras de progreso y temporizador de cuenta regresiva/inicio.
- **Formato de Datos de Asignación (SHIFT-FORMAT-128):** Incorporado un bloque de ayuda contextual detallada que describe el formato esperado de datos de turnos para minimizar errores.
- **Editor de Asignación Lateral (SHIFT-EDITOR-129):** Creado un panel lateral para agregar y editar turnos, integrando validación estricta de solapes de horario, rangos de fecha inválidos, autocomplete desde el directorio y disponibilidad de analistas.
- **Acciones y Feedback de Persistencia (SHIFT-SAVE-130):** Añadido botón primario con estado de carga (loading) y notificaciones emergentes de éxito/error al guardar cambios, forzando la actualización instantánea de la interfaz.
- **Filtros Rápidos (SHIFT-FILTER-131):** Implementado un buscador y filtros interactivos por Persona y Rol para depurar la lista de asignaciones rápidamente sin recargas de página.
- **Tabla Detallada de Asignaciones (SHIFT-TABLE-132):** Diseñada una MatTable completa con columnas de Estado (con pills de color), Semana, Rol, Persona, Comentarios y Acciones (editar, eliminar).
- **Consistencia de Datos (SHIFT-DATA-133):** Garantizado que el timeline de Gantt, las tarjetas de proximidad y la tabla detallada se alimenten de la misma fuente de datos de asignación sincronizada.
- **Texto y Labels en Español (SHIFT-I18N-134):** Normalizados todos los textos, ayudas, estados y mensajes de validación de turnos a español neutro.
- **Integración con Navegación Global (SHIFT-NAV-135):** Pulida la integración visual de la vista de turnos con el shell, el menú lateral y la barra superior del sistema.
- **Optimización de Ancho de Pantalla y Legibilidad:** Ampliado el ancho máximo de la consola administrativa a 1750px y optimizado el tamaño de la tipografía del diagrama Gantt (incrementando las etiquetas y textos a 13px/14px) para aprovechar al máximo las pantallas de escritorio sin comprimir textos.
- **Compilación e Integración Docker exitosa:** Se validó la compilación del frontend dentro del contenedor Docker sin advertencias ni errores.

## [v1.5.76-beta] - 2026-05-20

### Consolidación y mejoras UX de Clientes, Escalación y Reportes (CAT-INT-115 a ESC-FLOW-123)

- **Cliente Interno Único (CAT-INT-115):** Implementada validación en base de datos, API de backend y formularios reactivos en frontend para impedir la activación de más de un Cliente Interno de forma concurrente.
- **Correo CC Global Obligatorio (CAT-INT-116):** Agregada configuración y validación estricta de múltiples correos electrónicos en formato CC global para el Cliente Interno. Se importó `MatError` y se definieron getters booleanos específicos en el componente `CatalogAdminComponent` para solucionar fallos en compilación estricta en producción.
- **Unificación de Nomenclatura a "Cliente" (CAT-UX-117):** Eliminada la terminología técnica "Log Source" / "Fuente de Logs" de la interfaz de administración de catálogos, sustituyéndola por la palabra funcional "Cliente".
- **Visualización Destacada (CAT-UX-118):** Se integró un badge con colores distintivos en la tabla de clientes para resaltar al Cliente Interno junto con sus correos de copia global configurados.
- **Selector Simplificado de Clientes (ESC-UX-119):** Removidos los campos redundantes (buscador de texto + combo) en Escalación Simple y reemplazados por un único campo autocomplete responsivo para seleccionar el cliente.
- **Carga de CC y Autocompletado de Contactos (ESC-DATA-120):** Automatizado el pre-llenado de los campos CC con los correos del Cliente Interno en el generador de reportes. Se integró `MatAutocompleteModule` para autocompletar rápidamente direcciones desde el Directorio Central en los campos destinatarios del Boletín y Reporte de Incidentes.
- **Optimización de Layout (ESC-LAYOUT-121):** Retirado el bloque obsoleto "Clientes (fuente única)" para maximizar el espacio vertical disponible y se ajustaron las tablas de servicios de escalación a un tamaño máximo contenido (`max-height: 250px`) con barras de desplazamiento y cabeceras fijas.
- **Reorganización y Limpieza de Pestañas (ESC-TABS-122):** Reordenadas y renombradas las pestañas a "Flujo de Correos" y "Flujo de llamadas". Se eliminó completamente la pestaña de "Turnos Internos" (migrada previamente a `/main/admin/work-shifts`), limpiando todas sus importaciones y referencias para mantener un empaquetado optimizado.
- **Secuencia y Estado de Configuración del Flujo (ESC-FLOW-123):** Añadida numeración de secuencia secuencial (`Paso 1`, `Paso 2`...) en cada elemento de la lista y se programaron badges de validación dinámica (`Configurado` / `Incompleto`) basados en si la tarjeta tiene los datos de contacto mínimos obligatorios para operar.
- **Estabilidad de Docker en Producción:** Verificado el empaquetado de producción de toda la aplicación ejecutando `docker compose build --no-cache && docker compose up -d` de forma exitosa.

## [v1.5.75-beta] - 2026-05-19

### Auditoria: clasificacion correcta para Escalacion y mayor cobertura de eventos

- **Correccion de clasificacion visual en `/main/audit-logs`:** acciones realizadas en Escalacion/RACI/turnos/flujo ya no aparecen como checklist por arrastre de eventos no representativos; ahora se muestran bajo categoria **Escalacion** con textos legibles.
- **Nuevos eventos de lectura auditables en Escalacion (backend):** se agrego trazabilidad explicita para vistas clave: `escalation.view.service.read`, `escalation.view.internal_shifts.read`, `escalation.view.contacts.read`, `escalation.view.raci.read`, `escalation.view.flow.read`, `escalation.admin.raci.read`, `escalation.admin.rules.read`, `escalation.admin.assignments.read`.
- **Etiquetas humanas para eventos de Escalacion (frontend):** la columna `Tipo / Razon / Detalles` ahora traduce esos eventos a descripciones operativas claras (por ejemplo, _Consulta de matriz RACI_ o _Consulta de reglas de escalacion_).

### Checklist y fallback de auditoria: legibilidad y semantica real

- **Checklist realizado visible como tal:** los eventos de envio/completitud (`shiftcheck.submit`, `shiftcheck.complete`, `checklist.complete`) ahora se presentan como **CHECKLIST REALIZADO** con metrica verde/rojo cuando existe.
- **Metadata enriquecida para checklist enviado:** se agrega `checklistName` en auditoria de `shiftcheck.submit` para identificar claramente que checklist se completo.
- **Fallback generico mejorado:** cuando un evento no tiene plantilla especifica, se humaniza el nombre del evento y se muestran detalles utiles de metadata, evitando mensajes ambiguos como "accion completada" sin contexto.

### Cobertura adicional de auditoria en Directorio y Complementos

- **Directorio centralizado:** se registran consultas de listado y detalle (`directory.central.list.view`, `directory.central.detail.view`) para dejar evidencia de acceso operativo.
- **Complementos:** se registran consulta de listado activo y detalle por slug (`complement.list.view`, `complement.detail.view`) para mejorar trazabilidad de uso.

## [v1.5.74-beta] - 2026-05-18

### Boletines: agrupacion por dominio con control operativo en UI

- **Nuevo modo de envio agrupado por dominio en `/main/report-generator`:** se incorporo opcion **"Unir destinatarios por dominio"** para boletines. Cuando esta activa, el backend agrupa destinatarios `Para` por dominio exacto y envia un correo por grupo; cuando se desactiva, el flujo vuelve a modo **1:1**.
- **Comportamiento por defecto seguro para reducir ruido de copia:** el selector queda habilitado por defecto (ON), minimizando copias repetidas en `CC` cuando existen multiples destinatarios del mismo dominio.
- **Sin `CCO` por diseno:** el flujo mantiene solo `Para` y `CC`, respetando el comportamiento operacional definido para el modulo.

### Validaciones de destinatarios reforzadas (Para vs CC)

- **Bloqueo explicito de correos repetidos entre `Para` y `CC`:** se agrego validacion en frontend y backend para impedir enviar si el mismo correo aparece en ambos campos.
- **Feedback inmediato al operador:** la UI muestra mensaje de error claro con la lista de correos en conflicto y deshabilita el boton de envio mientras exista inconsistencia.

### UX de envio y trazabilidad mas precisas

- **Etiqueta del boton dinamica por modo:** en Boletin, el CTA cambia entre **"Enviar boletines (por dominio)"** y **"Enviar boletines (1:1)"** segun el estado del selector.
- **Mensajeria de ayuda alineada al modo real:** se ajusto el texto de apoyo de `CC` para que sea correcto tanto en envios agrupados como en 1:1.
- **Conteo de resultados corregido en backend:** el resumen de envio ahora contabiliza exitos/fallos por destinatario real en `Para` usando metadatos `accepted/rejected` del transporte SMTP, evitando sobrecontar lotes agrupados como exito total cuando hay rechazos parciales.
- **Comentarios tecnicos actualizados:** se normalizaron descripciones del endpoint `POST /api/reports/newsletter/send` para reflejar comportamiento dual (1:1 o agrupado por dominio).

## [v1.5.73-beta] - 2026-05-18

### Hotfix UX en ayuda contextual del generador de reportes

- **Tooltip de destinatarios alineado a la guía rápida:** en `/main/report-generator` (modo Boletín), los tooltips de los botones `Para` y `CC` dentro de `Contactos guardados` y `Listas de correo` ahora respetan el estado de `Ver guía rápida`. Antes podían mostrarse aunque la ayuda contextual estuviera deshabilitada; ahora solo aparecen cuando la guía está activa.

### Documentación operativa sincronizada

- **README y screenshots actualizados:** se alinearon novedades recientes, referencias documentales y metadatos visuales de `docs/SCREENSHOTS.md` con el estado actual del producto.
- **Guías técnicas ajustadas a baseline real:** `docs/SETUP.md` y `docs/DEPLOY.md` se actualizaron para reflejar `Node.js 22 LTS+`, dependencia frontend Angular `20.3.18` y notas de migración Mongo aplicables a instalaciones históricas.
- **Runbook y troubleshooting corregidos:** se normalizaron referencias de acceso por puerto para entorno Docker y desarrollo local en `docs/RUNBOOK.md` y `docs/TROUBLESHOOTING.md`.
- **API y gobernanza al día:** se documentaron endpoints operativos vigentes (`GET /api/smtp/password`, `POST /api/system/rate-limit-reset`) y se actualizó la marca de vigencia en `docs/UI-GOVERNANCE.md`.

## [v1.5.72-beta] - 2026-05-14

### Migracion completa a pnpm 11 por seguridad y consistencia operativa

- **Estandar de gestor de paquetes unificado:** se migro el proyecto para operar con `pnpm` como gestor unico, eliminando el uso operativo de `npm`/`npx` en flujos de instalacion y ejecucion.
- **Version fijada y controlada:** se dejo `pnpm@11.0.0` como version objetivo para asegurar reproducibilidad entre entornos locales, CI y contenedores.
- **Guard de instalacion en `preinstall`:** se incorporo validacion del `user agent` para bloquear instalaciones fuera de `pnpm 11`, reduciendo riesgo de drift de dependencias.
- **Docker alineado a la politica de paquetes:** los `Dockerfile` pasan a preparar/usar `pnpm 11` via `corepack` y ejecutar `pnpm install --frozen-lockfile`.
- **Lockfiles por contexto de build:** se mantiene lockfile por paquete (`backend`, `frontend`, `Extras/complement-stub`) para preservar builds independientes y deterministas.
- **Documentacion y operacion actualizadas:** se ajustaron guias y convenciones internas para reflejar que la operacion oficial del repo es sobre `pnpm`.

## [v1.5.71-beta] - 2026-05-11

### SMTP: observabilidad real, diagnóstico útil y UX operativa

- **Clasificación explícita de bloqueo de autenticación por política (M365):** en pruebas SMTP se agregó categorización específica `smtp_auth_policy` para errores tipo `535 5.7.139`, separándolos de credenciales inválidas y evitando diagnósticos ambiguos.
- **Metadatos de auditoría SMTP más completos:** los eventos de prueba SMTP registran categoría de falla, código SMTP, resultado y contexto de destinatarios para facilitar análisis post-incidente.
- **Visibilidad del motivo técnico en UI de auditoría:** la vista de auditoría ahora muestra el motivo detallado (`reason`) en eventos de correo/SMTP y etiqueta explícitamente resultados de `SMTP TEST`.
- **Filtro de categoría `mail` ampliado:** el backend incluyó también eventos `.email.` en consultas de auditoría para no ocultar fallas reales de envío/prueba.
- **Revelado seguro de contraseña SMTP para administradores:** nuevo endpoint `GET /api/smtp/password` (solo admin) para ver la contraseña almacenada bajo demanda; se agregó trazabilidad de acceso en auditoría.
- **Diagnóstico frontend alineado al backend:** la pantalla de configuración SMTP reconoce y muestra `SMTP_AUTH_POLICY` con recomendación operativa específica.
- **Menos fricción en formulario SMTP:** se agregó opción para usar automáticamente el correo de `Usuario SMTP` como `Email Remitente`, evitando doble ingreso del mismo correo. Si está activa, el remitente se autocompleta y queda bloqueado para mantener consistencia; puede desactivarse para casos avanzados.

### Backup/Restore: evidencia explícita de restauración de secretos

- **Respuesta y auditoría de restore/import enriquecidas:** se añadieron campos `restoredUploads`, `restoredGlobal`, `restoredSecrets` y `keyringPresentAfterRestore` para verificar de forma explícita qué se repuso tras una recuperación.
- **Trazabilidad de restauración de keyring:** se dejó evidencia operativa de presencia de `encryption-keyring.json` después de restore/import, reduciendo falsos diagnósticos sobre pérdida de credenciales cifradas.

## [v1.5.70-beta] - 2026-05-11

### Hotfix SMTP post-restore: 400 al desactivar y diagnóstico incompleto

- **Restore completo de credenciales cifradas entre entornos:** se implementó `encryption-keyring.json` persistente en `/secrets` y fallback de descifrado multi-llave en `utils/encryption.js`. Con esto, al restaurar un backup completo (incluyendo `/secrets`) se pueden recuperar contraseñas SMTP e integraciones aunque cambie `ENCRYPTION_KEY` del entorno destino.
- **400 en `POST /api/smtp` al desactivar:** se corrigió validación interna que seguía exigiendo `password` aun con `isActive=false`.
- **Desactivación resiliente tras restore:** ahora el guardado en modo desactivado no bloquea por ausencia de contraseña descifrada y conserva la contraseña cifrada existente para una futura reactivación.
- **Auditoría detallada del guardado SMTP:** se añadieron eventos `smtp.config.save.attempt`, `smtp.config.save.rejected`, `smtp.config.save.success` y `smtp.config.save.error` para trazar intento, rechazo funcional (400), éxito y excepción con metadata de contexto.
- **Diagnóstico frontend más útil:** cuando backend responde `Errores de validación`, la UI muestra el campo/motivo concreto en lugar de solo `SMTP_UNKNOWN`.
- **Corrección de clasificación SMTP en UI:** errores de autenticación de proveedor (ej. `535 5.7.139 Authentication unsuccessful` de Outlook) ahora se clasifican como `SMTP_AUTH` en vez de `SMTP_THROTTLED`, evitando recomendaciones operativas incorrectas.

## [v1.5.69-beta] - 2026-05-11

### Hotfix backup/restore: Directorio Global y borrado previo real

- **Causa raíz identificada:** la colección `DirectoryContact` (fuente de `/main/escalation/directory`) no estaba incluida en `backup-manifest`, por lo que:
  - no se exportaba al crear backup,
  - no se restauraba al recuperar backup,
  - y tampoco se purgaba en `clearBeforeRestore`/factory reset.
- **Fix aplicado:** se agregó `directoryContacts` al manifiesto central de backup, unificando create/import/restore/purge sobre esa colección.
- **`clearBeforeRestore` robustecido:** la ruta de restore/import ahora normaliza flags booleanos (`true`, `"true"`, `1`, `"1"`, etc.) para evitar falsos negativos de limpieza previa.
- **Limpieza física alineada en import ZIP:** al importar con `clearBeforeRestore=true`, además de DB se limpia también el filesystem restaurable (`uploads`, `global`, `secrets`) antes de copiar.
- **Persistencia de carpeta global en Docker:** se agregó volumen `./.data/global:/app/global` para evitar pérdida del contenido físico de `global/` al recrear contenedores.
- **UX de recuperación mejorada en Directorio:** la acción `Sincronizar y consolidar`, cuando el directorio está vacío y el usuario es admin, reconstruye desde escalación antes de consolidar/sincronizar usuarios.

## [v1.5.68-beta] - 2026-05-11

### Backup y recuperacion operativa reforzada

- **Importacion ZIP estable para respaldos grandes:** se corrigio el `413 Request Entity Too Large` en importacion por archivo elevando el limite de `nginx` a `100M` y ampliando timeouts de proxy a `300s`.
- **`clearBeforeRestore` ya funciona tambien al importar archivo:** el checkbox de borrado previo ahora viaja en `multipart/form-data` y el backend limpia las colecciones antes de reinsertar cuando corresponde.
- **Historial de backups consistente en Docker/Windows:** `GET /api/backup/history` ahora usa `birthtime` valido con fallback a `mtime`, evitando fechas erroneas tipo `31-12-1969`.
- **Cobertura ampliada del backup completo:** los ZIP manuales y automaticos incluyen base de datos, `uploads/`, `secrets/` y tambien el directorio opcional `global/` cuando existe en despliegues productivos.
- **Restore/import fisico mas fiel:** al restaurar o importar un ZIP, el sistema repone recursivamente `uploads/`, `secrets/` y `global/`, manteniendo logos, certificados TLS, artefactos publicados y recursos compartidos del despliegue.
- **Purge seguro para continuidad operativa:** la purga total ahora limpia tambien `global/` y recrea la cuenta administrativa por defecto usando las variables de `.env`, evitando quedar sin acceso tras un wipe controlado.

### SMTP con interruptor operacional real

- **Desactivacion sin borrar configuracion:** la configuracion SMTP ahora puede guardarse con `isActive=false`, quedando visible en UI/API pero sin habilitar envios reales.
- **Sin prueba forzada al desactivar:** guardar una configuracion desactivada ya no obliga a pasar un test SMTP en vivo.
- **Reactivacion sin perder credenciales:** si ya existe configuracion almacenada, el backend reutiliza la contraseña cifrada previa cuando el campo password se deja vacio al volver a guardar.
- **Respeto centralizado del estado inactivo:** el flujo comun de envio de correo dejo de tratar una config desactivada como si pudiera hacer fallback implicito a otra fuente SMTP habilitada.

### Directorio global con edicion contextual en fila

- **Nuevo contacto arriba, edicion donde corresponde:** el formulario superior queda reservado para altas; al editar un contacto existente en `/main/escalation/directory`, el editor aparece inline justo debajo de la fila seleccionada.
- **Menos friccion en listas largas:** se evita el salto al inicio de pagina al modificar contactos ubicados al final del directorio.
- **Cierre rapido del editor contextual:** pulsar nuevamente editar sobre la misma fila permite abrir/cerrar el formulario inline sin perder el contexto visual.

### Documentacion operativa sincronizada con boletines

- **README y docs tecnicos alineados:** se actualizaron las guias para reflejar el estado actual del Boletin de Seguridad, incluyendo `CC` interno opcional, seleccion rapida desde agenda preventiva/listas de correo y el flujo 1:1 por destinatario.
- **Arquitectura y API consistentes:** `docs/API.md` y `docs/ARCHITECTURE.md` ahora describen el payload real de `newsletter/send`, el uso opcional de `cc[]` y el comportamiento operativo del envio.

## [v1.5.67-beta] - 2026-05-07

### Directorio → Usuarios: sincronización retroactiva de teléfonos (`DIR-SYNC-113`)

- **Bug corregido:** los teléfonos editados en el Directorio Global de Contactos para contactos de origen `User` nunca se propagaban hacia el modelo `User` en la colección de Gestión de Usuarios, quedando el campo `phone` en `null` indefinidamente.
- **Causa raíz:** el controlador `updateDirectoryContact` retornaba `403 Forbidden` para cualquier intento de edición sobre contactos con `source='User'`, impidiendo tanto la actualización directa como la propagación en cascada.
- **Solución implementada:**
  - Se levantó la restricción absoluta: contactos `source='User'` ahora permiten edición de los campos `phone`, `company`, `type`, `scope` e `isFavorite` desde el directorio.
  - Después de guardar el `DirectoryContact`, si el origen es `User`, se ejecuta `User.updateMany({ email }, { $set: { phone } })` para mantener consistencia entre ambas colecciones.
  - Se agregó endpoint `POST /api/directory/sync-users-from-directory` (con `requireDirectoryWrite`) que realiza backfill retroactivo: recorre todos los contactos internos con email y propaga su teléfono al usuario correspondiente, sobrescribiendo `null`.
  - Se encadenó el backfill en el flujo `syncAndMergeDirectoryNow()` del frontend: al pulsar **"Sincronizar y consolidar"**, primero se fusionan duplicados y luego se ejecuta la sincronización retroactiva de teléfonos.
- **Archivos modificados:**
  - `backend/src/controllers/directoryContactController.js` — lógica de update parcial + función `syncUsersFromDirectoryNow`.
  - `backend/src/routes/directory.js` — ruta `POST /sync-users-from-directory`.
  - `frontend/src/app/services/directory.service.ts` — método `syncUsersFromDirectory()`.
  - `frontend/src/app/pages/escalation/escalation-admin-simple/escalation-directory-tab.component.ts` — encadenamiento del backfill en consolidación.

### UX y correcciones menores (`UX-FIX-114`)

- **Placeholder corregido en Contactos:** se reemplazó `"Ej: PJUD"` por `"Ej: ACME, Cliente X"` en el campo _Empresa_ del formulario de contactos de escalación.
- **Espaciado en leyenda de directorio:** se agregó `margin-bottom` al subtítulo de la sección para separarlo visualmente del primer botón de acción.
- **Visibilidad condicional de AFPmodelo:** el selector de cliente derivado (`AFPmodelo`) ya no se muestra si no hay cliente principal seleccionado; se agregó `onClientSearchChange()` que limpia `selectedClient` al borrar el campo de búsqueda.
- **Botón "Sincronizar y consolidar" no destructivo:** se desacopló del proceso de rebuild completo; ahora solo ejecuta `mergeDuplicates()` para no sobreescribir datos manuales vigentes.

## [v1.5.66-beta] - 2026-05-07

### Fix: autocomplete de destinatarios múltiples en Automatización de Turnos (`ESC-SHIFT-112`)

- **Bug corregido:** al seleccionar un segundo o tercer correo desde el directorio en los campos _Destinatarios_ y _CC_ de la sección "Automatización de Envío de Turnos", el valor seleccionado sobreescribía los correos ya ingresados en lugar de agregarlos a la lista.
- **Causa raíz:** `mat-autocomplete` reemplaza el valor del `formControl` con la opción elegida **antes** de ejecutar el callback `(optionSelected)`, dejando sin contexto a `applyEmailToControl` para reconstruir la lista acumulada.
- **Solución:** se introdujeron los campos `_recipientsRaw` y `_ccRaw` que cachean el valor raw del input en cada evento `(input)`. Al seleccionar una opción, `applyEmailToControl` usa el caché en vez del valor del control (ya sobreescrito por Material), elimina el token parcial de búsqueda, agrega el email completo sin duplicar, y actualiza el caché para que selecciones subsiguientes también funcionen correctamente.
- **Archivos modificados:** `frontend/src/app/pages/escalation/escalation-admin-simple/escalation-shifts-tab.component.ts`.

## [v1.5.65-beta] - 2026-05-07

### Programación de envío automático de turnos (`ESC-SHIFT-111`)

- **Backend: Programador de reportes integrado:**
  - Implementación de `escalationScheduleScheduler.js` con `node-cron` para monitorear y disparar envíos automáticos según la configuración de cada cliente.
  - Nuevo motor de plantillas en backend usando **MJML** para asegurar reportes responsivos y profesionales.
  - Integración en `server.js` para inicialización automática al arranque.
- **Frontend: Panel de automatización completo:**
  - Nueva sección "Automatización de Envío de Turnos" en el administrador de turnos semanales.
  - Formulario reactivo con validaciones para frecuencia (semanal/mensual), día, hora y gestión de múltiples destinatarios (manual + directorio).
  - Acción **"Enviar Ahora"** para disparar manualmente el reporte y validar la configuración al instante.
  - Extensión de `AppConfig` para soportar `escalationScheduleAutomation` con seguimiento de `lastSentAt`.
  - Actualización de interfaces TypeScript en `config.model.ts`.

- **Excelencia Visual y UX (Polished Interface):**
  - **Diseño Premium**: Panel de automatización con jerarquía visual clara, usando bordes de acento (`border-left`) y fondos suavizados (`var(--surface-muted)`) para destacar la sección.
  - **Badges Inteligentes**: Indicadores de estado dinámicos (Activo/Inactivo) con colores semánticos (`cdc-verde`) y tipografía de alto contraste.
  - **Layout Responsivo**: Grilla adaptativa (`grid-template-columns`) que asegura una visualización perfecta tanto en pantallas de escritorio como en dispositivos móviles.
  - **Micro-interacciones**: Estados de carga integrados en botones y feedback visual inmediato tras el envío manual o guardado de configuración.
  - **Tipografía y Espaciado**: Alineación estricta con el _design system_ del SOC, usando tokens de espaciado y radios de borde consistentes.

## [v1.5.64-beta] - 2026-05-06

### Directorio: permisos finos por cargo y gobierno de internos (`DIR-RBAC-106`)

- **Matriz RBAC aplicada en backend para `/api/directory`:**
  - `admin`: crear/editar/eliminar (con restricción de contactos provenientes de `Users`).
  - `qa nivel 1`, `qa nivel 2`, `customer success manager (csm)`: crear/editar, sin eliminar.
  - `n2`, `n3`, `jefe area`, `gerente area`, `arquitecto siem`: crear/editar/eliminar.
  - resto de perfiles: solo lectura.
- **UI alineada a backend:** botones/formularios de directorio se habilitan/deshabilitan según permiso efectivo del usuario (no solo visibilidad).
- **Internos protegidos correctamente por origen:** la regla de bloqueo dejó de depender de `type=Internal` y ahora usa `source='User'` para permitir casos válidos de listas internas manuales.

### Directorio: dimensión de ámbito y origen de contacto (`DIR-MODEL-107`)

- **Modelo `DirectoryContact` ampliado** con:
  - `scope`: `Internal | External` (ámbito del contacto/lista),
  - `source`: `User | Manual | Sync` (origen del dato).
- **Configuración editable en UI:** formulario de directorio ahora permite definir `Ámbito` para distinguir, por ejemplo, listas internas vs listas externas de cliente.
- **Sincronización de usuarios reforzada:** usuarios sincronizados al directorio quedan marcados como `type=Internal`, `scope=Internal`, `source=User`.

### Duplicados: consolidación avanzada y control manual (`DIR-DEDUP-108`)

- **Lógica de deduplicación mejorada:** se reemplazó agrupación simple por una consolidación conectada (multi-clave) que une registros por `name`, `email`, `name+phone` y `name+company`.
- **Fusión por “registro más completo”:** al consolidar, se conserva el contacto con mejor densidad de datos y se completan campos faltantes desde los duplicados.
- **Conservación de semántica:** en merges se priorizan `type`, `scope` y `source` según jerarquía definida para no degradar calidad del dato.
- **Nuevo endpoint manual:** `POST /api/directory/merge-duplicates` para ejecutar consolidación a demanda.
- **Nuevo botón en UI:** `Consolidar duplicados` en `/main/escalation/directory`, con feedback de resultado (`grupos fusionados`, `registros eliminados`).

### UX operativa y navegación (`DIR-UX-109`)

- **Vista directorio más operativa:** paginación ajustada a `50 / 100 / Todos` con comportamiento coherente cuando se selecciona `Todos`.
- **Copia rápida mejorada:** nombre/correo/teléfono del directorio permanecen copiables con snackbar de confirmación.
- **Selector de cliente unificado en vista de escalación:** en `/main/escalation/view` se unificaron “buscar” y “seleccionar” en un único campo autocomplete (cliente principal y cliente de RACI).

### Integridad de actualización cruzada (`DIR-PROP-110`)

- **Edición en fuente de verdad con propagación extendida:** actualizar un contacto en directorio propaga cambios de nombre/correo/teléfono a:
  - `Contact`,
  - `ExternalPerson`,
  - personas embebidas en `RaciEntry`,
  - `CatalogLogSource.escalationFlow` (pasos `unique` y `pool`).
- **Objetivo:** evitar inconsistencias como el mismo contacto con variantes de nombre/datos en distintos módulos operativos.

### Calidad de consolidación, filtros, UX y auditoría (`DIR-QA-111`)

- **Consolidación más confiable:** el merge de duplicados ahora ignora valores basura (`-`, `n/a`, `null`, etc.) para no degradar correo/empresa/teléfono en el registro final.
- **Filtro por empresa en directorio:** se añadió filtro dedicado `Empresa` en `/main/escalation/directory`, combinado con búsqueda, tipo y paginación.
- **Acción unificada operativa:** se reemplazaron acciones separadas por botón único `Sincronizar y consolidar` (rebuild + merge en secuencia), con estados de progreso y mensaje de resultado.
- **Toolbar del directorio reordenado:** nueva distribución visual de filtros y acciones para mejorar legibilidad, alineación y comportamiento responsive.
- **Auditoría del directorio central habilitada:** ahora se registran eventos en Audit Log para crear/editar/eliminar/sincronizar/consolidar (`directory.central.create|update|delete|rebuild|merge_duplicates`) con metadata contextual.

## [v1.5.63-beta] - 2026-05-06

### Directorio Centralizado como fuente de verdad operativa (`DIR-SSOT-101`)

- **CRUD visible y utilizable en UI:** se habilitó alta/edición/eliminación directa del directorio en frontend (con formulario y acciones por fila).
- **Sincronización histórica consolidada:** el proceso `rebuild-from-escalation` ahora incorpora también usuarios activos operativos (`admin`, `user`, `auditor`) al directorio con tipo `Internal`.
- **Auto-sync de usuarios a directorio:** al crear/reactivar/actualizar usuarios desde Admin, se sincronizan automáticamente al directorio como `Internal`.
- **Autocompletado extendido en formularios:** integración de directorio en Flujo dinámico, Contactos de escalación, Agenda preventiva, RACI y Personas externas; selección autocompleta campos relevantes.
- **Selector común “Usar contacto existente”:** se añadió selector rápido de directorio para rellenar formularios con un click.

### Propagación automática de cambios y borrados (`DIR-PROP-102`)

- **Sin F5 en Admin Escalación:** al crear/editar/eliminar desde directorio se refrescan automáticamente los bloques operativos (contactos, agenda, externos, RACI y flujo dinámico).
- **Borrado en cascada desde directorio:** eliminar un contacto del directorio también elimina equivalentes en `Contact` (incluyendo agenda preventiva) para evitar registros huérfanos.
- **Actualización en cascada desde directorio:** editar nombre/correo/teléfono en directorio ahora propaga cambios a `Contact`, `ExternalPerson`, personas embebidas en `RaciEntry` y contactos de `CatalogLogSource.escalationFlow` (unique/pool).

### Separación funcional de módulo y mejoras UX (`DIR-UX-103`)

- **Directorio separado de Escalación Admin:** se removió la gestión de “fuente de verdad” desde `/main/admin/escalation` y se dejó en ruta/módulo dedicado.
- **Nueva entrada de navegación global:** se agregó `Directorio Centralizado` bajo `Generar Reporte` en menú principal (`/main/escalation/directory`), visible para usuarios autenticados.
- **Modo módulo independiente:** en `/main/escalation/directory` se adaptó cabecera, título/subtítulo y breadcrumb para identidad propia de “Directorio Global”.
- **Filtro y paginación del directorio:** se añadieron filtros por tipo (`Todos/Internos/Externos/Listas`), búsqueda y paginación visual (`10/20/50`, anterior/siguiente, rango mostrado).
- **Copia rápida al portapapeles:** nombre, correo y teléfono en la tabla del directorio son clickeables con feedback visual y snackbar de confirmación.
- **Localización visual:** etiquetas de tipo en español (`Interno`, `Externo`, `Lista`) y ajustes visuales para una apariencia más profesional.

### Reglas de gobierno y permisos del directorio (`DIR-RBAC-104`)

- **Internos protegidos por diseño:** contactos `Internal` no se editan ni eliminan desde directorio; su gestión permanece en módulo `Users`.
- **Backend con RBAC por cargo para directorio:**
  - `admin`: crear/editar/eliminar (excepto `Internal` por regla de negocio).
  - `qa nivel 1`, `qa nivel 2`, `customer success manager (csm)`: crear/editar, sin eliminar.
  - `n2`, `n3`, `jefe area`, `gerente area`, `arquitecto siem`: crear/editar/eliminar.
  - perfiles fuera de matriz: solo lectura.
- **UI alineada a permisos reales:** botones/formularios de directorio se habilitan/deshabilitan según permiso efectivo de usuario/cargo.

### Estabilidad de build y Docker (`BUILD-DOCKER-105`)

- **Fix de compilación Angular:** se corrigió error `NG8002` por `matTooltip` no reconocido en `escalation-admin-simple` importando `MatTooltipModule`.
- **Verificación técnica:** compilación frontend y `docker compose build` ejecutados con resultado exitoso tras los cambios.

## [v1.5.62-beta] - 2026-05-06

### Escalación: flujo dinámico por cliente en Admin y View (`ESC-FLOW-090`)

- **Nuevo modelo por cliente:** se extendió `CatalogLogSource` con `escalationFlow[]` y `escalationLegend`, permitiendo persistir un flujo de llamados configurable por cliente sin crear colección adicional.
- **Nuevos endpoints backend:** se agregaron `GET /api/escalation/flow/:clientId` y `PUT/POST /api/escalation/flow/:clientId` para lectura y actualización completa del flujo por cliente.
- **Admin dinámico (`/main/escalation/admin`):** nuevo tab para configurar pasos de escalamiento con:
  - alta de pasos `unique` y `pool`,
  - edición de título/contactos/fecha-hora,
  - eliminación de pasos,
  - reordenamiento con `CdkDragDrop`,
  - edición anidada de contactos dentro de pools,
  - textarea de leyenda/recordatorio por cliente.
- **Vista operativa responsiva (`/main/escalation/view`):** carga del flujo configurado del cliente seleccionado y render en cards responsivas; los pools usan grid adaptativo para evitar desborde horizontal en móviles.
- **Contrato frontend tipado:** se incorporaron nuevos tipos (`EscalationFlowStep`, `EscalationFlowConfig`) y métodos en `EscalationService` para consumir/guardar la configuración.

### Corrección de compilación Docker (TypeScript estricto)

- **Causa:** durante `docker compose build`, Angular fallaba con `TS2345` en `escalation-admin-simple.component.ts` por inferencia de `type: string` en payload de flujo (`string` no asignable a `EscalationFlowStepType`).
- **Fix aplicado:** tipado explícito del payload como `{ flow: EscalationFlowStep[]; legend: string }` y retorno tipado en el `map`.
- **Resultado:** `docker compose build` completado exitosamente para `bitacorasoc-frontend` y `bitacorasoc-backend`.

## [v1.5.61-beta] - 2026-05-05

### Corrección SMTP: error TLS "wrong version number" al enviar correos (`SMTP-TLS-101`)

- **Causa raíz:** la ruta de envío real usaba `secure=true` cuando `useTLS` estaba activo, independientemente del puerto. En puertos STARTTLS (587, 2525) esto produce el error OpenSSL `tls_validate_record_header:wrong version number` porque TLS implícito y STARTTLS son protocolos distintos.
- **Corrección:** se centralizó la lógica TLS en `backend/src/utils/email.js` mediante el helper `resolveTransportSecurityOptions`: puerto 465 usa `secure=true` (TLS implícito); cualquier otro puerto usa `secure=false` + `requireTLS` según el flag `useTLS`.
- **Alineación test/send:** `backend/src/routes/smtp.js` (ruta de prueba SMTP) ahora reutiliza el mismo helper, eliminando la desalineación previa que ocultaba el problema durante la prueba pero lo manifestaba en el envío real.
- **Archivos modificados:** `backend/src/utils/email.js`, `backend/src/routes/smtp.js`.

## [v1.5.60-beta] - 2026-05-01

### Correcciones y mejoras operativas en Admin + Reportes (`UI-ADMIN-094`, `REP-AN-095`)

- **Usuarios / botón Cancelar:** en creación y edición de usuarios se corrigió contraste del botón cancelar para todos los temas (claro, sepia, rosa y oscuros), usando estilo de error consistente (fondo rojo + texto blanco).

### SMTP funcional en `/main/admin/smtp` (`SMTP-UX-096`)

- **Proveedor con presets reales:** el selector de proveedor ahora aplica configuración base útil (host, puerto y TLS) para `Office 365`, `Google Mail`, `Google Workspace`, `AWS SES`, `Mailgun`, `Elastic Email` y `Custom`.
- **Hints contextuales:** se añadieron ayudas por proveedor y placeholder dinámico para usuario SMTP según el preset elegido.
- **Contraseña con máscara y visibilidad:** el campo de contraseña ahora muestra máscara visual (`********`) cuando ya existe clave guardada y permite alternar mostrar/ocultar al ingresar una nueva.
- **Compatibilidad de clave guardada:** si hay configuración previa, se puede probar/guardar sin reescribir contraseña, manteniendo la almacenada.

### Catálogos y navegación administrativa (`UI-CAT-097`)

- **Catálogos:** se eliminó de `/main/admin/catalogs` la sección duplicada **Colores de Reportería** para evitar configuración redundante y conflictos.
- **Menú Tags:** se retiró la opción `/main/tags` del menú lateral principal sin eliminar la funcionalidad interna de tags ni sus datos.

### Escalación interna por CSV (`ESC-CSV-098`)

- **Plantilla descargable:** nuevo endpoint y acción en UI para descargar plantilla CSV de turnos internos.
- **Importación CSV de turnos:** nuevo flujo para cargar asignaciones semanales desde archivo CSV en `/main/admin/escalation`.
- **Validación de datos y upsert:** se valida estructura, persona/rol y ventana semanal; si ya existe una asignación del mismo rol+semana, se actualiza en vez de duplicar.
- **Resumen de importación:** respuesta con conteo de creados, actualizados y errores por fila para trazabilidad operativa.

### Reportes: expansión de analítica en `/main/reports` (`REP-AN-099`)

- **Nueva analítica de correos:** se agregó endpoint de agregación para boletines e incidentes con métricas de envíos y destinatarios.
- **Nuevas visualizaciones:** se incorporaron gráficas adicionales de generación por día, actividad horaria, destinatarios por tipo y distribución por cliente/dominio (según disponibilidad de metadata).
- **Cliente en reportes corregido:** se mejoró la resolución de cliente para incidentes usando metadata enriquecida y se evitó representar `Sin cliente` como categoría principal de cliente cuando no corresponde.
- **Fuente canónica para analytics:** la agregación de clientes/criticidad se alineó a eventos de envío efectivos para reducir ruido de eventos auxiliares.
- **Criticidad normalizada:** la representación de criticidad quedó restringida a niveles SOC esperados (`Bajo`, `Medio`, `Alto`, `Crítico`) para boletines y reportes.
- **Limpieza de UI solicitada:** se retiraron del panel de reportes los mensajes informativos de “registros sin criticidad” y “envíos sin cliente identificado”.

### Trazabilidad obligatoria de cliente en incidente (`REP-AN-100`)

- **Frontend:** el envío de reporte de incidente bloquea la acción si no hay cliente/log source seleccionado.
- **Backend:** `POST /api/reports/incident/send` valida y exige cliente/log source antes de procesar el envío.
- **Auditoría enriquecida:** se amplió metadata del envío con campos adicionales de cliente para mejorar atribución futura en analytics.

### Verificación técnica

- **Compilación frontend:** `npm run build` ejecutado exitosamente tras los cambios de esta versión.
- **Diagnóstico de errores en archivos tocados:** validación de workspace sin errores relevantes en los módulos intervenidos.

## [v1.5.59-beta] - 2026-05-01

### Documentación en código — comentarios de propósito y QA (`DOC-QA-093`)

- **Cobertura general:** Se añadieron encabezados de documentación (propósito del archivo, responsabilidades, notas QA) en el código fuente **JS/TS de primer nivel** del repositorio (backend, frontend, scripts y utilidades asociadas), excluyendo dependencias, caché de build y datos locales.
- **Pasada focalizada (seguridad y flujos críticos):** Comentarios tipo QA senior por bloques en puntos sensibles y de integración:
  - Backend: orden del pipeline en `server.js`, sanitización de entrada (`input-sanitizer.js`), autenticación JWT y roles (`auth.js`), complementos (`complement-auth.js`), rate limiting (`rate-limiter.js`), rutas `auth`, `entries`, `escalation`, despacho GLPI (`glpi-dispatch.js`), gestión de complementos (`complement-manager.js`), alertas por cliente (`clientAlertController.js`).
  - Frontend: interceptor HTTP (`auth.interceptor.ts`), alineación sesión vs guards (`auth.service.ts`), constatación documentada sobre guards (`auth.guard.ts`), generador de reportes (`report-generator.component.ts`), consola admin (`admin-console.component.ts`).
- **Alcance:** Solo comentarios; **sin cambios de lógica** ni de comportamiento de la aplicación.

## [v1.5.58-beta] - 2026-05-01

### Corrección: Login acepta contraseñas de cualquier longitud (`FIX-AUTH-092`)

- Se eliminó la validación `minLength(4)` del campo password en el formulario de login (`login.component.ts`). El campo acepta contraseñas de cualquier largo, dado que la restricción de longitud corresponde solo a la creación/cambio de contraseña, no a la autenticación.
- Se eliminó el mensaje de error "MINIMUM 4 CHARACTERS" del template de login (`login.component.html`) que bloqueaba el botón de submit y confundía al usuario cuando su contraseña tenía menos de 4 caracteres.

## [v1.5.57-beta] - 2026-05-01

### Auditoría completa del envío de reporte de incidente (`AUD-INC-091`)

- Se agregaron tres eventos de auditoría explícitos en el route `POST /api/reports/incident/send`, independientes del noise suppression de `email.js`:
  - `mail.incident.attempt` — se registra siempre al inicio del request, antes de cualquier procesamiento. Guarda quién inició el envío, cantidad de destinatarios, campos del reporte y cantidad de imágenes.
  - `mail.incident.sent` — se registra tras envío SMTP exitoso. Incluye destinatarios, adjuntos y paleta de colores usada.
  - `mail.incident.fail` — se registra ante cualquier error SMTP o error inesperado, con el mensaje de error y la fase donde ocurrió.
- Estos eventos son visibles en Auditoría → filtro **Mail / SMTP** y no están sujetos a supresión por reintentos.
- Se corrigió el alcance de la destructuración de `req.body` para que `subject` sea accesible en el bloque `catch` externo.

## [v1.5.56-beta] - 2026-05-01

### Selector de paleta de colores para el correo de incidente (`REP-INC-090`)

- **6 paletas curadas** implementadas en `incidentEmailTemplate.js`: `cdc-verde`, `noche-azul`, `slate-pro`, `carbon`, `indigo`, `bosque`. Cada paleta define todos los colores del email (fondo, cabecera, tarjetas, textos, evidencia, info adicional).
- **Backend — Modelo:** Se añadió el campo `incidentEmailPaletteKey` en `AppConfig` (Mongoose), con valor por defecto `cdc-verde`.
- **Backend — Rutas de config:** Se agregó validación y guardado del campo en `config.js`. La ruta `PUT /api/config` acepta y persiste la paleta seleccionada.
- **Backend — Template:** `buildIncidentEmail` y `buildIncidentEmailPreview` aceptan el parámetro `paletteKey`. La función `resolvePalette()` selecciona la paleta activa; si la clave no existe usa `cdc-verde` como fallback.
- **Backend — Reports:** Ambas rutas (`/incident/preview` y `/incident/send`) leen `config.incidentEmailPaletteKey` y lo pasan al template.
- **Frontend — Modelo:** Se añadió `incidentEmailPaletteKey?: string` a las interfaces `AppConfig` y `UpdateConfigRequest` en `config.model.ts`.
- **Frontend — Componente:** Se implementó en `settings.component.ts` el array `INCIDENT_PALETTES` con nombre, descripción y 5 swatches por paleta, junto con `selectIncidentPalette()` y `saveIncidentPalette()`.
- **Frontend — Template:** Panel de selección visual de paleta con grilla de tarjetas interactivas, indicador de selección activa (`check_circle`) y botón "Guardar paleta" con spinner.
- **Frontend — Estilos:** Las tarjetas de paleta usan variables CSS del sistema de temas (`--surface-muted`, `--border-color`, `--text-primary`, `--text-secondary`, `--accent-color`), garantizando coherencia visual en los tres temas del app (oscuro, claro, sepia).
- **Fix visual:** Se eliminó el uso de valores hardcodeados (`#1e1e2e`, `rgba(92,107,192,...)`) que rompían la apariencia en temas claro y sepia.
- **Fix UI:** Se eliminó el checkbox "Aplicar a: Reporte de Incidente" del panel "Colores del Boletín de Seguridad", que era redundante con el nuevo selector de paleta dedicado.

## [v1.5.55-beta] - 2026-05-01

### Modernización y Refactorización del Reporte de Incidentes (`REP-INC-089`)

- **Migración a MJML:** Se sustituyó la generación de HTML manual en el frontend por un motor de plantillas MJML en el backend (`incidentEmailTemplate.js`). Esto asegura consistencia total y diseño responsive en clientes estrictos como Outlook y Gmail, eliminando problemas de imágenes rotas o renderizado defectuoso.
- **Previsualización Real (Preview Endpoint):** Se implementó un nuevo endpoint (`/api/reports/incident/preview`) que el frontend consume para mostrar en tiempo real la previsualización del correo, garantizando que lo que se ve en la web es exactamente lo que llegará al destinatario.
- **Imágenes Integradas por CID:** Las evidencias ahora se envían incrustadas nativamente mediante `Content-ID` (CID) en lugar de Base64 crudo en el HTML, evitando bloqueos por parte de los filtros de spam y webmails.
- **Alineación Visual y Branding:**
  - Título principal ("Reporte de Detección") y metadatos ("Ticket" y "Ofensa") reubicados en la cabecera verde de alto contraste para visibilidad inmediata.
  - Logo corporativo insertado con control estricto de tamaño (`height=44`) para evitar el estiramiento ("stretch").
  - Ancho de diseño del reporte incrementado a `680px` para acomodar mejor el texto técnico.
  - Pie de página dinámico con el nombre del analista emisor y la marca real configurada ("Bitácora SOC").
- **Limpieza de Evidencias:** Bloque de evidencia unificado para agrupar texto e imágenes limpiamente, eliminando redundancia visual como nombres de archivos inútiles o textos repetidos por cada captura.

## [v1.5.54-beta] - 2026-04-30

### Agenda Preventiva de Boletines (`ESC-PREV-084`, `ESC-PREV-085`, `ESC-PREV-086`)

- **Autocomplete de Empresas (`ESC-PREV-084`):** Se integró un selector dinámico (`matAutocomplete`) en el campo "Empresa" del formulario de contacto preventivo. Ahora sugiere en tiempo real empresas ya registradas para evitar duplicidades tipográficas, manteniendo la opción de escritura libre para empresas nuevas.
- **Soporte para Listas de Correo (`ESC-PREV-085`):** Se introdujo el flag `isMailingList` en el modelo, backend y exportación/importación CSV de contactos. Esto permite diferenciar correos institucionales de personas naturales frente a casillas de distribución grupal.
- **Indicadores y Filtros en Tabla (`ESC-PREV-086`):** La tabla de administración ahora cuenta con badges distintivos (`👤 Personal` y `📋 Lista`) para una lectura rápida. Además, se sumó un filtro dedicado para alternar la vista entre todos los contactos, solo personales o solo listas.

### Generador de Reportes / Boletines (`REP-NEWS-087`)

- **Nuevo panel de Listas de correo:** Se añadió un bloque visual exclusivo para seleccionar listas de distribución en la vista de envío de boletines, ubicado estratégicamente debajo del área de destinatarios manuales.
- **Separación estricta de contactos:** El panel lateral derecho de "Contactos guardados" ahora filtra exclusivamente correos personales (excluyendo cualquier lista de distribución), integrando además un badge explícito de `👤 Personal` por ítem.
- **Consolidación de envío unificada:** Al enviar el boletín, el sistema fusiona de manera transparente y sin duplicados los correos manuales, las listas seleccionadas en su panel, y los contactos individuales seleccionados a la derecha, previniendo rebotes y descartando inválidos antes de procesar el lote 1:1.

## [v1.5.53-beta] - 2026-04-28

### Complementos en plataforma y documentación operativa

- Se actualizó el texto de `Admin > Complementos` en la sección **Runtime web (CSP por complemento)** para usar una redacción genérica orientada a cualquier complemento con runtime avanzado (WASM/workers/iframe), en lugar de una referencia explícita a DOOM.
- Se agregó en `README.md` una sección de **Complementos en Extras** con listado de artefactos de referencia y su propósito operativo.
- Se creó `Extras/README.md` como catálogo dedicado con lista de herramientas/complementos, enlaces de descarga/acceso, capturas y reseña breve por elemento.
- Se dejó `docs/COMPLEMENTS.md` enfocado en arquitectura/operación del módulo, con referencia breve al catálogo de `Extras/`.

## [v1.5.52-beta] - 2026-04-27

### Complemento `doom-browser` — estabilización final para publicación en plataforma

- Se corrigió la secuencia de runtime para DOOM en navegador con assets locales consistentes (`js-dos`, `wdosbox` y binario WASM), eliminando bloqueos de arranque en 0%.
- Se robusteció la captura de entrada para juego real en operación: foco al canvas, mitigación de interferencias del teclado virtual interno de js-dos y habilitación de `pointer lock` para entorno embebido.
- Se incorporó visibilidad operativa en tiempo real con sello de build en UI y contador de FPS para validar rendimiento durante QA.
- Se optimizó el perfil de ejecución del emulador ajustando parámetros de ciclos para una experiencia más fluida en equipos de escritorio.
- Se dejó guía de publicación con preset recomendado de runtime policy (CSP/sandbox) y checklist de verificación post-publicación en `tools/doom-browser/README.md`.

---

## [v1.5.51-beta] - 2026-04-27

### Complemento diccionario de logs ciber (`COMP-DICT-083`) — QA integral, rediseño operativo y ampliación de conocimiento

#### Implementación base del complemento estático

- Se consolidó el complemento `zip-static` `diccionario-logs-ciber` como artefacto autocontenido de consulta (`index`, estilos, lógica y guía de uso), sin backend dedicado y sin Docker adicional.
- Se dejó listo el paquete para publicación en Admin > Complementos con flujo completo de análisis, preview y publicación.

#### QA funcional y remediación UX inicial

- Se ejecutó revisión funcional exhaustiva del flujo de consulta por fabricante, búsqueda y render de resultados.
- Se agregaron controles operativos para mejorar uso diario: limpieza rápida de filtros, orden por criticidad y exportación por fabricante.
- Se reforzó feedback de estado para analistas con conteos visibles, mensajes de vacío claros y navegación más directa.

#### Rediseño visual orientado a operación SOC (sin look “generado”)

- Se reemplazó la vista tipo tarjetas por tabla técnica de lectura rápida, alineada a formato documental operativo.
- Se ajustó jerarquía visual para priorizar etiquetas, significado y valores comunes en grilla legible para turnos N1/N2.
- Se mejoró responsividad y consistencia visual para escritorio y móvil, manteniendo un estilo sobrio y profesional.

#### Dataset ampliado y normalizado por fabricante

- Se enriqueció la base de tags para Huawei HiSec Insight y Fortinet con campos de uso frecuente en investigación operativa.
- Se incorporaron ejemplos de logs más realistas por fabricante para comparación contextual durante triage.
- Se actualizaron descripciones e impactos para reducir ambigüedad en interpretación de eventos.

#### Separación explícita Huawei Router vs Cisco Router

- Se eliminó la combinación anterior de dominios y se separaron fuentes en dos bloques independientes:
  - Huawei Router (VRP / Info-Center).
  - Cisco Router (IOS XE / ACL Syslog).
- Se amplió específicamente Cisco Router con campos más ricos de syslog/ACL (estructura de mensaje, correlación y contexto de red), evitando equivalencias incorrectas con Huawei.

#### Profundización técnica Huawei Router (VRP)

- Se agregó semántica de severidad VRP para interpretación rápida por urgencia operativa.
- Se incorporaron campos críticos para investigación: correlativo de evento, módulo, evento/firma, origen IP/MAC, interfaz, usuario/grupo y referencia de filtro/ACL.
- Se añadió guía rápida en la interfaz con patrón de anatomía VRP y lectura por rangos de severidad para evitar errores de diagnóstico.

#### Profundización técnica Cisco Router (IOS XE)

- Se reforzó el bloque Cisco con anatomía completa de syslog (`facility`, severidad, mnemónico y mensaje), más campos de ACL y tráfico.
- Se incluyeron claves de interpretación para eventos sensibles de configuración y seguridad.
- Se añadió guía rápida Cisco en la interfaz para estandarizar lectura operativa por niveles de severidad.

#### Módulos de conocimiento “senior analyst” en la UI

- Se agregó módulo de correlación cruzada entre Huawei HiSec, Fortinet, Cisco IOS y Huawei VRP para homologar conceptos entre fabricantes.
- Se incluyó sección de troubleshooting rápido para códigos recurrentes de entorno inalámbrico/WLC-WAC.
- Se incorporaron tips de mitigación operativa por fabricante para acelerar respuesta y reducir falsas interpretaciones.

#### Documentación del complemento (sin código)

- Se dejó guía completa de instalación, compresión, publicación, pruebas y uso operativo del complemento.
- Se añadieron fuentes de referencia para trazabilidad técnica del dataset y criterios de interpretación.
- Se incorporó un “prompt maestro” documental de referencia para futuras implementaciones Angular del mismo dominio funcional.

#### Verificación y empaquetado final

- Se validó consistencia técnica del complemento tras cada iteración de cambios.
- Se regeneró el ZIP final publicado en `tools/diccionario-logs-ciber.zip` con estructura lista para carga en plataforma.

---

## [v1.5.50-beta] - 2026-04-24

### Correcciones de escalación interna + color independiente por tipo de documento

#### Scheduler de recordatorio de escalación interna (`SCHED-ESC-089`)

- **Falso positivo corregido en cobertura semanal:** en `resolveFutureWeekGap()` se normalizó la comparación de fechas a inicio de día (`toStartOfDay`) para evitar discrepancias por hora (`00:00:00` vs `23:59:59.999`) que marcaban semanas como incompletas aunque ya tuvieran escalación cargada.
- **Comparación robusta por día calendario:** ahora `weekStartDate` y `weekEndDate` de asignaciones se comparan por timestamp normalizado (`getTime()`), eliminando alertas de correo incorrectas cuando la semana sí está cubierta.
- **Texto de antelación corregido:** el correo ya no usa ciegamente el valor de configuración (`daysAhead`) y ahora muestra los días reales faltantes hasta la semana objetivo (`actualDaysAhead`), evitando mensajes como “4 día(s)” cuando realmente faltaban 3.

#### Catálogos: color por tipo de documento (`UI-CAT-090`)

- **UI extendida con selección de destino:** en `/main/admin/catalogs` se agregaron checkboxes para aplicar color a:
  - `Reporte de Incidente`
  - `Boletín de Seguridad`
- **Guardado selectivo en una sola acción:** si se marcan ambos tipos, guarda para ambos; si se marca uno, actualiza solo ese tipo; si no hay selección, bloquea guardado con feedback.
- **Mensajería de confirmación mejorada:** el snackbar informa explícitamente a qué tipo(s) se aplicó el color.

#### Configuración backend/frontend para color independiente (`CFG-REP-091`)

- **Nuevo esquema en configuración global:** `emailReportConfig.reportTableColorByDocumentType` con claves `incident` y `bulletin`.
- **Validación API agregada:** en `PUT /api/config` se validan ambos colores con formato HEX `#RRGGBB`.
- **Compatibilidad legacy preservada:** `reportTableColor` se mantiene como fallback para módulos existentes y migración progresiva.
- **Merge seguro en updates parciales:** al actualizar `emailReportConfig`, backend ahora fusiona (`merge`) configuración previa + nueva para no perder colores por tipo cuando otro módulo envía payload parcial.

#### Generador de reportes/boletín (`UI-REP-092`)

- **Consumo de color por modo activo:**
  - modo `report` usa `reportTableColorByDocumentType.incident`
  - modo `newsletter` usa `reportTableColorByDocumentType.bulletin`
- **Sincronización al cambiar de modo:** al alternar entre Reporte/Boletín se refresca color de cabecera según tipo.
- **Refresh defensivo antes de generar:** se fuerza lectura de configuración actual antes de `generateTable()` para evitar usar color stale en memoria tras cambios recientes en catálogos.

#### QA y despliegue operativo (`QA-REL-093`)

- **QA técnico completo ejecutado:** revisión de lógica, modelos, template SMTP, validaciones y flujo de guardado/lectura.
- **Sin errores de compilación/lint en archivos intervenidos:** verificación con diagnóstico de errores del workspace.
- **Despliegue requerido aplicado:** rebuild/restart de `backend` y `frontend` vía Docker Compose para activar cambios de schema + UI.

---

## [v1.5.49-beta] - 2026-04-22

### Módulo de escalación: correcciones, UX y página 404 animada

#### Scheduler de alertas de escalación (`SCHED-ESC-083`)

- **Cálculo de semana futura corregido:** `resolveFutureWeekGap()` calculaba incorrectamente la semana usando `getStartOfWeekMonday(anchorDate)`, que devolvía la semana actual o pasada. Ahora calcula explícitamente el próximo lunes desde `anchorDate` con `daysToNextMonday`, garantizando que el recordatorio apunte siempre a la semana siguiente correcta.

#### Formulario de asignación de turnos (`UI-ESC-084`)

- **Auto-relleno de fechas:** al abrir el formulario de nueva asignación, los campos `weekStartDate` y `weekEndDate` se rellenan automáticamente con el próximo lunes a las 09:00 y el lunes siguiente a las 08:59, respectivamente.
- **Sincronización automática de fecha fin:** al modificar `weekStartDate`, el campo `weekEndDate` se actualiza automáticamente a `startDate + 7 días`, evitando descuadres manuales.

#### Visibilidad de turnos asignados (`UI-ESC-085`)

- **Turnos de meses futuros ahora visibles:** la consulta de `loadAssignments()` eliminó el límite superior de fecha (`toDate`), permitiendo cargar asignaciones de cualquier mes futuro (junio, diciembre, etc.).
- **Nueva sección "Próximos meses":** se agregó una sección expandida por defecto que agrupa todos los turnos desde el mes siguiente en adelante, reemplazando la anterior sección limitada a "Próximo mes".
- **Indicador de destino en formulario:** al seleccionar fechas, el formulario muestra en tiempo real la etiqueta de la sección donde aparecerá el turno creado ("Mes actual", "Próximos meses", "Mes anterior", "Histórico").

#### Validación de duplicados (`VAL-ESC-086`)

- **Prevención de doble asignación:** se agregó validación en backend (`createAssignment` y `updateAssignment`) que rechaza asignaciones con el mismo `roleCode + weekStartDate + weekEndDate`. El error devuelto indica el nombre de la persona ya asignada y la sección donde encontrarla.

#### Filtrado de candidatos por cargo (`VAL-ESC-087`)

- **Coincidencia exacta de cargo:** `updateAssignmentPeopleOptions()` en frontend y la validación en backend ahora usan coincidencia estricta de `cargoLabel` por rol: `N1_NO_HABIL → 'N1'`, `N2 → 'N2'`, `TI → 'TI'`. Esto evitaba que usuarios con cargo "Pentester N1" aparecieran en el listado de turnos N1.

#### Página 404 animada (`UI-404-088`)

- **Nueva página de error 404:** se creó el componente standalone `NotFoundComponent` con animación Lottie embebida vía iframe, botones de navegación a `/main/checklist` y `/login`, y diseño de tarjeta limpia con fondo blanco.
- **Fondo completamente blanco:** la animación (fondo blanco) se fusiona con la tarjeta eliminando el corte visual; se removieron gradientes, glows de color y bordes del contenedor de animación.
- **Cuadro de animación ampliado:** el iframe de animación creció de 520×310px a 720×420px para mayor impacto visual.
- **Routing conectado:** se registró `/404` con `loadComponent` en `app-routing.module.ts` y wildcard `**` tanto en el router principal como en el módulo `main` para capturar cualquier ruta desconocida.
- **Assets organizados:** `404.json` y `404.lottie` movidos a `frontend/src/assets/animations/` para mantener la estructura de assets del proyecto.
- **Verificación técnica:** `npm run build` → compilación Angular OK, bundle generado sin errores. Docker rebuild y push a `origin/Development-update`.

---

## [v1.5.48-beta] - 2026-04-21

### Correcciones críticas de URLs en Boletín (`MAIL-NEWS-082`)

- **URLs rotas en Referencias del boletín:** Se corrigió bug donde URLs largas (ej: `https://github.com/openssl/openssl/commit/61f428a2fc...`) se enviaban con espacios insertados entre caracteres alfanuméricos, rompiendo el link en el correo. Ahora `formatNewsletterReferences()` detecta URLs con regex `/(https?:\/\/[^\s]+)/gi`, las convierte en links clicables `<a>` con estilos de preservación de URL (`word-break: break-all`) y las renderiza correctamente sin espacios.
- **URLs rotas al pegar en textareas del formulario:** Se corrigió bug en `applyNewsletterPasteHeuristics()` donde el procesamiento automático de texto pegado (reparación de "VulnerabilidadID" → "Vulnerabilidad ID") insertaba espacios en URLs, rompiendo links como `61f428a2fc` → `61 f 428 a 2 fc`. Ahora la función **extrae URLs temporalmente** con placeholders antes de aplicar transformaciones, preservándolas intactas y restaurándolas al final.
- **Verificación técnica:** Compilación frontend OK, despliegue Docker OK (`frontend:v1.5.48`). URLs ahora se preservan completas tanto en el render del correo como en el pegado de texto en cualquier textarea del boletín (Impacto, Referencias, CVE, etc.).

### Optimización de imágenes panorámicas en evidencias del boletín

- **Detección automática de tablas y capturas anchas:** El sistema ahora detecta imágenes con aspect ratio > 1.4 (panorámicas, tablas multi-columna, gráficos horizontales) y las procesa de forma diferenciada.
- **Mayor resolución para imágenes panorámicas:** Las imágenes anchas se guardan hasta **2400x1600px** (antes 1600x1600px) para preservar legibilidad de texto en tablas densas, mientras que imágenes cuadradas/verticales mantienen límite estándar de 1600x1600px.
- **Renderizado adaptativo en email:** Imágenes panorámicas se renderizan a **900px de ancho** (antes 1600px universal), aprovechando mejor el espacio disponible en el correo sin estiramiento vertical. Imágenes cuadradas/verticales usan **700px** para mantener proporciones adecuadas.
- **Sin estiramiento visual:** La lógica de aspect ratio asegura que tablas con mucha información horizontal se vean proporcionadas y legibles, eliminando la distorsión que hacía texto ilegible en evidencias densas.
- **Formato preservado:** Se mantiene PNG para capturas de pantalla (mejor para texto) y JPEG 95% para fotos, ahora con dimensiones óptimas según tipo de contenido.

---

## [v1.5.47-beta] - 2026-04-16

### Correcciones visuales Cyberpunk/Dark + estabilización Docker

- **Historial de checklists legible y responsivo:** se corrigieron desbordes, headers cortados y bloques montados en la vista de historial para temas **Dark** y **Cyberpunk**, mejorando wrap, alturas mínimas y espaciado en móvil.
- **Cyberpunk más usable en operación diaria:** se redujo la tipografía global, el espaciado excesivo y la agresividad visual del tema para menús, títulos, toolbar y paneles, manteniendo la identidad neon pero con mejor lectura.
- **Sidebar lateral reparado:** los acordeones y botones de navegación como **Historial y Entradas** y **Complementos** ya no quiebran palabras letra por letra ni muestran headers deformados; ahora usan truncado limpio y proporciones consistentes.
- **Pantalla de Backups depurada:** el encabezado visible se simplificó a **Configuración de Backups Automáticos** y se acortaron etiquetas largas de destino como **SMB/Samba** y **NFS** para evitar cortes visuales innecesarios.
- **Base Docker más estable:** frontend y backend pasan a usar **Node 22 Alpine** por defecto en sus builds, reduciendo fragilidad frente a cambios de imagen y mejorando compatibilidad operativa.
- **Verificación fresca:** `frontend npm run build` OK; `docker compose build frontend backend` OK; `docker compose ps` con **backend**, **frontend** y **mongodb** en estado saludable.

---

## [v1.5.46-beta] - 2026-04-15

### Agenda preventiva + boletines guardados (`UI-NEWS-072`, `UI-ESC-073`, `UI-DIR-074`..`077`, `MAIL-NEWS-078`)

- **Boletines con libreta guardada:** en `report-generator` el envío ahora mezcla correos manuales con una agenda preventiva seleccionable por checkbox, mostrando **nombre, correo y empresa** por contacto y deduplicando antes del despacho 1:1.
- **Filtros y favoritos operativos:** búsqueda por nombre/correo/empresa, filtro por empresa, acciones `Seleccionar todo`, `Limpiar` y `Solo favoritos`, además de contador visible de seleccionados para campañas repetitivas.
- **Agenda preventiva separada de escalación:** `/main/admin/escalation` deja explícita la diferencia entre contactos de escalación y libreta preventiva; el backend soporta `contactType='preventive'`, flags `activo`, `favorito`, `no enviar` y nota interna.
- **CSV de agenda preventiva:** importación parcial segura con validación por fila, plantilla simple descargable y exportación CSV de respaldo desde el panel admin.
- **Validación y auditoría de envío:** el boletín muestra resumen previo de destinatarios válidos, duplicados, inválidos y excluidos, y el despacho queda consolidado como **envío real 1:1** con trazabilidad operativa.
- **Checklist admin legible en temas oscuros:** se corrigió la sección **Plantillas y editor** para evitar nombres encimados y textos oscuros sobre fondo dark/cyberpunk; el listado y los headers del acordeón ahora respetan los tokens de contraste del tema.
- **Verificación técnica fresca:** backend `npm test -- --runInBand` → **2 suites OK / 5 tests OK**; frontend `npm run build` → compilación Angular exitosa y bundle generado en `frontend/dist/bitacora-soc`.

---

## [v1.5.45-beta] - 2026-04-15

### Corrección recordatorios largos por correo (`MAIL-REM-079`)

- **Checklist Admin / recordatorios periódicos:** el campo `Texto del correo` ya no queda limitado a 500 caracteres; ahora acepta hasta **5000** para mensajes operativos extensos.
- **Formato preservado en email:** el render HTML del recordatorio ahora respeta saltos de línea, separaciones y listas con viñetas, evitando que el contenido llegue como un bloque único.
- **Validación consistente punta a punta:** frontend, API y modelo Mongo quedaron alineados con el nuevo límite para evitar rechazos silenciosos o truncamientos inesperados.

---

## [v1.5.44-beta] - 2026-04-11

### Estabilización Docker + remediación visual UI (`UI-VIS-066`..`071`)

- **Frontend Docker estable en recreate:** fix de arranque Linux para script propio (`CRLF -> LF` en `frontend/Dockerfile`), `ENTRYPOINT` dedicado (`frontend/docker-entrypoint.sh`) y espera activa a `http://backend:3000/health` antes de iniciar Nginx.
- **Nginx frontend simplificado y robusto:** `proxy_pass` directo a `backend:3000` (sin resolver/variables/keepalive frágiles), timeout más amplios y rutas `/api` + `/uploads` consolidadas para evitar 502 intermitente.
- **Smoke de conectividad validado tras `docker compose build --no-cache` + `up -d --force-recreate`:** `/health`=200, `/api/config/logo`=200, `/api/users/me`=401 esperado sin sesión (ya no 502).
- **Login visual refactor (CRT/Cyber):** limpieza de malas prácticas en `login-infoflow.scss` (eliminados `!important` y hacks de especificidad), jerarquía tipográfica más clara, foco/errores/acciones consistentes y mejor lectura móvil.
- **Baseline visual global para pantallas core:** nuevas reglas compartidas en `styles.scss` (`page-header`, `admin-section`, `admin-panel`, `section-card`, `panel-actions`) y ajuste de shell en `main-layout.component.scss` (toolbar, health strip, densidad responsive).
- **Documentación operativa actualizada:** `docs/ISSUES.md` y `docs/UI-GOVERNANCE.md` dejan cerrada la ola `UI-VIS-066`..`071`; plan ejecutado en `docs/ui-visual-remediation-plan.md`; QA recurrente (`QA-UI-061`..`065`) se mantiene obligatorio por PR.

---

## [v1.5.43-beta] - 2026-04-10

### Resumen de alcance

Oleada **integral UI + gobernanza documental**: del orden de **~80 archivos** y **~2.4k líneas añadidas / ~1.5k eliminadas** en el árbol de trabajo (migración masiva de contenedores `mat-card` a paneles semánticos con tokens, refuerzo de `styles.scss`, tablas de control en `ISSUES.md` y paquete de guías QA/WCAG). Esta entrada consolida **todo** lo incluido en esa oleada, no solo un subconjunto.

### Backend

- **`package.json`:** `npm test` ejecuta `jest --passWithNoTests` para que el pipeline no falle mientras no existan `*.spec.js` / `__tests__` (hoy **0 tests**; el comando refleja “OK sin suites” en lugar de exit 1).

### Documentación y tablas de control

- **`docs/ISSUES.md`:** cierre en tabla **Listas** de **`UI-CHK-044` … `UI-MIG-060`**; sección **En progreso** reducida a **marcador** (“sin `UI-*` abiertos”) con reglas de uso; **Recurrente** con **QA-UI-061**–**065** (obligaciones por PR); leyenda de estados; nota de **alcance de seguimiento** (epic `AI-SUMMARY-*` como archivo, fuera de priorización operativa); narrativa **[UI/UX]** y bloque largo **UI-CHK-044** alineados a **Listo**; filas de **mejora continua** enlazadas a §9 y handoff WCAG.
- **`docs/UI-GOVERNANCE.md`:** guía operativa publicada (tokens, layout, densidad, **§6** baseline visual, **§7** contraste/WCAG, **§8** checklist **QA-UI-061**–**065**, **§9** métricas `rg`); cabecera y **§2** con cierre 2026-04-10 y referencia a **Recurrente**; secciones con títulos “regla viva; antes UI-XXX”.
- **`docs/wcag-audit-handoff.md`:** ritmo de ejecución WCAG 2.1 AA por PR/release (rutas §6, axe/Lighthouse, registro en PR); alineado con **UI-A11Y-050** y **UI-QA-059**.
- **`docs/ui-baselines/README.md`:** convención opcional de capturas por ruta/tema y criterio de OK (coherente con **QA-UI-062** / **QA-UI-065**).
- **Reapertura de backlog visual (2026-04):** nuevos issues **`UI-VIS-066`..`UI-VIS-071`** en **En progreso** para atacar deuda de legibilidad, consistencia y usabilidad percibida; plan operativo en `docs/ui-visual-remediation-plan.md`.

### Estilos globales (`frontend`)

- **`src/styles.scss`:** incorporación de **`@use 'styles/semantic-tokens'`**; ampliación de variables por tema (`[data-theme="…"]`), utilidades y overrides coherentes con la migración a paneles (incl. formularios, tablas, estados, CRT/login donde aplica).
- **`src/styles/semantic-tokens.scss`:** archivo dedicado a **tokens semánticos** (escala `--space-*`, `--radius-*`, tipografía semántica, `--surface-card`, `--outline-subtle`, etc.) por tema, con referencias cruzadas a `ISSUES.md` y `UI-GOVERNANCE.md`.

### Checklist administración (`/main/admin/checklist`)

- Navegación tipo **asistente** (pasos 1–3) con **`scrollIntoView`** suave hacia `#checklist-step-config`, `#checklist-step-reminders`, `#checklist-step-templates`.
- **Una sola** acción primaria de guardado en el editor de plantillas: barra **“Guardar plantilla”**; eliminado el segundo **`type="submit"`** duplicado en el pie; texto guía **`.form-actions__hint`**.
- Estilos **`.checklist-wizard-nav`**, refinamiento de **`.admin-panel`** / layout responsive (incl. recordatorios en móvil).

### Sustitución de `mat-card` por paneles semánticos (inventario de pantallas tocadas)

Patrón recurrente: `section` / `header` / cuerpo con clases tipo **`*-panel`**, tokens `--surface-card`, `--outline-subtle`, `--radius-md`, `--space-*`, y eliminación de imports **`MatCard*`** / **`MatCardModule`** donde dejaron de usarse.

| Área                | Componentes / notas                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**            | `forgot-password`, `reset-password` (estructura alineada; CRT vía `styles.scss` / `.reset-card` donde corresponde).                                                                                                                                                                                   |
| **Login**           | `login.component.scss`, `login-infoflow.scss` (CRT / flujo info).                                                                                                                                                                                                                                     |
| **Principal**       | `settings`, `integrations`, `users`, `entries`, `profile`, `audit-logs`, `backup`, `catalog-admin`, `all-entries`, `reports`, `report-generator`, `checklist` (operador), `glpi-integration`, `logo` (branding), `admin-appearance`, `admin-security`, `admin-complements` (TS/HTML/SCSS según ruta). |
| **Checklist admin** | `checklist-admin` (paneles + asistente + guardado único, ver arriba).                                                                                                                                                                                                                                 |
| **Escalación**      | `escalation-simple`, `escalation-admin-simple`, `escalation-admin`, `escalation-view`; **`escalation.module.ts`** sin `MatCardModule` si ya no se usa en plantillas activas.                                                                                                                          |
| **Turnos**          | `work-shifts-admin`.                                                                                                                                                                                                                                                                                  |
| **Layout / shell**  | `main-layout.component.scss` (ajustes de contenedor/superficies); **`main.module.ts`** sin import global de `MatCardModule` cuando ningún hijo lo requiere.                                                                                                                                           |
| **Widgets**         | `current-shift.component.ts` (panel/tokens; menos hex sueltos en detalles).                                                                                                                                                                                                                           |

### QA / verificación

- **Manual:** cumplir **QA-UI-061**–**065** y tabla **§6** de `UI-GOVERNANCE.md` en PRs que toquen UI.
- **Build:** validado **`npx ng build --configuration=production`** en `frontend` para esta oleada.
- **Automatizado:** backend `npm test` → exit 0 con `passWithNoTests`; frontend **`npm test` (`ng test`)** sigue **sin target** en `angular.json` (solo `build`/`serve`) — pendiente configurar runner si se desea gate en CI.

---

## [v1.5.42-beta] - 2026-04-10

### Oleada 11: sin `mat-card` en rutas operativas restantes — UI-ARCH-045 / UI-LAYOUT-053

- **`reports`:** `.reports-panel` + cabeceras/cuerpos semánticos; KPIs y gráficos sin `MatCard*`.
- **`all-entries`:** `.all-entries-panel` (búsqueda + resultados con toolbar).
- **`catalog-admin`:** `.catalog-panel` (`section` / `header` / `h2` / cuerpo); imports `MatCard*` eliminados del componente.
- **`checklist` (operador):** `.checklist-panel`; `#checklistGuideCard` sigue en `section`.
- **`glpi-integration`:** `.glpi-panel`.
- **`escalation-simple`:** `section.section-card` con tokens; **`escalation-admin-simple`:** `mat-card` → `section` en formularios; **`escalation.module`:** sin `MatCardModule`.
- **`admin-complements`:** `section.complements-panel`; **`current-shift`:** panel con tokens (menos hex sueltos en detalles).
- **Legado (no en rutas activas):** `escalation-view`, `escalation-admin` — mismos patrones por consistencia.
- **`main.module.ts`:** eliminado `MatCardModule` (ningún template principal usa `mat-card`).

Documentación: `docs/ISSUES.md`, `docs/UI-GOVERNANCE.md` §2 y §9 (oleada 11).

---

## [v1.5.41-beta] - 2026-04-10

### Tablas de control en `ISSUES.md`: En progreso vs Recurrente vs Archivo IA

- **`docs/ISSUES.md`:** leyenda de estados; backlog no-IA pasa a **En progreso** (entrega parcial en repo); `QA-UI-061`–`065` en **Recurrente**; epic `AI-SUMMARY-*` en **Archivo IA**; lista explícita del siguiente ataque (rutas con `mat-card` + MAT/COLOR/WCAG).
- **`docs/UI-GOVERNANCE.md`:** §2 duplica **En progreso** y **Recurrente** por separado; fuentes de verdad y pie de página actualizados.

---

## [v1.5.40-beta] - 2026-04-10

### Backup y Branding sin `mat-card` — UI-ARCH-045 / UI-LAYOUT-053

- **`backup`:** paneles `.backup-panel` (config automática, estado anidado, grid CSV/BD/import/purge, historial con tabla); tokens de superficie/borde; `danger-card` mantiene borde semántico en el panel.
- **`logo` (Branding):** ocho bloques como `.logo-panel.logo-card` con cabecera y cuerpo tokenizados.

---

## [v1.5.39-beta] - 2026-04-10

### Más pantallas sin `mat-card` raíz (backlog no-IA) — UI-ARCH-045 / UI-LAYOUT-053

Reemplazo de contenedores `mat-card` por paneles con tokens (`--surface-card`, `--outline-subtle`, `--radius-md`, `--space-*`) y cabeceras semánticas donde aplicaba:

- **Configuración:** `settings` (general + SMTP), `integrations` (ambos bloques), `users` (formulario + tabla).
- **Principal:** `entries` (formulario nueva entrada), `profile` (datos + contraseña), `audit-logs` (guía, filtros, resultados).
- **Turnos:** `work-shifts-admin` (formulario y bloque tabla/asignación/reenvío).
- **Auth:** `forgot-password`, `reset-password` (misma clase `.reset-card` para overrides CRT en `styles.scss`).

Se eliminaron imports `MatCard*` / `MatCardModule` asociados en cada componente.

**Pendiente de alcance en esta versión:** `reports`, `catalog-admin`, `checklist` (operador), `escalation-*`, `glpi-integration`, `all-entries` — siguen con `mat-card` donde aún no se migró (`backup`/`logo` cerrados en v1.5.40-beta).

---

## [v1.5.38-beta] - 2026-04-10

### Alcance de backlog: epic IA fuera de seguimiento operativo

- **`docs/ISSUES.md`:** nota **Alcance de seguimiento** bajo _Tablas de Control_: `AI-SUMMARY-001`…`001G` solo como referencia; no entran en priorización UI/QA ni en métricas por oleada (`UI-MIG-060`). Sección narrativa [UI/UX] alineada (excluye epic IA del “trabajo restante” medido).
- **`docs/UI-GOVERNANCE.md`:** cabecera y §2 aclaran que el epic IA no se prioriza en esta guía ni en oleadas; **lo demás** del backlog §2 sí.

---

## [v1.5.37-beta] - 2026-04-10

### Admin sin `mat-card` raíz (seguridad / apariencia) — UI-ARCH-045 / UI-LAYOUT-053

- **`admin-security`:** panel `.security-panel` + cabecera y cuerpo con tokens (`--surface-card`, `--radius-md`, etc.); sin `MatCard*`.
- **`admin-appearance`:** contenedor `.appearance-admin` + `.appearance-panel`; espaciados con `--space-*` donde aplica.

### Login CRT: variables SCSS para neón / error / texto — UI-LOGIN-055 / UI-COLOR-049

- **`login.component.scss`:** `$crt-neon`, `$crt-danger`; literales `#ffffff` / `#00ff99` / `#ff3366` sustituidos por variables; `.session-info` con un solo `color` (`$crt-green`).

---

## [v1.5.36-beta] - 2026-04-10

### Report generator sin `mat-card` raíz; recordatorios móvil tipo tarjeta — UI-ARCH-045 / UI-CHK-044

- **`report-generator`:** contenedor `.report-generator-panel` + cabecera semántica y cuerpo `.report-generator-body` (tokens alineados con checklist); eliminados imports `MatCard*`.
- **`checklist-admin`:** tabla de recordatorios con `data-label`, `.reminder-table--stack-narrow` y `.reminders-table-wrap` para vista apilada en viewport ≤ 640px (sin depender solo de scroll horizontal).

### Documentación — UI-QA-059, UI-MIG-060, UI-A11Y-050, §6 guía

- **`docs/ui-baselines/README.md`:** convención opcional de capturas y enlace a la tabla de rutas/temas.
- **`docs/UI-GOVERNANCE.md`:** corrección de numeración (**§6** Baseline, antes duplicado como §5); **§7** pasos sugeridos de auditoría WCAG; **§9** comandos `rg` para reconteos; oleada **7** en lista; tabla **§2** y **ISSUES** alineados.
- **`docs/ISSUES.md`:** notas actualizadas en `UI-CHK-044`, `UI-ARCH-045`, `UI-REF-051`, `UI-A11Y-050`, `UI-QA-059`, `UI-MIG-060`.

---

## [v1.5.35-beta] - 2026-04-10

### Guía UI: backlog en §2 y QA `QA-UI-061`–`065` en §8

- **`docs/UI-GOVERNANCE.md`:** Tabla **§2** con todos los pendientes UI/QA (copia operativa de `ISSUES.md`); **§8** con tabla y checklist explícitos para `QA-UI-061`–`065`; secciones **§3–§11** renumeradas (layout §4, densidad §5, baseline §6, WCAG §7, métricas §9, badges §10, inline §11).
- **`docs/ISSUES.md`:** Referencias `§` actualizadas a la guía nueva.
- **`semantic-tokens.scss`:** Comentario de cabecera apuntando a §2 y §8.

### Cabeceras admin sin mat-card (escalamiento / turnos) — UI-ARCH-045

- **`escalation-admin-simple`**, **`escalation-simple`**, **`work-shifts-admin`:** la cabecera con gradiente pasa de `<mat-card class="page-header">` a `<header class="page-header">` con padding, `border-radius` y `box-shadow` vía tokens; texto `on-primary` donde aplica el override global de `h1`/`p`.
- **`escalation-admin-simple`:** `.raci-form` sin `!important` en `display`.

### Checklist admin: paneles sin mat-card y flujo numerado (UI-CHK-044 / UI-ARCH-045)

- **`checklist-admin`:** Sustitución de `mat-card` / `mat-card-content` por `.admin-panel` + `.admin-panel__body` en configuración, recordatorios y bloque plantillas/lista+editor; títulos de sección **1. / 2. / 3.**; títulos de lista/editor con `.admin-panel__title`. Menos anidación Material y misma jerarquía visual con tokens.
- **`docs/UI-GOVERNANCE.md`:** métricas oleadas y `!important` (ahora **§9**), clases estado **§10**, excepciones inline **§11**.
- **`docs/ISSUES.md`:** Notas actualizadas en `UI-CHK-044`, `UI-ARCH-045`, `UI-COMP-048`, `UI-REF-051`, `UI-MAT-052`, `UI-MIG-060`.

---

## [v1.5.34-beta] - 2026-04-10

### UI/UX: guía de gobernanza y alineación honesta del backlog (`docs/ISSUES.md`)

- **`docs/UI-GOVERNANCE.md`:** Guía operativa (tokens, layout admin, densidad, plantilla baseline 5 temas, WCAG/checklist, obligaciones al cambiar CSS). Cubre el entregable **UI-GOV-058**; **no** implica que el resto del epic UI esté cerrado.
- **`docs/ISSUES.md` — corrección de estado:** Los issues `UI-CHK-044`, `UI-ARCH-045`, `UI-COMP-048`, `UI-COLOR-049`, `UI-A11Y-050`, `UI-REF-051`, `UI-MAT-052`, `UI-LAYOUT-053`, `UI-DENS-054`, `UI-LOGIN-055`, `UI-QA-059`, `UI-MIG-060` y `QA-UI-061`–`QA-UI-065` vuelven a **Pendientes** con notas **Hecho (parcial) / Falta** para reflejar el trabajo real. Permanecen en **Listas** como **Listo:** `UI-TOKEN-046`, `UI-TOKEN-047`, `UI-AUDIT-056`, `UI-HEALTH-057`, `UI-GOV-058`.
- **Sección narrativa [UI/UX]:** Estado actualizado a **Abierto** mientras existan filas pendientes anteriores.
- **`frontend/src/styles/semantic-tokens.scss`:** Tokens de tipografía semántica (`--font-size-*`, `--line-height-*`, `--font-weight-*`) en `:root` (UI-TOKEN-047).
- **`frontend/src/app/pages/login/login.component.scss`:** Scanlines CRT: animación más suave y solo si `prefers-reduced-motion: no-preference` (avance **UI-LOGIN-055**, issue sigue pendiente).

---

## [v1.5.33-beta] - 2026-04-10

### Corrección de destinatarios en Recordatorios de Turno (MAIL-REM-043)

#### Backend — Scheduler de recordatorios (`shiftReminderScheduler.js`)

- **Fuente de destinatarios corregida:** `WorkShiftAssignment` (la colección que escribe el botón "Vincular" en la UI) es ahora la **fuente principal** de destinatarios. Antes se sumaba al array legacy `assignedUserIds`, causando que usuarios ya desvinculados siguieran recibiendo correos e inflando el conteo.
- **Fallback correcto:** `assignedUserIds` y `assignedUserId` (campo singular legado) solo se usan si `WorkShiftAssignment` no retorna ningún destinatario activo para el turno y día actual.
- **Resultado:** Si se vinculan N personas vía "Vincular", el recordatorio llega exactamente a esas N personas.

#### Frontend — Auditoría (`audit-logs.component.ts`)

- **Bug "Para: sin destinatarios" corregido:** `resolvedRecipientsPreview` y `toMasked` se persistían en MongoDB como objetos con claves numéricas (`{"0": "...", "1": "..."}`) en vez de arrays reales. El frontend usaba `Array.isArray()` que retorna `false` para estos objetos, cayendo al texto "sin destinatarios" incluso habiendo destinatarios.
- **Helper `toRecipientArr()`:** Nuevo helper local que normaliza cualquier valor a array: arrays reales pasan directo, objetos con claves numéricas se convierten con `Object.values()`, null/undefined retornan `[]`. Se usa tanto para `resolvedRecipientsPreview` como para el fallback `toMasked`.

---

## [v1.5.32-beta] - 2026-04-10

### Mejoras en Formulario de Mantenimientos Programados (ESC-MAINT-042)

#### Frontend — Selector de fecha/hora con calendario (catalog-admin)

- **Reemplazo de `datetime-local`:** Los campos "Ventana desde" y "Ventana hasta" pasaron de un input `datetime-local` a una combinación de `MatDatepicker` (calendario con popup) + campo de hora `type="time"`. El usuario puede elegir la fecha con el mouse desde un calendario y escribir la hora directamente.
- **4 controles nuevos en el formulario:** `validFromDate` / `validFromTime` / `validToDate` / `validToTime` reemplazan a `validFrom` / `validTo`. La combinación a ISO se hace en `buildClientAlertRulePayload()` via `combineDateAndTime()`.
- **Helpers nuevos:** `toDateFromIso()` (ISO → `Date` para cargar al editar), `toTimeFromIso()` (ISO → `HH:mm` para cargar al editar), `combineDateAndTime()` (fecha + hora → ISO para guardar).
- **Validadores dinámicos actualizados:** `updateClientAlertRuleValidators()` ahora aplica `Validators.required` a los 4 nuevos controles solo cuando el tipo es `scheduled_maintenance`.
- **Locale `es-CL`:** Calendario muestra fechas en español con semana iniciando en lunes.
- **Imports del componente standalone:** Agregados `MatDatepickerModule`, `MatNativeDateModule`, `MatSuffix` y provider `MAT_DATE_LOCALE`.

#### Frontend — Cleanup del formulario de mantenimiento

- **Campos ocultos para mantenimiento:** Todos los campos exclusivos de `special_alert` (Modo horario, Hora inicio/fin, Días de la semana, Feriados, Canales y destinatarios, Solo en feriados, Prioridad, Zona horaria, Contextos, Nombre de regla) ya no se muestran cuando `ruleType === 'scheduled_maintenance'`.
- **Validadores dinámicos:** Al cambiar entre tipos, los validators se activan/desactivan en tiempo real. El formulario nunca bloquea el submit por campos que no son visibles.

#### Backend — Validación server-side (shiftReminderController)

- **Validación 422 en create/update:** Si `frequencyType === 'fixed'` y `fixedTimes` está vacío o ausente, el backend responde `422 Unprocessable Entity` con mensaje explícito.

#### Backend — Scheduler de recordatorios (shiftReminderScheduler)

- **Polling de 5 min → 1 min:** `POLL_INTERVAL_MS` reducido de 5 a 1 minuto.
- **Tolerancia de 5 min → 1 min:** `FIXED_TOLERANCE_MINUTES` reducido a ±1 minuto, los emails llegan en el minuto exacto configurado.

---

## [v1.5.31-beta] - 2026-04-10

### Recordatorios por Email de Inicio de Turno (MAIL-REM-043)

#### Backend — AppConfig + Scheduler

- **Campos nuevos en `AppConfig`:** `shiftReminderEnabled` (toggle maestro), `shiftReminderMinutesBefore` (ventana 5-120 min, default 30), `shiftReminderTimezone` (timezone por defecto, hereda la del turno si tiene), `shiftReminderLastSentMap` (Map `shiftId→fecha`, anti-duplicado por turno y día).
- **`shiftReminderScheduler.js`:** Nuevo scheduler con polling de 5 minutos. Para cada `WorkShift` activo de tipo `regular`, calcula minutos hasta el inicio usando `moment-timezone` en la timezone del turno; si cae dentro de la ventana de recordatorio y no se envió ya hoy (dedup vía `shiftReminderLastSentMap`), envía email HTML a los usuarios en `assignedUserIds` (con fallback a `assignedUserId` legado).
- **Email HTML:** Plantilla inline con cabecera azul SOC, tabla con nombre de turno, código, hora de inicio y timezone. Auditoría automática via `sendEmail()` con `auditContext.sourceModule: 'shiftReminderScheduler'`.
- **`PUT /api/config`:** Tres nuevas validaciones para `shiftReminderEnabled`, `shiftReminderMinutesBefore` (int 5-120) y `shiftReminderTimezone`.
- **`server.js`:** `startShiftReminderScheduler()` iniciado junto a los demás schedulers al arrancar la BD.

#### Frontend — Checklist Admin

- **Nueva sección en `/main/admin/checklist`:** Tercera columna de configuración con checkbox "Recordatorio de inicio de turno por email", campo de anticipación (minutos) y campo de zona horaria. Los dos últimos son condicionales al toggle.

---

## [v1.5.30-beta] - 2026-04-10

### Mantenimientos Programados Bloqueantes (ESC-MAINT-042)

#### Backend — Modelo y Controller

- **`ClientEscalationRule` extendido:** Nuevos campos `ruleType` (`special_alert` | `scheduled_maintenance`), `blocking` (Boolean), `maintenanceTitle` (String, max 500), `readBy` (subdocumento con `userId`, `username`, `context`, `readAt`, `occurrenceKey`).
- **`buildOccurrenceKey()`:** Genera clave de ocurrencia estable por ventana absoluta (`validFrom+validTo`) o por fecha local recurrente (`ruleId+localDate`), previniendo re-lectura de distintas ocurrencias de la misma regla.
- **Precedencia en evaluación:** Orden de aplicación: `scheduled_maintenance bloqueante` → `scheduled_maintenance no bloqueante` → `special_alert`.
- **Soporte de `clientName`:** `evaluateClientAlert` acepta `?clientName=` como alternativa a `?clientId=`, con resolución unívoca (error explícito si ambiguo).
- **`readBy` persistido en ACK:** `acknowledgeClientAlert` guarda la confirmación del analista en `readBy` con deduplicación por `userId + occurrenceKey + context`, evitando duplicados sin bloquear la respuesta.
- **`occurrenceKey` en respuesta:** La clave de ocurrencia se incluye en la respuesta de evaluación y en los metadatos de auditoría.

#### Frontend — Diálogo y Banner

- **`ClientAlertDialogComponent` modo bloqueante:** Para reglas `scheduled_maintenance + blocking`, el diálogo no muestra el botón "Más tarde", muestra ícono `engineering`, título naranja "Mantenimiento programado activo", caja con borde naranja y aviso de bloqueo. `disableClose: true` impide cerrar sin confirmar.
- **Banner `report-generator` con variante mantenimiento:** El banner de alerta activa cambia a clase `.maintenance-blocking` con fondo naranja tenue, ícono `engineering` y el título del mantenimiento. Incluye aviso de bloqueo con ícono candado.

#### Frontend — Catálogo Admin

- **Tab renombrado:** "Alertas Especiales" → "Alertas y Mantenimientos".
- **Selector de tipo al inicio del formulario:** `mat-select` para `Tipo de regla` con opciones "Alerta Especial de Escalamiento" y "Mantenimiento Programado".
- **Campos condicionales de mantenimiento:** `maintenanceTitle` y checkbox `blocking` solo visibles cuando `ruleType === 'scheduled_maintenance'`.
- **Badge "Tipo" en tabla:** Nueva columna con íconos `engineering`/`warning`, texto tipo y candado para mantenimientos bloqueantes.
- **`editClientAlertRule`/`cancelClientAlertRuleEdit`/`buildClientAlertRulePayload`:** Actualizados para incluir y resetear los nuevos campos.

## [v1.5.29-beta] - 2026-04-09

### Boletín de Seguridad — Formato HTML email-safe (UI-NEWS-041, UI-NEWS-042)

#### UI-NEWS-041: CVE/IDs uno por línea

- **Nueva función `formatCveList()`:** Los identificadores CVE/IDs del campo correspondiente se dividen ahora por comas, puntos y coma o saltos de línea y se renderizan un CVE por línea con fuente monoespaciada, eliminando la cadena continua que dificultaba la lectura técnica.

#### UI-NEWS-042: Campos de texto con formato email-safe

- **Nueva función `formatNewsletterText()`:** Los campos `Producto(s) Afectado(s)`, `Impacto`, `Acciones Recomendadas / Mitigación` y `Referencias` se procesan ahora línea a línea aplicando HTML inline:
  - Líneas con viñeta (`-`, `*`, `•`, `·`) → `<div>` con `padding-left` y símbolo `&#8226;`, email-safe.
  - Líneas con indentación → `<div>` con `padding-left` proporcional a la profundidad detectada.
  - Líneas vacías → `<br>` de separación.
  - Líneas normales → `<div>` sin dependencia de `white-space: pre-wrap`.
- **Eliminación de `white-space: pre-wrap` en el boletín:** Esta propiedad CSS no es respetada por la mayoría de clientes de correo (Gmail, Outlook). La nueva función reemplaza el comportamiento con HTML explícito, garantizando que la estructura visible en la preview del boletín sea idéntica a la del correo enviado.

### Verificación de Issues Incompletos

#### AUDIT-EXPORT-028: Descarga flexible de logs de auditoría — Confirmado Listo

- Verificado que el componente de auditoría expone 5 modos de exportación (filtros actuales, por cantidad, últimos días, últimos meses, todos) con `mat-hint` visible y ejemplos exactos (`2, 7, 15` días; `1, 3, 6` meses) tal como requería el issue.

#### UI-HEALTH-033: Barra de salud de servicios críticos — Confirmado Listo

- Verificado que la barra de salud usa `*ngIf="isAdmin"` (solo admins), tiene fondo y borde separado visualmente del toolbar, y los chips usan colores de alto contraste (`#1f7a35`/blanco, `#b71c1c`/blanco) con `font-weight: 600` para máxima legibilidad.

## [v1.5.28-beta] - 2026-04-08

### Ayuda Contextual y UX (REP-GEN-039)

#### Sistema de globos dinámicos "Top-Aligned"

- **Nueva UX Avanzada:** Se reemplazó el panel de guía estático por un sistema de ayuda contextual disparado por foco (`focus/blur`).
- **Posicionamiento Inteligente:** Se implementó una estrategia de alineación superior que coloca los globos sobre el campo, eliminando recortes en los bordes de la pantalla y la necesidad de scroll horizontal.
- **Animaciones Premium:** Integración de `anime.js` para efectos de "pop-up" suaves con aceleración por hardware (escala y traslación vertical).
- **Consistencia:** Limpieza de clases manuales y unificación del comportamiento de ayuda en los modos Reporte y Boletín.

### Docker y DevOps (DOCKER-OPT-040)

#### Optimización de Build y Concurrencia

- **BuildKit Caching:** Se asignaron identificadores únicos a los montajes de caché de npm (`npm-cache-backend` y `npm-cache-frontend`), permitiendo que ambos servicios se compilen en paralelo sin errores de colisión de archivos (`ENOTEMPTY`).
- **Imagen Base (Backend):** Se revirtió la imagen a `node:24-alpine` para restaurar la compatibilidad con los comandos `addgroup` y `adduser`, corrigiendo fallos de despliegue en Debian-slim.

### Saneamiento y Estabilidad de Compilación

#### Resolución de errores de metadatos (Build Fix)

- **Fix Angular Compiler:** Se resolvieron errores persistentes `TS2339` (Property does not exist) mediante el renombrado de métodos (`handleFieldFocus`/`handleFieldBlur`) y propiedades (`hintActiveId`) en `ReportGeneratorComponent`, forzando al compilador a invalidar cachés de metadatos corruptos.
- **Corrección de Validación (Bug Fix):** Eliminado el requisito erróneo de la sección "Resumen Ejecutivo" en el validador de boletines, permitiendo el envío exitoso cuando se dejan vacíos los campos opcionales (CVE y Referencias).

## [v1.5.27-beta] - 2026-04-07

### Boletín de Seguridad (logo/correo HTML)

#### Corrección integral de render de logo en Gmail/Outlook

- **Fix backend (newsletter MIME):** Se reforzó `POST /api/reports/newsletter/send` para preparar boletines con imagen inline robusta (`multipart/related` + `cid`) y fallback de adjunto estándar.
- **Fix backend (parser de `<img src>`):** Se reemplazó la extracción/reemplazo frágil por un escaneo seguro del primer `src` (`locateFirstImgSrcRange`, `extractFirstImgSrc`, `replaceFirstImgSrc`) para soportar `data:image` largos sin romper el HTML.
- **Fix backend (higiene de HTML):** Se agregó saneamiento defensivo para remover `<img>` inválidos cuando corresponda (`removeFirstImgTag`, `removeLeadingDataImageTags`) evitando logos rotos.
- **Fix backend (resolución de logo):** La resolución del buffer del logo prioriza el HTML generado del boletín (incluyendo base64 PNG generado en frontend) y usa `AppConfig.logoUrl` como fallback final.
- **Compatibilidad de formato:** Se dejó el flujo operativo en PNG para correos (evitando problemas de render de algunos clientes con WebP inline).

#### Validación pre-envío en frontend

- **Nuevo precheck automático:** Antes de enviar boletín, el frontend valida presencia de logo (`<img src>` no vacío/placeholder), color negro explícito en textos clave (`#111111`) y secciones mínimas requeridas.
- **Bloqueo preventivo:** Si la validación falla, el envío se detiene y se informa el motivo al usuario en UI.

#### Estilo y legibilidad del boletín

- **Fix frontend (color):** Se reforzó color de títulos y párrafos en secciones del boletín con `#111111 !important` para evitar regresiones visuales (texto verde en clientes de correo).
- **Branding frontend:** La carga de logo en el generador vuelve al flujo de conversión a PNG base64 controlado para email (no solo URL directa), preservando consistencia de render.
- **Fix frontend (pegado enriquecido, `UI-NEWS-037`):** En `/main/report-generator` (modo Boletín) se intercepta el pegado `text/html` en `Resumen Ejecutivo`, `Impacto`, `Acciones Recomendadas` y `Referencias`, normalizando a texto legible con estructura (saltos, viñetas y filas tipo `col1 | col2`) para evitar contenido “achochlonado”.

#### Observabilidad

- **Logs de newsletter permanentes:** Las trazas de diagnóstico del flujo de boletín quedaron activas de forma fija en backend (`newsletterDebug`) para auditoría operativa sin depender de flag ENV.

#### Documentación y claridad operativa

- **README actualizado:** Se añadió sección de novedades recientes (UX, boletines, seguridad y estado de IA local en preparación) para lectura rápida del estado real del producto.
- **API actualizada:** Se incorporó `POST /api/reports/newsletter/send` en `docs/API.md` con notas de comportamiento 1:1 y diagnóstico de fallos parciales.
- **Troubleshooting actualizado:** Se agregó guía específica para incidencias de pegado enriquecido en boletines (texto corrido/achochlonado), con pasos de verificación y recuperación.
- **Runbook ampliado:** Se incorporó flujo operativo diario del Boletín de Seguridad, incluyendo checklist de uso y recomendaciones de contenido.
- **Operations ampliado:** Se añadió validación funcional mínima del modo Boletín (preview, envío 1:1 y prueba de pegado enriquecido).
- **Architecture ampliado:** Se agregó diagrama de flujo actual de envío de boletines y diagrama objetivo para IA local planificada (`AI-SUMMARY-001`).
- **Security ampliado:** Se documentaron controles de seguridad requeridos para IA local en modo preparación (RBAC, ejecución efímera, timeout/kill, auditoría técnica y no fuga de datos).

### Cierre QA de issues reabiertos (2026-04-07)

#### Auditoría / Exportación (`AUDIT-EXPORT-028`)

- **Claridad de rango temporal:** Se aclaró la UX de exportación para evitar ambigüedad en "Últimos días/meses", incorporando formato explícito por `N` (`Últimos días (N días)`, `Últimos meses (N meses)`).
- **Ayuda contextual visible:** Se agregaron ejemplos directos en UI (`2, 7, 15, 30` días y `1, 3, 6, 12` meses) y etiquetas dinámicas del campo numérico según modo.
- **Reutilización de filtros activos:** Se añadió modo de exportación **Filtros actuales (incluye fechas)** para descargar respetando exactamente los filtros del formulario (búsqueda, categoría, evento, nivel y rango de fecha), además de los modos por cantidad/ventana.

#### Salud de servicios (`UI-HEALTH-033`)

- **Control por rol:** La barra/chips de salud quedó restringida solo a `admin` (frontend y backend), eliminando exposición innecesaria para otros perfiles.
- **Mejora de legibilidad:** Se separó visualmente del toolbar principal y se reforzó contraste por estado (`ok/warn/down`) con tipografía legible en todos los chips.

#### Reintentos guiados (`INT-RETRY-034`)

- **Trazabilidad de reintentos:** SMTP y GLPI ahora incluyen metadatos de reintento (`retryAttempt`, `retryCount`) tanto en llamadas de prueba como en eventos de auditoría para diferenciar intento inicial vs reintento guiado.

#### Micro-onboarding contextual (`UI-ONBOARD-035`)

- **Fix UX reportes:** Se corrigió el botón "Ver guía rápida" en `/main/report-generator` para evitar comportamiento de "botón muerto": al abrir la guía, hace scroll automático a la tarjeta de onboarding.

#### Dependencias frontend / seguridad (`DEP-NPM-012` seguimiento)

- **Remediación `npm audit`:** Se actualizaron dependencias de Angular a `20.3.18` y se aplicaron overrides de seguridad (`vite`, `picomatch`) en frontend.
- **Validación técnica:** `npm audit` reporta `0 vulnerabilities` y `npm run build` finaliza correctamente tras la actualización.

## [v1.5.26-beta] - 2026-04-05

### Generador de Reportes y Comunicación (REP-GEN-019)

#### Modo de Boletín de Seguridad

- **Feature (Frontend):** Se integró un modo dual en `/main/report-generator` mediante un selector visual que permite alternar entre "Reporte Técnico" y "Boletín de Seguridad" sin necesidad de recargar la página.
- **Flujo Simplificado:** El formulario del modo "Boletín" fue desacoplado de la dependencia obligatoria de _Log Source_ y alertas por cliente, priorizando campos orientados a la comunicación ejecutiva y generalizada (Título, Criticidad, Resumen Ejecutivo, Impacto, Mitigación y Referencias).
- **Escala CVSS Integrada:** Se reemplazó el menú genérico de "Nivel de Alerta" incorporando métricas estándar de CVSS (0.1 - 10.0), mapeadas a insignias de color (Verde, Naranja, Rojo y Granate) al exportarse al portapapeles.
- **Firma Automática:** El sistema ahora captura dinámicamente el nombre o identificador del usuario en sesión activa, firmando automáticamente el boletín generado (`Generado por [Usuario]`) en reemplazo del genérico "Bitácora SOC".
- **Branding Personalizado:** Se integró la extracción automática del logo corporativo configurado en el sistema para incrustarlo directamente en el Boletín de Seguridad. Al exportar el documento, la imagen se convierte dinámicamente a Base64 previniendo bloqueos de visibilidad en clientes de correo estricto (como Outlook), presentándose en un encabezado estructural que preserva el título y subtítulo centrados mientras mantiene el logo posicionado a la izquierda.

### Administración y Catálogos

#### Ajustes Operativos y Límites Globales (B48 / B49)

- **Borrado Físico de Catálogos (B48):** Se ajustó la gestión de "Tipos de Operación" en `/main/admin/catalogs`. Además de la opción de desactivación lógica (baja), se habilitó un botón de eliminación física total (`findByIdAndDelete`), permitiendo a los administradores limpiar permanentemente registros configurados por error.
- **Límites de Validación (B49):** Se incrementó la capacidad de subida de Logos de la plataforma de 2MB a 5MB (aplicado a buffers Multer y validación de strings Base64), otorgando tolerancia para imágenes institucionales de mayor tamaño o resolución desde el módulo de Branding.

### Rate limiting y operación de sesión

#### Resolución de falsos positivos en login

- **Fix backend:** Se resolvió el issue SEC-RL-018 que causaba un falso positivo de rate limit masivo (error "DEMASIADAS PETICIONES DESDE ESTA IP").
- Se ajustó el middleware general (`apiLimiter`) para soportar sesiones gestionadas por cookies (`auth_token`), evitando que compartan el bucket restrictivo anónimo (`apiPublicMax`) según su IP de origen (NAT).
- Las rutas de bajo riesgo previas al login, como `/api/config/logo` y afines, fueron exoneradas del cálculo global global limitante.

#### Fuga de memoria y desbordamiento de red en Layout

- **Fix frontend crítico:** Se resolvió una anomalía severa en `MainLayoutComponent` que generaba un desbordamiento exponencial de temporizadores (`setInterval`) por un anidamiento lógico. Esta anomalía causaba parálisis del navegador web, miles de peticiones simultáneas por minuto al backend provocando autoexpulsiones de sesión, y desencadenaba el error "Demasiadas peticiones desde esta IP" derivado en el inicio de sesión.

## [v1.5.25-beta] - 2026-04-03

### Plataforma de complementos

#### Publicación ZIP, visibilidad y operación

- Se elevó el límite de subida de paquetes ZIP a `25 MB` en validación backend, manteniéndolo fijo en código y no en variables de entorno.
- Se incorporó flujo práctico de análisis, preview y publicación para complementos ZIP estáticos desde `Admin > Complementos`, incluyendo detección de stack permitido, configuración sugerida y publicación administrada por plataforma.
- Se generaron paquetes de prueba para QA manual (`sin BD`, `persistencia local`, `API externa`) para validar instalación, uso y borrado end-to-end.
- Se implementó refresco reactivo del menú lateral de complementos tras crear, actualizar, publicar o eliminar, evitando depender de `F5` para ver cambios.
- Se reorganizó el menú lateral para escalar mejor: grupo colapsable de historial/entradas y bloque separado de complementos con tratamiento visual propio.

#### Routing, iframe y acceso seguro

- Se corrigió el flujo de preview/publicación de complementos estáticos normalizando URLs de iframe y rutas relativas bajo `/uploads/complements/...` para que funcionen correctamente detrás de proxy/nginx.
- Se añadió proxy explícito para `/uploads` y `/uploads/complements` en frontend nginx, alineando acceso desde Docker, desarrollo local y despliegue HTTPS.
- Se protegió el acceso directo a artefactos publicados y previews: ahora `/uploads/complements/*` exige autenticación y valida permisos de visibilidad; preview queda restringido a `admin`.
- Se ajustó la política de `iframe` y cabeceras para permitir cargar complementos publicados sin dejar los artefactos expuestos públicamente por URL conocida.
- Se simplificó la vista del contenedor de complementos para reducir el efecto de “cuadro dentro de cuadro”, quitando metadata redundante (`slug · versión`) y ampliando el área útil del iframe.

#### Resiliencia y seguridad operativa

- Se corrigió el circuit breaker de complementos `zip-static`: el health-check ya no intenta sondas HTTP a un servicio inexistente y ahora valida la presencia del artefacto publicado en disco.
- Se mantuvo aislamiento visual de complementos en `OPEN`, evitando que un complemento defectuoso impacte la aplicación principal.
- Se eliminó un `docker-compose.test.yml` residual para reducir ruido operativo y simplificar la superficie de despliegue de complementos.

### Seguridad y autenticación

#### Endurecimiento adicional

- Se eliminó el uso activo de token stub en `.env`, dejando solo guía comentada para pruebas locales controladas.
- Se ajustó el guard SSRF/outbound para permitir explícitamente hosts privados solo en escenarios autorizados de complementos/desarrollo interno.
- Se añadió soporte de auditoría con `source` y `sourceId` para eventos de complementos, permitiendo filtrar por slug y enrutar mejor los eventos a observabilidad/SIEM.

### Auditoría y observabilidad

#### Trazabilidad de complementos

- Se amplió el modelo `AuditLog` con `source` y `sourceId` y se agregaron índices para consultas operativas por complemento.
- Se extendió el endpoint y la UI de auditoría para filtrar por categoría `Complementos` y por `slug` específico del complemento.
- Se documentaron y centralizaron eventos de complementos (`complement.install`, `complement.update.*`, `complement.delete.*`, `complement.wipe.*`, `complement.circuit.*`, `complement.api.*`).

### Dependencias y build

#### Hardening de supply chain

- Se actualizó `nodemailer` a `^8.0.4` para mitigar advisories de seguridad en el flujo SMTP.
- Se migró `mjml` a `5.0.0-beta.2`, eliminando la cadena vulnerable heredada de `html-minifier` y adaptando el render de reportes a API async.
- Se forzó `glob@^13.0.6` mediante `overrides`, eliminando de la instalación productiva los warnings y ramas transitorias deprecadas ligadas a `glob@10.5.0`.
- Se validó generación de reportes y empaquetado con smoke tests, además de reconstrucción Docker con `npm install --omit=dev` sin vulnerabilidades productivas reportadas.

### Rate limiting y operación de sesión

#### Ajustes de despliegue

- Se corrigió el despliegue de variables de rate limit al contenedor backend: `docker-compose.yml` ahora propaga `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_MAX_AUTH_REQUESTS` y `RATE_LIMIT_LOGIN_MAX`.
- Se hizo configurable por entorno el límite del `loginLimiter`, evitando que quedara fijo en `5` intentos al margen de la configuración operativa.
- Se normalizaron valores de preproducción para evitar bloqueos artificiales por recarga/prueba intensiva y separar mejor límites públicos, autenticados y de login.

## [v1.5.24-beta] - 2026-04-02

### Cierre de Issues Operativos

#### Infraestructura y datos

- **INFRA-MONGO-001:** Se actualizó la imagen base de MongoDB a `mongo:8` en `docker-compose.yml` y se documentó el procedimiento de migración mayor (dump, limpieza de volumen y restore) en `docs/DEPLOY.md`.

#### Integraciones

- **B19:** Se completó la integración GLPI para dos modos de operación: despacho de resumen diario y despacho inmediato para eventos críticos (`incidente` / `ofensa`).
- Se agregó persistencia de estado de último despacho (`éxito/fallo`, canal, modo, mensaje) y trazabilidad de auditoría para intentos exitosos y fallidos.

#### Auditoría y autenticación

- **AUDIT-014:** Se corrigió la atribución de actor en `auth.login.success`, enviando actor explícito en backend para evitar que el login exitoso quede como acción de sistema.
- Se ajustó el frontend de auditoría para resolver actor con fallback de metadata cuando corresponda, mejorando trazabilidad forense.
- **MAIL-AUDIT-015:** Se enriqueció la auditoría de correo (`mail.send.success/fail`) con contexto operativo (`sourceModule`, `triggerType`, `triggerContext`, `shiftId/checklistId/entryType`, `smtpConfigId`, destinatarios sanitizados y conteo resuelto), se normalizó la causa de error y se agregó control de ruido para fallos repetidos; la UI ahora muestra causa y origen de disparo de forma explícita.

#### Plataforma de complementos

- **COMP-001 a COMP-011:** Se incorporó la base productiva de complementos con modelo `Complement`, API interna `/api/internal/v1`, Application Tokens con scopes, circuit breaker por complemento, shell iframe seguro, bridge `postMessage`, logging centralizado, overlays Docker y `complement-stub` para QA/integración.

#### Backups

- **BACKUP-AUTO-016:** Se rediseñó el scheduler automático de backups con estado persistente de ejecución (`lastAutoRunAt`, `nextAutoRunAt`, estado y mensaje), verificación por vencimiento en arranque/intervalo y eventos de auditoría de ciclo automático.
- Se añadió visibilidad de estado/última/próxima ejecución automática en la UI de administración de backups.
- **BACKUP-RET-017:** Se corrigió la depuración automática de respaldos locales para incluir `backup-*.json` y `backup-*.zip`, con cálculo robusto de antigüedad y trazabilidad por archivo (`BACKUP_RETENTION_CLEANUP_STARTED`, `BACKUP_RETENTION_FILE_DELETED`, `BACKUP_RETENTION_FILE_SKIPPED`).

#### Seguridad

- **SEC-HIGH-009:** Se mitigó riesgo de Regex Injection/ReDoS en búsquedas administrativas y autocomplete, aplicando escape estricto de patrones y límites de longitud para `search/q/topic`.
- **SEC-HIGH-010:** Se incorporó guard central de destinos salientes (solo HTTPS, bloqueo loopback/red privada, validación DNS y allowlist opcional por `OUTBOUND_ALLOWLIST`) aplicado a GLPI y Log Forwarding en guardado y ejecución.
- **SEC-MED-011:** Se eliminó logging sensible residual de autenticación/reseteo reemplazándolo por trazas sanitizadas sin exponer secretos ni links de recuperación.

#### Frontend

- **B34:** Se incorporó en Administración de Checklist la configuración de alerta por ítems NOK (switch + selección de cargos objetivo), persistida en configuración global.
- Se implementó en backend el envío automático de correo al registrar checklist con estados rojos, resolviendo destinatarios por cargo activo y adjuntando detalle/observación de cada ítem NOK en el mensaje.
- **FE-SASS-013:** Se migró en login el uso de Sass de `@import` a `@use`, eliminando la ruta deprecada para compatibilidad con Dart Sass 3.
- **B46:** Se reforzó el límite de contenido de entradas en UI con `maxlength=50000` en formulario principal y diálogo de edición, más truncado defensivo en `input` y aviso explícito al llegar al tope.
- **B47:** Se mejoró legibilidad del heatmap en temas claros (`light`, `sepia`, `pastel`) ajustando tonos bajos/medio-bajos y forzando color de etiquetas internas con mayor contraste.

#### Deuda técnica backend

- **DEP-NPM-012:** Se actualizó el árbol raíz de dependencias (`jest` 30 y reemplazo de `yamljs` por `yaml`) y se validó instalación de producción (`npm install --omit=dev`) sin presencia de `inflight` ni `glob@7`.
- Queda únicamente remanente de deprecación en subárbol de desarrollo/transitivo, sin impacto en runtime productivo actual.

## Histórico Consolidado - 2026-04-01

Migración documental de cambios cerrados que estaban marcados como `Listo` en `docs/ISSUES.md` pero aún no tenían asiento explícito en este changelog. Esta sección preserva el resultado funcional conocido sin inventar una versión histórica específica retroactiva.

### Infraestructura y Seguridad Base

#### Plataforma, autenticación y hardening inicial

- **INFRA-NODE-ALL:** Upgrade completo a Node 24 LTS con imágenes `node:24-alpine`, validando compatibilidad de Mongoose 8, bcrypt, webpack Angular y arranque estable de contenedores.
- **B-CRÍTICO-001:** Corregido el flujo por el cual los correos no llegaban al cierre de checklist.
- **B5:** Se protegieron rutas críticas que antes podían alcanzarse sin autenticación.
- **SEC-CRIT-001:** Se sanitizó `/api/config` para evitar exposición de credenciales SMTP y se endurecieron endpoints sensibles.
- **SEC-CRIT-002:** Se reforzó la recuperación de contraseña para evitar fugas de token y mantener links seguros.
- **SEC-CRIT-003:** Se corrigió el refresh indefinido de JWT expirados.
- **SEC-CRIT-004:** Se completó el RBAC faltante para `guest` en endpoints críticos.
- **SEC-CRIT-005:** Se aplicaron rate limits y defensas anti brute-force en autenticación.
- **SEC-HIGH-006:** Se eliminaron credenciales por defecto débiles del flujo principal.
- **SEC-HIGH-007:** Se redujo el riesgo de robo de JWT por XSS moviendo sesión a cookie `HttpOnly` y ajustando el flujo auth.
- **SEC-HIGH-008:** Se añadió validación estricta de nombres/rutas para neutralizar path traversal en backups.

#### HTTPS y transporte seguro

- **B28:** Se simplificó la configuración HTTPS con un wizard Angular más fluido y seguro.
- **SEC-HTTPS-ALL:** Se cerró un paquete amplio de fallos TLS/HTTPS: hot-reload de certificados con SNI, validaciones criptográficas previas a guardado, aislamiento de volúmenes y CORS estricto, manteniendo `0-downtime`.

### Base de Producto y Administración

#### Mejoras funcionales y de UX

- **B6:** Refactor de contraste dark mode mediante tokens y mejoras de legibilidad.
- **B8:** Implementada edición admin de entradas con whitelist y auditoría.
- **B9:** Se incorporó soporte de checklist por tipo y turno en backend y frontend.
- **B10:** Se habilitó branding configurable de favicon desde UI y endpoints dedicados.
- **B11:** Se amplió la auditoría de correo y de acciones operativas.
- **B12:** Se implementó el huevo de pascua del login.
- **B13:** Se implementó el sistema de huevo de pascua por hashtag.
- **B15:** Ajustes de compatibilidad visual del correo HTML en clientes dark/light.
- **B16:** Se implementó la auditoría avanzada según el alcance definido en ese momento.
- **B18:** Se creó el módulo general de integraciones en consola admin.
- **B21:** Se implementaron backups automáticos y retención.
- **B25:** Se mejoró la gestión visual y operativa de Log Sources/Clientes activos vs inactivos.
- **B27:** Se consolidó la consola admin unificada.
- **P1:** Se completó el plan general de actualización a Angular 20.

### Turnos y Asignación Operativa

#### Serie inicial `OPS-ASSIGN-*`

- **OPS-ASSIGN-001:** Se integró con API el selector de usuarios en Admin Turnos.
- **OPS-ASSIGN-002:** Se creó el CRUD dedicado `work-shifts/assignments`.
- **OPS-ASSIGN-003:** Se introdujo la colección `WorkShiftAssignment` para soportar recurrencia por días.
- **OPS-ASSIGN-004:** Se implementó el cálculo de estado `EN TURNO / FUERA DE TURNO`.
- **OPS-ASSIGN-005:** Se añadió refresco en vivo con `interval(60000)`.
- **OPS-ASSIGN-006:** Se extrajo lógica común a `shift-time.util.ts` para eliminar duplicación.
- **OPS-ASSIGN-007:** Se robustecieron reglas anti-solapamiento de asignaciones en backend.
- **OPS-ASSIGN-008:** Se corrigió manejo de timezone del turno con `moment-timezone`.
- **OPS-ASSIGN-009:** Se validó compilación frontend y refactor a utilities como base de pruebas de integración.
- **OPS-ASSIGN-010:** Se corrigió la columna `Asignado a` con un resumen de tabla adaptado al modelo operativo.

### Validación Técnica

- Se verificó que los items históricos migrados desde `docs/ISSUES.md` ahora quedan representados en este changelog.
- La tabla `✅ Listas` de `docs/ISSUES.md` puede vaciarse sin perder trazabilidad documental de cambios cerrados.

## [v1.5.23-beta] - 2026-03-20

### UI/UX + Frontend (EE-BAT-001)

#### Easter Egg #bat - comportamiento multi-murcielago y suavizado de trayectoria

- **Fix frontend:** El trigger en `Nueva Entrada` mantiene deteccion exacta de `#bat` (case-insensitive) en tiempo real y ahora crea un murcielago por cada token exacto detectado en el contenido.
- **Fix frontend:** Se elimino el patron de variacion global sincronizada que provocaba reinicios visuales grupales; cada murcielago conserva estado y variacion propios.
- **Fix frontend:** Se introdujeron variantes reales de recorrido (`bat-move-1..4`) y direccion opcional invertida por instancia para reducir trayectorias clonadas.
- **Fix frontend:** Se ajusto la reaccion al cursor para evitar efecto de "teletransporte": se removio la mutacion de duracion de animacion en runtime y se mantuvieron solo micro-desplazamientos acotados.
- **Fix frontend:** Se reforzo el clamping de movimiento para evitar recortes en bordes y zona de menu lateral, manteniendo visibilidad operativa sobre la UI.
- **Mejora funcional:** Se aumento el limite maximo de instancias de murcielago de `15` a `50` y se sincronizo el texto visible del tooltip/estado en interfaz.

### Validacion Tecnica

- Se validaron `entries.component.ts`, `entries.component.html` y `entries.component.scss` sin errores de compilacion posteriores al ajuste.

## [v1.5.22-beta] - 2026-03-19

### Auditoría — Mejora de visibilidad y categorización (B46+)

#### Tabla de auditoría — Redesign compacto y categorización de acciones

- **Fix frontend:** La tabla de auditoría en `/main/audit-logs` fue rediseñada para maximizar el espacio disponible en la columna **"Razón / Tipo"** y mejorar la identificación de acciones críticas.
- **Columnas optimizadas:** Se eliminaron columnas redundantes (`event`, `ip`) y se compactaron (`timestamp`, `actor`, `level`, `username`) para liberar espacio horizontal.
- **Nueva columna "Acción":** Indicador visual 👤 (usuario) vs ⚙️ (sistema) en columna separada, permitiendo identificar al instante si fue acción manual del operador o disparada automáticamente por scheduler/integración.

#### Detección de acciones del usuario vs sistema (B46+)

- **Fix frontend:** Implementado método `isSystemAction()` que detecta automáticamente si una acción fue dispuesta por un usuario o por el sistema basándose en:
  - Presencia/ausencia del actor en el log
  - Patrón del evento (`scheduler.*`, `cron.*`, `automation.*`, etc)
- **Lógica de display:** El indicador se renderiza con icono claro y tooltip descriptivo al pasar el mouse.

#### Categorización contextual de acciones (B46+)

- **Fix frontend:** Se incorporó método `getActionType()` que clasifica cada evento en una de 8 categorías visuales:
  - 🔗 **Integración** → GLPI, Log Forwarding, etc
  - 📧 **Correo** → SMTP, envíos de email
  - 🔐 **Autenticación** → Login, logout, reset de contraseña, cambios de IP
  - 📝 **Entrada** → Crear/editar/borrar entradas en la bitácora
  - ✓ **Checklist** → Completar/modificar checklists de turno
  - 🚨 **Escalación** → Triggers de escalación de alertas
  - ⚙️ **Configuración** → Cambios en settings de administración
  - 📋 **Evento** → Otras acciones genéricas
- **Rendering:** Cada categoría se muestra como un badge coloreado independientemente en la columna "Razón", haciéndola fácil de escanear.

#### Contexto detallado por tipo de acción (B46+)

- **Fix frontend:** El método `getReasonText()` fue expandido para extraer y mostrar información contextual específica de cada tipo de evento:
  - **Correo:** `✅ [CORREO] Para: usuario@mail.com | Asunto: Reporte`
  - **Login:** `✅ [LOGIN] vía LOCAL` o `❌ [LOGIN] intento fallido`
  - **Entrada:** `✅ [ENTRADA CREAR] [INCIDENTE] | Descripción/nota`
  - **Checklist:** `✅ [CHECKLIST COMPLETADO] Checklist del Turno`
  - **Cambio de IP:** `⚠️ [CAMBIO IP] 192.168.1.1 → 200.1.1.1 (probable VPN/Proxy)`
  - **Escalación:** `✅ [ESCALACIÓN TRIGGER] Rueda N2 | Detalles adicionales`
  - **Integración:** `✅ [INTEGRACIÓN] → glpi.example.com | OK`
- **Fallback robusto:** Todos los eventos muestran un estado visual (✅ = éxito, ❌ = error, ⚠️ = alerta) seguido de la categoría en mayúsculas y detalles específicos.

#### Estilos y UX optimizados (B46+)

- **Fix frontend (SCSS):** Las columnas ahora tienen anchos explícitos y flexibles:
  - `timestamp`: 130px (compacto)
  - `actor`: 40px (solo ícono)
  - `level`: 80px (chip)
  - `username`: 140px (nombre de operador)
  - `reason`: flex 1 (ocupa todo el espacio disponible)
- **Fix frontend:** Los badges de categoría (`action-category`) son inline-block con flex-shrink: 0 para no comprimir, dejando la máxima área para el texto de razón.
- **Fix frontend:** Se agregó `line-height: 1.4` en `.reason-text` para mejorar legibilidad del contexto multilínea.
- **Fix frontend:** Los emojis se renderizan con fuente del sistema para garantizar compatibilidad en todos los navegadores.
- **Fix frontend:** Se aumentó el `max-width` del contenedor a 1600px (era 1400px) para aprovechar pantallas modernas sin comprimir información.

#### Filtros de auditoría — categorías mejoradas

- **Fix frontend:** Las opciones de filtro por categoría ahora incluyen todas las categorías nuevas (`integración`, `correo`, `autenticación`, `entrada`, `checklist`, `escalación`, `configuración`) en el selector de categoría del formulario de búsqueda.

### Validación Técnica

- Se validó correctamente la compilación de TypeScript sin errores de tipado.
- Se verificó que el método `getActionCategoryLabel()` retorna etiquetas legibles en español.
- Se testing visual de los badges de categoría con contraste correcto en temas claro/oscuro.

### Auditoría — ajuste final de legibilidad operativa (B46+)

#### Tabla de auditoría — razón visible sin cortar y tooltip útil

- **Fix frontend:** La columna **"Tipo / Razón / Detalles"** fue ajustada para priorizar lectura operativa continua, aumentando ancho mínimo, permitiendo wrap real del texto y mejorando el espaciado vertical de la descripción.
- **Fix frontend:** El tooltip dejó de depender del `json` crudo del log y ahora se alinea con el texto procesado mostrado en pantalla, evitando exponer payloads técnicos poco útiles al operador.
- **Fix frontend:** El contenedor de razón quedó preparado para mostrar textos largos sin colapsar el badge de categoría, mejorando lectura de eventos extensos como correo, escalación y entradas.

#### Tabla de auditoría — limpieza de metadata y detalle expandido

- **Fix frontend:** Se incorporó limpieza de metadata para descartar estructuras serializadas no legibles como buffers de `ObjectId` provenientes de MongoDB, manteniendo solo contexto útil para operación.
- **Fix frontend:** Se añadió vista expandible por fila para revisar el detalle completo del evento sin truncamiento, incluyendo razón completa, metadata filtrada y datos de request/actor cuando existen.
- **Resultado operativo:** El módulo de auditoría ahora permite validar con claridad si el contenido mostrado es completo o resumido, sin depender de tooltips con binarios o JSON irrelevante.

### Reporte de turno — PoC como vista previa real del turno (B47)

#### Correo PoC — vista previa con datos reales del turno seleccionado

- **Fix backend:** `sendShiftReportPoc()` dejó de enviar un correo vacío y ahora genera una **vista previa real** del correo de fin de turno usando checklist y entradas del turno correspondiente a la fecha/hora de referencia.
- **Fix backend:** La PoC reutiliza la misma lógica de cálculo de ventana temporal del envío productivo, incluyendo turnos que cruzan medianoche, búsqueda de checklist de inicio/cierre y recorte de entradas dentro del período efectivo.
- **Regla funcional:** Si el turno sigue en curso, la vista previa muestra lo acumulado hasta el momento de ejecución; si ya terminó, muestra lo registrado dentro de ese turno para la fecha evaluada.
- **Fix backend:** El bloque **"Entradas por tipo"** se mantiene visible en la PoC y se alimenta con los datos reales del período; si no hubo entradas, se muestra igualmente con contadores en cero.
- **Seguridad operativa:** La PoC no registra envío productivo ni actualiza `lastReportSentAt`, por lo que puede usarse repetidamente para validar formato, contenido y canal SMTP sin alterar el flujo real de fin de turno.

#### UI de administración de turnos — semántica corregida del botón PoC

- **Fix frontend:** Los textos del panel de administración de turnos fueron actualizados para reflejar que el botón envía una **vista previa auditada** con datos reales del turno, no una prueba vacía.
- **Fix frontend:** El mensaje de confirmación posterior al envío también fue ajustado para comunicar explícitamente que se trató de una vista previa PoC del reporte.

## [v1.5.21-beta] - 2026-03-17

### Correcciones de Bugs (B42 / B43 / B44)

#### Report Generator — nitidez de evidencia en correo (B42)

- **Fix frontend:** Se mejoró el render de imágenes de evidencia en `frontend/src/app/pages/main/report-generator/report-generator.component.ts` manteniendo intacto el formato técnico de la tabla (ancho fijo y estructura).
- Las imágenes ahora guardan dimensiones reales al cargarse y se renderizan evitando upscaling innecesario (se usa el mínimo entre ancho técnico y ancho nativo), preservando proporción.
- Cada evidencia queda enlazada a su fuente inline para permitir apertura en mayor detalle sin romper el layout del reporte copiado.

#### Reporte de turno — refactor a MJML y dashboard escaneable (B43)

- **Fix backend:** `generateReportHTML()` en `backend/src/utils/shift-report.js` fue migrado de HTML concatenado manual a plantilla MJML compilada en runtime con validación estricta.
- Se incorporó header rediseñado con branding dinámico (`appTitle`) y favicon opcional (`AppConfig.faviconUrl`).
- Se añadió sección de **Resumen Ejecutivo** con conteos visuales de `OK`, `NO OK` y `Entradas`.
- El checklist pasó de tabla plana a bloques/tarjetas por servicio con columnas visuales de Entrada/Salida para lectura rápida.
- La bitácora pasó de lista simple a bloques independientes con jerarquía visual (cabecera temporal, metadatos y contenido).
- Observaciones en checklist se muestran solo cuando existe contenido (se elimina ruido visual por campos vacíos).

#### Reporte de turno — estado REPARADO en salida (B44)

- **Fix backend (mismo módulo):** Se implementó estado `REPARADO` (amarillo) solo en columna de salida cuando se cumple: entrada `rojo` y salida `verde`.
- La comparación se limita a casos donde checklist de inicio/cierre corresponde al mismo contexto (prioridad por `checklistId`; fallback por nombre normalizado).
- Regla preservada: si salida es `rojo`, siempre se muestra `ERROR` independientemente del estado de entrada.

#### Reporte de turno — ajustes de legibilidad y consistencia operativa

- **Fix backend:** Se eliminó el símbolo `🛡️` del título del correo para evitar ruido visual en clientes de correo.
- **Fix backend:** Header del reporte ajustado a paleta clara para mejorar visibilidad del favicon/logo corporativo.
- **Fix backend:** Se aumentó spacing/padding del bloque **Resumen Ejecutivo** para evitar que quede pegado a márgenes.
- **Fix backend:** El checklist del correo ahora respeta el orden operativo original de los servicios en lugar de ordenarlos alfabéticamente.
- **Fix backend:** Se excluyen ítems padre (agrupadores) del render y del cálculo de `NO OK`, evitando conteos inflados cuando el estado rojo proviene de hijos.
- **Fix backend:** La misma exclusión de ítems padre se aplicó al fallback de texto plano para mantener consistencia con HTML.

### Operación de Turnos (B45)

#### Correo de fin de turno diferido hasta checklist de cierre real (B45)

- **Fix backend:** El trigger automático de fin de turno ahora difiere el envío cuando aún no existe checklist de cierre y registra estado `PENDIENTE_POR_CIERRE` en lugar de enviar un reporte incompleto.
- **Fix backend:** En el trigger manual (al guardar checklist de cierre), la búsqueda de cierre se extiende hasta la hora real del disparo, permitiendo cierres tardíos fuera de la hora fin del turno.
- **Fix backend:** Se reforzó la trazabilidad operativa en scheduler y ruta de checklist con estados explícitos `PENDIENTE_POR_CIERRE` y `ENVIADO_DIFERIDO`.
- **Control de duplicados:** Se mantiene protección por `lastReportSentAt` para evitar doble despacho cuando conviven trigger automático y diferido.

#### Correo de turno — resumen por tipo de entrada (Operativa / Ofensa / Incidente)

- **Fix backend:** Se agregó bloque visual **"Entradas por tipo"** bajo la sección de checklist en el correo de turno, con 3 contadores fijos: `Operativa`, `Ofensa` e `Incidente`.
- **Ajuste visual final:** El bloque superior del correo quedó consolidado como **"Resumen Checklist"** y ambos resúmenes (`Resumen Checklist` + `Entradas por tipo`) usan layout de cajones con número grande y título inferior para lectura operativa rápida.
- **Regla funcional:** No se agrega categoría "Otros"; el resumen está acotado explícitamente a los 3 tipos operativos soportados por el modelo de entradas.
- **Robustez de conteo:** Se incorporó normalización/canonización de `entryType` (case/acento/plural) para mantener conteo correcto en escenarios históricos o importados (`operativa/operativas`, `ofensa/ofensas`, `incidente/incidentes`).

#### Correo de turno — robustez de disparo en cierre y scheduler

- **Fix backend (scheduler):** El envío automático dejó de depender del minuto exacto de `endTime` y ahora utiliza una ventana de tolerancia configurable (`SHIFT_REPORT_TOLERANCE_MINUTES`, default 10 min) para evitar pérdidas de disparo por desfases operativos.
- **Fix backend (trigger por cierre):** Al guardar checklist de `cierre`, el disparo manual usa `check.createdAt` como referencia temporal del reporte (en lugar de `new Date()`), mejorando correlación con el evento real registrado.

### Operación de Turnos (OPS-ASSIGN-011)

#### Asignaciones de turno aparentaban perderse tras deploy/reinicio

- **Fix backend:** `GET /api/work-shifts/current` ahora resuelve el analista activo desde la colección real `WorkShiftAssignment` considerando turno, día efectivo, vigencia (`validFrom`/`validTo`) y zona horaria, en lugar de depender del campo legacy `assignedUserId` embebido en `WorkShift`.
- **Fix backend:** El cálculo de asignaciones activas contempla correctamente turnos que cruzan medianoche, resolviendo el weekday operativo efectivo antes de filtrar recurrencia por días.
- **Fix backend:** El payload del turno actual vuelve enriquecido con `assignedUserIds`, `assignedUsers`, `assignedUserId`, `assignedUserName`, `assignedUserEmail` y `assignedUsersCount` ya reconstruidos desde la fuente real.
- **Fix frontend:** La columna `Asignado a` en Admin Turnos dejó de ocultarse según `shift.assignedUserId` y pasó a renderizarse desde el resumen real construido con las asignaciones operativas cargadas por API.
- **Diagnóstico validado:** Se comprobó contra la base real que las asignaciones seguían persistidas tras reinicio; el problema era de lectura/resolución post-deploy, no de borrado físico de `WorkShiftAssignment`.

### Ajustes UI Operativos (Checklist / Notas / Alertas)

#### Checklist — comportamiento del acordeón principal

- **Fix frontend:** El panel principal del checklist vuelve a iniciar cerrado por defecto y solo cambia su estado cuando el usuario lo abre/cierra manualmente.
- **Fix frontend:** Se eliminó la apertura forzada al recargar/cambiar tipo de checklist para evitar comportamiento inesperado en operación.

#### Notas laterales — convivencia con trabajo operativo

- **Fix frontend:** El panel derecho de notas se mantiene visible sin bloquear interacción del contenido principal (checklist, entradas, formularios) al remover el backdrop de bloqueo en el contenedor principal.
- **Fix frontend:** Se desactivó el auto-focus agresivo del panel de notas para evitar pérdida de foco al usuario durante la edición operativa.
- **Fix frontend (escritorio):** Se ajustó el desplazamiento del contenido con notas abiertas para priorizar uso en PC y conservar mejor área útil de trabajo.
- **Fix frontend (escritorio final):** El panel de notas quedó en modo lateral `side` (comportamiento equivalente al menú izquierdo), con botón de cierre interno y recalculo automático de ancho del contenido (`autosize`) al abrir/cerrar.

#### Alerta especial de escalamiento — contraste de color

- **Fix frontend:** El diálogo de alerta especial migró de colores hardcodeados a variables del sistema de temas (`--text-primary`, `--text-secondary`, `--state-warning`, `--state-warning-bg`) para corregir contraste en modo oscuro y mantener consistencia visual en todos los temas.

### Dependencias / Compatibilidad

- **Backend:** Se agregó dependencia `mjml` en `backend/package.json` para compilación de correos compatible con clientes como Outlook/Gmail.

### Validación Técnica

- Se ejecutó validación de runtime de `generateReportHTML()` con compilación MJML exitosa (`OK_MJML`).

## [v1.5.20-beta] - 2026-03-17

### Correcciones de Bugs (B35 / B36 / B39 / B40 / B41)

#### Checklist — Estado derivado de ítems padre (B39)

- **Fix backend:** El endpoint `POST /api/checklist/check` ya no exige `observation` en nodos padre cuando su estado es `rojo` derivado de sus hijos. La validación de observación ahora aplica **solo a nodos hoja** (sin hijos definidos en la plantilla).
- **Fix frontend:** El estado de un ítem padre se deriva automáticamente desde el estado de sus hijos (rojo si alguno está en rojo, verde si todos están en verde, pendiente si alguno no ha sido respondido). El padre ya no muestra campo de estado ni observación manual.

#### Catálogo / Generador de reporte — Búsqueda de ofensas cortas (B40)

- **Fix backend:** Corregido error `Invalid $project :: caused by :: Cannot do exclusion on field _score in inclusion projection` en el pipeline de agregación de `GET /api/catalog/events`. El campo `_score` utilizado para ranking ya no se incluía explícitamente en el `$project`, causando que MongoDB rechazara la consulta al mezclar inclusión y exclusión.
- Resultado: búsquedas con términos cortos como `TOR` ahora retornan correctamente el evento rankeado como primera coincidencia.

#### Recuperación de contraseña — URL incorrecta en email (B41)

- **Fix backend:** El link de reset enviado por email usaba el valor hardcodeado `https://localhost:4200`, con protocolo y puerto incorrectos e inaccesible desde clientes reales.
- **Solución:** Creado nuevo módulo utilitario `backend/src/utils/frontend-url.js` con resolución dinámica de la URL del frontend en el siguiente orden de prioridad:
  1. Variable de entorno `FRONTEND_URL` (override explícito, opcional).
  2. Header `Origin` de la request (fuente principal — siempre contiene el host/IP/protocolo exacto desde el que el usuario accedió).
  3. Header `Referer` de la request.
  4. `HOST_DOMAIN` + detección de protocolo via `X-Forwarded-Proto` / `req.secure`.
- **Corrección automática de puerto:** Si el protocolo detectado es `https:` pero el puerto corresponde al puerto HTTP del frontend (o viceversa), el módulo corrige automáticamente al puerto correspondiente (`FRONTEND_HTTPS_PORT` / `FRONTEND_PORT`).
- La variable `FRONTEND_URL` queda comentada por defecto en `.env.example` — la detección automática via `Origin` cubre el 100% de los casos de uso normales sin configuración adicional.

#### Checklist — Header y último check real (B35)

- **Fix frontend:** El título principal de `/main/checklist` se fijó como **"Checklist del Turno"** y el nombre de la plantilla activa quedó como subtítulo contextual.
- **Fix frontend:** El panel de evaluación deja de mostrar texto hardcodeado y usa el nombre real de la plantilla activa (`activeChecklist?.name`) con fallback seguro.
- **Fix backend:** `GET /api/checklist/check/last` ahora retorna el último check global del equipo (ordenado por `createdAt`), corrigiendo el caso donde se mostraba un registro antiguo por filtrar solo por usuario autenticado.

#### Layout principal — Mejor uso de ancho en escritorio (B36)

- **Fix UI/UX:** El cajón derecho de notas cambió a `mode="over"` para evitar comprimir permanentemente el contenido principal.
- **Fix UI/UX:** Se incorporó clase dinámica `.with-notes-open` en el contenedor principal para aplicar `margin-right` solo cuando el panel de notas está abierto, evitando solapamiento visual.
- **Fix UI/UX:** Se eliminó la restricción `max-width: 900px` del checklist para aprovechar mejor pantallas grandes y mantener comportamiento responsive.

## [v1.5.19-beta] - 2026-03-11

### Reparaciones Críticas (Post-Reinicio Docker)

- **Fix SSL (B37):** Implementación de "Hot Reload" en `SNICallback`. El servidor ahora intenta recargar certificados en caliente tras un reinicio de Docker si detecta que el contexto criptográfico se ha perdido.
- **Fix API assignments (B38):** Se corrigió un conflicto de rutas que causaba un error 400 al cargar turnos. Se reordenaron las rutas en el backend y se ajustó el frontend para usar un endpoint específico `/api/work-shift-assignments`.

### Automático

- Sincronización de versión basada en iteraciones de Git (199 commits totales).

## 2026-03-10

### Interfaz / Login (Cyber v3.5 - Matrix Redesign)

- **Rediseño del Tema Cyber (Legacy Infoflow):** Se reconstruyó el tema de login inspirado en Matrix/Cyberpunk con un enfoque de **Estructura de Alto Contraste**.
- **Estrategia de Visibilidad Nuclear:** Ante problemas de caché y herencia CSS, se implementó una estrategia de especificidad máxima (`body & .cy-* !important`) que garantiza que todo el texto sea **blanco puro (#ffffff)** o **verde neón (#00ff41)** sobre fondos **negro sólido (#000000)**, eliminando la invisibilidad de mensajes de información y errores.
- **Renombramiento de Clases (Cache-Busting):** Se migraron todos los selectores de `if-` a `cy-` para invalidar versiones antiguas del CSS en los navegadores de los usuarios finales.
- **Branding Dinámico en Login:** El título de la página de login ahora se sincroniza automáticamente con el campo "Título barra superior" de la configuración de Branding en el panel de administración.
- **Animación de "Typing":** Se añadió un efecto de escritura en tiempo real para el subtítulo del tema Cyber, mejorando la estética premium del portal.
- **Refactorización de UX Manual (Feedback Usuario):** El toggle de visibilidad de contraseña se cambió de iconos/emojis a etiquetas de texto puro (`[VER]` / `[OCULTAR]`) para mantener la coherencia con el estilo de terminal retro. Se simplificó la interfaz eliminando iconos redundantes en los campos de usuario y contraseña.
- **Selección de Texto Forzada:** Se sobreescribió el color de selección del navegador para que el resaltado sea blanco-sobre-negro dentro del portal de login.

### Backend / Configuración

- **Corrección en API de Logo/Config:** Se arregló un bug crítico en `GET /api/config/logo` que causaba que el sistema ignorara el tema guardado en la DB cuando no había un logo cargado, forzando erróneamente el tema 'CRT'.
- **Integración de AppTitle en Login:** El endpoint de configuración base ahora expone el `appTitle` para evitar llamadas redundantes al cargar el portal.

## 2026-03-06

### Infraestructura / Arquitectura (Upgrade)

- **Migración a Node 24 LTS (Cero Tiempo de Inactividad):** Se actualizó el núcleo completo del sistema. Las imágenes de Backend saltaron de `node:18` (Fin de Vida) a `node:24-alpine` con el nuevo compilador Alpine/musl-libc. El Front-end Builder saltó de `node:20` a `node:24-alpine`. Las librerías críticas en C++ (`bcryptjs`, driver nativo de `mongoose 8`) compilaron exitosamente bajo esta nueva arquitectura sin causar fugas de memoria o timeouts en MongoDB.
- **Migración a Express 5.1 LTS:** Se actualizó el framework web de `express@4.18` a `express@5.1.0`. Se corrigió la ruta wildcard del SPA fallback (`*` → `/*splat`). Se actualizó `multer` a la versión `2.1.1` (corrige CVE-2025-47935 y CVE-2025-47944 de DoS) y `helmet` a la versión `8.0.0`. No se requirió ningún otro cambio de código gracias a que el proyecto no usaba APIs deprecadas. Express 5 aporta manejo automático de errores async y mejoras de seguridad.

### Backend / Admin (Backup & Restore)

- **Backup ZIP Completo (Full System Backup):** Se rediseñó completamente el sistema de backup y restauración. El endpoint `POST /api/backup/create` ahora produce un único archivo **`.zip`** que contiene: (1) un `data.json` con las 24 colecciones de MongoDB, (2) la carpeta `/uploads` completa (logos, imágenes), y (3) los certificados SSL de `/secrets` que sean legibles. El endpoint `POST /api/backup/restore` fue actualizado para descomprimir el ZIP y restaurar tanto la base de datos como los archivos físicos. Se mantiene compatibilidad con backups `.json` legacy. Se agregaron las dependencias `archiver` y `unzipper` al `package.json`.

### Sistema / Despliegue (Factory Reset & Seed)

- **Factory Reset Profundo (Purgar Todo):** Se modificó la ruta `POST /api/backup/purge`. Ahora, además de limpiar lógicamente todas las colecciones de MongoDB, el sistema vacía físicamente los directorios montados como volúmenes Docker (`/uploads`, `/logs`, `/backups`, `/secrets`) para evitar dejar archivos huérfanos. Se mantuvo intacto el funcionamiento interno de `.wt` de MongoDB para prevenir corrupción.
- **Script Exclusivo de Admin (`seed-admin.js`):** Se creó un nuevo script de inyección (`backend/src/scripts/seed-admin.js`) diseñado para entornos de producción. A diferencia de `seed.js`, este script inicializa **únicamente** al usuario Administrador Maestro leyendo explícitamente las credenciales del `.env`, sin inyectar datos genéricos de prueba (turnos, clientes, checklists, etc.), manteniendo la base de datos totalmente limpia.
- **Actualización de Documentación (`DEPLOY.md`):** Se actualizó la guía de instalación rápida para reflejar claramente las dos opciones de inicialización de Base de Datos para los administradores: Opción de Producción (solo admin) vs Opción de Pruebas (datos genéricos).

## 2026-03-04

### Seguridad / Interfaz TLS (HTTPS)

- **Zero-Leak TLS Storage:** Los certificados SSL y llaves criptográficas ahora están estrictamente confinados en código a la subcarpeta aislada `/app/secrets`, enlazada por un volumen seguro (`docker-compose.yml`), eliminando por completo cualquier posibilidad de fuga de llaves privadas hacia las carpetas estáticas o públicas del sistema.
- **Validación Criptográfica Profunda:** En vez de análisis ingenuos (como buscar "BEGIN" en el archivo), el backend Node.js ahora emplea nativamente `tls.createSecureContext` de forma simulada _antes_ de aceptar un certificado y una llave. Archivos erróneos o protegidos por contraseña son bloqueados al vuelo con código HTTP 400.
- **Hot-Reloading sin Downtime (SNICallback):** El socket maestro HTTPS adopta el `SNICallback` dinámico de Node. Al reemplazar los archivos SSL/TLS desde la UI, el backend extrae el nuevo par de llaves y reemplaza la memoria criptográfica subyacente del listener instantáneamente (menos de un milisegundo) sin necesidad de asesinar procesos OS, ni desconectar a los clientes que estén navegando concurrentemente.
- **UI Simplificada y Drag&Drop:** El formulario "HTTPS / Seguridad" consolida la habilitación SSL en una simple carga de pares de archivos (`cert`, `key` y opcionalmente `ca`), desechando la antigua modalidad riesgosa de especificar rutas manuales del servidor que requerían conocimientos de CLI.
- **Seguridad en Redirección e Interacciones Proxy:** Reforzado el switch `forceHttps` con soporte transparente para balanceadores o proxies inversos que operan por encima (`X-Forwarded-Proto`). También las fronteras de CORS encriptan la comunicación exponiendo la variable de Retry si y sólo si el TLS es seguro.
- **Auto-Reinicio Inteligente Local:** Se reemplazó el reinicio manual de comandos por un sistema de _Long Polling_ en el Frontend (`start-dev.js`). El entorno de desarrollo Angular ahora consulta silenciosamente al backend cada 5 segundos y se auto-reinicia dinámicamente inyectando o removiendo el flag `--ssl` según los certificados activos.
- **Exterminador de Puertos Zombie Windows:** Se implementó una rutina de limpieza agresiva con `taskkill /pid [PID] /f /t` exclusiva para Windows en el script `start-dev.js`, garantizando que el puerto `4200` y todo el árbol de procesos huérfanos de Node/Angular se liberen al 100% durante los auto-reinicios, eliminando errores de puertos ocupados (`EADDRINUSE`).
- **Feedback UI en Vivo (Cuenta Regresiva):** Se inyectó un timer reactivo dentro de los botones de la consola "HTTPS / Seguridad". Al guardar configuración de puertos, borrar certificados o subir nuevos certificados SSL (0-Downtime), ahora la UI bloquea la pantalla y muestra una cuenta regresiva animada de 15 segundos en el propio botón antes de redirigir mágicamente al navegador hacia las rutas correspondientes (`http://` o `https://`).
- **Corrección de Condición de Carrera Asíncrona:** Se arregló un bug visual (`ERR_EMPTY_RESPONSE`) ajustando la lectura de éxito desde el frontend hacia el estado de persistencia `httpsEnabled` del Payload, ignorando el estado volátil `httpsReady` ya que la instanciación criptográfica del núcleo Node.js TLS es naturalmente asíncrona la primera vez.

### Operación / Turnos (OPS-ASSIGN)

- **Asignaciones Operativas de Turnos Granulares:** Creado nuevo módulo que permite asignar a usuarios a turnos específicos seleccionando días de la semana activos en particular (ej. Turno Noche solo los Lunes, Miércoles y Viernes).
- Añadido soporte real de Zona Horaria (`moment-timezone`) para el cálculo inteligente del turno en curso, validando la hora local del lugar configurado en vez de la del servidor (`/api/work-shifts/current`).
- Se agregó componente UI para asignar múltiples días (Lunes a Domingo) en la grilla visual de turnos.
- Implementación de estado reactivo en UI vía Observers (`interval`) para no tener que refrescar manualmente la página al evaluar si el analista entra en turno.
- Refactorizada fuertemente la gestión de turnos retirando del `WorkShift` el arreglo duro `assignedUserIds` e introduciendo el modelo `WorkShiftAssignment`.
- Adaptado el cálculo frontend de horas (`isShiftActiveNow`, `timeToMinutes`) en la utilidad centralizada `/utils/shift-time.util.ts`.
- Añadidas validaciones anti-solapamiento estrictas a nivel de backend para rechazar explícitamente cuando a un usuario se le asignan dos turnos cruzados o empalmados físicamente el mismo día.

## 2026-03-03

### Registro (16:42 - UTC 0 )

- Se consolidaron los cambios funcionales B29/B30/B31/B32/B33 en backend, frontend y documentación operativa.

### Operación / Turnos (B29-B30)

- Se agregó módulo de asignación operativa en Admin de Turnos para vincular analista ↔ turno bajo la tabla principal.
- Se implementó estado operativo en vivo (`EN TURNO` / `FUERA DE TURNO`) con evaluación de horario y soporte de cruce de medianoche.
- Se incorporó resumen por períodos en Escalación Interna: mes actual, mes anterior en acordeón e histórico bajo demanda con filtros (`fromDate`, `toDate`, `limit`) en backend/frontend.

### Escalación / Datos (B31)

- Se consolidó Escalación sobre `CatalogLogSource` como fuente única de clientes habilitados.
- Se agregó limpieza en cascada al eliminar Log Sources (servicios, contactos, reglas de escalación y entradas RACI asociadas).
- Se incluyó script de migración `migrate-escalation-clients-to-log-sources` y script npm en backend para ejecutar la migración.

### Usuarios / Segmentación (B32)

- Se extendió modelo y CRUD de usuarios con campo `cargoLabel`, validaciones, índice y soporte de cargos base + cargo personalizado.
- Se agregó rol `auditor` en validaciones y formularios administrativos.
- Se incorporó columna de cargo en listado de usuarios y exposición de cargo en `/api/users/list` para consumo en módulos operativos.

### Recordatorio Escalación Interna (B33)

- Se reemplazó el enfoque semanal complejo por recordatorio simple diario por cargos configurados.
- Se movió la configuración B33 desde Checklist Admin hacia Escalación Interna (activar recordatorio + selección múltiple de cargos).
- Se implementó envío automático por scheduler a usuarios activos con email y `cargoLabel` coincidente.
- Se agregó endpoint de prueba `POST /api/escalation/admin/reminder/test` y botón UI **Probar recordatorio** con feedback de destinatarios.
- Se aseguró visibilidad de catálogo base de cargos (N1/N2/N3, QA, Pentester, Arquitecto SIEM, CSM, Jefatura/Gerencia) aunque no existan usuarios aún en todos los cargos.

### Checklist / Configuración

- Se mantuvo Checklist Admin enfocado en parámetros de checklist (cooldown + alerta/hora) y se retiró de ahí la configuración operativa de B33.
- Se agregaron/normalizaron campos de `AppConfig` para alertas y recordatorios (`escalationReminderEnabled`, `escalationReminderCargoLabels`, `lastEscalationReminderDate`).

### Runtime Frontend / Estabilidad Dev

- Se simplificó `main.ts` para bootstrap standalone limpio y evitar cargas duplicadas de módulos en desarrollo.
- Se ajustó entorno de desarrollo a `apiUrl: '/api'` y se agregó `proxy.conf.json` para `/api` y `/uploads`.
- Se deshabilitó HMR y prebundle en `serve` para mitigar colisiones `NG0912` de IDs de componentes en runtime dev.
- Se agregó script `frontend/scripts/restart-clean.js` para reinicio limpio del puerto `4200` y se reforzó `restart-clean` en backend (validación estricta de puertos).

### Documentación / Control

- Se actualizó `ISSUES.md` marcando B30/B31/B32/B33 como listos y registrando pendientes/alcances de asignación operativa.
- Se actualizaron capturas y referencias visuales en `docs/SCREENSHOTS.md`.
- Se validó compilación de frontend posterior a los cambios de configuración y runtime.

### Registro (realizado por usuario)

- Se consolidó este bloque como cambios ejecutados por el usuario con fecha **03/03**.

### Backend / API

- Se corrigió error interno en backup automático de prueba (`POST /api/backup/test-auto`) ajustando llamadas de auditoría para evitar `500`.
- Se extendió `AppConfig` con `appTitle` para branding dinámico en barra superior.
- Se implementó configuración HTTPS en `AppConfig` (`httpsEnabled`, `forceHttps`, `httpsPort`, certificados TLS) y validación en `PUT /api/config`.
- Se agregó endpoint de carga de certificados TLS por archivo (`POST /api/config/security/certificates`) con soporte para `cert`, `key` y `ca`.
- Se actualizó `server.js` para:
  - cargar configuración HTTPS desde DB al iniciar,
  - iniciar listener HTTPS si está habilitado y con certificados válidos,
  - aplicar redirección forzada a HTTPS solo cuando HTTPS está efectivamente activo,
  - robustecer CORS en producción para transición `http/https` por host.

### Frontend / UI

- Branding:
  - se removió el título fijo lateral,
  - se agregó y conectó título configurable centrado en barra superior,
  - se separó la edición de título en sección propia dentro de Branding.
- Se incorporó fuente personalizada para el título (`Monarchia Momentum`) para todos los temas excepto `cyberpunk`, con fallback de formatos (`woff2`, `ttf`, `otf`).
- Se ajustó tipografía del título superior para mejorar legibilidad:
  - respeto exacto de mayúsculas/minúsculas ingresadas,
  - incremento de tamaño,
  - ajuste de espaciado/weight/altura de toolbar según feedback visual.
- Consola Admin:
  - se creó sección separada **HTTPS / Seguridad** (`/main/admin/security`),
  - se añadió en navegación de `AdminConsole` sin mezclar con SMTP/Branding,
  - se cambió UX de seguridad a estilo Portainer (subida de archivos SSL/TLS en vez de rutas manuales).
- Catálogos:
  - se corrigió contraste de pestañas (`Eventos`, `Log Sources / Clientes`, `Alertas Especiales`, `Tipos de Operacion`) para `light`, `sepia` y `pastel`,
  - se dejó estilo neón específico solo para `cyberpunk`.

### Docker / Deploy

- Se actualizó `docker-compose.yml` para exponer puerto HTTPS de backend y pasar `HTTPS_PORT` por entorno.
- Se actualizaron variables en `.env.example` (`BACKEND_HTTPS_PORT`, `HTTPS_PORT`) y ejemplos de `ALLOWED_ORIGINS` orientados a HTTPS real en producción.
- Se reforzó `DEPLOY.md` con flujo de HTTPS en Docker (persistencia de certificados en volumen, reinicio de backend para aplicar listener TLS y orden seguro para activar `forceHttps`).

### Documentación / Control

- Se restauró `B19` en `ISSUES.md` tras eliminación accidental y se mantuvo fuera del ajuste no solicitado.
- Se mantuvo trazabilidad de cambios con verificación de compilación frontend posterior a modificaciones.

## 2026-03-02

### Plataforma / Arquitectura

- Se consolidó la separación de módulos en Admin: Integraciones SIEM/SOAR/NDR por un lado y GLPI en módulo independiente (`/main/admin/glpi`).
- Se dejó documentado y alineado el modelo de múltiples conectores simultáneos para SIEM (`udp/tcp/tls/http`).

### Documentación

- Se reforzó en README el estado del proyecto como **BETA** y se ajustó el mensaje de uso en producción.
- Se agregó en README un bloque de versiones declaradas y exactas para Angular, Express y Mongo (Mongoose).
- Se agregó en README un resumen de estado actual con cambios recientes (Admin unificado, GLPI separado, SIEM multi-conector, backups y auditoría).
- Se removió en README una referencia redundante de documentación para evitar duplicidad.
- Se actualizó la documentación de API para reflejar endpoints vigentes de Backup, Logging (multi-config) y GLPI.
- Se actualizó la documentación de arquitectura con mapa de módulos Admin y flujo de integraciones (SIEM multi-conector + GLPI separado).
- Se actualizó SETUP con advertencia beta, checklist post-instalación y requisito de tokens en GLPI modo API.
- Se actualizó ISSUES removiendo `SEC-STD-009` de pendientes.
- Se creó este `docs/CHANGELOG.md` y se enlazó desde README para trazabilidad de cambios.

### UI / Frontend

- En Integraciones se removió la frase redundante sobre GLPI como módulo separado.
- En módulo GLPI se agregó validación para bloquear guardado en modo API cuando faltan tokens.
- Se verificó compilación del frontend posterior a los cambios de validación y documentación.

### Backend

- Se agregó validación server-side en GLPI (`PUT /api/glpi/config`) para exigir tokens en modo API.
- Se reparó `backend/src/routes/reports.js` para corregir errores de sintaxis y restaurar handlers de reportes.
- Se normalizó flujo de validación para conservar configuración segura cuando existen tokens cifrados previamente y no se reenvían en el payload.

### Operación / Estabilidad

- Se realizó saneamiento de procesos sobre puerto `3000` para eliminar listeners residuales durante pruebas.
- Se revalidó arranque del backend tras los fixes críticos de rutas de reportes.

### Verificación de historial Git (main/develop)

- Se revisó historial y diferencias de ramas para validar trazabilidad de cambios visuales y de navegación admin.
- En este repositorio local no existe rama `develop` con ese nombre exacto; las ramas observadas fueron `main`, `Development-update` y `Developmen-update`.
- Comparación directa:
  - `main..Development-update`: 1 commit adicional (`84e6e09`, "Multiples cambios").
  - `Development-update..main`: sin commits.
  - `main` y `Developmen-update`: sin diferencias.

### Historial relevante confirmado (previo)

- **Tema Cyberpunk/Neon**: ajustes de paleta/tokens, tipografías y estilos neon confirmados en `frontend/src/styles.scss` (incluido en `84e6e09`).
- **Mejoras Dark Mode**: commits previos de contraste/legibilidad detectados en historial (`da9e5d1`, `9fcf7f1`, `9a86aaa`).
- **Orden/Consola Admin**: consolidación de menú y rutas en `/main/admin` con consola unificada (`frontend/src/app/pages/main/main-layout.component.ts`, `frontend/src/app/pages/main/main.module.ts`, `frontend/src/app/pages/main/admin-console/*`) incluida en `84e6e09`.
- **Tema login estilo CRT/Cyberpunk**: registrado en historial previo (`05093c8`).
