package handler

import (
	"context"
	"net/http"
	"sort"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// Mi equipo → Actividad (10f, decisión del dueño 2026-10-28): el mapa de
// calor día × hora del legacy (Reportes → Mapa de calor), pero con todo el
// trabajo de la gente del área y no solo las entradas, para ver cuánta
// actividad hay de noche y ajustar la dotación. Sale de la Auditoría, a la
// hora real de cada acción. Lo ven quienes ven la Calidad: la jefatura (sus
// áreas), el admin y el auditor.

// activityPeriods: los períodos, en días hasta hoy (además de un mes).
var activityPeriods = map[int]bool{7: true, 30: true, 90: true}

// activityKinds: los tipos de trabajo que cuentan, en el orden de la pantalla.
var activityKinds = []string{"entries", "mail", "escalation", "tickets", "shift"}

// activityEvents: cada evento de trabajo de la Auditoría y su tipo. Lleva
// también los nombres del legacy, que el ETL migra tal cual, para que la
// historia cuente desde el corte. Fuera quedan los logins, las vistas y la
// configuración.
var activityEvents = map[string]string{
	// Bitácora
	"entry.created": "entries", "entry.created_with_ticket": "entries", "entry.updated": "entries",
	"entry.comment_added": "entries", "entry.resolved": "entries", "entry.image_uploaded": "entries",
	"entry.follow_up.opened": "entries", "entry.follow_up.closed": "entries", "entry.converted_to_ticket": "entries",
	"entry.ticket_linked": "entries", "entry.glpi_linked": "entries",
	"entry.create": "entries", "entry.update": "entries", "entry.glpi.link": "entries",
	// Correos enviados
	"escalation.notify.sent": "mail", "report.incident.sent": "mail", "report.bulletin.sent": "mail",
	"management.summary.sent": "mail", "team.monthly.sent": "mail",
	"escalation.email.sent": "mail", "mail.incident.sent": "mail", "newsletter.send.completed": "mail",
	// Escalamiento
	"escalation.action": "escalation", "escalation.incident.opened": "escalation", "escalation.incident.note": "escalation",
	"escalation.incident.closed": "escalation", "escalation.incident.reopened": "escalation",
	"client_alert.acknowledged": "escalation", "escalation.client_alert.ack": "escalation",
	// Tickets
	"ticket.created": "tickets", "ticket.updated": "tickets", "ticket.assigned": "tickets",
	"ticket.comment_added": "tickets", "ticket.task_added": "tickets", "ticket.task_updated": "tickets",
	"ticket.merged": "tickets", "ticket.derived": "tickets", "ticket.move": "tickets",
	"ticket.client_changed": "tickets", "ticket.place_changed": "tickets", "ticket.image_uploaded": "tickets",
	"ticket.parent_set": "tickets", "glpi.ticket.created": "tickets",
	// Checklist, cierre de turno y tareas de la Agenda
	"checklist.opened": "shift", "shift.closed": "shift", "shift.handover_acknowledged": "shift",
	"agenda.occurrence.taken": "shift", "agenda.occurrence.done": "shift", "agenda.occurrence.steps": "shift",
	"shiftcheck.submit": "shift", "shift.closure": "shift",
}

type activityPersonDTO struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Level string    `json:"level"`
}

// activityCellDTO: las acciones de una persona de un tipo en un día de la
// semana (1 = lunes … 7 = domingo) y una hora (0-23).
type activityCellDTO struct {
	UserID uuid.UUID `json:"userId"`
	Kind   string    `json:"kind"`
	Day    int       `json:"day"`
	Hour   int       `json:"hour"`
	Count  int       `json:"count"`
}

type activityDataDTO struct {
	AreaCode string `json:"areaCode"`
	AreaName string `json:"areaName"`
	// Days: 7, 30 o 90; 0 si se pidió un mes (Month, YYYY-MM).
	Days   int                 `json:"days"`
	Month  string              `json:"month,omitempty"`
	From   string              `json:"from"`
	To     string              `json:"to"`
	Kinds  []string            `json:"kinds"`
	People []activityPersonDTO `json:"people"`
	Cells  []activityCellDTO   `json:"cells"`
}

// Activity es GET /api/team/activity?area=CODE (o ?department=ID) &days=7|30|90 o &month=YYYY-MM.
func (h *TeamHandler) Activity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	var code, name string
	var areas []db.ListLeadAreasRow
	if dep := q.Get("department"); dep != "" {
		_, d, depAreas, ok := h.departmentScope(w, r, dep, false)
		if !ok {
			return
		}
		name, areas = d.Name, depAreas
	} else {
		user, _ := middleware.UserFromContext(ctx)
		visible, _, err := h.visibleAreas(ctx, user)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
			return
		}
		for _, a := range visible {
			if a.Code == q.Get("area") {
				code, name, areas = a.Code, a.Name, []db.ListLeadAreasRow{a}
			}
		}
		if code == "" {
			problemdetails.Write(w, r, http.StatusForbidden, "not-area-lead", "no eres jefatura de esa área")
			return
		}
	}
	p, err := h.period(q.Get("days"), q.Get("month"), activityPeriods, "el período es de 7, 30 o 90 días, o un mes")
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", err.Error())
		return
	}
	d, err := h.activity(ctx, code, name, areas, p)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular la actividad")
		return
	}
	writeData(w, http.StatusOK, d)
}

// activity: las acciones de la gente de esas áreas (cada persona una vez) en el período.
func (h *TeamHandler) activity(ctx context.Context, code, name string, areas []db.ListLeadAreasRow, p qualityRange) (activityDataDTO, error) {
	out := activityDataDTO{AreaCode: code, AreaName: name, Days: p.days, Month: p.month, Kinds: activityKinds,
		From: p.fromAt.Format("2006-01-02"), To: p.toAt.AddDate(0, 0, -1).Format("2006-01-02"),
		People: []activityPersonDTO{}, Cells: []activityCellDTO{}}
	seen := map[uuid.UUID]bool{}
	var ids []uuid.UUID
	for _, a := range areas {
		rows, err := h.areaPeople(ctx, a.ID)
		if err != nil {
			return out, err
		}
		for _, person := range rows {
			if !seen[person.ID] {
				seen[person.ID] = true
				ids = append(ids, person.ID)
				out.People = append(out.People, activityPersonDTO{ID: person.ID, Name: person.Name, Level: person.Level})
			}
		}
	}
	sort.SliceStable(out.People, func(i, j int) bool { return out.People[i].Name < out.People[j].Name })
	if len(ids) == 0 {
		return out, nil
	}
	events := make([]string, 0, len(activityEvents))
	for e := range activityEvents {
		events = append(events, e)
	}
	rows, err := h.Queries.ListActivityCounts(ctx, db.ListActivityCountsParams{Tz: teamLocation().String(), UserIds: ids,
		FromAt: pgTime(p.fromAt), ToAt: pgTime(p.toAt), Events: events})
	if err != nil {
		return out, err
	}
	// Varios eventos del mismo tipo caen en la misma celda: se suman.
	type key struct {
		user      uuid.UUID
		kind      string
		day, hour int
	}
	sum := map[key]int{}
	for _, row := range rows {
		sum[key{row.UserID, activityEvents[row.Event], int(row.Day), int(row.Hour)}] += int(row.N)
	}
	for k, n := range sum {
		out.Cells = append(out.Cells, activityCellDTO{UserID: k.user, Kind: k.kind, Day: k.day, Hour: k.hour, Count: n})
	}
	sort.Slice(out.Cells, func(i, j int) bool {
		a, b := out.Cells[i], out.Cells[j]
		if a.Day != b.Day {
			return a.Day < b.Day
		}
		if a.Hour != b.Hour {
			return a.Hour < b.Hour
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.UserID.String() < b.UserID.String()
	})
	return out, nil
}
