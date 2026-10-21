package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Plantillas (playbooks, §4.4): una lista de acciones con quién y cuándo,
// relativa a una fecha (el día que se aplica, una fecha que se elige o la
// renovación del cliente). Al aplicarla se crean tareas normales de la
// Agenda: se toman, se marcan y cuentan en los indicadores como las demás.

type playbookItemDTO struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	ActionKind *string    `json:"actionKind,omitempty"`
	IsKey      bool       `json:"isKey"`
	Assignee   string     `json:"assignee"` // csm | level | guard
	AreaID     *uuid.UUID `json:"areaId,omitempty"`
	AreaName   string     `json:"areaName,omitempty"`
	LevelID    *uuid.UUID `json:"levelId,omitempty"`
	LevelName  string     `json:"levelName,omitempty"`
	TeamID     *uuid.UUID `json:"teamId,omitempty"`
	TeamName   string     `json:"teamName,omitempty"`
	OffsetDays int32      `json:"offsetDays"`
	OffsetUnit string     `json:"offsetUnit"` // biz | cal
}

type playbookDTO struct {
	ID          uuid.UUID         `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Anchor      string            `json:"anchor"` // apply | date | renewal
	SystemKey   *string           `json:"systemKey,omitempty"`
	Items       []playbookItemDTO `json:"items"`
}

func (h *ManagementHandler) loadPlaybooks(ctx context.Context) ([]playbookDTO, error) {
	rows, err := h.Queries.ListPlaybooks(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(rows))
	out := make([]playbookDTO, 0, len(rows))
	index := map[uuid.UUID]int{}
	for _, p := range rows {
		ids = append(ids, p.ID)
		index[p.ID] = len(out)
		out = append(out, playbookDTO{ID: p.ID, Name: p.Name, Description: p.Description, Anchor: p.Anchor, SystemKey: textPtr(p.SystemKey), Items: []playbookItemDTO{}})
	}
	items, err := h.Queries.ListPlaybookItems(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, i := range items {
		k, ok := index[i.PlaybookID]
		if !ok {
			continue
		}
		out[k].Items = append(out[k].Items, playbookItemDTO{ID: i.ID, Name: i.Name, ActionKind: textPtr(i.ActionKind), IsKey: i.IsKey, Assignee: i.Assignee,
			AreaID: uuidPtr(i.AreaID), AreaName: i.AreaName, LevelID: uuidPtr(i.LevelID), LevelName: i.LevelName, TeamID: uuidPtr(i.TeamID),
			TeamName: i.TeamName, OffsetDays: i.OffsetDays, OffsetUnit: i.OffsetUnit})
	}
	return out, nil
}

// Playbooks es GET /api/playbooks.
func (h *ManagementHandler) Playbooks(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.managementUser(w, r); !ok {
		return
	}
	out, err := h.loadPlaybooks(r.Context())
	if err != nil {
		mgmtFail(w, r)
		return
	}
	writeData(w, http.StatusOK, out)
}

type playbookRequest struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Anchor      string            `json:"anchor"`
	Items       []playbookItemDTO `json:"items"`
}

func (req *playbookRequest) validate() error {
	req.Name, req.Description = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	switch {
	case req.Name == "" || len([]rune(req.Name)) > 120:
		return errors.New("el nombre va de 1 a 120 caracteres")
	case len([]rune(req.Description)) > 300:
		return errors.New("el «cuándo» va hasta 300 caracteres")
	case req.Anchor != "apply" && req.Anchor != "date" && req.Anchor != "renewal":
		return errors.New("relativa a: apply, date o renewal")
	case len(req.Items) == 0 || len(req.Items) > 40:
		return errors.New("una plantilla tiene de 1 a 40 acciones")
	}
	for i := range req.Items {
		it := &req.Items[i]
		it.Name = strings.TrimSpace(it.Name)
		switch {
		case it.Name == "" || len([]rune(it.Name)) > 200:
			return errors.New("cada acción necesita un nombre (hasta 200)")
		case it.ActionKind != nil && *it.ActionKind != "" && !agendaActionKinds[*it.ActionKind]:
			return errors.New("tipo de acción desconocido")
		case it.Assignee == "level" && (it.AreaID == nil || it.LevelID == nil):
			return errors.New("una acción de un nivel necesita el área y el nivel")
		case it.Assignee == "guard" && (it.TeamID == nil || it.AreaID == nil):
			return errors.New("una acción de una guardia necesita la guardia y su área")
		case it.Assignee != "csm" && it.Assignee != "level" && it.Assignee != "guard":
			return errors.New("quién: csm, level o guard")
		case it.OffsetDays < -400 || it.OffsetDays > 400:
			return errors.New("los días van de -400 a 400")
		case it.OffsetUnit != "biz" && it.OffsetUnit != "cal":
			return errors.New("días hábiles (biz) o corridos (cal)")
		}
	}
	return nil
}

func (h *ManagementHandler) savePlaybookItems(ctx context.Context, q *db.Queries, id uuid.UUID, items []playbookItemDTO) error {
	if err := q.DeletePlaybookItems(ctx, id); err != nil {
		return err
	}
	for i, it := range items {
		kind := pgtype.Text{}
		if it.ActionKind != nil {
			kind = optText(*it.ActionKind)
		}
		p := db.CreatePlaybookItemParams{PlaybookID: id, Position: int32(i + 1), Name: it.Name, ActionKind: kind, IsKey: it.IsKey, Assignee: it.Assignee,
			OffsetDays: it.OffsetDays, OffsetUnit: it.OffsetUnit}
		switch it.Assignee {
		case "level":
			p.AreaID, p.LevelID = optionalUUID(it.AreaID), optionalUUID(it.LevelID)
		case "guard":
			p.AreaID, p.TeamID = optionalUUID(it.AreaID), optionalUUID(it.TeamID)
		}
		if err := q.CreatePlaybookItem(ctx, p); err != nil {
			return err
		}
	}
	return nil
}

// SavePlaybook es POST /api/playbooks y PUT /api/playbooks/{id}. En las que
// vienen con la app no cambia la fecha de referencia.
func (h *ManagementHandler) SavePlaybook(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	var req playbookRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	if err := req.validate(); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	id, status, event := uuid.Nil, http.StatusOK, "playbook.updated"
	if raw := r.PathValue("id"); raw != "" {
		if id, err = uuid.Parse(raw); err != nil {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "plantilla no encontrada")
			return
		}
		n, err := q.UpdatePlaybook(ctx, db.UpdatePlaybookParams{ID: id, Name: req.Name, Description: req.Description, Anchor: req.Anchor})
		if err != nil || n == 0 {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "plantilla no encontrada")
			return
		}
	} else {
		if id, err = q.CreatePlaybook(ctx, db.CreatePlaybookParams{Name: req.Name, Description: req.Description, Anchor: req.Anchor, CreatedBy: pgUUIDOf(u.id)}); err != nil {
			mgmtFail(w, r)
			return
		}
		status, event = http.StatusCreated, "playbook.created"
	}
	if err := h.savePlaybookItems(ctx, q, id, req.Items); err != nil {
		if isFKViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el área, el nivel o la guardia no existe")
			return
		}
		mgmtFail(w, r)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, event, audit.LevelInfo, audit.Success(), map[string]any{"playbookId": id.String(), "name": req.Name})
	all, err := h.loadPlaybooks(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, p := range all {
		if p.ID == id {
			writeData(w, status, p)
			return
		}
	}
	mgmtFail(w, r)
}

// DeletePlaybook es DELETE /api/playbooks/{id}: la desactiva (lo aplicado se queda).
func (h *ManagementHandler) DeletePlaybook(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.managementUser(w, r); !ok {
		return
	}
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "plantilla no encontrada")
		return
	}
	n, err := h.Queries.DeactivatePlaybook(ctx, id)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusConflict, "playbook-system", "las plantillas que vienen con la app no se eliminan")
		return
	}
	h.AuditLog.Log(ctx, "playbook.deleted", audit.LevelInfo, audit.Success(), map[string]any{"playbookId": id.String()})
	writeNoContent(w)
}

// playbookDate: la fecha de una acción. Los días hábiles se cuentan con el
// calendario de la Agenda; si cae en un día no hábil se adelanta al hábil
// anterior (antes de la fecha) o se posterga (el mismo día o después). Lo
// que ya pasó queda para el primer día hábil desde hoy.
func playbookDate(anchor time.Time, it playbookItemDTO, cal agenda.Calendar, today time.Time) time.Time {
	var d time.Time
	if it.OffsetUnit == "cal" {
		d = anchor.AddDate(0, 0, int(it.OffsetDays))
	} else {
		d = cal.AddBusinessDays(anchor, int(it.OffsetDays))
	}
	if !cal.IsBusiness(d) {
		if it.OffsetDays < 0 {
			d = cal.PrevBusiness(d)
		} else {
			d = cal.NextBusiness(d)
		}
	}
	if d.Before(today) {
		d = today
		if !cal.IsBusiness(d) {
			d = cal.NextBusiness(d)
		}
	}
	return d
}

// homeArea: el área de las tareas de una persona (su primera área; sin
// áreas, la primera activa que recibe tareas).
func (h *ManagementHandler) homeArea(ctx context.Context, user uuid.UUID) (uuid.UUID, error) {
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	mine := map[uuid.UUID]bool{}
	if rows, err := h.Queries.ListUserTicketGroups(ctx, user); err == nil {
		for _, r := range rows {
			if r.AreaID.Valid {
				mine[uuid.UUID(r.AreaID.Bytes)] = true
			}
		}
	}
	for _, a := range areas {
		if mine[a.ID] {
			return a.ID, nil
		}
	}
	if len(areas) == 0 {
		return uuid.Nil, errors.New("no hay áreas activas")
	}
	return areas[0].ID, nil
}

// ApplyPlaybook es POST /api/playbooks/{id}/apply {clientId, anchorDate}.
// Las acciones del CSM quedan para el CSM a cargo del cliente (o quien la
// aplica); las de un área, para su nivel o su guardia (si el área está
// apagada en esta instalación, también para el CSM).
func (h *ManagementHandler) ApplyPlaybook(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "plantilla no encontrada")
		return
	}
	var req struct {
		ClientID   uuid.UUID `json:"clientId"`
		AnchorDate string    `json:"anchorDate"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.ClientID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige el cliente")
		return
	}
	all, err := h.loadPlaybooks(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	var pb *playbookDTO
	for i := range all {
		if all[i].ID == id {
			pb = &all[i]
		}
	}
	if pb == nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "plantilla no encontrada")
		return
	}
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	clients, err := h.Queries.ListManagementClients(ctx, db.ListManagementClientsParams{Now: pgtype.Timestamptz{Time: c.now, Valid: true},
		LateBefore: pgDate(c.lateBefore), ClientID: pgUUIDOf(req.ClientID)})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if len(clients) == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	client := clients[0]
	anchor := c.today
	switch pb.Anchor {
	case "date":
		if anchor, err = agenda.ParseDate(req.AnchorDate); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige la fecha (YYYY-MM-DD)")
			return
		}
	case "renewal":
		if !client.RenewalDate.Valid {
			problemdetails.Write(w, r, http.StatusConflict, "no-renewal-date", "el cliente no tiene fecha de renovación: agrégala en su ficha")
			return
		}
		anchor = client.RenewalDate.Time
	}
	// La misma plantilla con la misma fecha no se aplica dos veces.
	if prev, err := h.Queries.ListClientPlaybookTasks(ctx, req.ClientID); err == nil {
		for _, p := range prev {
			if p.PlaybookID == id && p.AnchorDate.Time.Equal(anchor) {
				problemdetails.Write(w, r, http.StatusConflict, "playbook-applied", "esta plantilla ya se aplicó a este cliente con esa fecha")
				return
			}
		}
	}
	csm := u.id
	if client.CsmUserID.Valid {
		csm = uuid.UUID(client.CsmUserID.Bytes)
	}
	csmArea, err := h.homeArea(ctx, csm)
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "no-area", err.Error())
		return
	}
	activeArea := map[uuid.UUID]bool{}
	if areas, err := h.Queries.ListTicketAreas(ctx); err == nil {
		for _, a := range areas {
			activeArea[a.ID] = true
		}
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	appID, err := q.CreatePlaybookApplication(ctx, db.CreatePlaybookApplicationParams{PlaybookID: id, ClientID: req.ClientID, AnchorDate: pgDate(anchor), AppliedBy: pgUUIDOf(u.id)})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	created := []uuid.UUID{}
	for _, it := range pb.Items {
		due := playbookDate(anchor, it, c.ac.cal, c.today)
		rec, _ := json.Marshal(agenda.Recurrence{Kind: agenda.KindOnce, Date: agenda.FormatDate(due)})
		p := db.CreateAgendaTaskParams{Name: it.Name, Description: "Plantilla «" + pb.Name + "».", OrganizationID: pgUUIDOf(req.ClientID),
			Recurrence: rec, WarnDays: []int32{1, 0}, Steps: []string{}, CreatedBy: pgUUIDOf(u.id), IsKey: it.IsKey,
			PlaybookApplicationID: pgUUIDOf(appID)}
		if it.ActionKind != nil {
			p.ActionKind = optText(*it.ActionKind)
		}
		switch {
		case it.Assignee == "level" && it.AreaID != nil && activeArea[*it.AreaID]:
			p.AreaID, p.AssigneeKind, p.AssigneeLevelID = *it.AreaID, "level", optionalUUID(it.LevelID)
		case it.Assignee == "guard" && it.AreaID != nil && activeArea[*it.AreaID]:
			p.AreaID, p.AssigneeKind, p.AssigneeTeamID = *it.AreaID, "guard", optionalUUID(it.TeamID)
		default:
			p.AreaID, p.AssigneeKind, p.AssigneeUserID = csmArea, "person", pgUUIDOf(csm)
		}
		taskID, err := q.CreateAgendaTask(ctx, p)
		if err != nil {
			mgmtFail(w, r)
			return
		}
		created = append(created, taskID)
	}
	if err := tx.Commit(ctx); err != nil {
		mgmtFail(w, r)
		return
	}
	if h.Agenda != nil {
		_ = h.Agenda.generate(ctx, true)
		for _, t := range created {
			if row, ok, _ := h.Agenda.findTask(ctx, t); ok {
				h.Agenda.notifyAssigned(ctx, row, u.id)
			}
		}
	}
	h.AuditLog.Log(ctx, "playbook.applied", audit.LevelInfo, audit.Success(), map[string]any{"playbookId": id.String(), "clientId": req.ClientID.String(),
		"anchor": agenda.FormatDate(anchor), "tasks": len(created)})
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{})
	publishSync(ctx, h.Hub, "management.changed", map[string]string{"clientId": req.ClientID.String()})
	writeData(w, http.StatusCreated, map[string]any{"applicationId": appID, "tasks": len(created), "anchorDate": agenda.FormatDate(anchor)})
}
