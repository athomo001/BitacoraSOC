package handler

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ticketmail"
)

// TicketSettingsHandler es Administración → Ticketera (pedido del dueño
// 2026-10-13): los SLA, el umbral "en riesgo", la firma ante el cliente y los
// avisos por correo de spec/15. Antes los SLA y la firma estaban fijos en el código.
type TicketSettingsHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
}

type slaPairDTO struct {
	Response   int32 `json:"response"`
	Resolution int32 `json:"resolution"`
}

type ticketSLADTO struct {
	P1      slaPairDTO `json:"p1"`
	P2      slaPairDTO `json:"p2"`
	P3      slaPairDTO `json:"p3"`
	P4      slaPairDTO `json:"p4"`
	Request slaPairDTO `json:"request"`
}

type ticketMailSettingsDTO struct {
	Enabled             bool     `json:"enabled"`
	TeamLink            bool     `json:"teamLink"`
	SkipActor           bool     `json:"skipActor"`
	TeamEnabled         bool     `json:"teamEnabled"`
	BackupEmails        []string `json:"backupEmails"`
	ClientEnabled       bool     `json:"clientEnabled"`
	AffectsRule         string   `json:"affectsRule"`
	CommentBatchMinutes int32    `json:"commentBatchMinutes"`
	IncludePin          bool     `json:"includePin"`
	Events              []string `json:"events"`
}

type ticketSettingsDTO struct {
	SLA             ticketSLADTO          `json:"sla"`
	AtRiskPercent   int32                 `json:"atRiskPercent"`
	PublicSignature string                `json:"publicSignature"`
	Mail            ticketMailSettingsDTO `json:"mail"`
	// SMTPConfigured: solo lectura; sin servidor no se pueden encender los avisos.
	SMTPConfigured bool `json:"smtpConfigured"`
}

func toTicketSettingsDTO(s db.TicketSetting) ticketSettingsDTO {
	return ticketSettingsDTO{
		SLA: ticketSLADTO{
			P1:      slaPairDTO{s.SlaP1ResponseMinutes, s.SlaP1ResolutionMinutes},
			P2:      slaPairDTO{s.SlaP2ResponseMinutes, s.SlaP2ResolutionMinutes},
			P3:      slaPairDTO{s.SlaP3ResponseMinutes, s.SlaP3ResolutionMinutes},
			P4:      slaPairDTO{s.SlaP4ResponseMinutes, s.SlaP4ResolutionMinutes},
			Request: slaPairDTO{s.SlaRequestResponseMinutes, s.SlaRequestResolutionMinutes},
		},
		AtRiskPercent: s.AtRiskPercent, PublicSignature: s.PublicSignature,
		Mail: ticketMailSettingsDTO{
			Enabled: s.MailEnabled, TeamLink: s.MailTeamLink, SkipActor: s.MailSkipActor, TeamEnabled: s.MailTeamEnabled,
			BackupEmails: nonNilStrings(s.MailBackupEmails), ClientEnabled: s.MailClientEnabled, AffectsRule: s.MailAffectsRule,
			CommentBatchMinutes: s.MailCommentBatchMinutes, IncludePin: s.MailIncludePin, Events: nonNilStrings(s.MailEvents),
		},
	}
}

// mailSettings pasa la fila a lo que usa ticketmail.
func mailSettings(s db.TicketSetting) ticketmail.Settings {
	return ticketmail.Settings{
		Enabled: s.MailEnabled, TeamEnabled: s.MailTeamEnabled, ClientEnabled: s.MailClientEnabled, Events: s.MailEvents,
		Backup: s.MailBackupEmails, SkipActor: s.MailSkipActor, TeamLink: s.MailTeamLink, IncludePin: s.MailIncludePin,
		BatchMinutes: int(s.MailCommentBatchMinutes), AffectsRule: s.MailAffectsRule, Signature: s.PublicSignature,
	}
}

// slaWindows: plazos de respuesta y resolución de un ticket nuevo.
func slaWindows(s db.TicketSetting, ticketType, priority string) (response, resolution time.Duration) {
	m := func(v int32) time.Duration { return time.Duration(v) * time.Minute }
	if ticketType == "service_request" {
		return m(s.SlaRequestResponseMinutes), m(s.SlaRequestResolutionMinutes)
	}
	switch priority {
	case "p1_critical":
		return m(s.SlaP1ResponseMinutes), m(s.SlaP1ResolutionMinutes)
	case "p2_high":
		return m(s.SlaP2ResponseMinutes), m(s.SlaP2ResolutionMinutes)
	case "p3_medium":
		return m(s.SlaP3ResponseMinutes), m(s.SlaP3ResolutionMinutes)
	}
	return m(s.SlaP4ResponseMinutes), m(s.SlaP4ResolutionMinutes)
}

func (h *TicketSettingsHandler) smtpConfigured(ctx context.Context) bool {
	_, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	return err == nil
}

// GetConfig es GET /api/config/tickets (admin).
func (h *TicketSettingsHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	s, err := h.Queries.GetTicketSettings(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de la Ticketera")
		return
	}
	dto := toTicketSettingsDTO(s)
	dto.SMTPConfigured = h.smtpConfigured(r.Context())
	writeData(w, http.StatusOK, dto)
}

// maxSLAMinutes: un año. Más es casi seguro un error de tipeo.
const maxSLAMinutes = 525600

// validateTicketSettings devuelve el primer problema, o "".
func validateTicketSettings(req *ticketSettingsDTO) string {
	for _, p := range []slaPairDTO{req.SLA.P1, req.SLA.P2, req.SLA.P3, req.SLA.P4, req.SLA.Request} {
		if p.Response < 1 || p.Resolution < 1 || p.Response > maxSLAMinutes || p.Resolution > maxSLAMinutes {
			return "cada plazo de SLA va de 1 minuto a 1 año"
		}
	}
	if req.AtRiskPercent < 1 || req.AtRiskPercent > 99 {
		return "el umbral \"en riesgo\" va de 1 a 99 %"
	}
	req.PublicSignature = strings.TrimSpace(req.PublicSignature)
	if req.PublicSignature == "" || len([]rune(req.PublicSignature)) > 80 {
		return "la firma ante el cliente es obligatoria (hasta 80 caracteres)"
	}
	m := &req.Mail
	backup := ticketmail.Unique(m.BackupEmails, "")
	if len(backup) > ticketmail.MaxBackupEmails {
		return "la copia de respaldo admite hasta 20 correos"
	}
	for _, e := range backup {
		if !directory.ValidEmail(e) {
			return "correo no válido en la copia de respaldo: " + e
		}
	}
	m.BackupEmails = backup
	if m.AffectsRule != ticketmail.AffectsP1P2 && m.AffectsRule != ticketmail.AffectsIncidents && m.AffectsRule != ticketmail.AffectsNone {
		return "regla de \"Afecta al cliente\" desconocida"
	}
	if !slices.Contains(ticketmail.BatchOptions, int(m.CommentBatchMinutes)) {
		return "la ventana para juntar comentarios va en 0, 5, 15, 30 o 60 minutos"
	}
	events := ticketmail.Unique(m.Events, "")
	for _, e := range events {
		if !ticketmail.ValidEvent(e) {
			return "evento desconocido: " + e
		}
	}
	m.Events = events
	return ""
}

// UpdateConfig es PUT /api/config/tickets (admin).
func (h *TicketSettingsHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req ticketSettingsDTO
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := validateTicketSettings(&req); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	if req.Mail.Enabled && !h.smtpConfigured(ctx) {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configura el correo en Administración → Correo antes de encender los avisos")
		return
	}
	s, err := h.Queries.UpdateTicketSettings(ctx, db.UpdateTicketSettingsParams{
		SlaP1ResponseMinutes: req.SLA.P1.Response, SlaP1ResolutionMinutes: req.SLA.P1.Resolution,
		SlaP2ResponseMinutes: req.SLA.P2.Response, SlaP2ResolutionMinutes: req.SLA.P2.Resolution,
		SlaP3ResponseMinutes: req.SLA.P3.Response, SlaP3ResolutionMinutes: req.SLA.P3.Resolution,
		SlaP4ResponseMinutes: req.SLA.P4.Response, SlaP4ResolutionMinutes: req.SLA.P4.Resolution,
		SlaRequestResponseMinutes: req.SLA.Request.Response, SlaRequestResolutionMinutes: req.SLA.Request.Resolution,
		AtRiskPercent: req.AtRiskPercent, PublicSignature: req.PublicSignature,
		MailEnabled: req.Mail.Enabled, MailTeamLink: req.Mail.TeamLink, MailSkipActor: req.Mail.SkipActor,
		MailTeamEnabled: req.Mail.TeamEnabled, MailBackupEmails: req.Mail.BackupEmails, MailClientEnabled: req.Mail.ClientEnabled,
		MailAffectsRule: req.Mail.AffectsRule, MailCommentBatchMinutes: req.Mail.CommentBatchMinutes,
		MailIncludePin: req.Mail.IncludePin, MailEvents: req.Mail.Events,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración de la Ticketera")
		return
	}
	h.AuditLog.Log(ctx, "ticket.config.updated", audit.LevelInfo, audit.Success(), map[string]any{
		"mailEnabled": s.MailEnabled, "teamEnabled": s.MailTeamEnabled, "clientEnabled": s.MailClientEnabled,
		"backupEmails": len(s.MailBackupEmails), "events": len(s.MailEvents), "atRiskPercent": s.AtRiskPercent,
	})
	dto := toTicketSettingsDTO(s)
	dto.SMTPConfigured = true
	if !req.Mail.Enabled {
		dto.SMTPConfigured = h.smtpConfigured(ctx)
	}
	writeData(w, http.StatusOK, dto)
}

// SendTest es POST /api/config/tickets/mail-test (admin): los tres modelos
// (respaldo, responsable, cliente) con datos de ejemplo, solo al propio admin.
func (h *TicketSettingsHandler) SendTest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	actor, _ := middleware.UserFromContext(ctx)
	user, err := h.Queries.GetUserByID(ctx, actor.ID)
	if err != nil || strings.TrimSpace(user.Email) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "tu usuario no tiene correo")
		return
	}
	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configura el correo en Administración → Correo antes de probar")
		return
	}
	s, err := h.Queries.GetTicketSettings(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de la Ticketera")
		return
	}
	settings := mailSettings(s)
	appTitle := branding.Load(ctx, h.Queries, false).AppTitle
	sample := ticketmail.TicketData{
		Number: "TKT-2026-00061", Title: "Caída enlace MPLS Temuco", Priority: "p1_critical", Status: "in_progress",
		ClientName: "Cliente de ejemplo", TeamName: "Redes", Responsible: user.Username, CreatedBy: user.Username,
		CreatedAt: "13-10-2026 09:12", ResolutionDue: "13-10-2026 17:12", TeamURL: "https://ejemplo/tickets", TrackingURL: "https://ejemplo/p/tickets/ejemplo", Pin: "123456",
	}
	for _, ev := range []string{ticketmail.TeamCreated, ticketmail.TeamAssigned, ticketmail.ClientComment} {
		var comments []string
		if ev == ticketmail.ClientComment {
			comments = []string{"Estamos revisando el enlace con el proveedor. Le avisamos apenas tengamos novedades."}
		}
		m := ticketmail.Render(appTitle, ev, sample, settings, comments)
		if err := sender.SendAlternative([]string{user.Email}, nil, "[Prueba] "+m.Subject, m.Text, m.HTML); err != nil {
			h.AuditLog.Log(ctx, "ticket.mail.test", audit.LevelWarn, audit.Failure(err.Error()), nil)
			problemdetails.Write(w, r, http.StatusBadGateway, "mail-failed", "no se pudo enviar la prueba: "+err.Error())
			return
		}
	}
	h.AuditLog.Log(ctx, "ticket.mail.test", audit.LevelInfo, audit.Success(), nil)
	writeData(w, http.StatusOK, map[string]string{"to": user.Email})
}
