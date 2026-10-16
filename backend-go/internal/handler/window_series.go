package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Ventanas de mantenimiento que se repiten (spec/16 §6.1, 9.7, 000044, diseño
// aprobado por el dueño 2026-10-15). La serie guarda la regla (cada semana o
// cada mes) y se generan las ventanas de los próximos seriesHorizon días como
// ventanas normales: el escalamiento las respeta sin cambios.
//
// Feriados (decisión del dueño): la que cae en feriado se crea sin aplicar.
// Si es urgente, la jefatura o el admin pulsa «Aplicar igual» y queda quién.
// Cualquiera que crea ventanas puede saltar una vez o volver a aplicarla.

const seriesHorizon = 60

type seriesRequest struct {
	scope
	OrganizationID *uuid.UUID        `json:"organizationId"`
	AreaID         *uuid.UUID        `json:"areaId"`
	TeamID         *uuid.UUID        `json:"teamId"`
	Title          string            `json:"title"`
	Notes          *string           `json:"notes"`
	Suppress       bool              `json:"suppressNotifications"`
	Rule           agenda.WindowRule `json:"rule"`
	ValidFrom      string            `json:"validFrom"`
	ValidTo        *string           `json:"validTo"`
}

func (req *seriesRequest) validate(edit bool) (from time.Time, to pgtype.Date, err error) {
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" || len([]rune(req.Title)) > 200 {
		return from, to, errors.New("el título va de 1 a 200 caracteres")
	}
	if !edit {
		n := req.scope.count()
		for _, p := range []*uuid.UUID{req.OrganizationID, req.AreaID, req.TeamID} {
			if p != nil {
				n++
			}
		}
		if n != 1 {
			return from, to, errors.New("la ventana aplica a exactamente uno: servicio, activo, zona, cliente, área o equipo")
		}
	}
	if err := req.Rule.Validate(); err != nil {
		return from, to, err
	}
	if from, err = agenda.ParseDate(req.ValidFrom); err != nil {
		return from, to, errors.New("desde (YYYY-MM-DD)")
	}
	if req.ValidTo != nil && *req.ValidTo != "" {
		end, err := agenda.ParseDate(*req.ValidTo)
		if err != nil || end.Before(from) {
			return from, to, errors.New("hasta debe ser una fecha posterior a desde")
		}
		to = pgDate(end)
	}
	return from, to, nil
}

type seriesWindowDTO struct {
	ID             uuid.UUID  `json:"id"`
	Day            string     `json:"day"`
	StartsAt       time.Time  `json:"startsAt"`
	EndsAt         time.Time  `json:"endsAt"`
	Active         bool       `json:"active"`
	HolidayName    *string    `json:"holidayName,omitempty"`
	ApprovedByName string     `json:"approvedByName,omitempty"`
	ApprovedAt     *time.Time `json:"approvedAt,omitempty"`
}

type seriesDTO struct {
	ID                uuid.UUID         `json:"id"`
	ServiceID         *uuid.UUID        `json:"serviceId,omitempty"`
	AssetID           *uuid.UUID        `json:"assetId,omitempty"`
	TerritorialUnitID *uuid.UUID        `json:"territorialUnitId,omitempty"`
	OrganizationID    *uuid.UUID        `json:"organizationId,omitempty"`
	AreaID            *uuid.UUID        `json:"areaId,omitempty"`
	TeamID            *uuid.UUID        `json:"teamId,omitempty"`
	TargetName        string            `json:"targetName"`
	Title             string            `json:"title"`
	Notes             *string           `json:"notes,omitempty"`
	Suppress          bool              `json:"suppressNotifications"`
	Rule              agenda.WindowRule `json:"rule"`
	ValidFrom         string            `json:"validFrom"`
	ValidTo           *string           `json:"validTo,omitempty"`
	Next              []seriesWindowDTO `json:"next"`
}

// ListSeries: las series activas con sus próximas ventanas (también las
// saltadas y las de feriado) y si el usuario puede aplicar las de feriado.
func (h *EscalationHandler) ListSeries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.Queries.ListWindowSeries(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las ventanas que se repiten")
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, s := range rows {
		ids = append(ids, s.ID)
	}
	wins, err := h.Queries.ListSeriesWindows(ctx, ids)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las ventanas que se repiten")
		return
	}
	next := map[uuid.UUID][]seriesWindowDTO{}
	for _, x := range wins {
		id := uuid.UUID(x.SeriesID.Bytes)
		if len(next[id]) >= 8 {
			continue
		}
		next[id] = append(next[id], seriesWindowDTO{ID: x.ID, Day: agenda.FormatDate(x.SeriesDay.Time), StartsAt: x.StartsAt.Time, EndsAt: x.EndsAt.Time,
			Active: x.Active, HolidayName: textPtr(x.HolidayName), ApprovedByName: x.ApprovedByName, ApprovedAt: timestamptzPtr(x.ApprovedAt)})
	}
	out := make([]seriesDTO, 0, len(rows))
	for _, s := range rows {
		var rule agenda.WindowRule
		_ = json.Unmarshal(s.Rule, &rule)
		d := seriesDTO{ID: s.ID, ServiceID: uuidPtr(s.ServiceID), AssetID: uuidPtr(s.AssetID), TerritorialUnitID: uuidPtr(s.TerritorialUnitID),
			OrganizationID: uuidPtr(s.OrganizationID), AreaID: uuidPtr(s.AreaID), TeamID: uuidPtr(s.TeamID), TargetName: s.TargetName,
			Title: s.Title, Notes: textPtr(s.Notes), Suppress: s.SuppressNotifications, Rule: rule, ValidFrom: agenda.FormatDate(s.ValidFrom.Time),
			Next: next[s.ID]}
		if d.Next == nil {
			d.Next = []seriesWindowDTO{}
		}
		if s.ValidTo.Valid {
			v := agenda.FormatDate(s.ValidTo.Time)
			d.ValidTo = &v
		}
		out = append(out, d)
	}
	canApprove, _ := h.canApproveHoliday(ctx, nil)
	writeData(w, http.StatusOK, map[string]any{"series": out, "canApproveHoliday": canApprove})
}

// PreviewSeries: las próximas fechas de una regla, con los feriados marcados
// (la pantalla las muestra mientras se elige).
func (h *EscalationHandler) PreviewSeries(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rule      agenda.WindowRule `json:"rule"`
		ValidFrom string            `json:"validFrom"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	if err := req.Rule.Validate(); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-rule", err.Error())
		return
	}
	ctx := r.Context()
	loc, holidays, err := h.seriesCalendar(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el calendario")
		return
	}
	from := agenda.Day(h.now(), loc)
	if v, err := agenda.ParseDate(req.ValidFrom); err == nil && v.After(from) {
		from = v
	}
	type item struct {
		Day      string    `json:"day"`
		StartsAt time.Time `json:"startsAt"`
		EndsAt   time.Time `json:"endsAt"`
		Holiday  string    `json:"holiday,omitempty"`
	}
	out := []item{}
	for _, d := range req.Rule.Days(from, from.AddDate(1, 0, 0)) {
		start, end := req.Rule.Span(d, loc)
		if !end.After(h.now()) {
			continue
		}
		out = append(out, item{Day: agenda.FormatDate(d), StartsAt: start, EndsAt: end, Holiday: holidays[agenda.FormatDate(d)]})
		if len(out) == 6 {
			break
		}
	}
	writeData(w, http.StatusOK, out)
}

// seriesCalendar: la zona horaria de la Agenda y los feriados del año que viene.
func (h *EscalationHandler) seriesCalendar(ctx context.Context) (*time.Location, map[string]string, error) {
	s, err := h.Queries.GetAgendaSettings(ctx)
	if err != nil {
		return nil, nil, err
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := h.now()
	hs, err := h.Queries.ListHolidaysBetween(ctx, db.ListHolidaysBetweenParams{FromDay: pgDate(now.AddDate(0, 0, -2)), ToDay: pgDate(now.AddDate(1, 0, 2))})
	if err != nil {
		return loc, nil, err
	}
	holidays := map[string]string{}
	for _, x := range hs {
		holidays[agenda.FormatDate(x.Day.Time)] = x.Name
	}
	return loc, holidays, nil
}

func (h *EscalationHandler) CreateSeries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req seriesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	from, to, err := req.validate(false)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	rule, _ := json.Marshal(req.Rule)
	settings, err := h.Queries.GetAgendaSettings(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la ventana")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	s, err := h.Queries.CreateWindowSeries(ctx, db.CreateWindowSeriesParams{
		ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID), TerritorialUnitID: optionalUUID(req.TerritorialUnitID),
		OrganizationID: optionalUUID(req.OrganizationID), AreaID: optionalUUID(req.AreaID), TeamID: optionalUUID(req.TeamID),
		Title: req.Title, Notes: nonEmptyText(req.Notes), SuppressNotifications: req.Suppress, Priority: 100, Rule: rule,
		ValidFrom: pgDate(from), ValidTo: to, Timezone: settings.Timezone, CreatedBy: actor.ID,
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aquello a lo que aplica no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la ventana")
		return
	}
	if err := h.generateSeries(ctx, s); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron generar las ventanas")
		return
	}
	h.AuditLog.Log(ctx, "maintenance_window.series.create", audit.LevelInfo, audit.Success(), map[string]any{"seriesId": s.ID.String(), "title": s.Title})
	writeData(w, http.StatusCreated, map[string]any{"id": s.ID})
}

// UpdateSeries cambia la regla: las ventanas que todavía no empiezan se rehacen
// (las de feriado ya aprobadas se mantienen). A qué aplica no se cambia.
func (h *EscalationHandler) UpdateSeries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req seriesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	from, to, err := req.validate(true)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", err.Error())
		return
	}
	rule, _ := json.Marshal(req.Rule)
	s, err := h.Queries.UpdateWindowSeries(ctx, db.UpdateWindowSeriesParams{ID: id, Title: req.Title, Notes: nonEmptyText(req.Notes),
		SuppressNotifications: req.Suppress, Rule: rule, ValidFrom: pgDate(from), ValidTo: to})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ventana no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la ventana")
		return
	}
	if _, err := h.Queries.DeleteFutureSeriesWindows(ctx, pgUUIDOf(id)); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la ventana")
		return
	}
	if err := h.generateSeries(ctx, s); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron generar las ventanas")
		return
	}
	h.AuditLog.Log(ctx, "maintenance_window.series.update", audit.LevelInfo, audit.Success(), map[string]any{"seriesId": id.String(), "title": s.Title})
	writeNoContent(w)
}

// DeleteSeries la termina: no se generan más y se borran las que no empezaron.
func (h *EscalationHandler) DeleteSeries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	n, err := h.Queries.DeactivateWindowSeries(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar la ventana")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ventana no encontrada")
		return
	}
	if _, err := h.Queries.DeleteFutureSeriesWindows(ctx, pgUUIDOf(id)); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar la ventana")
		return
	}
	h.AuditLog.Log(ctx, "maintenance_window.series.delete", audit.LevelInfo, audit.Success(), map[string]any{"seriesId": id.String()})
	writeNoContent(w)
}

// SetSeriesWindow: una ventana de la serie. action = skip | apply (saltar
// esta vez o volver a aplicarla) o approve | unapprove (la de feriado).
func (h *EscalationHandler) SetSeriesWindow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	action := r.PathValue("action")
	win, err := h.Queries.GetSeriesWindow(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ventana no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la ventana")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	p := db.SetSeriesWindowStateParams{ID: id}
	holiday := win.HolidayName.Valid
	switch action {
	case "skip", "apply":
		if holiday {
			problemdetails.Write(w, r, http.StatusConflict, "holiday", "cae en feriado: se aplica con «Aplicar igual»")
			return
		}
		p.Active = action == "apply"
	case "approve", "unapprove":
		if !holiday {
			problemdetails.Write(w, r, http.StatusConflict, "not-holiday", "esta ventana no cae en feriado")
			return
		}
		ok, err := h.canApproveHoliday(ctx, uuidPtr(win.AreaID))
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo revisar el permiso")
			return
		}
		if !ok {
			problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "en feriado la aplica la jefatura o el admin")
			return
		}
		p.Active = action == "approve"
		if p.Active {
			p.ApprovedBy = pgUUIDOf(actor.ID)
		}
	default:
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "acción desconocida")
		return
	}
	m, err := h.Queries.SetSeriesWindowState(ctx, p)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusConflict, "already-started", "la ventana ya empezó o se cerró")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la ventana")
		return
	}
	h.AuditLog.Log(ctx, "maintenance_window.series."+action, audit.LevelInfo, audit.Success(), map[string]any{
		"windowId": id.String(), "seriesId": uuid.UUID(win.SeriesID.Bytes).String(), "day": agenda.FormatDate(win.SeriesDay.Time)})
	writeData(w, http.StatusOK, toWindowDTO(m))
}

// canApproveHoliday: el admin, o la jefatura (la del área, si la ventana es
// de un área; si no, cualquier jefatura).
func (h *EscalationHandler) canApproveHoliday(ctx context.Context, area *uuid.UUID) (bool, error) {
	user, _ := middleware.UserFromContext(ctx)
	if user.Role == "admin" {
		return true, nil
	}
	leads, err := h.Queries.ListLeadAreas(ctx, user.ID)
	if err != nil {
		return false, err
	}
	for _, a := range leads {
		if area == nil || a.ID == *area {
			return true, nil
		}
	}
	return false, nil
}

// GenerateSeries crea las ventanas que faltan de todas las series (scheduler).
func (h *EscalationHandler) GenerateSeries(ctx context.Context) error {
	rows, err := h.Queries.ListWindowSeries(ctx)
	if err != nil {
		return err
	}
	for _, s := range rows {
		if err := h.generateSeries(ctx, db.MaintenanceWindowSeries{
			ID: s.ID, ServiceID: s.ServiceID, AssetID: s.AssetID, TerritorialUnitID: s.TerritorialUnitID, OrganizationID: s.OrganizationID,
			AreaID: s.AreaID, TeamID: s.TeamID, Title: s.Title, Notes: s.Notes, SuppressNotifications: s.SuppressNotifications,
			Priority: s.Priority, Rule: s.Rule, ValidFrom: s.ValidFrom, ValidTo: s.ValidTo, Timezone: s.Timezone, Active: true, CreatedBy: s.CreatedBy,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (h *EscalationHandler) generateSeries(ctx context.Context, s db.MaintenanceWindowSeries) error {
	if !s.Active {
		return nil
	}
	var rule agenda.WindowRule
	if err := json.Unmarshal(s.Rule, &rule); err != nil || rule.Validate() != nil {
		return nil // una regla dañada no frena a las demás
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := h.now()
	from := agenda.Day(now, loc).AddDate(0, 0, -1) // la de ayer puede seguir en curso si pasa la medianoche
	if s.ValidFrom.Time.After(from) {
		from = s.ValidFrom.Time
	}
	to := agenda.Day(now, loc).AddDate(0, 0, seriesHorizon)
	if s.ValidTo.Valid && s.ValidTo.Time.Before(to) {
		to = s.ValidTo.Time
	}
	if to.Before(from) {
		return nil
	}
	hs, err := h.Queries.ListHolidaysBetween(ctx, db.ListHolidaysBetweenParams{FromDay: pgDate(from), ToDay: pgDate(to)})
	if err != nil {
		return err
	}
	holidays := map[string]string{}
	for _, x := range hs {
		holidays[agenda.FormatDate(x.Day.Time)] = x.Name
	}
	for _, d := range rule.Days(from, to) {
		start, end := rule.Span(d, loc)
		if !end.After(now) {
			continue
		}
		holiday := holidays[agenda.FormatDate(d)]
		if _, err := h.Queries.InsertSeriesWindow(ctx, db.InsertSeriesWindowParams{
			ServiceID: s.ServiceID, AssetID: s.AssetID, TerritorialUnitID: s.TerritorialUnitID, OrganizationID: s.OrganizationID,
			AreaID: s.AreaID, TeamID: s.TeamID, Title: s.Title, Notes: s.Notes, StartsAt: pgTime(start), EndsAt: pgTime(end),
			SuppressNotifications: s.SuppressNotifications, Priority: s.Priority, CreatedBy: s.CreatedBy, Active: holiday == "",
			SeriesID: pgUUIDOf(s.ID), SeriesDay: pgDate(d), HolidayName: optText(holiday),
		}); err != nil {
			return err
		}
	}
	return nil
}
