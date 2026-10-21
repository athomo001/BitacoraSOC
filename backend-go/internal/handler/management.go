package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/tickets"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Gestión CSM (spec/16 §4.4, 9.4; diseño aprobado por la CSM y el dueño
// 2026-10-20). Pestañas Clientes, Metas, Indicadores y Plantillas.
//   - La ven el perfil Gestión, las jefaturas y el admin (pregunta 1 del
//     dueño). Todos los CSM ven a todos los clientes; «Mis cuentas» filtra
//     por el CSM a cargo.
//   - Las acciones son tareas de la Agenda ligadas a un cliente (con tipo,
//     tarea clave y ticket); las plantillas crean tareas normales.
//   - El semáforo de cada cuenta se calcula solo (§4.4.1); nadie cambia el
//     color a mano.

// ManagementHandler atiende /api/management/*, /api/goals/* y /api/playbooks/*.
type ManagementHandler struct {
	Queries *db.Queries
	// Pool abre las transacciones (en las pruebas, una transacción externa).
	Pool interface {
		Begin(ctx context.Context) (pgx.Tx, error)
	}
	AuditLog *audit.Logger
	Hub      eventPublisher
	// Agenda genera las ocurrencias de las tareas nuevas y avisa al responsable.
	Agenda *AgendaHandler
	// Exportar resumen por correo: Notify envía, Reports da los dominios válidos.
	Notify  *Notifier
	Reports *ReportsHandler
	Now     func() time.Time
}

func (h *ManagementHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// Umbrales fijos de la salud de la cuenta (§4.4.1).
const (
	healthMeetingDays = 30
	healthContactDays = 60
)

// canManage: perfil Gestión, jefatura de algún área o admin.
func (u agendaUser) canManage() bool { return u.admin || u.gestion || len(u.leads) > 0 }

// managementUser carga al usuario y corta con 403 si no ve Gestión.
func (h *ManagementHandler) managementUser(w http.ResponseWriter, r *http.Request) (agendaUser, bool) {
	u, err := loadAgendaUser(r.Context(), h.Queries)
	if err != nil {
		mgmtFail(w, r)
		return u, false
	}
	if !u.canManage() {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "Gestión es del perfil Gestión, las jefaturas y el admin")
		return u, false
	}
	return u, true
}

func mgmtFail(w http.ResponseWriter, r *http.Request) {
	problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer o guardar la Gestión")
}

// mgmtClock: el calendario hábil, hoy y desde qué fecha una pendiente está atrasada.
type mgmtClock struct {
	ac         agendaCal
	now, today time.Time
	lateBefore time.Time
}

func (h *ManagementHandler) clock(ctx context.Context) (mgmtClock, error) {
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, now.AddDate(-1, 0, 0), now.AddDate(1, 0, 0))
	if err != nil {
		return mgmtClock{}, err
	}
	c := mgmtClock{ac: ac, now: now, today: agenda.Day(now, ac.loc)}
	// Vence al final del horario hábil de su día: pasado ese horario, hoy ya está atrasada.
	c.lateBefore = c.today
	if now.After(ac.dueAt(c.today)) {
		c.lateBefore = c.today.AddDate(0, 0, 1)
	}
	return c, nil
}

// ===== Salud de la cuenta =====

type healthInput struct {
	Breached       int
	BreachedFirst  string
	KeyLate        int
	KeyLateFirst   string
	LastContact    *time.Time
	ContactKind    string
	LastMeeting    *time.Time
	MeetingKind    string
	OpenTickets    int
	Baseline       time.Time
	Today          time.Time
	Loc            *time.Location
	MeetingDays    int
	ContactDaysMax int
}

// healthReason: por qué la cuenta tiene su color, en orden de gravedad. La
// pantalla arma el texto («TKT-2026-00039 fuera de SLA»).
type healthReason struct {
	Code   string `json:"code"` // ticketBreached | noContact | keyLate | noMeeting
	Ticket string `json:"ticket,omitempty"`
	Task   string `json:"task,omitempty"`
	Count  int    `json:"count,omitempty"`
	Days   int    `json:"days,omitempty"`
}

type healthDTO struct {
	State   string         `json:"state"` // green | amber | red
	Reasons []healthReason `json:"reasons"`
	// Componentes: tickets, contacto y tareas clave, cada uno con su color.
	Tickets struct {
		State    string `json:"state"`
		Open     int    `json:"open"`
		Breached int    `json:"breached"`
		First    string `json:"first,omitempty"`
	} `json:"tickets"`
	Contact struct {
		State       string `json:"state"`
		ContactDays int    `json:"contactDays"`
		ContactKind string `json:"contactKind,omitempty"`
		MeetingDays int    `json:"meetingDays"`
		MeetingKind string `json:"meetingKind,omitempty"`
		// FromBaseline: no hubo contacto desde el inicio del servicio o de la Gestión.
		FromBaseline bool `json:"fromBaseline"`
	} `json:"contact"`
	KeyTasks struct {
		State string `json:"state"`
		Late  int    `json:"late"`
		First string `json:"first,omitempty"`
	} `json:"keyTasks"`
}

// daysSince: días corridos desde el último contacto o desde la línea base
// (inicio del servicio o de la Gestión), lo más reciente.
func daysSince(last *time.Time, baseline, today time.Time, loc *time.Location) (int, bool) {
	from := baseline
	fromBaseline := true
	if last != nil {
		if d := agenda.Day(*last, loc); !d.Before(baseline) {
			from, fromBaseline = d, false
		}
	}
	days := int(today.Sub(from).Hours() / 24)
	if days < 0 {
		days = 0
	}
	return days, fromBaseline
}

// clientHealth aplica la regla de la CSM (§4.4.1): rojo con un ticket fuera
// de SLA o más de 60 días sin contacto; amarillo con más de 30 días sin
// Reunión ni Comité o una tarea clave atrasada; verde si no.
func clientHealth(in healthInput) healthDTO {
	h := healthDTO{State: "green", Reasons: []healthReason{}}
	h.Tickets.State, h.Tickets.Open, h.Tickets.Breached, h.Tickets.First = "green", in.OpenTickets, in.Breached, in.BreachedFirst
	h.Contact.State, h.KeyTasks.State = "green", "green"
	contactDays, contactBase := daysSince(in.LastContact, in.Baseline, in.Today, in.Loc)
	meetingDays, _ := daysSince(in.LastMeeting, in.Baseline, in.Today, in.Loc)
	h.Contact.ContactDays, h.Contact.ContactKind, h.Contact.MeetingDays, h.Contact.MeetingKind = contactDays, in.ContactKind, meetingDays, in.MeetingKind
	h.Contact.FromBaseline = contactBase
	meetingMax, contactMax := in.MeetingDays, in.ContactDaysMax
	if meetingMax == 0 {
		meetingMax = healthMeetingDays
	}
	if contactMax == 0 {
		contactMax = healthContactDays
	}
	var red, amber []healthReason
	if in.Breached > 0 {
		h.Tickets.State = "red"
		red = append(red, healthReason{Code: "ticketBreached", Ticket: in.BreachedFirst, Count: in.Breached})
	}
	switch {
	case contactDays > contactMax:
		h.Contact.State = "red"
		red = append(red, healthReason{Code: "noContact", Days: contactDays})
	case meetingDays > meetingMax:
		h.Contact.State = "amber"
		amber = append(amber, healthReason{Code: "noMeeting", Days: meetingDays})
	}
	if in.KeyLate > 0 {
		h.KeyTasks.State, h.KeyTasks.Late, h.KeyTasks.First = "amber", in.KeyLate, in.KeyLateFirst
		amber = append(amber, healthReason{Code: "keyLate", Task: in.KeyLateFirst, Count: in.KeyLate})
	}
	if len(red) > 0 {
		h.State = "red"
	} else if len(amber) > 0 {
		h.State = "amber"
	}
	h.Reasons = append(append(h.Reasons, red...), amber...)
	return h
}

// ===== Cartera =====

type mgmtClientDTO struct {
	ID           uuid.UUID  `json:"id"`
	Name         string     `json:"name"`
	Active       bool       `json:"active"`
	CsmID        *uuid.UUID `json:"csmId,omitempty"`
	CsmName      string     `json:"csmName,omitempty"`
	Mine         bool       `json:"mine"`
	ServiceStart *string    `json:"serviceStart,omitempty"`
	Renewal      *string    `json:"renewal,omitempty"`
	RenewalDays  *int       `json:"renewalDays,omitempty"`
	SLATarget    *int32     `json:"slaTarget,omitempty"`
	OpenTickets  int32      `json:"openTickets"`
	Breached     int32      `json:"breached"`
	LateActions  int32      `json:"lateActions"`
	Health       healthDTO  `json:"health"`
	NextAction   *struct {
		Name string `json:"name"`
		Due  string `json:"due"`
	} `json:"nextAction,omitempty"`
}

func dateStrPtr(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := agenda.FormatDate(d.Time)
	return &s
}

func (h *ManagementHandler) clientDTO(row db.ListManagementClientsRow, c mgmtClock, settings db.ManagementSetting, me uuid.UUID) mgmtClientDTO {
	d := mgmtClientDTO{ID: row.ID, Name: row.Name, Active: row.Active, CsmID: uuidPtr(row.CsmUserID), CsmName: row.CsmName,
		Mine: uuidEq(row.CsmUserID, me), ServiceStart: dateStrPtr(row.ServiceStartDate), Renewal: dateStrPtr(row.RenewalDate),
		OpenTickets: row.OpenTickets, Breached: row.BreachedTickets, LateActions: row.LateActions}
	if row.SlaTarget.Valid {
		d.SLATarget = &row.SlaTarget.Int32
	}
	if row.RenewalDate.Valid {
		days := int(row.RenewalDate.Time.Sub(c.today).Hours() / 24)
		d.RenewalDays = &days
	}
	baseline := settings.StartedOn.Time
	if row.ServiceStartDate.Valid && row.ServiceStartDate.Time.After(baseline) {
		baseline = row.ServiceStartDate.Time
	}
	d.Health = clientHealth(healthInput{Breached: int(row.BreachedTickets), BreachedFirst: row.BreachedFirst, KeyLate: int(row.KeyLate),
		KeyLateFirst: row.KeyLateFirst, LastContact: timestamptzPtr(row.LastContactAt), ContactKind: row.LastContactKind,
		LastMeeting: timestamptzPtr(row.LastMeetingAt), MeetingKind: row.LastMeetingKind, OpenTickets: int(row.OpenTickets),
		Baseline: baseline, Today: c.today, Loc: c.ac.loc})
	if row.NextActionName != "" && row.NextActionDue.Valid {
		d.NextAction = &struct {
			Name string `json:"name"`
			Due  string `json:"due"`
		}{row.NextActionName, agenda.FormatDate(row.NextActionDue.Time)}
	}
	return d
}

// Clients es GET /api/management/clients: la cartera con su semáforo.
func (h *ManagementHandler) Clients(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	settings, err := h.Queries.GetManagementSettings(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	rows, err := h.Queries.ListManagementClients(ctx, db.ListManagementClientsParams{Now: pgtype.Timestamptz{Time: c.now, Valid: true}, LateBefore: pgDate(c.lateBefore)})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	out := make([]mgmtClientDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, h.clientDTO(row, c, settings, u.id))
	}
	writeData(w, http.StatusOK, out)
}

// ===== Ficha del cliente =====

type mgmtTicketDTO struct {
	ID         uuid.UUID      `json:"id"`
	Number     string         `json:"number"`
	Title      string         `json:"title"`
	Area       string         `json:"area"`
	Priority   string         `json:"priority"`
	Status     string         `json:"status"`
	Source     string         `json:"source"`
	Resolution *tickets.Clock `json:"resolution,omitempty"`
}

type mgmtActionDTO struct {
	OccurrenceID uuid.UUID `json:"occurrenceId"`
	TaskID       uuid.UUID `json:"taskId"`
	Name         string    `json:"name"`
	Kind         *string   `json:"kind,omitempty"`
	Key          bool      `json:"key"`
	TicketNumber string    `json:"ticketNumber,omitempty"`
	Due          string    `json:"due"`
	Late         bool      `json:"late"`
	// Quién: quien la tiene o, si nadie la tomó, la persona, el nivel o la guardia.
	Holder       string `json:"holder,omitempty"`
	AssigneeKind string `json:"assigneeKind"`
	Person       string `json:"person,omitempty"`
	Area         string `json:"area"`
	Level        string `json:"level,omitempty"`
	Team         string `json:"team,omitempty"`
}

type mgmtCommDTO struct {
	Kind  string    `json:"kind"`
	Title string    `json:"title"`
	At    time.Time `json:"at"`
}

type mgmtTimelineDTO struct {
	At     time.Time `json:"at"`
	Kind   string    `json:"kind"`
	Title  string    `json:"title"`
	Detail string    `json:"detail,omitempty"`
}

type mgmtRenewalStepDTO struct {
	Name     string     `json:"name"`
	Due      string     `json:"due"`
	Status   string     `json:"status"`
	ClosedAt *time.Time `json:"closedAt,omitempty"`
}

type mgmtFiguresDTO struct {
	OnTimePct         int     `json:"onTimePct"`
	SLAPct            int     `json:"slaPct"`
	SLATarget         int32   `json:"slaTarget"`
	OpenLate          int     `json:"openLate"`
	AvgResponseSecs   float64 `json:"avgResponseSecs"`
	AvgResolutionSecs float64 `json:"avgResolutionSecs"`
}

type mgmtClientDetailDTO struct {
	Client   mgmtClientDTO        `json:"client"`
	Figures  mgmtFiguresDTO       `json:"figures"`
	Tickets  []mgmtTicketDTO      `json:"tickets"`
	Actions  []mgmtActionDTO      `json:"actions"`
	Goals    []goalDTO            `json:"goals"`
	Comms    []mgmtCommDTO        `json:"comms"`
	Timeline []mgmtTimelineDTO    `json:"timeline"`
	Renewal  []mgmtRenewalStepDTO `json:"renewal"`
	// Applied: las plantillas del sistema aplicadas al cliente (clave → fecha).
	Applied map[string]string `json:"applied"`
}

// slaTargetFor: el objetivo del cliente si su contrato lo pide; si no, el global.
func slaTargetFor(row db.ListManagementClientsRow, settings db.ManagementSetting) int32 {
	if row.SlaTarget.Valid {
		return row.SlaTarget.Int32
	}
	return settings.SlaTarget
}

// Client es GET /api/management/clients/{id}: la ficha.
func (h *ManagementHandler) Client(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	settings, err := h.Queries.GetManagementSettings(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	rows, err := h.Queries.ListManagementClients(ctx, db.ListManagementClientsParams{Now: pgtype.Timestamptz{Time: c.now, Valid: true},
		LateBefore: pgDate(c.lateBefore), ClientID: pgUUIDOf(id)})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if len(rows) == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	row := rows[0]
	d := mgmtClientDetailDTO{Client: h.clientDTO(row, c, settings, u.id), Tickets: []mgmtTicketDTO{}, Actions: []mgmtActionDTO{},
		Goals: []goalDTO{}, Comms: []mgmtCommDTO{}, Timeline: []mgmtTimelineDTO{}, Renewal: []mgmtRenewalStepDTO{}, Applied: map[string]string{}}

	// Cifras del mes en curso.
	from, to := periodRange("month", c)
	stats, err := h.periodStats(ctx, "client", from, to, c)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	s := stats[id]
	d.Figures = mgmtFiguresDTO{OnTimePct: s.onTimePct(), SLAPct: s.slaPct(), SLATarget: slaTargetFor(row, settings), OpenLate: s.openLate + int(row.BreachedTickets),
		AvgResponseSecs: s.avgResponse, AvgResolutionSecs: s.avgResolution}

	atRisk := tickets.DefaultAtRiskPercent
	if ts, err := h.Queries.GetTicketSettings(ctx); err == nil {
		atRisk = int(ts.AtRiskPercent)
	}
	open, err := h.Queries.ListClientOpenTickets(ctx, id)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, t := range open {
		dto := mgmtTicketDTO{ID: t.Ticket.ID, Number: t.Ticket.TicketNumber, Title: t.Ticket.Title, Area: t.AreaName,
			Priority: string(t.Ticket.Priority), Status: string(t.Ticket.Status), Source: t.Ticket.Source}
		if t.Ticket.SlaResolutionDueAt.Valid {
			in := slaInput(t.Ticket)
			in.AtRiskPercent = atRisk
			clock := tickets.ResolutionClock(in, c.now)
			dto.Resolution = &clock
		}
		d.Tickets = append(d.Tickets, dto)
	}
	actions, err := h.Queries.ListClientActions(ctx, pgUUIDOf(id))
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, a := range actions {
		d.Actions = append(d.Actions, mgmtActionDTO{OccurrenceID: a.ID, TaskID: a.TaskID, Name: a.Name, Kind: textPtr(a.ActionKind), Key: a.IsKey,
			TicketNumber: a.TicketNumber, Due: agenda.FormatDate(a.DueDate.Time), Late: a.DueDate.Time.Before(c.lateBefore),
			Holder: a.HolderName, AssigneeKind: a.AssigneeKind, Person: a.AssigneeUserName, Area: a.AreaName, Level: a.LevelName, Team: a.TeamName})
	}
	goals, err := h.loadGoals(ctx, db.ListGoalsParams{ClientID: pgUUIDOf(id)}, u, c)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, g := range goals {
		if g.State == "open" || g.State == "risk" || g.State == "confirm" {
			d.Goals = append(d.Goals, g)
		}
	}
	if reps, err := h.Queries.ListClientReports(ctx, pgUUIDOf(id)); err == nil {
		for _, rep := range reps {
			d.Comms = append(d.Comms, mgmtCommDTO{Kind: rep.Kind, Title: rep.Title, At: rep.CreatedAt.Time})
		}
	}
	if tl, err := h.Queries.ListClientTimeline(ctx, id); err == nil {
		for _, ev := range tl {
			d.Timeline = append(d.Timeline, mgmtTimelineDTO{At: ev.At.Time, Kind: ev.Kind, Title: ev.Title, Detail: ev.Detail})
		}
	}
	plans, err := h.Queries.ListClientPlaybookTasks(ctx, id)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	var renewalApp uuid.UUID
	for _, p := range plans {
		if !p.SystemKey.Valid {
			continue
		}
		if _, seen := d.Applied[p.SystemKey.String]; !seen {
			d.Applied[p.SystemKey.String] = agenda.FormatDate(p.AnchorDate.Time)
			if p.SystemKey.String == "renewal" {
				renewalApp = p.ApplicationID
			}
		}
		if p.ApplicationID == renewalApp && renewalApp != uuid.Nil && p.DueDate.Valid {
			d.Renewal = append(d.Renewal, mgmtRenewalStepDTO{Name: p.Name, Due: agenda.FormatDate(p.DueDate.Time), Status: p.Status.String,
				ClosedAt: timestamptzPtr(p.ClosedAt)})
		}
	}
	sort.SliceStable(d.Renewal, func(i, j int) bool { return d.Renewal[i].Due < d.Renewal[j].Due })
	writeData(w, http.StatusOK, d)
}

type updateClientMgmtRequest struct {
	CsmUserID    *uuid.UUID `json:"csmUserId"`
	ServiceStart *string    `json:"serviceStart"`
	Renewal      *string    `json:"renewal"`
	SLATarget    *int32     `json:"slaTarget"`
}

func optDate(s *string) (pgtype.Date, error) {
	if s == nil || *s == "" {
		return pgtype.Date{}, nil
	}
	d, err := agenda.ParseDate(*s)
	if err != nil {
		return pgtype.Date{}, errors.New("fecha inválida (YYYY-MM-DD)")
	}
	return pgDate(d), nil
}

// UpdateClient es PUT /api/management/clients/{id}: CSM a cargo, inicio del
// servicio, renovación y objetivo de SLA propio (vacío = el global).
func (h *ManagementHandler) UpdateClient(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.managementUser(w, r); !ok {
		return
	}
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	var req updateClientMgmtRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	start, err1 := optDate(req.ServiceStart)
	renewal, err2 := optDate(req.Renewal)
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "fecha inválida (YYYY-MM-DD)")
		return
	}
	target := pgtype.Int4{}
	if req.SLATarget != nil {
		if *req.SLATarget < 50 || *req.SLATarget > 100 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el objetivo de SLA va de 50 a 100 %")
			return
		}
		target = pgtype.Int4{Int32: *req.SLATarget, Valid: true}
	}
	n, err := h.Queries.UpdateClientManagement(ctx, db.UpdateClientManagementParams{ID: id, CsmUserID: optionalUUID(req.CsmUserID),
		ServiceStartDate: start, RenewalDate: renewal, SlaTarget: target})
	if isFKViolation(err) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "esa persona no existe")
		return
	}
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "management.client.update", audit.LevelInfo, audit.Success(), map[string]any{"clientId": id.String(),
		"csmUserId": uuidString(req.CsmUserID), "renewal": derefStr(req.Renewal), "serviceStart": derefStr(req.ServiceStart)})
	publishSync(ctx, h.Hub, "management.changed", map[string]string{"clientId": id.String()})
	writeNoContent(w)
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ===== Meta =====

type mgmtNamedDTO struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type mgmtPersonDTO struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	AreaID   uuid.UUID `json:"areaId"`
	AreaName string    `json:"areaName"`
	Level    string    `json:"level,omitempty"`
}

// Meta es GET /api/management/meta: lo que necesitan los formularios de Gestión.
func (h *ManagementHandler) Meta(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	settings, err := h.Queries.GetManagementSettings(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	csms, err := h.Queries.ListCSMUsers(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	people, err := h.Queries.ListGoalPeople(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	out := map[string]any{"slaTarget": settings.SlaTarget, "me": u.id, "admin": u.admin, "gestion": u.gestion}
	leads := []uuid.UUID{}
	for a := range u.leads {
		leads = append(leads, a)
	}
	out["leadAreas"] = leads
	cs := make([]mgmtNamedDTO, 0, len(csms))
	for _, x := range csms {
		cs = append(cs, mgmtNamedDTO{ID: x.ID, Name: x.Name})
	}
	out["csms"] = cs
	// Metas por persona: la jefatura las pone a la gente de su área; el admin, a todos.
	ps := []mgmtPersonDTO{}
	for _, p := range people {
		if u.admin || u.leads[p.AreaID] {
			ps = append(ps, mgmtPersonDTO{ID: p.ID, Name: p.Name, AreaID: p.AreaID, AreaName: p.AreaName, Level: p.LevelName})
		}
	}
	out["people"] = ps
	writeData(w, http.StatusOK, out)
}

// UpdateSettings es PUT /api/management/settings (admin): el objetivo global del SLA.
func (h *ManagementHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SLATarget int32 `json:"slaTarget"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.SLATarget < 50 || req.SLATarget > 100 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el objetivo de SLA va de 50 a 100 %")
		return
	}
	ctx := r.Context()
	if err := h.Queries.UpdateManagementSettings(ctx, req.SLATarget); err != nil {
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "config.management.update", audit.LevelInfo, audit.Success(), map[string]any{"slaTarget": req.SLATarget})
	writeData(w, http.StatusOK, map[string]any{"slaTarget": req.SLATarget})
}

// ===== Acciones de seguimiento de un ticket =====

type mgmtTicketActionDTO struct {
	OccurrenceID uuid.UUID  `json:"occurrenceId"`
	Name         string     `json:"name"`
	Kind         *string    `json:"kind,omitempty"`
	Key          bool       `json:"key"`
	Due          string     `json:"due"`
	Status       string     `json:"status"`
	Late         bool       `json:"late"`
	Who          string     `json:"who"`
	ClosedAt     *time.Time `json:"closedAt,omitempty"`
}

// TicketActions es GET /api/management/tickets/{id}/actions: lo que el CSM
// dejó en marcha para ese ticket (panel del ticket en la Ticketera).
func (h *ManagementHandler) TicketActions(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.managementUser(w, r); !ok {
		return
	}
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ticket no encontrado")
		return
	}
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	rows, err := h.Queries.ListTicketActions(ctx, pgUUIDOf(id))
	if err != nil {
		mgmtFail(w, r)
		return
	}
	out := make([]mgmtTicketActionDTO, 0, len(rows))
	for _, a := range rows {
		out = append(out, mgmtTicketActionDTO{OccurrenceID: a.ID, Name: a.Name, Kind: textPtr(a.ActionKind), Key: a.IsKey,
			Due: agenda.FormatDate(a.DueDate.Time), Status: a.Status, Late: a.Status == "pending" && a.DueDate.Time.Before(c.lateBefore),
			Who: a.Who, ClosedAt: timestamptzPtr(a.ClosedAt)})
	}
	writeData(w, http.StatusOK, out)
}

// ===== Aviso al cliente de una ventana de mantenimiento (§4.6) =====

// windowNoticeBizDays: con cuántos días hábiles de anticipación el CSM le
// avisa al cliente de una ventana de mantenimiento.
const windowNoticeBizDays = 2

// WindowNotice: una ventana que afecta a un cliente con CSM a cargo le deja
// al CSM la tarea clave «Avisar al cliente» antes del inicio (spec/16 §4.6).
// Mejor esfuerzo: la ventana ya quedó creada; un error solo se registra.
func (h *ManagementHandler) WindowNotice(ctx context.Context, client uuid.UUID, title string, start time.Time, actor uuid.UUID) {
	c, err := h.clock(ctx)
	if err != nil {
		return
	}
	rows, err := h.Queries.ListManagementClients(ctx, db.ListManagementClientsParams{Now: pgtype.Timestamptz{Time: c.now, Valid: true},
		LateBefore: pgDate(c.lateBefore), ClientID: pgUUIDOf(client)})
	if err != nil || len(rows) == 0 || !rows[0].CsmUserID.Valid {
		return
	}
	csm := uuid.UUID(rows[0].CsmUserID.Bytes)
	area, err := h.homeArea(ctx, csm)
	if err != nil {
		return
	}
	due := c.ac.cal.AddBusinessDays(agenda.Day(start, c.ac.loc), -windowNoticeBizDays)
	if due.Before(c.today) {
		due = c.today
	}
	rec, _ := json.Marshal(agenda.Recurrence{Kind: agenda.KindOnce, Date: agenda.FormatDate(due)})
	id, err := h.Queries.CreateAgendaTask(ctx, db.CreateAgendaTaskParams{Name: "Avisar al cliente: " + title,
		Description: "Ventana de mantenimiento desde el " + start.In(c.ac.loc).Format("02-01-2006 15:04") + ".", AreaID: area,
		OrganizationID: pgUUIDOf(client), AssigneeKind: "person", AssigneeUserID: pgUUIDOf(csm), Recurrence: rec, WarnDays: []int32{1, 0},
		Steps: []string{}, CreatedBy: pgtype.UUID{Bytes: actor, Valid: actor != uuid.Nil}, ActionKind: optText("contact"), IsKey: true})
	if err != nil {
		h.AuditLog.Log(ctx, "management.window_notice.failed", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"clientId": client.String()})
		return
	}
	if h.Agenda != nil {
		_ = h.Agenda.generate(ctx, true)
		if row, ok, _ := h.Agenda.findTask(ctx, id); ok {
			h.Agenda.notifyAssigned(ctx, row, actor)
		}
	}
	h.AuditLog.Log(ctx, "management.window_notice.created", audit.LevelInfo, audit.Success(), map[string]any{"clientId": client.String(), "taskId": id.String()})
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"taskId": id.String()})
}
