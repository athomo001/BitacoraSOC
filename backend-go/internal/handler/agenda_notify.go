package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// Avisos de la Agenda (spec/16 §4.3 y §4.5, 9.5): al asignar, al traspasar,
// por ausencia (a la jefatura), los N días hábiles antes, el mismo día y el
// atraso (solo al responsable). Los de antes y del día salen en horario
// hábil; el atraso, siempre.

const agendaLink = "/agenda"

// levelMembers: la gente de un nivel en un área.
func (h *AgendaHandler) levelMembers(ctx context.Context, area, level uuid.UUID) []uuid.UUID {
	people, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		return nil
	}
	var out []uuid.UUID
	for _, p := range people {
		if p.AreaID == area && p.LevelID.Valid && uuid.UUID(p.LevelID.Bytes) == level {
			out = append(out, p.UserID)
		}
	}
	return out
}

// guardNow: quienes están de guardia ahora en una guardia.
func (h *AgendaHandler) guardNow(ctx context.Context, team uuid.UUID) []uuid.UUID {
	current, err := resolveCurrentTeamMembers(ctx, h.Queries, team, h.now())
	if err != nil || len(current) == 0 {
		return nil
	}
	members, err := h.Queries.ListTeamMembers(ctx, team)
	if err != nil {
		return nil
	}
	var out []uuid.UUID
	for _, c := range current {
		for _, m := range members {
			if m.ID == c.TeamMemberID && m.UserID.Valid {
				out = append(out, uuid.UUID(m.UserID.Bytes))
			}
		}
	}
	return out
}

// assignees: a quiénes les toca una tarea según su responsable.
func (h *AgendaHandler) assignees(ctx context.Context, t db.ListAgendaTasksRow) []uuid.UUID {
	switch t.AssigneeKind {
	case "person":
		if t.AssigneeUserID.Valid {
			return []uuid.UUID{uuid.UUID(t.AssigneeUserID.Bytes)}
		}
	case "level":
		if t.AssigneeLevelID.Valid {
			return h.levelMembers(ctx, t.AreaID, uuid.UUID(t.AssigneeLevelID.Bytes))
		}
	case "guard":
		if t.AssigneeTeamID.Valid {
			return h.guardNow(ctx, uuid.UUID(t.AssigneeTeamID.Bytes))
		}
	}
	return nil
}

// occTargets: a quiénes se avisa una ocurrencia: quien la tiene o, sin
// nadie, a quienes se les ofrece (su nivel o la guardia).
func (h *AgendaHandler) occTargets(ctx context.Context, t db.ListAgendaTasksRow, o db.ListAgendaOccurrencesRow) []uuid.UUID {
	if o.UserID.Valid {
		return []uuid.UUID{uuid.UUID(o.UserID.Bytes)}
	}
	if o.OfferedLevelID.Valid {
		return h.levelMembers(ctx, t.AreaID, uuid.UUID(o.OfferedLevelID.Bytes))
	}
	if t.AssigneeKind == "guard" && t.AssigneeTeamID.Valid {
		return h.guardNow(ctx, uuid.UUID(t.AssigneeTeamID.Bytes))
	}
	return nil
}

func (h *AgendaHandler) userName(ctx context.Context, id uuid.UUID) string {
	rows, err := h.Queries.ListNotifyUsers(ctx, []uuid.UUID{id})
	if err != nil || len(rows) == 0 {
		return "Alguien"
	}
	return rows[0].Name
}

func clientSuffix(t db.ListAgendaTasksRow) string {
	if t.OrganizationName != "" {
		return " · " + t.OrganizationName
	}
	return ""
}

// notifyAssigned: «te asignaron una tarea» (a ti, a tu nivel o a tu guardia).
func (h *AgendaHandler) notifyAssigned(ctx context.Context, t db.ListAgendaTasksRow, actor uuid.UUID) {
	if h.Notify == nil {
		return
	}
	who := h.userName(ctx, actor)
	title := fmt.Sprintf("%s te asignó «%s»", who, t.Name)
	switch t.AssigneeKind {
	case "level":
		title = fmt.Sprintf("Nueva tarea para %s de %s: «%s»", t.AssigneeLevelName, t.AreaName, t.Name)
	case "guard":
		title = fmt.Sprintf("Nueva tarea para %s: «%s»", t.AssigneeTeamName, t.Name)
	}
	var rec agenda.Recurrence
	_ = json.Unmarshal(t.Recurrence, &rec)
	body := t.AreaName + clientSuffix(t)
	if rec.Kind == agenda.KindOnce {
		body += " · vence el " + rec.Date
	}
	h.Notify.Send(ctx, h.assignees(ctx, t), NotifMsg{Kind: NotifAgendaAssigned, Title: title, Body: body, Link: agendaLink, Exclude: actor})
}

func (h *AgendaHandler) notifyHandover(ctx context.Context, t db.ListAgendaTasksRow, o db.ListAgendaOccurrencesRow, from, to uuid.UUID) {
	if h.Notify == nil {
		return
	}
	h.Notify.Send(ctx, []uuid.UUID{to}, NotifMsg{Kind: NotifAgendaHandover, Link: agendaLink, Exclude: from,
		Title: fmt.Sprintf("%s te traspasó «%s»", h.userName(ctx, from), t.Name),
		Body:  "Vence el " + agenda.FormatDate(o.DueDate.Time) + clientSuffix(t)})
}

// notifyAbsence avisa a la jefatura del área que una tarea volvió al nivel
// porque quien la tenía está ausente en Dotación.
func (h *AgendaHandler) notifyAbsence(ctx context.Context, t db.ListAgendaTasksRow, o db.ListAgendaOccurrencesRow, level uuid.UUID) {
	if h.Notify == nil {
		return
	}
	leads, err := h.Queries.ListAreaLeadUserIDs(ctx, t.AreaID)
	if err != nil {
		return
	}
	levels, _ := h.Queries.ListLevels(ctx)
	levelName := ""
	for _, l := range levels {
		if l.ID == level {
			levelName = l.Name
		}
	}
	h.Notify.Send(ctx, leads, NotifMsg{Kind: NotifAgendaAbsence, Link: agendaLink,
		Title: fmt.Sprintf("«%s» volvió a %s %s", t.Name, t.AreaName, levelName),
		Body:  fmt.Sprintf("%s está ausente en Dotación el %s.", o.UserName, agenda.FormatDate(o.DueDate.Time))})
}

// ===== Ventana de mantenimiento desde una tarea =====

type agendaWindowRequest struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	Suppress bool   `json:"suppress"`
}

// createTaskWindow crea la ventana con la fecha de la tarea (solo tareas de
// una vez). Aplica al cliente de la tarea o, sin cliente, a su área.
func (h *AgendaHandler) createTaskWindow(ctx context.Context, t db.ListAgendaTasksRow, req agendaTaskRequest, actor uuid.UUID) error {
	if req.Recurrence.Kind != agenda.KindOnce {
		return errors.New("la ventana de mantenimiento se crea solo desde tareas de una vez")
	}
	start, err1 := agenda.ParseClock(req.Window.Start)
	end, err2 := agenda.ParseClock(req.Window.End)
	if err1 != nil || err2 != nil {
		return errors.New("hora de inicio y de fin de la ventana (HH:MM)")
	}
	ac, err := loadAgendaCal(ctx, h.Queries, h.now(), h.now())
	if err != nil {
		return err
	}
	day, _ := agenda.ParseDate(req.Recurrence.Date)
	from, to := start.At(day, ac.loc), end.At(day, ac.loc)
	if !to.After(from) {
		to = end.At(day.AddDate(0, 0, 1), ac.loc) // pasa la medianoche
	}
	p := db.CreateMaintenanceWindowParams{AgendaTaskID: pgUUIDOf(t.ID), Title: t.Name, StartsAt: pgTime(from), EndsAt: pgTime(to),
		SuppressNotifications: req.Window.Suppress, Priority: 100, CreatedBy: actor}
	if t.OrganizationID.Valid {
		p.OrganizationID = t.OrganizationID
	} else {
		p.AreaID = pgUUIDOf(t.AreaID)
	}
	w, err := h.Queries.CreateMaintenanceWindow(ctx, p)
	if err != nil {
		return err
	}
	h.AuditLog.Log(ctx, "maintenance_window.create", audit.LevelInfo, audit.Success(), map[string]any{"windowId": w.ID.String(), "fromTask": t.ID.String()})
	return nil
}

// ===== Avisos periódicos =====

// Alerts revisa las ocurrencias pendientes y avisa lo que toca: los avisos
// de antes, «vence hoy» y el atraso. Cada aviso sale una sola vez.
func (h *AgendaHandler) Alerts(ctx context.Context) error {
	if h.Notify == nil {
		return nil
	}
	_ = h.generate(ctx, false)
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, now.AddDate(0, 0, -10), now.AddDate(0, 0, 40))
	if err != nil {
		return err
	}
	today := agenda.Day(now, ac.loc)
	clock := now.In(ac.loc)
	minutes := clock.Hour()*60 + clock.Minute()
	businessHours := ac.cal.IsBusiness(today) && minutes >= ac.start.Hour*60+ac.start.Minute && minutes < ac.end.Hour*60+ac.end.Minute
	tasks, err := h.Queries.ListAgendaTasks(ctx, false)
	if err != nil {
		return err
	}
	byID := map[uuid.UUID]db.ListAgendaTasksRow{}
	for _, t := range tasks {
		byID[t.ID] = t
	}
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{
		FromDay: pgDate(today.AddDate(0, 0, -7)), ToDay: pgDate(today.AddDate(0, 0, 40)), WithLate: false})
	if err != nil {
		return err
	}
	for _, o := range occs {
		t, ok := byID[o.TaskID]
		if !ok || o.Status != "pending" || t.Paused {
			continue
		}
		due := o.DueDate.Time
		dueAt := ac.dueAt(due)
		var alert, kind, title string
		var state string
		switch {
		case now.After(dueAt):
			if due.Before(today.AddDate(0, 0, -7)) {
				continue
			}
			alert, kind, state, title = "late", NotifAgendaLate, "late", "Atrasada: «"+t.Name+"»"
		case !businessHours:
			continue
		case due.Equal(today) && containsInt32(t.WarnDays, 0):
			alert, kind, state, title = "due", NotifAgendaDue, "today", "Vence hoy: «"+t.Name+"»"
		default:
			n := ac.cal.BusinessDaysBetween(today, due)
			if n <= 0 || !containsInt32(t.WarnDays, int32(n)) {
				continue
			}
			alert, kind, state = fmt.Sprintf("warn%d", n), NotifAgendaWarn, "soon"
			title = fmt.Sprintf("«%s» vence en %d días hábiles", t.Name, n)
			if n == 1 {
				title = fmt.Sprintf("«%s» vence mañana hábil", t.Name)
			}
		}
		fresh, err := h.Queries.InsertAgendaAlert(ctx, db.InsertAgendaAlertParams{OccurrenceID: o.ID, Alert: alert})
		if err != nil {
			return err
		}
		if fresh == 0 {
			continue
		}
		msg := NotifMsg{Kind: kind, Title: title, Body: t.AreaName + clientSuffix(t) + " · " + agenda.FormatDate(due), Link: agendaLink}
		if kind == NotifAgendaDue {
			msg.GroupKey = "agenda.due:" + agenda.FormatDate(today)
			msg.GroupTitle = func(c int) string { return fmt.Sprintf("%d tareas vencen hoy", c) }
		}
		item := mailtpl.AgendaItem{Task: t.Name, Detail: t.AreaName, Who: agendaWho(t, o), Client: t.OrganizationName, Due: dueAt, State: state}
		msg.Mail = func(name string) (string, string) {
			html, _ := h.Notify.agendaMail(ctx, title, "", "Hola "+name+". Ábrela en la Agenda de la aplicación.", []mailtpl.AgendaItem{item}, 0, ac.loc)
			return title, html
		}
		h.Notify.Send(ctx, h.occTargets(ctx, t, o), msg)
	}
	return nil
}

func containsInt32(list []int32, v int32) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func agendaWho(t db.ListAgendaTasksRow, o db.ListAgendaOccurrencesRow) string {
	switch {
	case o.UserName != "":
		return o.UserName
	case o.OfferedLevelName != "":
		return t.AreaName + " " + o.OfferedLevelName
	case t.AssigneeKind == "guard":
		return t.AssigneeTeamName
	}
	return t.AssigneeLevelName
}

// Digest envía el resumen diario: los días hábiles de la Agenda, a la hora
// que fija el admin (08:00 por defecto), a quien tiene algo y no lo apagó.
// Un solo nodo lo envía (el que marca el día).
func (h *AgendaHandler) Digest(ctx context.Context) error {
	if h.Notify == nil {
		return nil
	}
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, now.AddDate(0, 0, -10), now.AddDate(0, 0, 40))
	if err != nil {
		return err
	}
	today := agenda.Day(now, ac.loc)
	settings, err := h.Queries.GetNotificationSettings(ctx)
	if err != nil {
		return err
	}
	at, err := agenda.ParseClock(settings.DigestTime)
	if err != nil || !ac.cal.IsBusiness(today) || now.Before(at.At(today, ac.loc)) {
		return nil
	}
	if settings.LastDigestDay.Valid && !settings.LastDigestDay.Time.Before(today) {
		return nil
	}
	claimed, err := h.Queries.ClaimDigestDay(ctx, pgDate(today))
	if err != nil || claimed == 0 {
		return err
	}
	return h.sendDigests(ctx, ac, today)
}

func (h *AgendaHandler) sendDigests(ctx context.Context, ac agendaCal, today time.Time) error {
	users, err := h.Queries.ListActiveUserIDs(ctx)
	if err != nil {
		return err
	}
	prefs, err := h.Notify.prefsFor(ctx, users)
	if err != nil {
		return err
	}
	people, err := h.Queries.ListNotifyUsers(ctx, users)
	if err != nil {
		return err
	}
	tickets, err := h.Queries.ListOpenTicketsAssignedCount(ctx)
	if err != nil {
		tickets = nil // sin Ticketera el resumen sale igual
	}
	openTickets := map[uuid.UUID]int{}
	for _, t := range tickets {
		if t.UserID.Valid {
			openTickets[uuid.UUID(t.UserID.Bytes)] = int(t.OpenTickets)
		}
	}
	tasks, err := h.Queries.ListAgendaTasks(ctx, false)
	if err != nil {
		return err
	}
	byID := map[uuid.UUID]db.ListAgendaTasksRow{}
	guardTeams := map[uuid.UUID][]uuid.UUID{}
	for _, t := range tasks {
		byID[t.ID] = t
		if t.AssigneeKind == "guard" && t.AssigneeTeamID.Valid {
			team := uuid.UUID(t.AssigneeTeamID.Bytes)
			if _, ok := guardTeams[team]; !ok {
				guardTeams[team] = h.guardNow(ctx, team)
			}
		}
	}
	horizon := ac.cal.AddBusinessDays(today, 3)
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{FromDay: pgDate(today), ToDay: pgDate(horizon), WithLate: true})
	if err != nil {
		return err
	}
	period := mailtplWeekday(today) + spanishDayLabel(today)[len(strings.ToLower(mailtplWeekday(today))):]
	for _, p := range people {
		if !p.Active || p.Email == "" || !prefs[p.ID].Digest {
			continue
		}
		u, err := agendaUserFor(ctx, h.Queries, p.ID, false)
		if err != nil {
			continue
		}
		var items []mailtpl.AgendaItem
		for _, o := range occs {
			t, ok := byID[o.TaskID]
			if !ok || o.Status != "pending" || t.Paused {
				continue
			}
			mine := uuidEq(o.UserID, p.ID)
			if !o.UserID.Valid {
				if o.OfferedLevelID.Valid {
					_, mine = u.levels[t.AreaID][uuid.UUID(o.OfferedLevelID.Bytes)]
				} else if t.AssigneeKind == "guard" && t.AssigneeTeamID.Valid {
					for _, g := range guardTeams[uuid.UUID(t.AssigneeTeamID.Bytes)] {
						mine = mine || g == p.ID
					}
				}
			}
			if !mine {
				continue
			}
			due := o.DueDate.Time
			state := "soon"
			switch {
			case due.Before(today):
				state = "late"
			case due.Equal(today):
				state = "today"
			}
			items = append(items, mailtpl.AgendaItem{Task: t.Name, Detail: t.AreaName, Who: agendaWho(t, o), Client: t.OrganizationName, Due: ac.dueAt(due), State: state})
		}
		if len(items) == 0 && openTickets[p.ID] == 0 {
			continue
		}
		html, err := h.Notify.agendaMail(ctx, "Tus pendientes de hoy", period, "Lo que ya viste en la campana también está aquí, para tenerlo a mano.", items, openTickets[p.ID], ac.loc)
		if err != nil {
			continue
		}
		h.Notify.mail(ctx, []string{p.Email}, "Tus pendientes de hoy · "+period, html)
	}
	h.AuditLog.Log(ctx, "notification.digest.sent", audit.LevelInfo, audit.Success(), map[string]any{"day": agenda.FormatDate(today)})
	return nil
}

var spanishMonths = [...]string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

func spanishDayLabel(d time.Time) string {
	return fmt.Sprintf("%s %d de %s", strings.ToLower(mailtplWeekday(d)), d.Day(), spanishMonths[d.Month()-1])
}

func mailtplWeekday(d time.Time) string {
	return [...]string{"Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"}[d.Weekday()]
}
