package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Enlaces públicos (10h; diseño aprobado por el dueño 2026-10-22,
// <https://claude.ai/artifact/5DbgXPNMtdtocb1bhgBEoi>): páginas de solo
// lectura que se abren sin iniciar sesión. Guardias, Ticketera y Mapa NOC
// para las TV de la sala; el estado de un cliente para mandárselo; y el
// teletrabajo que ya existía (su página sigue en /p/telework/{token}). El
// token se muestra una sola vez al crearlo o cambiarlo: solo se guarda su
// SHA-256, como el de teletrabajo.
type PublicLinksHandler struct {
	Queries       *db.Queries
	AuditLog      *audit.Logger
	PublicBaseURL string
	// Now: el reloj (las pruebas lo fijan).
	Now func() time.Time
}

const maxPublicLinkName = 80

var publicLinkKinds = []string{"telework", "guards", "tickets", "map", "client"}

func (h *PublicLinksHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *PublicLinksHandler) linkURL(slug, token string) string {
	base := strings.TrimRight(h.PublicBaseURL, "/")
	if slug == teleworkShareSlug {
		return base + "/p/telework/" + token
	}
	return base + "/p/v/" + token
}

// kindAvailable: un tipo cuyo módulo está apagado no se ofrece ni se muestra.
func kindAvailable(ctx context.Context, q *db.Queries, slug string) bool {
	switch slug {
	case "map":
		flags, err := repository.ModuleFlags(ctx, q)
		return err == nil && flags.Enabled(modules.NOC)
	case "tickets":
		f, err := q.GetSystemFeature(ctx, ticketsFeature)
		return err == nil && f.IsEnabled
	}
	return slices.Contains(publicLinkKinds, slug)
}

type publicLinkDTO struct {
	ID               uuid.UUID   `json:"id"`
	Kind             string      `json:"kind"`
	Name             string      `json:"name"`
	Active           bool        `json:"active"`
	AreaIDs          []uuid.UUID `json:"areaIds"`
	OrganizationID   *uuid.UUID  `json:"organizationId,omitempty"`
	OrganizationName string      `json:"organizationName,omitempty"`
	CreatedAt        time.Time   `json:"createdAt"`
	CreatedBy        string      `json:"createdBy"`
	LastAccessedAt   *time.Time  `json:"lastAccessedAt,omitempty"`
	// URL: solo al crearlo o cambiarlo; después no se puede volver a ver.
	URL string `json:"url,omitempty"`
}

// Meta es GET /api/public-links/meta: los tipos que se pueden crear.
func (h *PublicLinksHandler) Meta(w http.ResponseWriter, r *http.Request) {
	kinds := []string{}
	for _, k := range publicLinkKinds {
		if kindAvailable(r.Context(), h.Queries, k) {
			kinds = append(kinds, k)
		}
	}
	writeData(w, http.StatusOK, map[string]any{"kinds": kinds})
}

// List es GET /api/public-links.
func (h *PublicLinksHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListPublicLinks(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los enlaces")
		return
	}
	out := make([]publicLinkDTO, 0, len(rows))
	for _, l := range rows {
		d := publicLinkDTO{ID: l.ID, Kind: l.Slug, Name: l.Name, Active: l.IsActive, AreaIDs: l.AreaIds, OrganizationID: uuidPtr(l.OrganizationID),
			OrganizationName: l.OrganizationName, CreatedAt: l.CreatedAt.Time, CreatedBy: l.CreatedByName}
		if d.AreaIDs == nil {
			d.AreaIDs = []uuid.UUID{}
		}
		if l.LastAccessedAt.Valid {
			d.LastAccessedAt = &l.LastAccessedAt.Time
		}
		out = append(out, d)
	}
	writeData(w, http.StatusOK, out)
}

type createPublicLinkRequest struct {
	Kind           string      `json:"kind"`
	Name           string      `json:"name"`
	AreaIDs        []uuid.UUID `json:"areaIds"`
	OrganizationID *uuid.UUID  `json:"organizationId"`
}

// Create es POST /api/public-links: responde la URL, que no se vuelve a mostrar.
func (h *PublicLinksHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createPublicLinkRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if !kindAvailable(ctx, h.Queries, req.Kind) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "tipo de enlace inválido")
		return
	}
	if req.Name == "" || utf8.RuneCountInString(req.Name) > maxPublicLinkName {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "ponle un nombre de hasta 80 caracteres para reconocerlo")
		return
	}
	if (req.Kind == "client") != (req.OrganizationID != nil) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el estado de un cliente necesita el cliente (y solo ese tipo lo lleva)")
		return
	}
	if req.Kind != "guards" && req.Kind != "tickets" {
		req.AreaIDs = nil // solo guardias y Ticketera se acotan por área
	}
	if (req.Kind == "guards" || req.Kind == "tickets") && len(req.AreaIDs) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige al menos un área")
		return
	}
	if req.AreaIDs == nil {
		req.AreaIDs = []uuid.UUID{}
	}
	token, hash, err := newShareToken()
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo generar el enlace")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	link, err := h.Queries.CreatePublicLink(ctx, db.CreatePublicLinkParams{Slug: req.Kind, Name: req.Name, TokenHash: hash, CreatedBy: user.ID,
		AreaIds: req.AreaIDs, OrganizationID: optionalUUID(req.OrganizationID)})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el cliente no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el enlace")
		return
	}
	h.AuditLog.Log(ctx, "public_link.create", audit.LevelInfo, audit.Success(), map[string]any{"linkId": link.ID.String(), "kind": link.Slug, "name": link.Name})
	writeData(w, http.StatusCreated, publicLinkDTO{ID: link.ID, Kind: link.Slug, Name: link.Name, Active: true, AreaIDs: link.AreaIds,
		OrganizationID: uuidPtr(link.OrganizationID), CreatedAt: link.CreatedAt.Time, CreatedBy: user.Username, URL: h.linkURL(link.Slug, token)})
}

// Rotate es POST /api/public-links/{id}/rotate: un enlace nuevo; el anterior deja de abrir.
func (h *PublicLinksHandler) Rotate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "enlace no encontrado")
		return
	}
	token, hash, err := newShareToken()
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo generar el enlace")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	link, err := h.Queries.RotatePublicShareLink(ctx, db.RotatePublicShareLinkParams{ID: id, TokenHash: hash, CreatedBy: user.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "enlace no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cambiar el enlace")
		return
	}
	h.AuditLog.Log(ctx, "public_link.rotate", audit.LevelInfo, audit.Success(), map[string]any{"linkId": link.ID.String(), "kind": link.Slug, "name": link.Name})
	writeData(w, http.StatusOK, map[string]any{"url": h.linkURL(link.Slug, token)})
}

type patchPublicLinkRequest struct {
	Name   *string `json:"name"`
	Active *bool   `json:"active"`
}

// Patch es PATCH /api/public-links/{id}: nombre o activo.
func (h *PublicLinksHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "enlace no encontrado")
		return
	}
	var req patchPublicLinkRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	p := db.UpdatePublicLinkParams{ID: id, IsActive: optionalBool(req.Active)}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || utf8.RuneCountInString(name) > maxPublicLinkName {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "ponle un nombre de hasta 80 caracteres")
			return
		}
		p.Name = optText(name)
	}
	link, err := h.Queries.UpdatePublicLink(ctx, p)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "enlace no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	h.AuditLog.Log(ctx, "public_link.update", audit.LevelInfo, audit.Success(), map[string]any{"linkId": link.ID.String(), "active": link.IsActive, "name": link.Name})
	writeData(w, http.StatusOK, map[string]any{"id": link.ID, "name": link.Name, "active": link.IsActive})
}

// Delete es DELETE /api/public-links/{id}.
func (h *PublicLinksHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "enlace no encontrado")
		return
	}
	link, err := h.Queries.GetPublicLink(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "enlace no encontrado")
		return
	}
	if _, err := h.Queries.DeletePublicLink(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar")
		return
	}
	h.AuditLog.Log(ctx, "public_link.delete", audit.LevelInfo, audit.Success(), map[string]any{"linkId": id.String(), "kind": link.Slug, "name": link.Name})
	writeNoContent(w)
}

// ===== Las vistas =====

type publicViewDTO struct {
	Kind        string               `json:"kind"`
	Name        string               `json:"name"`
	GeneratedAt time.Time            `json:"generatedAt"`
	Guards      []publicGuardAreaDTO `json:"guards,omitempty"`
	Tickets     []boardTicketDTO     `json:"tickets,omitempty"`
	AreaNames   []string             `json:"areaNames,omitempty"`
	Map         *publicMapDTO        `json:"map,omitempty"`
	Client      *publicClientDTO     `json:"client,omitempty"`
}

// View es GET /api/public/views/{token}, sin sesión. Token mal formado,
// inexistente, desactivado o de un módulo apagado: el mismo 404.
func (h *PublicLinksHandler) View(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := r.PathValue("token")
	notFound := func() {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "este enlace no está disponible")
	}
	if !teleworkTokenRe.MatchString(token) {
		notFound()
		return
	}
	sum := sha256.Sum256([]byte(token))
	link, err := h.Queries.GetActivePublicShareByTokenHash(ctx, hex.EncodeToString(sum[:]))
	if err != nil || link.Slug == teleworkShareSlug || !kindAvailable(ctx, h.Queries, link.Slug) {
		notFound()
		return
	}
	now := h.now()
	out := publicViewDTO{Kind: link.Slug, Name: link.Name, GeneratedAt: now}
	areaNames, err := h.areaNames(ctx)
	if err == nil {
		for _, id := range link.AreaIds {
			if n, ok := areaNames[id]; ok {
				out.AreaNames = append(out.AreaNames, n)
			}
		}
	}
	switch link.Slug {
	case "guards":
		out.Guards, err = h.guards(ctx, link.AreaIds, areaNames, now)
	case "tickets":
		out.Tickets, err = h.tickets(ctx, link.AreaIds)
	case "map":
		out.Map, err = h.mapView(ctx)
	case "client":
		out.Client, err = h.client(ctx, link.OrganizationID.Bytes)
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la información")
		return
	}
	_ = h.Queries.TouchPublicShareAccess(ctx, link.ID)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	writeData(w, http.StatusOK, out)
}

func (h *PublicLinksHandler) areaNames(ctx context.Context) (map[uuid.UUID]string, error) {
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID]string{}
	for _, a := range areas {
		if a.Active {
			out[a.ID] = a.Name
		}
	}
	return out, nil
}

// --- Guardias ---

type publicGuardDTO struct {
	Label         string     `json:"label"`
	People        []string   `json:"people"`
	Until         *time.Time `json:"until,omitempty"`
	Next          []string   `json:"next"`
	NextFrom      *time.Time `json:"nextFrom,omitempty"`
	MustBeCovered bool       `json:"mustBeCovered"`
}

type publicGuardAreaDTO struct {
	Area   string           `json:"area"`
	Guards []publicGuardDTO `json:"guards"`
}

// guards: quién está de guardia ahora en cada guardia de esas áreas, hasta
// cuándo y quién sigue. Solo nombres: nada de teléfonos ni correos.
func (h *PublicLinksHandler) guards(ctx context.Context, areaIDs []uuid.UUID, areaNames map[uuid.UUID]string, now time.Time) ([]publicGuardAreaDTO, error) {
	cycles, err := h.Queries.ListGuardCycles(ctx)
	if err != nil {
		return nil, err
	}
	out := []publicGuardAreaDTO{}
	for _, areaID := range areaIDs {
		name, ok := areaNames[areaID]
		if !ok {
			continue
		}
		group := publicGuardAreaDTO{Area: name, Guards: []publicGuardDTO{}}
		for _, c := range cycles {
			if !c.AreaID.Valid || uuid.UUID(c.AreaID.Bytes) != areaID {
				continue
			}
			g, err := h.guard(ctx, c, now)
			if err != nil {
				return nil, err
			}
			group.Guards = append(group.Guards, g)
		}
		if len(group.Guards) > 0 {
			out = append(out, group)
		}
	}
	return out, nil
}

func (h *PublicLinksHandler) guard(ctx context.Context, c db.ListGuardCyclesRow, now time.Time) (publicGuardDTO, error) {
	g := publicGuardDTO{Label: c.TeamName, People: []string{}, Next: []string{}, MustBeCovered: c.MustBeCovered}
	current, err := resolveCurrentTeamMembers(ctx, h.Queries, c.TeamID, now)
	if err != nil {
		return g, err
	}
	var until time.Time
	for _, cur := range current {
		g.People = append(g.People, h.memberName(ctx, cur.TeamMemberID))
		if !cur.Until.IsZero() && (until.IsZero() || cur.Until.Before(until)) {
			until = cur.Until
		}
	}
	// Quién sigue: al terminar la guardia actual o, sin nadie ahora, el
	// primer día de la próxima semana en que haya alguien.
	probes := []time.Time{}
	if !until.IsZero() {
		g.Until = &until
		probes = append(probes, until.Add(time.Minute))
	} else {
		for d := 1; d <= 7; d++ {
			probes = append(probes, now.AddDate(0, 0, d))
		}
	}
	for _, at := range probes {
		next, err := resolveCurrentTeamMembers(ctx, h.Queries, c.TeamID, at)
		if err != nil {
			return g, err
		}
		if len(next) == 0 {
			continue
		}
		for _, n := range next {
			g.Next = append(g.Next, h.memberName(ctx, n.TeamMemberID))
		}
		from := at
		if !next[0].Since.IsZero() {
			from = next[0].Since
		}
		g.NextFrom = &from
		break
	}
	return g, nil
}

func (h *PublicLinksHandler) memberName(ctx context.Context, id uuid.UUID) string {
	name, err := h.Queries.GetTeamMemberPublicName(ctx, id)
	if err != nil || name == "" {
		return "—"
	}
	return name
}

// --- Ticketera ---

type boardTicketDTO struct {
	Number   string     `json:"number"`
	Title    string     `json:"title"`
	Client   string     `json:"client"`
	Assignee string     `json:"assignee"`
	DueAt    *time.Time `json:"dueAt,omitempty"`
	OnHold   bool       `json:"onHold"`
}

func (h *PublicLinksHandler) tickets(ctx context.Context, areaIDs []uuid.UUID) ([]boardTicketDTO, error) {
	rows, err := h.Queries.ListPublicBoardTickets(ctx, areaIDs)
	if err != nil {
		return nil, err
	}
	out := make([]boardTicketDTO, 0, len(rows))
	for _, t := range rows {
		d := boardTicketDTO{Number: t.TicketNumber, Title: t.Title, Client: t.ClientName, Assignee: t.Assignee, OnHold: t.SlaOnHoldSince.Valid}
		if t.SlaResolutionDueAt.Valid {
			d.DueAt = &t.SlaResolutionDueAt.Time
		}
		out = append(out, d)
	}
	return out, nil
}

// --- Mapa ---

type publicMapEventDTO struct {
	Place string    `json:"place"`
	Title string    `json:"title"`
	At    time.Time `json:"at"`
}

type publicMapDTO struct {
	Tiles     mapTilesDTO         `json:"tiles"`
	Points    []mapPointDTO       `json:"points"`
	Incidents []publicMapEventDTO `json:"incidents"`
	Windows   []publicMapEventDTO `json:"windows"`
}

// mapView: el Mapa NOC sin tickets (esos quedan en la Ticketera).
func (h *PublicLinksHandler) mapView(ctx context.Context) (*publicMapDTO, error) {
	out := &publicMapDTO{Points: []mapPointDTO{}, Incidents: []publicMapEventDTO{}, Windows: []publicMapEventDTO{}}
	if err := h.Queries.EnsureAppConfigRow(ctx); err != nil {
		return nil, err
	}
	tiles, err := h.Queries.GetMapTiles(ctx)
	if err != nil {
		return nil, err
	}
	out.Tiles = mapTilesDTO{Mode: tiles.MapTilesMode, URL: tiles.MapTilesUrl}
	points, err := h.Queries.ListMapPoints(ctx, []uuid.UUID{})
	if err != nil {
		return nil, err
	}
	for _, p := range points {
		if p.Latitude == nil || p.Longitude == nil || (p.Kind == db.TerritorialKindCountry && p.OpenIncidents == 0 && !p.MaintenanceUntil.Valid) {
			continue
		}
		d := mapPointDTO{ID: p.ID, Kind: string(p.Kind), Name: p.Name, ParentName: textPtr(p.ParentName), Latitude: *p.Latitude, Longitude: *p.Longitude,
			OpenIncidents: p.OpenIncidents, LastIncidentTitle: textPtr(p.LastIncidentTitle), MaintenanceTitle: textPtr(p.MaintenanceTitle)}
		if p.MaintenanceUntil.Valid {
			d.MaintenanceUntil = &p.MaintenanceUntil.Time
		}
		out.Points = append(out.Points, d)
	}
	incidents, err := h.Queries.ListPublicMapIncidents(ctx)
	if err != nil {
		return nil, err
	}
	for _, i := range incidents {
		out.Incidents = append(out.Incidents, publicMapEventDTO{Place: i.Place, Title: i.Title, At: i.OpenedAt.Time})
	}
	windows, err := h.Queries.ListPublicMapWindows(ctx)
	if err != nil {
		return nil, err
	}
	for _, m := range windows {
		out.Windows = append(out.Windows, publicMapEventDTO{Place: m.Place, Title: m.Title, At: m.EndsAt.Time})
	}
	return out, nil
}

// --- Estado de un cliente ---

type publicServiceDTO struct {
	Name             string     `json:"name"`
	IncidentSince    *time.Time `json:"incidentSince,omitempty"`
	MaintenanceUntil *time.Time `json:"maintenanceUntil,omitempty"`
}

type publicClientWindowDTO struct {
	Title    string    `json:"title"`
	StartsAt time.Time `json:"startsAt"`
	EndsAt   time.Time `json:"endsAt"`
	// Service: "" = todos sus servicios.
	Service string `json:"service"`
}

type publicClientRecentDTO struct {
	Service  string    `json:"service"`
	OpenedAt time.Time `json:"openedAt"`
	ClosedAt time.Time `json:"closedAt"`
}

type publicClientDTO struct {
	Name     string                  `json:"name"`
	Services []publicServiceDTO      `json:"services"`
	Windows  []publicClientWindowDTO `json:"windows"`
	Recent   []publicClientRecentDTO `json:"recent"`
}

// client: lo que el cliente ve de lo suyo. Nunca el título interno de un
// incidente (decisión del dueño 2026-10-22): solo el servicio y desde cuándo.
func (h *PublicLinksHandler) client(ctx context.Context, orgID uuid.UUID) (*publicClientDTO, error) {
	org, err := h.Queries.GetOrganization(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := &publicClientDTO{Name: org.Name, Services: []publicServiceDTO{}, Windows: []publicClientWindowDTO{}, Recent: []publicClientRecentDTO{}}
	services, err := h.Queries.ListPublicClientServices(ctx, orgID)
	if err != nil {
		return nil, err
	}
	for _, s := range services {
		d := publicServiceDTO{Name: s.Name}
		if s.IncidentSince.Valid {
			d.IncidentSince = &s.IncidentSince.Time
		}
		if s.MaintenanceUntil.Valid {
			d.MaintenanceUntil = &s.MaintenanceUntil.Time
		}
		out.Services = append(out.Services, d)
	}
	windows, err := h.Queries.ListPublicClientWindows(ctx, pgUUIDOf(orgID))
	if err != nil {
		return nil, err
	}
	for _, m := range windows {
		out.Windows = append(out.Windows, publicClientWindowDTO{Title: m.Title, StartsAt: m.StartsAt.Time, EndsAt: m.EndsAt.Time, Service: m.ServiceName})
	}
	recent, err := h.Queries.ListPublicClientRecent(ctx, orgID)
	if err != nil {
		return nil, err
	}
	for _, i := range recent {
		out.Recent = append(out.Recent, publicClientRecentDTO{Service: i.ServiceName, OpenedAt: i.OpenedAt.Time, ClosedAt: i.ClosedAt.Time})
	}
	return out, nil
}
