package handler

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/tickets"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TicketSeriesHandler es la numeración de tickets (Administración →
// Ticketera; pedido del dueño 2026-10-16): una general y otras que se
// asignan a las áreas. Numera el área que pide el ticket; el correlativo
// nunca vuelve a 1.
type TicketSeriesHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	Now      func() time.Time
}

func (h *TicketSeriesHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

type ticketSeriesAreaDTO struct {
	ID       uuid.UUID  `json:"id"`
	Code     string     `json:"code"`
	Name     string     `json:"name"`
	Active   bool       `json:"active"`
	SeriesID *uuid.UUID `json:"seriesId,omitempty"`
}

type ticketSeriesDTO struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Prefix     string    `json:"prefix"`
	YearFormat string    `json:"yearFormat"`
	Digits     int32     `json:"digits"`
	NextNumber int64     `json:"nextNumber"`
	IsDefault  bool      `json:"isDefault"`
	// Preview: cómo saldrá el próximo ticket.
	Preview string `json:"preview"`
}

func toTicketSeriesDTO(s db.TicketNumberSeries, now time.Time) ticketSeriesDTO {
	return ticketSeriesDTO{ID: s.ID, Name: s.Name, Prefix: s.Prefix, YearFormat: s.YearFormat, Digits: s.Digits, NextNumber: s.NextNumber,
		IsDefault: s.IsDefault, Preview: tickets.FormatNumber(s.Prefix, s.YearFormat, int(s.Digits), s.NextNumber, now)}
}

// List: GET /api/config/ticket-series → {series, areas}.
func (h *TicketSeriesHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	series, err := h.Queries.ListTicketSeries(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la numeración")
		return
	}
	areas, err := h.Queries.ListAreaTicketSeries(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	out := struct {
		Series []ticketSeriesDTO     `json:"series"`
		Areas  []ticketSeriesAreaDTO `json:"areas"`
	}{Series: make([]ticketSeriesDTO, 0, len(series)), Areas: make([]ticketSeriesAreaDTO, 0, len(areas))}
	now := h.now()
	for _, s := range series {
		out.Series = append(out.Series, toTicketSeriesDTO(s, now))
	}
	for _, a := range areas {
		out.Areas = append(out.Areas, ticketSeriesAreaDTO{ID: a.ID, Code: a.Code, Name: a.Name, Active: a.Active, SeriesID: uuidPtr(a.TicketSeriesID)})
	}
	writeData(w, http.StatusOK, out)
}

type ticketSeriesRequest struct {
	Name       string `json:"name"`
	Prefix     string `json:"prefix"`
	YearFormat string `json:"yearFormat"`
	Digits     int32  `json:"digits"`
	NextNumber int64  `json:"nextNumber"`
	IsDefault  bool   `json:"isDefault"`
}

var seriesPrefix = regexp.MustCompile(`^[A-Z0-9]{1,10}$`)

func (req *ticketSeriesRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	req.Prefix = strings.ToUpper(strings.TrimSpace(req.Prefix))
	switch {
	case req.Name == "" || len([]rune(req.Name)) > 60:
		return "el nombre es obligatorio (hasta 60 caracteres)"
	case !seriesPrefix.MatchString(req.Prefix):
		return "el prefijo va con letras y números, sin espacios (hasta 10)"
	case req.YearFormat != "none" && req.YearFormat != "yyyy" && req.YearFormat != "yy":
		return "el año va como none, yyyy o yy"
	case req.Digits < 3 || req.Digits > 10:
		return "los dígitos van de 3 a 10"
	case req.NextNumber < 1:
		return "el próximo número parte en 1"
	}
	return ""
}

// Create: POST /api/config/ticket-series.
func (h *TicketSeriesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req ticketSeriesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	var created db.TicketNumberSeries
	err := h.inTx(r.Context(), func(q *db.Queries) error {
		s, err := q.CreateTicketSeries(r.Context(), db.CreateTicketSeriesParams{Name: req.Name, Prefix: req.Prefix, YearFormat: req.YearFormat, Digits: req.Digits, NextNumber: req.NextNumber})
		if err != nil {
			return err
		}
		created = s
		if req.IsDefault {
			return makeDefaultSeries(r.Context(), q, s.ID)
		}
		return nil
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la numeración")
		return
	}
	h.AuditLog.Log(r.Context(), "ticket_series.create", audit.LevelInfo, audit.Success(), map[string]any{"seriesId": created.ID.String(), "prefix": created.Prefix, "default": req.IsDefault})
	h.List(w, r)
}

// Update: PUT /api/config/ticket-series/{id}. El próximo número solo sube:
// bajarlo repetiría números ya usados.
func (h *TicketSeriesHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "numeración no encontrada")
		return
	}
	var req ticketSeriesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	ctx := r.Context()
	var before db.TicketNumberSeries
	err = h.inTx(ctx, func(q *db.Queries) error {
		current, err := q.GetTicketSeries(ctx, id)
		if err != nil {
			return err
		}
		before = current
		if req.NextNumber < current.NextNumber {
			return errLowerNext
		}
		if current.IsDefault && !req.IsDefault {
			return errKeepDefault
		}
		if _, err := q.UpdateTicketSeries(ctx, db.UpdateTicketSeriesParams{ID: id, Name: req.Name, Prefix: req.Prefix, YearFormat: req.YearFormat, Digits: req.Digits, NextNumber: req.NextNumber}); err != nil {
			return err
		}
		if req.IsDefault && !current.IsDefault {
			return makeDefaultSeries(ctx, q, id)
		}
		return nil
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "numeración no encontrada")
		return
	case errors.Is(err, errLowerNext):
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el próximo número no puede bajar (se repetirían números ya usados)")
		return
	case errors.Is(err, errKeepDefault):
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "para cambiar la general, marca otra como general")
		return
	case err != nil:
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la numeración")
		return
	}
	h.AuditLog.Log(ctx, "ticket_series.update", audit.LevelInfo, audit.Success(), map[string]any{
		"seriesId": id.String(), "before": before.Prefix + "/" + before.YearFormat, "prefix": req.Prefix, "yearFormat": req.YearFormat,
		"digits": req.Digits, "nextNumber": req.NextNumber, "default": req.IsDefault})
	h.List(w, r)
}

var (
	errLowerNext   = errors.New("next lower")
	errKeepDefault = errors.New("keep default")
)

func makeDefaultSeries(ctx context.Context, q *db.Queries, id uuid.UUID) error {
	if err := q.ClearDefaultTicketSeries(ctx); err != nil {
		return err
	}
	return q.MakeDefaultTicketSeries(ctx, id)
}

// Delete: DELETE /api/config/ticket-series/{id} (no la general). Las áreas
// que la usaban pasan a la general; los tickets conservan su número.
func (h *TicketSeriesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "numeración no encontrada")
		return
	}
	n, err := h.Queries.DeleteTicketSeries(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar la numeración")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusConflict, "series-default", "la general no se borra (marca otra como general primero)")
		return
	}
	h.AuditLog.Log(r.Context(), "ticket_series.delete", audit.LevelInfo, audit.Success(), map[string]any{"seriesId": id.String()})
	h.List(w, r)
}

// Assign: PUT /api/config/ticket-series/areas {assignments: [{areaId, seriesId|null}]}.
func (h *TicketSeriesHandler) Assign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Assignments []struct {
			AreaID   uuid.UUID  `json:"areaId"`
			SeriesID *uuid.UUID `json:"seriesId"`
		} `json:"assignments"`
	}
	if err := decodeJSON(w, r, &req); err != nil || len(req.Assignments) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "manda qué numeración usa cada área")
		return
	}
	ctx := r.Context()
	err := h.inTx(ctx, func(q *db.Queries) error {
		for _, a := range req.Assignments {
			series := pgtype.UUID{}
			if a.SeriesID != nil {
				series = pgtype.UUID{Bytes: *a.SeriesID, Valid: true}
			}
			n, err := q.SetAreaTicketSeries(ctx, db.SetAreaTicketSeriesParams{ID: a.AreaID, SeriesID: series})
			if err != nil {
				return err
			}
			if n == 0 {
				return pgx.ErrNoRows
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "un área o una numeración no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la asignación")
		return
	}
	h.AuditLog.Log(ctx, "ticket_series.assign", audit.LevelInfo, audit.Success(), map[string]any{"areas": len(req.Assignments)})
	h.List(w, r)
}

func (h *TicketSeriesHandler) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	if h.Pool == nil { // pruebas: Queries ya va sobre una transacción
		return fn(h.Queries)
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // tras Commit no hace nada
	if err := fn(h.Queries.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// areaSeriesExamples: cómo numera cada área (para la ficha del área, solo vista).
func areaSeriesExamples(ctx context.Context, q *db.Queries, now time.Time) (map[uuid.UUID]ticketSeriesDTO, *ticketSeriesDTO) {
	series, err := q.ListTicketSeries(ctx)
	if err != nil {
		return nil, nil
	}
	byID := map[uuid.UUID]ticketSeriesDTO{}
	var general *ticketSeriesDTO
	for _, s := range series {
		dto := toTicketSeriesDTO(s, now)
		byID[s.ID] = dto
		if s.IsDefault {
			general = &dto
		}
	}
	return byID, general
}
