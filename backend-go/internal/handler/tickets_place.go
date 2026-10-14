package handler

import (
	"context"
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Lugar del ticket (#24, 7b, 000038): una localidad del Territorio o un
// activo, y con el activo su localidad. Lo usa el Mapa para la capa de
// tickets abiertos. No se muestra en el seguimiento público.

type setTicketPlaceRequest struct {
	TerritorialUnitID *uuid.UUID `json:"territorialUnitId"`
	AssetID           *uuid.UUID `json:"assetId"`
}

// placeLabel: "Calama · RT-CAL-06", "Calama" o "Sin lugar", para la actividad del ticket.
func (h *TicketsHandler) placeLabel(ctx context.Context, unit, asset pgtype.UUID) string {
	if !unit.Valid {
		return "Sin lugar"
	}
	label := "?"
	if u, err := h.Queries.GetTerritorialUnit(ctx, uuid.UUID(unit.Bytes)); err == nil {
		label = u.Name
	}
	if asset.Valid {
		if a, err := h.Queries.GetAsset(ctx, uuid.UUID(asset.Bytes)); err == nil {
			label += " · " + a.Name
		}
	}
	return label
}

// SetPlace es PUT /api/tickets/{id}/place: {assetId} o {territorialUnitId}; los dos vacíos quitan el lugar.
func (h *TicketsHandler) SetPlace(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req setTicketPlaceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	old, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if old.MergedIntoID.Valid {
		problemdetails.Write(w, r, 409, "ticket-merged", "este ticket se unió a otro")
		return
	}
	var unit, asset pgtype.UUID
	switch {
	case req.AssetID != nil:
		a, err := h.Queries.GetAsset(ctx, *req.AssetID)
		if err != nil {
			problemdetails.Write(w, r, 404, "not-found", "el activo no existe")
			return
		}
		asset = pgtype.UUID{Bytes: a.ID, Valid: true}
		unit = pgtype.UUID{Bytes: a.TerritorialUnitID, Valid: true}
	case req.TerritorialUnitID != nil:
		if _, err := h.Queries.GetTerritorialUnit(ctx, *req.TerritorialUnitID); err != nil {
			problemdetails.Write(w, r, 404, "not-found", "la localidad no existe")
			return
		}
		unit = pgtype.UUID{Bytes: *req.TerritorialUnitID, Valid: true}
	}
	if unit != old.TerritorialUnitID || asset != old.AssetID {
		from, to := h.placeLabel(ctx, old.TerritorialUnitID, old.AssetID), h.placeLabel(ctx, unit, asset)
		user, _ := middleware.UserFromContext(ctx)
		tx, err := h.Pool.Begin(ctx)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el lugar")
			return
		}
		defer tx.Rollback(ctx)
		q := h.Queries.WithTx(tx)
		if err := q.SetTicketPlace(ctx, db.SetTicketPlaceParams{ID: id, AssetID: asset, TerritorialUnitID: unit}); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el lugar")
			return
		}
		if err := ticketNote(ctx, q, id, user, "Lugar: "+from+" → "+to+".", false, ""); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el lugar")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo cambiar el lugar")
			return
		}
		h.AuditLog.Log(ctx, "ticket.place_changed", audit.LevelInfo, audit.Success(), map[string]any{
			"ticketId": id.String(), "territorialUnitId": uuidString(uuidPtr(unit)), "assetId": uuidString(uuidPtr(asset)),
		})
		h.notifyChanged(ctx, id)
	}
	d, err := h.loadDetail(r, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo recargar el ticket")
		return
	}
	writeData(w, 200, d)
}
