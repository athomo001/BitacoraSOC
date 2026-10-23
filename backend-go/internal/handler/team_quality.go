package handler

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/quality"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Mi equipo → Calidad (10f, decisiones del dueño 2026-10-22): el puntaje de
// calidad de registro de cada persona del área, con el desglose regla por
// regla y ejemplos de sus entradas. La ven la jefatura (sus áreas), el admin
// y el auditor (todas), solo en las áreas que usan la Bitácora (perfil
// Operativo). El cálculo vive en internal/quality.

// qualityPeriods: los períodos del legacy, en días hasta hoy.
var qualityPeriods = map[int]bool{7: true, 15: true, 30: true}

type areaPersonRow struct {
	ID    uuid.UUID
	Name  string
	Level string
}

// areaPeople: la gente activa del área, una fila por persona con su nivel de
// más rango en ella, por nombre.
func (h *TeamHandler) areaPeople(ctx context.Context, areaID uuid.UUID) ([]areaPersonRow, error) {
	rows, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		return nil, err
	}
	levels, err := h.Queries.ListLevels(ctx)
	if err != nil {
		return nil, err
	}
	levelName := map[uuid.UUID]string{}
	for _, l := range levels {
		levelName[l.ID] = l.Name
	}
	var out []areaPersonRow
	seen := map[uuid.UUID]int{}
	rank := map[uuid.UUID]int32{}
	for _, p := range rows {
		if p.AreaID != areaID {
			continue
		}
		lvl := ""
		if p.LevelID.Valid {
			lvl = levelName[uuid.UUID(p.LevelID.Bytes)]
		}
		if i, ok := seen[p.UserID]; ok {
			if p.LevelRank > rank[p.UserID] {
				out[i].Level, rank[p.UserID] = lvl, p.LevelRank
			}
			continue
		}
		seen[p.UserID], rank[p.UserID] = len(out), p.LevelRank
		out = append(out, areaPersonRow{ID: p.UserID, Name: p.Name, Level: lvl})
	}
	return out, nil
}

// qualityAreas: el código de las áreas que usan la Bitácora.
func (h *TeamHandler) qualityAreas(ctx context.Context) (map[string]bool, error) {
	rows, err := h.Queries.ListAreaProfiles(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, r := range rows {
		out[r.Code] = r.DefaultProfile == "operativo"
	}
	return out, nil
}

// visibleAreas: las áreas que el usuario ve en Mi equipo y si es jefatura de
// cada una. El auditor ve todas, solo para la Calidad.
func (h *TeamHandler) visibleAreas(ctx context.Context, user middleware.AuthenticatedUser) ([]db.ListLeadAreasRow, map[string]bool, error) {
	lead := map[string]bool{}
	areas, err := h.leadAreas(ctx, user)
	if err != nil {
		return nil, nil, err
	}
	for _, a := range areas {
		lead[a.Code] = true
	}
	if user.Role != "auditor" {
		return areas, lead, nil
	}
	all, err := h.Queries.ListActiveAreas(ctx)
	if err != nil {
		return nil, nil, err
	}
	out := make([]db.ListLeadAreasRow, 0, len(all))
	for _, a := range all {
		out = append(out, db.ListLeadAreasRow(a))
	}
	return out, lead, nil
}

type qualityAbsenceDTO struct {
	Kind string `json:"kind"` // vacation | medical_leave
	Days int    `json:"days"`
}

type qualityPersonDTO struct {
	ID      uuid.UUID          `json:"id"`
	Name    string             `json:"name"`
	Level   string             `json:"level"`
	Absence *qualityAbsenceDTO `json:"absence"`
	quality.Result
}

type qualityDataDTO struct {
	AreaCode string `json:"areaCode"`
	AreaName string `json:"areaName"`
	// Days: 7, 15 o 30; 0 si se pidió un mes (Month, YYYY-MM).
	Days       int                `json:"days"`
	Month      string             `json:"month,omitempty"`
	From       string             `json:"from"`
	To         string             `json:"to"`
	MinEntries int                `json:"minEntries"`
	People     []qualityPersonDTO `json:"people"`
}

// shiftSpan: la duración planificada de un turno (los de noche cruzan la medianoche).
func shiftSpan(start, end pgtype.Time) time.Duration {
	if !start.Valid || !end.Valid {
		return 0
	}
	d := time.Duration(end.Microseconds-start.Microseconds) * time.Microsecond
	if d <= 0 {
		d += 24 * time.Hour
	}
	return d
}

func pgUUIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}

// Quality es GET /api/team/quality?area=CODE&days=7|15|30 o &month=YYYY-MM.
func (h *TeamHandler) Quality(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	if dep := q.Get("department"); dep != "" {
		h.qualityDepartment(w, r, dep)
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	areas, _, err := h.visibleAreas(ctx, user)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return
	}
	var area db.ListLeadAreasRow
	for _, a := range areas {
		if a.Code == q.Get("area") {
			area = a
		}
	}
	if area.Code == "" {
		problemdetails.Write(w, r, http.StatusForbidden, "not-area-lead", "no eres jefatura de esa área")
		return
	}
	operativo, err := h.qualityAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	if !operativo[area.Code] {
		problemdetails.Write(w, r, http.StatusNotFound, "not-quality-area", "esa área no usa la Bitácora")
		return
	}
	p, err := h.qualityPeriod(q.Get("days"), q.Get("month"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", err.Error())
		return
	}
	d, err := h.quality(ctx, area, p)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular la calidad")
		return
	}
	writeData(w, http.StatusOK, d)
}

// qualityRange: el período pedido, de fromAt (incluido) a toAt (excluido).
type qualityRange struct {
	days         int
	month        string
	fromAt, toAt time.Time
}

// qualityPeriod: los últimos 7, 15 o 30 días (hoy incluido) o un mes
// (YYYY-MM, hasta hoy si es el actual). Sin nada, los últimos 30 días.
func (h *TeamHandler) qualityPeriod(daysParam, monthParam string) (qualityRange, error) {
	loc := teamLocation()
	y, m, d := h.now().In(loc).Date()
	tomorrow := time.Date(y, m, d+1, 0, 0, 0, 0, loc)
	if monthParam != "" {
		mo, err := time.Parse("2006-01", monthParam)
		if err != nil {
			return qualityRange{}, errors.New("el mes es YYYY-MM")
		}
		from := time.Date(mo.Year(), mo.Month(), 1, 0, 0, 0, 0, loc)
		if !from.Before(tomorrow) {
			return qualityRange{}, errors.New("ese mes todavía no empieza")
		}
		to := from.AddDate(0, 1, 0)
		if to.After(tomorrow) {
			to = tomorrow
		}
		return qualityRange{month: monthParam, fromAt: from, toAt: to}, nil
	}
	days := 30
	if daysParam != "" {
		days, _ = strconv.Atoi(daysParam)
	}
	if !qualityPeriods[days] {
		return qualityRange{}, errors.New("el período es de 7, 15 o 30 días, o un mes")
	}
	return qualityRange{days: days, fromAt: time.Date(y, m, d-days+1, 0, 0, 0, 0, loc), toAt: tomorrow}, nil
}

// qualityDepartment: la Calidad del departamento, la gente de sus áreas que
// usan la Bitácora (cada persona una vez). La ven su jefatura y el auditor.
func (h *TeamHandler) qualityDepartment(w http.ResponseWriter, r *http.Request, raw string) {
	ctx := r.Context()
	_, dep, areas, ok := h.departmentScope(w, r, raw, false)
	if !ok {
		return
	}
	if !dep.Quality {
		problemdetails.Write(w, r, http.StatusNotFound, "not-quality-area", "ese departamento no usa la Bitácora")
		return
	}
	period, err := h.qualityPeriod(r.URL.Query().Get("days"), r.URL.Query().Get("month"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", err.Error())
		return
	}
	operativo, err := h.qualityAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	seen := map[uuid.UUID]bool{}
	var people []areaPersonRow
	for _, a := range areas {
		if !operativo[a.Code] {
			continue
		}
		rows, err := h.areaPeople(ctx, a.ID)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular la calidad")
			return
		}
		for _, p := range rows {
			if !seen[p.ID] {
				seen[p.ID] = true
				people = append(people, p)
			}
		}
	}
	d, err := h.qualityOf(ctx, "", dep.Name, people, period)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular la calidad")
		return
	}
	writeData(w, http.StatusOK, d)
}

// quality calcula el puntaje de la gente del área en el período.
func (h *TeamHandler) quality(ctx context.Context, area db.ListLeadAreasRow, period qualityRange) (qualityDataDTO, error) {
	people, err := h.areaPeople(ctx, area.ID)
	if err != nil {
		return qualityDataDTO{}, err
	}
	return h.qualityOf(ctx, area.Code, area.Name, people, period)
}

// qualityOf calcula el puntaje de esas personas en el período.
func (h *TeamHandler) qualityOf(ctx context.Context, code, name string, people []areaPersonRow, period qualityRange) (qualityDataDTO, error) {
	loc := teamLocation()
	fromAt, toAt := period.fromAt, period.toAt
	out := qualityDataDTO{AreaCode: code, AreaName: name, Days: period.days, Month: period.month, MinEntries: quality.MinEntries,
		From: fromAt.Format("2006-01-02"), To: toAt.AddDate(0, 0, -1).Format("2006-01-02"), People: []qualityPersonDTO{}}
	if len(people) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, 0, len(people))
	for _, p := range people {
		ids = append(ids, p.ID)
	}
	results, err := h.evaluatePeople(ctx, ids, fromAt, toAt)
	if err != nil {
		return out, err
	}
	abs, err := h.Queries.ListQualityAbsences(ctx, db.ListQualityAbsencesParams{FromDay: pgDate(agenda.Day(fromAt, loc)), ToDay: pgDate(agenda.Day(toAt.Add(-time.Hour), loc))})
	if err != nil {
		return out, err
	}
	absence := map[uuid.UUID]*qualityAbsenceDTO{}
	for _, a := range abs {
		// La que más días suma da el nombre; los días son los de ambas.
		cur := absence[a.UserID]
		if cur == nil {
			absence[a.UserID] = &qualityAbsenceDTO{Kind: a.Condition, Days: int(a.Days)}
			continue
		}
		if int(a.Days) > cur.Days {
			cur.Kind = a.Condition
		}
		cur.Days += int(a.Days)
	}
	for _, p := range people {
		out.People = append(out.People, qualityPersonDTO{ID: p.ID, Name: p.Name, Level: p.Level, Absence: absence[p.ID],
			Result: results[p.ID]})
	}
	sort.SliceStable(out.People, func(i, j int) bool { return out.People[i].Name < out.People[j].Name })
	return out, nil
}

// evaluatePeople: el puntaje de calidad de cada persona entre fromAt y toAt
// (también lo usa el Resumen mensual).
func (h *TeamHandler) evaluatePeople(ctx context.Context, ids []uuid.UUID, fromAt, toAt time.Time) (map[uuid.UUID]quality.Result, error) {
	entries, err := h.Queries.ListQualityEntries(ctx, db.ListQualityEntriesParams{UserIds: ids, FromAt: pgTime(fromAt), ToAt: pgTime(toAt)})
	if err != nil {
		return nil, err
	}
	checks, err := h.Queries.ListQualityChecks(ctx, db.ListQualityChecksParams{UserIds: ids, FromAt: pgTime(fromAt), ToAt: pgTime(toAt)})
	if err != nil {
		return nil, err
	}
	byUser := map[uuid.UUID][]quality.Entry{}
	for _, e := range entries {
		byUser[e.UserID] = append(byUser[e.UserID], quality.Entry{Type: e.EntryType, Content: e.Content, Tags: e.Tags, At: e.CreatedAt.Time,
			Ticket: pgUUIDString(e.TicketID), Service: pgUUIDString(e.ServiceID), Asset: e.AssetID.Valid})
	}
	checksBy := map[uuid.UUID][]quality.Check{}
	for _, c := range checks {
		checksBy[c.UserID] = append(checksBy[c.UserID], quality.Check{At: c.CheckDate.Time, Start: c.CheckType == "inicio",
			Shift: c.ShiftName, Span: shiftSpan(c.StartTime, c.EndTime)})
	}
	out := make(map[uuid.UUID]quality.Result, len(ids))
	for _, id := range ids {
		out[id] = quality.Evaluate(byUser[id], checksBy[id])
	}
	return out, nil
}
