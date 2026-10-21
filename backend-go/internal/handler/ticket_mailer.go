package handler

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ticketmail"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/tickets"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// TicketMailer son los avisos por correo de la Ticketera (spec/15). Emit deja
// el aviso en la cola (ticket_mail_outbox) después de que la acción ya quedó
// guardada: la acción del analista nunca espera al correo ni falla por él.
// Dispatch (cada 30 s) revisa los SLA y envía lo que toca, con reintentos.
type TicketMailer struct {
	Queries       *db.Queries
	Crypto        *crypto.Box
	AuditLog      *audit.Logger
	PublicBaseURL string
	Now           func() time.Time
}

func (m *TicketMailer) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

// mailEmission: algo que pasó en un ticket y puede mandar correo.
type mailEmission struct {
	Event    string
	TicketID uuid.UUID
	// ActorID: quien hizo el cambio (uuid.Nil = el sistema, p. ej. un SLA).
	ActorID uuid.UUID
	// Targets: la persona puntual del evento (nuevo responsable, quien se sumó…).
	Targets []uuid.UUID
	// Comment: el comentario visible al cliente o la solución al resolver.
	Comment string
	Extra   string
}

type outboxComment struct {
	At   time.Time `json:"at"`
	Text string    `json:"text"`
}

func (m *TicketMailer) audit(ctx context.Context, event string, level audit.Level, result audit.Result, meta map[string]any) {
	if m.AuditLog != nil {
		m.AuditLog.Log(ctx, event, level, result, meta)
	}
}

// Emit es mejor esfuerzo: un error queda en la auditoría, nunca sube.
func (m *TicketMailer) Emit(ctx context.Context, e mailEmission) {
	if m == nil {
		return
	}
	if err := m.emit(ctx, e); err != nil {
		m.audit(ctx, "ticket.mail.queue", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"ticketId": e.TicketID.String(), "event": e.Event})
	}
}

func (m *TicketMailer) emit(ctx context.Context, e mailEmission) error {
	s, err := m.Queries.GetTicketSettings(ctx)
	if err != nil {
		return err
	}
	settings := mailSettings(s)
	if !settings.On(e.Event) {
		return nil
	}
	row, err := m.Queries.GetTicketView(ctx, e.TicketID)
	if err != nil {
		return err
	}
	t := row.Ticket
	if t.MergedIntoID.Valid {
		return nil // unido a otro: avisa el principal
	}
	data := m.ticketData(ctx, row, s)
	data.Extra = e.Extra
	appTitle := branding.Load(ctx, m.Queries, false).AppTitle
	now := m.now()
	created := pgtype.UUID{Bytes: e.ActorID, Valid: e.ActorID != uuid.Nil}

	if ticketmail.IsClient(e.Event) {
		if !t.AffectsClient {
			return nil
		}
		to, cc, _ := m.clientRecipients(ctx, t)
		var comments []string
		if strings.TrimSpace(e.Comment) != "" {
			comments = []string{e.Comment}
		}
		mail := ticketmail.Render(appTitle, e.Event, data, settings, comments)
		if len(to)+len(cc) == 0 {
			_, err := m.Queries.CreateTicketMail(ctx, db.CreateTicketMailParams{TicketID: t.ID, Event: e.Event, MailGroup: "client",
				ToEmails: []string{}, CcEmails: []string{}, Subject: mail.Subject, Comments: []byte("[]"), Status: "no_recipients",
				SendAfter: pgtype.Timestamptz{Time: now, Valid: true}, CreatedBy: created})
			return err
		}
		if e.Event == ticketmail.ClientComment && settings.BatchMinutes > 0 {
			item, _ := json.Marshal([]outboxComment{{At: now, Text: e.Comment}})
			if waiting, err := m.Queries.GetWaitingCommentMail(ctx, t.ID); err == nil {
				if n, err := m.Queries.AppendWaitingComment(ctx, db.AppendWaitingCommentParams{ID: waiting.ID, Comment: item}); err == nil && n == 1 {
					return nil
				}
			}
			_, err := m.Queries.CreateTicketMail(ctx, db.CreateTicketMailParams{TicketID: t.ID, Event: e.Event, MailGroup: "client",
				ToEmails: to, CcEmails: cc, Subject: mail.Subject, Comments: item, Status: "waiting",
				SendAfter: pgtype.Timestamptz{Time: now.Add(time.Duration(settings.BatchMinutes) * time.Minute), Valid: true}, CreatedBy: created})
			return err
		}
		_, err := m.Queries.CreateTicketMail(ctx, db.CreateTicketMailParams{TicketID: t.ID, Event: e.Event, MailGroup: "client",
			ToEmails: to, CcEmails: cc, Subject: mail.Subject, Html: mail.HTML, BodyText: mail.Text, Comments: []byte("[]"), Status: "pending",
			SendAfter: pgtype.Timestamptz{Time: now, Valid: true}, CreatedBy: created})
		return err
	}

	party := ticketmail.Party{Backup: settings.Backup, Actor: m.userEmail(ctx, e.ActorID)}
	if t.AssignedUserID.Valid {
		party.Responsible = m.userEmail(ctx, uuid.UUID(t.AssignedUserID.Bytes))
	}
	if resolvers, err := m.Queries.ListTicketResolverEmails(ctx, t.ID); err == nil {
		for _, r := range resolvers {
			party.Resolvers = append(party.Resolvers, r.Email)
		}
	}
	for _, id := range e.Targets {
		party.Target = append(party.Target, m.userEmail(ctx, id))
	}
	to := ticketmail.TeamRecipients(e.Event, party, settings.SkipActor)
	if len(to) == 0 {
		return nil
	}
	mail := ticketmail.Render(appTitle, e.Event, data, settings, nil)
	_, err = m.Queries.CreateTicketMail(ctx, db.CreateTicketMailParams{TicketID: t.ID, Event: e.Event, MailGroup: "team",
		ToEmails: to, CcEmails: []string{}, Subject: mail.Subject, Html: mail.HTML, BodyText: mail.Text, Comments: []byte("[]"), Status: "pending",
		SendAfter: pgtype.Timestamptz{Time: now, Valid: true}, CreatedBy: created})
	return err
}

func (m *TicketMailer) userEmail(ctx context.Context, id uuid.UUID) string {
	if id == uuid.Nil {
		return ""
	}
	email, err := m.Queries.GetActiveUserEmail(ctx, id)
	if err != nil {
		return ""
	}
	return email
}

// clientRecipients: los del ticket si se cambiaron a mano; si no, el Para/CC
// del escalamiento del cliente (contactos del Directorio), los mismos de
// Reportes: primero los del servicio del ticket y, si no hay, los del cliente.
func (m *TicketMailer) clientRecipients(ctx context.Context, t db.Ticket) (to, cc []string, custom bool) {
	if t.NotifyTo != nil || t.NotifyCc != nil {
		return nonNilStrings(t.NotifyTo), nonNilStrings(t.NotifyCc), true
	}
	to, cc = m.escalationRecipients(ctx, t.ClientID, t.ServiceID)
	if len(to)+len(cc) == 0 && t.ServiceID.Valid {
		to, cc = m.escalationRecipients(ctx, t.ClientID, pgtype.UUID{})
	}
	return to, cc, false
}

func (m *TicketMailer) escalationRecipients(ctx context.Context, org uuid.UUID, service pgtype.UUID) (to, cc []string) {
	to, cc = []string{}, []string{}
	rows, err := m.Queries.ListEscalationEmailsForOrganization(ctx, db.ListEscalationEmailsForOrganizationParams{OrganizationID: org, ServiceID: service})
	if err != nil {
		return
	}
	seen := map[string]bool{}
	for _, row := range rows {
		email, err := m.Crypto.Decrypt(row.ValueEncrypted)
		if err != nil || seen[strings.ToLower(email)] {
			continue
		}
		seen[strings.ToLower(email)] = true
		if row.RecipientType == "cc" {
			cc = append(cc, email)
		} else {
			to = append(to, email)
		}
	}
	sort.Strings(to)
	sort.Strings(cc)
	return
}

func (m *TicketMailer) ticketData(ctx context.Context, row db.GetTicketViewRow, s db.TicketSetting) ticketmail.TicketData {
	t := row.Ticket
	base := strings.TrimRight(m.PublicBaseURL, "/")
	d := ticketmail.TicketData{
		Number: t.TicketNumber, Title: t.Title, Priority: string(t.Priority), Status: string(t.Status), ClientName: row.ClientName,
		TeamName: row.TeamName.String, Responsible: row.AssigneeUsername.String, TeamURL: base + "/tickets?id=" + t.ID.String(),
		Pin: t.PublicTrackingPin.String,
	}
	if t.PublicTrackingToken.Valid {
		d.TrackingURL = base + "/p/tickets/" + t.PublicTrackingToken.String
	}
	if t.CreatedBy.Valid {
		if u, err := m.Queries.GetUserByID(ctx, uuid.UUID(t.CreatedBy.Bytes)); err == nil {
			d.CreatedBy = u.Username
		}
	}
	if t.CreatedAt.Valid {
		d.CreatedAt = t.CreatedAt.Time.In(chileTime).Format("02-01-2006 15:04")
	}
	if t.SlaResolutionDueAt.Valid && t.CreatedAt.Valid {
		in := slaInput(t)
		in.AtRiskPercent = int(s.AtRiskPercent)
		d.ResolutionDue = tickets.ResolutionClock(in, m.now()).DueAt.In(chileTime).Format("02-01-2006 15:04")
	}
	return d
}

// Dispatch corre cada 30 s: avisos de SLA y envío de la cola.
func (m *TicketMailer) Dispatch(ctx context.Context) error {
	s, err := m.Queries.GetTicketSettings(ctx)
	if err != nil {
		return err
	}
	m.scanSLA(ctx, s)
	return m.sendDue(ctx, s)
}

// slaWarnPercent: el aviso de "por vencer" sale al 80 % (spec/15 §4.2).
const slaWarnPercent = 80

// scanSLA marca en el ticket que ya avisó, aunque el aviso esté apagado:
// así encender los avisos no manda de golpe los de todos los tickets viejos.
func (m *TicketMailer) scanSLA(ctx context.Context, s db.TicketSetting) {
	open, err := m.Queries.ListOpenTicketsForSLAMail(ctx)
	if err != nil {
		return
	}
	now := m.now()
	stamp := pgtype.Timestamptz{Time: now, Valid: true}
	for _, t := range open {
		var p db.MarkTicketSLANotifiedParams
		var events []string
		if !t.SlaResponseBreachNotifiedAt.Valid && t.SlaResponseDueAt.Valid && !t.FirstRespondedAt.Valid && now.After(t.SlaResponseDueAt.Time) {
			p.ResponseBreach = stamp
			events = append(events, ticketmail.TeamSLAResponseBreached)
		}
		if t.SlaResolutionDueAt.Valid && t.CreatedAt.Valid {
			in := slaInput(t)
			in.AtRiskPercent = int(s.AtRiskPercent)
			c := tickets.ResolutionClock(in, now)
			switch {
			case c.State == tickets.Breached && !t.SlaResolutionBreachNotifiedAt.Valid:
				p.ResolutionBreach, p.ResolutionWarn = stamp, stamp
				events = append(events, ticketmail.TeamSLAResolutionBreached)
			case c.State != tickets.Paused && c.State != tickets.Breached && c.Percent >= slaWarnPercent && !t.SlaResolutionWarnNotifiedAt.Valid:
				p.ResolutionWarn = stamp
				events = append(events, ticketmail.TeamSLAResolutionWarning)
			}
		}
		if len(events) == 0 {
			continue
		}
		p.ID = t.ID
		if err := m.Queries.MarkTicketSLANotified(ctx, p); err != nil {
			continue
		}
		for _, ev := range events {
			m.Emit(ctx, mailEmission{Event: ev, TicketID: t.ID})
		}
		// SLA vencido: queda en Auditoría y, por ahí, llega al SIEM (spec/19).
		if m.AuditLog != nil {
			if p.ResponseBreach.Valid {
				m.AuditLog.Log(ctx, "ticket.sla_breached", audit.LevelWarn, audit.Success(), map[string]any{"ticketId": t.ID.String(), "sla": "response"})
			}
			if p.ResolutionBreach.Valid {
				m.AuditLog.Log(ctx, "ticket.sla_breached", audit.LevelWarn, audit.Success(), map[string]any{"ticketId": t.ID.String(), "sla": "resolution"})
			}
		}
	}
}

func (m *TicketMailer) sendDue(ctx context.Context, s db.TicketSetting) error {
	now := m.now()
	due, err := m.Queries.ListDueTicketMails(ctx, pgtype.Timestamptz{Time: now, Valid: true})
	if err != nil || len(due) == 0 {
		return err
	}
	sender, _, err := buildMailSender(ctx, m.Queries, m.Crypto)
	if err != nil {
		return nil // sin correo configurado: se intenta en la próxima vuelta
	}
	appTitle := branding.Load(ctx, m.Queries, false).AppTitle
	settings := mailSettings(s)
	for _, row := range due {
		subject, html, text := row.Subject, row.Html, row.BodyText
		if row.Status == "waiting" {
			// Comentarios juntados: el correo se arma ahora, con todos en orden.
			view, err := m.Queries.GetTicketView(ctx, row.TicketID)
			if err != nil {
				continue
			}
			var items []outboxComment
			_ = json.Unmarshal(row.Comments, &items)
			texts := make([]string, 0, len(items))
			for _, c := range items {
				texts = append(texts, c.Text)
			}
			mail := ticketmail.Render(appTitle, ticketmail.ClientComment, m.ticketData(ctx, view, s), settings, texts)
			subject, html, text = mail.Subject, mail.HTML, mail.Text
		}
		meta := map[string]any{"ticketId": row.TicketID.String(), "event": row.Event, "mailId": row.ID.String()}
		if err := sender.SendAlternative(row.ToEmails, row.CcEmails, subject, text, html); err != nil {
			retry := now.Add(time.Duration(ticketmail.RetryDelayMinutes(int(row.Attempts))) * time.Minute)
			_ = m.Queries.MarkTicketMailFailed(ctx, db.MarkTicketMailFailedParams{ID: row.ID, LastError: pgtype.Text{String: err.Error(), Valid: true}, RetryAt: pgtype.Timestamptz{Time: retry, Valid: true}})
			m.audit(ctx, "ticket.mail.sent", audit.LevelWarn, audit.Failure(err.Error()), meta)
			continue
		}
		_ = m.Queries.MarkTicketMailSent(ctx, db.MarkTicketMailSentParams{ID: row.ID, SentAt: pgtype.Timestamptz{Time: now, Valid: true}, Subject: subject, Html: html, BodyText: text})
		m.audit(ctx, "ticket.mail.sent", audit.LevelInfo, audit.Success(), meta)
	}
	return nil
}
