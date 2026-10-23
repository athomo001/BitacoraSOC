package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// AgendaHandler cubre la Agenda (spec/16 §4.3, 9.3, 000041, diseño aprobado
// por el dueño 2026-10-14): tareas programadas (una vez o recurrentes en días
// hábiles) y sus ocurrencias, con Mis pendientes, Calendario y Gestión.
//
// Quién:
//   - Ve las tareas de sus áreas, las que creó y las que le asignaron; el
//     admin y el perfil Gestión ven todas.
//   - Asigna a sí mismo y a los niveles de abajo de su área (N2 → N1;
//     N3 → N2 y N1). La jefatura, a todo su área. Gestión (CSM) y las
//     jefaturas, también a otras áreas. Hacia arriba no: se pide con un ticket.
//   - Una ocurrencia de un nivel la toma cualquiera de ese nivel; la de una
//     guardia, quien esté de guardia. Omitir (con motivo): el responsable y
//     quien la asignó (decisión del dueño 2026-10-14), y el admin.
type AgendaHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Hub      eventPublisher
	Now      func() time.Time
	// Notify avisa asignaciones, traspasos, ausencias, vencimientos y atrasos (9.5).
	Notify *Notifier

	genMu   sync.Mutex
	lastGen time.Time
}

// agendaHorizon: hasta cuántos días adelante se generan las ocurrencias. Más
// allá, el calendario las proyecta sin guardarlas.
const agendaHorizon = 92

// absenceWindow: con cuántos días de anticipación una ausencia de Dotación
// devuelve la tarea al nivel (más lejos, la persona puede volver antes).
const absenceWindow = 7

func (h *AgendaHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// ===== Calendario hábil =====

type agendaCal struct {
	cal        agenda.Calendar
	loc        *time.Location
	start, end agenda.Clock
	settings   db.GetAgendaSettingsRow
}

func loadAgendaCal(ctx context.Context, q *db.Queries, from, to time.Time) (agendaCal, error) {
	s, err := q.GetAgendaSettings(ctx)
	if err != nil {
		return agendaCal{}, err
	}
	ac := agendaCal{cal: agenda.Calendar{Holidays: map[string]string{}}, settings: s}
	for _, d := range s.WorkDays {
		if d >= 0 && d <= 6 {
			ac.cal.WorkDays[d] = true
		}
	}
	if ac.loc, err = time.LoadLocation(s.Timezone); err != nil {
		ac.loc = time.UTC
	}
	ac.start, _ = agenda.ParseClock(s.DayStart)
	ac.end, _ = agenda.ParseClock(s.DayEnd)
	hs, err := q.ListHolidaysBetween(ctx, db.ListHolidaysBetweenParams{FromDay: pgDate(from.AddDate(0, 0, -40)), ToDay: pgDate(to.AddDate(0, 0, 40))})
	if err != nil {
		return ac, err
	}
	for _, x := range hs {
		ac.cal.Holidays[agenda.FormatDate(x.Day.Time)] = x.Name
	}
	return ac, nil
}

// dueAt: una ocurrencia vence al final del horario hábil de su día.
func (ac agendaCal) dueAt(day time.Time) time.Time { return ac.end.At(day, ac.loc) }

// ===== Quién es el usuario para la Agenda =====

type agendaUser struct {
	id      uuid.UUID
	admin   bool
	viewAll bool
	gestion bool
	areas   map[uuid.UUID]bool
	rank    map[uuid.UUID]int
	levels  map[uuid.UUID]map[uuid.UUID]int // área → nivel → rango
	leads   map[uuid.UUID]bool
	// scope: las áreas que ve en Gestión una CSM con alcance (nil = todo).
	scope map[uuid.UUID]bool
}

func loadAgendaUser(ctx context.Context, q *db.Queries) (agendaUser, error) {
	user, _ := middleware.UserFromContext(ctx)
	return agendaUserFor(ctx, q, user.ID, user.Role == "admin")
}

// agendaUserFor arma lo mismo para cualquier persona (el resumen diario).
func agendaUserFor(ctx context.Context, q *db.Queries, id uuid.UUID, admin bool) (agendaUser, error) {
	u := agendaUser{id: id, admin: admin, areas: map[uuid.UUID]bool{}, rank: map[uuid.UUID]int{},
		levels: map[uuid.UUID]map[uuid.UUID]int{}, leads: map[uuid.UUID]bool{}}
	rows, err := q.ListUserAgendaGroups(ctx, id)
	if err != nil {
		return u, err
	}
	for _, r := range rows {
		if r.Profile == "gestion" {
			u.gestion = true
		}
		if !r.AreaID.Valid {
			continue
		}
		area := uuid.UUID(r.AreaID.Bytes)
		u.areas[area] = true
		if r.IsLead {
			u.leads[area] = true
		}
		if int(r.LevelRank) > u.rank[area] {
			u.rank[area] = int(r.LevelRank)
		}
		if r.LevelID.Valid {
			if u.levels[area] == nil {
				u.levels[area] = map[uuid.UUID]int{}
			}
			u.levels[area][uuid.UUID(r.LevelID.Bytes)] = int(r.LevelRank)
		}
	}
	u.viewAll = u.admin || u.gestion
	if u.gestion && !u.admin {
		scope, err := loadManagementScope(ctx, q, id)
		if err != nil {
			return u, err
		}
		u.scope = scope
	}
	return u, nil
}

// crossArea: puede asignar en áreas que no son suyas (Gestión y jefaturas).
func (u agendaUser) crossArea() bool { return u.admin || u.gestion || len(u.leads) > 0 }

// myLevelIn: mi nivel de más rango en el área (para devolver al nivel).
func (u agendaUser) myLevelIn(area uuid.UUID) (uuid.UUID, bool) {
	best, rank, ok := uuid.Nil, -1, false
	for id, r := range u.levels[area] {
		if r > rank {
			best, rank, ok = id, r, true
		}
	}
	return best, ok
}

func (u agendaUser) canSeeTask(t db.ListAgendaTasksRow) bool {
	return u.viewAll || u.areas[t.AreaID] || uuidEq(t.CreatedBy, u.id) || uuidEq(t.AssigneeUserID, u.id)
}

func (u agendaUser) canEditTask(t db.ListAgendaTasksRow) bool {
	return u.admin || uuidEq(t.CreatedBy, u.id) || u.leads[t.AreaID]
}

func uuidEq(a pgtype.UUID, b uuid.UUID) bool { return a.Valid && uuid.UUID(a.Bytes) == b }

func pgUUIDOf(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

// ===== A quién se puede asignar =====

type agendaAssignee struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	Rank    int       `json:"rank,omitempty"`
	Allowed bool      `json:"allowed"`
}

type agendaAreaOptions struct {
	ID     uuid.UUID        `json:"id"`
	Code   string           `json:"code"`
	Name   string           `json:"name"`
	Mine   bool             `json:"mine"`
	Lead   bool             `json:"lead"`
	MyRank int              `json:"myRank"`
	Levels []agendaAssignee `json:"levels"`
	People []agendaAssignee `json:"people"`
	Guards []agendaAssignee `json:"guards"`
}

// assignOptions arma, por área, los niveles, personas y guardias a los que
// el usuario puede asignar (los demás vuelven con allowed=false para que la
// pantalla los muestre apagados).
func (h *AgendaHandler) assignOptions(ctx context.Context, u agendaUser) ([]agendaAreaOptions, error) {
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return nil, err
	}
	levels, err := h.Queries.ListLevels(ctx)
	if err != nil {
		return nil, err
	}
	people, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		return nil, err
	}
	guards, err := h.Queries.ListAgendaGuards(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]agendaAreaOptions, 0, len(areas))
	for _, a := range areas {
		mine := u.areas[a.ID]
		full := u.admin || u.leads[a.ID] || (!mine && u.crossArea())
		if !mine && !full {
			continue
		}
		opt := agendaAreaOptions{ID: a.ID, Code: a.Code, Name: a.Name, Mine: mine, Lead: u.leads[a.ID], MyRank: u.rank[a.ID],
			Levels: []agendaAssignee{}, People: []agendaAssignee{}, Guards: []agendaAssignee{}}
		myRank := u.rank[a.ID]
		for _, l := range levels {
			if !l.Active {
				continue
			}
			opt.Levels = append(opt.Levels, agendaAssignee{ID: l.ID, Name: l.Name, Rank: int(l.Rank), Allowed: full || int(l.Rank) < myRank})
		}
		best := map[uuid.UUID]int{}
		names := map[uuid.UUID]string{}
		var order []uuid.UUID
		for _, p := range people {
			if p.AreaID != a.ID {
				continue
			}
			if _, seen := names[p.UserID]; !seen {
				order = append(order, p.UserID)
				names[p.UserID] = p.Name
			}
			if int(p.LevelRank) > best[p.UserID] {
				best[p.UserID] = int(p.LevelRank)
			}
		}
		for _, id := range order {
			allowed := full || id == u.id || best[id] < myRank
			opt.People = append(opt.People, agendaAssignee{ID: id, Name: names[id], Rank: best[id], Allowed: allowed})
		}
		for _, g := range guards {
			if uuidEq(g.AreaID, a.ID) {
				// Las guardias no tienen nivel: las asignan desde N2, la jefatura y Gestión.
				opt.Guards = append(opt.Guards, agendaAssignee{ID: g.ID, Name: g.Name, Allowed: full || myRank >= 2})
			}
		}
		out = append(out, opt)
	}
	return out, nil
}

// checkAssign valida el responsable pedido contra assignOptions.
func checkAssign(opts []agendaAreaOptions, me uuid.UUID, area uuid.UUID, kind string, target uuid.UUID) error {
	for _, a := range opts {
		if a.ID != area {
			continue
		}
		list := map[string][]agendaAssignee{"person": a.People, "level": a.Levels, "guard": a.Guards}[kind]
		if kind == "person" && target == me {
			return nil // a uno mismo siempre se puede
		}
		for _, x := range list {
			if x.ID == target {
				if !x.Allowed {
					return errors.New("no puedes asignar a ese responsable: hacia arriba se pide con un ticket")
				}
				return nil
			}
		}
		return errors.New("ese responsable no es del área elegida")
	}
	return errors.New("no puedes asignar tareas en esa área")
}

// ===== Generación de ocurrencias =====

// Generate crea las ocurrencias que faltan hasta agendaHorizon y devuelve al
// nivel las de personas ausentes en Dotación. Corre en el scheduler y antes
// de cada lectura (con un tope de una vez por minuto, salvo force).
func (h *AgendaHandler) Generate(ctx context.Context) error { return h.generate(ctx, true) }

func (h *AgendaHandler) generate(ctx context.Context, force bool) error {
	h.genMu.Lock()
	defer h.genMu.Unlock()
	now := h.now()
	if !force && now.Sub(h.lastGen) < time.Minute {
		return nil
	}
	ac, err := loadAgendaCal(ctx, h.Queries, now, now.AddDate(0, 0, agendaHorizon))
	if err != nil {
		return err
	}
	today := agenda.Day(now, ac.loc)
	to := today.AddDate(0, 0, agendaHorizon)
	tasks, err := h.Queries.ListAgendaTasks(ctx, false)
	if err != nil {
		return err
	}
	for _, t := range tasks {
		if t.Paused || t.FlowID.Valid {
			continue // los pasos de un flujo nacen con cada vuelta (generateFlows)
		}
		var rec agenda.Recurrence
		if json.Unmarshal(t.Recurrence, &rec) != nil {
			continue
		}
		for _, o := range ac.cal.Occurrences(rec, today, to) {
			p := db.InsertAgendaOccurrenceParams{TaskID: t.ID, DueDate: pgDate(o.Date)}
			if o.MovedFrom != nil {
				p.MovedFrom = pgDate(*o.MovedFrom)
			}
			switch t.AssigneeKind {
			case "person":
				p.UserID = t.AssigneeUserID
			case "level":
				p.OfferedLevelID = t.AssigneeLevelID
			}
			if _, err := h.Queries.InsertAgendaOccurrence(ctx, p); err != nil {
				return err
			}
		}
	}
	if err := h.generateFlows(ctx, ac, today, to, tasks); err != nil {
		return err
	}
	if err := h.applyAbsences(ctx, ac, today, tasks); err != nil {
		return err
	}
	h.lastGen = now
	return nil
}

// applyAbsences: si quien tiene una ocurrencia está de vacaciones o con
// licencia ese día (Dotación), vuelve a su nivel en el área de la tarea. El
// aviso a la jefatura llega con el centro de notificaciones (9.5); mientras,
// la jefatura lo ve en Gestión.
func (h *AgendaHandler) applyAbsences(ctx context.Context, ac agendaCal, today time.Time, tasks []db.ListAgendaTasksRow) error {
	until := ac.cal.AddBusinessDays(today, absenceWindow)
	abs, err := h.Queries.ListAbsences(ctx, db.ListAbsencesParams{FromDay: pgDate(today), ToDay: pgDate(until)})
	if err != nil || len(abs) == 0 {
		return err
	}
	absent := map[string]bool{}
	for _, a := range abs {
		absent[a.UserID.String()+agenda.FormatDate(a.AssignedDate.Time)] = true
	}
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{FromDay: pgDate(today), ToDay: pgDate(until)})
	if err != nil {
		return err
	}
	areaOf := map[uuid.UUID]uuid.UUID{}
	for _, t := range tasks {
		areaOf[t.ID] = t.AreaID
	}
	people, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		return err
	}
	for _, o := range occs {
		if o.Status != "pending" || !o.UserID.Valid {
			continue
		}
		uid := uuid.UUID(o.UserID.Bytes)
		if !absent[uid.String()+agenda.FormatDate(o.DueDate.Time)] {
			continue
		}
		var level pgtype.UUID
		rank := int32(-1)
		for _, p := range people {
			if p.UserID == uid && p.AreaID == areaOf[o.TaskID] && p.LevelID.Valid && p.LevelRank > rank {
				level, rank = p.LevelID, p.LevelRank
			}
		}
		if !level.Valid {
			continue // sin nivel en el área no hay a quién devolverla: queda donde está
		}
		if err := h.Queries.SetOccurrenceHolder(ctx, db.SetOccurrenceHolderParams{ID: o.ID, OfferedLevelID: level, AbsentUserID: o.UserID}); err != nil {
			return err
		}
		h.AuditLog.Log(ctx, "agenda.occurrence.absence", audit.LevelInfo, audit.Success(), map[string]any{
			"occurrenceId": o.ID.String(), "userId": uid.String(), "dueDate": agenda.FormatDate(o.DueDate.Time)})
		for _, t := range tasks {
			if t.ID == o.TaskID {
				h.notifyAbsence(ctx, t, o, uuid.UUID(level.Bytes))
			}
		}
	}
	return nil
}

// ===== DTOs =====

type agendaTaskDTO struct {
	ID            uuid.UUID         `json:"id"`
	Name          string            `json:"name"`
	Description   string            `json:"description"`
	AreaID        uuid.UUID         `json:"areaId"`
	AreaName      string            `json:"areaName"`
	ClientID      *uuid.UUID        `json:"clientId,omitempty"`
	ClientName    string            `json:"clientName,omitempty"`
	Paused        bool              `json:"paused"`
	AssigneeKind  string            `json:"assigneeKind"`
	AssigneeID    *uuid.UUID        `json:"assigneeId,omitempty"`
	AssigneeName  string            `json:"assigneeName"`
	Recurrence    agenda.Recurrence `json:"recurrence"`
	WarnDays      []int32           `json:"warnDays"`
	Steps         []string          `json:"steps"`
	DocURL        *string           `json:"docUrl,omitempty"`
	ReportKind    *string           `json:"reportKind,omitempty"`
	Active        bool              `json:"active"`
	CreatedBy     *uuid.UUID        `json:"createdBy,omitempty"`
	CreatedByName string            `json:"createdByName"`
	CanEdit       bool              `json:"canEdit"`
	// FlowID: es un paso de un flujo (9.7); se edita desde el flujo.
	FlowID *uuid.UUID `json:"flowId,omitempty"`
	// Acciones de la Gestión CSM (9.4): tipo, tarea clave y el ticket al que
	// le da seguimiento.
	ActionKind   *string    `json:"actionKind,omitempty"`
	IsKey        bool       `json:"isKey"`
	TicketID     *uuid.UUID `json:"ticketId,omitempty"`
	TicketNumber string     `json:"ticketNumber,omitempty"`
}

func toAgendaTaskDTO(t db.ListAgendaTasksRow, u agendaUser) agendaTaskDTO {
	var rec agenda.Recurrence
	_ = json.Unmarshal(t.Recurrence, &rec)
	d := agendaTaskDTO{ID: t.ID, Name: t.Name, Description: t.Description, AreaID: t.AreaID, AreaName: t.AreaName,
		ClientID: uuidPtr(t.OrganizationID), ClientName: t.OrganizationName, Paused: t.Paused, AssigneeKind: t.AssigneeKind,
		Recurrence: rec, WarnDays: nonNilInts(t.WarnDays), Steps: nonNilStrings(t.Steps), DocURL: textPtr(t.DocUrl),
		ReportKind: textPtr(t.ReportKind), Active: t.Active, CreatedBy: uuidPtr(t.CreatedBy), CreatedByName: t.CreatedByName,
		CanEdit: u.canEditTask(t) && !t.FlowID.Valid, FlowID: uuidPtr(t.FlowID),
		ActionKind: textPtr(t.ActionKind), IsKey: t.IsKey, TicketID: uuidPtr(t.TicketID), TicketNumber: t.TicketNumber}
	switch t.AssigneeKind {
	case "person":
		d.AssigneeID, d.AssigneeName = uuidPtr(t.AssigneeUserID), t.AssigneeUserName
	case "level":
		d.AssigneeID, d.AssigneeName = uuidPtr(t.AssigneeLevelID), t.AssigneeLevelName
	case "guard":
		d.AssigneeID, d.AssigneeName = uuidPtr(t.AssigneeTeamID), t.AssigneeTeamName
	}
	return d
}

func nonNilInts(v []int32) []int32 {
	if v == nil {
		return []int32{}
	}
	return v
}

type agendaOccDTO struct {
	ID           uuid.UUID     `json:"id"`
	Task         agendaTaskDTO `json:"task"`
	DueDate      string        `json:"dueDate"`
	DueAt        time.Time     `json:"dueAt"`
	MovedFrom    *string       `json:"movedFrom,omitempty"`
	Status       string        `json:"status"`
	Late         bool          `json:"late"`
	BizDays      int           `json:"bizDays"`
	HolderID     *uuid.UUID    `json:"holderId,omitempty"`
	HolderName   string        `json:"holderName,omitempty"`
	OfferedLevel string        `json:"offeredLevel,omitempty"`
	AbsentName   string        `json:"absentName,omitempty"`
	StepsDone    []int32       `json:"stepsDone"`
	Note         *string       `json:"note,omitempty"`
	Link         *string       `json:"link,omitempty"`
	SkipReason   *string       `json:"skipReason,omitempty"`
	ClosedByName string        `json:"closedByName,omitempty"`
	ClosedAt     *time.Time    `json:"closedAt,omitempty"`
	OnTime       bool          `json:"onTime"`
	ByReport     bool          `json:"byReport"`
	Projected    bool          `json:"projected,omitempty"`
	Mine         bool          `json:"mine"`
	CanTake      bool          `json:"canTake"`
	CanAct       bool          `json:"canAct"`
	CanSkip      bool          `json:"canSkip"`
	CanRelease   bool          `json:"canRelease"`
	CanReopen    bool          `json:"canReopen"`
	// Flow: el paso de un flujo (9.7) y, si espera, a qué paso espera.
	Flow *agendaOccFlowDTO `json:"flow,omitempty"`
}

type agendaOccFlowDTO struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Position    int32     `json:"position"`
	Total       int       `json:"total"`
	WaitingFor  string    `json:"waitingFor,omitempty"`
	WaitingArea string    `json:"waitingArea,omitempty"`
}

// agendaView reúne lo que hace falta para armar las ocurrencias de un usuario.
type agendaView struct {
	ac      agendaCal
	u       agendaUser
	now     time.Time
	today   time.Time
	tasks   map[uuid.UUID]db.ListAgendaTasksRow
	onGuard map[uuid.UUID]bool // guardias en las que el usuario está de guardia ahora
	flows   map[uuid.UUID]flowInfo
}

func (h *AgendaHandler) loadView(ctx context.Context, from, to time.Time) (agendaView, error) {
	_ = h.generate(ctx, false)
	v := agendaView{now: h.now(), tasks: map[uuid.UUID]db.ListAgendaTasksRow{}, onGuard: map[uuid.UUID]bool{}}
	var err error
	if v.ac, err = loadAgendaCal(ctx, h.Queries, from, to); err != nil {
		return v, err
	}
	v.today = agenda.Day(v.now, v.ac.loc)
	if v.u, err = loadAgendaUser(ctx, h.Queries); err != nil {
		return v, err
	}
	tasks, err := h.Queries.ListAgendaTasks(ctx, true)
	if err != nil {
		return v, err
	}
	if v.flows, err = h.loadFlows(ctx, tasks); err != nil {
		return v, err
	}
	guardTeams := map[uuid.UUID]bool{}
	for _, t := range tasks {
		v.tasks[t.ID] = t
		if t.Active && t.AssigneeKind == "guard" && t.AssigneeTeamID.Valid && v.u.canSeeTask(t) {
			guardTeams[uuid.UUID(t.AssigneeTeamID.Bytes)] = true
		}
	}
	for team := range guardTeams {
		on, err := h.userOnGuard(ctx, team, v.u.id, v.now)
		if err != nil {
			return v, err
		}
		v.onGuard[team] = on
	}
	return v, nil
}

func (h *AgendaHandler) userOnGuard(ctx context.Context, team, user uuid.UUID, now time.Time) (bool, error) {
	current, err := resolveCurrentTeamMembers(ctx, h.Queries, team, now)
	if err != nil || len(current) == 0 {
		return false, err
	}
	members, err := h.Queries.ListTeamMembers(ctx, team)
	if err != nil {
		return false, err
	}
	for _, c := range current {
		for _, m := range members {
			if m.ID == c.TeamMemberID && uuidEq(m.UserID, user) {
				return true, nil
			}
		}
	}
	return false, nil
}

// eligible: la ocurrencia sin dueño se le ofrece al usuario (su nivel o su guardia).
func (v agendaView) eligible(o db.ListAgendaOccurrencesRow, t db.ListAgendaTasksRow) bool {
	if o.UserID.Valid {
		return false
	}
	if o.OfferedLevelID.Valid {
		_, ok := v.u.levels[t.AreaID][uuid.UUID(o.OfferedLevelID.Bytes)]
		return ok
	}
	return t.AssigneeKind == "guard" && t.AssigneeTeamID.Valid && v.onGuard[uuid.UUID(t.AssigneeTeamID.Bytes)]
}

func (v agendaView) occDTO(o db.ListAgendaOccurrencesRow, t db.ListAgendaTasksRow) agendaOccDTO {
	due := o.DueDate.Time
	d := agendaOccDTO{ID: o.ID, Task: toAgendaTaskDTO(t, v.u), DueDate: agenda.FormatDate(due), DueAt: v.ac.dueAt(due), Status: o.Status,
		HolderID: uuidPtr(o.UserID), HolderName: o.UserName, OfferedLevel: o.OfferedLevelName, AbsentName: o.AbsentUserName,
		StepsDone: nonNilInts(o.StepsDone), Note: textPtr(o.Note), Link: textPtr(o.Link), SkipReason: textPtr(o.SkipReason),
		ClosedByName: o.ClosedByName, ClosedAt: timestamptzPtr(o.ClosedAt), ByReport: o.ReportHistoryID.Valid}
	if o.MovedFrom.Valid {
		s := agenda.FormatDate(o.MovedFrom.Time)
		d.MovedFrom = &s
	}
	d.BizDays = v.ac.cal.BusinessDaysBetween(v.today, due)
	d.Late = o.Status == "pending" && v.now.After(d.DueAt)
	if t.FlowID.Valid && o.FlowRunID.Valid {
		f := v.flows[uuid.UUID(t.FlowID.Bytes)]
		d.Flow = &agendaOccFlowDTO{ID: f.flow.ID, Name: f.flow.Name, Position: t.FlowPosition.Int32, Total: len(f.steps)}
		if o.Status == "waiting" {
			if prev, ok := f.stepAt(t.FlowPosition.Int32 - 1); ok {
				d.Flow.WaitingFor, d.Flow.WaitingArea = prev.Name, prev.AreaName
			}
		}
	}
	if d.ClosedAt != nil {
		d.OnTime = o.Status == "done" && !d.ClosedAt.After(d.DueAt)
	}
	holder := uuidEq(o.UserID, v.u.id)
	elig := v.eligible(o, t)
	creator := uuidEq(t.CreatedBy, v.u.id)
	d.Mine = holder || elig
	if o.Status == "pending" {
		d.CanTake = elig
		d.CanAct = holder || elig || v.u.admin
		d.CanSkip = d.CanAct || creator
		d.CanRelease = holder && (t.AssigneeKind != "person" || o.AbsentUserID.Valid || len(v.u.levels[t.AreaID]) > 0)
	} else if o.Status != "waiting" {
		d.CanReopen = uuidEq(o.ClosedBy, v.u.id) || holder || creator || v.u.admin
	}
	return d
}

// ===== Lecturas =====

// Meta: horario hábil, feriados cercanos y a quién puede asignar el usuario.
func (h *AgendaHandler) Meta(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, now.AddDate(0, -2, 0), now.AddDate(1, 2, 0))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	opts, err := h.assignOptions(ctx, u)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	holidays := map[string]string{}
	for k, v := range ac.cal.Holidays {
		holidays[k] = v
	}
	leads := []uuid.UUID{}
	for id := range u.leads {
		leads = append(leads, id)
	}
	writeData(w, http.StatusOK, map[string]any{
		"today": agenda.FormatDate(agenda.Day(now, ac.loc)), "workDays": ac.settings.WorkDays, "dayStart": ac.settings.DayStart,
		"dayEnd": ac.settings.DayEnd, "holidays": holidays, "areas": opts, "me": u.id, "admin": u.admin, "viewAll": u.viewAll,
		"leadAreas": leads, "crossArea": u.crossArea(),
	})
}

// Mine: lo que le toca al usuario y a sus niveles (y a su guardia si está de
// guardia), las atrasadas y lo que cerró hoy.
func (h *AgendaHandler) Mine(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := h.now()
	v, err := h.loadView(ctx, now, now.AddDate(0, 0, agendaHorizon))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{
		FromDay: pgDate(v.today), ToDay: pgDate(v.today.AddDate(0, 0, agendaHorizon)), WithLate: true})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	out := []agendaOccDTO{}
	for _, o := range occs {
		t, ok := v.tasks[o.TaskID]
		if !ok || !t.Active {
			continue
		}
		d := v.occDTO(o, t)
		closedToday := d.ClosedAt != nil && agenda.Day(*d.ClosedAt, v.ac.loc).Equal(v.today) && (uuidEq(o.ClosedBy, v.u.id) || uuidEq(o.UserID, v.u.id))
		// Lo que espera a un paso anterior se ve aparte, sin contar como atraso
		// (solo de las vueltas que ya empezaron).
		waiting := o.Status == "waiting" && (d.Mine || uuidEq(o.UserID, v.u.id)) && !o.DueDate.Time.After(v.today)
		if (o.Status == "pending" && d.Mine) || closedToday || waiting {
			out = append(out, d)
		}
	}
	writeData(w, http.StatusOK, out)
}

// Calendar: las ocurrencias de un rango que el usuario puede ver. Lo que
// queda más allá de lo generado se proyecta desde la recurrencia.
func (h *AgendaHandler) Calendar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	from, err1 := agenda.ParseDate(q.Get("from"))
	to, err2 := agenda.ParseDate(q.Get("to"))
	if err1 != nil || err2 != nil || to.Before(from) || to.Sub(from) > 62*24*time.Hour {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "from y to (YYYY-MM-DD), hasta 62 días")
		return
	}
	v, err := h.loadView(ctx, from, to)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	match := agendaFilter(q, v)
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{FromDay: pgDate(from), ToDay: pgDate(to)})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	out := []agendaOccDTO{}
	have := map[string]bool{}
	for _, o := range occs {
		t, ok := v.tasks[o.TaskID]
		if !ok || !t.Active || !v.u.canSeeTask(t) || o.Status == "waiting" {
			continue
		}
		have[o.TaskID.String()+agenda.FormatDate(o.DueDate.Time)] = true
		d := v.occDTO(o, t)
		if match(t, d) {
			out = append(out, d)
		}
	}
	horizon := v.today.AddDate(0, 0, agendaHorizon)
	if to.After(horizon) {
		for _, t := range v.tasks {
			if !t.Active || t.Paused || t.FlowID.Valid || !v.u.canSeeTask(t) {
				continue
			}
			var rec agenda.Recurrence
			if json.Unmarshal(t.Recurrence, &rec) != nil {
				continue
			}
			start := from
			if horizon.After(start) {
				start = horizon.AddDate(0, 0, 1)
			}
			for _, oc := range v.ac.cal.Occurrences(rec, start, to) {
				if have[t.ID.String()+agenda.FormatDate(oc.Date)] {
					continue
				}
				d := agendaOccDTO{Task: toAgendaTaskDTO(t, v.u), DueDate: agenda.FormatDate(oc.Date), DueAt: v.ac.dueAt(oc.Date),
					Status: "pending", Projected: true, StepsDone: []int32{}, BizDays: v.ac.cal.BusinessDaysBetween(v.today, oc.Date)}
				if match(t, d) {
					out = append(out, d)
				}
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DueDate != out[j].DueDate {
			return out[i].DueDate < out[j].DueDate
		}
		return out[i].Task.Name < out[j].Task.Name
	})
	writeData(w, http.StatusOK, out)
}

// agendaFilter: filtros del calendario por área, cliente y persona.
func agendaFilter(q url.Values, v agendaView) func(db.ListAgendaTasksRow, agendaOccDTO) bool {
	area, _ := uuid.Parse(q.Get("area"))
	client, _ := uuid.Parse(q.Get("client"))
	person, _ := uuid.Parse(q.Get("user"))
	return func(t db.ListAgendaTasksRow, d agendaOccDTO) bool {
		if area != uuid.Nil && t.AreaID != area {
			return false
		}
		if client != uuid.Nil && !uuidEq(t.OrganizationID, client) {
			return false
		}
		if person != uuid.Nil {
			holder := d.HolderID != nil && *d.HolderID == person
			if !holder && !(d.HolderID == nil && uuidEq(t.AssigneeUserID, person)) {
				return false
			}
		}
		return true
	}
}

type agendaManagedDTO struct {
	Task     agendaTaskDTO `json:"task"`
	Next     *agendaOccDTO `json:"next,omitempty"`
	History  []string      `json:"history"`
	State    string        `json:"state"`
	OpenLate int           `json:"openLate"`
}

// Managed: Gestión. scope=mine (lo que asignó el usuario a otros) o
// scope=area (las áreas de su jefatura; el admin, todas). Indicadores de
// los últimos 90 días.
func (h *AgendaHandler) Managed(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := h.now()
	scope := r.URL.Query().Get("scope")
	v, err := h.loadView(ctx, now.AddDate(0, 0, -90), now.AddDate(0, 0, agendaHorizon))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	areaFilter, _ := uuid.Parse(r.URL.Query().Get("area"))
	include := func(t db.ListAgendaTasksRow) bool {
		if !t.Active {
			return false
		}
		if scope == "area" {
			if areaFilter != uuid.Nil && t.AreaID != areaFilter {
				return false
			}
			return v.u.admin || v.u.leads[t.AreaID]
		}
		return uuidEq(t.CreatedBy, v.u.id) && !(t.AssigneeKind == "person" && uuidEq(t.AssigneeUserID, v.u.id))
	}
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{
		FromDay: pgDate(v.today.AddDate(0, 0, -90)), ToDay: pgDate(v.today.AddDate(0, 0, agendaHorizon)), WithLate: true})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	byTask := map[uuid.UUID][]agendaOccDTO{}
	for _, o := range occs {
		t, ok := v.tasks[o.TaskID]
		if ok && include(t) && o.Status != "waiting" {
			byTask[t.ID] = append(byTask[t.ID], v.occDTO(o, t))
		}
	}
	rows := []agendaManagedDTO{}
	kpi := struct {
		closed, onTime, openLate, atRisk, total int
	}{}
	for _, t := range v.tasks {
		if !include(t) {
			continue
		}
		row := agendaManagedDTO{Task: toAgendaTaskDTO(t, v.u), History: []string{}, State: "ok"}
		if t.Paused {
			row.State = "paused"
		}
		var past []string
		for i := range byTask[t.ID] {
			o := byTask[t.ID][i]
			due, _ := agenda.ParseDate(o.DueDate)
			if !due.After(v.today) {
				kpi.total++
			}
			switch {
			case o.Status == "done":
				kpi.closed++
				if o.OnTime {
					kpi.onTime++
					past = append(past, "ok")
				} else {
					past = append(past, "late")
				}
			case o.Status == "skipped":
				past = append(past, "skip")
			case o.Late:
				row.OpenLate++
				kpi.openLate++
				past = append(past, "open")
			default:
				if row.Next == nil {
					row.Next = &o
				}
			}
		}
		if len(past) > 6 {
			past = past[len(past)-6:]
		}
		row.History = append(row.History, past...)
		if row.OpenLate > 0 {
			row.State = "late"
		} else if n := row.Next; n != nil && row.State == "ok" && n.BizDays <= 1 && agendaAtRisk(*n) {
			row.State = "risk"
			kpi.atRisk++
		}
		if t.FlowID.Valid {
			continue // los pasos de un flujo se ven en Flujos; cuentan en los indicadores
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		order := map[string]int{"late": 0, "risk": 1, "ok": 2, "paused": 3}
		if order[rows[i].State] != order[rows[j].State] {
			return order[rows[i].State] < order[rows[j].State]
		}
		return rows[i].Task.Name < rows[j].Task.Name
	})
	onTimePct := -1
	if den := kpi.closed + kpi.openLate; den > 0 {
		onTimePct = kpi.onTime * 100 / den
	}
	writeData(w, http.StatusOK, map[string]any{"tasks": rows, "onTimePct": onTimePct, "openLate": kpi.openLate, "atRisk": kpi.atRisk, "occurrences": kpi.total})
}

// agendaAtRisk: vence en 1 día hábil o menos y le faltan pasos, o nadie la tomó.
func agendaAtRisk(o agendaOccDTO) bool {
	if o.HolderID == nil {
		return true
	}
	return len(o.Task.Steps) > 0 && len(o.StepsDone) < len(o.Task.Steps)
}

// Preview: las próximas fechas de una recurrencia con el calendario hábil
// del servidor (la pantalla de Nueva tarea las muestra mientras se elige).
func (h *AgendaHandler) Preview(w http.ResponseWriter, r *http.Request) {
	var rec agenda.Recurrence
	if err := decodeJSON(w, r, &rec); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "recurrencia inválida")
		return
	}
	if err := rec.Validate(); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-recurrence", err.Error())
		return
	}
	now := h.now()
	ac, err := loadAgendaCal(r.Context(), h.Queries, now, now.AddDate(2, 0, 0))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	today := agenda.Day(now, ac.loc)
	type item struct {
		Date      string  `json:"date"`
		MovedFrom *string `json:"movedFrom,omitempty"`
		Reason    string  `json:"reason,omitempty"`
	}
	out := []item{}
	for _, o := range ac.cal.Occurrences(rec, today, today.AddDate(2, 0, 0)) {
		it := item{Date: agenda.FormatDate(o.Date)}
		if o.MovedFrom != nil {
			s := agenda.FormatDate(*o.MovedFrom)
			it.MovedFrom, it.Reason = &s, ac.cal.Holidays[s]
		}
		out = append(out, it)
		if len(out) == 6 {
			break
		}
	}
	writeData(w, http.StatusOK, out)
}

// ===== Tareas =====

type agendaTaskRequest struct {
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	AreaID       uuid.UUID         `json:"areaId"`
	ClientID     *uuid.UUID        `json:"clientId"`
	AssigneeKind string            `json:"assigneeKind"`
	AssigneeID   uuid.UUID         `json:"assigneeId"`
	Recurrence   agenda.Recurrence `json:"recurrence"`
	WarnDays     []int32           `json:"warnDays"`
	Steps        []string          `json:"steps"`
	DocURL       string            `json:"docUrl"`
	ReportKind   string            `json:"reportKind"`
	// Window: crear una ventana de mantenimiento con la misma fecha (solo
	// tareas de una vez; decisión del dueño 2026-10-15).
	Window *agendaWindowRequest `json:"window"`
	// Acciones de la Gestión CSM (9.4). Sin enviar, al editar se conservan
	// (la pantalla de la Agenda no los manda).
	ActionKind *string    `json:"actionKind"`
	IsKey      *bool      `json:"isKey"`
	TicketID   *uuid.UUID `json:"ticketId"`
}

// actionFields: lo que se guarda de la acción, con lo que ya tenía la tarea
// para lo que no vino en el pedido.
func (req agendaTaskRequest) actionFields(kind pgtype.Text, key bool, ticket pgtype.UUID) (pgtype.Text, bool, pgtype.UUID) {
	if req.ActionKind != nil {
		kind = optText(*req.ActionKind)
	}
	if req.IsKey != nil {
		key = *req.IsKey
	}
	if req.TicketID != nil {
		ticket = pgUUIDOf(*req.TicketID)
	}
	return kind, key, ticket
}

// agendaActionKinds: Reunión, Comité y Contacto cuentan como contacto con el cliente.
var agendaActionKinds = map[string]bool{"meeting": true, "committee": true, "contact": true, "report": true, "other": true}

func (req *agendaTaskRequest) validate(today time.Time) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	req.DocURL = strings.TrimSpace(req.DocURL)
	switch {
	case req.Name == "" || len([]rune(req.Name)) > 200:
		return errors.New("el nombre va de 1 a 200 caracteres")
	case len([]rune(req.Description)) > 5000:
		return errors.New("la descripción es muy larga")
	case req.AreaID == uuid.Nil || req.AssigneeID == uuid.Nil:
		return errors.New("elige el área y quién la hace")
	case req.AssigneeKind != "person" && req.AssigneeKind != "level" && req.AssigneeKind != "guard":
		return errors.New("responsable: persona, nivel o guardia")
	case req.ReportKind != "" && req.ReportKind != "incident" && req.ReportKind != "bulletin":
		return errors.New("informe: incident o bulletin")
	case req.ReportKind != "" && req.ClientID == nil:
		return errors.New("para cerrarla con un informe elige el cliente")
	case req.ActionKind != nil && *req.ActionKind != "" && !agendaActionKinds[*req.ActionKind]:
		return errors.New("tipo de acción: meeting, committee, contact, report u other")
	}
	if req.DocURL != "" {
		u, err := url.Parse(req.DocURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(req.DocURL) > 500 {
			return errors.New("el enlace a documentación debe ser una URL http(s)")
		}
	}
	if err := req.Recurrence.Validate(); err != nil {
		return err
	}
	if req.Recurrence.Kind == agenda.KindOnce {
		if d, _ := agenda.ParseDate(req.Recurrence.Date); d.Before(today) {
			return errors.New("la fecha ya pasó")
		}
	}
	steps := make([]string, 0, len(req.Steps))
	for _, s := range req.Steps {
		if s = strings.TrimSpace(s); s != "" {
			if len([]rune(s)) > 300 {
				return errors.New("cada paso va hasta 300 caracteres")
			}
			steps = append(steps, s)
		}
	}
	if len(steps) > 50 {
		return errors.New("hasta 50 pasos")
	}
	req.Steps = steps
	warn := map[int32]bool{}
	clean := []int32{}
	for _, d := range req.WarnDays {
		if d < 0 || d > 30 {
			return errors.New("los avisos van de 0 a 30 días hábiles antes")
		}
		if !warn[d] {
			warn[d] = true
			clean = append(clean, d)
		}
	}
	sort.Slice(clean, func(i, j int) bool { return clean[i] > clean[j] })
	req.WarnDays = clean
	return nil
}

func (req agendaTaskRequest) assignee() (user, level, team pgtype.UUID) {
	id := pgUUIDOf(req.AssigneeID)
	switch req.AssigneeKind {
	case "person":
		return id, pgtype.UUID{}, pgtype.UUID{}
	case "level":
		return pgtype.UUID{}, id, pgtype.UUID{}
	default:
		return pgtype.UUID{}, pgtype.UUID{}, id
	}
}

func (h *AgendaHandler) readTask(w http.ResponseWriter, r *http.Request, u agendaUser) (agendaTaskRequest, []byte, bool) {
	var req agendaTaskRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return req, nil, false
	}
	ac, err := loadAgendaCal(r.Context(), h.Queries, h.now(), h.now())
	if err != nil {
		agendaFail(w, r, err)
		return req, nil, false
	}
	if err := req.validate(agenda.Day(h.now(), ac.loc)); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return req, nil, false
	}
	opts, err := h.assignOptions(r.Context(), u)
	if err != nil {
		agendaFail(w, r, err)
		return req, nil, false
	}
	if err := checkAssign(opts, u.id, req.AreaID, req.AssigneeKind, req.AssigneeID); err != nil {
		problemdetails.Write(w, r, http.StatusForbidden, "agenda-assign-forbidden", err.Error())
		return req, nil, false
	}
	rec, _ := json.Marshal(req.Recurrence)
	return req, rec, true
}

func (h *AgendaHandler) CreateTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	req, rec, ok := h.readTask(w, r, u)
	if !ok {
		return
	}
	user, level, team := req.assignee()
	kind, key, ticket := req.actionFields(pgtype.Text{}, false, pgtype.UUID{})
	id, err := h.Queries.CreateAgendaTask(ctx, db.CreateAgendaTaskParams{
		Name: req.Name, Description: req.Description, AreaID: req.AreaID, OrganizationID: optionalUUID(req.ClientID),
		AssigneeKind: req.AssigneeKind, AssigneeUserID: user, AssigneeLevelID: level, AssigneeTeamID: team, Recurrence: rec,
		WarnDays: req.WarnDays, Steps: req.Steps, DocUrl: optText(req.DocURL), ReportKind: optText(req.ReportKind), CreatedBy: pgUUIDOf(u.id),
		ActionKind: kind, IsKey: key, TicketID: ticket,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el área, el cliente o el responsable no existe")
			return
		}
		agendaFail(w, r, err)
		return
	}
	_ = h.generate(ctx, true)
	h.AuditLog.Log(ctx, "agenda.task.created", audit.LevelInfo, audit.Success(), map[string]any{"taskId": id.String(), "name": req.Name})
	if t, ok, _ := h.findTask(ctx, id); ok {
		if req.Window != nil {
			if err := h.createTaskWindow(ctx, t, req, u.id); err != nil {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-window", err.Error())
				return
			}
		}
		h.notifyAssigned(ctx, t, u.id)
	}
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"taskId": id.String()})
	h.writeTask(w, r, u, id, http.StatusCreated)
}

func (h *AgendaHandler) findTask(ctx context.Context, id uuid.UUID) (db.ListAgendaTasksRow, bool, error) {
	tasks, err := h.Queries.ListAgendaTasks(ctx, true)
	if err != nil {
		return db.ListAgendaTasksRow{}, false, err
	}
	for _, t := range tasks {
		if t.ID == id {
			return t, true, nil
		}
	}
	return db.ListAgendaTasksRow{}, false, nil
}

func (h *AgendaHandler) writeTask(w http.ResponseWriter, r *http.Request, u agendaUser, id uuid.UUID, status int) {
	t, ok, err := h.findTask(r.Context(), id)
	if err != nil || !ok {
		agendaFail(w, r, err)
		return
	}
	writeData(w, status, toAgendaTaskDTO(t, u))
}

// taskFor lee la tarea del path y revisa que el usuario la vea (y la edite si edit).
func (h *AgendaHandler) taskFor(w http.ResponseWriter, r *http.Request, u agendaUser, edit bool) (db.ListAgendaTasksRow, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-id", "id inválido")
		return db.ListAgendaTasksRow{}, false
	}
	t, ok, err := h.findTask(r.Context(), id)
	if err != nil {
		agendaFail(w, r, err)
		return t, false
	}
	if !ok || !u.canSeeTask(t) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tarea no encontrada")
		return t, false
	}
	if edit && t.FlowID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "flow-step", "es un paso de un flujo: se edita desde el flujo")
		return t, false
	}
	if edit && !u.canEditTask(t) {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "la edita quien la creó, la jefatura del área o el admin")
		return t, false
	}
	return t, true
}

func (h *AgendaHandler) GetTask(w http.ResponseWriter, r *http.Request) {
	u, err := loadAgendaUser(r.Context(), h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if t, ok := h.taskFor(w, r, u, false); ok {
		writeData(w, http.StatusOK, toAgendaTaskDTO(t, u))
	}
}

func (h *AgendaHandler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	t, ok := h.taskFor(w, r, u, true)
	if !ok {
		return
	}
	req, rec, ok := h.readTask(w, r, u)
	if !ok {
		return
	}
	user, level, team := req.assignee()
	kind, key, ticket := req.actionFields(t.ActionKind, t.IsKey, t.TicketID)
	ac, err := loadAgendaCal(ctx, h.Queries, h.now(), h.now())
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if err := h.Queries.UpdateAgendaTask(ctx, db.UpdateAgendaTaskParams{
		ID: t.ID, Name: req.Name, Description: req.Description, AreaID: req.AreaID, OrganizationID: optionalUUID(req.ClientID),
		AssigneeKind: req.AssigneeKind, AssigneeUserID: user, AssigneeLevelID: level, AssigneeTeamID: team, Recurrence: rec,
		WarnDays: req.WarnDays, Steps: req.Steps, DocUrl: optText(req.DocURL), ReportKind: optText(req.ReportKind),
		ActionKind: kind, IsKey: key, TicketID: ticket,
	}); err != nil {
		agendaFail(w, r, err)
		return
	}
	// Las pendientes que nadie empezó se rehacen con la regla nueva.
	if _, err := h.Queries.DeleteFutureUntouchedOccurrences(ctx, db.DeleteFutureUntouchedOccurrencesParams{
		TaskID: t.ID, FromDay: pgDate(agenda.Day(h.now(), ac.loc))}); err != nil {
		agendaFail(w, r, err)
		return
	}
	_ = h.generate(ctx, true)
	h.AuditLog.Log(ctx, "agenda.task.updated", audit.LevelInfo, audit.Success(), map[string]any{"taskId": t.ID.String(), "name": req.Name})
	if after, ok, _ := h.findTask(ctx, t.ID); ok {
		// La ventana creada desde la tarea se mueve con ella.
		var oldRec agenda.Recurrence
		_ = json.Unmarshal(t.Recurrence, &oldRec)
		if oldRec.Kind == agenda.KindOnce && req.Recurrence.Kind == agenda.KindOnce && oldRec.Date != req.Recurrence.Date {
			from, _ := agenda.ParseDate(oldRec.Date)
			to, _ := agenda.ParseDate(req.Recurrence.Date)
			if _, err := h.Queries.ShiftTaskWindows(ctx, db.ShiftTaskWindowsParams{AgendaTaskID: pgUUIDOf(t.ID), Days: int32(to.Sub(from).Hours() / 24)}); err != nil {
				agendaFail(w, r, err)
				return
			}
		}
		if after.AssigneeKind != t.AssigneeKind || after.AssigneeUserID != t.AssigneeUserID || after.AssigneeLevelID != t.AssigneeLevelID || after.AssigneeTeamID != t.AssigneeTeamID {
			h.notifyAssigned(ctx, after, u.id)
		}
	}
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"taskId": t.ID.String()})
	h.writeTask(w, r, u, t.ID, http.StatusOK)
}

// DeleteTask desactiva la tarea (queda su historial) y borra sus pendientes
// futuras que nadie empezó.
func (h *AgendaHandler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	t, ok := h.taskFor(w, r, u, true)
	if !ok {
		return
	}
	ac, err := loadAgendaCal(ctx, h.Queries, h.now(), h.now())
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if _, err := h.Queries.SetAgendaTaskActive(ctx, db.SetAgendaTaskActiveParams{ID: t.ID, Active: false}); err != nil {
		agendaFail(w, r, err)
		return
	}
	if _, err := h.Queries.DeleteFutureUntouchedOccurrences(ctx, db.DeleteFutureUntouchedOccurrencesParams{
		TaskID: t.ID, FromDay: pgDate(agenda.Day(h.now(), ac.loc))}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.AuditLog.Log(ctx, "agenda.task.deactivated", audit.LevelInfo, audit.Success(), map[string]any{"taskId": t.ID.String(), "name": t.Name})
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"taskId": t.ID.String()})
	writeNoContent(w)
}

// ===== Acciones sobre una ocurrencia =====

// occFor carga la ocurrencia del path con su vista (permisos ya calculados).
func (h *AgendaHandler) occFor(w http.ResponseWriter, r *http.Request) (agendaView, db.ListAgendaOccurrencesRow, db.ListAgendaTasksRow, agendaOccDTO, bool) {
	ctx := r.Context()
	var zero agendaOccDTO
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-id", "id inválido")
		return agendaView{}, db.ListAgendaOccurrencesRow{}, db.ListAgendaTasksRow{}, zero, false
	}
	base, err := h.Queries.GetAgendaOccurrence(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ocurrencia no encontrada")
		return agendaView{}, db.ListAgendaOccurrencesRow{}, db.ListAgendaTasksRow{}, zero, false
	}
	if err != nil {
		agendaFail(w, r, err)
		return agendaView{}, db.ListAgendaOccurrencesRow{}, db.ListAgendaTasksRow{}, zero, false
	}
	day := base.DueDate.Time
	v, err := h.loadView(ctx, day, day)
	if err != nil {
		agendaFail(w, r, err)
		return v, db.ListAgendaOccurrencesRow{}, db.ListAgendaTasksRow{}, zero, false
	}
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{FromDay: base.DueDate, ToDay: base.DueDate})
	if err != nil {
		agendaFail(w, r, err)
		return v, db.ListAgendaOccurrencesRow{}, db.ListAgendaTasksRow{}, zero, false
	}
	for _, o := range occs {
		if o.ID != id {
			continue
		}
		t := v.tasks[o.TaskID]
		if !v.u.canSeeTask(t) && !uuidEq(o.UserID, v.u.id) {
			break
		}
		return v, o, t, v.occDTO(o, t), true
	}
	problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ocurrencia no encontrada")
	return v, db.ListAgendaOccurrencesRow{}, db.ListAgendaTasksRow{}, zero, false
}

func (h *AgendaHandler) afterOcc(w http.ResponseWriter, r *http.Request, event string, id uuid.UUID, meta map[string]any) {
	ctx := r.Context()
	if meta == nil {
		meta = map[string]any{}
	}
	meta["occurrenceId"] = id.String()
	h.AuditLog.Log(ctx, event, audit.LevelInfo, audit.Success(), meta)
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"occurrenceId": id.String()})
	_, o, _, d, ok := h.occFor(w, r)
	if ok && o.ID == id {
		writeData(w, http.StatusOK, d)
	}
}

func agendaDenied(w http.ResponseWriter, r *http.Request, msg string) {
	problemdetails.Write(w, r, http.StatusForbidden, "forbidden", msg)
}

// Take: la toma quien es del nivel ofrecido o está de guardia.
func (h *AgendaHandler) Take(w http.ResponseWriter, r *http.Request) {
	v, o, _, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanTake {
		agendaDenied(w, r, "esta tarea no se te ofrece o ya la tomó alguien")
		return
	}
	if err := h.Queries.SetOccurrenceHolder(r.Context(), db.SetOccurrenceHolderParams{ID: o.ID, UserID: pgUUIDOf(v.u.id), OfferedLevelID: o.OfferedLevelID, AbsentUserID: o.AbsentUserID}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.afterOcc(w, r, "agenda.occurrence.taken", o.ID, nil)
}

// Release: la devuelve al nivel (o a la guardia).
func (h *AgendaHandler) Release(w http.ResponseWriter, r *http.Request) {
	v, o, t, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanRelease {
		agendaDenied(w, r, "solo quien la tiene puede devolverla")
		return
	}
	level := o.OfferedLevelID
	if !level.Valid {
		switch t.AssigneeKind {
		case "level":
			level = t.AssigneeLevelID
		case "person":
			if id, ok := v.u.myLevelIn(t.AreaID); ok {
				level = pgUUIDOf(id)
			}
		}
	}
	if err := h.Queries.SetOccurrenceHolder(r.Context(), db.SetOccurrenceHolderParams{ID: o.ID, OfferedLevelID: level, AbsentUserID: o.AbsentUserID}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.afterOcc(w, r, "agenda.occurrence.released", o.ID, nil)
}

// Handover: quien la tiene se la pasa a otra persona del área (al cerrar el
// turno, a quien entra).
func (h *AgendaHandler) Handover(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		UserID uuid.UUID `json:"userId"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.UserID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige a quién se la pasas")
		return
	}
	v, o, t, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanAct || !(uuidEq(o.UserID, v.u.id) || d.CanTake) {
		agendaDenied(w, r, "solo quien la tiene puede traspasarla")
		return
	}
	people, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	inArea := false
	for _, p := range people {
		if p.UserID == req.UserID && p.AreaID == t.AreaID {
			inArea = true
		}
	}
	if !inArea {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "esa persona no es del área de la tarea")
		return
	}
	if err := h.Queries.SetOccurrenceHolder(ctx, db.SetOccurrenceHolderParams{ID: o.ID, UserID: pgUUIDOf(req.UserID), OfferedLevelID: o.OfferedLevelID, AbsentUserID: o.AbsentUserID}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.notifyHandover(ctx, t, o, v.u.id, req.UserID)
	h.afterOcc(w, r, "agenda.occurrence.handover", o.ID, map[string]any{"from": v.u.id.String(), "to": req.UserID.String()})
}

// Steps marca los pasos hechos (como el checklist de turno).
func (h *AgendaHandler) Steps(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Steps []int32 `json:"steps"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	v, o, t, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanAct {
		agendaDenied(w, r, "tómala primero")
		return
	}
	seen := map[int32]bool{}
	clean := []int32{}
	for _, s := range req.Steps {
		if s >= 0 && int(s) < len(t.Steps) && !seen[s] {
			seen[s] = true
			clean = append(clean, s)
		}
	}
	sort.Slice(clean, func(i, j int) bool { return clean[i] < clean[j] })
	ctx := r.Context()
	if !o.UserID.Valid {
		// marcar un paso la toma
		if err := h.Queries.SetOccurrenceHolder(ctx, db.SetOccurrenceHolderParams{ID: o.ID, UserID: pgUUIDOf(v.u.id), OfferedLevelID: o.OfferedLevelID, AbsentUserID: o.AbsentUserID}); err != nil {
			agendaFail(w, r, err)
			return
		}
	}
	if err := h.Queries.SetOccurrenceSteps(ctx, db.SetOccurrenceStepsParams{ID: o.ID, StepsDone: clean}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.afterOcc(w, r, "agenda.occurrence.steps", o.ID, map[string]any{"steps": clean})
}

// Done la marca hecha, con nota y enlace opcionales.
func (h *AgendaHandler) Done(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Note string `json:"note"`
		Link string `json:"link"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	req.Note, req.Link = strings.TrimSpace(req.Note), strings.TrimSpace(req.Link)
	if len([]rune(req.Note)) > 5000 || len(req.Link) > 500 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la nota o el enlace son muy largos")
		return
	}
	v, o, _, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanAct {
		agendaDenied(w, r, "esta tarea no es tuya")
		return
	}
	n, err := h.Queries.CloseOccurrence(r.Context(), db.CloseOccurrenceParams{ID: o.ID, Status: "done", Note: optText(req.Note), Link: optText(req.Link), ClosedBy: pgUUIDOf(v.u.id), ClosedAt: pgtype.Timestamptz{Time: h.now(), Valid: true}})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusConflict, "already-closed", "ya estaba cerrada")
		return
	}
	h.advanceFlow(r.Context(), o.ID, v.u.id)
	h.afterOcc(w, r, "agenda.occurrence.done", o.ID, map[string]any{"late": d.Late})
}

// Skip la omite esta vez, con motivo obligatorio.
func (h *AgendaHandler) Skip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Reason) == "" || len([]rune(req.Reason)) > 500 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el motivo es obligatorio (hasta 500 caracteres)")
		return
	}
	v, o, _, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanSkip {
		agendaDenied(w, r, "la omite el responsable o quien la asignó")
		return
	}
	n, err := h.Queries.CloseOccurrence(r.Context(), db.CloseOccurrenceParams{ID: o.ID, Status: "skipped", SkipReason: optText(strings.TrimSpace(req.Reason)), ClosedBy: pgUUIDOf(v.u.id), ClosedAt: pgtype.Timestamptz{Time: h.now(), Valid: true}})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusConflict, "already-closed", "ya estaba cerrada")
		return
	}
	// Omitido con motivo, el paso siguiente arranca igual (decisión del dueño).
	h.advanceFlow(r.Context(), o.ID, v.u.id)
	h.afterOcc(w, r, "agenda.occurrence.skipped", o.ID, map[string]any{"reason": req.Reason})
}

// Reopen deshace hecha u omitida.
func (h *AgendaHandler) Reopen(w http.ResponseWriter, r *http.Request) {
	_, o, _, d, ok := h.occFor(w, r)
	if !ok {
		return
	}
	if !d.CanReopen {
		agendaDenied(w, r, "la reabre quien la cerró, quien la tiene o quien la asignó")
		return
	}
	if _, err := h.Queries.ReopenOccurrence(r.Context(), o.ID); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.afterOcc(w, r, "agenda.occurrence.reopened", o.ID, nil)
}

// ===== Cierre de turno =====

// Handover (GET): las tareas propias que siguen abiertas y vencen a más
// tardar el siguiente día hábil, y quienes entran en el próximo turno.
func (h *AgendaHandler) HandoverInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := h.now()
	v, err := h.loadView(ctx, now, now.AddDate(0, 0, 7))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	until := v.ac.cal.AddBusinessDays(v.today, 1)
	occs, err := h.Queries.ListAgendaOccurrences(ctx, db.ListAgendaOccurrencesParams{FromDay: pgDate(v.today), ToDay: pgDate(until), WithLate: true})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	items := []agendaOccDTO{}
	for _, o := range occs {
		t, ok := v.tasks[o.TaskID]
		if ok && t.Active && o.Status == "pending" && uuidEq(o.UserID, v.u.id) {
			items = append(items, v.occDTO(o, t))
		}
	}
	entering, err := h.enteringShift(ctx, v.u.id, now)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "entering": entering})
}

type agendaPerson struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Shift string    `json:"shift,omitempty"`
}

// enteringShift: las personas del próximo turno que empieza (hoy más tarde
// o, si no queda ninguno, el primero de mañana), sin contar al usuario.
func (h *AgendaHandler) enteringShift(ctx context.Context, me uuid.UUID, now time.Time) ([]agendaPerson, error) {
	rows, err := h.Queries.ListWorkShiftMembersForHandover(ctx)
	if err != nil {
		return nil, err
	}
	type cand struct {
		start time.Time
		p     agendaPerson
	}
	var cands []cand
	for _, row := range rows {
		loc, err := time.LoadLocation(row.Timezone)
		if err != nil {
			loc = time.UTC
		}
		clock, err := agenda.ParseClock(row.StartTime)
		if err != nil {
			continue
		}
		for add := 0; add <= 1; add++ {
			day := agenda.Day(now, loc).AddDate(0, 0, add)
			start := clock.At(day, loc)
			if !start.After(now) || row.UserID == me {
				continue
			}
			okDay := false
			for _, wd := range row.Weekdays {
				if int(wd) == int(day.Weekday()) {
					okDay = true
				}
			}
			if !okDay || (row.ValidFrom.Valid && day.Before(row.ValidFrom.Time)) || (row.ValidTo.Valid && day.After(row.ValidTo.Time)) {
				continue
			}
			cands = append(cands, cand{start, agendaPerson{ID: row.UserID, Name: row.UserName, Shift: row.ShiftName}})
			break
		}
	}
	if len(cands) == 0 {
		return []agendaPerson{}, nil
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].start.Before(cands[j].start) })
	first := cands[0].start
	out := []agendaPerson{}
	seen := map[uuid.UUID]bool{}
	for _, c := range cands {
		if c.start.Equal(first) && !seen[c.p.ID] {
			seen[c.p.ID] = true
			out = append(out, c.p)
		}
	}
	return out, nil
}

// ===== Informes de Reportes =====

// agendaCloseByReport: enviar un informe a un cliente cierra la ocurrencia
// pendiente de las tareas ligadas a ese informe y cliente (spec/16 §4.3,
// "Si está ligada a un informe de Reportes, enviarlo la cierra sola").
// Mejor esfuerzo: el informe ya salió; un error acá solo se registra.
func agendaCloseByReport(ctx context.Context, q *db.Queries, hub eventPublisher, log *audit.Logger, kind string, org uuid.UUID, history pgtype.UUID, user uuid.UUID, title string, now time.Time) {
	s, err := q.GetAgendaSettings(ctx)
	if err != nil {
		return
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		loc = time.UTC
	}
	rows, err := q.CloseOccurrenceByReport(ctx, db.CloseOccurrenceByReportParams{
		UserID: user, ReportHistoryID: history, Note: "Informe enviado: " + title, ReportKind: kind, OrganizationID: org,
		UntilDay: pgDate(agenda.Day(now, loc).AddDate(0, 0, 7)), ClosedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		log.Log(ctx, "agenda.occurrence.report_close_failed", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"kind": kind})
		return
	}
	for _, row := range rows {
		log.Log(ctx, "agenda.occurrence.done", audit.LevelInfo, audit.Success(), map[string]any{"occurrenceId": row.ID.String(), "byReport": kind})
	}
	if len(rows) > 0 {
		publishSync(ctx, hub, "agenda.changed", map[string]string{})
	}
}

func agendaFail(w http.ResponseWriter, r *http.Request, err error) {
	_ = err
	problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer o guardar la Agenda")
}
