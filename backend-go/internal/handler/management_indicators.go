package handler

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Indicadores de la Gestión (§4.4.8): fijos y calculados solos, por cliente y
// por área, para el mes en curso, el anterior o los últimos 90 días.
//   - Tareas a tiempo: ocurrencias de la Agenda cerradas antes de vencer,
//     sobre las cerradas más las atrasadas abiertas.
//   - Tickets en SLA: resueltos dentro del plazo sobre los resueltos con SLA.
//   - Atrasos abiertos: tareas vencidas sin hacer más tickets abiertos fuera de SLA.
//   - 1.ª respuesta y resolución: tiempo medio de los tickets del período.

// periodRange: los días [from, to] de un período («month», «prev» o «90»).
func periodRange(period string, c mgmtClock) (time.Time, time.Time) {
	first := time.Date(c.today.Year(), c.today.Month(), 1, 0, 0, 0, 0, time.UTC)
	switch period {
	case "prev":
		return first.AddDate(0, -1, 0), first.AddDate(0, 0, -1)
	case "90":
		return c.today.AddDate(0, 0, -89), c.today
	}
	return first, c.today
}

// instant: el comienzo del día civil d en la zona del área.
func (c mgmtClock) instant(d time.Time) time.Time {
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, c.ac.loc)
}

type periodStat struct {
	resolved, withSLA, inSLA, created int
	avgResponse, avgResolution        float64
	done, onTime, openLate            int
}

// onTimePct: -1 sin datos.
func (s periodStat) onTimePct() int {
	if den := s.done + s.openLate; den > 0 {
		return s.onTime * 100 / den
	}
	return -1
}

func (s periodStat) slaPct() int {
	if s.withSLA > 0 {
		return s.inSLA * 100 / s.withSLA
	}
	return -1
}

// periodStats junta tickets y tareas del período por cliente o por área.
func (h *ManagementHandler) periodStats(ctx context.Context, by string, from, to time.Time, c mgmtClock) (map[uuid.UUID]periodStat, error) {
	out := map[uuid.UUID]periodStat{}
	rows, err := h.Queries.TicketPeriodStats(ctx, db.TicketPeriodStatsParams{By: by,
		FromAt: pgtype.Timestamptz{Time: c.instant(from), Valid: true}, ToAt: pgtype.Timestamptz{Time: c.instant(to.AddDate(0, 0, 1)), Valid: true}})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		s := out[r.KeyID]
		s.resolved, s.withSLA, s.inSLA, s.created = int(r.Resolved), int(r.WithSla), int(r.InSla), int(r.Created)
		s.avgResponse, s.avgResolution = r.AvgResponseSecs, r.AvgResolutionSecs
		out[r.KeyID] = s
	}
	occs, err := h.Queries.ListAgendaOccurrencesForStats(ctx, db.ListAgendaOccurrencesForStatsParams{FromDay: pgDate(from), ToDay: pgDate(to)})
	if err != nil {
		return nil, err
	}
	for _, o := range occs {
		var key uuid.UUID
		if by == "area" {
			key = o.AreaID
		} else if o.OrganizationID.Valid {
			key = uuid.UUID(o.OrganizationID.Bytes)
		} else {
			continue
		}
		due := o.DueDate.Time
		s := out[key]
		switch {
		case o.Status == "pending" && c.now.After(c.ac.dueAt(due)):
			s.openLate++
		case o.Status == "done" && !due.Before(from) && !due.After(to):
			s.done++
			if o.ClosedAt.Valid && !o.ClosedAt.Time.After(c.ac.dueAt(due)) {
				s.onTime++
			}
		}
		out[key] = s
	}
	return out, nil
}

type mgmtIndicatorRowDTO struct {
	ID                uuid.UUID `json:"id"`
	Name              string    `json:"name"`
	OnTimePct         int       `json:"onTimePct"`
	SLAPct            int       `json:"slaPct"`
	SLATarget         int32     `json:"slaTarget"`
	OpenLate          int       `json:"openLate"`
	AvgResponseSecs   float64   `json:"avgResponseSecs"`
	AvgResolutionSecs float64   `json:"avgResolutionSecs"`
	// Trend: cumplimiento del SLA de los últimos 6 meses (-1 sin datos).
	Trend []int `json:"trend"`
}

type mgmtLoadDTO struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	Tickets int       `json:"tickets"`
	SLAPct  int       `json:"slaPct"`
}

// Indicators es GET /api/management/indicators?by=client|area&period=month|prev|90.
// Las jefaturas ven las áreas que dirigen (pregunta 1 del dueño); Gestión y el admin, todas.
func (h *ManagementHandler) Indicators(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	by := r.URL.Query().Get("by")
	if by != "area" {
		by = "client"
	}
	period := r.URL.Query().Get("period")
	c, err := h.clock(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	settings, err := h.Queries.GetManagementSettings(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	from, to := periodRange(period, c)
	stats, err := h.periodStats(ctx, by, from, to, c)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	breached, err := h.Queries.OpenBreachedTickets(ctx, db.OpenBreachedTicketsParams{By: by, Now: pgtype.Timestamptz{Time: c.now, Valid: true}})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	open := map[uuid.UUID]int{}
	for _, b := range breached {
		open[b.KeyID] = int(b.Breached)
	}
	months := make([]string, 6)
	monthStart := time.Date(c.today.Year(), c.today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -5, 0)
	for i := range months {
		months[i] = monthStart.AddDate(0, i, 0).Format("2006-01")
	}
	trendRows, err := h.Queries.TicketSLAByMonth(ctx, db.TicketSLAByMonthParams{By: by, Tz: c.ac.loc.String(),
		FromAt: pgtype.Timestamptz{Time: c.instant(monthStart), Valid: true}, ToAt: pgtype.Timestamptz{Time: c.now, Valid: true}})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	trend := map[uuid.UUID]map[string]int{}
	for _, t := range trendRows {
		if trend[t.KeyID] == nil {
			trend[t.KeyID] = map[string]int{}
		}
		if t.WithSla > 0 {
			trend[t.KeyID][t.Month] = int(t.InSla) * 100 / int(t.WithSla)
		}
	}
	type keyName struct {
		id     uuid.UUID
		name   string
		target int32
	}
	var keys []keyName
	if by == "area" {
		areas, err := h.Queries.ListTicketAreas(ctx)
		if err != nil {
			mgmtFail(w, r)
			return
		}
		for _, a := range areas {
			if a.DefaultProfile == "gestion" || !u.seesArea(a.ID) {
				continue
			}
			keys = append(keys, keyName{a.ID, a.Name, settings.SlaTarget})
		}
	} else {
		clients, err := h.Queries.ListManagementClients(ctx, db.ListManagementClientsParams{Now: pgtype.Timestamptz{Time: c.now, Valid: true}, LateBefore: pgDate(c.lateBefore)})
		if err != nil {
			mgmtFail(w, r)
			return
		}
		scope, err := h.clientScope(ctx, u)
		if err != nil {
			mgmtFail(w, r)
			return
		}
		for _, cl := range clients {
			if clientAllowed(scope, cl.ID, cl.CsmUserID, u.id) {
				keys = append(keys, keyName{cl.ID, cl.Name, slaTargetFor(cl, settings)})
			}
		}
	}
	rows := make([]mgmtIndicatorRowDTO, 0, len(keys))
	load := []mgmtLoadDTO{}
	for _, k := range keys {
		s := stats[k.id]
		row := mgmtIndicatorRowDTO{ID: k.id, Name: k.name, OnTimePct: s.onTimePct(), SLAPct: s.slaPct(), SLATarget: k.target,
			OpenLate: s.openLate + open[k.id], AvgResponseSecs: s.avgResponse, AvgResolutionSecs: s.avgResolution, Trend: make([]int, len(months))}
		for i, m := range months {
			v, ok := trend[k.id][m]
			if !ok {
				v = -1
			}
			row.Trend[i] = v
		}
		rows = append(rows, row)
	}
	// Carga por área: tickets creados en el período, de todos los clientes.
	areaStats := stats
	if by != "area" {
		if areaStats, err = h.periodStats(ctx, "area", from, to, c); err != nil {
			mgmtFail(w, r)
			return
		}
	}
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	for _, a := range areas {
		if a.DefaultProfile == "gestion" {
			continue
		}
		s := areaStats[a.ID]
		load = append(load, mgmtLoadDTO{ID: a.ID, Name: a.Name, Tickets: s.created, SLAPct: s.slaPct()})
	}
	writeData(w, http.StatusOK, map[string]any{"by": by, "period": period, "from": agenda.FormatDate(from), "to": agenda.FormatDate(to),
		"months": months, "slaTarget": settings.SlaTarget, "rows": rows, "load": load})
}

// ===== Exportar resumen (§4.4.4) =====

type mgmtSummaryDTO struct {
	ClientID          uuid.UUID `json:"clientId"`
	ClientName        string    `json:"clientName"`
	Period            string    `json:"period"`
	From              string    `json:"from"`
	To                string    `json:"to"`
	SLAPct            int       `json:"slaPct"`
	SLATarget         int32     `json:"slaTarget"`
	AvgResponseSecs   float64   `json:"avgResponseSecs"`
	AvgResolutionSecs float64   `json:"avgResolutionSecs"`
	Incidents         []struct {
		Area string `json:"area"`
		P1   int    `json:"p1"`
		P2   int    `json:"p2"`
		P3   int    `json:"p3"`
		P4   int    `json:"p4"`
	} `json:"incidents"`
	Goals []goalDTO `json:"goals"`
}

func (h *ManagementHandler) summary(ctx context.Context, u agendaUser, id uuid.UUID, period string) (mgmtSummaryDTO, bool, error) {
	c, err := h.clock(ctx)
	if err != nil {
		return mgmtSummaryDTO{}, false, err
	}
	settings, err := h.Queries.GetManagementSettings(ctx)
	if err != nil {
		return mgmtSummaryDTO{}, false, err
	}
	rows, err := h.Queries.ListManagementClients(ctx, db.ListManagementClientsParams{Now: pgtype.Timestamptz{Time: c.now, Valid: true},
		LateBefore: pgDate(c.lateBefore), ClientID: pgUUIDOf(id)})
	if err != nil || len(rows) == 0 {
		return mgmtSummaryDTO{}, false, err
	}
	if scope, err := h.clientScope(ctx, u); err != nil || !clientAllowed(scope, id, rows[0].CsmUserID, u.id) {
		return mgmtSummaryDTO{}, false, err
	}
	if period != "prev" && period != "90" {
		period = "month"
	}
	from, to := periodRange(period, c)
	stats, err := h.periodStats(ctx, "client", from, to, c)
	if err != nil {
		return mgmtSummaryDTO{}, false, err
	}
	s := stats[id]
	d := mgmtSummaryDTO{ClientID: id, ClientName: rows[0].Name, Period: period, From: agenda.FormatDate(from), To: agenda.FormatDate(to),
		SLAPct: s.slaPct(), SLATarget: slaTargetFor(rows[0], settings), AvgResponseSecs: s.avgResponse, AvgResolutionSecs: s.avgResolution,
		Goals: []goalDTO{}}
	d.Incidents = []struct {
		Area string `json:"area"`
		P1   int    `json:"p1"`
		P2   int    `json:"p2"`
		P3   int    `json:"p3"`
		P4   int    `json:"p4"`
	}{}
	inc, err := h.Queries.ClientResolvedIncidents(ctx, db.ClientResolvedIncidentsParams{ClientID: id,
		FromAt: pgtype.Timestamptz{Time: c.instant(from), Valid: true}, ToAt: pgtype.Timestamptz{Time: c.instant(to.AddDate(0, 0, 1)), Valid: true}})
	if err != nil {
		return d, false, err
	}
	for _, x := range inc {
		if n := len(d.Incidents); n == 0 || d.Incidents[n-1].Area != x.AreaName {
			d.Incidents = append(d.Incidents, struct {
				Area string `json:"area"`
				P1   int    `json:"p1"`
				P2   int    `json:"p2"`
				P3   int    `json:"p3"`
				P4   int    `json:"p4"`
			}{Area: x.AreaName})
		}
		last := &d.Incidents[len(d.Incidents)-1]
		switch x.Priority {
		case db.ItilPriorityP1Critical:
			last.P1 += int(x.Resolved)
		case db.ItilPriorityP2High:
			last.P2 += int(x.Resolved)
		case db.ItilPriorityP3Medium:
			last.P3 += int(x.Resolved)
		default:
			last.P4 += int(x.Resolved)
		}
	}
	goals, err := h.loadGoals(ctx, db.ListGoalsParams{ClientID: pgUUIDOf(id)}, u, c)
	if err != nil {
		return d, false, err
	}
	for _, g := range goals {
		// Las cumplidas en el período y las que siguen en curso, con su avance.
		if g.State == "done" && g.CompletedAt != nil && agenda.Day(*g.CompletedAt, c.ac.loc).Before(from) {
			continue
		}
		if g.State != "failed" {
			d.Goals = append(d.Goals, g)
		}
	}
	return d, true, nil
}

// Summary es GET /api/management/clients/{id}/summary?period=: el resumen
// para el PDF (impresión del navegador) o el correo.
func (h *ManagementHandler) Summary(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	d, found, err := h.summary(r.Context(), u, id, r.URL.Query().Get("period"))
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if !found {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	writeData(w, http.StatusOK, d)
}

// SendSummary es POST /api/management/clients/{id}/summary/send {period, to}:
// con la plantilla de lista del legacy, a los dominios válidos de Reportes.
func (h *ManagementHandler) SendSummary(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managementUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	var req struct {
		Period string   `json:"period"`
		To     []string `json:"to"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	to, bad := cleanRecipientList(req.To)
	if bad != "" || len(to) == 0 || len(to) > 30 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "escribe entre 1 y 30 correos válidos "+bad)
		return
	}
	if h.Reports != nil {
		allowed := h.Reports.allowedDomains(ctx)
		for _, e := range to {
			if !allowed[domainOf(e)] {
				problemdetails.Write(w, r, http.StatusBadRequest, "recipient-not-allowed", "el dominio de "+e+" no pertenece a los destinatarios válidos")
				return
			}
		}
	}
	d, found, err := h.summary(ctx, u, id, req.Period)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	if !found {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	if h.Notify == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "mail-unavailable", "el correo no está configurado")
		return
	}
	sender, err := h.Notify.Sender(ctx)
	if err != nil || sender == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "mail-unavailable", "el correo no está configurado (Administración → Correo)")
		return
	}
	html, subject, err := h.summaryMail(ctx, d)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	h.Notify.mail(ctx, to, subject, html)
	h.AuditLog.Log(ctx, "management.summary.sent", audit.LevelInfo, audit.Success(), map[string]any{"clientId": id.String(), "period": d.Period, "to": to})
	writeData(w, http.StatusOK, map[string]any{"sent": len(to)})
}

// spanishPeriod: «octubre 2026» o «21-07-2026 al 19-10-2026».
func spanishPeriod(d mgmtSummaryDTO) string {
	from, _ := agenda.ParseDate(d.From)
	to, _ := agenda.ParseDate(d.To)
	if d.Period == "90" {
		return fmt.Sprintf("%s al %s", from.Format("02-01-2006"), to.Format("02-01-2006"))
	}
	return fmt.Sprintf("%s %d", spanishMonths[from.Month()-1], from.Year())
}

// formatDuration: «9 min», «6,2 h», «1,6 d» («-» sin datos).
func formatDuration(secs float64) string {
	switch {
	case secs <= 0:
		return "-"
	case secs < 3600:
		return fmt.Sprintf("%d min", int(secs/60+0.5))
	case secs < 24*3600:
		return strings.Replace(fmt.Sprintf("%.1f h", secs/3600), ".", ",", 1)
	}
	return strings.Replace(fmt.Sprintf("%.1f d", secs/86400), ".", ",", 1)
}

func (h *ManagementHandler) summaryMail(ctx context.Context, d mgmtSummaryDTO) (string, string, error) {
	name, logo := h.Notify.brand(ctx)
	opts := mailtpl.ClientSummaryOptions{Title: "Resumen de servicio · " + d.ClientName, PeriodLabel: spanishPeriod(d), LogoSrc: logo, BrandName: name,
		SLAPct: d.SLAPct, SLATarget: int(d.SLATarget), Response: formatDuration(d.AvgResponseSecs), Resolution: formatDuration(d.AvgResolutionSecs),
		Year: h.now().Year()}
	for _, x := range d.Incidents {
		opts.Incidents = append(opts.Incidents, mailtpl.ClientSummaryArea{Area: x.Area, P1: x.P1, P2: x.P2, P3: x.P3, P4: x.P4})
	}
	states := map[string]string{"open": "En curso", "risk": "En riesgo", "confirm": "Por confirmar", "done": "Cumplida"}
	sort.SliceStable(d.Goals, func(i, j int) bool { return d.Goals[i].State == "done" && d.Goals[j].State != "done" })
	for _, g := range d.Goals {
		opts.Goals = append(opts.Goals, mailtpl.ClientSummaryGoal{Name: g.Name, Done: int(g.MilestonesDone), Total: int(g.Milestones), State: states[g.State]})
	}
	html, err := mailtpl.RenderClientSummary(opts)
	return html, opts.Title + " · " + opts.PeriodLabel, err
}
