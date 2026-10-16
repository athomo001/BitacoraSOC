# Correos de la app

Un archivo por cada tipo de correo que envía Bitácora Ops, con datos de ejemplo. Se abren con doble clic en el navegador y se ven como le llegan a la persona. Las imágenes están en `img/` (en el correo real van adentro del mensaje).

**El logo sale de la marca** (Administración → Marca): `img/logo-marca` es el mismo en todos los correos que lo llevan, y `img/logo-marca-informe` es su versión con contorno para el informe de incidente. Los correos reales leen la marca al enviarse: si se cambia el logo o el nombre de la app, cambia en todos los correos desde el siguiente envío, sin tocar código. Esta carpeta, en cambio, es una foto: después de cambiar la marca, se vuelve a generar.

Los genera `backend-go/cmd/mail-previews` con el mismo código que arma los correos reales. **No se editan a mano:** si cambia un correo, se vuelven a generar desde `backend-go/`:

```
go run ./cmd/mail-previews -database-url "postgres://…"
```

Las plantillas están en `backend-go/internal/mailtpl/` (las de la Ticketera, en `backend-go/internal/ticketmail/`). Los correos con el formato del legacy usan sus plantillas tal cual.

| # | Correo | Asunto | Cuándo sale | Formato |
| --- | --- | --- | --- | --- |
| 1 | [Prueba del servidor](01-prueba-servidor.html) | Prueba de Configuracion SMTP - Bitácora CDC | Administración → Correo → Enviar prueba. | HTML |
| 2 | [Informe de incidente](02-informe-incidente.html) | [Bitácora CDC] 5799 (TKT-2026-00042) | Reportes → Informe de incidente → Enviar (al cliente). | HTML |
| 3 | [Boletín de seguridad](03-boletin-seguridad.html) | [Bitácora CDC] Boletín de Seguridad: Vulnerabilidad crítica en VPN SSL | Reportes → Boletín de seguridad → Enviar. | HTML |
| 4 | [Reporte de turno](04-reporte-turno.html) | [Bitácora CDC] Reporte SOC 16-10-2026 Turno A | Al cerrar el checklist de cierre de turno (va a los correos del turno). | HTML |
| 5 | [Checklist con ítems en rojo](05-checklist-en-rojo.html) | [Bitácora CDC] Alerta NOK checklist Turno A (inicio) | Al completar un checklist con un servicio en rojo (alertas de Administración → Checklist). | HTML |
| 6 | [Recordatorio de turno](06-recordatorio-turno.html) | [Bitácora CDC] Recordatorio: revisión de las 14:00 | Administración → Turnos → Recordatorios, a la hora configurada. | HTML |
| 7 | [Dotación (calendario)](07-dotacion-calendario.html) | [Bitácora CDC] Dotación semanal (muestra) - Periodo Semanal: 12-10-2026 - 18-10-2026 | Administración → Turnos → Dotación programada, el día y la hora configurados. | HTML |
| 8 | [Dotación (lista)](08-dotacion-lista.html) | [Bitácora CDC] Dotación semanal (muestra) - Periodo Semanal: 12-10-2026 - 18-10-2026 | Administración → Turnos → Dotación programada, el día y la hora configurados. | HTML |
| 9 | [Cumpleaños](09-cumpleanos.html) | ¡Feliz Cumpleaños Ana Rojas! 🎂 | Una vez al día, a la hora configurada en Usuarios y grupos → Correos de cumpleaños. | HTML |
| 10 | [Recuperar contraseña](10-recuperar-contrasena.html) | Recuperación de Contraseña - Bitácora CDC | Login → ¿Olvidaste tu contraseña? | HTML |
| 11 | [Cambio de contraseña obligatorio](11-cambio-contrasena-obligatorio.html) | [Bitácora CDC] Cambio obligatorio de contraseña | Usuarios y grupos → forzar el cambio de contraseña de una persona. | HTML |
| 12 | [Ticketera: nuevo ticket (copia de respaldo)](12-ticket-equipo-nuevo.html) | [Bitácora CDC] Nuevo ticket TKT-2026-00061 · P1 · Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al crear cada ticket (copia de respaldo). | HTML |
| 13 | [Ticketera: te asignaron](13-ticket-equipo-asignado.html) | [Bitácora CDC] Te asignaron TKT-2026-00061 · P1 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al asignar el ticket a una persona. | HTML |
| 14 | [Ticketera: comentario al cliente](14-ticket-cliente-comentario.html) | [Bitácora CDC] TKT-2026-00061 · Nuevo comentario: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al comentar al cliente. | HTML |
| 15 | [Ticketera: te sumaron como resolutor](15-ticket-equipo-resolutor.html) | [Bitácora CDC] Te sumaron a TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al sumar un resolutor. | HTML |
| 16 | [Ticketera: venció el SLA de respuesta](16-ticket-equipo-sla-respuesta.html) | [Bitácora CDC] SLA vencido · TKT-2026-00061 · P1 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al vencer el SLA de respuesta. | HTML |
| 17 | [Ticketera: SLA de resolución por vencer](17-ticket-equipo-sla-por-vencer.html) | [Bitácora CDC] SLA al 80 % · TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al llegar al porcentaje de aviso del SLA de resolución. | HTML |
| 18 | [Ticketera: venció el SLA de resolución](18-ticket-equipo-sla-resolucion.html) | [Bitácora CDC] SLA vencido · TKT-2026-00061 · P1 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al vencer el SLA de resolución. | HTML |
| 19 | [Ticketera: ticket reabierto (equipo)](19-ticket-equipo-reabierto.html) | [Bitácora CDC] Reabierto TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al reabrir un ticket. | HTML |
| 20 | [Ticketera: espera de proveedor (equipo)](20-ticket-equipo-espera-proveedor.html) | [Bitácora CDC] En espera de proveedor · TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al pasar a espera de proveedor. | HTML |
| 21 | [Ticketera: ticket resuelto (equipo)](21-ticket-equipo-resuelto.html) | [Bitácora CDC] Resuelto TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al resolver un ticket. | HTML |
| 22 | [Ticketera: ticket unido a otro](22-ticket-equipo-unido.html) | [Bitácora CDC] TKT-2026-00058 se unió a TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al unir un ticket con otro. | HTML |
| 23 | [Ticketera: cambió el cliente](23-ticket-equipo-cliente-cambiado.html) | [Bitácora CDC] Cliente cambiado · TKT-2026-00061 | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al cambiar el cliente de un ticket. | HTML |
| 24 | [Ticketera: al cliente, ticket abierto](24-ticket-cliente-abierto.html) | [Bitácora CDC] TKT-2026-00061 · Abierto: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al abrir un ticket que afecta al cliente. | HTML |
| 25 | [Ticketera: al cliente, espera de proveedor](25-ticket-cliente-espera-proveedor.html) | [Bitácora CDC] TKT-2026-00061 · En espera de proveedor: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al pasar a espera de proveedor. | HTML |
| 26 | [Ticketera: al cliente, se retomó](26-ticket-cliente-retomado.html) | [Bitácora CDC] TKT-2026-00061 · Retomado: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al salir de espera de proveedor. | HTML |
| 27 | [Ticketera: al cliente, resuelto](27-ticket-cliente-resuelto.html) | [Bitácora CDC] TKT-2026-00061 · Resuelto: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al resolver el ticket. | HTML |
| 28 | [Ticketera: al cliente, reabierto](28-ticket-cliente-reabierto.html) | [Bitácora CDC] TKT-2026-00061 · Reabierto: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al reabrir el ticket. | HTML |
| 29 | [Ticketera: al cliente, cerrado](29-ticket-cliente-cerrado.html) | [Bitácora CDC] TKT-2026-00061 · Cerrado: Caída enlace MPLS Temuco | Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: al cerrar el ticket. | HTML |
| 30 | [Agenda: resumen diario](30-agenda-resumen-diario.html) | Tus pendientes de hoy · Viernes 16 de octubre | Los días hábiles a la hora del resumen (08:00 por defecto, Administración → Notificaciones), a quien tiene algo y no lo apagó. | HTML |
| 31 | [Agenda: aviso de vencimiento o atraso](31-agenda-aviso.html) | Atrasada: «Revisión de reglas del SIEM» | Al instante, N días hábiles antes del vencimiento y al atrasarse (solo al responsable), si la persona lo tiene por correo. | HTML |
| 32 | [Recordatorio de un aviso con acuse](32-aviso-con-acuse-recordatorio.html) | Aviso pendiente de lectura: Cambio de horario de turnos desde noviembre | Avisos con acuse → «Recordar a quienes faltan»: va a quienes no lo leyeron. | HTML |
| 33 | [Resumen mensual del área](33-resumen-mensual.html) | Resumen mensual Infraestructura · septiembre 2026 | Mi equipo → Resumen mensual → Enviar por correo (lo envía la jefatura; no sale solo). | HTML |
| 34 | [Escalamiento: aviso por correo](34-escalamiento-aviso.html) | [ALTA] Aviso de incidente - Bitácora Ops | Escalamiento → «Escalar (correo)»: a los integrantes con correo del llamado. | solo texto |
