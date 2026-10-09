package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Llamados dentro de la política (canvas "Equipos y llamados de
// escalamiento", aprobado 2026-10-07; migración 000030). Un paso avisa a un
// equipo real (guardia, contrata…) o a su propio grupo de personas del
// Directorio: ese grupo es un equipo kind 'step' que pertenece solo a ese
// paso, no aparece en Equipos y se borra con él (trigger de la 000030).

type stepMemberDTO struct {
	ID       uuid.UUID `json:"id"`
	Kind     string    `json:"kind"` // contact | user | pool
	RefID    uuid.UUID `json:"refId"`
	Name     string    `json:"name"`
	Channels []string  `json:"channels"`
}

type policyStepDTO struct {
	ID        uuid.UUID `json:"id"`
	StepOrder int32     `json:"stepOrder"`
	Title     string    `json:"title"`
	TeamID    uuid.UUID `json:"teamId"`
	TeamName  string    `json:"teamName"`
	// OwnPeople: el paso tiene su propio grupo (Members); si no, usa el equipo TeamID.
	OwnPeople                 bool            `json:"ownPeople"`
	Members                   []stepMemberDTO `json:"members"`
	Mode                      string          `json:"mode"`
	WaitBeforeEscalateMinutes int32           `json:"waitBeforeEscalateMinutes"`
}

func (h *EscalationHandler) policiesWithSteps(ctx context.Context, policies []db.EscalationPolicy) ([]policyDTO, error) {
	ids := make([]uuid.UUID, 0, len(policies))
	for _, p := range policies {
		ids = append(ids, p.ID)
	}
	steps := map[uuid.UUID][]policyStepDTO{}
	if len(ids) > 0 {
		rows, err := h.Queries.ListPolicySteps(ctx, ids)
		if err != nil {
			return nil, err
		}
		var own []uuid.UUID
		for _, s := range rows {
			if s.TeamKind == "step" {
				own = append(own, s.TeamID)
			}
		}
		members := map[uuid.UUID][]stepMemberDTO{}
		if len(own) > 0 {
			list, err := h.Queries.ListStepMembers(ctx, own)
			if err != nil {
				return nil, err
			}
			for _, m := range list {
				ref := m.PoolID
				switch m.MemberKind {
				case "user":
					ref = m.UserID
				case "contact":
					ref = m.ContactID
				}
				channels := []string{}
				if m.Channels != "" {
					channels = strings.Split(m.Channels, ",")
				}
				members[m.TeamID] = append(members[m.TeamID], stepMemberDTO{ID: m.ID, Kind: m.MemberKind, RefID: uuid.UUID(ref.Bytes), Name: m.DisplayName, Channels: channels})
			}
		}
		for _, s := range rows {
			d := policyStepDTO{ID: s.ID, StepOrder: s.StepOrder, Title: s.Title.String, TeamID: s.TeamID, TeamName: s.TeamName,
				OwnPeople: s.TeamKind == "step", Members: []stepMemberDTO{}, Mode: string(s.Mode), WaitBeforeEscalateMinutes: s.WaitBeforeEscalateMinutes}
			if d.OwnPeople {
				d.TeamName = ""
				if m := members[s.TeamID]; m != nil {
					d.Members = m
				}
			}
			if d.Title == "" {
				d.Title = fmt.Sprintf("Llamado %d", s.StepOrder)
				if !d.OwnPeople {
					d.Title = s.TeamName
				}
			}
			steps[s.PolicyID] = append(steps[s.PolicyID], d)
		}
	}
	dtos := make([]policyDTO, 0, len(policies))
	for _, p := range policies {
		d := policyDTO{ID: p.ID, ServiceID: uuidPtr(p.ServiceID), AssetID: uuidPtr(p.AssetID), TerritorialUnitID: uuidPtr(p.TerritorialUnitID), Active: p.Active, Steps: steps[p.ID], Reminder: textPtr(p.Reminder)}
		if d.Steps == nil {
			d.Steps = []policyStepDTO{}
		}
		dtos = append(dtos, d)
	}
	return dtos, nil
}

// stepRequest: el llamado avisa a un equipo real (teamId) o a sus propias
// personas (contactIds/userIds/poolIds, en ese orden de prioridad).
type stepRequest struct {
	Title                     string      `json:"title"`
	TeamID                    *uuid.UUID  `json:"teamId"`
	ContactIDs                []uuid.UUID `json:"contactIds"`
	UserIDs                   []uuid.UUID `json:"userIds"`
	PoolIDs                   []uuid.UUID `json:"poolIds"`
	Mode                      string      `json:"mode"`
	WaitBeforeEscalateMinutes int32       `json:"waitBeforeEscalateMinutes"`
}

func (req *stepRequest) validate() string {
	if req.Mode == "" {
		req.Mode = "unique"
	}
	if req.Mode != "unique" && req.Mode != "pool" && req.Mode != "sequential" {
		return "mode debe ser unique, pool o sequential"
	}
	if req.WaitBeforeEscalateMinutes < 0 {
		return "waitBeforeEscalateMinutes no puede ser negativo"
	}
	if len([]rune(strings.TrimSpace(req.Title))) > 120 {
		return "el título del llamado es demasiado largo"
	}
	if req.TeamID != nil && len(req.ContactIDs)+len(req.UserIDs)+len(req.PoolIDs) > 0 {
		return "indica un equipo o personas, no ambos"
	}
	return ""
}

func optionalTitle(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	return pgtype.Text{String: s, Valid: s != ""}
}

// stepTeam deja listo el equipo del paso: el real indicado, o el grupo propio
// (reutiliza `current` si ya era un grupo de paso) con exactamente esas personas.
func stepTeam(ctx context.Context, q *db.Queries, req stepRequest, current *db.GetPolicyStepRow) (uuid.UUID, string) {
	if req.TeamID != nil {
		t, err := q.GetTeam(ctx, *req.TeamID)
		if err != nil {
			return uuid.Nil, "el equipo no existe"
		}
		if t.Kind == "step" {
			return uuid.Nil, "ese grupo es de otro llamado: elige personas o un equipo"
		}
		return t.ID, ""
	}
	var team uuid.UUID
	if current != nil && current.TeamKind == "step" {
		team = current.TeamID
		if err := q.ClearTeamMembers(ctx, team); err != nil {
			return uuid.Nil, "no se pudo actualizar el llamado"
		}
	} else {
		id := uuid.New()
		created, err := q.CreateStepTeam(ctx, db.CreateStepTeamParams{Name: "Llamado", Slug: "llamado-" + id.String()})
		if err != nil {
			return uuid.Nil, "no se pudo crear el llamado"
		}
		team = created
	}
	priority := int32(0)
	add := func(user, contact, pool *uuid.UUID) string {
		_, err := q.AddTeamMember(ctx, db.AddTeamMemberParams{TeamID: team, UserID: optionalUUID(user), ContactID: optionalUUID(contact), PoolID: optionalUUID(pool),
			RecipientType: db.RecipientTypeTo, RoleInTeam: db.TeamRolePrimary, Priority: priority})
		priority++
		if isForeignKeyViolation(err) {
			return "alguna persona o pool no existe"
		}
		if err != nil {
			return "no se pudo guardar una persona del llamado"
		}
		return ""
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range req.ContactIDs {
		if !seen[id] {
			seen[id] = true
			if msg := add(nil, &id, nil); msg != "" {
				return uuid.Nil, msg
			}
		}
	}
	for _, id := range req.UserIDs {
		if !seen[id] {
			seen[id] = true
			if msg := add(&id, nil, nil); msg != "" {
				return uuid.Nil, msg
			}
		}
	}
	for _, id := range req.PoolIDs {
		if !seen[id] {
			seen[id] = true
			if msg := add(nil, nil, &id); msg != "" {
				return uuid.Nil, msg
			}
		}
	}
	return team, ""
}

func (h *EscalationHandler) policyFromPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return uuid.Nil, false
	}
	if _, err := h.Queries.GetPolicy(r.Context(), id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "política no encontrada")
		return uuid.Nil, false
	}
	return id, true
}

// writePolicy responde la política completa (con sus llamados ya renumerados).
func (h *EscalationHandler) writePolicy(w http.ResponseWriter, r *http.Request, status int, policyID uuid.UUID) {
	p, err := h.Queries.GetPolicy(r.Context(), policyID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la política")
		return
	}
	dtos, err := h.policiesWithSteps(r.Context(), []db.EscalationPolicy{p})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los llamados")
		return
	}
	writeData(w, status, dtos[0])
}

// inPolicyTx corre fn en una transacción; si devuelve un mensaje, responde 400.
func (h *EscalationHandler) inPolicyTx(w http.ResponseWriter, r *http.Request, fn func(q *db.Queries) string) bool {
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo iniciar la transacción")
		return false
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if msg := fn(h.Queries.WithTx(tx)); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return false
	}
	if err := tx.Commit(r.Context()); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return false
	}
	return true
}

// AddStep es POST /api/escalation/policies/{id}/steps: agrega un llamado al final.
func (h *EscalationHandler) AddStep(w http.ResponseWriter, r *http.Request) {
	policyID, ok := h.policyFromPath(w, r)
	if !ok {
		return
	}
	var req stepRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	var order int32
	ok = h.inPolicyTx(w, r, func(q *db.Queries) string {
		team, msg := stepTeam(r.Context(), q, req, nil)
		if msg != "" {
			return msg
		}
		next, err := q.NextPolicyStepOrder(r.Context(), policyID)
		if err != nil {
			return "no se pudo calcular el orden"
		}
		order = next
		if _, err := q.AddPolicyStep(r.Context(), db.AddPolicyStepParams{PolicyID: policyID, StepOrder: next, TeamID: team, Mode: db.EscalationMode(req.Mode),
			WaitBeforeEscalateMinutes: req.WaitBeforeEscalateMinutes, Title: optionalTitle(req.Title)}); err != nil {
			return "no se pudo agregar el llamado"
		}
		return ""
	})
	if !ok {
		return
	}
	h.AuditLog.Log(r.Context(), "escalation.step.create", audit.LevelInfo, audit.Success(), map[string]any{"policyId": policyID.String(), "stepOrder": order})
	h.writePolicy(w, r, http.StatusCreated, policyID)
}

// UpdateStep es PUT /api/escalation/policies/{id}/steps/{stepId}: título,
// personas o equipo, modo y espera de un llamado.
func (h *EscalationHandler) UpdateStep(w http.ResponseWriter, r *http.Request) {
	policyID, ok := h.policyFromPath(w, r)
	if !ok {
		return
	}
	stepID, err := uuid.Parse(r.PathValue("stepId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "llamado inválido")
		return
	}
	var req stepRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	current, err := h.Queries.GetPolicyStep(r.Context(), db.GetPolicyStepParams{ID: stepID, PolicyID: policyID})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "llamado no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el llamado")
		return
	}
	ok = h.inPolicyTx(w, r, func(q *db.Queries) string {
		team, msg := stepTeam(r.Context(), q, req, &current)
		if msg != "" {
			return msg
		}
		if _, err := q.UpdatePolicyStep(r.Context(), db.UpdatePolicyStepParams{ID: stepID, TeamID: team, Mode: db.EscalationMode(req.Mode),
			WaitBeforeEscalateMinutes: req.WaitBeforeEscalateMinutes, Title: optionalTitle(req.Title)}); err != nil {
			return "no se pudo guardar el llamado"
		}
		// Pasó de personas propias a un equipo real: su grupo ya no sirve.
		if current.TeamKind == "step" && team != current.TeamID {
			if err := q.DeleteStepTeam(r.Context(), current.TeamID); err != nil {
				return "no se pudo limpiar el grupo anterior"
			}
		}
		return ""
	})
	if !ok {
		return
	}
	h.AuditLog.Log(r.Context(), "escalation.step.update", audit.LevelInfo, audit.Success(), map[string]any{"policyId": policyID.String(), "stepId": stepID.String()})
	h.writePolicy(w, r, http.StatusOK, policyID)
}

// DeleteStep es DELETE /api/escalation/policies/{id}/steps/{stepOrder}: quita
// el llamado (su grupo propio cae con él) y deja los demás numerados 1..n.
func (h *EscalationHandler) DeleteStep(w http.ResponseWriter, r *http.Request) {
	policyID, ok := h.policyFromPath(w, r)
	if !ok {
		return
	}
	var order int32
	if _, err := fmt.Sscan(r.PathValue("stepOrder"), &order); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "paso inválido")
		return
	}
	found := true
	ok = h.inPolicyTx(w, r, func(q *db.Queries) string {
		n, err := q.DeletePolicyStep(r.Context(), db.DeletePolicyStepParams{PolicyID: policyID, StepOrder: order})
		if err != nil {
			return "no se pudo borrar el llamado"
		}
		if n == 0 {
			found = false
			return ""
		}
		return renumber(r.Context(), q, policyID, nil)
	})
	if !ok {
		return
	}
	if !found {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "paso no encontrado")
		return
	}
	h.AuditLog.Log(r.Context(), "escalation.step.delete", audit.LevelWarn, audit.Success(), map[string]any{"policyId": policyID.String(), "stepOrder": order})
	writeNoContent(w)
}

type reorderStepsRequest struct {
	StepIDs []uuid.UUID `json:"stepIds"`
}

// ReorderSteps es POST /api/escalation/policies/{id}/steps/reorder: el nuevo
// orden de todos los llamados.
func (h *EscalationHandler) ReorderSteps(w http.ResponseWriter, r *http.Request) {
	policyID, ok := h.policyFromPath(w, r)
	if !ok {
		return
	}
	var req reorderStepsRequest
	if err := decodeJSON(w, r, &req); err != nil || len(req.StepIDs) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "stepIds es obligatorio")
		return
	}
	if !h.inPolicyTx(w, r, func(q *db.Queries) string { return renumber(r.Context(), q, policyID, req.StepIDs) }) {
		return
	}
	h.AuditLog.Log(r.Context(), "escalation.step.reorder", audit.LevelInfo, audit.Success(), map[string]any{"policyId": policyID.String()})
	h.writePolicy(w, r, http.StatusOK, policyID)
}

func renumber(ctx context.Context, q *db.Queries, policyID uuid.UUID, order []uuid.UUID) string {
	if order == nil {
		order = []uuid.UUID{}
	}
	if err := q.ShiftPolicySteps(ctx, policyID); err != nil {
		return "no se pudo reordenar"
	}
	if err := q.RenumberPolicySteps(ctx, db.RenumberPolicyStepsParams{StepIds: order, PolicyID: policyID}); err != nil {
		return "no se pudo reordenar"
	}
	return ""
}
