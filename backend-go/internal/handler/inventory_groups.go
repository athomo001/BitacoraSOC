package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Grupos de equipos (000061, pedido del dueño 2026-10-23): un rack o una sala
// con muchos equipos en el mismo lugar. El grupo guarda localidad, dirección,
// coordenadas y rack; sus equipos los toman de él y, al cambiar el grupo,
// cambian todos (con una línea en el historial de cada uno). Puede tener un
// cliente: sus equipos sin cliente lo toman. Lo crea quien
// crea equipos; lo edita y lo borra quien es del área dueña del grupo o el
// admin. Borrarlo deja a sus equipos sin grupo y con la ubicación que tenían.

type assetGroupDTO struct {
	ID                uuid.UUID  `json:"id"`
	Name              string     `json:"name"`
	Area              string     `json:"area"`
	AreaName          string     `json:"areaName"`
	TerritorialUnitID *uuid.UUID `json:"territorialUnitId,omitempty"`
	PlaceName         *string    `json:"placeName,omitempty"`
	Address           *string    `json:"address,omitempty"`
	Latitude          *float64   `json:"latitude,omitempty"`
	Longitude         *float64   `json:"longitude,omitempty"`
	Rack              *string    `json:"rack,omitempty"`
	ClientID          *uuid.UUID `json:"clientId,omitempty"`
	ClientName        *string    `json:"clientName,omitempty"`
	AssetCount        int32      `json:"assetCount"`
	CanEdit           bool       `json:"canEdit"`
}

type assetGroupInput struct {
	Name              string     `json:"name"`
	Area              string     `json:"area"`
	TerritorialUnitID *uuid.UUID `json:"territorialUnitId"`
	Address           string     `json:"address"`
	Latitude          *float64   `json:"latitude"`
	Longitude         *float64   `json:"longitude"`
	Rack              string     `json:"rack"`
	ClientID          *uuid.UUID `json:"clientId"`
}

// Groups es GET /api/inventory/groups: todos los grupos (son lugares, no
// equipos: cualquiera que use el inventario los ve para elegir uno).
func (h *InventoryHandler) Groups(w http.ResponseWriter, r *http.Request) {
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListAssetGroups(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los grupos")
		return
	}
	out := make([]assetGroupDTO, 0, len(rows))
	for _, g := range rows {
		out = append(out, assetGroupDTO{ID: g.ID, Name: g.Name, Area: g.AreaCode, AreaName: g.AreaName, TerritorialUnitID: uuidPtr(g.TerritorialUnitID),
			PlaceName: textPtr(g.PlaceName), Address: textPtr(g.Address), Latitude: g.Latitude, Longitude: g.Longitude, Rack: textPtr(g.Rack),
			ClientID: uuidPtr(g.ClientID), ClientName: textPtr(g.ClientName), AssetCount: g.AssetCount, CanEdit: acc.canEdit([]uuid.UUID{g.AreaID})})
	}
	writeData(w, http.StatusOK, out)
}

// resolveGroup valida el grupo y devuelve el id de su área dueña.
func (h *InventoryHandler) resolveGroup(ctx context.Context, in *assetGroupInput) (uuid.UUID, string) {
	in.Name, in.Address, in.Rack = strings.TrimSpace(in.Name), strings.TrimSpace(in.Address), strings.TrimSpace(in.Rack)
	if in.Name == "" || len([]rune(in.Name)) > 120 {
		return uuid.Nil, "el grupo necesita un nombre (hasta 120 caracteres)"
	}
	if msg := checkCoords(in.Latitude, in.Longitude); msg != "" {
		return uuid.Nil, msg
	}
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return uuid.Nil, "no se pudieron leer las áreas"
	}
	for _, a := range areas {
		if a.Code == in.Area {
			return a.ID, ""
		}
	}
	return uuid.Nil, "área desconocida o inactiva: " + in.Area
}

// CreateGroup es POST /api/inventory/groups.
func (h *InventoryHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	var in assetGroupInput
	if err := decodeJSON(w, r, &in); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	areaID, msg := h.resolveGroup(ctx, &in)
	if msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-group", msg)
		return
	}
	if !acc.canEdit([]uuid.UUID{areaID}) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "solo creas grupos de tus áreas")
		return
	}
	id, err := h.Queries.CreateAssetGroup(ctx, db.CreateAssetGroupParams{Name: in.Name, AreaID: areaID, TerritorialUnitID: optionalUUID(in.TerritorialUnitID),
		Address: optString(in.Address), Latitude: in.Latitude, Longitude: in.Longitude, Rack: optString(in.Rack), ClientID: optionalUUID(in.ClientID)})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-name", "ya existe un grupo con ese nombre")
		return
	}
	if isFKViolation(err) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-group", "la localidad o el cliente no existen")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el grupo")
		return
	}
	h.AuditLog.Log(ctx, "inventory.group.create", audit.LevelInfo, audit.Success(), map[string]any{"groupId": id.String(), "name": in.Name})
	writeData(w, http.StatusCreated, map[string]any{"id": id})
}

// loadGroupFor lee el grupo y corta con 404/403 si no existe o el usuario no lo edita.
func (h *InventoryHandler) loadGroupFor(w http.ResponseWriter, r *http.Request, acc invAccess) (db.AssetGroup, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "grupo no encontrado")
		return db.AssetGroup{}, false
	}
	g, err := h.Queries.GetAssetGroup(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "grupo no encontrado")
		return g, false
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el grupo")
		return g, false
	}
	if !acc.canEdit([]uuid.UUID{g.AreaID}) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "solo editan este grupo su área o un administrador")
		return g, false
	}
	return g, true
}

// UpdateGroup es PUT /api/inventory/groups/{id}: si cambió la ubicación, sus
// equipos la toman en la misma transacción y queda en el historial de cada uno.
func (h *InventoryHandler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	g, ok := h.loadGroupFor(w, r, acc)
	if !ok {
		return
	}
	var in assetGroupInput
	if err := decodeJSON(w, r, &in); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	areaID, msg := h.resolveGroup(ctx, &in)
	if msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-group", msg)
		return
	}
	if !acc.canEdit([]uuid.UUID{areaID}) {
		problemdetails.Write(w, r, http.StatusForbidden, "area-not-member", "el grupo tiene que quedar en una de tus áreas")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el grupo")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	err = q.UpdateAssetGroup(ctx, db.UpdateAssetGroupParams{ID: g.ID, Name: in.Name, AreaID: areaID, TerritorialUnitID: optionalUUID(in.TerritorialUnitID),
		Address: optString(in.Address), Latitude: in.Latitude, Longitude: in.Longitude, Rack: optString(in.Rack), ClientID: optionalUUID(in.ClientID)})
	var moved []uuid.UUID
	if err == nil {
		moved, err = q.ApplyAssetGroupLocation(ctx, g.ID)
	}
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	for _, id := range moved {
		if err != nil {
			break
		}
		err = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: "edited", Description: fmt.Sprintf("Ubicación cambiada con el grupo «%s».", in.Name), HappenedAt: now, UserID: userUUID(ctx)})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-name", "ya existe un grupo con ese nombre")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el grupo")
		return
	}
	h.AuditLog.Log(ctx, "inventory.group.update", audit.LevelInfo, audit.Success(), map[string]any{"groupId": g.ID.String(), "name": in.Name, "assetsMoved": len(moved)})
	writeData(w, http.StatusOK, map[string]any{"id": g.ID, "assetsMoved": len(moved)})
}

// DeleteGroup es DELETE /api/inventory/groups/{id}.
func (h *InventoryHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	g, ok := h.loadGroupFor(w, r, acc)
	if !ok {
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el grupo")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	ids, err := q.ListAssetGroupAssetIDs(ctx, pgtype.UUID{Bytes: g.ID, Valid: true})
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	for _, id := range ids {
		if err != nil {
			break
		}
		err = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: "edited", Description: fmt.Sprintf("Grupo: se quitó «%s» (se borró el grupo; la ubicación queda).", g.Name), HappenedAt: now, UserID: userUUID(ctx)})
	}
	if err == nil {
		err = q.DeleteAssetGroup(ctx, g.ID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el grupo")
		return
	}
	h.AuditLog.Log(ctx, "inventory.group.delete", audit.LevelWarn, audit.Success(), map[string]any{"groupId": g.ID.String(), "name": g.Name, "assets": len(ids)})
	w.WriteHeader(http.StatusNoContent)
}
