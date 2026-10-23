package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Metas (§4.4.5): de un cliente (con área opcional), de un área o de una
// persona. Decisiones del dueño (2026-10-20, las propuestas de §4.4.10):
//   - Crean metas Gestión, las jefaturas y el admin; las de una persona, la
//     jefatura de su área y el admin. El responsable (o la persona) marca los hitos.
//   - «En riesgo» sola: faltan 10 días hábiles o menos y va en menos de la
//     mitad de los hitos.
//   - Las que cuentan para el bono las confirma la jefatura (o el admin)
//     antes de darlas por cumplidas, y queda en Auditoría.
//   - La de una persona la ven la persona, la jefatura de su área, quien la
//     creó y el admin; no los demás CSM.

// goalRiskBizDays: con cuántos días hábiles o menos una meta atrasada pasa a «en riesgo».
const goalRiskBizDays = 10

type goalMilestoneDTO struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	DoneAt     *time.Time `json:"doneAt,omitempty"`
	DoneByName string     `json:"doneByName,omitempty"`
	DoneSource string     `json:"doneSource,omitempty"`
	// Enlace: un ticket o una tarea de la Agenda (se marca solo).
	TicketID     *uuid.UUID `json:"ticketId,omitempty"`
	TicketNumber string     `json:"ticketNumber,omitempty"`
	TicketStatus string     `json:"ticketStatus,omitempty"`
	TicketArea   string     `json:"ticketArea,omitempty"`
	TaskID       *uuid.UUID `json:"taskId,omitempty"`
	TaskName     string     `json:"taskName,omitempty"`
	TaskArea     string     `json:"taskArea,omitempty"`
	TaskNextDue  *string    `json:"taskNextDue,omitempty"`
}

type goalEventDTO struct {
	Text     string    `json:"text"`
	At       time.Time `json:"at"`
	UserName string    `json:"userName,omitempty"`
}

type goalEvidenceDTO struct {
	ID             uuid.UUID `json:"id"`
	FileName       string    `json:"fileName,omitempty"`
	URL            string    `json:"url,omitempty"`
	SizeBytes      int32     `json:"sizeBytes,omitempty"`
	At             time.Time `json:"at"`
	UploadedByName string    `json:"uploadedByName,omitempty"`
}

type goalDTO struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	Scope      string     `json:"scope"`
	ClientID   *uuid.UUID `json:"clientId,omitempty"`
	ClientName string     `json:"clientName,omitempty"`
	AreaID     *uuid.UUID `json:"areaId,omitempty"`
	AreaName   string     `json:"areaName,omitempty"`
	PersonID   *uuid.UUID `json:"personId,omitempty"`
	PersonName string     `json:"personName,omitempty"`
	// Solo alguien sin cuenta (000057): el correo con que pasará a su cuenta.
	PersonEmail     string     `json:"personEmail,omitempty"`
	PersonAreas     []string   `json:"personAreas,omitempty"`
	OwnerID         *uuid.UUID `json:"ownerId,omitempty"`
	OwnerName       string     `json:"ownerName,omitempty"`
	Kind            *string    `json:"kind,omitempty"`
	Bonus           *string    `json:"bonus,omitempty"`
	DueDate         string     `json:"dueDate"`
	BizDaysLeft     int        `json:"bizDaysLeft"`
	EstimateBizDays *int32     `json:"estimateBizDays,omitempty"`
	EvidenceNeeded  bool       `json:"evidenceRequired"`
	EvidenceCount   int32      `json:"evidenceCount"`
	ManualRisk      bool       `json:"manualRisk"`
	AutoRisk        bool       `json:"autoRisk"`
	State           string     `json:"state"` // open | risk | confirm | done (lograda) | failed (no lograda) | not_needed
	// No lograda o no hace falta: el motivo (vacía y vencida: «Venció el plazo»).
	OutcomeReason string `json:"outcomeReason,omitempty"`
	// La regla de la persona (all | any | primary | secondary), solo con cuenta.
	PersonRule      string     `json:"personRule,omitempty"`
	Milestones      int32      `json:"milestones"`
	MilestonesDone  int32      `json:"milestonesDone"`
	CompletedAt     *time.Time `json:"completedAt,omitempty"`
	ConfirmedAt     *time.Time `json:"confirmedAt,omitempty"`
	ConfirmedByName string     `json:"confirmedByName,omitempty"`
	CreatedByName   string     `json:"createdByName,omitempty"`
	CanEdit         bool       `json:"canEdit"`
	CanMark         bool       `json:"canMark"`
	CanConfirm      bool       `json:"canConfirm"`
	// Marcarla no lograda (la jefatura o el admin, nunca la persona).
	CanOutcome bool `json:"canOutcome"`
	// Cambiar la regla de la persona.
	CanRule  bool               `json:"canRule"`
	Steps    []goalMilestoneDTO `json:"steps,omitempty"`
	Events   []goalEventDTO     `json:"events,omitempty"`
	Evidence []goalEvidenceDTO  `json:"evidence,omitempty"`
}

// goalState calcula el estado (nadie lo guarda salvo cumplida y confirmada).
func goalState(done, total int, bonus, completed, confirmed, manualRisk bool, due, today time.Time, bizLeft int) (string, bool) {
	autoRisk := total > 0 && bizLeft <= goalRiskBizDays && done*2 < total
	switch {
	case completed && (!bonus || confirmed):
		return "done", false
	case completed:
		return "confirm", false
	case due.Before(today):
		return "failed", false
	case manualRisk || autoRisk:
		return "risk", autoRisk && !manualRisk
	}
	return "open", false
}

// goalPerms: quién ve, edita, marca y confirma una meta.
type goalPerms struct {
	see, edit, mark, confirm, rule bool
}

func (h *ManagementHandler) goalPermsFor(u agendaUser, g db.ListGoalsRow, personLeads map[uuid.UUID]bool) goalPerms {
	creator := uuidEq(g.CreatedBy, u.id)
	owner := uuidEq(g.OwnerUserID, u.id)
	p := goalPerms{}
	if g.Scope == "person" && !g.PersonUserID.Valid {
		// Alguien sin cuenta: es un registro de quien la creó (admin o jefatura).
		p.see = u.admin || creator || owner
		p.edit = u.admin || creator
		p.mark = p.edit || owner
		p.confirm = p.edit
		return p
	}
	if g.Scope == "person" {
		person := uuidEq(g.PersonUserID, u.id)
		lead := personLeads[u.id]
		p.see = u.admin || person || lead || creator || owner
		p.edit = u.admin || lead || creator
		p.mark = p.edit || person || owner
		// Confirma (y marca no lograda) la jefatura de la persona o el admin;
		// nunca la persona misma.
		p.confirm = (u.admin || lead) && !person
		p.rule = p.confirm
		return p
	}
	areaLead := g.AreaID.Valid && u.leads[uuid.UUID(g.AreaID.Bytes)]
	p.see = u.canManage() || creator || owner
	p.edit = u.admin || creator || u.gestion || areaLead
	p.mark = p.edit || owner
	p.confirm = p.edit
	return p
}

// loadGoals arma las metas visibles para el usuario.
func (h *ManagementHandler) loadGoals(ctx context.Context, params db.ListGoalsParams, u agendaUser, c mgmtClock) ([]goalDTO, error) {
	rows, err := h.Queries.ListGoals(ctx, params)
	if err != nil {
		return nil, err
	}
	out := []goalDTO{}
	leadsOf := map[uuid.UUID]map[uuid.UUID]bool{}
	for _, g := range rows {
		leads := map[uuid.UUID]bool{}
		if g.Scope == "person" && g.PersonUserID.Valid {
			pid := uuid.UUID(g.PersonUserID.Bytes)
			if leadsOf[pid] == nil {
				leadsOf[pid] = map[uuid.UUID]bool{}
				ids, err := h.Queries.ListLeadUserIDsOfPerson(ctx, pid)
				if err != nil {
					return nil, err
				}
				for _, id := range ids {
					leadsOf[pid][id] = true
				}
			}
			leads = leadsOf[pid]
		}
		perms := h.goalPermsFor(u, g, leads)
		if !perms.see {
			continue
		}
		out = append(out, h.goalDTOOf(g, perms, c))
	}
	return out, nil
}

func (h *ManagementHandler) goalDTOOf(g db.ListGoalsRow, p goalPerms, c mgmtClock) goalDTO {
	due := g.DueDate.Time
	left := c.ac.cal.BusinessDaysBetween(c.today, due)
	state, autoRisk := goalState(int(g.MilestonesDone), int(g.Milestones), g.BonusRank.Valid, g.CompletedAt.Valid, g.ConfirmedAt.Valid,
		g.ManualRisk, due, c.today, left)
	switch g.Outcome.String {
	case "not_achieved":
		state, autoRisk = "failed", false
	case "not_needed":
		state, autoRisk = "not_needed", false
	}
	d := goalDTO{ID: g.ID, Name: g.Name, Scope: g.Scope, ClientID: uuidPtr(g.ClientID), ClientName: g.ClientName, AreaID: uuidPtr(g.AreaID),
		AreaName: g.AreaName, PersonID: uuidPtr(g.PersonUserID), PersonName: g.PersonDisplay, PersonEmail: g.PersonEmail.String, OwnerID: uuidPtr(g.OwnerUserID), OwnerName: g.OwnerName,
		Kind: textPtr(g.Kind), Bonus: textPtr(g.BonusRank), DueDate: agenda.FormatDate(due), BizDaysLeft: left, EvidenceNeeded: g.EvidenceRequired,
		EvidenceCount: g.EvidenceCount, ManualRisk: g.ManualRisk, AutoRisk: autoRisk, State: state, Milestones: g.Milestones,
		MilestonesDone: g.MilestonesDone, CompletedAt: timestamptzPtr(g.CompletedAt), ConfirmedAt: timestamptzPtr(g.ConfirmedAt),
		ConfirmedByName: g.ConfirmedByName, CreatedByName: g.CreatedByName, CanEdit: p.edit, CanMark: p.mark,
		CanConfirm: p.confirm && state == "confirm", OutcomeReason: g.OutcomeReason.String,
		CanOutcome: p.confirm && (state == "open" || state == "risk" || state == "confirm"), CanRule: p.rule && g.PersonUserID.Valid}
	if g.PersonUserID.Valid {
		d.PersonRule = g.PersonRule
	}
	if g.EstimateBizDays.Valid {
		d.EstimateBizDays = &g.EstimateBizDays.Int32
	}
	return d
}

// Goals es GET /api/goals?mine=1|person=&client=: Gestión → Metas (lo que el
// usuario puede ver), «Mis metas» de la Agenda (mine) o las de una persona
// (Mi equipo).
func (h *ManagementHandler) Goals(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	h.syncLinked(ctx)
	q := r.URL.Query()
	params := db.ListGoalsParams{}
	if id, err := uuid.Parse(q.Get("person")); err == nil {
		params.PersonID = pgUUIDOf(id)
	}
	if id, err := uuid.Parse(q.Get("client")); err == nil {
		params.ClientID = pgUUIDOf(id)
	}
	goals, err := h.loadGoals(ctx, params, u, c)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	// Con alcance, las metas de sus áreas y de los clientes que ve.
	if u.limited() && q.Get("mine") != "1" {
		scope, err := h.clientScope(ctx, u)
		if err != nil {
			mgmtFail(w, r)
			return
		}
		kept := goals[:0]
		for _, g := range goals {
			switch {
			case g.AreaID != nil && !u.seesArea(*g.AreaID):
			case g.ClientID != nil && !scope[*g.ClientID] && !(g.OwnerID != nil && *g.OwnerID == u.id):
			default:
				kept = append(kept, g)
			}
		}
		goals = kept
	}
	if q.Get("mine") == "1" {
		mine := []goalDTO{}
		for _, g := range goals {
			if (g.PersonID != nil && *g.PersonID == u.id) || (g.OwnerID != nil && *g.OwnerID == u.id) {
				mine = append(mine, g)
			}
		}
		goals = mine
	} else if !u.canManage() && !params.PersonID.Valid {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "Gestión es del perfil Gestión, las jefaturas y el admin")
		return
	}
	writeData(w, http.StatusOK, goals)
}

// goalFor carga una meta con sus permisos; 404 si no la ve.
func (h *ManagementHandler) goalFor(w http.ResponseWriter, r *http.Request) (agendaUser, mgmtClock, goalDTO, db.ListGoalsRow, bool) {
	ctx := r.Context()
	var zero goalDTO
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "meta no encontrada")
		return agendaUser{}, mgmtClock{}, zero, db.ListGoalsRow{}, false
	}
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		mgmtFail(w, r)
		return u, mgmtClock{}, zero, db.ListGoalsRow{}, false
	}
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return u, c, zero, db.ListGoalsRow{}, false
	}
	rows, err := h.Queries.ListGoals(ctx, db.ListGoalsParams{GoalID: pgUUIDOf(id)})
	if err != nil {
		mgmtFail(w, r)
		return u, c, zero, db.ListGoalsRow{}, false
	}
	goals, err := h.loadGoals(ctx, db.ListGoalsParams{GoalID: pgUUIDOf(id)}, u, c)
	if err != nil {
		mgmtFail(w, r)
		return u, c, zero, db.ListGoalsRow{}, false
	}
	if len(goals) == 0 || len(rows) == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "meta no encontrada")
		return u, c, zero, db.ListGoalsRow{}, false
	}
	return u, c, goals[0], rows[0], true
}

// writeGoal devuelve la meta con hitos, historial y evidencia.
func (h *ManagementHandler) writeGoal(w http.ResponseWriter, r *http.Request, status int) {
	ctx := r.Context()
	_, _, g, row, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	g.Steps, g.Events, g.Evidence = []goalMilestoneDTO{}, []goalEventDTO{}, []goalEvidenceDTO{}
	steps, err := h.Queries.ListGoalMilestones(ctx, []uuid.UUID{g.ID})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, m := range steps {
		s := goalMilestoneDTO{ID: m.ID, Name: m.Name, DoneAt: timestamptzPtr(m.DoneAt), DoneByName: m.DoneByName.String, DoneSource: m.DoneSource.String,
			TicketID: uuidPtr(m.TicketID), TicketNumber: m.TicketNumber, TicketStatus: m.TicketStatus, TicketArea: m.TicketArea,
			TaskID: uuidPtr(m.AgendaTaskID), TaskName: m.TaskName, TaskArea: m.TaskArea, TaskNextDue: dateStrPtr(m.TaskNextDue)}
		g.Steps = append(g.Steps, s)
	}
	if evs, err := h.Queries.ListGoalEvents(ctx, g.ID); err == nil {
		for _, e := range evs {
			g.Events = append(g.Events, goalEventDTO{Text: e.Text, At: e.CreatedAt.Time, UserName: e.UserName})
		}
	}
	if ev, err := h.Queries.ListGoalEvidence(ctx, g.ID); err == nil {
		for _, e := range ev {
			g.Evidence = append(g.Evidence, goalEvidenceDTO{ID: e.ID, FileName: e.FileName.String, URL: e.Url.String, SizeBytes: e.SizeBytes.Int32,
				At: e.CreatedAt.Time, UploadedByName: e.UploadedByName})
		}
	}
	if row.PersonUserID.Valid {
		if names, err := h.Queries.ListPersonAreaNames(ctx, uuid.UUID(row.PersonUserID.Bytes)); err == nil {
			for _, n := range names {
				g.PersonAreas = append(g.PersonAreas, n.Name)
			}
		}
	}
	writeData(w, status, g)
}

// Goal es GET /api/goals/{id}.
func (h *ManagementHandler) Goal(w http.ResponseWriter, r *http.Request) {
	h.syncLinked(r.Context())
	h.writeGoal(w, r, http.StatusOK)
}

type goalRequest struct {
	Name     string     `json:"name"`
	Scope    string     `json:"scope"`
	ClientID *uuid.UUID `json:"clientId"`
	AreaID   *uuid.UUID `json:"areaId"`
	PersonID *uuid.UUID `json:"personId"`
	// Alguien sin cuenta: nombre y correo, en vez de personId.
	PersonName  string     `json:"personName"`
	PersonEmail string     `json:"personEmail"`
	OwnerID     *uuid.UUID `json:"ownerId"`
	Kind        string     `json:"kind"`
	Bonus       string     `json:"bonus"`
	// Plazo: una fecha límite o un tiempo estimado en días hábiles desde hoy.
	DueDate          string   `json:"dueDate"`
	EstimateBizDays  int32    `json:"estimateBizDays"`
	EvidenceRequired bool     `json:"evidenceRequired"`
	Steps            []string `json:"steps"`
}

// due: la fecha límite (la del pedido o la que sale de los días hábiles).
func (req *goalRequest) due(c mgmtClock) (time.Time, error) {
	if req.EstimateBizDays > 0 {
		if req.EstimateBizDays > 500 {
			return time.Time{}, errors.New("el tiempo estimado va hasta 500 días hábiles")
		}
		return c.ac.cal.AddBusinessDays(c.today, int(req.EstimateBizDays)), nil
	}
	d, err := agenda.ParseDate(req.DueDate)
	if err != nil {
		return time.Time{}, errors.New("elige la fecha límite (YYYY-MM-DD) o el tiempo estimado")
	}
	return d, nil
}

func (req *goalRequest) validate() error {
	req.Name = strings.TrimSpace(req.Name)
	switch {
	case req.Name == "" || len([]rune(req.Name)) > 200:
		return errors.New("el nombre va de 1 a 200 caracteres")
	case req.Kind != "" && req.Kind != "certification" && req.Kind != "action" && req.Kind != "other":
		return errors.New("tipo: certification, action u other")
	case req.Bonus != "" && req.Bonus != "primary" && req.Bonus != "secondary" && req.Bonus != "tertiary":
		return errors.New("escalón: primary, secondary o tertiary")
	case len(req.Steps) > 30:
		return errors.New("hasta 30 hitos")
	}
	for i, s := range req.Steps {
		req.Steps[i] = strings.TrimSpace(s)
		if req.Steps[i] == "" || len([]rune(req.Steps[i])) > 200 {
			return errors.New("cada hito va de 1 a 200 caracteres")
		}
	}
	return nil
}

// CreateGoal es POST /api/goals.
func (h *ManagementHandler) CreateGoal(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	var req goalRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	if err := req.validate(); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	due, err := req.due(c)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	if due.Before(c.today) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la fecha límite ya pasó")
		return
	}
	p := db.CreateGoalParams{Name: req.Name, Scope: req.Scope, DueDate: pgDate(due), EvidenceRequired: req.EvidenceRequired,
		CreatedBy: pgUUIDOf(u.id), OwnerUserID: optionalUUID(req.OwnerID)}
	if req.EstimateBizDays > 0 {
		p.EstimateBizDays = pgtype.Int4{Int32: req.EstimateBizDays, Valid: true}
	}
	switch req.Scope {
	case "client":
		if req.ClientID == nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige el cliente")
			return
		}
		if !u.canManage() {
			problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "las metas las crean Gestión, las jefaturas y el admin")
			return
		}
		p.ClientID, p.AreaID = pgUUIDOf(*req.ClientID), optionalUUID(req.AreaID)
	case "area":
		if req.AreaID == nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige el área")
			return
		}
		if !u.canManage() {
			problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "las metas las crean Gestión, las jefaturas y el admin")
			return
		}
		p.AreaID = pgUUIDOf(*req.AreaID)
	case "person":
		if req.PersonID == nil && (req.PersonName != "" || req.PersonEmail != "") {
			if !h.externalPerson(w, r, u, &req, &p) {
				return
			}
			break
		}
		if req.PersonID == nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige la persona")
			return
		}
		leads, err := h.Queries.ListLeadUserIDsOfPerson(ctx, *req.PersonID)
		if err != nil {
			mgmtFail(w, r)
			return
		}
		lead := false
		for _, id := range leads {
			lead = lead || id == u.id
		}
		if !u.admin && !lead {
			problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "las metas de una persona las crea la jefatura de su área o el admin")
			return
		}
		p.PersonUserID, p.OwnerUserID = pgUUIDOf(*req.PersonID), pgUUIDOf(*req.PersonID)
		p.Kind, p.BonusRank = optText(req.Kind), optText(req.Bonus)
		p.EvidenceRequired = req.EvidenceRequired && req.Kind == "certification"
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "para quién: client, area o person")
		return
	}
	if !p.OwnerUserID.Valid {
		p.OwnerUserID = pgUUIDOf(u.id)
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	id, err := q.CreateGoal(ctx, p)
	if isFKViolation(err) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el cliente, el área o la persona no existe")
		return
	}
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, s := range req.Steps {
		if _, err := q.CreateGoalMilestone(ctx, db.CreateGoalMilestoneParams{GoalID: id, Name: s}); err != nil {
			mgmtFail(w, r)
			return
		}
	}
	if err := q.AddGoalEvent(ctx, db.AddGoalEventParams{GoalID: id, Text: "Meta creada", UserID: pgUUIDOf(u.id)}); err != nil {
		mgmtFail(w, r)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "goal.created", audit.LevelInfo, audit.Success(), map[string]any{"goalId": id.String(), "scope": req.Scope, "bonus": req.Bonus})
	publishSync(ctx, h.Hub, "management.changed", map[string]string{"goalId": id.String()})
	r.SetPathValue("id", id.String())
	h.writeGoal(w, r, http.StatusCreated)
}

// externalPerson arma una meta para alguien sin cuenta: solo como registro,
// la crean el admin o una jefatura, y no puede llevar el correo de un usuario.
func (h *ManagementHandler) externalPerson(w http.ResponseWriter, r *http.Request, u agendaUser, req *goalRequest, p *db.CreateGoalParams) bool {
	if !u.admin && len(u.leads) == 0 {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "las metas de una persona las crea la jefatura de su área o el admin")
		return false
	}
	name, email := strings.TrimSpace(req.PersonName), strings.ToLower(strings.TrimSpace(req.PersonEmail))
	addr, err := mail.ParseAddress(email)
	switch {
	case name == "" || len([]rune(name)) > 120:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre va de 1 a 120 caracteres")
		return false
	case err != nil || addr.Address != email || len(email) > 254:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el correo no es válido")
		return false
	}
	if other, err := h.Queries.GetUserNameByEmail(r.Context(), email); err == nil {
		problemdetails.Write(w, r, http.StatusConflict, "conflict", "ese correo ya es de "+other.Name+": elígelo en la lista")
		return false
	} else if !errors.Is(err, pgx.ErrNoRows) {
		mgmtFail(w, r)
		return false
	}
	p.PersonName, p.PersonEmail = pgtype.Text{String: name, Valid: true}, pgtype.Text{String: email, Valid: true}
	p.OwnerUserID = pgUUIDOf(u.id)
	p.Kind, p.BonusRank = optText(req.Kind), optText(req.Bonus)
	p.EvidenceRequired = req.EvidenceRequired && req.Kind == "certification"
	return true
}

// UpdateGoal es PUT /api/goals/{id}: nombre, área (de una de cliente),
// responsable, tipo, bono, plazo y si pide el certificado.
func (h *ManagementHandler) UpdateGoal(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, c, g, row, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	if !g.CanEdit {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "la edita quien la creó, la jefatura o el admin")
		return
	}
	var req goalRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	req.Steps = nil
	if err := req.validate(); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	due, err := req.due(c)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	p := db.UpdateGoalParams{ID: g.ID, Name: req.Name, AreaID: optionalUUID(req.AreaID), OwnerUserID: optionalUUID(req.OwnerID), DueDate: pgDate(due),
		EvidenceRequired: req.EvidenceRequired}
	if req.EstimateBizDays > 0 {
		p.EstimateBizDays = pgtype.Int4{Int32: req.EstimateBizDays, Valid: true}
	}
	if row.Scope == "person" {
		p.OwnerUserID, p.Kind, p.BonusRank = row.PersonUserID, optText(req.Kind), optText(req.Bonus)
		p.EvidenceRequired = req.EvidenceRequired && req.Kind == "certification"
	}
	if !p.OwnerUserID.Valid {
		p.OwnerUserID = row.OwnerUserID
	}
	if err := h.Queries.UpdateGoal(ctx, p); err != nil {
		mgmtFail(w, r)
		return
	}
	h.goalEvent(ctx, g.ID, "Meta editada", u.id)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.updated", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String()})
	h.writeGoal(w, r, http.StatusOK)
}

// DeleteGoal es DELETE /api/goals/{id}.
func (h *ManagementHandler) DeleteGoal(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, _, g, row, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	if !g.CanEdit {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "la elimina quien la creó, la jefatura o el admin")
		return
	}
	if _, err := h.Queries.DeleteGoal(ctx, g.ID); err != nil {
		mgmtFail(w, r)
		return
	}
	h.applyPersonRule(ctx, row.PersonUserID)
	h.AuditLog.Log(ctx, "goal.deleted", audit.LevelWarn, audit.Success(), map[string]any{"goalId": g.ID.String(), "name": g.Name})
	writeNoContent(w)
}

func (h *ManagementHandler) goalEvent(ctx context.Context, goal uuid.UUID, text string, user uuid.UUID) {
	_ = h.Queries.AddGoalEvent(ctx, db.AddGoalEventParams{GoalID: goal, Text: text, UserID: pgtype.UUID{Bytes: user, Valid: user != uuid.Nil}})
}

// ===== Hitos =====

type milestoneRequest struct {
	Name     string     `json:"name"`
	TicketID *uuid.UUID `json:"ticketId"`
	TaskID   *uuid.UUID `json:"taskId"`
}

// AddMilestone es POST /api/goals/{id}/milestones.
func (h *ManagementHandler) AddMilestone(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	if !g.CanEdit && !g.CanMark {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "no puedes cambiar esta meta")
		return
	}
	var req milestoneRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Name) == "" || len([]rune(req.Name)) > 200 || (req.TicketID != nil && req.TaskID != nil) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el hito necesita un nombre (hasta 200) y, si se enlaza, un ticket o una tarea")
		return
	}
	if _, err := h.Queries.CreateGoalMilestone(ctx, db.CreateGoalMilestoneParams{GoalID: g.ID, Name: strings.TrimSpace(req.Name),
		TicketID: optionalUUID(req.TicketID), AgendaTaskID: optionalUUID(req.TaskID)}); err != nil {
		if isFKViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el ticket o la tarea no existe")
			return
		}
		mgmtFail(w, r)
		return
	}
	h.goalEvent(ctx, g.ID, "Hito agregado: "+strings.TrimSpace(req.Name), u.id)
	h.syncLinked(ctx)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.milestone.added", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String()})
	h.writeGoal(w, r, http.StatusCreated)
}

// UpdateMilestone es PUT /api/goals/{id}/milestones/{mid}.
func (h *ManagementHandler) UpdateMilestone(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	mid, err := uuid.Parse(r.PathValue("mid"))
	if err != nil || (!g.CanEdit && !g.CanMark) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "hito no encontrado")
		return
	}
	var req milestoneRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Name) == "" || len([]rune(req.Name)) > 200 || (req.TicketID != nil && req.TaskID != nil) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el hito necesita un nombre (hasta 200) y, si se enlaza, un ticket o una tarea")
		return
	}
	n, err := h.Queries.UpdateGoalMilestone(ctx, db.UpdateGoalMilestoneParams{ID: mid, GoalID: g.ID, Name: strings.TrimSpace(req.Name),
		TicketID: optionalUUID(req.TicketID), AgendaTaskID: optionalUUID(req.TaskID)})
	if err != nil || n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "hito no encontrado")
		return
	}
	h.goalEvent(ctx, g.ID, "Hito editado: "+strings.TrimSpace(req.Name), u.id)
	h.syncLinked(ctx)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.milestone.updated", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String(), "milestoneId": mid.String()})
	h.writeGoal(w, r, http.StatusOK)
}

// DeleteMilestone es DELETE /api/goals/{id}/milestones/{mid}.
func (h *ManagementHandler) DeleteMilestone(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	mid, err := uuid.Parse(r.PathValue("mid"))
	if err != nil || !g.CanEdit {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "hito no encontrado")
		return
	}
	if n, err := h.Queries.DeleteGoalMilestone(ctx, db.DeleteGoalMilestoneParams{ID: mid, GoalID: g.ID}); err != nil || n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "hito no encontrado")
		return
	}
	h.goalEvent(ctx, g.ID, "Hito quitado", u.id)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.milestone.deleted", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String(), "milestoneId": mid.String()})
	h.writeGoal(w, r, http.StatusOK)
}

// MarkMilestone es POST /api/goals/{id}/milestones/{mid}/done {done}: a mano
// (los enlazados se marcan solos).
func (h *ManagementHandler) MarkMilestone(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	mid, err := uuid.Parse(r.PathValue("mid"))
	if err != nil || !g.CanMark {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "los hitos los marca el responsable")
		return
	}
	var req struct {
		Done bool `json:"done"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	p := db.SetGoalMilestoneDoneParams{ID: mid, GoalID: g.ID}
	if req.Done {
		name := ""
		if me, err := h.Queries.GetUserByID(ctx, u.id); err == nil {
			name = me.Username
			if me.FullName.Valid && me.FullName.String != "" {
				name = me.FullName.String
			}
		}
		p.DoneAt, p.DoneBy, p.DoneByName = pgtype.Timestamptz{Time: h.now(), Valid: true}, pgUUIDOf(u.id), pgtype.Text{String: name, Valid: true}
	}
	n, err := h.Queries.SetGoalMilestoneDone(ctx, p)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusConflict, "milestone-linked", "este hito se marca solo con su ticket o su tarea")
		return
	}
	text := "Hito desmarcado"
	if req.Done {
		text = "Hito cumplido"
	}
	h.goalEvent(ctx, g.ID, text, u.id)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.milestone.marked", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String(), "milestoneId": mid.String(), "done": req.Done})
	publishSync(ctx, h.Hub, "management.changed", map[string]string{"goalId": g.ID.String()})
	h.writeGoal(w, r, http.StatusOK)
}

// GoalAction es POST /api/goals/{id}/{action}: risk (marcar o quitar «en
// riesgo»), complete (marcarla cumplida), confirm (la jefatura confirma una
// que cuenta para el bono) y reopen (con fecha nueva).
func (h *ManagementHandler) GoalAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, c, g, row, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	var req struct {
		Risk    bool   `json:"risk"`
		DueDate string `json:"dueDate"`
		Reason  string `json:"reason"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
			return
		}
	}
	now := pgtype.Timestamptz{Time: h.now(), Valid: true}
	action := r.PathValue("action")
	var event string
	switch action {
	case "risk":
		if !g.CanMark || g.State == "done" || g.State == "failed" || g.State == "not_needed" {
			problemdetails.Write(w, r, http.StatusConflict, "goal-closed", "la meta ya está cerrada")
			return
		}
		if err := h.Queries.SetGoalRisk(ctx, db.SetGoalRiskParams{ID: g.ID, ManualRisk: req.Risk}); err != nil {
			mgmtFail(w, r)
			return
		}
		event = map[bool]string{true: "Marcada en riesgo", false: "Se quitó «en riesgo»"}[req.Risk]
	case "complete":
		if !g.CanMark || g.State == "done" || g.State == "confirm" || row.Outcome.Valid {
			problemdetails.Write(w, r, http.StatusConflict, "goal-closed", "la meta ya está cerrada")
			return
		}
		if g.EvidenceNeeded && g.EvidenceCount == 0 {
			problemdetails.Write(w, r, http.StatusConflict, "evidence-missing", "falta el certificado para darla por cumplida")
			return
		}
		p := db.SetGoalCompletedParams{ID: g.ID, CompletedAt: now, CompletedBy: pgUUIDOf(u.id)}
		event = "Marcada lograda"
		// Quien puede confirmar no necesita pedírselo a nadie.
		if row.BonusRank.Valid && (g.CanEdit && (u.admin || !uuidEq(row.PersonUserID, u.id))) {
			p.ConfirmedAt, p.ConfirmedBy = now, pgUUIDOf(u.id)
		} else if row.BonusRank.Valid {
			event = "Marcada lograda: espera la confirmación de la jefatura"
		}
		if err := h.Queries.SetGoalCompleted(ctx, p); err != nil {
			mgmtFail(w, r)
			return
		}
	case "confirm":
		if !g.CanConfirm {
			problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "la confirma la jefatura de la persona o el admin")
			return
		}
		if err := h.Queries.SetGoalCompleted(ctx, db.SetGoalCompletedParams{ID: g.ID, CompletedAt: row.CompletedAt, CompletedBy: row.CompletedBy,
			ConfirmedAt: now, ConfirmedBy: pgUUIDOf(u.id)}); err != nil {
			mgmtFail(w, r)
			return
		}
		event = "Confirmada por la jefatura: lograda"
		h.AuditLog.Log(ctx, "goal.bonus.confirmed", audit.LevelWarn, audit.Success(), map[string]any{"goalId": g.ID.String(), "personId": uuidString(uuidPtr(row.PersonUserID)), "bonus": row.BonusRank.String})
	case "reopen":
		if !g.CanEdit || (g.State != "failed" && g.State != "done") {
			problemdetails.Write(w, r, http.StatusConflict, "goal-open", "se reabre una meta cumplida o no cumplida")
			return
		}
		due, err := agenda.ParseDate(req.DueDate)
		if err != nil || due.Before(c.today) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige una fecha nueva desde hoy")
			return
		}
		if err := h.Queries.ReopenGoal(ctx, db.ReopenGoalParams{ID: g.ID, DueDate: pgDate(due)}); err != nil {
			mgmtFail(w, r)
			return
		}
		event = "Reabierta con fecha " + due.Format("02-01-2006")
	case "not-achieved":
		// Rindió y no pasó: queda el dato y sigue la regla de la persona.
		if !g.CanOutcome {
			problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "la marca no lograda la jefatura de la persona o el admin")
			return
		}
		reason := strings.TrimSpace(req.Reason)
		if reason == "" || len([]rune(reason)) > 300 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "escribe el motivo (hasta 300 caracteres)")
			return
		}
		if row.CompletedAt.Valid {
			if err := h.Queries.SetGoalCompleted(ctx, db.SetGoalCompletedParams{ID: g.ID}); err != nil {
				mgmtFail(w, r)
				return
			}
		}
		if err := h.Queries.SetGoalOutcome(ctx, db.SetGoalOutcomeParams{ID: g.ID, Outcome: optText("not_achieved"), OutcomeReason: optText(reason),
			OutcomeBy: pgUUIDOf(u.id)}); err != nil {
			mgmtFail(w, r)
			return
		}
		event = "No lograda: " + reason
	default:
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "acción desconocida")
		return
	}
	h.goalEvent(ctx, g.ID, event, u.id)
	h.applyPersonRule(ctx, row.PersonUserID)
	h.AuditLog.Log(ctx, "goal."+action, audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String()})
	publishSync(ctx, h.Hub, "management.changed", map[string]string{"goalId": g.ID.String()})
	h.writeGoal(w, r, http.StatusOK)
}

// rankName: «la meta primaria» en los textos del historial.
var rankName = map[string]string{"primary": "la meta primaria", "secondary": "la meta secundaria", "tertiary": "la meta terciaria"}

// achieved: lograda de verdad (las de escalón, ya confirmadas).
func achieved(g db.ListGoalsRow) bool {
	return g.CompletedAt.Valid && (!g.BonusRank.Valid || g.ConfirmedAt.Valid) && !g.Outcome.Valid
}

// applyPersonRule aplica la regla de la persona a sus metas con escalón: si
// logró la que la regla pide (cualquiera, la primaria o la secundaria), las
// demás abiertas quedan «No hace falta»; si deja de estar lograda, vuelven a
// abrirse. Con «Todas cuentan» no cierra ninguna.
func (h *ManagementHandler) applyPersonRule(ctx context.Context, person pgtype.UUID) {
	if !person.Valid {
		return
	}
	rows, err := h.Queries.ListGoals(ctx, db.ListGoalsParams{PersonID: person})
	if err != nil || len(rows) == 0 {
		return
	}
	rule := rows[0].PersonRule
	var winner *db.ListGoalsRow
	for i, g := range rows {
		if g.BonusRank.Valid && achieved(g) && (rule == "any" || rule == g.BonusRank.String) {
			winner = &rows[i]
			break
		}
	}
	for _, g := range rows {
		if !g.BonusRank.Valid || g.CompletedAt.Valid {
			continue
		}
		switch {
		case winner != nil && g.ID != winner.ID && !g.Outcome.Valid:
			reason := "Logró " + rankName[winner.BonusRank.String] + " «" + winner.Name + "»"
			if err := h.Queries.SetGoalOutcome(ctx, db.SetGoalOutcomeParams{ID: g.ID, Outcome: optText("not_needed"), OutcomeReason: optText(reason)}); err == nil {
				h.goalEvent(ctx, g.ID, "No hace falta: "+reason, uuid.Nil)
			}
		case winner == nil && g.Outcome.String == "not_needed":
			if err := h.Queries.SetGoalOutcome(ctx, db.SetGoalOutcomeParams{ID: g.ID}); err == nil {
				h.goalEvent(ctx, g.ID, "Vuelve a estar en curso: ya no hay una meta lograda que la reemplace", uuid.Nil)
			}
		}
	}
}

// PersonRule es PUT /api/goal-rules/{userId} {rule}: la regla de las metas
// de una persona (all | any | primary | secondary); la cambian su jefatura o
// el admin.
func (h *ManagementHandler) PersonRule(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	person, err := uuid.Parse(r.PathValue("userId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "persona no encontrada")
		return
	}
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	leads, err := h.Queries.ListLeadUserIDsOfPerson(ctx, person)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	lead := false
	for _, id := range leads {
		lead = lead || id == u.id
	}
	if (!u.admin && !lead) || u.id == person {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "la regla la pone la jefatura de la persona o el admin")
		return
	}
	var req struct {
		Rule string `json:"rule"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	switch req.Rule {
	case "all":
		err = h.Queries.DeleteGoalPersonRule(ctx, person)
	case "any", "primary", "secondary":
		err = h.Queries.SetGoalPersonRule(ctx, db.SetGoalPersonRuleParams{UserID: person, Rule: req.Rule, UpdatedBy: pgUUIDOf(u.id)})
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "regla: all, any, primary o secondary")
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "persona no encontrada")
		return
	}
	if err != nil {
		mgmtFail(w, r)
		return
	}
	h.applyPersonRule(ctx, pgUUIDOf(person))
	h.AuditLog.Log(ctx, "goal.person_rule", audit.LevelInfo, audit.Success(), map[string]any{"personId": person.String(), "rule": req.Rule})
	publishSync(ctx, h.Hub, "management.changed", map[string]string{})
	writeData(w, http.StatusOK, map[string]string{"rule": req.Rule})
}

// ===== Certificado =====

const maxGoalEvidenceBytes = 10 << 20

var evidenceTypes = map[string]bool{"application/pdf": true, "image/png": true, "image/jpeg": true, "image/webp": true}

// AddEvidence es POST /api/goals/{id}/evidence: un archivo (multipart
// «file»: PDF o imagen, hasta 10 MB) o un enlace de verificación (JSON {url}).
func (h *ManagementHandler) AddEvidence(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	if !g.CanMark {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "el certificado lo adjunta la persona o la jefatura")
		return
	}
	p := db.AddGoalEvidenceParams{GoalID: g.ID, UploadedBy: pgUUIDOf(u.id)}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		r.Body = http.MaxBytesReader(w, r.Body, maxGoalEvidenceBytes+1<<20)
		file, header, err := r.FormFile("file")
		if err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "adjunta el certificado (PDF o imagen, hasta 10 MB)")
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxGoalEvidenceBytes+1))
		if err != nil || len(data) == 0 || len(data) > maxGoalEvidenceBytes {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el certificado va hasta 10 MB")
			return
		}
		mime := http.DetectContentType(data)
		if i := strings.Index(mime, ";"); i >= 0 {
			mime = mime[:i]
		}
		if !evidenceTypes[mime] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el certificado va en PDF, PNG, JPG o WebP")
			return
		}
		name := strings.TrimSpace(header.Filename)
		if name == "" || len(name) > 200 {
			name = "certificado"
		}
		p.FileName, p.MimeType = pgtype.Text{String: name, Valid: true}, pgtype.Text{String: mime, Valid: true}
		p.SizeBytes, p.FileData = pgtype.Int4{Int32: int32(len(data)), Valid: true}, data
	} else {
		var req struct {
			URL string `json:"url"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
			return
		}
		link, err := url.Parse(strings.TrimSpace(req.URL))
		if err != nil || (link.Scheme != "http" && link.Scheme != "https") || link.Host == "" || len(req.URL) > 500 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el enlace de verificación debe ser una URL http(s)")
			return
		}
		p.Url = pgtype.Text{String: link.String(), Valid: true}
	}
	if _, err := h.Queries.AddGoalEvidence(ctx, p); err != nil {
		mgmtFail(w, r)
		return
	}
	h.goalEvent(ctx, g.ID, "Certificado adjunto", u.id)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.evidence.added", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String()})
	h.writeGoal(w, r, http.StatusCreated)
}

// Evidence es GET /api/goals/{id}/evidence/{eid}: descarga el archivo.
func (h *ManagementHandler) Evidence(w http.ResponseWriter, r *http.Request) {
	_, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	eid, err := uuid.Parse(r.PathValue("eid"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "archivo no encontrado")
		return
	}
	f, err := h.Queries.GetGoalEvidenceFile(r.Context(), db.GetGoalEvidenceFileParams{ID: eid, GoalID: g.ID})
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "archivo no encontrado")
		return
	}
	writeImage(w, f.MimeType.String, f.FileName.String, f.FileData)
}

// DeleteEvidence es DELETE /api/goals/{id}/evidence/{eid}.
func (h *ManagementHandler) DeleteEvidence(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _, g, _, ok := h.goalFor(w, r)
	if !ok {
		return
	}
	eid, err := uuid.Parse(r.PathValue("eid"))
	if err != nil || !g.CanMark || g.State == "done" {
		problemdetails.Write(w, r, http.StatusConflict, "goal-closed", "con la meta cumplida el certificado se queda")
		return
	}
	if n, err := h.Queries.DeleteGoalEvidence(ctx, db.DeleteGoalEvidenceParams{ID: eid, GoalID: g.ID}); err != nil || n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "archivo no encontrado")
		return
	}
	h.goalEvent(ctx, g.ID, "Certificado quitado", u.id)
	h.reconcileGoal(ctx, g.ID)
	h.AuditLog.Log(ctx, "goal.evidence.deleted", audit.LevelInfo, audit.Success(), map[string]any{"goalId": g.ID.String()})
	h.writeGoal(w, r, http.StatusOK)
}

// ===== Hitos que se marcan solos =====

// syncLinked marca o desmarca los hitos enlazados según su ticket o su tarea
// y deja la constancia en el historial de la meta. Corre al leer metas y en
// el scheduler (así no hace falta engancharse en cada lugar que resuelve un
// ticket: la Ticketera, la Bitácora, un padre, GLPI…).
func (h *ManagementHandler) syncLinked(ctx context.Context) {
	touched := map[uuid.UUID]bool{}
	if rows, err := h.Queries.SyncMilestonesFromTickets(ctx); err == nil {
		for _, x := range rows {
			who := ""
			if x.DoneByName.String != "" {
				who = " (" + x.DoneByName.String + ")"
			}
			h.goalEvent(ctx, x.GoalID, fmt.Sprintf("Hito «%s» cumplido por %s%s", x.Name, x.TicketNumber, who), uuid.Nil)
			touched[x.GoalID] = true
		}
	}
	if rows, err := h.Queries.UnsyncMilestonesFromTickets(ctx); err == nil {
		for _, x := range rows {
			h.goalEvent(ctx, x.GoalID, fmt.Sprintf("Hito «%s» desmarcado: %s se reabrió", x.Name, x.TicketNumber), uuid.Nil)
			touched[x.GoalID] = true
		}
	}
	if rows, err := h.Queries.SyncMilestonesFromTasks(ctx); err == nil {
		for _, x := range rows {
			who := ""
			if x.DoneByName.String != "" {
				who = " (" + x.DoneByName.String + ")"
			}
			h.goalEvent(ctx, x.GoalID, fmt.Sprintf("Hito «%s» cumplido por la tarea «%s»%s", x.Name, x.TaskName, who), uuid.Nil)
			touched[x.GoalID] = true
		}
	}
	if rows, err := h.Queries.UnsyncMilestonesFromTasks(ctx); err == nil {
		for _, x := range rows {
			h.goalEvent(ctx, x.GoalID, fmt.Sprintf("Hito «%s» desmarcado: su tarea se reabrió", x.Name), uuid.Nil)
			touched[x.GoalID] = true
		}
	}
	for id := range touched {
		h.reconcileGoal(ctx, id)
	}
	if len(touched) > 0 {
		publishSync(ctx, h.Hub, "management.changed", map[string]string{})
	}
}

// reconcileGoal: con todos los hitos hechos (y el certificado si se pide) la
// meta se cumple sola; si después se desmarca un hito, vuelve a estar en
// curso (salvo que alguien la haya marcado o confirmado a mano).
func (h *ManagementHandler) reconcileGoal(ctx context.Context, id uuid.UUID) {
	rows, err := h.Queries.ListGoals(ctx, db.ListGoalsParams{GoalID: pgUUIDOf(id)})
	if err != nil || len(rows) == 0 {
		return
	}
	g := rows[0]
	defer h.applyPersonRule(ctx, g.PersonUserID)
	if g.Outcome.Valid {
		return // no lograda o no hace falta: los hitos no la cumplen
	}
	ready := g.Milestones > 0 && g.MilestonesDone == g.Milestones && (!g.EvidenceRequired || g.EvidenceCount > 0)
	switch {
	case ready && !g.CompletedAt.Valid:
		_ = h.Queries.SetGoalCompleted(ctx, db.SetGoalCompletedParams{ID: id, CompletedAt: pgtype.Timestamptz{Time: h.now(), Valid: true}})
		text := "Lograda: todos los hitos están hechos"
		if g.BonusRank.Valid {
			text = "Hitos completos: espera la confirmación de la jefatura"
		}
		h.goalEvent(ctx, id, text, uuid.Nil)
	case !ready && g.CompletedAt.Valid && !g.CompletedBy.Valid && !g.ConfirmedAt.Valid && g.Milestones > 0:
		_ = h.Queries.SetGoalCompleted(ctx, db.SetGoalCompletedParams{ID: id})
		h.goalEvent(ctx, id, "Vuelve a estar en curso: falta un hito o el certificado", uuid.Nil)
	}
}

// SyncTick corre en el scheduler: los hitos enlazados se marcan aunque nadie
// abra la Gestión.
func (h *ManagementHandler) SyncTick(ctx context.Context) error {
	h.syncLinked(ctx)
	return nil
}
