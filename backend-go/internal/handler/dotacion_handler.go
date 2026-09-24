package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"html/template"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/rotation"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// DotacionHandler es la matriz semanal de dotación/teletrabajo, el enlace
// público de solo lectura para TV de sala y la notificación periódica a
// RRHH — Fase 8 del roadmap, spec/04-contratos-api.md sección "Dotación,
// Teletrabajo y Pantallas de Sala (TV)", HU-4b/HU-5b. Núcleo siempre activo,
// sin gate SOC/NOC.
type DotacionHandler struct {
	Queries       *db.Queries
	AuditLog      *audit.Logger
	PublicBaseURL string
	Sender        func(context.Context) (*mail.Sender, error)
	Now           func() time.Time
}

func (h *DotacionHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *DotacionHandler) DispatchDueSchedules(ctx context.Context, sender *mail.Sender) error {
	schedules, err := h.Queries.ListNotificationSchedules(ctx)
	if err != nil {
		return err
	}
	now := h.now()
	for _, schedule := range schedules {
		lastSentToday := schedule.LastSentAt.Valid && schedule.LastSentAt.Time.In(now.Location()).YearDay() == now.YearDay() && schedule.LastSentAt.Time.In(now.Location()).Year() == now.Year()
		currentMinute := int64((now.Hour()*60 + now.Minute()) * 60 * 1_000_000)
		dueDay := schedule.DayOfWeek == int32(now.Weekday())
		if schedule.Frequency == db.NotificationScheduleFrequencyMonthly {
			dueDay = schedule.DayOfWeek == int32(now.Weekday()) && now.Day() <= 7
		}
		if !schedule.Enabled || !dueDay || lastSentToday || schedule.SendTime.Microseconds > currentMinute || len(schedule.Recipients) == 0 {
			continue
		}
		monday := mondayOf(now)
		matrix, matrixErr := h.buildMatrix(ctx, monday, monday.AddDate(0, 0, 4))
		if matrixErr != nil {
			return matrixErr
		}
		subject, _ := buildNotificationMail(schedule, matrix)
		if err := sender.SendHTML(schedule.Recipients, schedule.CcRecipients, subject, buildNotificationMailHTML(schedule, matrix)); err != nil {
			continue
		}
		if err := h.Queries.MarkNotificationScheduleSent(ctx, schedule.ID); err != nil {
			return err
		}
	}
	return nil
}

func (h *DotacionHandler) TestNotificationSchedule(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil || h.Sender == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "notificación inválida")
		return
	}
	schedule, err := h.Queries.GetNotificationSchedule(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "notificación no encontrada")
		return
	}
	now := h.now()
	matrix, err := h.buildMatrix(r.Context(), mondayOf(now), mondayOf(now).AddDate(0, 0, 4))
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo construir el reporte")
		return
	}
	sender, err := h.Sender(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configurá SMTP antes de probar la notificación")
		return
	}
	subject, _ := buildNotificationMail(schedule, matrix)
	if err := sender.SendHTML(schedule.Recipients, schedule.CcRecipients, "[Prueba] "+subject, buildNotificationMailHTML(schedule, matrix)); err != nil {
		problemdetails.Write(w, r, http.StatusBadGateway, "mail-failed", "el envío de prueba falló")
		return
	}
	h.AuditLog.Log(r.Context(), "dotacion.notification.test", audit.LevelInfo, audit.Success(), map[string]any{"scheduleId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

// mondayOf devuelve la medianoche del lunes de la semana que contiene t
// (mismo criterio que resolveWeekStart del legacy telework-matrix.js).
func mondayOf(t time.Time) time.Time {
	y, m, d := t.Date()
	day := time.Date(y, m, d, 0, 0, 0, 0, t.Location())
	weekday := int(day.Weekday())
	if weekday == 0 {
		weekday = 7 // domingo al final de la semana ISO
	}
	return day.AddDate(0, 0, -(weekday - 1))
}

func parseWeekRange(fromRaw, toRaw string, now time.Time) (time.Time, time.Time, error) {
	if fromRaw == "" && toRaw == "" {
		monday := mondayOf(now)
		return monday, monday.AddDate(0, 0, 4), nil
	}
	from, err := time.Parse("2006-01-02", fromRaw)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	to, err := time.Parse("2006-01-02", toRaw)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return from, to, nil
}

var weekdayShortEs = map[time.Weekday]string{
	time.Sunday:    "Dom",
	time.Monday:    "Lun",
	time.Tuesday:   "Mar",
	time.Wednesday: "Mié",
	time.Thursday:  "Jue",
	time.Friday:    "Vie",
	time.Saturday:  "Sáb",
}

// ===== Matriz semanal (HU-4b) =====

type matrixColumnDTO struct {
	Date     string `json:"date"`
	DayShort string `json:"dayShort"`
	IsToday  bool   `json:"isToday"`
}

type matrixCellDTO struct {
	Date      string `json:"date"`
	Condition string `json:"condition"`
	Label     string `json:"label"`
	Marker    string `json:"marker"`
}

type matrixRowDTO struct {
	UserID string          `json:"userId"`
	Name   string          `json:"name"`
	Role   string          `json:"role"`
	Days   []matrixCellDTO `json:"days"`
}

type matrixDTO struct {
	Columns []matrixColumnDTO `json:"columns"`
	Rows    []matrixRowDTO    `json:"rows"`
}

// buildMatrix arma la grilla [from,to] (inclusive) resolviendo por
// usuario/día la condición cargada en work_shift_assignments, o "office" por
// defecto si no hay fila — el esquema garantiza a lo más una condición por
// usuario/día (UNIQUE(user_id, assigned_date)), así que no hay conflicto que
// desempatar acá, solo orden de filas (internal/rotation.SortRows, HU-4b:
// "listando primero a quienes tienen novedades en la semana"). Excluye
// guest/auditor del roster, mismo criterio que computeRows del legacy
// telework-matrix.js.
func (h *DotacionHandler) buildMatrix(ctx context.Context, from, to time.Time) (matrixDTO, error) {
	now := h.now()
	todayDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	var dates []time.Time
	columns := make([]matrixColumnDTO, 0)
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		dates = append(dates, d)
		columns = append(columns, matrixColumnDTO{
			Date:     d.Format("2006-01-02"),
			DayShort: weekdayShortEs[d.Weekday()],
			IsToday:  d.Equal(todayDate),
		})
	}

	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{Active: pgtype.Bool{Bool: true, Valid: true}})
	if err != nil {
		return matrixDTO{}, err
	}
	assignments, err := h.Queries.ListAssignmentsForRange(ctx, db.ListAssignmentsForRangeParams{
		FromDate: pgtype.Date{Time: from, Valid: true},
		ToDate:   pgtype.Date{Time: to, Valid: true},
	})
	if err != nil {
		return matrixDTO{}, err
	}

	byUserDate := map[string]map[string]db.WorkShiftAssignment{}
	for _, a := range assignments {
		key := a.UserID.String()
		if byUserDate[key] == nil {
			byUserDate[key] = map[string]db.WorkShiftAssignment{}
		}
		byUserDate[key][a.AssignedDate.Time.Format("2006-01-02")] = a
	}

	rowInputs := make([]rotation.RowInput, 0, len(users))
	rowByKey := map[string]matrixRowDTO{}
	for _, u := range users {
		if u.Role == db.UserRoleGuest || u.Role == db.UserRoleAuditor {
			continue
		}
		key := u.ID.String()
		conditions := make([]rotation.Condition, 0, len(dates))
		days := make([]matrixCellDTO, 0, len(dates))
		for _, d := range dates {
			dateStr := d.Format("2006-01-02")
			condition := rotation.ConditionOffice
			if a, ok := byUserDate[key][dateStr]; ok {
				condition = rotation.Condition(a.Condition)
			}
			conditions = append(conditions, condition)
			meta := rotation.Meta(condition)
			days = append(days, matrixCellDTO{Date: dateStr, Condition: string(condition), Label: meta.Label, Marker: meta.Marker})
		}
		role := "Analista"
		if u.CargoLabel.Valid && strings.TrimSpace(u.CargoLabel.String) != "" {
			role = u.CargoLabel.String
		}
		rowInputs = append(rowInputs, rotation.RowInput{Key: key, Name: u.Username, Conditions: conditions})
		rowByKey[key] = matrixRowDTO{UserID: key, Name: u.Username, Role: role, Days: days}
	}

	sortedRows := rotation.SortRows(rowInputs)
	rows := make([]matrixRowDTO, 0, len(sortedRows))
	for _, ri := range sortedRows {
		rows = append(rows, rowByKey[ri.Key])
	}

	return matrixDTO{Columns: columns, Rows: rows}, nil
}

func (h *DotacionHandler) Matrix(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseWeekRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"), h.now())
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "from/to deben tener formato YYYY-MM-DD")
		return
	}
	matrix, err := h.buildMatrix(r.Context(), from, to)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo construir la matriz de dotación")
		return
	}
	writeData(w, http.StatusOK, matrix)
}

// ===== Asignaciones (upsert) =====

type assignmentDTO struct {
	ID           uuid.UUID `json:"id"`
	UserID       uuid.UUID `json:"userId"`
	AssignedDate string    `json:"assignedDate"`
	Condition    string    `json:"condition"`
	Notes        *string   `json:"notes,omitempty"`
}

func toAssignmentDTO(a db.WorkShiftAssignment) assignmentDTO {
	return assignmentDTO{ID: a.ID, UserID: a.UserID, AssignedDate: dateToString(a.AssignedDate), Condition: string(a.Condition), Notes: textPtr(a.Notes)}
}

func validTeleworkCondition(c string) bool {
	switch db.TeleworkCondition(c) {
	case db.TeleworkConditionTelework, db.TeleworkConditionOffice, db.TeleworkConditionGuardia,
		db.TeleworkConditionVacation, db.TeleworkConditionMedicalLeave, db.TeleworkConditionMedicalAppointment,
		db.TeleworkConditionTraining:
		return true
	}
	return false
}

type createAssignmentRequest struct {
	UserID       uuid.UUID `json:"userId"`
	AssignedDate string    `json:"assignedDate"`
	Condition    string    `json:"condition"`
	Notes        *string   `json:"notes,omitempty"`
}

func (h *DotacionHandler) CreateAssignment(w http.ResponseWriter, r *http.Request) {
	var req createAssignmentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	date, dateErr := parseDate(req.AssignedDate)
	if req.UserID == uuid.Nil || dateErr != nil || !validTeleworkCondition(req.Condition) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "userId, assignedDate (YYYY-MM-DD) y condition válidos son obligatorios")
		return
	}
	assignment, err := h.Queries.UpsertAssignment(r.Context(), db.UpsertAssignmentParams{
		UserID: req.UserID, AssignedDate: date, Condition: db.TeleworkCondition(req.Condition), Notes: nonEmptyText(req.Notes),
	})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el usuario indicado no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la asignación")
		return
	}
	h.AuditLog.Log(r.Context(), "work_shift_assignment.upserted", audit.LevelInfo, audit.Success(), map[string]any{
		"userId": assignment.UserID.String(), "date": req.AssignedDate, "condition": string(assignment.Condition),
	})
	writeData(w, http.StatusCreated, toAssignmentDTO(assignment))
}

// ===== Enlace público TV (HU-4b) =====

const teleworkShareSlug = "telework"

var teleworkTokenRe = regexp.MustCompile(`^[a-f0-9]{64}$`)

func newShareToken() (token, hash string, err error) {
	buf := make([]byte, 32) // 256 bits, mismo tamaño que el legacy publicShareController.js
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}

type publicShareActionRequest struct {
	Action string `json:"action"`
}

type publicShareDTO struct {
	Token     string `json:"token,omitempty"`
	PublicURL string `json:"publicUrl,omitempty"`
	IsActive  bool   `json:"isActive"`
}

func (h *DotacionHandler) PublicShareAction(w http.ResponseWriter, r *http.Request) {
	var req publicShareActionRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)

	existing, err := h.Queries.GetPublicShareBySlug(ctx, teleworkShareSlug)
	hasExisting := true
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el enlace público")
			return
		}
		hasExisting = false
	}

	switch req.Action {
	case "deactivate":
		if !hasExisting {
			writeData(w, http.StatusOK, publicShareDTO{IsActive: false})
			return
		}
		updated, err := h.Queries.SetPublicShareLinkActive(ctx, db.SetPublicShareLinkActiveParams{ID: existing.ID, IsActive: false})
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo desactivar el enlace")
			return
		}
		h.AuditLog.Log(ctx, "public_share.telework.deactivated", audit.LevelInfo, audit.Success(), map[string]any{"linkId": updated.ID.String()})
		writeData(w, http.StatusOK, publicShareDTO{IsActive: updated.IsActive})
	case "generate", "regenerate":
		token, tokenHash, tokenErr := newShareToken()
		if tokenErr != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo generar el token")
			return
		}
		var link db.PublicShareLink
		if hasExisting {
			link, err = h.Queries.RotatePublicShareLink(ctx, db.RotatePublicShareLinkParams{ID: existing.ID, TokenHash: tokenHash, CreatedBy: user.ID})
		} else {
			link, err = h.Queries.CreatePublicShareLink(ctx, db.CreatePublicShareLinkParams{Slug: teleworkShareSlug, TokenHash: tokenHash, CreatedBy: user.ID})
		}
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo generar el enlace")
			return
		}
		h.AuditLog.Log(ctx, "public_share.telework.rotated", audit.LevelInfo, audit.Success(), map[string]any{"linkId": link.ID.String()})
		writeData(w, http.StatusOK, publicShareDTO{Token: token, PublicURL: h.PublicBaseURL + "/p/telework/" + token, IsActive: link.IsActive})
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "action debe ser generate, regenerate o deactivate")
	}
}

// PublicTeleworkPage es GET /p/telework/{token} — sin autenticación, primer
// endpoint HTML del backend (spec/04-contratos-api.md, HU-4b). Valida el
// formato del token antes de tocar la base y responde siempre la misma
// página "no disponible" ante token mal formado, inexistente o desactivado
// (no revela cuál de los tres pasó) — mismo criterio que
// publicShareController.js del legacy.
func (h *DotacionHandler) PublicTeleworkPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	token := r.PathValue("token")
	if !teleworkTokenRe.MatchString(token) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(renderUnavailablePage()))
		return
	}
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	ctx := r.Context()
	link, err := h.Queries.GetActivePublicShareByTokenHash(ctx, hash)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(renderUnavailablePage()))
		return
	}
	now := h.now()
	monday := mondayOf(now)
	matrix, err := h.buildMatrix(ctx, monday, monday.AddDate(0, 0, 4))
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(renderUnavailablePage()))
		return
	}
	_ = h.Queries.TouchPublicShareAccess(ctx, link.ID)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(renderTeleworkPage(matrix, now)))
}

// buildNotificationMail preserves the plain-text fallback used by existing tests.
func buildNotificationMail(schedule db.WorkShiftNotificationSchedule, matrix matrixDTO) (subject, body string) {
	subject = strings.TrimSpace(schedule.Name)
	if subject == "" {
		subject = "Reporte de Dotación"
	}
	roleFilter := map[string]bool{}
	for _, r := range schedule.RoleFilter {
		roleFilter[strings.ToLower(strings.TrimSpace(r))] = true
	}

	var b strings.Builder
	b.WriteString(subject + "\r\n\r\n")
	if n := len(matrix.Columns); n > 0 {
		b.WriteString("Semana del " + matrix.Columns[0].Date + " al " + matrix.Columns[n-1].Date + "\r\n\r\n")
	}
	rowsWritten := 0
	for _, row := range matrix.Rows {
		if len(roleFilter) > 0 && !roleFilter[strings.ToLower(row.Role)] {
			continue
		}
		b.WriteString(row.Name + " (" + row.Role + ")\r\n")
		for _, day := range row.Days {
			b.WriteString("  " + day.Date + ": " + day.Label + "\r\n")
		}
		b.WriteString("\r\n")
		rowsWritten++
	}
	if rowsWritten == 0 {
		b.WriteString("Sin filas para el filtro configurado.\r\n")
	}
	return subject, b.String()
}

var notificationMailTemplate = template.Must(template.New("dotacion-notification").Parse(`<!doctype html><html lang="es"><body style="margin:0;background:#f3f5f6;color:#20252b;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:16px"><table role="presentation" width="100%" style="box-sizing:border-box;max-width:720px;margin:auto;background:#fff;border:1px solid #d8dde2"><tr><td style="padding:24px;border-bottom:4px solid #087f8c"><h1 style="margin:0;font-size:22px">{{.Subject}}</h1><p style="margin:6px 0 0;color:#66717b">Reporte de dotación</p></td></tr><tr><td style="padding:24px"><p>Semana del {{.WeekStart}} al {{.WeekEnd}}</p>{{range .Rows}}<h2 style="font-size:16px;margin-bottom:4px">{{.Name}} ({{.Role}})</h2><ul style="margin-top:0">{{range .Days}}<li>{{.Date}}: {{.Label}}</li>{{end}}</ul>{{end}}</td></tr></table></td></tr></table></body></html>`))

func buildNotificationMailHTML(schedule db.WorkShiftNotificationSchedule, matrix matrixDTO) string {
	roleFilter := map[string]bool{}
	for _, role := range schedule.RoleFilter {
		roleFilter[strings.ToLower(strings.TrimSpace(role))] = true
	}
	rows := make([]matrixRowDTO, 0, len(matrix.Rows))
	for _, row := range matrix.Rows {
		if len(roleFilter) == 0 || roleFilter[strings.ToLower(row.Role)] {
			rows = append(rows, row)
		}
	}
	data := struct {
		Subject, WeekStart, WeekEnd string
		Rows                        []matrixRowDTO
	}{Subject: strings.TrimSpace(schedule.Name), Rows: rows}
	if data.Subject == "" {
		data.Subject = "Reporte de Dotación"
	}
	if len(matrix.Columns) > 0 {
		data.WeekStart = matrix.Columns[0].Date
		data.WeekEnd = matrix.Columns[len(matrix.Columns)-1].Date
	}
	var output strings.Builder
	_ = notificationMailTemplate.Execute(&output, data)
	return output.String()
}

// ===== Notificación periódica de dotación (HU-5b) =====

type notificationScheduleDTO struct {
	ID           uuid.UUID  `json:"id"`
	Name         string     `json:"name"`
	Enabled      bool       `json:"enabled"`
	Frequency    string     `json:"frequency"`
	DayOfWeek    int32      `json:"dayOfWeek"`
	SendTime     string     `json:"sendTime"`
	RoleFilter   []string   `json:"roleFilter"`
	Recipients   []string   `json:"recipients"`
	CcRecipients []string   `json:"ccRecipients"`
	LastSentAt   *time.Time `json:"lastSentAt,omitempty"`
}

func toNotificationScheduleDTO(s db.WorkShiftNotificationSchedule) notificationScheduleDTO {
	dto := notificationScheduleDTO{
		ID: s.ID, Name: s.Name, Enabled: s.Enabled, Frequency: string(s.Frequency),
		DayOfWeek: s.DayOfWeek, SendTime: timeOfDayToString(s.SendTime),
		RoleFilter: s.RoleFilter, Recipients: s.Recipients, CcRecipients: s.CcRecipients,
	}
	if s.LastSentAt.Valid {
		dto.LastSentAt = &s.LastSentAt.Time
	}
	return dto
}

func (h *DotacionHandler) ListNotificationSchedules(w http.ResponseWriter, r *http.Request) {
	schedules, err := h.Queries.ListNotificationSchedules(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar las notificaciones de dotación")
		return
	}
	out := make([]notificationScheduleDTO, 0, len(schedules))
	for _, s := range schedules {
		out = append(out, toNotificationScheduleDTO(s))
	}
	writeData(w, http.StatusOK, out)
}

type createNotificationScheduleRequest struct {
	Name         string   `json:"name"`
	Frequency    string   `json:"frequency"`
	DayOfWeek    int32    `json:"dayOfWeek"`
	SendTime     string   `json:"sendTime"`
	RoleFilter   []string `json:"roleFilter,omitempty"`
	Recipients   []string `json:"recipients"`
	CcRecipients []string `json:"ccRecipients,omitempty"`
}

func (h *DotacionHandler) CreateNotificationSchedule(w http.ResponseWriter, r *http.Request) {
	var req createNotificationScheduleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	sendTime, timeErr := parseTimeOfDay(req.SendTime)
	if req.Name == "" || len(req.Recipients) == 0 || timeErr != nil ||
		(req.Frequency != "weekly" && req.Frequency != "monthly") || req.DayOfWeek < 0 || req.DayOfWeek > 6 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name, recipients, frequency (weekly|monthly), dayOfWeek (0-6) y sendTime (HH:MM) son obligatorios")
		return
	}
	if req.RoleFilter == nil {
		req.RoleFilter = []string{}
	}
	if req.CcRecipients == nil {
		req.CcRecipients = []string{}
	}
	user, _ := middleware.UserFromContext(r.Context())
	schedule, err := h.Queries.CreateNotificationSchedule(r.Context(), db.CreateNotificationScheduleParams{
		Name: req.Name, Frequency: db.NotificationScheduleFrequency(req.Frequency), DayOfWeek: req.DayOfWeek,
		SendTime: sendTime, RoleFilter: req.RoleFilter, Recipients: req.Recipients, CcRecipients: req.CcRecipients,
		CreatedBy: user.ID,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la notificación de dotación")
		return
	}
	h.AuditLog.Log(r.Context(), "dotacion.notification_schedule.created", audit.LevelInfo, audit.Success(), map[string]any{"scheduleId": schedule.ID.String(), "name": schedule.Name})
	writeData(w, http.StatusCreated, toNotificationScheduleDTO(schedule))
}

type patchNotificationScheduleRequest struct {
	Enabled      *bool    `json:"enabled,omitempty"`
	Name         *string  `json:"name,omitempty"`
	Frequency    *string  `json:"frequency,omitempty"`
	DayOfWeek    *int32   `json:"dayOfWeek,omitempty"`
	SendTime     *string  `json:"sendTime,omitempty"`
	RoleFilter   []string `json:"roleFilter,omitempty"`
	Recipients   []string `json:"recipients,omitempty"`
	CcRecipients []string `json:"ccRecipients,omitempty"`
}

func (h *DotacionHandler) PatchNotificationSchedule(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	var req patchNotificationScheduleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	params := db.PatchNotificationScheduleParams{
		ID: id, Enabled: optionalBool(req.Enabled), Name: nonEmptyText(req.Name),
		RoleFilter: req.RoleFilter, Recipients: req.Recipients, CcRecipients: req.CcRecipients,
	}
	if req.Frequency != nil {
		if *req.Frequency != "weekly" && *req.Frequency != "monthly" {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "frequency debe ser weekly o monthly")
			return
		}
		params.Frequency = db.NullNotificationScheduleFrequency{NotificationScheduleFrequency: db.NotificationScheduleFrequency(*req.Frequency), Valid: true}
	}
	if req.DayOfWeek != nil {
		params.DayOfWeek = pgtype.Int4{Int32: *req.DayOfWeek, Valid: true}
	}
	if req.SendTime != nil {
		t, timeErr := parseTimeOfDay(*req.SendTime)
		if timeErr != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "sendTime debe tener formato HH:MM")
			return
		}
		params.SendTime = t
	}
	schedule, err := h.Queries.PatchNotificationSchedule(r.Context(), params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "notificación de dotación no encontrada")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la notificación de dotación")
		return
	}
	h.AuditLog.Log(r.Context(), "dotacion.notification_schedule.updated", audit.LevelInfo, audit.Success(), map[string]any{"scheduleId": schedule.ID.String()})
	writeData(w, http.StatusOK, toNotificationScheduleDTO(schedule))
}
