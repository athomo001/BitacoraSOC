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
}

type mailSampleResult struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// maxSampleRecipients: es para revisar en un par de buzones, no un envío masivo.
const maxSampleRecipients = 5

func simpleSample(name string, m mailtpl.Mail) mailSample {
	text := m.Text
	if text == "" {
		text = htmlToText(m.HTML)
	}
	return mailSample{Name: name, Subject: m.Subject, Text: text, HTML: m.HTML}
}

// samples arma los correos de ejemplo, en el orden de spec/12 §2.1.
func (h *MailSamplesHandler) samples(ctx context.Context) ([]mailSample, []mailSampleResult) {
	appTitle := branding.Load(ctx, h.Queries, false).AppTitle
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		loc = time.Local
	}
	now := time.Now().In(loc)
	var out []mailSample
	var failed []mailSampleResult
	add := func(s mailSample, err error) {
		if err != nil {
			failed = append(failed, mailSampleResult{Name: s.Name, Error: err.Error()})
			return
		}
		out = append(out, s)
	}

	add(simpleSample("Prueba del servidor", mailtpl.SMTPTest(appTitle, now)), nil)

	incident, _ := json.Marshal(incidentForm{
		CodigoTicket: "TKT-2026-00042", Ofensa: "5799", TipoOperacion: "Ofensa", NombreEvento: "Offense CRE Rule #110593 \"Nueva Ofensa\"",
		Fecha: now.Format("2006-01-02T15:04:05"), Criticidad: "alta", MotivoEvento: "Intentos de autenticación fallidos repetidos.",
		Observaciones: "La IP de origen corresponde a un nodo TOR.\nSe bloqueó en el borde.", Recomendacion: "Bloquear la IP y forzar el cambio de clave.",
		InformacionAdicional: "312 intentos en 15 minutos.", OrigenConexion: "185.220.101[.]4", Destino: "portal.ejemplo[.]cl",
		ReputacionOrigen: "Maliciosa", EvidenciaTexto: "Captura de la ofensa.", LogSource: "Firewall perimetral",
	})
	if rep, err := h.Reports.renderIncident(ctx, reportRequest{Incident: incident}); err == nil {
		add(mailSample{Name: "Informe de incidente", Subject: mailtpl.BrandedSubject(appTitle, "5799 (TKT-2026-00042)"), Text: htmlToText(rep.sendHTML), HTML: rep.sendHTML, Inline: rep.inline}, nil)
	} else {
		add(mailSample{Name: "Informe de incidente"}, err)
	}

	bulletin, _ := json.Marshal(bulletinForm{
		TituloBoletin: "Vulnerabilidad crítica en VPN SSL", MarcaFabricante: "Fabricante de ejemplo", CveIdentificadores: "CVE-2026-0001, CVE-2026-0002",
		Criticidad: "crítica", ProductosAfectados: "- VPN SSL 7.0 a 7.4\n- Gestor central 6.x", Impacto: "Ejecución remota de código sin autenticación.",
		Recomendacion: "- Actualizar a la versión corregida.\n- Mientras tanto, restringir el acceso al portal VPN.", Referencias: "https://ejemplo.cl/aviso",
	})
	if rep, err := h.Reports.renderBulletin(ctx, reportRequest{Bulletin: bulletin}); err == nil {
		add(mailSample{Name: "Boletín de seguridad", Subject: mailtpl.BrandedSubject(appTitle, "Boletín de Seguridad: Vulnerabilidad crítica en VPN SSL"), Text: htmlToText(rep.sendHTML), HTML: rep.sendHTML, Inline: rep.inline}, nil)
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
	add(mailSample{Name: "Reporte de turno", Subject: mailtpl.ShiftReportSubject("Reporte SOC [fecha] [turno]", appTitle, end.Format("02-01-2006"), "Turno A", "20:00"), Text: htmlToText(report), HTML: report}, err)

	add(simpleSample("Checklist con ítems en rojo", mailtpl.ChecklistNok(appTitle, "ana.rojas", "Turno A", "inicio", []string{"N2"},
		[]mailtpl.NokService{{Title: "Firewall perimetral", Observation: "Latencia alta en la VPN de respaldo."}}, now)), nil)

	add(simpleSample("Recordatorio de turno", mailtpl.ShiftReminder(appTitle, "Recordatorio: revisión de las 14:00",
		"Recordatorio de la revisión de mitad de turno:\n\n- Revisar la consola del SIEM\n- Confirmar los respaldos de la noche\n- Actualizar la bitácora")), nil)

	for _, format := range []struct{ name, value string }{{"Dotación (calendario)", "calendar"}, {"Dotación (lista)", "list"}} {
		m, err := h.Dotacion.buildDotacionMail(ctx, db.WorkShiftNotificationSchedule{Name: "Dotación semanal (muestra)", Timezone: "America/Santiago", TargetPeriod: "current_week", EmailFormat: format.value})
		add(mailSample{Name: format.name, Subject: m.subject, Text: htmlToText(m.html), HTML: m.html, Inline: m.inline}, err)
	}

	bday, inline := h.Birthdays.birthdayMail(ctx, "Ana Rojas")
	add(mailSample{Name: "Cumpleaños", Subject: bday.Subject, Text: htmlToText(bday.HTML), HTML: bday.HTML, Inline: inline}, nil)

	add(simpleSample("Recuperar contraseña", mailtpl.PasswordRecovery(strings.TrimRight(h.PublicBaseURL, "/")+"/reset-password?token=ejemplo-no-valido", appTitle)), nil)
	add(simpleSample("Cambio de contraseña obligatorio", mailtpl.ForcedPasswordChange(appTitle, "Ana Rojas")), nil)

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
		for _, ev := range []struct{ name, event string }{
			{"Ticketera: nuevo ticket (copia de respaldo)", ticketmail.TeamCreated},
			{"Ticketera: te asignaron", ticketmail.TeamAssigned},
			{"Ticketera: comentario al cliente", ticketmail.ClientComment},
		} {
			var comments []string
			if ev.event == ticketmail.ClientComment {
				comments = []string{"Estamos revisando el enlace con el proveedor.", "El proveedor confirmó un corte de fibra; estimamos 2 horas."}
			}
			add(simpleSample(ev.name, ticketmail.Render(appTitle, ev.event, ticket, settings, comments)), nil)
		}
	}
	return out, failed
}

// ListSamples es GET /api/config/smtp/samples: los correos de muestra que se
// pueden enviar, en orden (y los que no se pudieron armar, con el motivo).
// La pantalla los manda de a uno, con una pausa entre cada uno: así ve por
// cuál va, un rechazo no corta los demás y el servidor de correo no los
// frena por llegar todos juntos.
func (h *MailSamplesHandler) ListSamples(w http.ResponseWriter, r *http.Request) {
	samples, failed := h.samples(r.Context())
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
	samples, _ := h.samples(ctx)
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
