package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"
)

// Guardias en línea de tiempo (pedido del dueño 2026-10-07, canvas "Turnos:
// guardias"): la vista semanal del legacy (work-shifts-admin) con hora exacta,
// huecos de las guardias que deben estar siempre cubiertas (N1 y N2),
// generar rotación y la carga masiva por CSV con el mismo formato del legacy.

type GuardsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	Now      func() time.Time
}

func (h *GuardsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

const (
	maxGuardRangeDays = 120
	maxGuardSlotDays  = 92
	maxRotationCount  = 52
)

type guardMemberDTO struct {
	TeamMemberID uuid.UUID  `json:"teamMemberId"`
	Name         string     `json:"name"`
	UserID       *uuid.UUID `json:"userId,omitempty"`
}

type guardDTO struct {
	CycleID       uuid.UUID        `json:"cycleId"`
	TeamID        uuid.UUID        `json:"teamId"`
	Label         string           `json:"label"`
	MustBeCovered bool             `json:"mustBeCovered"`
	ChangeDay     int32            `json:"changeDay"`
	ChangeTime    string           `json:"changeTime"`
	WorkShiftID   *uuid.UUID       `json:"workShiftId,omitempty"`
	WorkShiftName *string          `json:"workShiftName,omitempty"`
	Timezone      string           `json:"timezone"`
	Members       []guardMemberDTO `json:"members"`
}

type guardSlotDTO struct {
	ID           uuid.UUID  `json:"id"`
	CycleID      uuid.UUID  `json:"cycleId"`
	TeamMemberID uuid.UUID  `json:"teamMemberId"`
	Name         string     `json:"name"`
	UserID       *uuid.UUID `json:"userId,omitempty"`
	StartsAt     time.Time  `json:"startsAt"`
	EndsAt       time.Time  `json:"endsAt"`
	Paused       bool       `json:"paused"`
}

type guardOverrideDTO struct {
	ID                      uuid.UUID  `json:"id"`
	CycleID                 uuid.UUID  `json:"cycleId"`
	OriginalTeamMemberID    *uuid.UUID `json:"originalTeamMemberId,omitempty"`
	ReplacementTeamMemberID uuid.UUID  `json:"replacementTeamMemberId"`
	Name                    string     `json:"name"`
	StartsAt                time.Time  `json:"startsAt"`
	EndsAt                  time.Time  `json:"endsAt"`
	Reason                  string     `json:"reason"`
}

type absenceDTO struct {
	UserID    uuid.UUID `json:"userId"`
	From      string    `json:"from"`
	To        string    `json:"to"`
	Condition string    `json:"condition"`
}

type workShiftRefDTO struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	StartTime string    `json:"startTime"`
}

// guardLabel: "Guardia N1_NO_HABIL" → "N1 No hábil", "Guardia N2" → "N2".
func guardLabel(teamName string) string {
	l := strings.TrimSpace(strings.TrimPrefix(teamName, "Guardia "))
	if strings.EqualFold(l, "N1_NO_HABIL") {
		return "N1 No hábil"
	}
	return l
}

func pgTimeString(t pgtype.Time) string {
	if !t.Valid {
		return "09:00"
	}
	d := time.Duration(t.Microseconds) * time.Microsecond
	return fmt.Sprintf("%02d:%02d", int(d.Hours()), int(d.Minutes())%60)
}

// Timeline es GET /api/guards?from=&to= (RFC 3339): guardias, integrantes,
// guardias asignadas, reemplazos y ausencias de Dotación del periodo.
func (h *GuardsHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	now := h.now()
	from, to := now.AddDate(0, 0, -7), now.AddDate(0, 0, 28)
	if v := r.URL.Query().Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			problemdetails.Write(w, r, 400, "invalid-parameter", "from debe ser fecha y hora RFC 3339")
			return
		}
		from = t
	}
	if v := r.URL.Query().Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			problemdetails.Write(w, r, 400, "invalid-parameter", "to debe ser fecha y hora RFC 3339")
			return
		}
		to = t
	}
	if !to.After(from) || to.Sub(from) > maxGuardRangeDays*24*time.Hour {
		problemdetails.Write(w, r, 400, "invalid-parameter", fmt.Sprintf("el periodo debe ser de hasta %d días", maxGuardRangeDays))
		return
	}
	cycles, err := h.Queries.ListGuardCycles(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las guardias")
		return
	}
	members, err := h.Queries.ListGuardMembers(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los integrantes")
		return
	}
	byTeam := map[uuid.UUID][]guardMemberDTO{}
	for _, m := range members {
		byTeam[m.TeamID] = append(byTeam[m.TeamID], guardMemberDTO{TeamMemberID: m.ID, Name: m.DisplayName, UserID: uuidPtr(m.UserID)})
	}
	guards := make([]guardDTO, 0, len(cycles))
	for _, c := range cycles {
		ms := byTeam[c.TeamID]
		if ms == nil {
			ms = []guardMemberDTO{}
		}
		guards = append(guards, guardDTO{
			CycleID: c.ID, TeamID: c.TeamID, Label: guardLabel(c.TeamName), MustBeCovered: c.MustBeCovered,
			ChangeDay: c.StartDayOfWeek, ChangeTime: pgTimeString(c.ChangeTime), Timezone: c.Timezone, Members: ms,
		})
		if c.WorkShiftID != uuid.Nil {
			id, name := c.WorkShiftID, c.WorkShiftName
			guards[len(guards)-1].WorkShiftID, guards[len(guards)-1].WorkShiftName = &id, &name
		}
	}
	tsFrom, tsTo := pgtype.Timestamptz{Time: from, Valid: true}, pgtype.Timestamptz{Time: to, Valid: true}
	slotRows, err := h.Queries.ListGuardSlotsBetween(ctx, db.ListGuardSlotsBetweenParams{FromAt: tsFrom, ToAt: tsTo})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las guardias asignadas")
		return
	}
	slots := make([]guardSlotDTO, 0, len(slotRows))
	for _, s := range slotRows {
		slots = append(slots, guardSlotDTO{ID: s.ID, CycleID: s.CycleID, TeamMemberID: s.TeamMemberID, Name: s.DisplayName, UserID: uuidPtr(s.UserID), StartsAt: s.StartsAt.Time, EndsAt: s.EndsAt.Time, Paused: s.IsPaused})
	}
	ovRows, err := h.Queries.ListGuardOverridesBetween(ctx, db.ListGuardOverridesBetweenParams{FromAt: tsFrom, ToAt: tsTo})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los reemplazos")
		return
	}
	overrides := make([]guardOverrideDTO, 0, len(ovRows))
	for _, o := range ovRows {
		overrides = append(overrides, guardOverrideDTO{ID: o.ID, CycleID: o.CycleID, OriginalTeamMemberID: uuidPtr(o.OriginalTeamMemberID), ReplacementTeamMemberID: o.ReplacementTeamMemberID, Name: o.ReplacementName, StartsAt: o.StartDate.Time, EndsAt: o.EndDate.Time, Reason: o.Reason})
	}
	absRows, err := h.Queries.ListAbsencesBetween(ctx, db.ListAbsencesBetweenParams{FromDate: pgtype.Date{Time: from, Valid: true}, ToDate: pgtype.Date{Time: to, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las ausencias")
		return
	}
	shifts, err := h.Queries.ListWorkShifts(ctx, pgtype.Bool{Bool: true, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los turnos de trabajo")
		return
	}
	shiftRefs := make([]workShiftRefDTO, 0, len(shifts))
	for _, s := range shifts {
		shiftRefs = append(shiftRefs, workShiftRefDTO{ID: s.ID, Name: s.Name, StartTime: pgTimeString(s.StartTime)})
	}
	writeData(w, 200, map[string]any{
		"from": from, "to": to, "now": now, "guards": guards, "slots": slots, "overrides": overrides,
		"absences": mergeAbsences(absRows), "workShifts": shiftRefs,
	})
}

// mergeAbsences junta días seguidos de la misma persona y condición.
func mergeAbsences(rows []db.ListAbsencesBetweenRow) []absenceDTO {
	out := []absenceDTO{}
	var last *absenceDTO
	var lastDay time.Time
	for _, a := range rows {
		day := a.AssignedDate.Time
		if last != nil && last.UserID == a.UserID && last.Condition == a.Condition && day.Sub(lastDay) <= 24*time.Hour {
			last.To = day.Format("2006-01-02")
		} else {
			out = append(out, absenceDTO{UserID: a.UserID, From: day.Format("2006-01-02"), To: day.Format("2006-01-02"), Condition: a.Condition})
			last = &out[len(out)-1]
		}
		lastDay = day
	}
	return out
}

type guardSlotRequest struct {
	CycleID      uuid.UUID `json:"cycleId"`
	TeamMemberID uuid.UUID `json:"teamMemberId"`
	StartsAt     time.Time `json:"startsAt"`
	EndsAt       time.Time `json:"endsAt"`
}

func validGuardRange(starts, ends time.Time) string {
	switch {
	case starts.IsZero() || ends.IsZero():
		return "indica desde y hasta"
	case !ends.After(starts):
		return "«hasta» tiene que ser después de «desde»"
	case ends.Sub(starts) > maxGuardSlotDays*24*time.Hour:
		return fmt.Sprintf("una guardia dura hasta %d días", maxGuardSlotDays)
	}
	return ""
}

// memberOfCycle: la persona tiene que ser integrante de esa guardia.
func (h *GuardsHandler) memberOfCycle(ctx context.Context, q *db.Queries, cycleID, memberID uuid.UUID) (db.GetGuardCycleRow, string) {
	c, err := q.GetGuardCycle(ctx, cycleID)
	if err != nil {
		return c, "la guardia no existe"
	}
	if _, err := q.GetTeamMemberForTeam(ctx, db.GetTeamMemberForTeamParams{ID: memberID, TeamID: c.TeamID}); err != nil {
		return c, "esa persona no es integrante de la guardia (agrégala en Administración → Equipos)"
	}
	return c, ""
}

func toGuardSlotDTO(s db.RotationSlot) guardSlotDTO {
	return guardSlotDTO{ID: s.ID, CycleID: s.CycleID, TeamMemberID: s.TeamMemberID, StartsAt: s.StartsAt.Time, EndsAt: s.EndsAt.Time, Paused: s.IsPaused}
}

// CreateSlot es POST /api/guards/slots (admin).
func (h *GuardsHandler) CreateSlot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req guardSlotRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	if msg := validGuardRange(req.StartsAt, req.EndsAt); msg != "" {
		problemdetails.Write(w, r, 400, "invalid-payload", msg)
		return
	}
	cycle, msg := h.memberOfCycle(ctx, h.Queries, req.CycleID, req.TeamMemberID)
	if msg != "" {
		problemdetails.Write(w, r, 400, "invalid-payload", msg)
		return
	}
	slot, err := h.Queries.CreateGuardSlot(ctx, db.CreateGuardSlotParams{CycleID: req.CycleID, TeamMemberID: req.TeamMemberID, StartsAt: pgtype.Timestamptz{Time: req.StartsAt, Valid: true}, EndsAt: pgtype.Timestamptz{Time: req.EndsAt, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear la guardia")
		return
	}
	h.AuditLog.Log(ctx, "guard.slot.created", audit.LevelInfo, audit.Success(), map[string]any{"slotId": slot.ID.String(), "guard": cycle.TeamName, "startsAt": req.StartsAt, "endsAt": req.EndsAt})
	writeData(w, http.StatusCreated, toGuardSlotDTO(slot))
}

// UpdateSlot es PUT /api/guards/slots/{id} (admin).
func (h *GuardsHandler) UpdateSlot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "guardia no encontrada")
		return
	}
	var req guardSlotRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	if msg := validGuardRange(req.StartsAt, req.EndsAt); msg != "" {
		problemdetails.Write(w, r, 400, "invalid-payload", msg)
		return
	}
	old, err := h.Queries.GetGuardSlot(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 404, "not-found", "guardia no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la guardia")
		return
	}
	if _, msg := h.memberOfCycle(ctx, h.Queries, old.CycleID, req.TeamMemberID); msg != "" {
		problemdetails.Write(w, r, 400, "invalid-payload", msg)
		return
	}
	slot, err := h.Queries.UpdateGuardSlot(ctx, db.UpdateGuardSlotParams{ID: id, TeamMemberID: req.TeamMemberID, StartsAt: pgtype.Timestamptz{Time: req.StartsAt, Valid: true}, EndsAt: pgtype.Timestamptz{Time: req.EndsAt, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la guardia")
		return
	}
	h.AuditLog.Log(ctx, "guard.slot.updated", audit.LevelInfo, audit.Success(), map[string]any{"slotId": id.String(), "startsAt": req.StartsAt, "endsAt": req.EndsAt})
	writeData(w, 200, toGuardSlotDTO(slot))
}

// DeleteSlot es DELETE /api/guards/slots/{id} (admin).
func (h *GuardsHandler) DeleteSlot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "guardia no encontrada")
		return
	}
	n, err := h.Queries.DeleteGuardSlot(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo eliminar la guardia")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, 404, "not-found", "guardia no encontrada")
		return
	}
	h.AuditLog.Log(ctx, "guard.slot.deleted", audit.LevelInfo, audit.Success(), map[string]any{"slotId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

type rotationRequest struct {
	CycleID       uuid.UUID   `json:"cycleId"`
	TeamMemberIDs []uuid.UUID `json:"teamMemberIds"`
	StartsAt      time.Time   `json:"startsAt"`
	DaysEach      int         `json:"daysEach"`
	Count         int         `json:"count"`
}

// GenerateRotation es POST /api/guards/rotation (admin): crea `count`
// guardias seguidas de `daysEach` días, repitiendo el orden de personas.
func (h *GuardsHandler) GenerateRotation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req rotationRequest
	if err := decodeJSON(w, r, &req); err != nil || len(req.TeamMemberIDs) == 0 || req.StartsAt.IsZero() ||
		req.DaysEach < 1 || req.DaysEach > 31 || req.Count < 1 || req.Count > maxRotationCount {
		problemdetails.Write(w, r, 400, "invalid-payload", fmt.Sprintf("indica la guardia, el orden de personas, desde cuándo, días de cada una (1–31) y cuántas (1–%d)", maxRotationCount))
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo generar la rotación")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	var cycle db.GetGuardCycleRow
	for _, m := range req.TeamMemberIDs {
		c, msg := h.memberOfCycle(ctx, q, req.CycleID, m)
		if msg != "" {
			problemdetails.Write(w, r, 400, "invalid-payload", msg)
			return
		}
		cycle = c
	}
	created := make([]guardSlotDTO, 0, req.Count)
	for i := 0; i < req.Count; i++ {
		starts := req.StartsAt.AddDate(0, 0, i*req.DaysEach)
		ends := starts.AddDate(0, 0, req.DaysEach)
		slot, err := q.CreateGuardSlot(ctx, db.CreateGuardSlotParams{CycleID: req.CycleID, TeamMemberID: req.TeamMemberIDs[i%len(req.TeamMemberIDs)], StartsAt: pgtype.Timestamptz{Time: starts, Valid: true}, EndsAt: pgtype.Timestamptz{Time: ends, Valid: true}})
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo generar la rotación")
			return
		}
		created = append(created, toGuardSlotDTO(slot))
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo generar la rotación")
		return
	}
	h.AuditLog.Log(ctx, "guard.rotation.generated", audit.LevelInfo, audit.Success(), map[string]any{"guard": cycle.TeamName, "count": req.Count, "daysEach": req.DaysEach, "startsAt": req.StartsAt})
	writeData(w, http.StatusCreated, created)
}

type guardConfigRequest struct {
	MustBeCovered *bool      `json:"mustBeCovered"`
	ChangeDay     *int32     `json:"changeDay"`
	WorkShiftID   *uuid.UUID `json:"workShiftId"`
	ClearShift    bool       `json:"clearWorkShift"`
}

// UpdateGuard es PATCH /api/guards/{cycleId} (admin): siempre cubierta, día
// de cambio y el turno de trabajo del que sale la hora de cambio.
func (h *GuardsHandler) UpdateGuard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("cycleId"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "guardia no encontrada")
		return
	}
	var req guardConfigRequest
	if err := decodeJSON(w, r, &req); err != nil || (req.ChangeDay != nil && (*req.ChangeDay < 0 || *req.ChangeDay > 6)) {
		problemdetails.Write(w, r, 400, "invalid-payload", "día de cambio inválido (0 = domingo … 6 = sábado)")
		return
	}
	cycle, err := h.Queries.GetGuardCycle(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "guardia no encontrada")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la guardia")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	must, day := cycle.MustBeCovered, cycle.StartDayOfWeek
	if req.MustBeCovered != nil {
		must = *req.MustBeCovered
	}
	if req.ChangeDay != nil {
		day = *req.ChangeDay
	}
	if _, err := q.UpdateGuardCycle(ctx, db.UpdateGuardCycleParams{ID: id, MustBeCovered: must, StartDayOfWeek: day}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la guardia")
		return
	}
	if req.WorkShiftID != nil || req.ClearShift {
		if err := q.UnlinkWorkShiftsFromCycle(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo enlazar el turno")
			return
		}
		if req.WorkShiftID != nil {
			if err := q.LinkWorkShiftToCycle(ctx, db.LinkWorkShiftToCycleParams{ID: *req.WorkShiftID, CycleID: pgtype.UUID{Bytes: id, Valid: true}}); err != nil {
				problemdetails.Write(w, r, 500, "internal-error", "no se pudo enlazar el turno")
				return
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la guardia")
		return
	}
	h.AuditLog.Log(ctx, "guard.config.updated", audit.LevelInfo, audit.Success(), map[string]any{"guard": cycle.TeamName, "mustBeCovered": must, "changeDay": day, "workShiftId": uuidString(req.WorkShiftID)})
	w.WriteHeader(http.StatusNoContent)
}

// ===== Carga masiva por CSV (mismo formato que el legacy) =====

const guardCSVTemplate = "# LEYENDA E INSTRUCCIONES DE IMPORTACIÓN DE TURNOS\n" +
	"# ------------------------------------------------\n" +
	"# Columna \"condicion\": la guardia o la condición de Dotación.\n" +
	"# Guardias: N2, TI, N1 (Guardia N1 No Hábil), OL (Charla/Capacitación)\n" +
	"# Dotación: Teletrabajo, Vacaciones, Trámite Médico, Licencia médica\n" +
	"# Columna \"usuario\": username, correo o nombre completo del analista.\n" +
	"# Columnas \"fechaInicio\" / \"fechaFin\": AAAA-MM-DD (Ej: 2026-06-15)\n" +
	"# Columnas \"horaInicio\" / \"horaFin\": HH:MM de 24 horas (Ej: 09:00)\n" +
	"# ------------------------------------------------\n" +
	"condicion,usuario,fechaInicio,horaInicio,fechaFin,horaFin\n" +
	"N2,usuario.n2,2026-05-04,09:00,2026-05-11,09:00\n" +
	"N1,usuario.n1,2026-05-04,09:00,2026-05-11,09:00\n" +
	"Vacaciones,usuario.n2,2026-05-11,09:00,2026-05-18,09:00\n"

// Template es GET /api/guards/import/template.
func (h *GuardsHandler) Template(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="turnos-internos-template.csv"`)
	_, _ = io.WriteString(w, "\uFEFF"+guardCSVTemplate)
}

func foldText(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(strings.TrimSpace(s))) {
		if unicode.Is(unicode.Mn, r) || r == ' ' || r == '/' || r == '_' || r == '(' || r == ')' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// csvCondition: guardia (nombre del equipo) o condición de Dotación. Acepta
// el código del legacy ("N2") y el nombre del equipo ("Guardia N2").
func csvCondition(raw string) (team string, dotacion string, ok bool) {
	switch strings.TrimPrefix(foldText(raw), "guardia") {
	case "n2":
		return "Guardia N2", "", true
	case "ti":
		return "Guardia TI", "", true
	case "n1", "n1nohabil":
		return "Guardia N1_NO_HABIL", "", true
	case "ol", "charlacapacitacion", "charlacapacitacionol":
		return "Guardia OL", "", true
	case "teletrabajo", "telework":
		return "", "telework", true
	case "vacaciones", "vacation":
		return "", "vacation", true
	case "tramitemedico", "medicalappointment":
		return "", "medical_appointment", true
	case "licenciamedica", "medicalleave":
		return "", "medical_leave", true
	}
	return "", "", false
}

func splitCSV(line string) []string {
	var out []string
	var cur strings.Builder
	quoted := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case c == '"' && quoted && i+1 < len(line) && line[i+1] == '"':
			cur.WriteByte('"')
			i++
		case c == '"':
			quoted = !quoted
		case (c == ',' || c == ';') && !quoted:
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
		default:
			cur.WriteByte(c)
		}
	}
	return append(out, strings.TrimSpace(cur.String()))
}

type csvRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

// Import es POST /api/guards/import (admin; text/csv o multipart "file"):
// el CSV del legacy. Las guardias quedan en la línea de tiempo (si la persona
// no era integrante, se agrega); las condiciones de Dotación, por día. Una
// fila con error no detiene el resto.
func (h *GuardsHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	var raw []byte
	var err error
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		file, _, ferr := r.FormFile("file")
		if ferr != nil {
			problemdetails.Write(w, r, 400, "invalid-payload", "adjunta un archivo CSV")
			return
		}
		defer file.Close()
		raw, err = io.ReadAll(file)
	} else {
		raw, err = io.ReadAll(r.Body)
	}
	if err != nil {
		problemdetails.Write(w, r, 413, "payload-too-large", "el CSV supera 2 MB")
		return
	}
	text := strings.TrimPrefix(string(raw), "\uFEFF")
	var lines []struct {
		n    int
		text string
	}
	for i, l := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		t := strings.TrimSpace(l)
		if t == "" || strings.HasPrefix(strings.Trim(t, `"`), "#") {
			continue
		}
		lines = append(lines, struct {
			n    int
			text string
		}{i + 1, t})
	}
	if len(lines) < 2 {
		problemdetails.Write(w, r, 400, "invalid-payload", "el CSV debe tener encabezado y al menos una fila")
		return
	}
	col := map[string]int{}
	for i, hname := range splitCSV(lines[0].text) {
		col[foldText(hname)] = i
	}
	for _, need := range []string{"condicion", "usuario", "fechainicio", "horainicio", "fechafin", "horafin"} {
		if _, ok := col[need]; !ok {
			problemdetails.Write(w, r, 400, "invalid-payload", "faltan columnas: condicion, usuario, fechaInicio, horaInicio, fechaFin, horaFin")
			return
		}
	}
	cycles, err := h.Queries.ListGuardCycles(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las guardias")
		return
	}
	cycleByTeam := map[string]db.ListGuardCyclesRow{}
	for _, c := range cycles {
		cycleByTeam[c.TeamName] = c
	}
	loc, _ := time.LoadLocation("America/Santiago")
	if loc == nil {
		loc = time.Local
	}
	actor, _ := middleware.UserFromContext(ctx)
	created, days := 0, 0
	errs := []csvRowError{}
	for _, l := range lines[1:] {
		v := splitCSV(l.text)
		get := func(k string) string {
			if i := col[k]; i < len(v) {
				return v[i]
			}
			return ""
		}
		fail := func(msg string) { errs = append(errs, csvRowError{Row: l.n, Message: msg}) }
		team, dot, ok := csvCondition(get("condicion"))
		if !ok {
			fail("condición desconocida: " + get("condicion"))
			continue
		}
		starts, err1 := time.ParseInLocation("2006-01-02 15:04", get("fechainicio")+" "+get("horainicio"), loc)
		ends, err2 := time.ParseInLocation("2006-01-02 15:04", get("fechafin")+" "+get("horafin"), loc)
		if err1 != nil || err2 != nil {
			fail("fechas u horas inválidas: usa AAAA-MM-DD y HH:MM")
			continue
		}
		if msg := validGuardRange(starts, ends); msg != "" {
			fail(msg)
			continue
		}
		user, err := h.Queries.FindUserForGuardImport(ctx, get("usuario"))
		if err != nil {
			fail("no existe el usuario " + get("usuario"))
			continue
		}
		if dot != "" {
			// Por día: del día de inicio al de término; si termina temprano
			// (antes de mediodía) ese último día no cuenta.
			last := time.Date(ends.Year(), ends.Month(), ends.Day(), 0, 0, 0, 0, loc)
			if ends.Hour() < 12 && last.After(starts) {
				last = last.AddDate(0, 0, -1)
			}
			for d := time.Date(starts.Year(), starts.Month(), starts.Day(), 0, 0, 0, 0, loc); !d.After(last); d = d.AddDate(0, 0, 1) {
				if err := h.Queries.UpsertDotacionDay(ctx, db.UpsertDotacionDayParams{UserID: user.ID, AssignedDate: pgtype.Date{Time: d, Valid: true}, Condition: db.TeleworkCondition(dot)}); err != nil {
					fail("no se pudo guardar el día " + d.Format("2006-01-02"))
					break
				}
				days++
			}
			continue
		}
		cycle, ok := cycleByTeam[team]
		if !ok {
			fail("no existe la guardia " + guardLabel(team) + " (créala en Administración → Turnos)")
			continue
		}
		member, err := h.Queries.FindTeamMemberByUser(ctx, db.FindTeamMemberByUserParams{TeamID: cycle.TeamID, UserID: pgtype.UUID{Bytes: user.ID, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			member, err = h.Queries.AddGuardMember(ctx, db.AddGuardMemberParams{TeamID: cycle.TeamID, UserID: pgtype.UUID{Bytes: user.ID, Valid: true}})
		}
		if err != nil {
			fail("no se pudo sumar a " + user.DisplayName + " a la guardia")
			continue
		}
		if _, err := h.Queries.CreateGuardSlot(ctx, db.CreateGuardSlotParams{CycleID: cycle.ID, TeamMemberID: member, StartsAt: pgtype.Timestamptz{Time: starts, Valid: true}, EndsAt: pgtype.Timestamptz{Time: ends, Valid: true}}); err != nil {
			fail("no se pudo crear la guardia")
			continue
		}
		created++
	}
	sort.Slice(errs, func(i, j int) bool { return errs[i].Row < errs[j].Row })
	h.AuditLog.Log(ctx, "guard.import", audit.LevelInfo, audit.Success(), map[string]any{"guards": created, "dotacionDays": days, "errors": len(errs), "by": actor.Username})
	writeData(w, 200, map[string]any{"guards": created, "dotacionDays": days, "errors": errs})
}
