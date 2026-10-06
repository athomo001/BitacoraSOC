package handler

import (
	"context"
	"errors"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/reminders"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
)

// ShiftRemindersHandler es Administración → Turnos → Recordatorios
// (spec/12-pendientes.md §2.3b): recordatorios por correo a los turnos en
// curso, portados del checklist-admin del legacy. Van a los destinatarios
// de cada turno (work_shifts.email_recipients), los mismos del reporte de
// cierre, porque en 2.0 los turnos no tienen usuarios asignados.
type ShiftRemindersHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Sender   func(context.Context) (*mail.Sender, error)
	Now      func() time.Time
}

func (h *ShiftRemindersHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

type shiftReminderDTO struct {
	ID                  uuid.UUID   `json:"id"`
	Label               string      `json:"label"`
	ReminderText        string      `json:"reminderText"`
	FrequencyType       string      `json:"frequencyType"`
	IntervalHours       int32       `json:"intervalHours"`
	FixedTimes          []string    `json:"fixedTimes"`
	TargetShiftIDs      []uuid.UUID `json:"targetShiftIds"`
	Enabled             bool        `json:"enabled"`
	LastSentAt          *time.Time  `json:"lastSentAt,omitempty"`
	LastRecipientsCount int32       `json:"lastRecipientsCount,omitempty"`
	LastStatus          string      `json:"lastStatus,omitempty"`
}

func toShiftReminderDTO(r db.ShiftReminder) shiftReminderDTO {
	dto := shiftReminderDTO{
		ID: r.ID, Label: r.Label, ReminderText: r.ReminderText, FrequencyType: r.FrequencyType,
		IntervalHours: r.IntervalHours, FixedTimes: r.FixedTimes, TargetShiftIDs: r.TargetShiftIds, Enabled: r.Enabled,
	}
	if dto.FixedTimes == nil {
		dto.FixedTimes = []string{}
	}
	if dto.TargetShiftIDs == nil {
		dto.TargetShiftIDs = []uuid.UUID{}
	}
	return dto
}

func (h *ShiftRemindersHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListShiftReminders(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los recordatorios")
		return
	}
	out := make([]shiftReminderDTO, 0, len(rows))
	for _, row := range rows {
		dto := toShiftReminderDTO(db.ShiftReminder{
			ID: row.ID, Label: row.Label, ReminderText: row.ReminderText, FrequencyType: row.FrequencyType,
			IntervalHours: row.IntervalHours, FixedTimes: row.FixedTimes, TargetShiftIds: row.TargetShiftIds, Enabled: row.Enabled,
		})
		if row.LastSentAt.Valid {
			dto.LastSentAt = &row.LastSentAt.Time
			dto.LastRecipientsCount = row.LastRecipientsCount
			dto.LastStatus = row.LastStatus
		}
		out = append(out, dto)
	}
	writeData(w, http.StatusOK, out)
}

// shiftReminderInput es el cuerpo de alta y de edición: en la edición, lo
// que no viene queda como estaba.
type shiftReminderInput struct {
	Label          *string      `json:"label"`
	ReminderText   *string      `json:"reminderText"`
	FrequencyType  *string      `json:"frequencyType"`
	IntervalHours  *int32       `json:"intervalHours"`
	FixedTimes     *[]string    `json:"fixedTimes"`
	TargetShiftIDs *[]uuid.UUID `json:"targetShiftIds"`
	Enabled        *bool        `json:"enabled"`
}

// merge aplica el cuerpo sobre r y valida el resultado. Devuelve el motivo
// si no es válido.
func (in shiftReminderInput) merge(r *db.ShiftReminder) string {
	if in.Label != nil {
		r.Label = strings.TrimSpace(*in.Label)
	}
	if in.ReminderText != nil {
		r.ReminderText = strings.TrimSpace(*in.ReminderText)
	}
	if in.FrequencyType != nil {
		r.FrequencyType = *in.FrequencyType
	}
	if in.IntervalHours != nil {
		r.IntervalHours = *in.IntervalHours
	}
	if in.FixedTimes != nil {
		r.FixedTimes = *in.FixedTimes
	}
	if in.TargetShiftIDs != nil {
		r.TargetShiftIds = *in.TargetShiftIDs
	}
	if in.Enabled != nil {
		r.Enabled = *in.Enabled
	}
	switch {
	case r.Label == "" || len([]rune(r.Label)) > 150:
		return "el nombre es obligatorio (máximo 150 caracteres)"
	case r.ReminderText == "" || len([]rune(r.ReminderText)) > 5000:
		return "el texto es obligatorio (máximo 5000 caracteres)"
	case r.FrequencyType != reminders.FrequencyHours && r.FrequencyType != reminders.FrequencyFixed:
		return "frequencyType debe ser hours o fixed"
	case r.IntervalHours < 1 || r.IntervalHours > 24:
		return "intervalHours debe estar entre 1 y 24"
	}
	times := map[string]bool{}
	for _, t := range r.FixedTimes {
		t = strings.TrimSpace(t)
		if !reminders.ValidTime(t) {
			return "cada hora fija debe tener formato HH:MM"
		}
		times[t] = true
	}
	r.FixedTimes = make([]string, 0, len(times))
	for t := range times {
		r.FixedTimes = append(r.FixedTimes, t)
	}
	sort.Strings(r.FixedTimes)
	if r.FrequencyType == reminders.FrequencyFixed && len(r.FixedTimes) == 0 {
		return "a horas fijas necesita al menos una hora"
	}
	if len(r.FixedTimes) > 24 {
		return "máximo 24 horas fijas"
	}
	if r.TargetShiftIds == nil {
		r.TargetShiftIds = []uuid.UUID{}
	}
	return ""
}

func (h *ShiftRemindersHandler) Create(w http.ResponseWriter, r *http.Request) {
	var in shiftReminderInput
	if err := decodeJSON(w, r, &in); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	rem := db.ShiftReminder{FrequencyType: reminders.FrequencyHours, IntervalHours: 4, Enabled: true}
	if reason := in.merge(&rem); reason != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	created, err := h.Queries.CreateShiftReminder(r.Context(), db.CreateShiftReminderParams{
		Label: rem.Label, ReminderText: rem.ReminderText, FrequencyType: rem.FrequencyType, IntervalHours: rem.IntervalHours,
		FixedTimes: rem.FixedTimes, TargetShiftIds: rem.TargetShiftIds, Enabled: rem.Enabled,
		CreatedBy: pgtype.UUID{Bytes: user.ID, Valid: user.ID != uuid.Nil},
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el recordatorio")
		return
	}
	h.AuditLog.Log(r.Context(), "shift.reminder.created", audit.LevelInfo, audit.Success(), map[string]any{"reminderId": created.ID.String(), "label": created.Label})
	writeData(w, http.StatusCreated, toShiftReminderDTO(created))
}

func (h *ShiftRemindersHandler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	var in shiftReminderInput
	if err := decodeJSON(w, r, &in); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	rem, err := h.Queries.GetShiftReminder(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "recordatorio no encontrado")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el recordatorio")
		return
	}
	if reason := in.merge(&rem); reason != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
		return
	}
	updated, err := h.Queries.UpdateShiftReminder(r.Context(), db.UpdateShiftReminderParams{
		ID: id, Label: rem.Label, ReminderText: rem.ReminderText, FrequencyType: rem.FrequencyType, IntervalHours: rem.IntervalHours,
		FixedTimes: rem.FixedTimes, TargetShiftIds: rem.TargetShiftIds, Enabled: rem.Enabled,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el recordatorio")
		return
	}
	h.AuditLog.Log(r.Context(), "shift.reminder.updated", audit.LevelInfo, audit.Success(), map[string]any{"reminderId": id.String(), "enabled": updated.Enabled})
	writeData(w, http.StatusOK, toShiftReminderDTO(updated))
}

func (h *ShiftRemindersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	n, err := h.Queries.DeleteShiftReminder(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el recordatorio")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "recordatorio no encontrado")
		return
	}
	h.AuditLog.Log(r.Context(), "shift.reminder.deleted", audit.LevelWarn, audit.Success(), map[string]any{"reminderId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

// Test envía el recordatorio al correo del admin que lo pide, sin esperar
// a que toque ni registrar un envío.
func (h *ShiftRemindersHandler) Test(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil || h.Sender == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	rem, err := h.Queries.GetShiftReminder(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "recordatorio no encontrado")
		return
	}
	actor, _ := middleware.UserFromContext(r.Context())
	user, err := h.Queries.GetUserByID(r.Context(), actor.ID)
	if err != nil || strings.TrimSpace(user.Email) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "no-email", "tu cuenta no tiene correo para recibir la prueba")
		return
	}
	sender, err := h.Sender(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configura el correo antes de probar el recordatorio")
		return
	}
	m := reminderMail(branding.Title(r.Context(), h.Queries), rem)
	if err := sender.SendAlternative([]string{user.Email}, nil, "[Prueba] "+m.Subject, m.Text, m.HTML); err != nil {
		h.AuditLog.Log(r.Context(), "shift.reminder.test", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"reminderId": id.String()})
		problemdetails.Write(w, r, http.StatusBadGateway, "mail-failed", "el envío de prueba falló: "+err.Error())
		return
	}
	h.AuditLog.Log(r.Context(), "shift.reminder.test", audit.LevelInfo, audit.Success(), map[string]any{"reminderId": id.String()})
	writeData(w, http.StatusOK, map[string]string{"sentTo": user.Email})
}

// DispatchDue corre cada minuto: por cada recordatorio activo y cada turno
// activo al que apunta (ninguno = todos), si toca enviar reserva el envío
// (ClaimShiftReminderSend, único por bloque u hora) y recién entonces envía.
// Un fallo de correo queda registrado en el envío y no frena a los demás.
func (h *ShiftRemindersHandler) DispatchDue(ctx context.Context) error {
	list, err := h.Queries.ListEnabledShiftReminders(ctx)
	if err != nil || len(list) == 0 {
		return err
	}
	shifts, err := h.Queries.ListWorkShifts(ctx, pgtype.Bool{Bool: true, Valid: true})
	if err != nil {
		return err
	}
	now := h.now()
	var sender *mail.Sender
	for _, rem := range list {
		targets := map[uuid.UUID]bool{}
		for _, id := range rem.TargetShiftIds {
			targets[id] = true
		}
		for _, shift := range shifts {
			if len(targets) > 0 && !targets[shift.ID] {
				continue
			}
			key, ok := reminders.Due(reminders.Reminder{
				ID: rem.ID.String(), FrequencyType: rem.FrequencyType, IntervalHours: int(rem.IntervalHours), FixedTimes: rem.FixedTimes,
			}, reminderShift(shift), now)
			if !ok {
				continue
			}
			recipients := nonEmptyAddresses(shift.EmailRecipients)
			status := "sent"
			if len(recipients) == 0 {
				status = "no_recipients"
			}
			claimed, err := h.Queries.ClaimShiftReminderSend(ctx, db.ClaimShiftReminderSendParams{
				ReminderID: rem.ID, WorkShiftID: shift.ID, TriggerKey: key, RecipientsCount: int32(len(recipients)), Status: status,
			})
			if err != nil {
				return err
			}
			if claimed == 0 || len(recipients) == 0 {
				continue
			}
			if sender == nil {
				if h.Sender == nil {
					return nil
				}
				if sender, err = h.Sender(ctx); err != nil {
					h.markFailed(ctx, rem.ID, shift.ID, key, "correo sin configurar")
					sender = nil
					continue
				}
			}
			m := reminderMail(branding.Title(ctx, h.Queries), rem)
			if err := sender.SendAlternative(recipients, nil, m.Subject, m.Text, m.HTML); err != nil {
				h.markFailed(ctx, rem.ID, shift.ID, key, err.Error())
				continue
			}
			h.AuditLog.Log(ctx, "shift.reminder.sent", audit.LevelInfo, audit.Success(), map[string]any{
				"reminderId": rem.ID.String(), "workShiftId": shift.ID.String(), "trigger": key, "recipients": len(recipients),
			})
		}
	}
	return nil
}

func (h *ShiftRemindersHandler) markFailed(ctx context.Context, reminderID, shiftID uuid.UUID, key, reason string) {
	_ = h.Queries.MarkShiftReminderSendFailed(ctx, db.MarkShiftReminderSendFailedParams{
		ReminderID: reminderID, WorkShiftID: shiftID, TriggerKey: key, Error: pgtype.Text{String: reason, Valid: true},
	})
	h.AuditLog.Log(ctx, "shift.reminder.sent", audit.LevelWarn, audit.Failure(reason), map[string]any{
		"reminderId": reminderID.String(), "workShiftId": shiftID.String(), "trigger": key,
	})
}

// reminderShift traduce la ventana de un turno a minutos en su zona.
func reminderShift(s db.WorkShift) reminders.Shift {
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		loc = time.UTC
	}
	minutes := func(t pgtype.Time) int { return int(t.Microseconds / 60_000_000) }
	return reminders.Shift{StartMinute: minutes(s.StartTime), EndMinute: minutes(s.EndTime), Location: loc}
}

func nonEmptyAddresses(in []string) []string {
	out := make([]string, 0, len(in))
	for _, a := range in {
		if a = strings.TrimSpace(a); a != "" {
			out = append(out, a)
		}
	}
	return out
}

// reminderMail arma el correo con la plantilla del legacy (estándar del
// área): "Recordatorio de Turno" y el asunto "[Título] etiqueta".
func reminderMail(appTitle string, r db.ShiftReminder) mailtpl.Mail {
	return mailtpl.ShiftReminder(appTitle, r.Label, r.ReminderText)
}
