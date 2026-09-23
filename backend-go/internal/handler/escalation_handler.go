package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/escalation"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// EscalationHandler es el motor de escalación unificado SOC/NOC de la Fase 7
// (spec/04-contratos-api.md "Escalación NOC/SOC", docs/adr/0004): resolver a
// quién avisar, registrar cada intento de contacto (inmutable) y despachar el
// aviso por correo. La app nunca llama por teléfono: el operador llama desde
// su teléfono y la app solo registra el resultado (ver memoria del proyecto:
// "no es una central telefónica").
type EscalationHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
	Modules  middleware.ModuleAccess
	Now      func() time.Time
}

func (h *EscalationHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// scope es exactamente uno de serviceId / assetId / territorialUnitId.
type scope struct {
	ServiceID         *uuid.UUID `json:"serviceId,omitempty"`
	AssetID           *uuid.UUID `json:"assetId,omitempty"`
	TerritorialUnitID *uuid.UUID `json:"territorialUnitId,omitempty"`
}

func (s scope) count() int {
	n := 0
	for _, p := range []*uuid.UUID{s.ServiceID, s.AssetID, s.TerritorialUnitID} {
		if p != nil {
			n++
		}
	}
	return n
}

func (s scope) module() modules.Module {
	if s.ServiceID != nil {
		return modules.SOC
	}
	return modules.NOC
}

func scopeFromQuery(r *http.Request) (scope, error) {
	var s scope
	for key, dst := range map[string]**uuid.UUID{"serviceId": &s.ServiceID, "assetId": &s.AssetID, "territorialUnitId": &s.TerritorialUnitID} {
		if raw := r.URL.Query().Get(key); raw != "" {
			id, err := uuid.Parse(raw)
			if err != nil {
				return s, fmt.Errorf("%s inválido", key)
			}
			*dst = &id
		}
	}
	return s, nil
}

// checkModule aplica el mismo gate que middleware.RequireModule, pero según
// el scope del request: serviceId es SOC, assetId/territorialUnitId es NOC
// (spec/01-arquitectura.md sección 5: "se gatean por el tipo de scope que
// reciben"). Devuelve false y ya escribió el 403 si no corresponde.
func (h *EscalationHandler) checkModule(w http.ResponseWriter, r *http.Request, s scope) bool {
	ctx := r.Context()
	flags, err := h.Modules.InstanceFlags(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de módulos")
		return false
	}
	m := s.module()
	if !flags.Enabled(m) {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "el módulo "+string(m)+" está desactivado en esta instalación")
		return false
	}
	user, _ := middleware.UserFromContext(ctx)
	if user.Role == "admin" {
		return true
	}
	scopes, err := h.Modules.UserGroupScopes(ctx, user.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el alcance del usuario")
		return false
	}
	if !modules.EffectiveScope(flags, scopes).Includes(m) {
		problemdetails.Write(w, r, http.StatusForbidden, "module-not-in-scope", "tu grupo de permisos no incluye el módulo "+string(m))
		return false
	}
	return true
}

// ===== DTOs de resolución (forma de spec/04: la misma para SOC y NOC, HU-2) =====

type resolvedChannelDTO struct {
	ChannelType string  `json:"channelType"`
	Value       string  `json:"value"`
	Label       *string `json:"label,omitempty"`
	Preferred   bool    `json:"preferred"`
	// Href es la acción directa lista para el botón (HU-1z): tel:, https://wa.me/, sms:, mailto:.
	Href string `json:"href,omitempty"`
}

type resolvedMemberDTO struct {
	ID            uuid.UUID            `json:"id"` // team_member id
	ContactID     *uuid.UUID           `json:"contactId,omitempty"`
	UserID        *uuid.UUID           `json:"userId,omitempty"`
	Name          string               `json:"name"`
	Position      *string              `json:"position,omitempty"`
	Specialty     *string              `json:"specialty,omitempty"`
	Organization  *string              `json:"organization,omitempty"`
	RoleInTeam    string               `json:"roleInTeam"`
	RecipientType string               `json:"recipientType"`
	Priority      int32                `json:"priority"`
	OnCallNow     bool                 `json:"onCallNow"` // turnos/guardias llegan en la Fase 8: hoy siempre false
	Channels      []resolvedChannelDTO `json:"channels"`
}

type resolvedTeamDTO struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Kind         string    `json:"kind"`
	Audience     string    `json:"audience"`
	Organization *struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"organization,omitempty"`
	Members []resolvedMemberDTO `json:"members"`
}

type resolvedStepDTO struct {
	Order                     int32           `json:"order"`
	Mode                      string          `json:"mode"`
	WaitBeforeEscalateMinutes int32           `json:"waitBeforeEscalateMinutes"`
	Team                      resolvedTeamDTO `json:"team"`
}

type resolvedUnitDTO struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Code string    `json:"code"`
	Kind string    `json:"kind"`
}

type resolutionDTO struct {
	ResolvedVia  string            `json:"resolvedVia"`
	PolicyID     *uuid.UUID        `json:"policyId,omitempty"`
	ResolvedUnit *resolvedUnitDTO  `json:"resolvedUnit,omitempty"`
	Scope        scope             `json:"scope"`
	Steps        []resolvedStepDTO `json:"steps"`

	unitPath []uuid.UUID       // camino territorial (para ventanas de mantenimiento)
	steps    []escalation.Step // lo mismo en el modelo puro (para Next/Recipients)
	members  map[uuid.UUID]memberInfo
}

type memberInfo struct {
	dto    resolvedMemberDTO
	stepOr int32
}

// channelHref arma la acción directa de un canal (HU-1z).
func channelHref(channelType, value string) string {
	digits := strings.TrimPrefix(normalizeDigits(value), "+")
	switch channelType {
	case "call":
		return "tel:" + normalizeDigits(value)
	case "sms":
		return "sms:" + normalizeDigits(value)
	case "whatsapp":
		if digits == "" {
			return ""
		}
		return "https://wa.me/" + digits
	case "email":
		return "mailto:" + value
	}
	return ""
}

func normalizeDigits(v string) string {
	var b strings.Builder
	for i, r := range strings.TrimSpace(v) {
		if (r >= '0' && r <= '9') || (r == '+' && i == 0) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var errNoPolicy = errors.New("no hay política de escalación ni cobertura aplicable")

// resolve implementa GET /api/escalation/resolve y es la base de notify y
// actions: misma resolución en los tres (un solo motor, docs/adr/0004).
func (h *EscalationHandler) resolve(ctx context.Context, s scope) (*resolutionDTO, error) {
	res := &resolutionDTO{Scope: s, members: map[uuid.UUID]memberInfo{}}
	var choice escalation.Choice

	switch {
	case s.ServiceID != nil:
		pid, err := h.Queries.FindPolicyByService(ctx, pgtype.UUID{Bytes: *s.ServiceID, Valid: true})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNoPolicy
		}
		if err != nil {
			return nil, err
		}
		choice = escalation.Choice{Via: escalation.ViaService, PolicyID: &pid}
	default:
		unitID := uuid.Nil
		var assetPolicy *uuid.UUID
		if s.AssetID != nil {
			asset, err := h.Queries.GetAssetForResolve(ctx, *s.AssetID)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, errNotFoundScope
			}
			if err != nil {
				return nil, err
			}
			unitID = asset.TerritorialUnitID
			if pid, err := h.Queries.FindPolicyByAsset(ctx, pgtype.UUID{Bytes: asset.ID, Valid: true}); err == nil {
				assetPolicy = &pid
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return nil, err
			}
		} else {
			unitID = *s.TerritorialUnitID
		}
		ancestors, err := h.Queries.ListUnitAncestors(ctx, unitID)
		if err != nil {
			return nil, err
		}
		if len(ancestors) == 0 && assetPolicy == nil {
			return nil, errNotFoundScope
		}
		unitIDs := make([]uuid.UUID, 0, len(ancestors))
		for _, a := range ancestors {
			unitIDs = append(unitIDs, a.ID)
		}
		res.unitPath = unitIDs
		policies, err := h.Queries.ListPoliciesForUnits(ctx, unitIDs)
		if err != nil {
			return nil, err
		}
		coverage, err := h.Queries.ListCoverageForUnits(ctx, unitIDs)
		if err != nil {
			return nil, err
		}
		policyByUnit := map[uuid.UUID]uuid.UUID{}
		for _, p := range policies {
			policyByUnit[uuid.UUID(p.TerritorialUnitID.Bytes)] = p.ID
		}
		coverageByUnit := map[uuid.UUID][]escalation.CoverageTeam{}
		for _, c := range coverage {
			coverageByUnit[c.TerritorialUnitID] = append(coverageByUnit[c.TerritorialUnitID], escalation.CoverageTeam{TeamID: c.TeamID, Priority: c.Priority})
		}
		levels := make([]escalation.Level, 0, len(ancestors))
		for _, a := range ancestors {
			l := escalation.Level{UnitID: a.ID, Coverage: coverageByUnit[a.ID]}
			if pid, ok := policyByUnit[a.ID]; ok {
				pid := pid
				l.PolicyID = &pid
			}
			levels = append(levels, l)
		}
		var ok bool
		choice, ok = escalation.Choose(assetPolicy, levels)
		if !ok {
			return nil, errNoPolicy
		}
		if choice.UnitID != nil {
			for _, a := range ancestors {
				if a.ID == *choice.UnitID {
					res.ResolvedUnit = &resolvedUnitDTO{ID: a.ID, Name: a.Name, Code: a.Code, Kind: string(a.Kind)}
				}
			}
		}
	}

	res.ResolvedVia = string(choice.Via)
	res.PolicyID = choice.PolicyID
	var steps []escalation.Step
	if choice.PolicyID != nil {
		rows, err := h.Queries.ListPolicySteps(ctx, []uuid.UUID{*choice.PolicyID})
		if err != nil {
			return nil, err
		}
		for _, st := range rows {
			steps = append(steps, escalation.Step{Order: st.StepOrder, TeamID: st.TeamID, Mode: escalation.Mode(st.Mode), WaitMinutes: st.WaitBeforeEscalateMinutes})
		}
	} else {
		steps = escalation.CoverageSteps(choice.Coverage)
	}
	if err := h.fillSteps(ctx, res, steps); err != nil {
		return nil, err
	}
	return res, nil
}

var errNotFoundScope = errors.New("el servicio, activo o unidad territorial no existe")

// fillSteps carga equipos, miembros y canales (con el valor descifrado y el
// preferido primero) de todos los pasos en pocas queries.
func (h *EscalationHandler) fillSteps(ctx context.Context, res *resolutionDTO, steps []escalation.Step) error {
	teamIDs := make([]uuid.UUID, 0, len(steps))
	for _, st := range steps {
		teamIDs = append(teamIDs, st.TeamID)
	}
	teams, err := h.Queries.ListTeamsForResolve(ctx, teamIDs)
	if err != nil {
		return err
	}
	teamByID := map[uuid.UUID]db.ListTeamsForResolveRow{}
	for _, t := range teams {
		teamByID[t.ID] = t
	}
	members, err := h.Queries.ListMembersForTeams(ctx, teamIDs)
	if err != nil {
		return err
	}
	var contactIDs, userIDs []uuid.UUID
	for _, m := range members {
		if m.ContactID.Valid {
			contactIDs = append(contactIDs, uuid.UUID(m.ContactID.Bytes))
		}
		if m.UserID.Valid {
			userIDs = append(userIDs, uuid.UUID(m.UserID.Bytes))
		}
	}
	channelsByOwner := map[uuid.UUID][]resolvedChannelDTO{}
	addChannels := func(chans []db.ContactChannel) {
		for _, c := range chans {
			owner := c.ContactID
			if !owner.Valid {
				owner = c.UserID
			}
			value, err := h.Crypto.Decrypt(c.ValueEncrypted)
			if err != nil {
				continue
			}
			channelsByOwner[uuid.UUID(owner.Bytes)] = append(channelsByOwner[uuid.UUID(owner.Bytes)], resolvedChannelDTO{
				ChannelType: string(c.ChannelType), Value: value, Label: textPtr(c.Label), Preferred: c.Preferred,
				Href: channelHref(string(c.ChannelType), value),
			})
		}
	}
	if len(contactIDs) > 0 {
		chans, err := h.Queries.ListChannelsForContacts(ctx, contactIDs)
		if err != nil {
			return err
		}
		addChannels(chans)
	}
	if len(userIDs) > 0 {
		chans, err := h.Queries.ListChannelsForUsers(ctx, userIDs)
		if err != nil {
			return err
		}
		addChannels(chans)
	}

	membersByTeam := map[uuid.UUID][]db.ListMembersForTeamsRow{}
	for _, m := range members {
		membersByTeam[m.TeamID] = append(membersByTeam[m.TeamID], m)
	}
	for _, st := range steps {
		t := teamByID[st.TeamID]
		teamDTO := resolvedTeamDTO{ID: t.ID, Name: t.Name, Kind: t.Kind, Audience: string(t.Audience), Members: []resolvedMemberDTO{}}
		if t.OrganizationName.Valid {
			teamDTO.Organization = &struct {
				Name string `json:"name"`
				Type string `json:"type"`
			}{Name: t.OrganizationName.String, Type: string(t.OrganizationType.OrganizationType)}
		}
		pureMembers := []escalation.Member{}
		byID := map[uuid.UUID]resolvedMemberDTO{}
		for _, m := range membersByTeam[st.TeamID] {
			owner := m.ContactID
			if !owner.Valid {
				owner = m.UserID
			}
			dto := resolvedMemberDTO{
				ID: m.ID, ContactID: uuidPtr(m.ContactID), UserID: uuidPtr(m.UserID), Name: m.Name,
				Position: textPtr(m.Position), Specialty: textPtr(m.Specialty), Organization: textPtr(m.ContactOrganizationName),
				RoleInTeam: string(m.RoleInTeam), RecipientType: string(m.RecipientType), Priority: m.Priority,
				Channels: channelsByOwner[uuid.UUID(owner.Bytes)],
			}
			if dto.Channels == nil {
				dto.Channels = []resolvedChannelDTO{} // el frontend muestra "sin canal de contacto configurado"
			}
			byID[m.ID] = dto
			res.members[m.ID] = memberInfo{dto: dto, stepOr: st.Order}
			pureMembers = append(pureMembers, escalation.Member{ID: m.ID, Name: m.Name, Role: escalation.Role(m.RoleInTeam), Priority: m.Priority})
		}
		// Los miembros salen en el orden de llamada (principales primero).
		for _, pm := range escalation.OrderMembers(pureMembers) {
			teamDTO.Members = append(teamDTO.Members, byID[pm.ID])
		}
		st.Members = pureMembers
		res.steps = append(res.steps, st)
		res.Steps = append(res.Steps, resolvedStepDTO{Order: st.Order, Mode: string(st.Mode), WaitBeforeEscalateMinutes: st.WaitMinutes, Team: teamDTO})
	}
	if res.Steps == nil {
		res.Steps = []resolvedStepDTO{}
	}
	return nil
}

func (h *EscalationHandler) writeResolveError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errNoPolicy):
		problemdetails.Write(w, r, http.StatusNotFound, "no-escalation-policy",
			"no hay política de escalación ni equipo con cobertura para este caso — configúrala en Administración → Escalamiento")
	case errors.Is(err, errNotFoundScope):
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", err.Error())
	default:
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo resolver la escalación")
	}
}

// Resolve es GET /api/escalation/resolve?serviceId=|assetId=|territorialUnitId=.
func (h *EscalationHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	s, err := scopeFromQuery(r)
	if err != nil || s.count() != 1 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-scope", "indica exactamente uno: serviceId, assetId o territorialUnitId")
		return
	}
	if !h.checkModule(w, r, s) {
		return
	}
	res, err := h.resolve(r.Context(), s)
	if err != nil {
		h.writeResolveError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, res)
}

// ===== Intentos de contacto (HU-1t) =====

type actionRequest struct {
	scope
	PolicyID    *uuid.UUID `json:"policyId"`
	StepOrder   int32      `json:"stepOrder"`
	MemberID    *uuid.UUID `json:"memberId"`
	ContactID   *uuid.UUID `json:"contactId"`
	ChannelType string     `json:"channelType"`
	Result      string     `json:"result"`
	Notes       *string    `json:"notes"`
	EntryID     *uuid.UUID `json:"entryId"`
	// Since es cuándo empezó el incidente en curso: los intentos anteriores a
	// esa hora no cuentan como "ya intentados" para el modo sequential.
	Since *time.Time `json:"since"`
}

type actionLogDTO struct {
	ID               uuid.UUID  `json:"id"`
	PolicyID         *uuid.UUID `json:"policyId,omitempty"`
	StepOrder        int32      `json:"stepOrder"`
	ContactID        *uuid.UUID `json:"contactId,omitempty"`
	ContactName      *string    `json:"contactName,omitempty"`
	ChannelType      string     `json:"channelType"`
	Result           string     `json:"result"`
	Notes            *string    `json:"notes,omitempty"`
	EntryID          *uuid.UUID `json:"entryId,omitempty"`
	OperatorID       uuid.UUID  `json:"operatorId"`
	OperatorUsername string     `json:"operatorUsername,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
}

// RecordAction es POST /api/escalation/actions: registra el intento (fila
// inmutable, trigger de la migración 000004) y dice a quién llamar después.
// Se identifica la resolución por el mismo scope de /resolve (sirve también
// para las resoluciones por cobertura, que no tienen policyId).
func (h *EscalationHandler) RecordAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req actionRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.scope.count() != 1 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-scope", "indica exactamente uno: serviceId, assetId o territorialUnitId (el mismo de /resolve)")
		return
	}
	if !escalation.ValidResult(req.Result) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "result debe ser answered, no_answer, busy, unreachable o escalated_next_tier")
		return
	}
	if !channelTypes[req.ChannelType] {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "channelType debe ser call, whatsapp, sms, email u other")
		return
	}
	if !h.checkModule(w, r, req.scope) {
		return
	}
	res, err := h.resolve(ctx, req.scope)
	if err != nil {
		h.writeResolveError(w, r, err)
		return
	}
	if req.PolicyID != nil && (res.PolicyID == nil || *res.PolicyID != *req.PolicyID) {
		problemdetails.Write(w, r, http.StatusConflict, "stale-resolution", "la política de escalación cambió desde que resolviste; vuelve a resolver")
		return
	}
	var step *escalation.Step
	for i := range res.steps {
		if res.steps[i].Order == req.StepOrder {
			step = &res.steps[i]
		}
	}
	if step == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-step", "ese paso no existe en la escalación resuelta")
		return
	}

	// A quién se intentó: por memberId (lo que manda la UI) o por contactId (contrato original).
	var member *memberInfo
	for id, m := range res.members {
		if m.stepOr != req.StepOrder {
			continue
		}
		if (req.MemberID != nil && id == *req.MemberID) || (req.ContactID != nil && m.dto.ContactID != nil && *m.dto.ContactID == *req.ContactID) {
			mm := m
			member = &mm
		}
	}
	if member == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-member", "esa persona no es miembro del paso indicado")
		return
	}

	operator, _ := middleware.UserFromContext(ctx)
	notes := strings.TrimSpace(deref(req.Notes))
	if member.dto.UserID != nil {
		// escalation_action_logs.contact_id solo referencia contacts: si el
		// miembro es un usuario interno, se deja constancia en las notas.
		notes = strings.TrimSpace("[usuario interno: " + member.dto.Name + "] " + notes)
	}
	var policy pgtype.UUID
	if res.PolicyID != nil {
		policy = pgtype.UUID{Bytes: *res.PolicyID, Valid: true}
	}
	log, err := h.Queries.InsertActionLog(ctx, db.InsertActionLogParams{
		EntryID: optionalUUID(req.EntryID), PolicyID: policy, StepOrder: req.StepOrder,
		ContactID: optionalUUID(member.dto.ContactID), ChannelType: db.ContactChannelType(req.ChannelType),
		Result: db.ContactAttemptResult(req.Result), Notes: nonEmptyText(&notes), OperatorID: operator.ID,
	})
	if isForeignKeyViolation(err) {
		// Lo único que puede faltar a esta altura es la entrada de bitácora
		// (política, contacto y operador ya se validaron arriba).
		problemdetails.Write(w, r, http.StatusNotFound, "entry-not-found", "la entrada de bitácora indicada en entryId no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo registrar el intento")
		return
	}

	// Quiénes ya se intentaron en este paso durante el incidente en curso.
	since := h.now().Add(-12 * time.Hour)
	if req.Since != nil {
		since = *req.Since
	}
	tried := []uuid.UUID{member.dto.ID}
	if res.PolicyID != nil {
		contacts, err := h.Queries.ListTriedContactsForStep(ctx, db.ListTriedContactsForStepParams{
			PolicyID: policy, StepOrder: req.StepOrder, Since: pgtype.Timestamptz{Time: since, Valid: true},
		})
		if err == nil {
			for _, c := range contacts {
				for id, m := range res.members {
					if m.dto.ContactID != nil && c.Valid && *m.dto.ContactID == uuid.UUID(c.Bytes) {
						tried = append(tried, id)
					}
				}
			}
		}
	}
	next := escalation.Next(res.steps, req.StepOrder, tried, escalation.Result(req.Result))

	resp := map[string]any{
		"actionLog":           toActionLogDTO(log, member.dto.Name, operator.Username),
		"escalatedToNextStep": next.EscalatedToNextStep,
		"exhausted":           next.Exhausted,
	}
	if next.NextMember != nil {
		resp["nextMember"] = res.members[next.NextMember.ID].dto
	}
	if next.EscalatedToNextStep {
		resp["nextStepOrder"] = next.NextStepOrder
		for _, st := range res.Steps {
			if st.Order == next.NextStepOrder {
				resp["nextStepTeam"] = st.Team
				resp["waitBeforeEscalateMinutes"] = st.WaitBeforeEscalateMinutes
			}
		}
	}
	if req.EntryID != nil {
		// HU-1t punto 2: el auto-comentario en la bitácora llega con la Fase 9
		// (entries/entry_comments todavía no tienen API). El intento ya quedó
		// vinculado por entry_id y se puede reconstruir después.
		resp["entryCommentPending"] = true
	}
	h.AuditLog.Log(ctx, "escalation.action", audit.LevelInfo, audit.Success(), map[string]any{
		"actionLogId": log.ID.String(), "stepOrder": req.StepOrder, "result": req.Result, "channelType": req.ChannelType,
		"escalatedToNextStep": next.EscalatedToNextStep,
	})
	writeData(w, http.StatusCreated, resp)
}

func toActionLogDTO(l db.EscalationActionLog, contactName, operator string) actionLogDTO {
	dto := actionLogDTO{ID: l.ID, PolicyID: uuidPtr(l.PolicyID), StepOrder: l.StepOrder, ContactID: uuidPtr(l.ContactID),
		ChannelType: string(l.ChannelType), Result: string(l.Result), Notes: textPtr(l.Notes), EntryID: uuidPtr(l.EntryID),
		OperatorID: l.OperatorID, OperatorUsername: operator, CreatedAt: l.CreatedAt.Time}
	if contactName != "" {
		dto.ContactName = &contactName
	}
	return dto
}

// ListActions es GET /api/escalation/actions?policyId=&entryId=&since= —
// la línea de tiempo de intentos que muestra la pantalla de escalamiento.
func (h *EscalationHandler) ListActions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	policy, e1 := queryUUID(q.Get("policyId"))
	entry, e2 := queryUUID(q.Get("entryId"))
	if e1 != nil || e2 != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "policyId/entryId inválido")
		return
	}
	var since pgtype.Timestamptz
	if raw := q.Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "since debe ser RFC3339")
			return
		}
		since = pgtype.Timestamptz{Time: t, Valid: true}
	}
	rows, err := h.Queries.ListActionLogs(r.Context(), db.ListActionLogsParams{PolicyID: policy, EntryID: entry, Since: since, MaxRows: 200})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los intentos")
		return
	}
	dtos := make([]actionLogDTO, 0, len(rows))
	for _, l := range rows {
		dto := toActionLogDTO(db.EscalationActionLog{ID: l.ID, EntryID: l.EntryID, PolicyID: l.PolicyID, StepOrder: l.StepOrder,
			ContactID: l.ContactID, ChannelType: l.ChannelType, Result: l.Result, Notes: l.Notes, OperatorID: l.OperatorID,
			CreatedAt: l.CreatedAt}, l.ContactName.String, l.OperatorUsername)
		dtos = append(dtos, dto)
	}
	writeData(w, http.StatusOK, dtos)
}

// ===== Notificación por correo (HU-3b) =====

type notifyRequest struct {
	scope
	Message  string `json:"message"`
	Severity string `json:"severity"`
}

// Notify es POST /api/escalation/notify: resuelve igual que /resolve, revisa
// ventanas de mantenimiento y despacha el correo real a los destinatarios
// del primer paso (todo el equipo si el paso es pool). Cada llamada —enviada,
// suprimida o fallida— queda en audit_log y se devuelve su id.
func (h *EscalationHandler) Notify(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req notifyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.scope.count() != 1 || req.Message == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica exactamente un scope (serviceId, assetId o territorialUnitId) y el mensaje")
		return
	}
	if !h.checkModule(w, r, req.scope) {
		return
	}
	res, err := h.resolve(ctx, req.scope)
	if err != nil {
		h.writeResolveError(w, r, err)
		return
	}
	if len(res.Steps) == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "no-escalation-policy", "la política de escalación no tiene pasos configurados")
		return
	}

	window, err := h.activeWindow(ctx, req.scope, res.unitPath)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron revisar las ventanas de mantenimiento")
		return
	}
	scopeMeta := map[string]any{"resolvedVia": res.ResolvedVia, "message": req.Message, "severity": req.Severity}
	if window != nil && window.Suppress {
		scopeMeta["maintenanceWindowId"] = window.ID.String()
		auditID := h.AuditLog.Log(ctx, "escalation.notify.suppressed", audit.LevelWarn, audit.Success(), scopeMeta)
		writeData(w, http.StatusOK, map[string]any{"sent": false, "reason": "maintenance_window", "maintenanceWindowId": window.ID, "maintenanceWindowTitle": window.Title, "auditLogId": auditID})
		return
	}

	first := res.steps[0]
	firstDTO := res.Steps[0]
	var to, cc []string
	var recipients []map[string]any
	for _, m := range escalation.Recipients(first.Mode, first.Members) {
		info := res.members[m.ID].dto
		email := ""
		for _, c := range info.Channels {
			if c.ChannelType == "email" {
				email = c.Value
				break
			}
		}
		if email == "" {
			recipients = append(recipients, map[string]any{"name": info.Name, "skipped": "sin correo configurado"})
			continue
		}
		if info.RecipientType == "cc" {
			cc = append(cc, email)
		} else {
			to = append(to, email)
		}
		recipients = append(recipients, map[string]any{"name": info.Name, "email": email, "recipientType": info.RecipientType})
	}
	if len(to) == 0 && len(cc) > 0 {
		to, cc = cc, nil // un correo necesita al menos un To
	}
	if len(to) == 0 {
		auditID := h.AuditLog.Log(ctx, "escalation.notify.failed", audit.LevelWarn, audit.Failure("sin destinatarios con correo"), scopeMeta)
		writeData(w, http.StatusOK, map[string]any{"sent": false, "reason": "no_email_recipients", "team": firstDTO.Team, "recipients": recipients, "auditLogId": auditID})
		return
	}

	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err != nil {
		auditID := h.AuditLog.Log(ctx, "escalation.notify.failed", audit.LevelError, audit.Failure("SMTP no configurado"), scopeMeta)
		writeData(w, http.StatusBadGateway, map[string]any{"sent": false, "reason": "smtp_not_configured", "auditLogId": auditID})
		return
	}
	subject, body := h.buildNotifyMail(res, firstDTO, req, window)
	if err := sender.SendMany(to, cc, subject, body); err != nil {
		auditID := h.AuditLog.Log(ctx, "escalation.notify.failed", audit.LevelError, audit.Failure(err.Error()), scopeMeta)
		writeData(w, http.StatusBadGateway, map[string]any{"sent": false, "reason": "smtp_error", "error": err.Error(), "auditLogId": auditID})
		return
	}
	scopeMeta["recipientsCount"] = len(to) + len(cc)
	scopeMeta["teamId"] = firstDTO.Team.ID.String()
	auditID := h.AuditLog.Log(ctx, "escalation.notify.sent", audit.LevelInfo, audit.Success(), scopeMeta)
	resp := map[string]any{"sent": true, "team": firstDTO.Team, "recipients": recipients, "auditLogId": auditID}
	if window != nil {
		resp["maintenanceWindowId"] = window.ID // informativa: se envió igual, con la nota en el cuerpo
	}
	writeData(w, http.StatusOK, resp)
}

func (h *EscalationHandler) activeWindow(ctx context.Context, s scope, unitPath []uuid.UUID) (*escalation.Window, error) {
	rows, err := h.Queries.ListWindowsForScope(ctx, db.ListWindowsForScopeParams{
		ServiceID: optionalUUID(s.ServiceID), AssetID: optionalUUID(s.AssetID), UnitIds: append([]uuid.UUID{}, unitPath...),
	})
	if err != nil {
		return nil, err
	}
	windows := make([]escalation.Window, 0, len(rows))
	for _, w := range rows {
		windows = append(windows, escalation.Window{ID: w.ID, Title: w.Title, StartsAt: w.StartsAt.Time, EndsAt: w.EndsAt.Time, Suppress: w.SuppressNotifications, Priority: w.Priority})
	}
	return escalation.ActiveWindow(windows, h.now()), nil
}

func (h *EscalationHandler) buildNotifyMail(res *resolutionDTO, step resolvedStepDTO, req notifyRequest, window *escalation.Window) (string, string) {
	severity := strings.ToUpper(strings.TrimSpace(req.Severity))
	subject := "Aviso de incidente - Bitácora Ops"
	if severity != "" {
		subject = "[" + severity + "] " + subject
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Equipo: %s\r\n", step.Team.Name)
	if step.Team.Organization != nil {
		fmt.Fprintf(&b, "Empresa: %s\r\n", step.Team.Organization.Name)
	}
	if res.ResolvedUnit != nil {
		fmt.Fprintf(&b, "Zona: %s (%s)\r\n", res.ResolvedUnit.Name, res.ResolvedUnit.Code)
	}
	if severity != "" {
		fmt.Fprintf(&b, "Severidad: %s\r\n", severity)
	}
	fmt.Fprintf(&b, "Fecha: %s\r\n\r\n%s\r\n", h.now().Format("02-01-2006 15:04 MST"), req.Message)
	if window != nil {
		fmt.Fprintf(&b, "\r\nNota: hay una ventana de mantenimiento activa (%s) para este caso.\r\n", window.Title)
	}
	b.WriteString("\r\n--\r\nEnviado por Bitácora Ops.\r\n")
	return subject, b.String()
}

// ===== Servicios (módulo SOC) =====

type serviceDTO struct {
	ID               uuid.UUID `json:"id"`
	OrganizationID   uuid.UUID `json:"organizationId"`
	OrganizationName string    `json:"organizationName,omitempty"`
	Name             string    `json:"name"`
	Code             string    `json:"code"`
	Active           bool      `json:"active"`
}

func (h *EscalationHandler) ListServices(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	org, err := queryUUID(q.Get("organizationId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
		return
	}
	rows, err := h.Queries.ListServices(r.Context(), db.ListServicesParams{OrganizationID: org, Active: queryBool(q.Get("active"))})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los servicios")
		return
	}
	dtos := make([]serviceDTO, 0, len(rows))
	for _, s := range rows {
		dtos = append(dtos, serviceDTO{ID: s.ID, OrganizationID: s.OrganizationID, OrganizationName: s.OrganizationName, Name: s.Name, Code: s.Code, Active: s.Active})
	}
	writeData(w, http.StatusOK, dtos)
}

type createServiceRequest struct {
	OrganizationID uuid.UUID `json:"organizationId"`
	Name           string    `json:"name"`
	Code           string    `json:"code"`
}

func (h *EscalationHandler) CreateService(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createServiceRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Code) == "" || req.OrganizationID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "organizationId, name y code son obligatorios")
		return
	}
	s, err := h.Queries.CreateService(ctx, db.CreateServiceParams{OrganizationID: req.OrganizationID, Name: strings.TrimSpace(req.Name), Code: strings.TrimSpace(req.Code)})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "organizationId inexistente")
		return
	}
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe un servicio con ese código o nombre en esa organización")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el servicio")
		return
	}
	h.AuditLog.Log(ctx, "service.create", audit.LevelInfo, audit.Success(), map[string]any{"serviceId": s.ID.String(), "code": s.Code})
	writeData(w, http.StatusCreated, serviceDTO{ID: s.ID, OrganizationID: s.OrganizationID, Name: s.Name, Code: s.Code, Active: s.Active})
}

// ===== Políticas y pasos =====

type policyStepDTO struct {
	StepOrder                 int32     `json:"stepOrder"`
	TeamID                    uuid.UUID `json:"teamId"`
	TeamName                  string    `json:"teamName"`
	Mode                      string    `json:"mode"`
	WaitBeforeEscalateMinutes int32     `json:"waitBeforeEscalateMinutes"`
}

type policyDTO struct {
	ID                uuid.UUID       `json:"id"`
	ServiceID         *uuid.UUID      `json:"serviceId,omitempty"`
	AssetID           *uuid.UUID      `json:"assetId,omitempty"`
	TerritorialUnitID *uuid.UUID      `json:"territorialUnitId,omitempty"`
	Active            bool            `json:"active"`
	Steps             []policyStepDTO `json:"steps"`
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
		for _, s := range rows {
			steps[s.PolicyID] = append(steps[s.PolicyID], policyStepDTO{StepOrder: s.StepOrder, TeamID: s.TeamID, TeamName: s.TeamName, Mode: string(s.Mode), WaitBeforeEscalateMinutes: s.WaitBeforeEscalateMinutes})
		}
	}
	dtos := make([]policyDTO, 0, len(policies))
	for _, p := range policies {
		d := policyDTO{ID: p.ID, ServiceID: uuidPtr(p.ServiceID), AssetID: uuidPtr(p.AssetID), TerritorialUnitID: uuidPtr(p.TerritorialUnitID), Active: p.Active, Steps: steps[p.ID]}
		if d.Steps == nil {
			d.Steps = []policyStepDTO{}
		}
		dtos = append(dtos, d)
	}
	return dtos, nil
}

func (h *EscalationHandler) ListPolicies(w http.ResponseWriter, r *http.Request) {
	s, err := scopeFromQuery(r)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", err.Error())
		return
	}
	rows, err := h.Queries.ListPolicies(r.Context(), db.ListPoliciesParams{ServiceID: optionalUUID(s.ServiceID), AssetID: optionalUUID(s.AssetID), TerritorialUnitID: optionalUUID(s.TerritorialUnitID)})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar las políticas")
		return
	}
	dtos, err := h.policiesWithSteps(r.Context(), rows)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los pasos")
		return
	}
	writeData(w, http.StatusOK, dtos)
}

func (h *EscalationHandler) CreatePolicy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req scope
	if err := decodeJSON(w, r, &req); err != nil || req.count() != 1 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-scope", "indica exactamente uno: serviceId, assetId o territorialUnitId")
		return
	}
	if !h.checkModule(w, r, req) {
		return
	}
	p, err := h.Queries.CreatePolicy(ctx, db.CreatePolicyParams{ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID), TerritorialUnitID: optionalUUID(req.TerritorialUnitID)})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "policy-exists", "ya existe una política para ese servicio/activo/unidad")
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el servicio, activo o unidad indicado no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la política")
		return
	}
	h.AuditLog.Log(ctx, "escalation.policy.create", audit.LevelInfo, audit.Success(), map[string]any{"policyId": p.ID.String()})
	dtos, _ := h.policiesWithSteps(ctx, []db.EscalationPolicy{p})
	writeData(w, http.StatusCreated, dtos[0])
}

func (h *EscalationHandler) DeletePolicy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	n, err := h.Queries.DeletePolicy(r.Context(), id)
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "policy-in-use", "la política tiene intentos registrados; desactívala en vez de borrarla")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar la política")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "política no encontrada")
		return
	}
	h.AuditLog.Log(r.Context(), "escalation.policy.delete", audit.LevelWarn, audit.Success(), map[string]any{"policyId": id.String()})
	writeNoContent(w)
}

type addStepRequest struct {
	StepOrder                 int32     `json:"stepOrder"`
	TeamID                    uuid.UUID `json:"teamId"`
	Mode                      string    `json:"mode"`
	WaitBeforeEscalateMinutes int32     `json:"waitBeforeEscalateMinutes"`
}

func (h *EscalationHandler) AddStep(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	policyID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req addStepRequest
	if err := decodeJSON(w, r, &req); err != nil || req.StepOrder < 1 || req.TeamID == uuid.Nil || req.WaitBeforeEscalateMinutes < 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "stepOrder (>= 1), teamId y waitBeforeEscalateMinutes (>= 0) son obligatorios")
		return
	}
	if req.Mode == "" {
		req.Mode = "unique"
	}
	if req.Mode != "unique" && req.Mode != "pool" && req.Mode != "sequential" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "mode debe ser unique, pool o sequential")
		return
	}
	st, err := h.Queries.AddPolicyStep(ctx, db.AddPolicyStepParams{PolicyID: policyID, StepOrder: req.StepOrder, TeamID: req.TeamID, Mode: db.EscalationMode(req.Mode), WaitBeforeEscalateMinutes: req.WaitBeforeEscalateMinutes})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-step", "ya existe un paso con ese orden en la política")
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la política o el equipo no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar el paso")
		return
	}
	h.AuditLog.Log(ctx, "escalation.step.create", audit.LevelInfo, audit.Success(), map[string]any{"policyId": policyID.String(), "stepOrder": st.StepOrder})
	writeData(w, http.StatusCreated, map[string]any{"stepOrder": st.StepOrder, "teamId": st.TeamID, "mode": st.Mode, "waitBeforeEscalateMinutes": st.WaitBeforeEscalateMinutes})
}

func (h *EscalationHandler) DeleteStep(w http.ResponseWriter, r *http.Request) {
	policyID, err := uuid.Parse(r.PathValue("id"))
	var order int32
	_, errOrder := fmt.Sscan(r.PathValue("stepOrder"), &order)
	if err != nil || errOrder != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id o paso inválido")
		return
	}
	n, err := h.Queries.DeletePolicyStep(r.Context(), db.DeletePolicyStepParams{PolicyID: policyID, StepOrder: order})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el paso")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "paso no encontrado")
		return
	}
	writeNoContent(w)
}

// ===== Ventanas de mantenimiento =====

type windowDTO struct {
	ID                    uuid.UUID  `json:"id"`
	ServiceID             *uuid.UUID `json:"serviceId,omitempty"`
	AssetID               *uuid.UUID `json:"assetId,omitempty"`
	TerritorialUnitID     *uuid.UUID `json:"territorialUnitId,omitempty"`
	Title                 string     `json:"title"`
	Notes                 *string    `json:"notes,omitempty"`
	StartsAt              time.Time  `json:"startsAt"`
	EndsAt                time.Time  `json:"endsAt"`
	SuppressNotifications bool       `json:"suppressNotifications"`
	Active                bool       `json:"active"`
}

func toWindowDTO(m db.MaintenanceWindow) windowDTO {
	return windowDTO{ID: m.ID, ServiceID: uuidPtr(m.ServiceID), AssetID: uuidPtr(m.AssetID), TerritorialUnitID: uuidPtr(m.TerritorialUnitID),
		Title: m.Title, Notes: textPtr(m.Notes), StartsAt: m.StartsAt.Time, EndsAt: m.EndsAt.Time, SuppressNotifications: m.SuppressNotifications, Active: m.Active}
}

func (h *EscalationHandler) ListWindows(w http.ResponseWriter, r *http.Request) {
	s, err := scopeFromQuery(r)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", err.Error())
		return
	}
	rows, err := h.Queries.ListMaintenanceWindows(r.Context(), db.ListMaintenanceWindowsParams{
		ServiceID: optionalUUID(s.ServiceID), AssetID: optionalUUID(s.AssetID), TerritorialUnitID: optionalUUID(s.TerritorialUnitID),
		OnlyCurrent: pgtype.Bool{Bool: r.URL.Query().Get("active") == "true", Valid: true},
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar las ventanas")
		return
	}
	dtos := make([]windowDTO, 0, len(rows))
	for _, m := range rows {
		dtos = append(dtos, toWindowDTO(m))
	}
	writeData(w, http.StatusOK, dtos)
}

type createWindowRequest struct {
	scope
	Title                 string    `json:"title"`
	Notes                 *string   `json:"notes"`
	StartsAt              time.Time `json:"startsAt"`
	EndsAt                time.Time `json:"endsAt"`
	SuppressNotifications bool      `json:"suppressNotifications"`
	Priority              *int32    `json:"priority"`
}

func (h *EscalationHandler) CreateWindow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createWindowRequest
	if err := decodeJSON(w, r, &req); err != nil || req.scope.count() != 1 || strings.TrimSpace(req.Title) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica exactamente un scope, title, startsAt y endsAt (RFC3339)")
		return
	}
	if !req.EndsAt.After(req.StartsAt) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-dates", "endsAt debe ser posterior a startsAt")
		return
	}
	priority := int32(100)
	if req.Priority != nil {
		priority = *req.Priority
	}
	actor, _ := middleware.UserFromContext(ctx)
	m, err := h.Queries.CreateMaintenanceWindow(ctx, db.CreateMaintenanceWindowParams{
		ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID), TerritorialUnitID: optionalUUID(req.TerritorialUnitID),
		Title: strings.TrimSpace(req.Title), Notes: nonEmptyText(req.Notes), StartsAt: pgtype.Timestamptz{Time: req.StartsAt, Valid: true},
		EndsAt: pgtype.Timestamptz{Time: req.EndsAt, Valid: true}, SuppressNotifications: req.SuppressNotifications, Priority: priority, CreatedBy: actor.ID,
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el servicio, activo o unidad indicado no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la ventana")
		return
	}
	h.AuditLog.Log(ctx, "maintenance_window.create", audit.LevelInfo, audit.Success(), map[string]any{"windowId": m.ID.String(), "suppress": m.SuppressNotifications})
	writeData(w, http.StatusCreated, toWindowDTO(m))
}

func (h *EscalationHandler) DeleteWindow(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	n, err := h.Queries.DeactivateMaintenanceWindow(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cerrar la ventana")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ventana no encontrada o ya cerrada")
		return
	}
	h.AuditLog.Log(r.Context(), "maintenance_window.delete", audit.LevelInfo, audit.Success(), map[string]any{"windowId": id.String()})
	writeNoContent(w)
}

// ===== RACI (solo dato en esta fase; la UI completa es Backlog Post-Corte) =====

func (h *EscalationHandler) ListRaci(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	client, e1 := queryUUID(q.Get("clientId"))
	service, e2 := queryUUID(q.Get("serviceId"))
	if e1 != nil || e2 != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "clientId/serviceId inválido")
		return
	}
	rows, err := h.Queries.ListRaciAssignments(r.Context(), db.ListRaciAssignmentsParams{ClientID: client, ServiceID: service})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el RACI")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, a := range rows {
		out = append(out, map[string]any{"id": a.ID, "clientId": uuidPtr(a.ClientID), "serviceId": uuidPtr(a.ServiceID), "assetId": uuidPtr(a.AssetID),
			"topic": a.Topic, "role": a.Role, "teamId": a.TeamID, "teamName": a.TeamName})
	}
	writeData(w, http.StatusOK, out)
}

type createRaciRequest struct {
	ClientID  *uuid.UUID `json:"clientId"`
	ServiceID *uuid.UUID `json:"serviceId"`
	AssetID   *uuid.UUID `json:"assetId"`
	Topic     string     `json:"topic"`
	Role      string     `json:"role"`
	TeamID    uuid.UUID  `json:"teamId"`
}

func (h *EscalationHandler) CreateRaci(w http.ResponseWriter, r *http.Request) {
	var req createRaciRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Topic) == "" || req.TeamID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "topic, role y teamId son obligatorios")
		return
	}
	switch req.Role {
	case "responsible", "accountable", "consulted", "informed":
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "role debe ser responsible, accountable, consulted o informed")
		return
	}
	a, err := h.Queries.CreateRaciAssignment(r.Context(), db.CreateRaciAssignmentParams{
		ClientID: optionalUUID(req.ClientID), ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID),
		Topic: strings.TrimSpace(req.Topic), Role: db.RaciRole(req.Role), TeamID: req.TeamID,
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente, servicio, activo o equipo inexistente")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la asignación RACI")
		return
	}
	h.AuditLog.Log(r.Context(), "raci.create", audit.LevelInfo, audit.Success(), map[string]any{"raciId": a.ID.String()})
	writeData(w, http.StatusCreated, map[string]any{"id": a.ID, "topic": a.Topic, "role": a.Role, "teamId": a.TeamID})
}
