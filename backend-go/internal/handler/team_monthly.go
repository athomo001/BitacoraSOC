package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
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
}

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
}

type monthlyInput struct {
	month      time.Time // primer día, medianoche UTC
	loc        *time.Location
	dayEnd     agenda.Clock
	cal        agenda.Calendar
	now        time.Time
	people     []monthlyPersonDTO // la gente del área (nombre y nivel)
	names      map[uuid.UUID]string
	occs       []db.ListMonthOccurrencesRow
	tickets    []db.ListMonthResolvedTicketsRow
	absences   map[uuid.UUID]int
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
	out := monthlyDataDTO{Month: in.month.Format("2006-01"), AreaCode: in.areaCode, AreaName: in.areaName, Total: total,
		People: make([]monthlyPersonDTO, 0, len(order)), ComputedAt: in.computedAt}
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
	frozen := !now.Before(freezeAt(month, ac))
	if frozen {
		row, err := h.Queries.GetMonthlySummary(ctx, db.GetMonthlySummaryParams{AreaID: area.ID, Month: pgDate(month)})
		if err == nil {
			var d monthlyDataDTO
			if json.Unmarshal(row.Data, &d) == nil {
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
	in := monthlyInput{month: month, loc: ac.loc, dayEnd: ac.end, cal: ac.cal, now: now, names: map[uuid.UUID]string{},
		occs: occs, tickets: tickets, absences: map[uuid.UUID]int{}, areaCode: area.Code, areaName: area.Name, computedAt: now}
	for _, a := range abs {
		in.absences[a.UserID] = int(a.Days)
	}
	people, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	levels, err := h.Queries.ListLevels(ctx)
	if err != nil {
		return monthlyDataDTO{}, false, err
	}
	levelName := map[uuid.UUID]string{}
	for _, l := range levels {
		levelName[l.ID] = l.Name
	}
	// Una fila por persona, con su nivel de más rango en el área.
	seen := map[uuid.UUID]int{}
	rank := map[uuid.UUID]int32{}
	for _, p := range people {
		if p.AreaID != area.ID {
			continue
		}
		lvl := ""
		if p.LevelID.Valid {
			lvl = levelName[uuid.UUID(p.LevelID.Bytes)]
		}
		if i, ok := seen[p.UserID]; ok {
			if p.LevelRank > rank[p.UserID] {
				in.people[i].Level, rank[p.UserID] = lvl, p.LevelRank
			}
			continue
		}
		seen[p.UserID], rank[p.UserID] = len(in.people), p.LevelRank
		in.people = append(in.people, monthlyPersonDTO{ID: p.UserID, Name: p.Name, Level: lvl})
	}
	var missing []uuid.UUID
	for _, o := range occs {
		if o.UserID.Valid {
			if _, ok := seen[uuid.UUID(o.UserID.Bytes)]; !ok {
				missing = append(missing, uuid.UUID(o.UserID.Bytes))
			}
		}
	}
	for _, t := range tickets {
		if t.AssignedUserID.Valid {
			if _, ok := seen[uuid.UUID(t.AssignedUserID.Bytes)]; !ok {
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
	sort.SliceStable(d.People, func(i, j int) bool { return d.People[i].Name < d.People[j].Name })
	if frozen {
		raw, _ := json.Marshal(d)
		if err := h.Queries.InsertMonthlySummary(ctx, db.InsertMonthlySummaryParams{AreaID: area.ID, Month: pgDate(month), Data: raw}); err != nil {
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

// Monthly: GET /api/team/monthly?area=CODE&month=YYYY-MM. Trae también los
// totales del mes anterior para la diferencia.
func (h *TeamHandler) Monthly(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	_, area, _, ok := h.leadScope(w, r, q.Get("area"))
	if !ok {
		return
	}
	month, err := h.parseMonth(q.Get("month"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", err.Error())
		return
	}
	ctx := r.Context()
	cur, frozen, err := h.monthly(ctx, area, month)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular el resumen")
		return
	}
	prev, _, err := h.monthly(ctx, area, month.AddDate(0, -1, 0))
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular el resumen")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"summary": cur, "frozen": frozen, "onTimePct": cur.Total.onTimePct(), "slaPct": cur.Total.slaPct(),
		"previous": map[string]int{"onTimePct": prev.Total.onTimePct(), "slaPct": prev.Total.slaPct()},
	})
}

// SendMonthly: POST /api/team/monthly/send {area, month, to}. Mismos
// destinatarios válidos que Reportes (dominios propios).
func (h *TeamHandler) SendMonthly(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Area  string   `json:"area"`
		Month string   `json:"month"`
		To    []string `json:"to"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	_, area, _, ok := h.leadScope(w, r, req.Area)
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
	d, frozen, err := h.monthly(ctx, area, month)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo calcular el resumen")
		return
	}
	if h.Notify == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "mail-unavailable", "el correo no está configurado")
		return
	}
	html, subject, err := h.monthlyMail(ctx, d, frozen)
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
	h.AuditLog.Log(ctx, "team.monthly.sent", audit.LevelInfo, audit.Success(), map[string]any{"area": area.Code, "month": d.Month, "to": to})
	writeData(w, http.StatusOK, map[string]any{"sent": len(to)})
}

func (h *TeamHandler) monthlyMail(ctx context.Context, d monthlyDataDTO, frozen bool) (string, string, error) {
	m, _ := time.Parse("2006-01", d.Month)
	period := fmt.Sprintf("%s %d", spanishMonths[m.Month()-1], m.Year())
	name, logo := h.Notify.brand(ctx)
	row := func(p monthlyPersonDTO) mailtpl.MonthlyRow {
		return mailtpl.MonthlyRow{Name: p.Name, Level: p.Level, Tasks: p.Tasks, OnTimePct: p.onTimePct(), OpenLate: p.OpenLate,
			Skipped: p.Skipped, Tickets: p.Tickets, SLAPct: p.slaPct(), AbsentDays: p.AbsentDays}
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
	html, err := mailtpl.RenderMonthlySummary(mailtpl.MonthlySummaryOptions{Rows: rows, Total: row(d.Total), Title: title, PeriodLabel: period,
		LogoSrc: logo, BrandName: name, Intro: intro, Year: m.Year()})
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
