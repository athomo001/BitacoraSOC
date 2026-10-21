package handler

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Tipos de notificación (spec/16 §4.5, 9.5). Cada módulo avisa con uno.
const (
	NotifAgendaAssigned = "agenda.assigned"
	NotifAgendaWarn     = "agenda.warn"
	NotifAgendaDue      = "agenda.due"
	NotifAgendaLate     = "agenda.late"
	NotifAgendaHandover = "agenda.handover"
	NotifAgendaAbsence  = "agenda.absence"
	NotifTicketAssigned = "ticket.assigned"
	NotifTicketDerived  = "ticket.derived"
	NotifTicketComment  = "ticket.comment"
	NotifInventoryReq   = "inventory.request"
	NotifGlpiImport     = "glpi.import"
	NotifForwardDown    = "forward.down"
	NotifWindow         = "window"
	NotifNotice         = "notice"
)

// notifKind: valores por defecto de cada tipo. Email: si el tipo puede salir
// por correo al instante (los tickets ya tienen sus avisos de la Ticketera,
// spec/15, y no se duplican).
type notifKind struct {
	Kind         string `json:"kind"`
	Toast        bool   `json:"toast"`
	Email        bool   `json:"email"`
	EmailAllowed bool   `json:"emailAllowed"`
	ToastAllowed bool   `json:"toastAllowed"`
}

var notifKinds = []notifKind{
	{NotifAgendaAssigned, true, false, true, true},
	{NotifAgendaWarn, true, true, true, true},
	{NotifAgendaDue, true, false, true, true},
	{NotifAgendaLate, true, true, true, true},
	{NotifAgendaHandover, true, false, true, true},
	{NotifAgendaAbsence, true, false, true, true},
	{NotifTicketAssigned, true, false, false, true},
	{NotifTicketDerived, false, false, false, true},
	{NotifTicketComment, false, false, false, true},
	{NotifInventoryReq, true, false, false, true},
	// Importación automática desde GLPI que falló o retuvo bajas (solo admin).
	{NotifGlpiImport, true, false, false, true},
	// Un destino del reenvío a un SIEM no recibe eventos hace 15 minutos, o volvió (solo admin).
	{NotifForwardDown, true, false, false, true},
	{NotifWindow, false, false, false, true},
	// El aviso con acuse se muestra como ventana: no tiene emergente ni correo propio.
	{NotifNotice, false, false, false, false},
}

func notifKindOf(kind string) notifKind {
	for _, k := range notifKinds {
		if k.Kind == kind {
			return k
		}
	}
	return notifKind{Kind: kind, Toast: true, ToastAllowed: true}
}

// notifPref es lo que eligió una persona para un tipo (nil = por defecto).
type notifPref struct {
	Toast   *bool `json:"toast,omitempty"`
	Email   *bool `json:"email,omitempty"`
	Browser *bool `json:"browser,omitempty"`
}

type userNotifPrefs struct {
	Kinds   map[string]notifPref
	Digest  bool
	Browser bool
}

// channels: por dónde le llega este tipo a esta persona. Lo que el admin
// fijó (locked) sale siempre por lo que el tipo permite.
func (p userNotifPrefs) channels(kind string, locked map[string]bool) (toast, email, browser bool) {
	def := notifKindOf(kind)
	toast, email = def.Toast && def.ToastAllowed, def.Email && def.EmailAllowed
	pref := p.Kinds[kind]
	if !locked[kind] {
		if pref.Toast != nil {
			toast = *pref.Toast && def.ToastAllowed
		}
		if pref.Email != nil {
			email = *pref.Email && def.EmailAllowed
		}
	} else {
		toast, email = def.ToastAllowed, def.EmailAllowed
	}
	browser = p.Browser && toast
	if pref.Browser != nil && !locked[kind] {
		browser = p.Browser && *pref.Browser
	}
	return toast, email, browser
}

func decodeNotifPrefs(raw []byte, digest, browser bool) userNotifPrefs {
	p := userNotifPrefs{Kinds: map[string]notifPref{}, Digest: digest, Browser: browser}
	_ = json.Unmarshal(raw, &p.Kinds)
	if p.Kinds == nil {
		p.Kinds = map[string]notifPref{}
	}
	return p
}

// Notifier deja el aviso en la campana de cada persona y, según sus
// preferencias, como aviso emergente, del navegador o por correo. Lo usan
// la Agenda, la Ticketera, el Inventario, las ventanas de mantenimiento y
// los avisos con acuse. Los avisos iguales se agrupan. Nunca falla hacia el
// que avisa: si algo sale mal, se registra y se sigue.
type Notifier struct {
	Queries  *db.Queries
	Hub      eventPublisher
	AuditLog *audit.Logger
	Sender   func(context.Context) (*mail.Sender, error)
	Now      func() time.Time
}

func (n *Notifier) now() time.Time {
	if n.Now != nil {
		return n.Now()
	}
	return time.Now()
}

// NotifMsg es un aviso. GroupKey junta los iguales; GroupTitle arma el texto
// con cuántos van («3 tareas vencen hoy»).
type NotifMsg struct {
	Kind, Title, Body, Link string
	GroupKey                string
	GroupTitle              func(count int) string
	// Exclude: quien hizo el cambio no se avisa a sí mismo.
	Exclude uuid.UUID
	// Mail: el correo inmediato, si el tipo y la persona lo permiten.
	Mail func(name string) (subject, html string)
}

// Send avisa a cada persona (sin repetir). Devuelve a quiénes llegó.
func (n *Notifier) Send(ctx context.Context, users []uuid.UUID, m NotifMsg) []uuid.UUID {
	if n == nil || len(users) == 0 {
		return nil
	}
	seen := map[uuid.UUID]bool{m.Exclude: true, uuid.Nil: true}
	ids := make([]uuid.UUID, 0, len(users))
	for _, u := range users {
		if !seen[u] {
			seen[u] = true
			ids = append(ids, u)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	settings, err := n.Queries.GetNotificationSettings(ctx)
	if err != nil {
		n.fail(ctx, m.Kind, err)
		return nil
	}
	locked := map[string]bool{}
	for _, k := range settings.LockedKinds {
		locked[k] = true
	}
	prefs, err := n.prefsFor(ctx, ids)
	if err != nil {
		n.fail(ctx, m.Kind, err)
		return nil
	}
	people, err := n.Queries.ListNotifyUsers(ctx, ids)
	if err != nil {
		n.fail(ctx, m.Kind, err)
		return nil
	}
	var sent []uuid.UUID
	var mails []db.ListNotifyUsersRow
	for _, p := range people {
		if !p.Active {
			continue
		}
		toast, email, browser := prefs[p.ID].channels(m.Kind, locked)
		if err := n.store(ctx, p.ID, m, toast, browser, settings.GroupMinutes); err != nil {
			n.fail(ctx, m.Kind, err)
			continue
		}
		sent = append(sent, p.ID)
		if email && m.Mail != nil && p.Email != "" {
			mails = append(mails, p)
		}
	}
	if len(sent) > 0 {
		publishSync(ctx, n.Hub, "notifications.changed", map[string]any{"users": sent})
	}
	for _, p := range mails {
		subject, html := m.Mail(p.Name)
		n.mail(ctx, []string{p.Email}, subject, html)
	}
	return sent
}

func (n *Notifier) prefsFor(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]userNotifPrefs, error) {
	rows, err := n.Queries.ListNotificationPrefs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]userNotifPrefs{}
	for _, id := range ids {
		out[id] = userNotifPrefs{Kinds: map[string]notifPref{}, Digest: true}
	}
	for _, r := range rows {
		out[r.UserID] = decodeNotifPrefs(r.Prefs, r.Digest, r.Browser)
	}
	return out, nil
}

// store agrupa con un aviso igual sin leer y reciente, o crea uno nuevo.
func (n *Notifier) store(ctx context.Context, user uuid.UUID, m NotifMsg, toast, browser bool, groupMinutes int32) error {
	if m.GroupKey != "" && groupMinutes > 0 {
		g, err := n.Queries.FindGroupedNotification(ctx, db.FindGroupedNotificationParams{UserID: user, GroupKey: optText(m.GroupKey), Minutes: groupMinutes})
		if err == nil {
			count := g.Count + 1
			title := m.Title
			if m.GroupTitle != nil {
				title = m.GroupTitle(int(count))
			}
			return n.Queries.UpdateGroupedNotification(ctx, db.UpdateGroupedNotificationParams{ID: g.ID, Count: count, Title: title, Body: m.Body, Toast: toast, Browser: browser})
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	_, err := n.Queries.InsertNotification(ctx, db.InsertNotificationParams{
		UserID: user, Kind: m.Kind, Title: m.Title, Body: m.Body, Link: m.Link, GroupKey: optText(m.GroupKey), Toast: toast, Browser: browser,
	})
	return err
}

// mail envía un correo con el logo de la marca en línea, como los del legacy.
func (n *Notifier) mail(ctx context.Context, to []string, subject, html string) {
	if n.Sender == nil || len(to) == 0 {
		return
	}
	sender, err := n.Sender(ctx)
	if err != nil || sender == nil {
		n.fail(ctx, "mail", errors.New("correo sin configurar"))
		return
	}
	brand := branding.Load(ctx, n.Queries, true)
	var inline []mail.Inline
	if len(brand.Logo) > 0 {
		inline = append(inline, mail.Inline{CID: scheduleLogoCID, Name: "logo" + logoExtension(brand.LogoType), ContentType: brand.LogoType, Data: brand.Logo})
	}
	if err := sender.SendRich(to, nil, subject, htmlToText(html), html, inline); err != nil {
		n.fail(ctx, "mail", err)
	}
}

// brand: nombre y logo para los correos de la Agenda (plantilla de lista del legacy).
func (n *Notifier) brand(ctx context.Context) (name, logoSrc string) {
	b := branding.Load(ctx, n.Queries, true)
	if len(b.Logo) > 0 {
		logoSrc = "cid:" + scheduleLogoCID
	}
	return b.AppTitle, logoSrc
}

// agendaMail arma un correo de la Agenda con la plantilla de lista del legacy.
func (n *Notifier) agendaMail(ctx context.Context, title, period, intro string, items []mailtpl.AgendaItem, openTickets int, loc *time.Location) (string, error) {
	name, logo := n.brand(ctx)
	return mailtpl.RenderAgendaDigest(mailtpl.AgendaDigestOptions{
		Items: items, Title: title, PeriodLabel: period, Intro: intro, LogoSrc: logo, BrandName: name, OpenTickets: openTickets,
		Year: n.now().In(loc).Year(), Location: loc,
	})
}

func (n *Notifier) fail(ctx context.Context, kind string, err error) {
	if n.AuditLog != nil {
		n.AuditLog.Log(ctx, "notification.failed", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"kind": kind})
	}
}

// Purge borra lo que pasó el tiempo que guarda la campana.
func (n *Notifier) Purge(ctx context.Context) error {
	s, err := n.Queries.GetNotificationSettings(ctx)
	if err != nil {
		return err
	}
	_, err = n.Queries.PurgeOldNotifications(ctx, s.RetentionDays)
	return err
}

// areaMembers: la gente activa de un área.
func (n *Notifier) areaMembers(ctx context.Context, area uuid.UUID) []uuid.UUID {
	ids, err := n.Queries.ListAreaMemberIDs(ctx, area)
	if err != nil {
		return nil
	}
	return ids
}

// windowNotifications avisa que empezó o terminó una ventana de mantenimiento
// a la gente del área a la que aplica (la de la ventana, del activo o del
// equipo; si no tiene, a quien la creó).
func (n *Notifier) Windows(ctx context.Context) error {
	rows, err := n.Queries.ListWindowsToNotify(ctx)
	if err != nil {
		return err
	}
	now := n.now()
	loc := time.UTC
	if s, err := n.Queries.GetAgendaSettings(ctx); err == nil {
		if l, err := time.LoadLocation(s.Timezone); err == nil {
			loc = l
		}
	}
	for _, w := range rows {
		users := []uuid.UUID{w.CreatedBy}
		if w.AreaID != uuid.Nil {
			users = n.areaMembers(ctx, w.AreaID)
		}
		var title string
		switch {
		case !w.NotifiedEnd && !w.EndsAt.Time.After(now):
			title = "Terminó la ventana «" + w.Title + "»"
		default:
			title = "Empieza la ventana «" + w.Title + "»"
		}
		n.Send(ctx, users, NotifMsg{Kind: NotifWindow, Title: title, Link: "/escalation",
			Body: w.StartsAt.Time.In(loc).Format("02-01 15:04") + " → " + w.EndsAt.Time.In(loc).Format("02-01 15:04")})
		if err := n.Queries.MarkWindowNotified(ctx, w.ID); err != nil {
			return err
		}
	}
	return nil
}

// pgTime convierte un instante para los parámetros de sqlc.
func pgTime(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// userNameOr: el nombre de una persona para los textos de los avisos.
func (n *Notifier) userNameOr(ctx context.Context, id uuid.UUID) string {
	rows, err := n.Queries.ListNotifyUsers(ctx, []uuid.UUID{id})
	if err != nil || len(rows) == 0 {
		return "Alguien"
	}
	return rows[0].Name
}
