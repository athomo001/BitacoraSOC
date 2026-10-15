package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Tickets por área (spec/16 §4.1, 9.1, 000039). Cada ticket está en la cola
// del área que lo resuelve y recuerda el área que lo pidió:
//   - quien es de un área trabaja los tickets de su cola y ve (y comenta)
//     los que su área pidió a otras;
//   - el administrador y el perfil Gestión (CSM) ven y trabajan todos;
//   - quien todavía no tiene grupos ni áreas sigue viendo todo, como antes.

const (
	areaSOCID = "a0000000-0000-4000-8000-000000000001"
	areaNOCID = "a0000000-0000-4000-8000-000000000002"
)

// ticketScope: qué tickets ve y trabaja el usuario.
type ticketScope struct {
	all   bool
	areas map[uuid.UUID]bool
}

func loadTicketScope(ctx context.Context, q *db.Queries) (ticketScope, error) {
	user, _ := middleware.UserFromContext(ctx)
	s := ticketScope{areas: map[uuid.UUID]bool{}}
	if user.Role == "admin" {
		s.all = true
		return s, nil
	}
	rows, err := q.ListUserTicketGroups(ctx, user.ID)
	if err != nil {
		return s, err
	}
	for _, r := range rows {
		if r.Profile == "gestion" {
			s.all = true
		}
		if r.AreaID.Valid {
			s.areas[uuid.UUID(r.AreaID.Bytes)] = true
		}
	}
	if len(s.areas) == 0 {
		s.all = true // sin áreas todavía: como antes del 9.1
	}
	return s, nil
}

// visible: las áreas para filtrar (nil = todas).
func (s ticketScope) visible() []uuid.UUID {
	if s.all {
		return nil
	}
	return s.list()
}

func (s ticketScope) list() []uuid.UUID {
	out := make([]uuid.UUID, 0, len(s.areas))
	for id := range s.areas {
		out = append(out, id)
	}
	return out
}

func (s ticketScope) canView(area, requested uuid.UUID) bool {
	return s.all || s.areas[area] || s.areas[requested]
}

func (s ticketScope) canWork(area uuid.UUID) bool { return s.all || s.areas[area] }

// viewOnlyRequest: lo que puede hacer el área que pidió un ticket sin
// trabajarlo: mirarlo, comentarlo y adjuntar imágenes al comentario.
func viewOnlyRequest(r *http.Request) bool {
	if r.Method == http.MethodGet {
		return true
	}
	p := r.URL.Path
	return (r.Method == http.MethodPost && (strings.HasSuffix(p, "/comments") || strings.HasSuffix(p, "/images"))) ||
		(r.Method == http.MethodDelete && strings.Contains(p, "/images/"))
}

// requireTicketAccess corta con 404 si el ticket no es visible para el
// usuario y con 403 si solo lo ve (lo pidió su área) y quiere trabajarlo.
// Las rutas sin {id} filtran por su cuenta (lista, alta, unir).
func (h *TicketsHandler) requireTicketAccess(w http.ResponseWriter, r *http.Request) bool {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		return true
	}
	ctx := r.Context()
	t, err := h.Queries.GetTicketAreas(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return true // el handler responde su propio 404
	}
	scope, err2 := loadTicketScope(ctx, h.Queries)
	if err != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo revisar el acceso al ticket")
		return false
	}
	if !scope.canView(t.AreaID, t.RequestedAreaID) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ticket no encontrado")
		return false
	}
	if !scope.canWork(t.AreaID) && !viewOnlyRequest(r) {
		problemdetails.Write(w, r, http.StatusForbidden, "ticket-other-area", "este ticket lo trabaja otra área: puedes verlo y comentarlo")
		return false
	}
	return true
}

type ticketAreaDTO struct {
	ID       uuid.UUID `json:"id"`
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Resolves bool      `json:"resolves"`
}

type ticketScopeDTO struct {
	All bool `json:"all"`
	// MyAreas: las áreas del usuario, en orden (sus colas y desde dónde pide).
	MyAreas []ticketAreaDTO `json:"myAreas"`
	// Areas: todas las activas; las que resuelven reciben tickets.
	Areas       []ticketAreaDTO `json:"areas"`
	DefaultArea string          `json:"defaultArea"`
}

// ticketAreas: las áreas activas en orden y el alcance del usuario.
func (h *TicketsHandler) ticketAreas(ctx context.Context) ([]db.ListTicketAreasRow, ticketScope, error) {
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return nil, ticketScope{}, err
	}
	scope, err := loadTicketScope(ctx, h.Queries)
	return areas, scope, err
}

// mine: las áreas del usuario en el orden de Áreas y niveles; con resolves, solo las que reciben tickets.
func mine(areas []db.ListTicketAreasRow, scope ticketScope, resolves bool) []db.ListTicketAreasRow {
	out := []db.ListTicketAreasRow{}
	for _, a := range areas {
		if scope.areas[a.ID] && (!resolves || a.DefaultProfile != "gestion") {
			out = append(out, a)
		}
	}
	return out
}

// Scope es GET /api/tickets/scope: las colas del usuario y las áreas a las que puede pedir.
func (h *TicketsHandler) Scope(w http.ResponseWriter, r *http.Request) {
	areas, scope, err := h.ticketAreas(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	out := ticketScopeDTO{All: scope.all, MyAreas: []ticketAreaDTO{}, Areas: []ticketAreaDTO{}}
	for _, a := range areas {
		out.Areas = append(out.Areas, ticketAreaDTO{ID: a.ID, Code: a.Code, Name: a.Name, Resolves: a.DefaultProfile != "gestion"})
	}
	for _, a := range mine(areas, scope, false) {
		out.MyAreas = append(out.MyAreas, ticketAreaDTO{ID: a.ID, Code: a.Code, Name: a.Name, Resolves: a.DefaultProfile != "gestion"})
	}
	out.DefaultArea = defaultTicketArea(areas, scope, "").Code
	writeData(w, http.StatusOK, out)
}

// defaultTicketArea: la primera área propia que resuelve; si no, la del
// alcance (NOC o SOC); si no, la primera que resuelve.
func defaultTicketArea(areas []db.ListTicketAreasRow, scope ticketScope, entryScope db.EntryScope) db.ListTicketAreasRow {
	if own := mine(areas, scope, true); len(own) > 0 && entryScope == "" {
		return own[0]
	}
	want := areaSOCID
	if entryScope == db.EntryScopeNoc {
		want = areaNOCID
	}
	var first *db.ListTicketAreasRow
	for i, a := range areas {
		if a.ID.String() == want {
			return a
		}
		if first == nil && a.DefaultProfile != "gestion" {
			first = &areas[i]
		}
	}
	if first != nil {
		return *first
	}
	return db.ListTicketAreasRow{ID: uuid.MustParse(areaSOCID), Code: "soc", Name: "SOC"}
}

// newTicketAreas resuelve el área que resuelve y la que pide de un ticket
// nuevo: code vacío = la del usuario; la que pide es la del usuario si la
// tiene (si no, la misma que resuelve).
func (h *TicketsHandler) newTicketAreas(ctx context.Context, code string, entryScope db.EntryScope) (uuid.UUID, uuid.UUID, error) {
	areas, scope, err := h.ticketAreas(ctx)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	target := defaultTicketArea(areas, scope, entryScope)
	if code != "" {
		found := false
		for _, a := range areas {
			if a.Code == code && a.DefaultProfile != "gestion" {
				target, found = a, true
			}
		}
		if !found {
			return uuid.Nil, uuid.Nil, errNoTicketArea
		}
	}
	requested := target.ID
	if !scope.areas[target.ID] {
		if own := mine(areas, scope, false); len(own) > 0 {
			requested = own[0].ID
		}
	}
	return target.ID, requested, nil
}

var errNoTicketArea = errors.New("área desconocida o que no recibe tickets")

type deriveTicketRequest struct {
	Area   string `json:"area"`
	Reason string `json:"reason"`
}

// Derive es PUT /api/tickets/{id}/area: pasa el ticket a la cola de otra
// área. Entra como nuevo, sin equipo ni resolutores; el SLA sigue corriendo.
func (h *TicketsHandler) Derive(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req deriveTicketRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" || len([]rune(reason)) > maxRelationReason {
		problemdetails.Write(w, r, 400, "invalid-payload", "el motivo es obligatorio (hasta 500 caracteres)")
		return
	}
	old, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if old.MergedIntoID.Valid || old.Status == db.TicketStatusResolved || old.Status == db.TicketStatusClosed || old.Status == db.TicketStatusCancelled {
		problemdetails.Write(w, r, 409, "ticket-not-open", "solo se deriva un ticket abierto")
		return
	}
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las áreas")
		return
	}
	var from, to *db.ListTicketAreasRow
	for i, a := range areas {
		if a.ID == old.AreaID {
			from = &areas[i]
		}
		if a.Code == req.Area && a.DefaultProfile != "gestion" {
			to = &areas[i]
		}
	}
	if to == nil {
		problemdetails.Write(w, r, 400, "invalid-area", "elige un área activa que reciba tickets")
		return
	}
	if to.ID == old.AreaID {
		problemdetails.Write(w, r, 409, "same-area", "el ticket ya está en esa área")
		return
	}
	fromName := "?"
	if from != nil {
		fromName = from.Name
	}
	user, _ := middleware.UserFromContext(ctx)
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo derivar")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	err = q.DeriveTicket(ctx, db.DeriveTicketParams{ID: id, AreaID: to.ID})
	if err == nil {
		err = q.ClearTicketResolvers(ctx, id)
	}
	if err == nil {
		err = ticketNote(ctx, q, id, user, "Derivado de "+fromName+" a "+to.Name+" · "+reason+".", false, "")
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo derivar")
		return
	}
	h.AuditLog.Log(ctx, "ticket.derived", audit.LevelInfo, audit.Success(), map[string]any{
		"ticketId": id.String(), "fromAreaId": old.AreaID.String(), "toArea": to.Code, "reason": reason,
	})
	h.notifyDerived(ctx, id, to.ID, to.Name, reason, user.ID)
	h.notifyChanged(ctx, id)
	d, err := h.loadDetail(r, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo recargar el ticket")
		return
	}
	writeData(w, 200, d)
}
