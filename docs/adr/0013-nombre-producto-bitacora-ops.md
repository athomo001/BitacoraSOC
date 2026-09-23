---
status: accepted
---

# El producto pasa a llamarse "Bitácora Ops"

"BitacoraSOC" describía lo que el sistema era: la bitácora de turnos de un SOC de ciberseguridad. El rewrite suma NOC (territorio, activos, contratas, cuadrillas), ticketera ITIL nativa y un motor de escalación común a ambos, así que el nombre quedó chico. Se evaluó quedarse solo con "Bitácora" (demasiado genérico) y nombres nuevos sin herencia (Vigía, Atalaya, Relevo). **Decisión del dueño: "Bitácora Ops"**. Conserva el nombre que los analistas ya conocen y dice "operaciones" en vez de un solo tipo de centro.

**Alcance del cambio: solo lo visible.** Se renombran el título del navegador, el asistente de setup, los 6 temas de login, el aviso de privacidad, los asuntos de correo y el issuer TOTP que muestra la app autenticadora (las cuentas ya enroladas conservan su etiqueta vieja, y el código sigue siendo válido). **No se renombran**, a propósito, los identificadores internos: la ruta del módulo Go (`github.com/athomo001/BitacoraSOC/backend-go`), el repositorio, los contenedores/red/volumen `bitacora-*`, la base `bitacora` ni la clave `bitacorasoc.token` de `localStorage`. Cambiarlos no le aporta nada al usuario, rompe imports, volúmenes y sesiones abiertas, y se puede hacer después por separado si alguna vez hace falta. El release del corte (Fase 14) sigue siendo `v2.0.0`, ahora de Bitácora Ops.
