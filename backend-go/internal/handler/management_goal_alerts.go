package handler

import (
	"context"
	"fmt"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// Avisos de vencimiento de las metas (spec/16 §4.4.5: «con los mismos avisos
// de vencimiento que una tarea»): 5 y 1 días hábiles antes y el día, en
// horario hábil; y uno si se venció sin cumplirse. Usan los tipos de aviso de
// la Agenda, así cada persona los apaga o los recibe por correo igual que los
// de una tarea.

// goalWarnDays: con cuántos días hábiles de anticipación avisa una meta.
var goalWarnDays = []int{5, 1}

// goalAlertTargets: a quién avisar. Antes de vencer, a quien la cumple (la
// persona o el responsable); si se venció, también a quien la creó.
func goalAlertTargets(g db.ListGoalsForAlertsRow, late bool) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := []uuid.UUID{}
	add := func(id [16]byte, valid bool) {
		if valid && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	add(g.PersonUserID.Bytes, g.PersonUserID.Valid)
	add(g.OwnerUserID.Bytes, g.OwnerUserID.Valid)
	if late || len(out) == 0 {
		add(g.CreatedBy.Bytes, g.CreatedBy.Valid)
	}
	return out
}

// goalAlert decide qué aviso toca hoy (vacío si ninguno).
func goalAlert(due, today time.Time, businessHours bool, bizDaysLeft int) (alert, kind string) {
	switch {
	case due.Before(today):
		return "late", NotifAgendaLate
	case !businessHours:
		return "", ""
	case due.Equal(today):
		return "due", NotifAgendaDue
	}
	for _, n := range goalWarnDays {
		if bizDaysLeft == n {
			return fmt.Sprintf("warn%d", n), NotifAgendaWarn
		}
	}
	return "", ""
}

// GoalAlerts corre cada 5 minutos.
func (h *ManagementHandler) GoalAlerts(ctx context.Context) error {
	if h.Notify == nil {
		return nil
	}
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, now.AddDate(0, 0, -10), now.AddDate(0, 0, 40))
	if err != nil {
		return err
	}
	today := agenda.Day(now, ac.loc)
	clock := now.In(ac.loc)
	minutes := clock.Hour()*60 + clock.Minute()
	businessHours := ac.cal.IsBusiness(today) && minutes >= ac.start.Hour*60+ac.start.Minute && minutes < ac.end.Hour*60+ac.end.Minute
	goals, err := h.Queries.ListGoalsForAlerts(ctx, db.ListGoalsForAlertsParams{FromDay: pgDate(today.AddDate(0, 0, -7)), ToDay: pgDate(today.AddDate(0, 0, 30))})
	if err != nil {
		return err
	}
	for _, g := range goals {
		due := g.DueDate.Time // un DATE ya es el día (como en la Agenda)
		alert, kind := goalAlert(due, today, businessHours, ac.cal.BusinessDaysBetween(today, due))
		if alert == "" {
			continue
		}
		fresh, err := h.Queries.InsertGoalAlert(ctx, db.InsertGoalAlertParams{GoalID: g.ID, Alert: alert})
		if err != nil {
			return err
		}
		if fresh == 0 {
			continue
		}
		var title, state string
		switch alert {
		case "late":
			title, state = "No se cumplió la meta «"+g.Name+"»", "late"
		case "due":
			title, state = "La meta «"+g.Name+"» vence hoy", "today"
		case "warn1":
			title, state = "La meta «"+g.Name+"» vence mañana hábil", "soon"
		default:
			title, state = fmt.Sprintf("La meta «%s» vence en %s días hábiles", g.Name, alert[len("warn"):]), "soon"
		}
		detail := "Meta"
		if g.ClientName != "" {
			detail = "Meta de " + g.ClientName
		} else if g.AreaName != "" {
			detail = "Meta de " + g.AreaName
		}
		link := "/management?tab=goals"
		if g.Scope == "person" {
			link = "/agenda?tab=goals"
		}
		item := mailtpl.AgendaItem{Task: g.Name, Detail: detail, Due: ac.dueAt(due), State: state}
		h.Notify.Send(ctx, goalAlertTargets(g, alert == "late"), NotifMsg{Kind: kind, Title: title, Body: detail + " · " + agenda.FormatDate(due), Link: link,
			Mail: func(name string) (string, string) {
				html, _ := h.Notify.agendaMail(ctx, title, "", "Hola "+name+". Ábrela en la aplicación.", []mailtpl.AgendaItem{item}, 0, ac.loc)
				return title, html
			}})
	}
	return nil
}
