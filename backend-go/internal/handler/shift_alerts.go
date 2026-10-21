package handler

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ShiftAlertsHandler son dos avisos por correo del legacy que faltaban
// (revisión de paridad, decisiones del dueño 2026-10-16: «igual al legacy»;
// checklistAlertScheduler.js):
//
//   - Checklist no realizado: si a la hora configurada (09:30) nadie hizo el
//     checklist de inicio ese día, avisa a quien está de guardia en la guardia
//     elegida (N1_NO_HABIL) y a las personas con los cargos elegidos (N2).
//   - Guardia sin cubrir: desde las 09:00, si la semana que empieza dentro de
//     N días (7) tiene una de las guardias marcadas sin nadie, avisa a las
//     personas con los cargos elegidos (N2). Apagado por defecto.
//
// Cada uno sale una vez al día como máximo (y el segundo, una vez por semana
// objetivo). Se configuran en Administración → Turnos → Avisos.
type ShiftAlertsHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
	Now      func() time.Time
}

// guardReminderHour: el legacy evalúa desde las 09:00.
const guardReminderHour = 9

func (h *ShiftAlertsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now().In(birthdayZone())
	}
	return time.Now().In(birthdayZone())
}

type shiftAlertGuardDTO struct {
	CycleID         uuid.UUID `json:"cycleId"`
	TeamID          uuid.UUID `json:"teamId"`
	Name            string    `json:"name"`
	RemindUncovered bool      `json:"remindUncovered"`
}

type shiftAlertsDTO struct {
	ChecklistEnabled  bool                 `json:"checklistEnabled"`
	ChecklistTime     string               `json:"checklistTime"`
	ChecklistTeamID   *uuid.UUID           `json:"checklistTeamId"`
	ChecklistCargos   []string             `json:"checklistCargos"`
	ChecklistLastSent string               `json:"checklistLastSent,omitempty"`
	GuardEnabled      bool                 `json:"guardEnabled"`
	GuardDaysAhead    int32                `json:"guardDaysAhead"`
	GuardCargos       []string             `json:"guardCargos"`
	GuardLastSent     string               `json:"guardLastSent,omitempty"`
	GuardLastWeek     string               `json:"guardLastWeek,omitempty"`
	Guards            []shiftAlertGuardDTO `json:"guards"`
	// RemindCycleIDs (al guardar): las guardias que revisa el recordatorio.
	RemindCycleIDs []uuid.UUID `json:"remindCycleIds,omitempty"`
}

func dateStr(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

func (h *ShiftAlertsHandler) load(ctx context.Context) (shiftAlertsDTO, error) {
	c, err := h.Queries.GetShiftAlertsConfig(ctx)
	if err != nil {
		return shiftAlertsDTO{}, err
	}
	cycles, err := h.Queries.ListGuardCycles(ctx)
	if err != nil {
		return shiftAlertsDTO{}, err
	}
	dto := shiftAlertsDTO{ChecklistEnabled: c.ChecklistMissingEnabled, ChecklistTime: c.ChecklistMissingTime, ChecklistTeamID: uuidPtr(c.ChecklistMissingTeamID),
		ChecklistCargos: nonNilStrings(c.ChecklistMissingCargos), ChecklistLastSent: dateStr(c.ChecklistMissingLastDate),
		GuardEnabled: c.GuardReminderEnabled, GuardDaysAhead: c.GuardReminderDaysAhead, GuardCargos: nonNilStrings(c.GuardReminderCargos),
		GuardLastSent: dateStr(c.GuardReminderLastDate), GuardLastWeek: dateStr(c.GuardReminderLastWeek), Guards: []shiftAlertGuardDTO{}}
	for _, cy := range cycles {
		dto.Guards = append(dto.Guards, shiftAlertGuardDTO{CycleID: cy.ID, TeamID: cy.TeamID, Name: guardLabel(cy.TeamName), RemindUncovered: cy.RemindUncovered})
	}
	return dto, nil
}

// GetConfig: GET /api/config/shift-alerts (admin).
func (h *ShiftAlertsHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	dto, err := h.load(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	writeData(w, http.StatusOK, dto)
}

// cleanCargos: los cargos en mayúsculas, sin repetir ni vacíos (el legacy
// compara cargoLabel sin distinguir mayúsculas).
func cleanCargos(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, c := range in {
		c = strings.ToUpper(strings.TrimSpace(c))
		if c != "" && !seen[c] && len(c) <= 40 {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

// UpdateConfig: PUT /api/config/shift-alerts (admin).
func (h *ShiftAlertsHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req shiftAlertsDTO
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.ChecklistTime = strings.TrimSpace(req.ChecklistTime)
	if !hhmm.MatchString(req.ChecklistTime) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la hora del aviso va como HH:MM")
		return
	}
	if req.GuardDaysAhead < 1 || req.GuardDaysAhead > 60 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "los días de anticipación van de 1 a 60")
		return
	}
	cycles, err := h.Queries.ListGuardCycles(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las guardias")
		return
	}
	remind := map[uuid.UUID]bool{}
	for _, id := range req.RemindCycleIDs {
		remind[id] = true
	}
	teamOK := req.ChecklistTeamID == nil
	for _, cy := range cycles {
		if req.ChecklistTeamID != nil && cy.TeamID == *req.ChecklistTeamID {
			teamOK = true
		}
	}
	if !teamOK {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "esa guardia no existe")
		return
	}
	if err := h.Queries.UpdateShiftAlertsConfig(ctx, db.UpdateShiftAlertsConfigParams{
		ChecklistEnabled: req.ChecklistEnabled, ChecklistTime: req.ChecklistTime, ChecklistTeamID: optionalUUID(req.ChecklistTeamID),
		ChecklistCargos: cleanCargos(req.ChecklistCargos), GuardEnabled: req.GuardEnabled, GuardDaysAhead: req.GuardDaysAhead, GuardCargos: cleanCargos(req.GuardCargos),
	}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración")
		return
	}
	for _, cy := range cycles {
		if cy.RemindUncovered != remind[cy.ID] {
			if err := h.Queries.SetGuardRemindUncovered(ctx, db.SetGuardRemindUncoveredParams{ID: cy.ID, RemindUncovered: remind[cy.ID]}); err != nil {
				problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron guardar las guardias")
				return
			}
		}
	}
	h.AuditLog.Log(ctx, "config.shift_alerts.update", audit.LevelInfo, audit.Success(), map[string]any{
		"checklistEnabled": req.ChecklistEnabled, "checklistTime": req.ChecklistTime, "guardEnabled": req.GuardEnabled, "guardDaysAhead": req.GuardDaysAhead,
	})
	h.GetConfig(w, r)
}

// Tick revisa los dos avisos (scheduler, cada 5 minutos como el legacy).
func (h *ShiftAlertsHandler) Tick(ctx context.Context) error {
	c, err := h.Queries.GetShiftAlertsConfig(ctx)
	if err != nil {
		return err
	}
	now := h.now()
	if err := h.checklistMissing(ctx, c, now); err != nil {
		return err
	}
	return h.guardReminder(ctx, c, now)
}

func (h *ShiftAlertsHandler) checklistMissing(ctx context.Context, c db.GetShiftAlertsConfigRow, now time.Time) error {
	if !c.ChecklistMissingEnabled {
		return nil
	}
	cutoff, err := time.ParseInLocation("15:04", c.ChecklistMissingTime, now.Location())
	if err != nil {
		return nil
	}
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	at := day.Add(time.Duration(cutoff.Hour())*time.Hour + time.Duration(cutoff.Minute())*time.Minute)
	if now.Before(at) || (c.ChecklistMissingLastDate.Valid && c.ChecklistMissingLastDate.Time.Format("2006-01-02") == day.Format("2006-01-02")) {
		return nil
	}
	n, err := h.Queries.CountStartChecksBetween(ctx, db.CountStartChecksBetweenParams{FromAt: pgTime(day), ToAt: pgTime(day.AddDate(0, 0, 1))})
	if err != nil || n > 0 {
		return err
	}
	dayDate := pgDate(time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC))
	claimed, err := h.Queries.ClaimChecklistMissingDay(ctx, dayDate)
	if err != nil || claimed == 0 {
		return err
	}
	emails, err := h.checklistRecipients(ctx, c, now)
	if err != nil {
		return err
	}
	m := mailtpl.ChecklistMissing(branding.Title(ctx, h.Queries), c.ChecklistMissingTime, now)
	h.send(ctx, emails, m, "checklist.missing_alert", map[string]any{"day": day.Format("2006-01-02"), "alertTime": c.ChecklistMissingTime})
	return nil
}

// checklistRecipients: quien está de guardia ahora en la guardia elegida y
// las personas con los cargos elegidos (getChecklistAlertRecipients del legacy).
func (h *ShiftAlertsHandler) checklistRecipients(ctx context.Context, c db.GetShiftAlertsConfigRow, now time.Time) ([]string, error) {
	var ids []uuid.UUID
	if c.ChecklistMissingTeamID.Valid {
		team := uuid.UUID(c.ChecklistMissingTeamID.Bytes)
		current, err := resolveCurrentTeamMembers(ctx, h.Queries, team, now)
		if err != nil {
			return nil, err
		}
		members, err := h.Queries.ListTeamMembers(ctx, team)
		if err != nil {
			return nil, err
		}
		for _, cur := range current {
			for _, m := range members {
				if m.ID == cur.TeamMemberID && m.UserID.Valid {
					ids = append(ids, uuid.UUID(m.UserID.Bytes))
				}
			}
		}
	}
	var emails []string
	if len(ids) > 0 {
		people, err := h.Queries.ListNotifyUsers(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, p := range people {
			if p.Active && p.Email != "" {
				emails = append(emails, p.Email)
			}
		}
	}
	byCargo, err := h.cargoEmails(ctx, c.ChecklistMissingCargos)
	if err != nil {
		return nil, err
	}
	return uniqueEmails(append(emails, byCargo...)), nil
}

func (h *ShiftAlertsHandler) cargoEmails(ctx context.Context, cargos []string) ([]string, error) {
	cargos = cleanCargos(cargos)
	if len(cargos) == 0 {
		return nil, nil
	}
	rows, err := h.Queries.ListActiveUsersByCargo(ctx, cargos)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Email)
	}
	return out, nil
}

func uniqueEmails(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range in {
		k := strings.ToLower(strings.TrimSpace(e))
		if k != "" && !seen[k] {
			seen[k] = true
			out = append(out, strings.TrimSpace(e))
		}
	}
	sort.Strings(out)
	return out
}

// targetWeek es resolveFutureWeekGap del legacy: el lunes de la semana que
// empieza en o después de hoy + daysAhead (nunca la semana actual).
func targetWeek(now time.Time, daysAhead int) time.Time {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	currentMonday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	anchor := today.AddDate(0, 0, daysAhead)
	toMonday := 0
	switch anchor.Weekday() {
	case time.Sunday:
		toMonday = 1
	case time.Monday:
	default:
		toMonday = 8 - int(anchor.Weekday())
	}
	monday := anchor.AddDate(0, 0, toMonday)
	if !monday.After(currentMonday) {
		monday = currentMonday.AddDate(0, 0, 7)
	}
	return monday
}

type span struct{ from, to time.Time }

// covered: las guardias asignadas cubren todo [from, to) sin huecos.
func covered(from, to time.Time, slots []span) bool {
	sort.Slice(slots, func(i, j int) bool { return slots[i].from.Before(slots[j].from) })
	cur := from
	for _, s := range slots {
		if s.from.After(cur) {
			return false
		}
		if s.to.After(cur) {
			cur = s.to
		}
		if !cur.Before(to) {
			return true
		}
	}
	return !cur.Before(to)
}

func (h *ShiftAlertsHandler) guardReminder(ctx context.Context, c db.GetShiftAlertsConfigRow, now time.Time) error {
	if !c.GuardReminderEnabled || now.Hour() < guardReminderHour {
		return nil
	}
	today := now.Format("2006-01-02")
	if c.GuardReminderLastDate.Valid && c.GuardReminderLastDate.Time.Format("2006-01-02") == today {
		return nil
	}
	monday := targetWeek(now, int(c.GuardReminderDaysAhead))
	if c.GuardReminderLastWeek.Valid && c.GuardReminderLastWeek.Time.Format("2006-01-02") == monday.Format("2006-01-02") {
		return nil
	}
	missing, err := h.uncoveredGuards(ctx, monday)
	if err != nil || len(missing) == 0 {
		return err
	}
	week := pgDate(time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, time.UTC))
	claimed, err := h.Queries.ClaimGuardReminder(ctx, db.ClaimGuardReminderParams{Day: pgDate(time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)), Week: week})
	if err != nil || claimed == 0 {
		return err
	}
	emails, err := h.cargoEmails(ctx, c.GuardReminderCargos)
	if err != nil {
		return err
	}
	today0 := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	days := int(monday.Sub(today0).Hours()/24 + 0.5)
	m := mailtpl.GuardUncovered(branding.Title(ctx, h.Queries), cleanCargos(c.GuardReminderCargos), monday, monday.AddDate(0, 0, 6), days, missing, now)
	h.send(ctx, uniqueEmails(emails), m, "escalation.reminder", map[string]any{"targetWeek": monday.Format("2006-01-02"), "guards": missing, "daysAhead": days})
	return nil
}

// uncoveredGuards: las guardias marcadas que no tienen a nadie en algún
// momento de la semana objetivo (desde su día y hora de cambio, 7 días).
func (h *ShiftAlertsHandler) uncoveredGuards(ctx context.Context, monday time.Time) ([]string, error) {
	cycles, err := h.Queries.ListGuardCycles(ctx)
	if err != nil {
		return nil, err
	}
	slots, err := h.Queries.ListGuardSlotsBetween(ctx, db.ListGuardSlotsBetweenParams{FromAt: pgTime(monday.AddDate(0, 0, -1)), ToAt: pgTime(monday.AddDate(0, 0, 15))})
	if err != nil {
		return nil, err
	}
	var missing []string
	for _, cy := range cycles {
		if !cy.RemindUncovered {
			continue
		}
		loc, err := time.LoadLocation(cy.Timezone)
		if err != nil {
			loc = monday.Location()
		}
		offset := (int(cy.StartDayOfWeek) + 6) % 7 // lunes = 0
		micro := cy.ChangeTime.Microseconds
		start := time.Date(monday.Year(), monday.Month(), monday.Day()+offset, 0, 0, 0, 0, loc).Add(time.Duration(micro) * time.Microsecond)
		var spans []span
		for _, s := range slots {
			if s.CycleID == cy.ID && !s.IsPaused && s.MemberActive {
				spans = append(spans, span{s.StartsAt.Time, s.EndsAt.Time})
			}
		}
		if !covered(start, start.AddDate(0, 0, 7), spans) {
			missing = append(missing, guardLabel(cy.TeamName))
		}
	}
	return missing, nil
}

// send manda un solo correo a todos (como el legacy) y lo deja en Auditoría.
func (h *ShiftAlertsHandler) send(ctx context.Context, to []string, m mailtpl.Mail, event string, meta map[string]any) {
	meta["recipients"] = len(to)
	if len(to) == 0 {
		h.AuditLog.Log(ctx, event+".failed", audit.LevelWarn, audit.Failure("sin destinatarios: nadie con correo en la guardia ni con los cargos elegidos"), meta)
		return
	}
	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err != nil {
		h.AuditLog.Log(ctx, event+".failed", audit.LevelWarn, audit.Failure("correo sin configurar"), meta)
		return
	}
	if err := sender.SendAlternative(to, nil, m.Subject, m.Text, m.HTML); err != nil {
		h.AuditLog.Log(ctx, event+".failed", audit.LevelError, audit.Failure(err.Error()), meta)
		return
	}
	h.AuditLog.Log(ctx, event+".sent", audit.LevelInfo, audit.Success(), meta)
}
