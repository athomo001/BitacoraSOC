package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
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

// Flujos entre áreas (spec/16 §6.1, 9.7, 000044, diseño aprobado por el dueño
// 2026-10-15): una tarea de la Agenda con pasos, cada uno de un área y
// responsable (Infra instala el rack → TI configura la red → CSM avisa).
//
// Cada paso elige cómo empieza (decisión del dueño):
//   - «al terminar el anterior»: queda en espera y, cuando el anterior se
//     cierra (hecho u omitido), vence N días hábiles después. Si el anterior
//     se atrasa, este se corre.
//   - «en paralelo»: vence N días hábiles desde el inicio y se puede hacer
//     aunque el anterior no haya terminado.
//
// Puede ser de una vez o repetirse con la recurrencia de la Agenda; cada
// vuelta es un agenda_flow_runs con una ocurrencia por paso. Lo arma quien
// puede asignar cada paso (mismas reglas que una tarea: hacia otras áreas,
// Gestión, jefaturas y el admin). Lo edita quien lo creó o el admin.

const maxFlowSteps = 20

// flowInfo: un flujo con sus pasos activos en orden (para los DTO).
type flowInfo struct {
	flow  db.ListAgendaFlowsRow
	steps []db.ListAgendaTasksRow
}

func (f flowInfo) stepAt(pos int32) (db.ListAgendaTasksRow, bool) {
	for _, s := range f.steps {
		if s.FlowPosition.Valid && s.FlowPosition.Int32 == pos {
			return s, true
		}
	}
	return db.ListAgendaTasksRow{}, false
}

// loadFlows arma los flujos (también los inactivos, por el historial) con sus pasos.
func (h *AgendaHandler) loadFlows(ctx context.Context, tasks []db.ListAgendaTasksRow) (map[uuid.UUID]flowInfo, error) {
	rows, err := h.Queries.ListAgendaFlows(ctx, true)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]flowInfo{}
	for _, f := range rows {
		out[f.ID] = flowInfo{flow: f}
	}
	for _, t := range tasks {
		if !t.FlowID.Valid || !t.Active {
			continue
		}
		id := uuid.UUID(t.FlowID.Bytes)
		if f, ok := out[id]; ok {
			f.steps = append(f.steps, t)
			out[id] = f
		}
	}
	for id, f := range out {
		sort.Slice(f.steps, func(i, j int) bool { return f.steps[i].FlowPosition.Int32 < f.steps[j].FlowPosition.Int32 })
		out[id] = f
	}
	return out, nil
}

// ===== Generación de vueltas =====

// generateFlows crea las vueltas que tocan hasta el horizonte, con una
// ocurrencia por paso: el primero y los en paralelo pendientes; los que
// esperan al anterior, en espera.
func (h *AgendaHandler) generateFlows(ctx context.Context, ac agendaCal, today, to time.Time, tasks []db.ListAgendaTasksRow) error {
	flows, err := h.loadFlows(ctx, tasks)
	if err != nil {
		return err
	}
	for _, f := range flows {
		if !f.flow.Active || f.flow.Paused || len(f.steps) == 0 {
			continue
		}
		var rec agenda.Recurrence
		if json.Unmarshal(f.flow.Recurrence, &rec) != nil {
			continue
		}
		for _, o := range ac.cal.Occurrences(rec, today, to) {
			run, err := h.Queries.InsertAgendaFlowRun(ctx, db.InsertAgendaFlowRunParams{FlowID: f.flow.ID, StartDate: pgDate(o.Date)})
			if errors.Is(err, pgx.ErrNoRows) {
				continue // ya existía
			}
			if err != nil {
				return err
			}
			for _, s := range f.steps {
				p := db.InsertFlowOccurrenceParams{TaskID: s.ID, DueDate: pgDate(o.Date), Status: "pending", FlowRunID: pgUUIDOf(run)}
				switch {
				case s.FlowPosition.Int32 == 0:
				case s.FlowAfter:
					p.Status = "waiting"
				default:
					p.DueDate = pgDate(flowDue(ac, o.Date, int(s.FlowDays)))
				}
				switch s.AssigneeKind {
				case "person":
					p.UserID = s.AssigneeUserID
				case "level":
					p.OfferedLevelID = s.AssigneeLevelID
				}
				if _, err := h.Queries.InsertFlowOccurrence(ctx, p); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// flowDue: N días hábiles desde un día; con 0, ese mismo día si es hábil o
// el siguiente hábil.
func flowDue(ac agendaCal, from time.Time, days int) time.Time {
	if days <= 0 {
		if ac.cal.IsBusiness(from) {
			return from
		}
		return ac.cal.NextBusiness(from)
	}
	return ac.cal.AddBusinessDays(from, days)
}

// advanceFlow: al cerrar (hecha u omitida) un paso de un flujo, el siguiente
// que lo esperaba empieza y se le avisa a su responsable. Mejor esfuerzo: el
// cierre ya quedó guardado.
func (h *AgendaHandler) advanceFlow(ctx context.Context, occID uuid.UUID, actor uuid.UUID) {
	o, err := h.Queries.GetAgendaOccurrence(ctx, occID)
	if err != nil || !o.FlowRunID.Valid {
		return
	}
	tasks, err := h.Queries.ListAgendaTasks(ctx, true)
	if err != nil {
		return
	}
	var cur db.ListAgendaTasksRow
	for _, t := range tasks {
		if t.ID == o.TaskID {
			cur = t
		}
	}
	if !cur.FlowID.Valid {
		return
	}
	flows, err := h.loadFlows(ctx, tasks)
	if err != nil {
		return
	}
	f := flows[uuid.UUID(cur.FlowID.Bytes)]
	next, ok := f.stepAt(cur.FlowPosition.Int32 + 1)
	if !ok || !next.FlowAfter {
		return
	}
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, now, now.AddDate(0, 3, 0))
	if err != nil {
		return
	}
	due := flowDue(ac, agenda.Day(now, ac.loc), int(next.FlowDays))
	if next.FlowDays > 0 {
		// Cerrado fuera del horario hábil: empieza a contar el siguiente día hábil.
		due = ac.cal.AddBusinessDays(agenda.Day(now, ac.loc), int(next.FlowDays))
	}
	n, err := h.Queries.ReleaseFlowStep(ctx, db.ReleaseFlowStepParams{TaskID: next.ID, FlowRunID: o.FlowRunID, DueDate: pgDate(due)})
	if err != nil || n == 0 {
		return
	}
	h.AuditLog.Log(ctx, "agenda.flow.step_started", audit.LevelInfo, audit.Success(), map[string]any{
		"flowId": f.flow.ID.String(), "taskId": next.ID.String(), "dueDate": agenda.FormatDate(due)})
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"taskId": next.ID.String()})
	if h.Notify != nil {
		h.Notify.Send(ctx, h.assignees(ctx, next), NotifMsg{Kind: NotifAgendaAssigned, Link: agendaLink, Exclude: actor,
			Title: fmt.Sprintf("Empieza tu paso: «%s»", next.Name),
			Body:  fmt.Sprintf("Flujo «%s»%s · vence el %s", f.flow.Name, clientSuffix(next), agenda.FormatDate(due))})
	}
}

// ===== DTO =====

type flowStepDTO struct {
	TaskID       uuid.UUID  `json:"taskId"`
	Position     int32      `json:"position"`
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	AreaID       uuid.UUID  `json:"areaId"`
	AreaName     string     `json:"areaName"`
	AssigneeKind string     `json:"assigneeKind"`
	AssigneeID   *uuid.UUID `json:"assigneeId,omitempty"`
	AssigneeName string     `json:"assigneeName"`
	After        bool       `json:"after"`
	Days         int32      `json:"days"`
	Steps        []string   `json:"steps"`
	DocURL       *string    `json:"docUrl,omitempty"`
	WarnDays     []int32    `json:"warnDays"`
}

type flowRunStepDTO struct {
	TaskID       uuid.UUID  `json:"taskId"`
	OccurrenceID uuid.UUID  `json:"occurrenceId"`
	Status       string     `json:"status"`
	DueDate      string     `json:"dueDate"`
	Late         bool       `json:"late"`
	HolderName   string     `json:"holderName,omitempty"`
	OfferedLevel string     `json:"offeredLevel,omitempty"`
	ClosedAt     *time.Time `json:"closedAt,omitempty"`
}

type flowRunDTO struct {
	ID        uuid.UUID        `json:"id"`
	StartDate string           `json:"startDate"`
	Done      int              `json:"done"`
	Steps     []flowRunStepDTO `json:"steps"`
}

type flowDTO struct {
	ID            uuid.UUID         `json:"id"`
	Name          string            `json:"name"`
	ClientID      *uuid.UUID        `json:"clientId,omitempty"`
	ClientName    string            `json:"clientName,omitempty"`
	Paused        bool              `json:"paused"`
	Recurrence    agenda.Recurrence `json:"recurrence"`
	CreatedByName string            `json:"createdByName"`
	CanEdit       bool              `json:"canEdit"`
	Steps         []flowStepDTO     `json:"steps"`
	// Run: la vuelta que se muestra (la primera abierta que ya empezó; si no,
	// la próxima; si no, la última).
	Run *flowRunDTO `json:"run,omitempty"`
	// State: ok | late | done | waiting (todavía no empieza) | paused.
	State string `json:"state"`
}

func (u agendaUser) canSeeFlow(f flowInfo) bool {
	if u.viewAll || uuidEq(f.flow.CreatedBy, u.id) {
		return true
	}
	for _, s := range f.steps {
		if u.areas[s.AreaID] {
			return true
		}
	}
	return false
}

func (u agendaUser) canEditFlow(f flowInfo) bool { return u.admin || uuidEq(f.flow.CreatedBy, u.id) }

// Flows: GET /api/agenda/flows. Los flujos que el usuario ve, con la vuelta en curso.
func (h *AgendaHandler) Flows(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := h.now()
	v, err := h.loadView(ctx, now.AddDate(0, 0, -90), now.AddDate(0, 0, agendaHorizon))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	all := make([]db.ListAgendaTasksRow, 0, len(v.tasks))
	for _, t := range v.tasks {
		all = append(all, t)
	}
	flows, err := h.loadFlows(ctx, all)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	runs, err := h.Queries.ListFlowRuns(ctx, pgDate(v.today.AddDate(0, 0, -90)))
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	byFlow := map[uuid.UUID][]db.ListFlowRunsRow{}
	for _, run := range runs {
		byFlow[run.FlowID] = append(byFlow[run.FlowID], run)
	}
	chosen := map[uuid.UUID]db.ListFlowRunsRow{}
	var runIDs []uuid.UUID
	for id, list := range byFlow {
		if run, ok := pickRun(list, v.today); ok {
			chosen[id] = run
			runIDs = append(runIDs, run.ID)
		}
	}
	occs, err := h.Queries.ListFlowRunOccurrences(ctx, runIDs)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	byRun := map[uuid.UUID][]db.ListFlowRunOccurrencesRow{}
	for _, o := range occs {
		byRun[uuid.UUID(o.FlowRunID.Bytes)] = append(byRun[uuid.UUID(o.FlowRunID.Bytes)], o)
	}
	out := []flowDTO{}
	for _, f := range flows {
		if !f.flow.Active || !v.u.canSeeFlow(f) {
			continue
		}
		d := h.flowDTO(f, v)
		if run, ok := chosen[f.flow.ID]; ok {
			d.Run, d.State = flowRunState(f, run, byRun[run.ID], v)
		} else if d.State == "" {
			d.State = "waiting"
		}
		if f.flow.Paused {
			d.State = "paused"
		}
		out = append(out, d)
	}
	sort.SliceStable(out, func(i, j int) bool {
		order := map[string]int{"late": 0, "ok": 1, "waiting": 2, "done": 3, "paused": 4}
		if order[out[i].State] != order[out[j].State] {
			return order[out[i].State] < order[out[j].State]
		}
		return out[i].Name < out[j].Name
	})
	writeData(w, http.StatusOK, out)
}

// pickRun: la primera vuelta abierta que ya empezó; si no, la próxima; si no, la última.
func pickRun(list []db.ListFlowRunsRow, today time.Time) (db.ListFlowRunsRow, bool) {
	if len(list) == 0 {
		return db.ListFlowRunsRow{}, false
	}
	for _, r := range list {
		if r.Open && !r.StartDate.Time.After(today) {
			return r, true
		}
	}
	for _, r := range list {
		if r.StartDate.Time.After(today) {
			return r, true
		}
	}
	return list[len(list)-1], true
}

func (h *AgendaHandler) flowDTO(f flowInfo, v agendaView) flowDTO {
	var rec agenda.Recurrence
	_ = json.Unmarshal(f.flow.Recurrence, &rec)
	d := flowDTO{ID: f.flow.ID, Name: f.flow.Name, ClientID: uuidPtr(f.flow.OrganizationID), ClientName: f.flow.OrganizationName,
		Paused: f.flow.Paused, Recurrence: rec, CreatedByName: f.flow.CreatedByName, CanEdit: v.u.canEditFlow(f), Steps: []flowStepDTO{}}
	for _, s := range f.steps {
		t := toAgendaTaskDTO(s, v.u)
		d.Steps = append(d.Steps, flowStepDTO{TaskID: s.ID, Position: s.FlowPosition.Int32, Name: s.Name, Description: s.Description,
			AreaID: s.AreaID, AreaName: s.AreaName, AssigneeKind: s.AssigneeKind, AssigneeID: t.AssigneeID, AssigneeName: t.AssigneeName,
			After: s.FlowAfter, Days: s.FlowDays, Steps: t.Steps, DocURL: t.DocURL, WarnDays: t.WarnDays})
	}
	return d
}

func flowRunState(f flowInfo, run db.ListFlowRunsRow, occs []db.ListFlowRunOccurrencesRow, v agendaView) (*flowRunDTO, string) {
	dto := &flowRunDTO{ID: run.ID, StartDate: agenda.FormatDate(run.StartDate.Time), Steps: []flowRunStepDTO{}}
	byTask := map[uuid.UUID]db.ListFlowRunOccurrencesRow{}
	for _, o := range occs {
		byTask[o.TaskID] = o
	}
	state := "ok"
	if run.StartDate.Time.After(v.today) {
		state = "waiting"
	}
	for _, s := range f.steps {
		o, ok := byTask[s.ID]
		if !ok {
			continue
		}
		st := flowRunStepDTO{TaskID: s.ID, OccurrenceID: o.ID, Status: o.Status, DueDate: agenda.FormatDate(o.DueDate.Time),
			HolderName: o.UserName, OfferedLevel: o.OfferedLevelName, ClosedAt: timestamptzPtr(o.ClosedAt)}
		if o.Status == "waiting" {
			st.DueDate = ""
		}
		st.Late = o.Status == "pending" && v.now.After(v.ac.dueAt(o.DueDate.Time))
		if st.Late {
			state = "late"
		}
		if o.Status == "done" || o.Status == "skipped" {
			dto.Done++
		}
		dto.Steps = append(dto.Steps, st)
	}
	if dto.Done == len(dto.Steps) && len(dto.Steps) > 0 {
		state = "done"
	}
	return dto, state
}

// ===== Crear, editar y borrar =====

type flowStepRequest struct {
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	AreaID       uuid.UUID `json:"areaId"`
	AssigneeKind string    `json:"assigneeKind"`
	AssigneeID   uuid.UUID `json:"assigneeId"`
	After        bool      `json:"after"`
	Days         int32     `json:"days"`
	Steps        []string  `json:"steps"`
	DocURL       string    `json:"docUrl"`
	WarnDays     []int32   `json:"warnDays"`
}

type flowRequest struct {
	Name       string            `json:"name"`
	ClientID   *uuid.UUID        `json:"clientId"`
	Recurrence agenda.Recurrence `json:"recurrence"`
	Steps      []flowStepRequest `json:"steps"`
}

// readFlow valida el flujo y cada paso con las mismas reglas de una tarea.
// prev: la recurrencia guardada al editar (si no cambia, una fecha que ya
// pasó se acepta: se puede cambiar un paso de un flujo en curso).
func (h *AgendaHandler) readFlow(w http.ResponseWriter, r *http.Request, u agendaUser, prev []byte) (flowRequest, []agendaTaskRequest, []byte, bool) {
	var req flowRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return req, nil, nil, false
	}
	bad := func(msg string) (flowRequest, []agendaTaskRequest, []byte, bool) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return req, nil, nil, false
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len([]rune(req.Name)) > 200 {
		return bad("el nombre del flujo va de 1 a 200 caracteres")
	}
	if len(req.Steps) < 2 || len(req.Steps) > maxFlowSteps {
		return bad(fmt.Sprintf("un flujo tiene de 2 a %d pasos", maxFlowSteps))
	}
	ac, err := loadAgendaCal(r.Context(), h.Queries, h.now(), h.now())
	if err != nil {
		agendaFail(w, r, err)
		return req, nil, nil, false
	}
	today := agenda.Day(h.now(), ac.loc)
	if req.Recurrence.Kind == agenda.KindOnce && prev != nil {
		var old agenda.Recurrence
		if json.Unmarshal(prev, &old) == nil && old.Kind == agenda.KindOnce && old.Date == req.Recurrence.Date {
			if d, err := agenda.ParseDate(old.Date); err == nil && d.Before(today) {
				today = d
			}
		}
	}
	opts, err := h.assignOptions(r.Context(), u)
	if err != nil {
		agendaFail(w, r, err)
		return req, nil, nil, false
	}
	steps := make([]agendaTaskRequest, 0, len(req.Steps))
	for i, s := range req.Steps {
		if s.Days < 0 || s.Days > 60 {
			return bad(fmt.Sprintf("paso %d: el plazo va de 0 a 60 días hábiles", i+1))
		}
		t := agendaTaskRequest{Name: s.Name, Description: s.Description, AreaID: s.AreaID, ClientID: req.ClientID, AssigneeKind: s.AssigneeKind,
			AssigneeID: s.AssigneeID, Recurrence: req.Recurrence, WarnDays: s.WarnDays, Steps: s.Steps, DocURL: s.DocURL}
		if t.WarnDays == nil {
			t.WarnDays = []int32{0}
		}
		if err := t.validate(today); err != nil {
			return bad(fmt.Sprintf("paso %d: %s", i+1, err.Error()))
		}
		if err := checkAssign(opts, u.id, t.AreaID, t.AssigneeKind, t.AssigneeID); err != nil {
			problemdetails.Write(w, r, http.StatusForbidden, "agenda-assign-forbidden", fmt.Sprintf("paso %d: %s", i+1, err.Error()))
			return req, nil, nil, false
		}
		if i == 0 {
			req.Steps[i].After, req.Steps[i].Days = false, 0
		}
		steps = append(steps, t)
	}
	rec, _ := json.Marshal(req.Recurrence)
	return req, steps, rec, true
}

func (h *AgendaHandler) saveFlowSteps(ctx context.Context, flowID uuid.UUID, req flowRequest, steps []agendaTaskRequest, rec []byte, existing []db.ListAgendaTasksRow, actor uuid.UUID) error {
	byPos := map[int32]db.ListAgendaTasksRow{}
	for _, s := range existing {
		byPos[s.FlowPosition.Int32] = s
	}
	for i, t := range steps {
		user, level, team := t.assignee()
		pos := int32(i)
		if old, ok := byPos[pos]; ok {
			if err := h.Queries.UpdateAgendaFlowStep(ctx, db.UpdateAgendaFlowStepParams{ID: old.ID, Name: t.Name, Description: t.Description,
				AreaID: t.AreaID, OrganizationID: optionalUUID(req.ClientID), AssigneeKind: t.AssigneeKind, AssigneeUserID: user,
				AssigneeLevelID: level, AssigneeTeamID: team, Recurrence: rec, WarnDays: t.WarnDays, Steps: t.Steps, DocUrl: optText(t.DocURL),
				FlowAfter: req.Steps[i].After, FlowDays: req.Steps[i].Days}); err != nil {
				return err
			}
			continue
		}
		if _, err := h.Queries.CreateAgendaFlowStep(ctx, db.CreateAgendaFlowStepParams{Name: t.Name, Description: t.Description, AreaID: t.AreaID,
			OrganizationID: optionalUUID(req.ClientID), AssigneeKind: t.AssigneeKind, AssigneeUserID: user, AssigneeLevelID: level,
			AssigneeTeamID: team, Recurrence: rec, WarnDays: t.WarnDays, Steps: t.Steps, DocUrl: optText(t.DocURL), CreatedBy: pgUUIDOf(actor),
			FlowID: pgUUIDOf(flowID), FlowPosition: pgtype.Int4{Int32: pos, Valid: true}, FlowAfter: req.Steps[i].After, FlowDays: req.Steps[i].Days}); err != nil {
			return err
		}
	}
	_, err := h.Queries.DeactivateFlowStepsFrom(ctx, db.DeactivateFlowStepsFromParams{FlowID: pgUUIDOf(flowID), FromPosition: int32(len(steps))})
	return err
}

// CreateFlow: POST /api/agenda/flows.
func (h *AgendaHandler) CreateFlow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	req, steps, rec, ok := h.readFlow(w, r, u, nil)
	if !ok {
		return
	}
	id, err := h.Queries.CreateAgendaFlow(ctx, db.CreateAgendaFlowParams{Name: req.Name, OrganizationID: optionalUUID(req.ClientID), Recurrence: rec, CreatedBy: pgUUIDOf(u.id)})
	if err != nil {
		h.flowSaveFail(w, r, err)
		return
	}
	if err := h.saveFlowSteps(ctx, id, req, steps, rec, nil, u.id); err != nil {
		h.flowSaveFail(w, r, err)
		return
	}
	_ = h.generate(ctx, true)
	h.AuditLog.Log(ctx, "agenda.flow.created", audit.LevelInfo, audit.Success(), map[string]any{"flowId": id.String(), "name": req.Name, "steps": len(steps)})
	h.notifyFlowStart(ctx, id, u.id)
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"flowId": id.String()})
	writeData(w, http.StatusCreated, map[string]any{"id": id})
}

// notifyFlowStart avisa a los responsables de los pasos que ya pueden empezar.
func (h *AgendaHandler) notifyFlowStart(ctx context.Context, flowID uuid.UUID, actor uuid.UUID) {
	tasks, err := h.Queries.ListAgendaTasks(ctx, false)
	if err != nil {
		return
	}
	for _, t := range tasks {
		if uuidEq(t.FlowID, flowID) && (t.FlowPosition.Int32 == 0 || !t.FlowAfter) {
			h.notifyAssigned(ctx, t, actor)
		}
	}
}

func (h *AgendaHandler) flowSaveFail(w http.ResponseWriter, r *http.Request, err error) {
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el área, el cliente o un responsable no existe")
		return
	}
	agendaFail(w, r, err)
}

// flowFor lee el flujo del path y revisa que el usuario lo edite.
func (h *AgendaHandler) flowFor(w http.ResponseWriter, r *http.Request, u agendaUser) (flowInfo, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-id", "id inválido")
		return flowInfo{}, false
	}
	tasks, err := h.Queries.ListAgendaTasks(r.Context(), true)
	if err != nil {
		agendaFail(w, r, err)
		return flowInfo{}, false
	}
	flows, err := h.loadFlows(r.Context(), tasks)
	if err != nil {
		agendaFail(w, r, err)
		return flowInfo{}, false
	}
	f, ok := flows[id]
	if !ok || !f.flow.Active || !u.canSeeFlow(f) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "flujo no encontrado")
		return f, false
	}
	if !u.canEditFlow(f) {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "lo edita quien lo creó o el admin")
		return f, false
	}
	return f, true
}

// UpdateFlow: PUT /api/agenda/flows/{id}. Las vueltas en curso siguen con sus
// pasos; las que todavía no empiezan y nadie tocó se rehacen.
func (h *AgendaHandler) UpdateFlow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	f, ok := h.flowFor(w, r, u)
	if !ok {
		return
	}
	req, steps, rec, ok := h.readFlow(w, r, u, f.flow.Recurrence)
	if !ok {
		return
	}
	if err := h.Queries.UpdateAgendaFlow(ctx, db.UpdateAgendaFlowParams{ID: f.flow.ID, Name: req.Name, OrganizationID: optionalUUID(req.ClientID), Recurrence: rec}); err != nil {
		h.flowSaveFail(w, r, err)
		return
	}
	if err := h.saveFlowSteps(ctx, f.flow.ID, req, steps, rec, f.steps, u.id); err != nil {
		h.flowSaveFail(w, r, err)
		return
	}
	ac, err := loadAgendaCal(ctx, h.Queries, h.now(), h.now())
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if _, err := h.Queries.DeleteFutureUntouchedRuns(ctx, db.DeleteFutureUntouchedRunsParams{FlowID: f.flow.ID, FromDay: pgDate(agenda.Day(h.now(), ac.loc).AddDate(0, 0, 1))}); err != nil {
		agendaFail(w, r, err)
		return
	}
	_ = h.generate(ctx, true)
	h.AuditLog.Log(ctx, "agenda.flow.updated", audit.LevelInfo, audit.Success(), map[string]any{"flowId": f.flow.ID.String(), "name": req.Name, "steps": len(steps)})
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"flowId": f.flow.ID.String()})
	writeNoContent(w)
}

// DeleteFlow: DELETE /api/agenda/flows/{id}. Queda el historial; las vueltas
// que no empezaron se borran.
func (h *AgendaHandler) DeleteFlow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, err := loadAgendaUser(ctx, h.Queries)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	f, ok := h.flowFor(w, r, u)
	if !ok {
		return
	}
	ac, err := loadAgendaCal(ctx, h.Queries, h.now(), h.now())
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	if _, err := h.Queries.SetAgendaFlowActive(ctx, db.SetAgendaFlowActiveParams{ID: f.flow.ID, Active: false}); err != nil {
		agendaFail(w, r, err)
		return
	}
	if _, err := h.Queries.DeactivateFlowSteps(ctx, pgUUIDOf(f.flow.ID)); err != nil {
		agendaFail(w, r, err)
		return
	}
	if _, err := h.Queries.DeleteFutureUntouchedRuns(ctx, db.DeleteFutureUntouchedRunsParams{FlowID: f.flow.ID, FromDay: pgDate(agenda.Day(h.now(), ac.loc).AddDate(0, 0, 1))}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.AuditLog.Log(ctx, "agenda.flow.deactivated", audit.LevelInfo, audit.Success(), map[string]any{"flowId": f.flow.ID.String(), "name": f.flow.Name})
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{"flowId": f.flow.ID.String()})
	writeNoContent(w)
}
