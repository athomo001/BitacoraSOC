package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ticketmail"
)

// MailSamplesHandler es POST /api/config/smtp/samples (admin): manda una
// muestra de cada correo que envía la app, con datos de ejemplo, solo a los
// correos que se indican. Es para el pendiente 4 (revisar cada correo en
// Outlook y Gmail) sin tener que disparar cada uno a mano. Usa las mismas
// funciones que arman los correos reales: lo que se ve es lo que se envía.
//
// El mismo catálogo arma la carpeta docs/correos (cmd/mail-previews): un
// archivo por tipo de correo, para revisarlos sin buscar en el código.
type MailSamplesHandler struct {
	Queries       *db.Queries
	Crypto        *crypto.Box
	AuditLog      *audit.Logger
	PublicBaseURL string
	Reports       *ReportsHandler
	Dotacion      *DotacionHandler
	Birthdays     *BirthdaysHandler
}

type mailSample struct {
	Name    string
	Subject string
	Text    string
	HTML    string
	Inline  []mail.Inline
	// Slug: el nombre del archivo en docs/correos. When: cuándo sale (para soporte).
	Slug, When string
	// Extra: solo en docs/correos (variantes de la Ticketera, el aviso de
	// escalamiento); la muestra de Administración no los manda.
	Extra bool
	// PlainText: el correo real es solo texto (el HTML es su vista).
	PlainText bool
}

type mailSampleResult struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// maxSampleRecipients: es para revisar en un par de buzones, no un envío masivo.
const maxSampleRecipients = 5

func simpleSample(name, slug, when string, m mailtpl.Mail) mailSample {
	text := m.Text
	if text == "" {
		text = htmlToText(m.HTML)
	}
	return mailSample{Name: name, Slug: slug, When: when, Subject: m.Subject, Text: text, HTML: m.HTML}
}

// samples arma los correos de ejemplo, en el orden de spec/12 §2.1 y luego
// los que llegaron después. extras: también las variantes que solo van a
// docs/correos.
func (h *MailSamplesHandler) samples(ctx context.Context, now time.Time, extras bool) ([]mailSample, []mailSampleResult) {
	brand := branding.Load(ctx, h.Queries, true)
	appTitle := brand.AppTitle
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		loc = time.Local
	}
	now = now.In(loc)
	var out []mailSample
	var failed []mailSampleResult
	add := func(s mailSample, err error) {
		if err != nil {
			failed = append(failed, mailSampleResult{Name: s.Name, Error: err.Error()})
			return
		}
		out = append(out, s)
	}

	add(simpleSample("Prueba del servidor", "prueba-servidor", "Administración → Correo → Enviar prueba.", mailtpl.SMTPTest(appTitle, now)), nil)

	incident, _ := json.Marshal(incidentForm{
		CodigoTicket: "TKT-2026-00042", Ofensa: "5799", TipoOperacion: "Ofensa", NombreEvento: "Offense CRE Rule #110593 \"Nueva Ofensa\"",
		Fecha: now.Format("2006-01-02T15:04:05"), Criticidad: "alta", MotivoEvento: "Intentos de autenticación fallidos repetidos.",
		Observaciones: "La IP de origen corresponde a un nodo TOR.\nSe bloqueó en el borde.", Recomendacion: "Bloquear la IP y forzar el cambio de clave.",
		InformacionAdicional: "312 intentos en 15 minutos.", OrigenConexion: "185.220.101[.]4", Destino: "portal.ejemplo[.]cl",
		ReputacionOrigen: "Maliciosa", EvidenciaTexto: "Captura de la ofensa.", LogSource: "Firewall perimetral",
	})
	const incidentWhen = "Reportes → Informe de incidente → Enviar (al cliente)."
	if rep, err := h.Reports.renderIncident(ctx, reportRequest{Incident: incident}); err == nil {
		add(mailSample{Name: "Informe de incidente", Slug: "informe-incidente", When: incidentWhen, Subject: mailtpl.BrandedSubject(appTitle, "5799 (TKT-2026-00042)"),
			Text: htmlToText(rep.sendHTML), HTML: rep.sendHTML, Inline: rep.inline}, nil)
	} else {
		add(mailSample{Name: "Informe de incidente"}, err)
	}

	bulletin, _ := json.Marshal(bulletinForm{
		TituloBoletin: "Vulnerabilidad crítica en VPN SSL", MarcaFabricante: "Fabricante de ejemplo", CveIdentificadores: "CVE-2026-0001, CVE-2026-0002",
		Criticidad: "crítica", ProductosAfectados: "- VPN SSL 7.0 a 7.4\n- Gestor central 6.x", Impacto: "Ejecución remota de código sin autenticación.",
		Recomendacion: "- Actualizar a la versión corregida.\n- Mientras tanto, restringir el acceso al portal VPN.", Referencias: "https://ejemplo.cl/aviso",
	})
	const bulletinWhen = "Reportes → Boletín de seguridad → Enviar."
	if rep, err := h.Reports.renderBulletin(ctx, reportRequest{Bulletin: bulletin}); err == nil {
		add(mailSample{Name: "Boletín de seguridad", Slug: "boletin-seguridad", When: bulletinWhen, Subject: mailtpl.BrandedSubject(appTitle, "Boletín de Seguridad: Vulnerabilidad crítica en VPN SSL"),
			Text: htmlToText(rep.sendHTML), HTML: rep.sendHTML, Inline: rep.inline}, nil)
	} else {
		add(mailSample{Name: "Boletín de seguridad"}, err)
	}

	start, end := now.Add(-12*time.Hour), now
	check := func(at time.Time, status string) *mailtpl.ShiftChecklist {
		return &mailtpl.ShiftChecklist{CreatedAt: at, ChecklistID: "muestra", ChecklistName: "Checklist SOC", Services: []mailtpl.ShiftService{
			{ServiceID: "1", Title: "Consola SIEM", Status: "verde"},
			{ServiceID: "2", Title: "Firewall perimetral", Status: status, Observation: "Latencia alta en la VPN de respaldo."},
			{ServiceID: "3", Title: "Correo", Status: "verde"},
		}}
	}
	report, err := mailtpl.RenderShiftReport(mailtpl.ShiftReportOptions{
		ShiftName: "Turno A", StartTime: "08:00", EndTime: "20:00", IncludeChecklist: true, IncludeEntries: true,
		Entry: check(start, "rojo"), Exit: check(end, "verde"),
		Entries: []mailtpl.ShiftEntry{
			{EntryType: "operativa", Content: "Revisión de alertas del SIEM sin novedades.", ClientName: "Cliente de ejemplo", CreatedAt: start.Add(time.Hour), Time: start.Add(time.Hour).Format("15:04")},
			{EntryType: "incidente", Content: "Ofensa 5799 escalada al cliente.", ClientName: "Cliente de ejemplo", CreatedAt: start.Add(3 * time.Hour), Time: start.Add(3 * time.Hour).Format("15:04")},
		},
		PeriodStart: &start, PeriodEnd: &end, AppTitle: appTitle, Location: loc,
	})
	add(mailSample{Name: "Reporte de turno", Slug: "reporte-turno", When: "Al cerrar el checklist de cierre de turno (va a los correos del turno).",
		Subject: mailtpl.ShiftReportSubject("Reporte SOC [fecha] [turno]", appTitle, end.Format("02-01-2006"), "Turno A", "20:00"), Text: htmlToText(report), HTML: report}, err)

	add(simpleSample("Checklist con ítems en rojo", "checklist-en-rojo", "Al completar un checklist con un servicio en rojo (alertas de Administración → Checklist).",
		mailtpl.ChecklistNok(appTitle, "ana.rojas", "Turno A", "inicio", []string{"N2"},
			[]mailtpl.NokService{{Title: "Firewall perimetral", Observation: "Latencia alta en la VPN de respaldo."}}, now)), nil)

	add(simpleSample("Checklist no realizado", "checklist-no-realizado", "A la hora configurada (09:30) si nadie hizo el checklist de inicio ese día: a quien está de guardia N1 no hábil y a los N2 (Administración → Turnos → Avisos).",
		mailtpl.ChecklistMissing(appTitle, "09:30", now)), nil)
	monday := targetWeek(now, 7)
	add(simpleSample("Guardia sin cubrir", "guardia-sin-cubrir", "Desde las 09:00, si la semana que empieza en 7 días tiene una guardia marcada sin nadie: a los N2 (Administración → Turnos → Avisos).",
		mailtpl.GuardUncovered(appTitle, []string{"N2"}, monday, monday.AddDate(0, 0, 6), int(monday.Sub(now).Hours()/24)+1, []string{"N2"}, now)), nil)

	add(simpleSample("Recordatorio de turno", "recordatorio-turno", "Administración → Turnos → Recordatorios, a la hora configurada.",
		mailtpl.ShiftReminder(appTitle, "Recordatorio: revisión de las 14:00",
			"Recordatorio de la revisión de mitad de turno:\n\n- Revisar la consola del SIEM\n- Confirmar los respaldos de la noche\n- Actualizar la bitácora")), nil)

	for _, format := range []struct{ name, slug, value string }{{"Dotación (calendario)", "dotacion-calendario", "calendar"}, {"Dotación (lista)", "dotacion-lista", "list"}} {
		m, err := h.Dotacion.buildDotacionMail(ctx, db.WorkShiftNotificationSchedule{Name: "Dotación semanal (muestra)", Timezone: "America/Santiago", TargetPeriod: "current_week", EmailFormat: format.value})
		add(mailSample{Name: format.name, Slug: format.slug, When: "Administración → Turnos → Dotación programada, el día y la hora configurados.",
			Subject: m.subject, Text: htmlToText(m.html), HTML: m.html, Inline: m.inline}, err)
	}

	bday, inline := h.Birthdays.birthdayMail(ctx, "Ana Rojas")
	add(mailSample{Name: "Cumpleaños", Slug: "cumpleanos", When: "Una vez al día, a la hora configurada en Usuarios y grupos → Correos de cumpleaños.",
		Subject: bday.Subject, Text: htmlToText(bday.HTML), HTML: bday.HTML, Inline: inline}, nil)

	add(simpleSample("Recuperar contraseña", "recuperar-contrasena", "Login → ¿Olvidaste tu contraseña?",
		mailtpl.PasswordRecovery(strings.TrimRight(h.PublicBaseURL, "/")+"/reset-password?token=ejemplo-no-valido", appTitle)), nil)
	add(simpleSample("Cambio de contraseña obligatorio", "cambio-contrasena-obligatorio", "Usuarios y grupos → forzar el cambio de contraseña de una persona.",
		mailtpl.ForcedPasswordChange(appTitle, "Ana Rojas")), nil)

	if s, err := h.Queries.GetTicketSettings(ctx); err == nil {
		settings := mailSettings(s)
		settings.TeamLink = true
		base := strings.TrimRight(h.PublicBaseURL, "/")
		ticket := ticketmail.TicketData{
			Number: "TKT-2026-00061", Title: "Caída enlace MPLS Temuco", Priority: "p1_critical", Status: "in_progress",
			ClientName: "Cliente de ejemplo", TeamName: "Redes", Responsible: "ana.rojas", CreatedBy: "beto.soto",
			CreatedAt: now.Format("02-01-2006 15:04"), ResolutionDue: now.Add(8 * time.Hour).Format("02-01-2006 15:04"),
			TeamURL: base + "/tickets", TrackingURL: base + "/p/tickets/ejemplo",
		}
		const ticketWhen = "Ticketera, con el aviso encendido en Administración → Ticketera → Avisos por correo: "
		for _, ev := range ticketSampleEvents {
			if ev.extra && !extras {
				continue
			}
			var comments []string
			if ev.event == ticketmail.ClientComment {
				comments = []string{"Estamos revisando el enlace con el proveedor.", "El proveedor confirmó un corte de fibra; estimamos 2 horas."}
			}
			t := ticket
			t.Extra = ev.ticketExtra
			s := simpleSample(ev.name, ev.slug, ticketWhen+ev.when, ticketmail.Render(appTitle, ev.event, t, settings, comments))
			s.Extra = ev.extra
			add(s, nil)
		}
	} else {
		add(mailSample{Name: "Ticketera"}, err)
	}

	// Llegaron después de la Fase 12 (9.5 y 9.7).
	n := &Notifier{Queries: h.Queries, Now: func() time.Time { return now }}
	logo := brandInline(brand)
	day := func(d int) time.Time { return time.Date(now.Year(), now.Month(), now.Day()+d, 20, 0, 0, 0, loc) }
	items := []mailtpl.AgendaItem{
		{Task: "Revisión de reglas del SIEM", Detail: "SOC", Who: "Ana Rojas", Due: day(-1), State: "late"},
		{Task: "Informe mensual de disponibilidad", Detail: "SOC", Who: "Ana Rojas", Client: "Cliente de ejemplo", Due: day(0), State: "today"},
		{Task: "Respaldo de configuración de switches", Detail: "Infraestructura", Who: "Infraestructura N1", Due: day(2), State: "soon"},
	}
	period := mailtplWeekday(now) + spanishDayLabel(now)[len(strings.ToLower(mailtplWeekday(now))):]
	html, err := n.agendaMail(ctx, "Tus pendientes de hoy", period, "Lo que ya viste en la campana también está aquí, para tenerlo a mano.", items, 2, loc)
	add(mailSample{Name: "Agenda: resumen diario", Slug: "agenda-resumen-diario", When: "Los días hábiles a la hora del resumen (08:00 por defecto, Administración → Notificaciones), a quien tiene algo y no lo apagó.",
		Subject: "Tus pendientes de hoy · " + period, Text: htmlToText(html), HTML: html, Inline: logo}, err)
	late := "Atrasada: «Revisión de reglas del SIEM»"
	html, err = n.agendaMail(ctx, late, "", "Hola Ana Rojas. Ábrela en la Agenda de la aplicación.", items[:1], 0, loc)
	add(mailSample{Name: "Agenda: aviso de vencimiento o atraso", Slug: "agenda-aviso", When: "Al instante, N días hábiles antes del vencimiento y al atrasarse (solo al responsable), si la persona lo tiene por correo.",
		Subject: late, Text: htmlToText(html), HTML: html, Inline: logo}, err)

	add(simpleSample("Recordatorio de un aviso con acuse", "aviso-con-acuse-recordatorio", "Avisos con acuse → «Recordar a quienes faltan»: va a quienes no lo leyeron.",
		mailtpl.NoticeReminder(appTitle, "Cambio de horario de turnos desde noviembre")), nil)

	prev := time.Date(now.Year(), now.Month()-1, 1, 0, 0, 0, 0, time.UTC)
	monthly, err := mailtpl.RenderMonthlySummary(mailtpl.MonthlySummaryOptions{
		Rows: []mailtpl.MonthlyRow{
			{Name: "Ana Rojas", Level: "N1", Tasks: 18, OnTimePct: 94, Skipped: 1, Tickets: 12, SLAPct: 91},
			{Name: "Luis Fuentes", Level: "N1", Tasks: 15, OnTimePct: 80, OpenLate: 1, Tickets: 9, SLAPct: 100, AbsentDays: 3},
			{Name: "Carla Muñoz", Level: "N2", Tasks: 11, OnTimePct: 100, Tickets: 6, SLAPct: 83},
		},
		Total: mailtpl.MonthlyRow{Name: "Total Infraestructura", Tasks: 44, OnTimePct: 90, OpenLate: 1, Skipped: 1, Tickets: 27, SLAPct: 92, AbsentDays: 3},
		Title: "Resumen mensual Infraestructura", PeriodLabel: fmt.Sprintf("%s %d", spanishMonths[prev.Month()-1], prev.Year()),
		LogoSrc: logoSrc(logo), BrandName: appTitle, Intro: "Días hábiles del mes: 20.", Year: prev.Year(),
	})
	add(mailSample{Name: "Resumen mensual del área", Slug: "resumen-mensual", When: "Mi equipo → Resumen mensual → Enviar por correo (lo envía la jefatura; no sale solo).",
		Subject: fmt.Sprintf("Resumen mensual Infraestructura · %s %d", spanishMonths[prev.Month()-1], prev.Year()), Text: htmlToText(monthly), HTML: monthly, Inline: logo}, err)

	summaryPeriod := fmt.Sprintf("%s %d", spanishMonths[prev.Month()-1], prev.Year())
	clientSummary, err2 := mailtpl.RenderClientSummary(mailtpl.ClientSummaryOptions{
		Title: "Resumen de servicio · Casinos", PeriodLabel: summaryPeriod, LogoSrc: logoSrc(logo), BrandName: appTitle,
		SLAPct: 89, SLATarget: 95, Response: "9 min", Resolution: "6,2 h", Year: prev.Year(),
		Incidents: []mailtpl.ClientSummaryArea{{Area: "SOC", P2: 3, P3: 5, P4: 2}, {Area: "NOC", P2: 2, P3: 4, P4: 1}},
		Goals: []mailtpl.ClientSummaryGoal{{Name: "Migrar el monitoreo al SIEM nuevo", Done: 1, Total: 5, State: "En riesgo"},
			{Name: "Renovar el contrato", Done: 4, Total: 4, State: "Cumplida"}},
	})
	add(mailSample{Name: "Gestión: resumen de servicio del cliente", Slug: "gestion-resumen-cliente",
		When:    "Gestión → ficha del cliente o Indicadores → Exportar resumen → Enviar por correo (lo envía la CSM; no sale solo).",
		Subject: "Resumen de servicio · Casinos · " + summaryPeriod, Text: htmlToText(clientSummary), HTML: clientSummary, Inline: logo}, err2)

	if extras {
		// El aviso de escalamiento sale solo en texto (sin HTML).
		esc := &EscalationHandler{Now: func() time.Time { return now }}
		team := resolvedTeamDTO{Name: "Redes"}
		team.Organization = &struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}{Name: "Cliente de ejemplo"}
		subject, body := esc.buildNotifyMail(&resolutionDTO{ResolvedUnit: &resolvedUnitDTO{Name: "Temuco", Code: "TEM"}}, resolvedStepDTO{Team: team},
			notifyRequest{Message: "Caída del enlace MPLS de la sucursal Temuco. Se pide revisión del proveedor.", Severity: "alta"}, nil)
		add(mailSample{Name: "Escalamiento: aviso por correo", Slug: "escalamiento-aviso", When: "Escalamiento → «Escalar (correo)»: a los integrantes con correo del llamado.",
			Subject: subject, Text: body, HTML: plainTextHTML(subject, body), PlainText: true, Extra: true}, nil)
	}
	return out, failed
}

// ticketSampleEvents: los avisos de la Ticketera, en el orden de su
// pantalla. extra: solo en docs/correos (la muestra manda los 3 modelos).
var ticketSampleEvents = []struct {
	name, slug, event, when, ticketExtra string
	extra                                bool
}{
	{"Ticketera: nuevo ticket (copia de respaldo)", "ticket-equipo-nuevo", ticketmail.TeamCreated, "al crear cada ticket (copia de respaldo).", "", false},
	{"Ticketera: te asignaron", "ticket-equipo-asignado", ticketmail.TeamAssigned, "al asignar el ticket a una persona.", "", false},
	{"Ticketera: comentario al cliente", "ticket-cliente-comentario", ticketmail.ClientComment, "al comentar al cliente.", "", false},
	{"Ticketera: te sumaron como resolutor", "ticket-equipo-resolutor", ticketmail.TeamResolverAdded, "al sumar un resolutor.", "carla.munoz", true},
	{"Ticketera: venció el SLA de respuesta", "ticket-equipo-sla-respuesta", ticketmail.TeamSLAResponseBreached, "al vencer el SLA de respuesta.", "", true},
	{"Ticketera: SLA de resolución por vencer", "ticket-equipo-sla-por-vencer", ticketmail.TeamSLAResolutionWarning, "al llegar al porcentaje de aviso del SLA de resolución.", "", true},
	{"Ticketera: venció el SLA de resolución", "ticket-equipo-sla-resolucion", ticketmail.TeamSLAResolutionBreached, "al vencer el SLA de resolución.", "", true},
	{"Ticketera: ticket reabierto (equipo)", "ticket-equipo-reabierto", ticketmail.TeamReopened, "al reabrir un ticket.", "", true},
	{"Ticketera: espera de proveedor (equipo)", "ticket-equipo-espera-proveedor", ticketmail.TeamPendingVendor, "al pasar a espera de proveedor.", "", true},
	{"Ticketera: ticket resuelto (equipo)", "ticket-equipo-resuelto", ticketmail.TeamResolved, "al resolver un ticket.", "", true},
	{"Ticketera: ticket unido a otro", "ticket-equipo-unido", ticketmail.TeamMerged, "al unir un ticket con otro.", "TKT-2026-00058", true},
	{"Ticketera: cambió el cliente", "ticket-equipo-cliente-cambiado", ticketmail.TeamClientChanged, "al cambiar el cliente de un ticket.", "Cliente anterior → Cliente de ejemplo", true},
	{"Ticketera: al cliente, ticket abierto", "ticket-cliente-abierto", ticketmail.ClientOpened, "al abrir un ticket que afecta al cliente.", "", true},
	{"Ticketera: al cliente, espera de proveedor", "ticket-cliente-espera-proveedor", ticketmail.ClientPendingVendor, "al pasar a espera de proveedor.", "", true},
	{"Ticketera: al cliente, se retomó", "ticket-cliente-retomado", ticketmail.ClientResumed, "al salir de espera de proveedor.", "", true},
	{"Ticketera: al cliente, resuelto", "ticket-cliente-resuelto", ticketmail.ClientResolved, "al resolver el ticket.", "", true},
	{"Ticketera: al cliente, reabierto", "ticket-cliente-reabierto", ticketmail.ClientReopened, "al reabrir el ticket.", "", true},
	{"Ticketera: al cliente, cerrado", "ticket-cliente-cerrado", ticketmail.ClientClosed, "al cerrar el ticket.", "", true},
}

// brandInline: el logo de la marca como imagen en línea, como lo manda Notifier.mail.
func brandInline(b branding.Brand) []mail.Inline {
	if len(b.Logo) == 0 {
		return nil
	}
	return []mail.Inline{{CID: scheduleLogoCID, Name: "logo" + logoExtension(b.LogoType), ContentType: b.LogoType, Data: b.Logo}}
}

func logoSrc(inline []mail.Inline) string {
	if len(inline) == 0 {
		return ""
	}
	return "cid:" + inline[0].CID
}

// plainTextHTML muestra un correo de solo texto tal como llega.
func plainTextHTML(subject, body string) string {
	return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + escapeHTMLText(subject) +
		"</title></head><body><pre style=\"font: 14px/1.5 Consolas, monospace; white-space: pre-wrap; max-width: 720px;\">" +
		escapeHTMLText(strings.ReplaceAll(body, "\r\n", "\n")) + "</pre></body></html>"
}

func escapeHTMLText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

// MailPreview es un tipo de correo con datos de ejemplo, para docs/correos.
type MailPreview struct {
	Slug, Name, When, Subject, HTML, Text string
	Inline                                []mail.Inline
	PlainText                             bool
}

// Previews arma todos los tipos de correo (también las variantes que la
// muestra de Administración no manda) con la fecha now. Los que no se
// pudieron armar vuelven con su motivo.
func (h *MailSamplesHandler) Previews(ctx context.Context, now time.Time) ([]MailPreview, []string) {
	samples, failed := h.samples(ctx, now, true)
	out := make([]MailPreview, 0, len(samples))
	for _, s := range samples {
		out = append(out, MailPreview{Slug: s.Slug, Name: s.Name, When: s.When, Subject: s.Subject, HTML: s.HTML, Text: s.Text, Inline: s.Inline, PlainText: s.PlainText})
	}
	var errs []string
	for _, f := range failed {
		errs = append(errs, f.Name+": "+f.Error)
	}
	return out, errs
}

// ListSamples es GET /api/config/smtp/samples: los correos de muestra que se
// pueden enviar, en orden (y los que no se pudieron armar, con el motivo).
// La pantalla los manda de a uno, con una pausa entre cada uno: así ve por
// cuál va, un rechazo no corta los demás y el servidor de correo no los
// frena por llegar todos juntos.
func (h *MailSamplesHandler) ListSamples(w http.ResponseWriter, r *http.Request) {
	samples, failed := h.samples(r.Context(), time.Now(), false)
	names := make([]string, 0, len(samples))
	for _, s := range samples {
		names = append(names, s.Name)
	}
	writeData(w, http.StatusOK, map[string]any{"samples": names, "unavailable": failed})
}

// SendSample es POST /api/config/smtp/samples/{n} {to: [...]}: manda la muestra n (desde 1).
func (h *MailSamplesHandler) SendSample(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		To []string `json:"to"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	to := ticketmail.Unique(req.To, "")
	if len(to) == 0 || len(to) > maxSampleRecipients {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", fmt.Sprintf("indica de 1 a %d correos", maxSampleRecipients))
		return
	}
	for _, e := range to {
		if !directory.ValidEmail(e) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "correo no válido: "+e)
			return
		}
	}
	samples, _ := h.samples(ctx, time.Now(), false)
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 || n > len(samples) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no existe esa muestra")
		return
	}
	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configura el servidor de correo antes de enviar las muestras")
		return
	}
	s := samples[n-1]
	res := mailSampleResult{Name: s.Name, OK: true}
	if err := sender.SendRich(to, nil, fmt.Sprintf("[Muestra %d/%d] %s", n, len(samples), s.Subject), s.Text, s.HTML, s.Inline); err != nil {
		res.OK, res.Error = false, err.Error()
	}
	level, result := audit.LevelInfo, audit.Success()
	if !res.OK {
		level, result = audit.LevelWarn, audit.Failure(res.Error)
	}
	h.AuditLog.Log(ctx, "smtp.sample.sent", level, result, map[string]any{"sample": s.Name, "recipients": len(to)})
	writeData(w, http.StatusOK, res)
}
