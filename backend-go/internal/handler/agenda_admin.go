package handler

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Administración → Agenda (spec/16 §4.3, "Calendario de días hábiles"):
// el horario hábil (días y horas, por defecto lunes a viernes de 08:00 a
// 20:00) y los feriados, que se importan por año desde la lista incluida en
// la app y se agregan o quitan a mano. Solo el admin.

type agendaHoliday struct {
	Date   string `json:"date"`
	Name   string `json:"name"`
	Source string `json:"source"`
}

// Settings: el horario hábil, los feriados de un año y los años que se pueden importar.
func (h *AgendaHandler) Settings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	s, err := h.Queries.GetAgendaSettings(ctx)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	year := h.now().Year()
	if y, err := strconv.Atoi(r.URL.Query().Get("year")); err == nil && y >= 2000 && y <= 2100 {
		year = y
	}
	rows, err := h.Queries.ListHolidaysBetween(ctx, db.ListHolidaysBetweenParams{
		FromDay: pgDate(time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)), ToDay: pgDate(time.Date(year, 12, 31, 0, 0, 0, 0, time.UTC))})
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	holidays := make([]agendaHoliday, 0, len(rows))
	for _, x := range rows {
		holidays = append(holidays, agendaHoliday{Date: agenda.FormatDate(x.Day.Time), Name: x.Name, Source: x.Source})
	}
	var importable []int
	for _, c := range agenda.HolidayCountries() {
		if strings.EqualFold(c.Country, s.HolidayCountry) {
			importable = c.Years
		}
	}
	if importable == nil {
		importable = []int{}
	}
	writeData(w, http.StatusOK, map[string]any{
		"workDays": s.WorkDays, "dayStart": s.DayStart, "dayEnd": s.DayEnd, "timezone": s.Timezone,
		"holidayCountry": s.HolidayCountry, "countries": agenda.HolidayCountries(), "importableYears": importable,
		"year": year, "holidays": holidays,
	})
}

func (h *AgendaHandler) PutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkDays []int32 `json:"workDays"`
		DayStart string  `json:"dayStart"`
		DayEnd   string  `json:"dayEnd"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	seen := map[int32]bool{}
	days := []int32{}
	for _, d := range req.WorkDays {
		if d < 0 || d > 6 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "día inválido (0 = domingo … 6 = sábado)")
			return
		}
		if !seen[d] {
			seen[d] = true
			days = append(days, d)
		}
	}
	sort.Slice(days, func(i, j int) bool { return days[i] < days[j] })
	start, err1 := agenda.ParseClock(req.DayStart)
	end, err2 := agenda.ParseClock(req.DayEnd)
	if len(days) == 0 || err1 != nil || err2 != nil || end.Hour*60+end.Minute <= start.Hour*60+start.Minute {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige al menos un día y un horario en que «hasta» sea después de «desde»")
		return
	}
	ctx := r.Context()
	if err := h.Queries.UpdateAgendaSettings(ctx, db.UpdateAgendaSettingsParams{WorkDays: days, DayStart: start.String(), DayEnd: end.String()}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.AuditLog.Log(ctx, "agenda.settings.updated", audit.LevelInfo, audit.Success(), map[string]any{
		"workDays": days, "dayStart": start.String(), "dayEnd": end.String()})
	if err := h.regenerateUntouched(r); err != nil {
		agendaFail(w, r, err)
		return
	}
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{})
	h.Settings(w, r)
}

func (h *AgendaHandler) PutHoliday(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Date string `json:"date"`
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	day, err := agenda.ParseDate(req.Date)
	req.Name = strings.TrimSpace(req.Name)
	if err != nil || req.Name == "" || len([]rune(req.Name)) > 120 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "fecha (YYYY-MM-DD) y nombre (hasta 120 caracteres)")
		return
	}
	ctx := r.Context()
	if err := h.Queries.UpsertHoliday(ctx, db.UpsertHolidayParams{Day: pgDate(day), Name: req.Name}); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.AuditLog.Log(ctx, "agenda.holiday.saved", audit.LevelInfo, audit.Success(), map[string]any{"date": req.Date, "name": req.Name})
	h.afterHolidays(w, r, day.Year())
}

func (h *AgendaHandler) DeleteHoliday(w http.ResponseWriter, r *http.Request) {
	day, err := agenda.ParseDate(r.PathValue("date"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-id", "fecha inválida")
		return
	}
	ctx := r.Context()
	if _, err := h.Queries.DeleteHoliday(ctx, pgDate(day)); err != nil {
		agendaFail(w, r, err)
		return
	}
	h.AuditLog.Log(ctx, "agenda.holiday.deleted", audit.LevelInfo, audit.Success(), map[string]any{"date": agenda.FormatDate(day)})
	h.afterHolidays(w, r, day.Year())
}

// ImportHolidays carga los feriados de un año desde la lista incluida (no
// pisa los que el admin ya cargó a mano).
func (h *AgendaHandler) ImportHolidays(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Year int `json:"year"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	ctx := r.Context()
	s, err := h.Queries.GetAgendaSettings(ctx)
	if err != nil {
		agendaFail(w, r, err)
		return
	}
	list := agenda.HolidaysFor(s.HolidayCountry, strconv.Itoa(req.Year))
	if list == nil {
		problemdetails.Write(w, r, http.StatusNotFound, "holidays-not-available", "la app no trae los feriados de ese año: agrégalos a mano")
		return
	}
	added := int64(0)
	for _, x := range list {
		day, err := agenda.ParseDate(x.Date)
		if err != nil {
			continue
		}
		n, err := h.Queries.ImportHoliday(ctx, db.ImportHolidayParams{Day: pgDate(day), Name: x.Name})
		if err != nil {
			agendaFail(w, r, err)
			return
		}
		added += n
	}
	h.AuditLog.Log(ctx, "agenda.holidays.imported", audit.LevelInfo, audit.Success(), map[string]any{
		"country": s.HolidayCountry, "year": req.Year, "added": added})
	h.afterHolidays(w, r, req.Year)
}

func (h *AgendaHandler) afterHolidays(w http.ResponseWriter, r *http.Request, year int) {
	// Los feriados mueven fechas: se rehacen las ocurrencias que nadie empezó.
	ctx := r.Context()
	if err := h.regenerateUntouched(r); err != nil {
		agendaFail(w, r, err)
		return
	}
	publishSync(ctx, h.Hub, "agenda.changed", map[string]string{})
	q := r.URL.Query()
	q.Set("year", strconv.Itoa(year))
	r.URL.RawQuery = q.Encode()
	h.Settings(w, r)
}

// regenerateUntouched rehace las ocurrencias pendientes que nadie empezó
// (al cambiar feriados o días hábiles cambian las fechas).
func (h *AgendaHandler) regenerateUntouched(r *http.Request) error {
	ctx := r.Context()
	tasks, err := h.Queries.ListAgendaTasks(ctx, false)
	if err != nil {
		return err
	}
	ac, err := loadAgendaCal(ctx, h.Queries, h.now(), h.now())
	if err != nil {
		return err
	}
	today := agenda.Day(h.now(), ac.loc)
	for _, t := range tasks {
		if _, err := h.Queries.DeleteFutureUntouchedOccurrences(ctx, db.DeleteFutureUntouchedOccurrencesParams{TaskID: t.ID, FromDay: pgDate(today), KeepTaken: true}); err != nil {
			return err
		}
	}
	return h.generate(ctx, true)
}
