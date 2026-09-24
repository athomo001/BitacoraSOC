package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/rotation"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RotationHandler es el motor de rotación de guardia de la Fase 8
// (spec/01-arquitectura.md "Unificación de los dos sistemas de turnos",
// spec/04-contratos-api.md sección "Turnos", HU-4/HU-5): ciclos, el rol
// semanal (rotation_slots) y los reemplazos puntuales (rotation_overrides).
// Núcleo siempre activo (spec/01-arquitectura.md sección 5) — sin gate
// SOC/NOC, a diferencia de EscalationHandler.
type RotationHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Now      func() time.Time
}

func (h *RotationHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// ===== DTOs =====

type rotationCycleDTO struct {
	ID             uuid.UUID `json:"id"`
	TeamID         uuid.UUID `json:"teamId"`
	StartDayOfWeek int32     `json:"startDayOfWeek"`
	StartTimeUtc   string    `json:"startTimeUtc"`
	DurationDays   int32     `json:"durationDays"`
	Timezone       string    `json:"timezone"`
	Active         bool      `json:"active"`
}

func toRotationCycleDTO(c db.RotationCycle) rotationCycleDTO {
	return rotationCycleDTO{
		ID: c.ID, TeamID: c.TeamID, StartDayOfWeek: c.StartDayOfWeek,
		StartTimeUtc: timeOfDayToString(c.StartTimeUtc), DurationDays: c.DurationDays,
		Timezone: c.Timezone, Active: c.Active,
	}
}

type rotationSlotDTO struct {
	ID            uuid.UUID `json:"id"`
	CycleID       uuid.UUID `json:"cycleId"`
	TeamMemberID  uuid.UUID `json:"teamMemberId"`
	DisplayName   string    `json:"displayName"`
	WeekStartDate string    `json:"weekStartDate"`
	WeekEndDate   string    `json:"weekEndDate"`
	IsPaused      bool      `json:"isPaused"`
	PausedReason  *string   `json:"pausedReason,omitempty"`
}

func toRotationSlotDTO(s db.RotationSlot, displayName string) rotationSlotDTO {
	return rotationSlotDTO{
		ID: s.ID, CycleID: s.CycleID, TeamMemberID: s.TeamMemberID, DisplayName: displayName,
		WeekStartDate: dateToString(s.WeekStartDate), WeekEndDate: dateToString(s.WeekEndDate),
		IsPaused: s.IsPaused, PausedReason: textPtr(s.PausedReason),
	}
}

type rotationOverrideDTO struct {
	ID                      uuid.UUID  `json:"id"`
	CycleID                 uuid.UUID  `json:"cycleId"`
	OriginalTeamMemberID    *uuid.UUID `json:"originalTeamMemberId,omitempty"`
	ReplacementTeamMemberID uuid.UUID  `json:"replacementTeamMemberId"`
	StartDate               time.Time  `json:"startDate"`
	EndDate                 time.Time  `json:"endDate"`
	Reason                  string     `json:"reason"`
	CreatedBy               uuid.UUID  `json:"createdBy"`
}

func toRotationOverrideDTO(o db.RotationOverride) rotationOverrideDTO {
	return rotationOverrideDTO{
		ID: o.ID, CycleID: o.CycleID, OriginalTeamMemberID: uuidPtr(o.OriginalTeamMemberID),
		ReplacementTeamMemberID: o.ReplacementTeamMemberID,
		StartDate:               o.StartDate.Time, EndDate: o.EndDate.Time,
		Reason: o.Reason, CreatedBy: o.CreatedBy,
	}
}

type workShiftDTO struct {
	ID                       uuid.UUID  `json:"id"`
	RotationCycleID          *uuid.UUID `json:"rotationCycleId,omitempty"`
	Name                     string     `json:"name"`
	StartTime                string     `json:"startTime"`
	EndTime                  string     `json:"endTime"`
	Timezone                 string     `json:"timezone"`
	ShiftType                string     `json:"shiftType"`
	ChecklistTemplateStartID *uuid.UUID `json:"checklistTemplateStartId,omitempty"`
	ChecklistTemplateEndID   *uuid.UUID `json:"checklistTemplateEndId,omitempty"`
	EmailRecipients          []string   `json:"emailRecipients"`
	Active                   bool       `json:"active"`
}

func toWorkShiftDTO(s db.WorkShift) workShiftDTO {
	return workShiftDTO{
		ID: s.ID, RotationCycleID: uuidPtr(s.RotationCycleID), Name: s.Name,
		StartTime: timeOfDayToString(s.StartTime), EndTime: timeOfDayToString(s.EndTime),
		Timezone: s.Timezone, ShiftType: s.ShiftType,
		ChecklistTemplateStartID: uuidPtr(s.ChecklistTemplateStartID),
		ChecklistTemplateEndID:   uuidPtr(s.ChecklistTemplateEndID),
		EmailRecipients:          s.EmailRecipients, Active: s.Active,
	}
}

// ===== Ciclos =====

func (h *RotationHandler) ListCycles(w http.ResponseWriter, r *http.Request) {
	teamID, err := queryUUID(r.URL.Query().Get("teamId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "teamId inválido")
		return
	}
	cycles, err := h.Queries.ListRotationCyclesByTeam(r.Context(), teamID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los ciclos de rotación")
		return
	}
	out := make([]rotationCycleDTO, 0, len(cycles))
	for _, c := range cycles {
		out = append(out, toRotationCycleDTO(c))
	}
	writeData(w, http.StatusOK, out)
}

type createRotationCycleRequest struct {
	TeamID         uuid.UUID `json:"teamId"`
	StartDayOfWeek int32     `json:"startDayOfWeek"`
	StartTimeUtc   string    `json:"startTimeUtc"`
	DurationDays   int32     `json:"durationDays"`
	Timezone       string    `json:"timezone"`
}

func (h *RotationHandler) CreateCycle(w http.ResponseWriter, r *http.Request) {
	var req createRotationCycleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.TeamID == uuid.Nil || req.StartDayOfWeek < 0 || req.StartDayOfWeek > 6 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "teamId y startDayOfWeek (0-6) son obligatorios")
		return
	}
	startTime, err := parseTimeOfDay(req.StartTimeUtc)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "startTimeUtc debe tener formato HH:MM")
		return
	}
	durationDays := req.DurationDays
	if durationDays <= 0 {
		durationDays = 7
	}
	timezone := strings.TrimSpace(req.Timezone)
	if timezone == "" {
		timezone = "America/Santiago"
	}
	cycle, err := h.Queries.CreateRotationCycle(r.Context(), db.CreateRotationCycleParams{
		TeamID: req.TeamID, StartDayOfWeek: req.StartDayOfWeek, StartTimeUtc: startTime,
		DurationDays: durationDays, Timezone: timezone,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el equipo indicado no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el ciclo de rotación")
		return
	}
	h.AuditLog.Log(r.Context(), "rotation.cycle.created", audit.LevelInfo, audit.Success(), map[string]any{"cycleId": cycle.ID.String(), "teamId": cycle.TeamID.String()})
	writeData(w, http.StatusCreated, toRotationCycleDTO(cycle))
}

// ===== Slots (rol semanal) — GET/POST/PATCH agregados en la Fase 8, no
// estaban en el contrato original (spec/04-contratos-api.md): sin ellos no
// hay forma de armar ni pausar el rol de guardia, ver plan de la fase =====

func (h *RotationHandler) ListSlots(w http.ResponseWriter, r *http.Request) {
	cycleID, err := uuid.Parse(r.URL.Query().Get("cycleId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "cycleId inválido")
		return
	}
	rows, err := h.Queries.ListRotationSlotsByCycle(r.Context(), cycleID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar el rol de guardia")
		return
	}
	out := make([]rotationSlotDTO, 0, len(rows))
	for _, s := range rows {
		out = append(out, rotationSlotDTO{
			ID: s.ID, CycleID: s.CycleID, TeamMemberID: s.TeamMemberID, DisplayName: s.DisplayName,
			WeekStartDate: dateToString(s.WeekStartDate), WeekEndDate: dateToString(s.WeekEndDate),
			IsPaused: s.IsPaused, PausedReason: textPtr(s.PausedReason),
		})
	}
	writeData(w, http.StatusOK, out)
}

type createRotationSlotRequest struct {
	CycleID       uuid.UUID `json:"cycleId"`
	TeamMemberID  uuid.UUID `json:"teamMemberId"`
	WeekStartDate string    `json:"weekStartDate"`
	WeekEndDate   string    `json:"weekEndDate"`
}

func (h *RotationHandler) CreateSlot(w http.ResponseWriter, r *http.Request) {
	var req createRotationSlotRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	start, errStart := parseDate(req.WeekStartDate)
	end, errEnd := parseDate(req.WeekEndDate)
	if req.CycleID == uuid.Nil || req.TeamMemberID == uuid.Nil || errStart != nil || errEnd != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cycleId, teamMemberId, weekStartDate y weekEndDate (YYYY-MM-DD) son obligatorios")
		return
	}
	if !end.Time.After(start.Time) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "weekEndDate debe ser posterior a weekStartDate")
		return
	}
	slot, err := h.Queries.CreateRotationSlot(r.Context(), db.CreateRotationSlotParams{
		CycleID: req.CycleID, TeamMemberID: req.TeamMemberID, WeekStartDate: start, WeekEndDate: end,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el ciclo o el miembro de equipo indicado no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el slot de rotación")
		return
	}
	h.AuditLog.Log(r.Context(), "rotation.slot.created", audit.LevelInfo, audit.Success(), map[string]any{"slotId": slot.ID.String(), "cycleId": slot.CycleID.String()})
	member, err := h.Queries.GetTeamMemberDisplay(r.Context(), slot.TeamMemberID)
	displayName := ""
	if err == nil {
		displayName = member.DisplayName
	}
	writeData(w, http.StatusCreated, toRotationSlotDTO(slot, displayName))
}

type patchRotationSlotRequest struct {
	IsPaused     bool    `json:"isPaused"`
	PausedReason *string `json:"pausedReason,omitempty"`
}

func (h *RotationHandler) PatchSlot(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	var req patchRotationSlotRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.IsPaused && (req.PausedReason == nil || strings.TrimSpace(*req.PausedReason) == "") {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "pausedReason es obligatorio al pausar (HU-5)")
		return
	}
	slot, err := h.Queries.PatchRotationSlotPause(r.Context(), db.PatchRotationSlotPauseParams{
		ID: id, IsPaused: req.IsPaused, PausedReason: nonEmptyText(req.PausedReason),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "slot de rotación no encontrado")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el slot")
		return
	}
	h.AuditLog.Log(r.Context(), "rotation.slot.paused", audit.LevelInfo, audit.Success(), map[string]any{"slotId": slot.ID.String(), "isPaused": slot.IsPaused})
	member, err := h.Queries.GetTeamMemberDisplay(r.Context(), slot.TeamMemberID)
	displayName := ""
	if err == nil {
		displayName = member.DisplayName
	}
	writeData(w, http.StatusOK, toRotationSlotDTO(slot, displayName))
}

// ===== Overrides =====

type createRotationOverrideRequest struct {
	CycleID                 uuid.UUID  `json:"cycleId"`
	OriginalTeamMemberID    *uuid.UUID `json:"originalTeamMemberId,omitempty"`
	ReplacementTeamMemberID uuid.UUID  `json:"replacementTeamMemberId"`
	StartDate               time.Time  `json:"startDate"`
	EndDate                 time.Time  `json:"endDate"`
	Reason                  string     `json:"reason"`
}

func (h *RotationHandler) CreateOverride(w http.ResponseWriter, r *http.Request) {
	var req createRotationOverrideRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.CycleID == uuid.Nil || req.ReplacementTeamMemberID == uuid.Nil || req.Reason == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "reason vacío")
		return
	}
	if !req.EndDate.After(req.StartDate) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "endDate debe ser posterior a startDate")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	override, err := h.Queries.CreateRotationOverride(r.Context(), db.CreateRotationOverrideParams{
		CycleID: req.CycleID, OriginalTeamMemberID: optionalUUID(req.OriginalTeamMemberID),
		ReplacementTeamMemberID: req.ReplacementTeamMemberID,
		StartDate:               pgtype.Timestamptz{Time: req.StartDate, Valid: true},
		EndDate:                 pgtype.Timestamptz{Time: req.EndDate, Valid: true},
		Reason:                  req.Reason, CreatedBy: user.ID,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el ciclo o el miembro indicado no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el reemplazo")
		return
	}
	h.AuditLog.Log(r.Context(), "rotation.override.created", audit.LevelInfo, audit.Success(), map[string]any{"overrideId": override.ID.String(), "cycleId": override.CycleID.String()})
	writeData(w, http.StatusCreated, toRotationOverrideDTO(override))
}

// ===== Quién está de guardia ahora (HU-4) =====

// resolveCurrentTeamMember consulta los ciclos activos del equipo y resuelve
// quién está de guardia ahora (internal/rotation.Resolve) — compartida entre
// RotationHandler.CurrentSlot y EscalationHandler.resolve (onCallNow,
// cerrando el gap dejado por la Fase 7: ver comentario histórico en
// resolvedMemberDTO.OnCallNow). Si el equipo tiene más de un ciclo activo
// (caso borde no contemplado en el roadmap), se devuelve la primera
// resolución vigente que se encuentre.
func resolveCurrentTeamMember(ctx context.Context, queries *db.Queries, teamID uuid.UUID, now time.Time) (*rotation.Current, error) {
	cycles, err := queries.ListRotationCyclesByTeam(ctx, pgtype.UUID{Bytes: teamID, Valid: true})
	if err != nil {
		return nil, err
	}
	for _, cycle := range cycles {
		if !cycle.Active {
			continue
		}
		overrideRows, err := queries.ListActiveOverridesForCycle(ctx, db.ListActiveOverridesForCycleParams{
			CycleID: cycle.ID, Now: pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			return nil, err
		}
		overrides := make([]rotation.Override, 0, len(overrideRows))
		for _, o := range overrideRows {
			overrides = append(overrides, rotation.Override{
				OriginalTeamMemberID:    uuidPtr(o.OriginalTeamMemberID),
				ReplacementTeamMemberID: o.ReplacementTeamMemberID,
				Start:                   o.StartDate.Time,
				End:                     o.EndDate.Time,
			})
		}

		var slot *rotation.Slot
		slotRow, err := queries.GetCurrentRotationSlot(ctx, db.GetCurrentRotationSlotParams{
			CycleID: cycle.ID, Today: pgtype.Date{Time: now, Valid: true},
		})
		switch {
		case err == nil:
			// week_end_date es el ÚLTIMO día cubierto (inclusive) — se le suma
			// un día para que el límite exclusivo de rotation.Resolve incluya
			// ese día completo (medianoche del día siguiente), no solo su 00:00.
			slot = &rotation.Slot{
				TeamMemberID: slotRow.TeamMemberID,
				WeekStart:    slotRow.WeekStartDate.Time,
				WeekEnd:      slotRow.WeekEndDate.Time.AddDate(0, 0, 1),
				IsPaused:     slotRow.IsPaused,
			}
		case errors.Is(err, pgx.ErrNoRows):
			// sin slot regular vigente esta semana — un override ad-hoc igual puede aplicar
		default:
			return nil, err
		}

		if current := rotation.Resolve(overrides, slot, now); current != nil {
			return current, nil
		}
	}
	return nil, nil
}

func (h *RotationHandler) CurrentSlot(w http.ResponseWriter, r *http.Request) {
	teamID, err := uuid.Parse(r.URL.Query().Get("teamId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "teamId inválido")
		return
	}
	ctx := r.Context()
	current, err := resolveCurrentTeamMember(ctx, h.Queries, teamID, h.now())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo resolver la guardia vigente")
		return
	}
	if current == nil {
		writeData(w, http.StatusOK, map[string]any{"currentMember": nil})
		return
	}
	member, err := h.Queries.GetTeamMemberDisplay(ctx, current.TeamMemberID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo resolver el nombre del miembro de guardia")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"currentMember": map[string]any{"teamMemberId": member.ID, "name": member.DisplayName},
		"since":         current.Since,
		"until":         current.Until,
	})
}

// ===== Turnos (work_shifts) =====

func (h *RotationHandler) ListWorkShifts(w http.ResponseWriter, r *http.Request) {
	active := queryBool(r.URL.Query().Get("active"))
	shifts, err := h.Queries.ListWorkShifts(r.Context(), active)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los turnos")
		return
	}
	out := make([]workShiftDTO, 0, len(shifts))
	for _, s := range shifts {
		out = append(out, toWorkShiftDTO(s))
	}
	writeData(w, http.StatusOK, out)
}

type createWorkShiftRequest struct {
	RotationCycleID          *uuid.UUID `json:"rotationCycleId,omitempty"`
	Name                     string     `json:"name"`
	StartTime                string     `json:"startTime"`
	EndTime                  string     `json:"endTime"`
	Timezone                 string     `json:"timezone"`
	ShiftType                string     `json:"shiftType"`
	ChecklistTemplateStartID *uuid.UUID `json:"checklistTemplateStartId,omitempty"`
	ChecklistTemplateEndID   *uuid.UUID `json:"checklistTemplateEndId,omitempty"`
	EmailRecipients          []string   `json:"emailRecipients"`
}

func (h *RotationHandler) CreateWorkShift(w http.ResponseWriter, r *http.Request) {
	var req createWorkShiftRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	startTime, errStart := parseTimeOfDay(req.StartTime)
	endTime, errEnd := parseTimeOfDay(req.EndTime)
	if req.Name == "" || errStart != nil || errEnd != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name, startTime y endTime (HH:MM) son obligatorios")
		return
	}
	timezone := strings.TrimSpace(req.Timezone)
	if timezone == "" {
		timezone = "America/Santiago"
	}
	shiftType := strings.TrimSpace(req.ShiftType)
	if shiftType == "" {
		shiftType = "regular"
	}
	if req.EmailRecipients == nil {
		req.EmailRecipients = []string{}
	}
	shift, err := h.Queries.CreateWorkShift(r.Context(), db.CreateWorkShiftParams{
		RotationCycleID: optionalUUID(req.RotationCycleID), Name: req.Name,
		StartTime: startTime, EndTime: endTime, Timezone: timezone, ShiftType: shiftType,
		ChecklistTemplateStartID: optionalUUID(req.ChecklistTemplateStartID),
		ChecklistTemplateEndID:   optionalUUID(req.ChecklistTemplateEndID),
		EmailRecipients:          req.EmailRecipients,
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el ciclo de rotación o la plantilla de checklist indicada no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el turno")
		return
	}
	h.AuditLog.Log(r.Context(), "work_shift.created", audit.LevelInfo, audit.Success(), map[string]any{"workShiftId": shift.ID.String(), "name": shift.Name})
	writeData(w, http.StatusCreated, toWorkShiftDTO(shift))
}
