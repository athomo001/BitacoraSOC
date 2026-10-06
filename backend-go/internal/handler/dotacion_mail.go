package handler

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// Estado de la grilla del legacy por cada condición de la matriz de dotación
// (oficina y guardia quedan como celda vacía).
var outOfOfficeStatus = map[string]string{
	"telework":            "telework",
	"training":            "training",
	"vacation":            "vacation",
	"medical_leave":       "medical-leave",
	"medical_appointment": "medical-appointment",
}

// dotacionRoleCode es el código del legacy (roleFilter, badge del correo en
// lista) de cada condición de la matriz de dotación.
var dotacionRoleCode = map[string]string{
	"telework":            "TELEWORK",
	"training":            "OL",
	"vacation":            "VACATION",
	"medical_leave":       "MEDICAL_LEAVE",
	"medical_appointment": "MEDICAL_APPOINTMENT",
}

// guardRoleCodes son INTERNAL_SHIFT_ROLE_CODES del legacy: lo que trae el
// correo en lista si la notificación no filtra nada.
var guardRoleCodes = []string{"N1_NO_HABIL", "N2", "TI"}

// guardRoleOrder es SHIFT_ROLE_ORDER del legacy (el resto va después).
var guardRoleOrder = map[string]int{"N1_NO_HABIL": 1, "N2": 2, "TI": 3}

// scheduleLogoCID es el CID del logo en los correos de dotación del legacy.
const scheduleLogoCID = "bitacora_escalation_logo@bitacora"

var monthNamesEs = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// schedulePeriod es el rango de sendEscalationScheduleInternal del legacy:
// semanal = lunes de esta semana (o la siguiente con next_week); mensual =
// el mes calendario actual.
func schedulePeriod(schedule db.WorkShiftNotificationSchedule, now time.Time) (time.Time, string) {
	if schedule.Frequency == db.NotificationScheduleFrequencyMonthly {
		first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return first, fmt.Sprintf("Periodo Mensual: %s de %d", monthNamesEs[now.Month()-1], now.Year())
	}
	monday := mondayOf(now)
	if schedule.TargetPeriod == "next_week" {
		monday = monday.AddDate(0, 0, 7)
	}
	return monday, "Periodo Semanal: " + monday.Format("02-01-2006") + " - " + monday.AddDate(0, 0, 6).Format("02-01-2006")
}

// dotacionMail es un correo de dotación listo para enviar.
type dotacionMail struct {
	subject, html string
	inline        []mail.Inline
}

// buildDotacionMail arma el correo de la notificación en su formato: lista
// (turnos de guardia y condiciones) o calendario (grilla Lun–Vie), con el
// logo de la marca en línea como el legacy.
func (h *DotacionHandler) buildDotacionMail(ctx context.Context, schedule db.WorkShiftNotificationSchedule) (dotacionMail, error) {
	brand := branding.Load(ctx, h.Queries, true)
	var logoSrc string
	var inline []mail.Inline
	if len(brand.Logo) > 0 {
		logoSrc = "cid:" + scheduleLogoCID
		inline = append(inline, mail.Inline{CID: scheduleLogoCID, Name: "logo-escalation" + logoExtension(brand.LogoType), ContentType: brand.LogoType, Data: brand.Logo})
	}
	var m dotacionMail
	var err error
	if schedule.EmailFormat == "list" {
		m, err = h.buildScheduleListMail(ctx, schedule, brand.AppTitle, logoSrc)
	} else {
		m, err = h.buildOutOfOfficeMail(ctx, schedule, brand.AppTitle, logoSrc)
	}
	m.inline = inline
	return m, err
}

func logoExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	}
	return ".png"
}

// buildOutOfOfficeMail arma el correo "Personal Fuera de la Oficina" del
// legacy: cinco días desde el inicio del periodo, todas las personas activas
// (sin invitados ni auditores), primero quienes tienen novedades. Como en el
// legacy, el filtro de condiciones de la notificación no aplica acá.
func (h *DotacionHandler) buildOutOfOfficeMail(ctx context.Context, schedule db.WorkShiftNotificationSchedule, brand, logoSrc string) (dotacionMail, error) {
	now := h.now()
	start, periodLabel := schedulePeriod(schedule, now)
	end := start.AddDate(0, 0, 4)
	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{Active: pgtype.Bool{Bool: true, Valid: true}})
	if err != nil {
		return dotacionMail{}, err
	}
	assignments, err := h.Queries.ListAssignmentsForRange(ctx, db.ListAssignmentsForRangeParams{
		FromDate: pgtype.Date{Time: start, Valid: true}, ToDate: pgtype.Date{Time: end, Valid: true},
	})
	if err != nil {
		return dotacionMail{}, err
	}
	condition := map[string]string{}
	for _, a := range assignments {
		condition[a.UserID.String()+a.AssignedDate.Time.Format("2006-01-02")] = string(a.Condition)
	}
	opts := mailtpl.OutOfOfficeOptions{PeriodLabel: periodLabel, BrandName: brand, LogoSrc: logoSrc, Year: now.Year()}
	opts.Title = strings.TrimSpace(schedule.Name)
	if opts.Title == "" {
		opts.Title = "Personal Fuera de la Oficina y Apoyo"
	}
	var days []time.Time
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		days = append(days, d)
		opts.Columns = append(opts.Columns, mailtpl.OutOfOfficeColumn{DayShort: weekdayShortEs[d.Weekday()], DateShort: d.Format("02/01")})
	}
	type row struct {
		mailtpl.OutOfOfficeRow
		special bool
	}
	var rows []row
	for _, u := range users {
		if u.Role == db.UserRoleGuest || u.Role == db.UserRoleAuditor {
			continue
		}
		name := strings.TrimSpace(u.FullName.String)
		if name == "" {
			name = "Sin asignar"
		}
		r := row{OutOfOfficeRow: mailtpl.OutOfOfficeRow{Name: name, CargoLabel: strings.TrimSpace(u.CargoLabel.String)}}
		for _, d := range days {
			status, ok := outOfOfficeStatus[condition[u.ID.String()+d.Format("2006-01-02")]]
			if !ok {
				status = "office"
			} else {
				r.special = true
			}
			r.Days = append(r.Days, status)
		}
		rows = append(rows, r)
	}
	spanish := collate.New(language.Spanish)
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].special != rows[j].special {
			return rows[i].special
		}
		return spanish.CompareString(rows[i].Name, rows[j].Name) < 0
	})
	for _, r := range rows {
		opts.Rows = append(opts.Rows, r.OutOfOfficeRow)
	}
	html, err := mailtpl.RenderOutOfOffice(opts)
	if err != nil {
		return dotacionMail{}, err
	}
	return dotacionMail{subject: "[" + brand + "] " + opts.Title + " - " + periodLabel, html: html}, nil
}

// scheduleCategories es la etiqueta de la cabecera del correo en lista
// (categoriesLabel del legacy), según lo que filtra la notificación.
func scheduleCategories(roleFilter []string) string {
	has := map[string]bool{}
	for _, r := range roleFilter {
		has[r] = true
	}
	var out []string
	if has["N2"] || has["TI"] || has["N1_NO_HABIL"] {
		out = append(out, "GUARDIA")
	}
	for _, c := range []struct{ code, label string }{
		{"TELEWORK", "TELETRABAJO"}, {"OL", "CHARLA/CAPACITACIÓN"}, {"VACATION", "VACACIONES"},
		{"MEDICAL_LEAVE", "LICENCIA MÉDICA"}, {"MEDICAL_APPOINTMENT", "TRÁMITE MÉDICO"},
	} {
		if has[c.code] {
			out = append(out, c.label)
		}
	}
	if len(out) == 0 {
		return "CALENDARIO"
	}
	return strings.Join(out, " / ")
}

// listPeriod es el rango del correo en lista: la semana operativa del legacy
// (lunes 09:00 al lunes siguiente 08:59) o el mes calendario.
func listPeriod(schedule db.WorkShiftNotificationSchedule, now time.Time) (time.Time, time.Time) {
	start, _ := schedulePeriod(schedule, now)
	if schedule.Frequency == db.NotificationScheduleFrequencyMonthly {
		return start, start.AddDate(0, 1, 0).Add(-time.Second)
	}
	start = start.Add(9 * time.Hour)
	return start, start.AddDate(0, 0, 7).Add(-time.Millisecond)
}

// buildScheduleListMail es sendEscalationScheduleInternal del legacy en
// formato lista: las guardias semanales (equipos "Guardia N2", "Guardia TI"…)
// y las condiciones de la matriz de dotación que pide la notificación, con
// quien esté de vacaciones o con licencia fuera de las guardias.
func (h *DotacionHandler) buildScheduleListMail(ctx context.Context, schedule db.WorkShiftNotificationSchedule, brand, logoSrc string) (dotacionMail, error) {
	now := h.now()
	loc := now.Location()
	start, end := listPeriod(schedule, now)
	_, periodLabel := schedulePeriod(schedule, now)
	var filter []string
	for _, r := range schedule.RoleFilter {
		if code := strings.ToUpper(strings.TrimSpace(r)); code != "" {
			filter = append(filter, code)
		}
	}
	target := map[string]bool{}
	for _, code := range filter {
		target[code] = true
	}
	if len(filter) == 0 {
		for _, code := range guardRoleCodes {
			target[code] = true
		}
	}

	type entry struct {
		mailtpl.ScheduleEntry
		userID string
	}
	var entries []entry

	// Condiciones de la matriz (un día por fila en la 2.0): días seguidos de la
	// misma persona y condición van en una sola fila, 09:00 a 18:00.
	assignments, err := h.Queries.ListAssignmentsForRange(ctx, db.ListAssignmentsForRangeParams{
		FromDate: pgtype.Date{Time: start, Valid: true}, ToDate: pgtype.Date{Time: end, Valid: true},
	})
	if err != nil {
		return dotacionMail{}, err
	}
	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{})
	if err != nil {
		return dotacionMail{}, err
	}
	userByID := map[string]db.User{}
	for _, u := range users {
		userByID[u.ID.String()] = u
	}
	absent := map[string]bool{}
	sort.SliceStable(assignments, func(i, j int) bool {
		if assignments[i].UserID != assignments[j].UserID {
			return assignments[i].UserID.String() < assignments[j].UserID.String()
		}
		return assignments[i].AssignedDate.Time.Before(assignments[j].AssignedDate.Time)
	})
	var open *entry
	var openLast time.Time
	flush := func() {
		if open != nil {
			entries = append(entries, *open)
			open = nil
		}
	}
	for _, a := range assignments {
		cond := string(a.Condition)
		if cond == "vacation" || cond == "medical_leave" {
			absent[a.UserID.String()] = true
		}
		code, ok := dotacionRoleCode[cond]
		if !ok || !target[code] {
			continue
		}
		day := a.AssignedDate.Time
		dayLocal := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
		if open != nil && open.userID == a.UserID.String() && open.RoleCode == code && dayLocal.Equal(openLast.AddDate(0, 0, 1)) {
			open.End = dayLocal.Add(18 * time.Hour)
			openLast = dayLocal
			continue
		}
		flush()
		u := userByID[a.UserID.String()]
		name := strings.TrimSpace(u.FullName.String)
		if name == "" {
			name = "Pendiente"
		}
		cargo := strings.TrimSpace(u.CargoLabel.String)
		if cargo == "" {
			cargo = code
		}
		open = &entry{ScheduleEntry: mailtpl.ScheduleEntry{AnalystName: name, CargoLabel: cargo, RoleCode: code,
			Start: dayLocal.Add(9 * time.Hour), End: dayLocal.Add(18 * time.Hour)}, userID: a.UserID.String()}
		openLast = dayLocal
	}
	flush()

	// Guardias semanales; las de alguien ausente salen, salvo que el aviso
	// sea justamente de vacaciones y licencias (como el legacy).
	slots, err := h.Queries.ListGuardSlotsForRange(ctx, db.ListGuardSlotsForRangeParams{
		FromDate: pgtype.Date{Time: start, Valid: true}, ToDate: pgtype.Date{Time: end, Valid: true},
	})
	if err != nil {
		return dotacionMail{}, err
	}
	keepAbsent := target["VACATION"] && target["MEDICAL_LEAVE"]
	for _, s := range slots {
		code := strings.ToUpper(strings.TrimSpace(strings.TrimPrefix(s.TeamName, "Guardia ")))
		if !target[code] {
			continue
		}
		userID := ""
		if s.UserID.Valid {
			userID = uuid.UUID(s.UserID.Bytes).String()
		}
		if userID != "" && absent[userID] && !keepAbsent {
			continue
		}
		cargo := s.CargoLabel
		if cargo == "" {
			cargo = code
		}
		tz, err := time.LoadLocation(s.Timezone)
		if err != nil {
			tz = loc
		}
		at := func(d pgtype.Date) time.Time {
			clock := time.Duration(s.StartTimeUtc.Microseconds) * time.Microsecond
			utc := time.Date(d.Time.Year(), d.Time.Month(), d.Time.Day(), 0, 0, 0, 0, time.UTC).Add(clock)
			return utc.In(tz)
		}
		entries = append(entries, entry{ScheduleEntry: mailtpl.ScheduleEntry{AnalystName: s.PersonName, CargoLabel: cargo, RoleCode: code,
			Start: at(s.WeekStartDate), End: at(s.WeekEndDate).Add(-time.Minute)}, userID: userID})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		oi, oj := guardRoleOrder[entries[i].RoleCode], guardRoleOrder[entries[j].RoleCode]
		if oi == 0 {
			oi = 99
		}
		if oj == 0 {
			oj = 99
		}
		if oi != oj {
			return oi < oj
		}
		return entries[i].Start.Before(entries[j].Start)
	})
	opts := mailtpl.ScheduleListOptions{PeriodLabel: periodLabel, LogoSrc: logoSrc, BrandName: brand, Categories: scheduleCategories(filter), Year: now.Year(), Location: loc}
	opts.Title = strings.TrimSpace(schedule.Name)
	if opts.Title == "" {
		opts.Title = "Turnos de Escalamiento SOC"
	}
	for _, e := range entries {
		opts.Entries = append(opts.Entries, e.ScheduleEntry)
	}
	if len(opts.Entries) == 0 {
		opts.Entries = []mailtpl.ScheduleEntry{{AnalystName: "Sin asignaciones", CargoLabel: "-", Start: start, End: end}}
	}
	html, err := mailtpl.RenderScheduleList(opts)
	if err != nil {
		return dotacionMail{}, err
	}
	return dotacionMail{subject: "[" + brand + "] " + opts.Title + " - " + periodLabel, html: html}, nil
}
