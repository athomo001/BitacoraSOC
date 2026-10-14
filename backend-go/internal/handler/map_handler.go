package handler

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MapHandler cubre el Mapa (#24): las localidades con coordenadas y lo que
// hay que revisar en ellas (incidentes abiertos, mantenimientos activos y
// tickets abiertos con lugar), y
// de dónde salen los mosaicos del fondo. Módulo NOC (gate en main.go).
type MapHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Hub      eventPublisher
}

type mapPointDTO struct {
	ID                uuid.UUID  `json:"id"`
	Kind              string     `json:"kind"`
	Name              string     `json:"name"`
	ParentName        *string    `json:"parentName,omitempty"`
	Latitude          float64    `json:"latitude"`
	Longitude         float64    `json:"longitude"`
	OpenIncidents     int32      `json:"openIncidents"`
	LastIncidentTitle *string    `json:"lastIncidentTitle,omitempty"`
	MaintenanceUntil  *time.Time `json:"maintenanceUntil,omitempty"`
	MaintenanceTitle  *string    `json:"maintenanceTitle,omitempty"`
	// Tickets abiertos con lugar en la localidad (000038); 0 con la Ticketera apagada.
	OpenTickets     int32   `json:"openTickets"`
	LastTicketTitle *string `json:"lastTicketTitle,omitempty"`
}

// ticketsOn: los tickets solo entran al mapa con la Ticketera encendida.
func (h *MapHandler) ticketsOn(ctx context.Context) bool {
	f, err := h.Queries.GetSystemFeature(ctx, ticketsFeature)
	return err == nil && f.IsEnabled
}

// Points es GET /api/map/points: solo lo que el mapa pinta, sin paginar
// (un país entero son unos cientos de filas livianas).
func (h *MapHandler) Points(w http.ResponseWriter, r *http.Request) {
	scope, err := loadTicketScope(r.Context(), h.Queries)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el mapa")
		return
	}
	// Solo los tickets que la persona ve en la Ticketera (9.1).
	rows, err := h.Queries.ListMapPoints(r.Context(), scope.visible())
	withTickets := h.ticketsOn(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el mapa")
		return
	}
	out := make([]mapPointDTO, 0, len(rows))
	for _, row := range rows {
		if row.Latitude == nil || row.Longitude == nil {
			continue
		}
		p := mapPointDTO{
			ID: row.ID, Kind: string(row.Kind), Name: row.Name, ParentName: textPtr(row.ParentName),
			Latitude: *row.Latitude, Longitude: *row.Longitude, OpenIncidents: row.OpenIncidents,
			LastIncidentTitle: textPtr(row.LastIncidentTitle), MaintenanceTitle: textPtr(row.MaintenanceTitle),
		}
		if row.MaintenanceUntil.Valid {
			p.MaintenanceUntil = &row.MaintenanceUntil.Time
		}
		if withTickets {
			p.OpenTickets, p.LastTicketTitle = row.OpenTickets, textPtr(row.LastTicketTitle)
		} else if row.Kind == db.TerritorialKindCountry && row.OpenIncidents == 0 && !row.MaintenanceUntil.Valid {
			continue // el país estaba solo por sus tickets
		}
		out = append(out, p)
	}
	writeData(w, http.StatusOK, out)
}

type mapIncidentDTO struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	GlpiTicket *string   `json:"glpiTicket,omitempty"`
	OpenedAt   time.Time `json:"openedAt"`
	AssetName  *string   `json:"assetName,omitempty"`
}

type mapWindowDTO struct {
	ID                    uuid.UUID `json:"id"`
	Title                 string    `json:"title"`
	EndsAt                time.Time `json:"endsAt"`
	SuppressNotifications bool      `json:"suppressNotifications"`
	AssetName             *string   `json:"assetName,omitempty"`
}

type mapTeamDTO struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	CoveredVia string    `json:"coveredVia"`
}

type mapTicketDTO struct {
	ID           uuid.UUID `json:"id"`
	TicketNumber string    `json:"ticketNumber"`
	Title        string    `json:"title"`
	Priority     string    `json:"priority"`
	Status       string    `json:"status"`
	AssetName    *string   `json:"assetName,omitempty"`
}

type mapUnitDTO struct {
	Incidents []mapIncidentDTO `json:"incidents"`
	Windows   []mapWindowDTO   `json:"windows"`
	Teams     []mapTeamDTO     `json:"teams"`
	Tickets   []mapTicketDTO   `json:"tickets"`
}

// Unit es GET /api/map/units/{id}: el detalle de una localidad elegida en el
// mapa. No trae contactos (eso es Escalamiento, que audita su lectura).
func (h *MapHandler) Unit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "id inválido")
		return
	}
	if _, err := h.Queries.GetTerritorialUnit(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la localidad no existe")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la localidad")
		return
	}
	incidents, err := h.Queries.ListMapUnitIncidents(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los incidentes")
		return
	}
	windows, err := h.Queries.ListMapUnitWindows(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los mantenimientos")
		return
	}
	teams, err := h.Queries.ListMapUnitTeams(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los equipos")
		return
	}
	out := mapUnitDTO{Incidents: []mapIncidentDTO{}, Windows: []mapWindowDTO{}, Teams: []mapTeamDTO{}, Tickets: []mapTicketDTO{}}
	if h.ticketsOn(ctx) {
		rows, err := h.Queries.ListMapUnitTickets(ctx, db.ListMapUnitTicketsParams{UnitID: id, VisibleAreas: ticketScopeVisible(ctx, h.Queries)})
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los tickets")
			return
		}
		for _, t := range rows {
			out.Tickets = append(out.Tickets, mapTicketDTO{ID: t.ID, TicketNumber: t.TicketNumber, Title: t.Title, Priority: string(t.Priority), Status: string(t.Status), AssetName: textPtr(t.AssetName)})
		}
	}
	for _, i := range incidents {
		out.Incidents = append(out.Incidents, mapIncidentDTO{ID: i.ID, Title: i.Title, GlpiTicket: textPtr(i.GlpiTicket), OpenedAt: i.OpenedAt.Time, AssetName: textPtr(i.AssetName)})
	}
	for _, m := range windows {
		out.Windows = append(out.Windows, mapWindowDTO{ID: m.ID, Title: m.Title, EndsAt: m.EndsAt.Time, SuppressNotifications: m.SuppressNotifications, AssetName: textPtr(m.AssetName)})
	}
	for _, t := range teams {
		out.Teams = append(out.Teams, mapTeamDTO{ID: t.ID, Name: t.Name, CoveredVia: t.CoveredVia})
	}
	writeData(w, http.StatusOK, out)
}

type mapTilesDTO struct {
	Mode string `json:"mode"`
	URL  string `json:"url"`
}

// GetTiles es GET /api/config/map-tiles.
func (h *MapHandler) GetTiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	row, err := h.Queries.GetMapTiles(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	writeData(w, http.StatusOK, mapTilesDTO{Mode: row.MapTilesMode, URL: row.MapTilesUrl})
}

const maxMapTilesURLLength = 500

// validTilesURL: una plantilla http(s) con {z}, {x} e {y}, como la que usa Leaflet.
func validTilesURL(raw string) bool {
	if len(raw) > maxMapTilesURLLength {
		return false
	}
	for _, p := range []string{"{z}", "{x}", "{y}"} {
		if !strings.Contains(raw, p) {
			return false
		}
	}
	u, err := url.Parse(strings.NewReplacer("{z}", "0", "{x}", "0", "{y}", "0", "{s}", "a").Replace(raw))
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

// PutTiles es PUT /api/config/map-tiles (admin).
func (h *MapHandler) PutTiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req mapTilesDTO
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	switch req.Mode {
	case "osm", "none":
		req.URL = ""
	case "custom":
		if !validTilesURL(req.URL) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-tiles-url", "la dirección debe empezar con http:// o https:// y tener {z}, {x} e {y}")
			return
		}
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "mode debe ser osm, custom o none")
		return
	}
	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	if err := h.Queries.SetMapTiles(ctx, db.SetMapTilesParams{Mode: req.Mode, Url: req.URL}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	h.AuditLog.Log(ctx, "config.map_tiles.update", audit.LevelInfo, audit.Success(), map[string]any{"mode": req.Mode, "url": req.URL})
	publishSync(ctx, h.Hub, "config.map_tiles.updated", req)
	writeData(w, http.StatusOK, req)
}

// ticketScopeVisible: las áreas cuyos tickets ve el usuario (nil = todas; ante un error, ninguna).
func ticketScopeVisible(ctx context.Context, q *db.Queries) []uuid.UUID {
	scope, err := loadTicketScope(ctx, q)
	if err != nil {
		return []uuid.UUID{}
	}
	return scope.visible()
}
