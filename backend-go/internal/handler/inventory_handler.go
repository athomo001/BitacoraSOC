package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// InventoryHandler cubre el Inventario (spec/16 §4.2, 9.2, 000040, diseño
// aprobado 2026-10-14): equipos con área dueña, campos según su tipo, varias
// IP, responsables (áreas, personas u organizaciones), historial de cada
// trabajo y solicitudes de baja.
//
// Quién: ve el equipo quien es del área dueña o de un área responsable (el
// admin, el perfil Gestión y quien no tiene áreas ven todos); lo crea y lo
// edita quien es de esas áreas, o el admin; lo desactiva o lo borra el admin
// o la jefatura del área dueña, y los demás lo piden.
type InventoryHandler struct {
	Pool     txBeginner
	Queries  *db.Queries
	AuditLog *audit.Logger
	Hub      eventPublisher
	// Notify avisa a quien decide una solicitud de baja (9.5).
	Notify *Notifier
}

type invAccess struct {
	admin   bool
	viewAll bool
	areas   map[uuid.UUID]bool
	leads   map[uuid.UUID]bool
}

func loadInvAccess(ctx context.Context, q *db.Queries) (invAccess, error) {
	user, _ := middleware.UserFromContext(ctx)
	acc := invAccess{areas: map[uuid.UUID]bool{}, leads: map[uuid.UUID]bool{}}
	if user.Role == "admin" {
		acc.admin, acc.viewAll = true, true
		return acc, nil
	}
	rows, err := q.ListUserTicketGroups(ctx, user.ID)
	if err != nil {
		return acc, err
	}
	for _, r := range rows {
		if r.Profile == "gestion" {
			acc.viewAll = true
		}
		if r.AreaID.Valid {
			acc.areas[uuid.UUID(r.AreaID.Bytes)] = true
		}
	}
	if len(acc.areas) == 0 {
		acc.viewAll = true
	}
	leads, err := q.ListLeadAreas(ctx, user.ID)
	if err != nil {
		return acc, err
	}
	for _, l := range leads {
		acc.leads[l.ID] = true
	}
	return acc, nil
}

func (a invAccess) member(areas []uuid.UUID) bool {
	for _, id := range areas {
		if a.areas[id] {
			return true
		}
	}
	return false
}

func (a invAccess) canView(areas []uuid.UUID) bool { return a.viewAll || a.member(areas) }
func (a invAccess) canEdit(areas []uuid.UUID) bool { return a.admin || a.member(areas) }
func (a invAccess) canDecide(owner uuid.UUID) bool { return a.admin || a.leads[owner] }

func (a invAccess) list() []uuid.UUID {
	out := make([]uuid.UUID, 0, len(a.areas))
	for id := range a.areas {
		out = append(out, id)
	}
	return out
}

// decidable: las áreas cuyas solicitudes decide el usuario (nil = todas).
func (a invAccess) decidable() []uuid.UUID {
	if a.admin {
		return nil
	}
	out := make([]uuid.UUID, 0, len(a.leads))
	for id := range a.leads {
		out = append(out, id)
	}
	return out
}

func (h *InventoryHandler) access(w http.ResponseWriter, r *http.Request) (invAccess, bool) {
	acc, err := loadInvAccess(r.Context(), h.Queries)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return acc, false
	}
	return acc, true
}

// ===== Tipos y sus campos =====

type kindField struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Kind    string   `json:"kind"`
	Options []string `json:"options,omitempty"`
}

type assetKindDTO struct {
	Code      string      `json:"code"`
	Name      string      `json:"name"`
	Icon      string      `json:"icon"`
	BaseType  string      `json:"baseType"`
	Fields    []kindField `json:"fields"`
	SortOrder int32       `json:"sortOrder"`
	Active    bool        `json:"active"`
}

func toKindDTO(k db.AssetKind) assetKindDTO {
	d := assetKindDTO{Code: k.Code, Name: k.Name, Icon: k.Icon, BaseType: string(k.BaseType), SortOrder: k.SortOrder, Active: k.Active, Fields: []kindField{}}
	_ = json.Unmarshal(k.Fields, &d.Fields)
	return d
}

type invAreaDTO struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
}

type inventoryMetaDTO struct {
	Kinds            []assetKindDTO `json:"kinds"`
	ResponsibleTypes []struct {
		Code   string `json:"code"`
		Name   string `json:"name"`
		Active bool   `json:"active"`
	} `json:"responsibleTypes"`
	Areas     []invAreaDTO `json:"areas"`
	MyAreas   []string     `json:"myAreas"`
	ViewAll   bool         `json:"viewAll"`
	Admin     bool         `json:"admin"`
	Pending   int          `json:"pendingRequests"`
	CanCreate bool         `json:"canCreate"`
}

// Meta es GET /api/inventory/meta: tipos, responsabilidades, áreas y lo que el usuario puede hacer.
func (h *InventoryHandler) Meta(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	kinds, err1 := h.Queries.ListAssetKinds(ctx)
	types, err2 := h.Queries.ListResponsibilityTypes(ctx)
	areas, err3 := h.Queries.ListTicketAreas(ctx)
	pending, err4 := h.Queries.ListPendingAssetRequests(ctx, acc.decidable())
	if err := errors.Join(err1, err2, err3, err4); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el inventario")
		return
	}
	out := inventoryMetaDTO{Kinds: []assetKindDTO{}, Areas: []invAreaDTO{}, MyAreas: []string{}, ViewAll: acc.viewAll, Admin: acc.admin}
	for _, k := range kinds {
		out.Kinds = append(out.Kinds, toKindDTO(k))
	}
	for _, t := range types {
		out.ResponsibleTypes = append(out.ResponsibleTypes, struct {
			Code   string `json:"code"`
			Name   string `json:"name"`
			Active bool   `json:"active"`
		}{t.Code, t.Name, t.Active})
	}
	for _, a := range areas {
		out.Areas = append(out.Areas, invAreaDTO{ID: a.ID, Code: a.Code, Name: a.Name})
		if acc.areas[a.ID] {
			out.MyAreas = append(out.MyAreas, a.Code)
		}
	}
	if acc.admin || len(acc.leads) > 0 {
		out.Pending = len(pending)
	}
	out.CanCreate = acc.admin || len(acc.areas) > 0
	writeData(w, http.StatusOK, out)
}

type putKindRequest struct {
	Name      string      `json:"name"`
	Icon      string      `json:"icon"`
	BaseType  string      `json:"baseType"`
	Fields    []kindField `json:"fields"`
	SortOrder int32       `json:"sortOrder"`
	Active    *bool       `json:"active"`
}

var fieldKinds = map[string]bool{"text": true, "number": true, "list": true, "date": true}

// slugKey: "Garantía hasta" → "garantia_hasta" (las columnas del CSV usan la clave).
func slugKey(s string) string {
	repl := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ñ", "n", "ü", "u")
	s = repl.Replace(strings.ToLower(strings.TrimSpace(s)))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			if b.Len() > 0 && !strings.HasSuffix(b.String(), "_") {
				b.WriteByte('_')
			}
		}
	}
	return strings.Trim(b.String(), "_")
}

// PutKind es PUT /api/inventory/kinds/{code} (admin): crea o cambia un tipo y sus campos.
func (h *InventoryHandler) PutKind(w http.ResponseWriter, r *http.Request) {
	code := slugKey(r.PathValue("code"))
	var req putKindRequest
	if err := decodeJSON(w, r, &req); err != nil || code == "" || strings.TrimSpace(req.Name) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el tipo necesita código y nombre")
		return
	}
	base := db.AssetType(req.BaseType)
	if base == "" {
		base = db.AssetTypeDevice
	}
	if base != db.AssetTypeCircuit && base != db.AssetTypeLink && base != db.AssetTypeSite && base != db.AssetTypeDevice {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "baseType debe ser circuit, link, site o device")
		return
	}
	seen := map[string]bool{}
	fields := []kindField{}
	for _, f := range req.Fields {
		f.Label = strings.TrimSpace(f.Label)
		if f.Key = slugKey(f.Key); f.Key == "" {
			f.Key = slugKey(f.Label)
		}
		if f.Label == "" || f.Key == "" || seen[f.Key] || !fieldKinds[f.Kind] || (f.Kind == "list" && len(f.Options) == 0) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-field", "cada campo necesita nombre, un tipo (texto, número, lista o fecha) y, si es lista, sus opciones; sin repetir")
			return
		}
		seen[f.Key] = true
		fields = append(fields, f)
	}
	raw, _ := json.Marshal(fields)
	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "category"
	}
	active := req.Active == nil || *req.Active
	k, err := h.Queries.UpsertAssetKind(r.Context(), db.UpsertAssetKindParams{Code: code, Name: strings.TrimSpace(req.Name), Icon: icon, BaseType: base, Fields: raw, SortOrder: req.SortOrder, Active: active})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el tipo")
		return
	}
	h.AuditLog.Log(r.Context(), "inventory.kind.upsert", audit.LevelInfo, audit.Success(), map[string]any{"code": code, "fields": len(fields)})
	writeData(w, http.StatusOK, toKindDTO(k))
}

// PutResponsibilityType es PUT /api/inventory/responsibility-types/{code} (admin).
func (h *InventoryHandler) PutResponsibilityType(w http.ResponseWriter, r *http.Request) {
	code := slugKey(r.PathValue("code"))
	var req struct {
		Name      string `json:"name"`
		SortOrder int32  `json:"sortOrder"`
		Active    *bool  `json:"active"`
	}
	if err := decodeJSON(w, r, &req); err != nil || code == "" || strings.TrimSpace(req.Name) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "necesita código y nombre")
		return
	}
	t, err := h.Queries.UpsertResponsibilityType(r.Context(), db.UpsertResponsibilityTypeParams{Code: code, Name: strings.TrimSpace(req.Name), SortOrder: req.SortOrder, Active: req.Active == nil || *req.Active})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	h.AuditLog.Log(r.Context(), "inventory.responsibility_type.upsert", audit.LevelInfo, audit.Success(), map[string]any{"code": code})
	writeData(w, http.StatusOK, map[string]any{"code": t.Code, "name": t.Name, "active": t.Active})
}

// ===== Lista y ficha =====

type inventoryRowDTO struct {
	ID         uuid.UUID         `json:"id"`
	Name       string            `json:"name"`
	Code       string            `json:"code"`
	Kind       string            `json:"kind"`
	AreaID     uuid.UUID         `json:"areaId"`
	AreaName   string            `json:"areaName"`
	Serial     *string           `json:"serial,omitempty"`
	Model      *string           `json:"model,omitempty"`
	Attributes map[string]string `json:"attributes"`
	Active     bool              `json:"active"`
	PlaceName  *string           `json:"placeName,omitempty"`
	FirstIP    string            `json:"firstIp"`
	IPCount    int32             `json:"ipCount"`
	// GlpiID: el equipo viene de GLPI (9.6).
	GlpiID *int32 `json:"glpiId,omitempty"`
	// GroupName: el grupo del que toma la ubicación (000061).
	GroupName *string `json:"groupName,omitempty"`
	// ClientID/ClientName: el cliente dueño del equipo (sin él, es interno).
	ClientID   *uuid.UUID `json:"clientId,omitempty"`
	ClientName *string    `json:"clientName,omitempty"`
}

func attrs(raw []byte) map[string]string {
	out := map[string]string{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func kindOf(k pgtype.Text, t db.AssetType) string {
	if k.Valid {
		return k.String
	}
	return string(t)
}

// List es GET /api/inventory?scope=mine|all&kind=&q=&inactive=true.
func (h *InventoryHandler) List(w http.ResponseWriter, r *http.Request) {
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	var areas []uuid.UUID
	if q.Get("scope") != "all" || !acc.viewAll {
		areas = acc.list()
		if acc.viewAll && len(areas) == 0 {
			areas = nil // sin áreas propias (admin): «mi área» es todo
		}
	}
	params := db.ListInventoryParams{Areas: areas, Kind: queryText(q.Get("kind")), Q: queryText(strings.TrimSpace(q.Get("q"))), IncludeInactive: q.Get("inactive") == "true",
		OnlyGlpi: q.Get("source") == "glpi"}
	if g, err := uuid.Parse(q.Get("group")); err == nil {
		params.GroupID = pgtype.UUID{Bytes: g, Valid: true}
	}
	if !acc.viewAll && len(areas) == 0 {
		writeData(w, http.StatusOK, []inventoryRowDTO{})
		return
	}
	rows, err := h.Queries.ListInventory(r.Context(), params)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el inventario")
		return
	}
	out := make([]inventoryRowDTO, 0, len(rows))
	for _, a := range rows {
		out = append(out, inventoryRowDTO{ID: a.ID, Name: a.Name, Code: a.Code, Kind: kindOf(a.KindCode, a.Type), AreaID: a.AreaID, AreaName: a.AreaName,
			Serial: textPtr(a.Serial), Model: textPtr(a.Model), Attributes: attrs(a.Attributes), Active: a.Active, PlaceName: textPtr(a.PlaceName), FirstIP: a.FirstIp, IPCount: a.IpCount, GlpiID: int4Ptr(a.GlpiID),
			GroupName: textPtr(a.GroupName), ClientID: uuidPtr(a.ClientID), ClientName: textPtr(a.ClientName)})
	}
	writeData(w, http.StatusOK, out)
}

type assetIPDTO struct {
	Kind    string `json:"kind"`
	Address string `json:"address"`
	Note    string `json:"note,omitempty"`
}

type assetResponsibleDTO struct {
	Type             string     `json:"type"`
	TypeName         string     `json:"typeName,omitempty"`
	Area             string     `json:"area,omitempty"`
	AreaName         string     `json:"areaName,omitempty"`
	UserID           *uuid.UUID `json:"userId,omitempty"`
	UserName         string     `json:"userName,omitempty"`
	OrganizationID   *uuid.UUID `json:"organizationId,omitempty"`
	OrganizationName string     `json:"organizationName,omitempty"`
}

type assetEventDTO struct {
	ID           uuid.UUID  `json:"id"`
	Kind         string     `json:"kind"`
	Description  string     `json:"description"`
	HappenedAt   time.Time  `json:"happenedAt"`
	UserName     string     `json:"userName,omitempty"`
	TicketID     *uuid.UUID `json:"ticketId,omitempty"`
	TicketNumber *string    `json:"ticketNumber,omitempty"`
}

type assetTicketDTO struct {
	ID           uuid.UUID `json:"id"`
	TicketNumber string    `json:"ticketNumber"`
	Title        string    `json:"title"`
	Status       string    `json:"status"`
	Priority     string    `json:"priority"`
	CreatedAt    time.Time `json:"createdAt"`
}

type assetRequestDTO struct {
	ID              uuid.UUID `json:"id"`
	AssetID         uuid.UUID `json:"assetId"`
	AssetName       string    `json:"assetName"`
	AssetCode       string    `json:"assetCode"`
	Action          string    `json:"action"`
	Reason          string    `json:"reason"`
	RequestedByName string    `json:"requestedByName"`
	AreaName        string    `json:"areaName"`
	CreatedAt       time.Time `json:"createdAt"`
}

type inventoryDetailDTO struct {
	ID                uuid.UUID             `json:"id"`
	Name              string                `json:"name"`
	Code              string                `json:"code"`
	Kind              string                `json:"kind"`
	Area              string                `json:"area"`
	AreaName          string                `json:"areaName"`
	TerritorialUnitID *uuid.UUID            `json:"territorialUnitId,omitempty"`
	PlaceName         *string               `json:"placeName,omitempty"`
	ClientID          *uuid.UUID            `json:"clientId,omitempty"`
	ClientName        *string               `json:"clientName,omitempty"`
	Model             *string               `json:"model,omitempty"`
	Serial            *string               `json:"serial,omitempty"`
	Rack              *string               `json:"rack,omitempty"`
	RackPosition      *string               `json:"rackPosition,omitempty"`
	Address           *string               `json:"address,omitempty"`
	Latitude          *float64              `json:"latitude,omitempty"`
	Longitude         *float64              `json:"longitude,omitempty"`
	GroupID           *uuid.UUID            `json:"groupId,omitempty"`
	GroupName         *string               `json:"groupName,omitempty"`
	Attributes        map[string]string     `json:"attributes"`
	Extra             map[string]string     `json:"extra"`
	Active            bool                  `json:"active"`
	IPs               []assetIPDTO          `json:"ips"`
	Responsibles      []assetResponsibleDTO `json:"responsibles"`
	Events            []assetEventDTO       `json:"events"`
	Tickets           []assetTicketDTO      `json:"tickets"`
	PendingRequest    *assetRequestDTO      `json:"pendingRequest,omitempty"`
	CanEdit           bool                  `json:"canEdit"`
	CanDecide         bool                  `json:"canDecide"`
	// Glpi: de qué ítem de GLPI viene (9.6); sus campos los actualiza GLPI.
	Glpi *assetGlpiDTO `json:"glpi,omitempty"`
}

type assetGlpiDTO struct {
	Itemtype string `json:"itemtype"`
	ID       int32  `json:"id"`
	URL      string `json:"url,omitempty"`
}

// loadAssetFor lee el equipo y corta con 404 si el usuario no lo ve.
func (h *InventoryHandler) loadAssetFor(w http.ResponseWriter, r *http.Request, acc invAccess) (db.GetInventoryAssetRow, []uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return db.GetInventoryAssetRow{}, nil, false
	}
	a, err := h.Queries.GetInventoryAsset(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return a, nil, false
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return a, nil, false
	}
	areas, err := h.Queries.ListAssetResponsibleAreas(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return a, nil, false
	}
	if !acc.canView(areas) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return a, nil, false
	}
	return a, areas, true
}

func (h *InventoryHandler) detail(ctx context.Context, a db.GetInventoryAssetRow, areas []uuid.UUID, acc invAccess) (inventoryDetailDTO, error) {
	d := inventoryDetailDTO{ID: a.ID, Name: a.Name, Code: a.Code, Kind: kindOf(a.KindCode, a.Type), Area: a.AreaCode, AreaName: a.AreaName,
		TerritorialUnitID: uuidPtr(a.TerritorialUnitID), PlaceName: textPtr(a.PlaceName), ClientID: uuidPtr(a.ClientID), ClientName: textPtr(a.ClientName),
		Model: textPtr(a.Model), Serial: textPtr(a.Serial), Rack: textPtr(a.Rack), RackPosition: textPtr(a.RackPosition),
		Address: textPtr(a.Address), Latitude: a.Latitude, Longitude: a.Longitude, GroupID: uuidPtr(a.GroupID), GroupName: textPtr(a.GroupName),
		Attributes: attrs(a.Attributes), Extra: attrs(a.Metadata), Active: a.Active,
		IPs: []assetIPDTO{}, Responsibles: []assetResponsibleDTO{}, Events: []assetEventDTO{}, Tickets: []assetTicketDTO{},
		CanEdit: acc.canEdit(areas), CanDecide: acc.canDecide(a.AreaID)}
	if a.GlpiID.Valid {
		d.Glpi = &assetGlpiDTO{Itemtype: a.GlpiItemtype.String, ID: a.GlpiID.Int32}
		if cfg, err := h.Queries.GetGlpiConfig(ctx); err == nil {
			d.Glpi.URL = glpi.WebURL(cfg.ApiUrl, a.GlpiItemtype.String, int(a.GlpiID.Int32))
		}
	}
	ips, err := h.Queries.ListAssetIPs(ctx, a.ID)
	if err != nil {
		return d, err
	}
	for _, ip := range ips {
		d.IPs = append(d.IPs, assetIPDTO{Kind: ip.Kind, Address: ip.Address, Note: ip.Note.String})
	}
	resp, err := h.Queries.ListAssetResponsibles(ctx, a.ID)
	if err != nil {
		return d, err
	}
	codeOf := map[uuid.UUID]string{}
	if all, err := h.Queries.ListTicketAreas(ctx); err == nil {
		for _, x := range all {
			codeOf[x.ID] = x.Code
		}
	}
	for _, rs := range resp {
		dto := assetResponsibleDTO{Type: rs.TypeCode, TypeName: rs.TypeName, UserID: uuidPtr(rs.UserID), UserName: rs.UserName, OrganizationID: uuidPtr(rs.OrganizationID), OrganizationName: rs.OrganizationName.String, AreaName: rs.AreaName.String}
		if rs.AreaID.Valid {
			dto.Area = codeOf[uuid.UUID(rs.AreaID.Bytes)]
		}
		d.Responsibles = append(d.Responsibles, dto)
	}
	events, err := h.Queries.ListAssetEvents(ctx, a.ID)
	if err != nil {
		return d, err
	}
	for _, e := range events {
		d.Events = append(d.Events, assetEventDTO{ID: e.ID, Kind: e.Kind, Description: e.Description, HappenedAt: e.HappenedAt.Time, UserName: e.UserName, TicketID: uuidPtr(e.TicketID), TicketNumber: textPtr(e.TicketNumber)})
	}
	tickets, err := h.Queries.ListAssetTickets(ctx, a.ID)
	if err != nil {
		return d, err
	}
	scope, _ := loadTicketScope(ctx, h.Queries)
	for _, t := range tickets {
		if scope.canView(t.AreaID, t.RequestedAreaID) {
			d.Tickets = append(d.Tickets, assetTicketDTO{ID: t.ID, TicketNumber: t.TicketNumber, Title: t.Title, Status: string(t.Status), Priority: string(t.Priority), CreatedAt: t.CreatedAt.Time})
		}
	}
	if pending, err := h.Queries.ListPendingAssetRequests(ctx, nil); err == nil {
		for _, p := range pending {
			if p.AssetID == a.ID {
				d.PendingRequest = &assetRequestDTO{ID: p.ID, AssetID: p.AssetID, AssetName: p.AssetName, AssetCode: p.AssetCode, Action: p.Action, Reason: p.Reason, RequestedByName: p.RequestedByName, AreaName: p.AreaName, CreatedAt: p.CreatedAt.Time}
			}
		}
	}
	return d, nil
}

// Get es GET /api/inventory/{id}.
func (h *InventoryHandler) Get(w http.ResponseWriter, r *http.Request) {
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	a, areas, ok := h.loadAssetFor(w, r, acc)
	if !ok {
		return
	}
	h.writeDetail(w, r, a, areas, acc)
}

func (h *InventoryHandler) writeDetail(w http.ResponseWriter, r *http.Request, a db.GetInventoryAssetRow, areas []uuid.UUID, acc invAccess) {
	d, err := h.detail(r.Context(), a, areas, acc)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return
	}
	writeData(w, http.StatusOK, d)
}

// reload vuelve a leer el equipo después de un cambio.
func (h *InventoryHandler) reload(w http.ResponseWriter, r *http.Request, id uuid.UUID, acc invAccess) {
	a, err := h.Queries.GetInventoryAsset(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return
	}
	areas, _ := h.Queries.ListAssetResponsibleAreas(r.Context(), id)
	h.writeDetail(w, r, a, areas, acc)
}

// ===== Alta y edición =====

type inventoryInput struct {
	Kind              string     `json:"kind"`
	Name              string     `json:"name"`
	Code              string     `json:"code"`
	Area              string     `json:"area"`
	TerritorialUnitID *uuid.UUID `json:"territorialUnitId"`
	ClientID          *uuid.UUID `json:"clientId"`
	Model             string     `json:"model"`
	Serial            string     `json:"serial"`
	Rack              string     `json:"rack"`
	RackPosition      string     `json:"rackPosition"`
	Address           string     `json:"address"`
	Latitude          *float64   `json:"latitude"`
	Longitude         *float64   `json:"longitude"`
	// GroupID: el equipo toma del grupo localidad, dirección, coordenadas y rack.
	GroupID      *uuid.UUID            `json:"groupId"`
	Attributes   map[string]string     `json:"attributes"`
	Extra        map[string]string     `json:"extra"`
	IPs          []assetIPDTO          `json:"ips"`
	Responsibles []assetResponsibleDTO `json:"responsibles"`
}

var ipKinds = map[string]string{"network": "Red", "vip": "Balanceo (VIP)", "management": "Administración (iLO / iDRAC)", "other": "Otra"}

// resolvedInput: lo que se guarda, ya validado.
type resolvedInput struct {
	in       inventoryInput
	kind     db.AssetKind
	fields   []kindField
	areaID   uuid.UUID
	resp     []db.AddAssetResponsibleParams
	respArea []uuid.UUID
}

// resolve valida el equipo contra su tipo, sus áreas y sus responsables.
func (h *InventoryHandler) resolve(ctx context.Context, in inventoryInput) (resolvedInput, string) {
	out := resolvedInput{in: in}
	in.Name, in.Code = strings.TrimSpace(in.Name), strings.TrimSpace(in.Code)
	if in.Code == "" {
		in.Code = slugKey(in.Name)
	}
	if in.Name == "" || in.Code == "" {
		return out, "el equipo necesita nombre y código"
	}
	kind, err := h.Queries.GetAssetKind(ctx, in.Kind)
	if err != nil {
		return out, "tipo de equipo desconocido: " + in.Kind
	}
	out.kind = kind
	_ = json.Unmarshal(kind.Fields, &out.fields)
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return out, "no se pudieron leer las áreas"
	}
	byCode := map[string]uuid.UUID{}
	for _, a := range areas {
		byCode[a.Code] = a.ID
	}
	id, ok := byCode[in.Area]
	if !ok {
		return out, "área desconocida o inactiva: " + in.Area
	}
	out.areaID = id
	clean := map[string]string{}
	for _, f := range out.fields {
		v := strings.TrimSpace(in.Attributes[f.Key])
		if v == "" {
			continue
		}
		switch f.Kind {
		case "number":
			if _, err := strconv.ParseFloat(strings.ReplaceAll(v, ",", "."), 64); err != nil {
				return out, fmt.Sprintf("«%s» debe ser un número", f.Label)
			}
		case "date":
			if _, err := time.Parse("2006-01-02", v); err != nil {
				return out, fmt.Sprintf("«%s» debe ser una fecha AAAA-MM-DD", f.Label)
			}
		case "list":
			found := false
			for _, o := range f.Options {
				if strings.EqualFold(o, v) {
					v, found = o, true
				}
			}
			if !found {
				return out, fmt.Sprintf("«%s»: «%s» no está en la lista (%s)", f.Label, v, strings.Join(f.Options, ", "))
			}
		}
		clean[f.Key] = v
	}
	in.Attributes = clean
	extra := map[string]string{}
	for k, v := range in.Extra {
		if k, v = strings.TrimSpace(k), strings.TrimSpace(v); k != "" && v != "" {
			extra[k] = v
		}
	}
	in.Extra = extra
	if msg := h.resolveLocation(ctx, &in); msg != "" {
		return out, msg
	}
	for i, ip := range in.IPs {
		ip.Address, ip.Note = strings.TrimSpace(ip.Address), strings.TrimSpace(ip.Note)
		if _, ok := ipKinds[ip.Kind]; !ok {
			return out, "tipo de IP desconocido: " + ip.Kind
		}
		if net.ParseIP(ip.Address) == nil {
			return out, fmt.Sprintf("IP «%s» no es válida", ip.Address)
		}
		in.IPs[i] = ip
	}
	types, err := h.Queries.ListResponsibilityTypes(ctx)
	if err != nil {
		return out, "no se pudieron leer los tipos de responsabilidad"
	}
	typeOK := map[string]bool{}
	for _, t := range types {
		typeOK[t.Code] = t.Active
	}
	for i, rs := range in.Responsibles {
		if !typeOK[rs.Type] {
			return out, "tipo de responsabilidad desconocido: " + rs.Type
		}
		p := db.AddAssetResponsibleParams{TypeCode: rs.Type, SortOrder: int32(i)}
		switch {
		case rs.Area != "":
			aid, ok := byCode[rs.Area]
			if !ok {
				return out, "área responsable desconocida: " + rs.Area
			}
			p.AreaID = pgtype.UUID{Bytes: aid, Valid: true}
			out.respArea = append(out.respArea, aid)
		case rs.UserID != nil:
			p.UserID = pgtype.UUID{Bytes: *rs.UserID, Valid: true}
		case rs.OrganizationID != nil:
			p.OrganizationID = pgtype.UUID{Bytes: *rs.OrganizationID, Valid: true}
		default:
			return out, "cada responsable es un área, una persona o una organización"
		}
		out.resp = append(out.resp, p)
	}
	out.in = in
	return out, ""
}

// checkCoords: latitud y longitud van juntas y dentro de rango (o ninguna).
func checkCoords(lat, lng *float64) string {
	if (lat == nil) != (lng == nil) {
		return "las coordenadas necesitan latitud y longitud"
	}
	if lat != nil && (*lat < -90 || *lat > 90 || *lng < -180 || *lng > 180) {
		return "coordenadas fuera de rango (latitud entre -90 y 90, longitud entre -180 y 180)"
	}
	return ""
}

// resolveLocation valida dirección y coordenadas; con grupo, la ubicación es
// la del grupo (lo que venga en el formulario o el CSV no cuenta).
func (h *InventoryHandler) resolveLocation(ctx context.Context, in *inventoryInput) string {
	in.Address = strings.TrimSpace(in.Address)
	if in.GroupID == nil {
		return checkCoords(in.Latitude, in.Longitude)
	}
	g, err := h.Queries.GetAssetGroup(ctx, *in.GroupID)
	if err != nil {
		return "el grupo no existe"
	}
	in.TerritorialUnitID, in.Address, in.Latitude, in.Longitude, in.Rack = uuidPtr(g.TerritorialUnitID), g.Address.String, g.Latitude, g.Longitude, g.Rack.String
	if in.ClientID == nil {
		in.ClientID = uuidPtr(g.ClientID) // el equipo sin cliente toma el del grupo
	}
	return ""
}

func optString(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	return pgtype.Text{String: s, Valid: s != ""}
}

// save escribe la ficha, sus IP y sus responsables dentro de la transacción.
func save(ctx context.Context, q *db.Queries, id uuid.UUID, ri resolvedInput) (uuid.UUID, error) {
	in := ri.in
	attrsRaw, _ := json.Marshal(in.Attributes)
	extraRaw, _ := json.Marshal(in.Extra)
	unit, client, group := optionalUUID(in.TerritorialUnitID), optionalUUID(in.ClientID), optionalUUID(in.GroupID)
	var err error
	if id == uuid.Nil {
		id, err = q.CreateInventoryAsset(ctx, db.CreateInventoryAssetParams{Type: ri.kind.BaseType, KindCode: pgtype.Text{String: ri.kind.Code, Valid: true},
			Name: in.Name, Code: in.Code, AreaID: ri.areaID, TerritorialUnitID: unit, ClientID: client, Model: optString(in.Model), Serial: optString(in.Serial),
			Rack: optString(in.Rack), RackPosition: optString(in.RackPosition), Attributes: attrsRaw, Metadata: extraRaw,
			Address: optString(in.Address), Latitude: in.Latitude, Longitude: in.Longitude, GroupID: group})
	} else {
		err = q.UpdateInventoryAsset(ctx, db.UpdateInventoryAssetParams{ID: id, Type: ri.kind.BaseType, KindCode: pgtype.Text{String: ri.kind.Code, Valid: true},
			Name: in.Name, AreaID: ri.areaID, TerritorialUnitID: unit, ClientID: client, Model: optString(in.Model), Serial: optString(in.Serial),
			Rack: optString(in.Rack), RackPosition: optString(in.RackPosition), Attributes: attrsRaw, Metadata: extraRaw,
			Address: optString(in.Address), Latitude: in.Latitude, Longitude: in.Longitude, GroupID: group})
	}
	if err != nil {
		return id, err
	}
	if err = q.ClearAssetIPs(ctx, id); err != nil {
		return id, err
	}
	for i, ip := range in.IPs {
		if err = q.AddAssetIP(ctx, db.AddAssetIPParams{AssetID: id, Kind: ip.Kind, Address: ip.Address, Note: optString(ip.Note), SortOrder: int32(i)}); err != nil {
			return id, err
		}
	}
	if err = q.ClearAssetResponsibles(ctx, id); err != nil {
		return id, err
	}
	for _, p := range ri.resp {
		p.AssetID = id
		if err = q.AddAssetResponsible(ctx, p); err != nil {
			return id, err
		}
	}
	return id, nil
}

// changes describe lo que cambió entre dos fichas, para el historial («SO: 20.04 → 24.04»).
func changes(before inventoryDetailDTO, after inventoryInput, fields []kindField, names map[string]string) []string {
	out := []string{}
	diff := func(label, a, b string) {
		a, b = strings.TrimSpace(a), strings.TrimSpace(b)
		if a == b {
			return
		}
		switch {
		case a == "":
			out = append(out, fmt.Sprintf("%s: %s", label, b))
		case b == "":
			out = append(out, fmt.Sprintf("%s: se quitó «%s»", label, a))
		default:
			out = append(out, fmt.Sprintf("%s: %s → %s", label, a, b))
		}
	}
	deref := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	diff("Nombre", before.Name, after.Name)
	if before.Kind != after.Kind {
		diff("Tipo", names["kind:"+before.Kind], names["kind:"+after.Kind])
	}
	if before.Area != after.Area {
		diff("Área dueña", names["area:"+before.Area], names["area:"+after.Area])
	}
	diff("Marca y modelo", deref(before.Model), after.Model)
	diff("N.º de serie", deref(before.Serial), after.Serial)
	if (before.GroupID == nil) != (after.GroupID == nil) || (before.GroupID != nil && *before.GroupID != *after.GroupID) {
		var was, now string
		if before.GroupID != nil {
			was = names["group:"+before.GroupID.String()]
		}
		if after.GroupID != nil {
			now = names["group:"+after.GroupID.String()]
		}
		diff("Grupo", was, now)
	}
	diff("Rack", deref(before.Rack), after.Rack)
	diff("Posición", deref(before.RackPosition), after.RackPosition)
	diff("Dirección", deref(before.Address), after.Address)
	diff("Coordenadas", coordsText(before.Latitude, before.Longitude), coordsText(after.Latitude, after.Longitude))
	if (before.TerritorialUnitID == nil) != (after.TerritorialUnitID == nil) || (before.TerritorialUnitID != nil && *before.TerritorialUnitID != *after.TerritorialUnitID) {
		out = append(out, "Localidad cambiada")
	}
	if (before.ClientID == nil) != (after.ClientID == nil) || (before.ClientID != nil && *before.ClientID != *after.ClientID) {
		out = append(out, "Cliente cambiado")
	}
	for _, f := range fields {
		diff(f.Label, before.Attributes[f.Key], after.Attributes[f.Key])
	}
	keys := map[string]bool{}
	for k := range before.Extra {
		keys[k] = true
	}
	for k := range after.Extra {
		keys[k] = true
	}
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		sorted = append(sorted, k)
	}
	sort.Strings(sorted)
	for _, k := range sorted {
		diff(k, before.Extra[k], after.Extra[k])
	}
	ipSet := func(ips []assetIPDTO) map[string]string {
		m := map[string]string{}
		for _, ip := range ips {
			m[ip.Address] = ipKinds[ip.Kind]
		}
		return m
	}
	oldIPs, newIPs := ipSet(before.IPs), ipSet(after.IPs)
	for addr, k := range newIPs {
		if _, ok := oldIPs[addr]; !ok {
			out = append(out, fmt.Sprintf("IP agregada: %s (%s)", addr, k))
		}
	}
	for addr, k := range oldIPs {
		if _, ok := newIPs[addr]; !ok {
			out = append(out, fmt.Sprintf("IP quitada: %s (%s)", addr, k))
		}
	}
	respKey := func(r assetResponsibleDTO) string {
		id := r.Area
		if r.UserID != nil {
			id = r.UserID.String()
		}
		if r.OrganizationID != nil {
			id = r.OrganizationID.String()
		}
		return r.Type + "|" + id
	}
	oldResp := map[string]bool{}
	for _, r := range before.Responsibles {
		oldResp[respKey(r)] = true
	}
	newResp := map[string]bool{}
	for _, r := range after.Responsibles {
		newResp[respKey(r)] = true
	}
	if len(oldResp) != len(newResp) {
		out = append(out, "Responsables cambiados")
	} else {
		for k := range newResp {
			if !oldResp[k] {
				out = append(out, "Responsables cambiados")
				break
			}
		}
	}
	return out
}

// coordsText: «-33.4489, -70.6693» para el historial (vacío sin coordenadas).
func coordsText(lat, lng *float64) string {
	if lat == nil || lng == nil {
		return ""
	}
	return strconv.FormatFloat(*lat, 'f', -1, 64) + ", " + strconv.FormatFloat(*lng, 'f', -1, 64)
}

func (h *InventoryHandler) names(ctx context.Context) map[string]string {
	m := map[string]string{}
	if kinds, err := h.Queries.ListAssetKinds(ctx); err == nil {
		for _, k := range kinds {
			m["kind:"+k.Code] = k.Name
		}
	}
	if areas, err := h.Queries.ListTicketAreas(ctx); err == nil {
		for _, a := range areas {
			m["area:"+a.Code] = a.Name
		}
	}
	if groups, err := h.Queries.ListAssetGroups(ctx); err == nil {
		for _, g := range groups {
			m["group:"+g.ID.String()] = g.Name
		}
	}
	return m
}

func isFKViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23503"
}

func userUUID(ctx context.Context) pgtype.UUID {
	u, _ := middleware.UserFromContext(ctx)
	return pgtype.UUID{Bytes: u.ID, Valid: u.ID != uuid.Nil}
}

// Create es POST /api/inventory.
func (h *InventoryHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	var in inventoryInput
	if err := decodeJSON(w, r, &in); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ri, msg := h.resolve(ctx, in)
	if msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-asset", msg)
		return
	}
	if !acc.canEdit(append([]uuid.UUID{ri.areaID}, ri.respArea...)) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "solo creas equipos de tus áreas")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el equipo")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	id, err := save(ctx, q, uuid.Nil, ri)
	if err == nil {
		err = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: "created", Description: "Equipo creado.", HappenedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, UserID: userUUID(ctx)})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe un equipo con ese código")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el equipo")
		return
	}
	h.AuditLog.Log(ctx, "inventory.asset.create", audit.LevelInfo, audit.Success(), map[string]any{"assetId": id.String(), "code": ri.in.Code})
	h.reload(w, r, id, acc)
}

// Update es PUT /api/inventory/{id}: la ficha completa; lo que cambió queda en el historial.
func (h *InventoryHandler) Update(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	a, areas, ok := h.loadAssetFor(w, r, acc)
	if !ok {
		return
	}
	if !acc.canEdit(areas) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "solo editan este equipo sus áreas o un administrador")
		return
	}
	var in inventoryInput
	if err := decodeJSON(w, r, &in); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	in.Code = a.Code // el código identifica al equipo (CSV): no se cambia aquí
	ri, msg := h.resolve(ctx, in)
	if msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-asset", msg)
		return
	}
	if !acc.admin && !acc.canEdit(append([]uuid.UUID{ri.areaID}, ri.respArea...)) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "el equipo tiene que quedar en una de tus áreas")
		return
	}
	before, err := h.detail(ctx, a, areas, acc)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return
	}
	diff := changes(before, ri.in, ri.fields, h.names(ctx))
	if err := h.apply(ctx, a.ID, ri, diff, "edited", "inventory.asset.update"); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el equipo")
		return
	}
	h.reload(w, r, a.ID, acc)
}

// apply guarda la ficha y anota cada cambio en el historial (ninguno si nada cambió).
func (h *InventoryHandler) apply(ctx context.Context, id uuid.UUID, ri resolvedInput, diff []string, kind, auditEvent string) error {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	if _, err = save(ctx, q, id, ri); err != nil {
		return err
	}
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	for _, d := range diff {
		if err = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: kind, Description: d, HappenedAt: now, UserID: userUUID(ctx)}); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if len(diff) > 0 {
		h.AuditLog.Log(ctx, auditEvent, audit.LevelInfo, audit.Success(), map[string]any{"assetId": id.String(), "changes": diff})
	}
	return nil
}

// ===== Historial =====

// AddEvent es POST /api/inventory/{id}/events: «Registrar trabajo».
func (h *InventoryHandler) AddEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	a, areas, ok := h.loadAssetFor(w, r, acc)
	if !ok {
		return
	}
	if !acc.canEdit(areas) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "solo anotan trabajos las áreas del equipo o un administrador")
		return
	}
	var req struct {
		Description string     `json:"description"`
		HappenedAt  *time.Time `json:"happenedAt"`
		TicketID    *uuid.UUID `json:"ticketId"`
	}
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Description) == "" || len([]rune(req.Description)) > 2000 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "describe el trabajo (hasta 2000 caracteres)")
		return
	}
	when := time.Now()
	if req.HappenedAt != nil {
		when = *req.HappenedAt
	}
	if when.After(time.Now().Add(time.Hour)) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la fecha del trabajo no puede ser futura")
		return
	}
	if err := h.Queries.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: a.ID, Kind: "work", Description: strings.TrimSpace(req.Description), HappenedAt: pgtype.Timestamptz{Time: when, Valid: true}, UserID: userUUID(ctx), TicketID: optionalUUID(req.TicketID)}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo anotar el trabajo")
		return
	}
	h.AuditLog.Log(ctx, "inventory.asset.work", audit.LevelInfo, audit.Success(), map[string]any{"assetId": a.ID.String()})
	h.reload(w, r, a.ID, acc)
}

// ===== Baja: desactivar, borrar y solicitudes =====

// SetActive es POST /api/inventory/{id}/active {active}: admin o jefatura del área dueña.
func (h *InventoryHandler) SetActive(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	a, _, ok := h.loadAssetFor(w, r, acc)
	if !ok {
		return
	}
	if !acc.canDecide(a.AreaID) {
		problemdetails.Write(w, r, http.StatusForbidden, "not-decider", "desactiva el administrador o la jefatura del área dueña; tú puedes enviar una solicitud")
		return
	}
	var req struct {
		Active bool   `json:"active"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if err := h.setActive(ctx, a.ID, req.Active, strings.TrimSpace(req.Reason)); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cambiar el estado")
		return
	}
	h.reload(w, r, a.ID, acc)
}

func (h *InventoryHandler) setActive(ctx context.Context, id uuid.UUID, active bool, reason string) error {
	kind, text := "deactivated", "Dado de baja"
	if active {
		kind, text = "reactivated", "Reactivado"
	}
	if reason != "" {
		text += ": " + reason
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	if err = q.SetAssetActive(ctx, db.SetAssetActiveParams{ID: id, Active: active}); err != nil {
		return err
	}
	if err = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: kind, Description: text + ".", HappenedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, UserID: userUUID(ctx)}); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	h.AuditLog.Log(ctx, "inventory.asset."+kind, audit.LevelInfo, audit.Success(), map[string]any{"assetId": id.String(), "reason": reason})
	return nil
}

// errAssetInUse: el equipo tiene registros (bitácora, escalamiento) que no se pueden perder.
var errAssetInUse = errors.New("equipo en uso")

func (h *InventoryHandler) deleteAsset(ctx context.Context, id uuid.UUID, code string) error {
	if err := h.Queries.DeleteAsset(ctx, id); err != nil {
		if isFKViolation(err) {
			return errAssetInUse
		}
		return err
	}
	h.AuditLog.Log(ctx, "inventory.asset.delete", audit.LevelWarn, audit.Success(), map[string]any{"assetId": id.String(), "code": code})
	return nil
}

// Delete es DELETE /api/inventory/{id}: admin o jefatura del área dueña.
func (h *InventoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	a, _, ok := h.loadAssetFor(w, r, acc)
	if !ok {
		return
	}
	if !acc.canDecide(a.AreaID) {
		problemdetails.Write(w, r, http.StatusForbidden, "not-decider", "borra el administrador o la jefatura del área dueña; tú puedes enviar una solicitud")
		return
	}
	switch err := h.deleteAsset(r.Context(), a.ID, a.Code); {
	case errors.Is(err, errAssetInUse):
		problemdetails.Write(w, r, http.StatusConflict, "asset-in-use", "el equipo tiene registros en la bitácora o en escalamiento: desactívalo en vez de borrarlo")
	case err != nil:
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el equipo")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// Request es POST /api/inventory/{id}/requests {action: deactivate|delete, reason}.
func (h *InventoryHandler) Request(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	a, areas, ok := h.loadAssetFor(w, r, acc)
	if !ok {
		return
	}
	if !acc.canEdit(areas) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "solo piden la baja las áreas del equipo")
		return
	}
	var req struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &req); err != nil || (req.Action != "deactivate" && req.Action != "delete") || strings.TrimSpace(req.Reason) == "" || len([]rune(req.Reason)) > 500 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige desactivar o borrar y escribe el motivo (hasta 500 caracteres)")
		return
	}
	if pending, err := h.Queries.PendingAssetRequestExists(ctx, a.ID); err != nil || pending {
		problemdetails.Write(w, r, http.StatusConflict, "request-pending", "ya hay una solicitud pendiente para este equipo")
		return
	}
	u, _ := middleware.UserFromContext(ctx)
	if _, err := h.Queries.CreateAssetRequest(ctx, db.CreateAssetRequestParams{AssetID: a.ID, Action: req.Action, Reason: strings.TrimSpace(req.Reason), RequestedBy: pgtype.UUID{Bytes: u.ID, Valid: true}}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo enviar la solicitud")
		return
	}
	h.AuditLog.Log(ctx, "inventory.request.create", audit.LevelInfo, audit.Success(), map[string]any{"assetId": a.ID.String(), "action": req.Action})
	if h.Notify != nil {
		deciders, _ := h.Queries.ListAreaLeadUserIDs(ctx, a.AreaID)
		admins, _ := h.Queries.ListAdminUserIDs(ctx)
		what := map[string]string{"deactivate": "dar de baja", "delete": "borrar"}[req.Action]
		h.Notify.Send(ctx, append(deciders, admins...), NotifMsg{Kind: NotifInventoryReq, Link: "/inventory", Exclude: u.ID,
			Title: fmt.Sprintf("%s pide %s %s", h.Notify.userNameOr(ctx, u.ID), what, a.Name), Body: strings.TrimSpace(req.Reason)})
	}
	// Aviso en vivo: a quien decide se le actualiza el número de solicitudes.
	publishSync(ctx, h.Hub, "inventory.request", map[string]string{"assetId": a.ID.String()})
	h.reload(w, r, a.ID, acc)
}

// Requests es GET /api/inventory/requests: las pendientes que decide el usuario.
func (h *InventoryHandler) Requests(w http.ResponseWriter, r *http.Request) {
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	out := []assetRequestDTO{}
	if !acc.admin && len(acc.leads) == 0 {
		writeData(w, http.StatusOK, out)
		return
	}
	rows, err := h.Queries.ListPendingAssetRequests(r.Context(), acc.decidable())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las solicitudes")
		return
	}
	for _, p := range rows {
		out = append(out, assetRequestDTO{ID: p.ID, AssetID: p.AssetID, AssetName: p.AssetName, AssetCode: p.AssetCode, Action: p.Action, Reason: p.Reason, RequestedByName: p.RequestedByName, AreaName: p.AreaName, CreatedAt: p.CreatedAt.Time})
	}
	writeData(w, http.StatusOK, out)
}

// Decide es POST /api/inventory/requests/{id}/decide {approve, note}.
func (h *InventoryHandler) Decide(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	rid, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "solicitud no encontrada")
		return
	}
	req, err := h.Queries.GetAssetRequest(ctx, rid)
	if err != nil || req.Status != "pending" {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "solicitud no encontrada o ya decidida")
		return
	}
	a, err := h.Queries.GetInventoryAsset(ctx, req.AssetID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "equipo no encontrado")
		return
	}
	if !acc.canDecide(a.AreaID) {
		problemdetails.Write(w, r, http.StatusForbidden, "not-decider", "decide el administrador o la jefatura del área dueña")
		return
	}
	var body struct {
		Approve bool   `json:"approve"`
		Note    string `json:"note"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	status := "rejected"
	if body.Approve {
		status = "approved"
		reason := req.Reason
		var err error
		if req.Action == "delete" {
			err = h.deleteAsset(ctx, a.ID, a.Code)
		} else {
			err = h.setActive(ctx, a.ID, false, reason)
		}
		if errors.Is(err, errAssetInUse) {
			problemdetails.Write(w, r, http.StatusConflict, "asset-in-use", "el equipo tiene registros en la bitácora o en escalamiento: no se puede borrar; recházala y desactívalo")
			return
		}
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo aplicar la solicitud")
			return
		}
	}
	// Si se borró el equipo, la solicitud se fue con él (ON DELETE CASCADE).
	_ = h.Queries.DecideAssetRequest(ctx, db.DecideAssetRequestParams{ID: rid, Status: status, DecidedBy: userUUID(ctx), DecisionNote: optString(body.Note)})
	if !body.Approve {
		_ = h.Queries.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: a.ID, Kind: "edited", Description: "Solicitud de baja rechazada" + map[bool]string{true: ": " + strings.TrimSpace(body.Note), false: "."}[strings.TrimSpace(body.Note) != ""], HappenedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, UserID: userUUID(ctx)})
	}
	h.AuditLog.Log(ctx, "inventory.request.decide", audit.LevelInfo, audit.Success(), map[string]any{"requestId": rid.String(), "assetId": a.ID.String(), "status": status})
	publishSync(ctx, h.Hub, "inventory.request", map[string]string{"assetId": a.ID.String()})
	writeData(w, http.StatusOK, map[string]string{"status": status})
}

// ===== Tickets resueltos → historial =====

// recordTicketResolved: un ticket resuelto cuyo lugar es un equipo deja el
// trabajo en el historial del equipo (con el enlace al ticket).
func recordTicketResolved(ctx context.Context, q *db.Queries, t db.Ticket) {
	if !t.AssetID.Valid {
		return
	}
	_ = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: uuid.UUID(t.AssetID.Bytes), Kind: "ticket", Description: "Resuelto " + t.TicketNumber + ": " + t.Title,
		HappenedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, UserID: userUUID(ctx), TicketID: pgtype.UUID{Bytes: t.ID, Valid: true}})
}
