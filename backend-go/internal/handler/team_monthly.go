package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/quality"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Resumen mensual de la jefatura (spec/16 §6.1, 9.7, 000044, diseño aprobado
// por el dueño 2026-10-15). Se revisa en Mi equipo; no llega solo por correo.
// La jefatura lo envía a quien quiera o lo descarga en PDF. Indicadores fijos
// por persona y total del área: tareas a tiempo, atrasos que quedaron
// abiertos, omitidas, tickets resueltos dentro del SLA y días ausente.
//
// El mes se congela (decisión del dueño): el primer día hábil del mes
// siguiente, a la hora de inicio de la Agenda, se guarda la foto y lo enviado
// ya no cambia aunque alguien reabra una tarea vieja.

type monthlyPersonDTO struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Level      string    `json:"level"`
	Tasks      int       `json:"tasks"`
	OnTime     int       `json:"onTime"`
	DoneLate   int       `json:"doneLate"`
	OpenLate   int       `json:"openLate"`
	Skipped    int       `json:"skipped"`
	Tickets    int       `json:"tickets"`
	TicketsSLA int       `json:"ticketsSla"`
	AbsentDays int       `json:"absentDays"`
	// GoalsDone: metas propias cumplidas en el mes (las del bono, confirmadas; 9.4).
	GoalsDone int `json:"goalsDone"`
	// Entries y Quality: entradas en la Bitácora y puntaje de calidad del mes
	// (10f), en las áreas que usan la Bitácora. Quality -1 = sin evaluar; en
	// el total, el promedio de los evaluados.
	Entries int `json:"entries"`
	Quality int `json:"quality"`
}

// monthlyVersion: la versión del resumen. Una foto congelada con una versión
// anterior se rehace al abrirla (la 2 suma la Bitácora, 10f; la 3 guarda
// quiénes eran del área).
const monthlyVersion = 3

// onTimePct: como en Gestión, hechas a tiempo sobre hechas más atrasadas
// abiertas (las omitidas no cuentan). -1 = sin datos.
func (p monthlyPersonDTO) onTimePct() int {
	if den := p.OnTime + p.DoneLate + p.OpenLate; den > 0 {
		return p.OnTime * 100 / den
	}
	return -1
}

func (p monthlyPersonDTO) slaPct() int {
	if p.Tickets > 0 {
		return p.TicketsSLA * 100 / p.Tickets
	}
	return -1
}

type monthlyDataDTO struct {
	Month    string             `json:"month"`
	AreaCode string             `json:"areaCode"`
	AreaName string             `json:"areaName"`
	BizDays  int                `json:"bizDays"`
	People   []monthlyPersonDTO `json:"people"`
	Total    monthlyPersonDTO   `json:"total"`
	// ComputedAt: cuándo se calculó (la foto, en un mes cerrado).
	ComputedAt time.Time `json:"computedAt"`
	Version    int       `json:"version"`
	// Members: quiénes eran del área al sacar la foto. Si la gente del área
	// cambia (alguien entra o sale), la foto se rehace al abrirla para que
	// aparezca el historial de quien entró (decisión del dueño 2026-10-22).
	Members []uuid.UUID `json:"members"`
}

// sameMembers: la foto es de la misma gente que hoy está en el área.
func sameMembers(snapshot []uuid.UUID, people []areaPersonRow) bool {
	if len(snapshot) != len(people) {
		return false
	}
	in := make(map[uuid.UUID]bool, len(snapshot))
	for _, id := range snapshot {
		in[id] = true
	}
	for _, p := range people {
		if !in[p.ID] {
			return false
		}
	}
	return true
}

type monthlyInput struct {
	month    time.Time // primer día, medianoche UTC
	loc      *time.Location
	dayEnd   agenda.Clock
	cal      agenda.Calendar
	now      time.Time
	people   []monthlyPersonDTO // la gente del área (nombre y nivel)
	names    map[uuid.UUID]string
	occs     []db.ListMonthOccurrencesRow
	tickets  []db.ListMonthResolvedTicketsRow
	absences map[uuid.UUID]int
	goals    map[uuid.UUID]int
	// quality: el puntaje del mes por persona (nil si el área no usa la Bitácora).
	quality    map[uuid.UUID]quality.Result
	areaCode   string
	areaName   string
	computedAt time.Time
}

// computeMonthly arma el resumen de un mes (sin DB, para probarlo).
func computeMonthly(in monthlyInput) monthlyDataDTO {
	last := in.month.AddDate(0, 1, -1)
	monthEnd := time.Date(last.Year(), last.Month(), last.Day(), 0, 0, 0, 0, in.loc).AddDate(0, 0, 1)
	cut := monthEnd
	if in.now.Before(cut) {
		cut = in.now
	}
	byID := map[uuid.UUID]*monthlyPersonDTO{}
	order := []uuid.UUID{}
	for i := range in.people {
		p := in.people[i]
		byID[p.ID] = &p
		order = append(order, p.ID)
	}
	get := func(id uuid.UUID) *monthlyPersonDTO {
		if p, ok := byID[id]; ok {
			return p
		}
		name := in.names[id]
		if name == "" {
			name = "Persona sin nombre"
		}
		p := &monthlyPersonDTO{ID: id, Name: name}
		byID[id] = p
		order = append(order, id)
		return p
	}
	total := monthlyPersonDTO{Name: "Total " + in.areaName}
	add := func(p *monthlyPersonDTO, f func(*monthlyPersonDTO)) {
		f(&total)
		if p != nil {
			f(p)
		}
	}
	for _, o := range in.occs {
		var p *monthlyPersonDTO
		if o.UserID.Valid {
			p = get(uuid.UUID(o.UserID.Bytes))
		}
		dueAt := in.dayEnd.At(o.DueDate.Time, in.loc)
		closedInMonth := o.ClosedAt.Valid && o.ClosedAt.Time.Before(monthEnd)
		add(p, func(x *monthlyPersonDTO) { x.Tasks++ })
		switch {
		case o.Status == "skipped" && closedInMonth:
			add(p, func(x *monthlyPersonDTO) { x.Skipped++ })
		case o.Status == "done" && closedInMonth && !o.ClosedAt.Time.After(dueAt):
			add(p, func(x *monthlyPersonDTO) { x.OnTime++ })
		case o.Status == "done" && closedInMonth:
			add(p, func(x *monthlyPersonDTO) { x.DoneLate++ })
		case dueAt.Before(cut):
			// Sin cerrar al terminar el mes (o hasta hoy, en el mes en curso).
			add(p, func(x *monthlyPersonDTO) { x.OpenLate++ })
		}
	}
	for _, t := range in.tickets {
		var p *monthlyPersonDTO
		if t.AssignedUserID.Valid {
			p = get(uuid.UUID(t.AssignedUserID.Bytes))
		}
		inSLA := !t.SlaDueAt.Valid || !t.ResolvedAt.Time.After(t.SlaDueAt.Time)
		add(p, func(x *monthlyPersonDTO) {
			x.Tickets++
			if inSLA {
				x.TicketsSLA++
			}
		})
	}
	for id, days := range in.absences {
		if p, ok := byID[id]; ok {
			p.AbsentDays = days
			total.AbsentDays += days
		}
	}
	// Las metas cuentan para la gente del área (no suman a alguien de otra).
	for id, n := range in.goals {
		if p, ok := byID[id]; ok {
			p.GoalsDone = n
			total.GoalsDone += n
		}
	}
	addQuality(byID, &total, in.quality)
	out := monthlyDataDTO{Month: in.month.Format("2006-01"), AreaCode: in.areaCode, AreaName: in.areaName, Total: total,
		People: make([]monthlyPersonDTO, 0, len(order)), ComputedAt: in.computedAt, Version: monthlyVersion}
	for _, id := range order {
		out.People = append(out.People, *byID[id])
	}
	for d := in.month; !d.After(last); d = d.AddDate(0, 0, 1) {
		if in.cal.IsBusiness(d) {
			out.BizDays++
		}
	}
	return out
}

// addQuality pone las entradas y el puntaje de cada persona del área; el
// total suma las entradas y promedia los puntajes evaluados.
func addQuality(byID map[uuid.UUID]*monthlyPersonDTO, total *monthlyPersonDTO, results map[uuid.UUID]quality.Result) {
	total.Quality = -1
	sum, n := 0, 0
	for _, p := range byID {
		p.Quality = -1
		r, ok := results[p.ID]
		if !ok {
			continue
		}
		p.Entries = r.Entries
		total.Entries += r.Entries
		if r.Evaluated {
			p.Quality = r.Score
			sum += r.Score
			n++
		}
	}
	if n > 0 {
		total.Quality = int(math.Round(float64(sum) / float64(n)))
	}
}

// freezeAt: el primer día hábil del mes siguiente, a la hora de inicio de la Agenda.
func freezeAt(month time.Time, ac agendaCal) time.Time {
	next := month.AddDate(0, 1, 0)
	if !ac.cal.IsBusiness(next) {
		next = ac.cal.NextBusiness(next)
	}
	return ac.start.At(next, ac.loc)
}

func (h *TeamHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// monthly devuelve el resumen de un mes: la foto si el mes ya se congeló (y
// la crea si falta), o el cálculo al momento.
func (h *TeamHandler) monthly(ctx context.Context, area db.ListLeadAreasRow, month time.Time) (monthlyDataDTO, bool, error) {
	now := h.now()
	ac, err := loadAgendaCal(ctx, h.Queries, month.AddDate(0, 0, -1), month.AddDate(0, 2, 0))
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	people, err := h.areaPeople(ctx, area.ID)
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	frozen := !now.Before(freezeAt(month, ac))
	if frozen {
		row, err := h.Queries.GetMonthlySummary(ctx, db.GetMonthlySummaryParams{AreaID: area.ID, Month: pgDate(month)})
		if err == nil {
			var d monthlyDataDTO
			if json.Unmarshal(row.Data, &d) == nil && d.Version >= monthlyVersion && sameMembers(d.Members, people) {
				return d, true, nil
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return monthlyDataDTO{}, false, err
		}
	}
	last := month.AddDate(0, 1, -1)
	occs, err := h.Queries.ListMonthOccurrences(ctx, db.ListMonthOccurrencesParams{AreaID: area.ID, FromDay: pgDate(month), ToDay: pgDate(last)})
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	monthStart := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, ac.loc)
	tickets, err := h.Queries.ListMonthResolvedTickets(ctx, db.ListMonthResolvedTicketsParams{AreaID: area.ID, FromAt: pgTime(monthStart), ToAt: pgTime(monthStart.AddDate(0, 1, 0))})
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	abs, err := h.Queries.ListMonthAbsenceDays(ctx, db.ListMonthAbsenceDaysParams{FromDay: pgDate(month), ToDay: pgDate(last)})
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	goals, err := h.Queries.ListMonthGoalsDone(ctx, db.ListMonthGoalsDoneParams{FromAt: pgTime(monthStart), ToAt: pgTime(monthStart.AddDate(0, 1, 0))})
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	in := monthlyInput{month: month, loc: ac.loc, dayEnd: ac.end, cal: ac.cal, now: now, names: map[uuid.UUID]string{},
		occs: occs, tickets: tickets, absences: map[uuid.UUID]int{}, goals: map[uuid.UUID]int{}, areaCode: area.Code, areaName: area.Name, computedAt: now}
	for _, a := range abs {
		in.absences[a.UserID] = int(a.Days)
	}
	for _, g := range goals {
		in.goals[g.UserID] = int(g.Done)
	}
	seen := map[uuid.UUID]bool{}
	ids := make([]uuid.UUID, 0, len(people))
	for _, p := range people {
		seen[p.ID] = true
		ids = append(ids, p.ID)
		in.people = append(in.people, monthlyPersonDTO{ID: p.ID, Name: p.Name, Level: p.Level})
	}
	// La Bitácora del mes (10f), en las áreas que la usan.
	if operativo, err := h.qualityAreas(ctx); err != nil {
		return monthlyDataDTO{}, false, err
	} else if operativo[area.Code] && len(ids) > 0 {
		if in.quality, err = h.evaluatePeople(ctx, ids, monthStart, monthStart.AddDate(0, 1, 0)); err != nil {
			return monthlyDataDTO{}, false, err
		}
	}
	var missing []uuid.UUID
	for _, o := range occs {
		if o.UserID.Valid {
			if !seen[uuid.UUID(o.UserID.Bytes)] {
				missing = append(missing, uuid.UUID(o.UserID.Bytes))
			}
		}
	}
	for _, t := range tickets {
		if t.AssignedUserID.Valid {
			if !seen[uuid.UUID(t.AssignedUserID.Bytes)] {
				missing = append(missing, uuid.UUID(t.AssignedUserID.Bytes))
			}
		}
	}
	if len(missing) > 0 {
		if rows, err := h.Queries.ListNotifyUsers(ctx, missing); err == nil {
			for _, r := range rows {
				in.names[r.ID] = r.Name
			}
		}
	}
	d := computeMonthly(in)
	d.Members = ids
	sort.SliceStable(d.People, func(i, j int) bool { return d.People[i].Name < d.People[j].Name })
	if frozen {
		raw, _ := json.Marshal(d)
		if err := h.Queries.ReplaceMonthlySummary(ctx, db.ReplaceMonthlySummaryParams{AreaID: area.ID, Month: pgDate(month), Data: raw}); err != nil {
			return d, frozen, err
		}
	}
	return d, frozen, nil
}

// parseMonth: «2026-09» → primer día; no se piden meses futuros.
func (h *TeamHandler) parseMonth(s string) (time.Time, error) {
	m, err := time.Parse("2006-01", s)
	if err != nil {
		return m, errors.New("mes YYYY-MM")
	}
	now := agenda.Day(h.now(), teamLocation())
	if m.After(time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)) {
		return m, errors.New("ese mes todavía no empieza")
	}
	return m, nil
}

// monthlyScope: el resumen de un área (area) o de un departamento
// (department, la jefatura del departamento) y si usa la Bitácora.
type monthlyScope struct {
	area     db.ListLeadAreasRow
	dep      teamDepartmentDTO
	depAreas []db.ListLeadAreasRow
	bitacora bool
}

func (h *TeamHandler) monthlyScopeOf(w http.ResponseWriter, r *http.Request, areaCode, department string) (monthlyScope, bool) {
	if department != "" {
		_, dep, areas, ok := h.departmentScope(w, r, department, true)
		return monthlyScope{dep: dep, depAreas: areas, bitacora: dep.Quality}, ok
	}
	_, area, _, ok := h.leadScope(w, r, areaCode)
	if !ok {
		return monthlyScope{}, false
	}
	operativo, _ := h.qualityAreas(r.Context())
	return monthlyScope{area: area, bitacora: operativo[area.Code]}, true
}

func (h *TeamHandler) monthlyOf(ctx context.Context, s monthlyScope, month time.Time) (monthlyDataDTO, bool, error) {
	if s.depAreas != nil {
		return h.monthlyDepartment(ctx, s.dep, s.depAreas, month)
	}
	return h.monthly(ctx, s.area, month)
}

// Monthly: GET /api/team/monthly?area=CODE&month=YYYY-MM (o ?department=ID).
// Trae también los totales del mes anterior para la diferencia.
func (h *TeamHandler) Monthly(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	scope, ok := h.monthlyScopeOf(w, r, q.Get("area"), q.Get("department"))
	if !ok {
		return
	}
	month, err := h.parseMonth(q.Get("month"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", err.Error())
		return
	}
	ctx := r.Context()
	cur, frozen, err := h.monthlyOf(ctx, scope, month)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular el resumen")
		return
	}
	prev, _, err := h.monthlyOf(ctx, scope, month.AddDate(0, -1, 0))
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular el resumen")
		return
	}
	bitacora, tickets := scope.bitacora, featureEnabled(ctx, h.Queries, ticketsFeature)
	writeData(w, http.StatusOK, map[string]any{
		"summary": cur, "frozen": frozen, "onTimePct": cur.Total.onTimePct(), "slaPct": cur.Total.slaPct(),
		"previous": map[string]int{"onTimePct": prev.Total.onTimePct(), "slaPct": prev.Total.slaPct(), "quality": prev.Total.Quality},
		// bitacora: el área usa la Bitácora (entradas y calidad); tickets: la
		// Ticketera está encendida (si no, sus columnas no aparecen).
		"bitacora": bitacora, "tickets": tickets,
	})
}

// SendMonthly: POST /api/team/monthly/send {area, month, to}. Mismos
// destinatarios válidos que Reportes (dominios propios).
func (h *TeamHandler) SendMonthly(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Area       string   `json:"area"`
		Department string   `json:"department"`
		Month      string   `json:"month"`
		To         []string `json:"to"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	scope, ok := h.monthlyScopeOf(w, r, req.Area, req.Department)
	if !ok {
		return
	}
	month, err := h.parseMonth(req.Month)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	to, bad := cleanRecipientList(req.To)
	if bad != "" || len(to) == 0 || len(to) > 30 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "escribe entre 1 y 30 correos válidos "+bad)
		return
	}
	ctx := r.Context()
	if h.Reports != nil {
		allowed := h.Reports.allowedDomains(ctx)
		for _, e := range to {
			if !allowed[domainOf(e)] {
				problemdetails.Write(w, r, http.StatusBadRequest, "recipient-not-allowed", "el dominio de "+e+" no pertenece a los destinatarios válidos")
				return
			}
		}
	}
	d, frozen, err := h.monthlyOf(ctx, scope, month)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular el resumen")
		return
	}
	if h.Notify == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "mail-unavailable", "el correo no está configurado")
		return
	}
	html, subject, err := h.monthlyMail(ctx, d, frozen, scope.bitacora)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo armar el correo")
		return
	}
	sender, err := h.Notify.Sender(ctx)
	if err != nil || sender == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "mail-unavailable", "el correo no está configurado (Administración → Correo)")
		return
	}
	h.Notify.mail(ctx, to, subject, html)
	h.AuditLog.Log(ctx, "team.monthly.sent", audit.LevelInfo, audit.Success(), map[string]any{"area": cmpOr(scope.area.Code, scope.dep.Name), "month": d.Month, "to": to})
	writeData(w, http.StatusOK, map[string]any{"sent": len(to)})
}

func (h *TeamHandler) monthlyMail(ctx context.Context, d monthlyDataDTO, frozen, bitacora bool) (string, string, error) {
	m, _ := time.Parse("2006-01", d.Month)
	period := fmt.Sprintf("%s %d", spanishMonths[m.Month()-1], m.Year())
	name, logo := h.Notify.brand(ctx)
	row := func(p monthlyPersonDTO) mailtpl.MonthlyRow {
		return mailtpl.MonthlyRow{Name: p.Name, Level: p.Level, Tasks: p.Tasks, OnTimePct: p.onTimePct(), OpenLate: p.OpenLate,
			Skipped: p.Skipped, Tickets: p.Tickets, SLAPct: p.slaPct(), AbsentDays: p.AbsentDays, GoalsDone: p.GoalsDone, Entries: p.Entries, Quality: p.Quality}
	}
	rows := make([]mailtpl.MonthlyRow, 0, len(d.People))
	for _, p := range d.People {
		rows = append(rows, row(p))
	}
	intro := fmt.Sprintf("Días hábiles del mes: %d.", d.BizDays)
	if !frozen {
		intro += " El mes va en curso: los números pueden cambiar hasta el cierre."
	}
	title := "Resumen mensual " + d.AreaName
	tickets := featureEnabled(ctx, h.Queries, ticketsFeature)
	html, err := mailtpl.RenderMonthlySummary(mailtpl.MonthlySummaryOptions{Rows: rows, Total: row(d.Total), Title: title, PeriodLabel: period,
		LogoSrc: logo, BrandName: name, Intro: intro, Year: m.Year(), Bitacora: bitacora, NoTickets: !tickets})
	return html, title + " · " + period, err
}

// FreezeMonthly guarda la foto del mes anterior de cada área cuando toca
// (scheduler). Si nadie lo abre, igual queda congelado el día que corresponde.
func (h *TeamHandler) FreezeMonthly(ctx context.Context) error {
	areas, err := h.Queries.ListActiveAreas(ctx)
	if err != nil {
		return err
	}
	now := agenda.Day(h.now(), teamLocation())
	prev := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
	for _, a := range areas {
		if _, _, err := h.monthly(ctx, db.ListLeadAreasRow(a), prev); err != nil {
			return err
		}
	}
	return nil
}
