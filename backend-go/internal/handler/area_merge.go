package handler

import (
	"context"
	"net/http"
	"slices"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Borrar y unir áreas (pedido del dueño 2026-10-22, spec/16 §3.3.3): un área
// sin gente ni datos se borra; una con gente o datos se une a otra (toda su
// gente, con su nivel, y todos sus datos pasan al destino) y queda vacía,
// lista para borrarla. SOC y NOC no se borran ni se unen a otra.

type areaUsageDTO struct {
	People   int32 `json:"people"`
	Tickets  int32 `json:"tickets"`
	Assets   int32 `json:"assets"`
	Teams    int32 `json:"teams"`
	Policies int32 `json:"policies"`
	Tasks    int32 `json:"tasks"`
	Goals    int32 `json:"goals"`
	Windows  int32 `json:"windows"`
	Other    int32 `json:"other"`
	// Empty: sin gente ni datos (se puede borrar).
	Empty bool `json:"empty"`
}

func usageOf(u db.AreaUsageRow) areaUsageDTO {
	out := areaUsageDTO{People: u.People, Tickets: u.Tickets, Assets: u.Assets, Teams: u.Teams, Policies: u.Policies,
		Tasks: u.Tasks, Goals: u.Goals, Windows: u.Windows, Other: u.Other}
	out.Empty = out.People+out.Tickets+out.Assets+out.Teams+out.Policies+out.Tasks+out.Goals+out.Windows+out.Other == 0
	return out
}

func (h *AreasHandler) areaByCode(ctx context.Context, code string) (db.Area, bool, error) {
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		return db.Area{}, false, err
	}
	i := slices.IndexFunc(areas, func(a db.Area) bool { return a.Code == code })
	if i < 0 {
		return db.Area{}, false, nil
	}
	return areas[i], true, nil
}

// Usage es GET /api/areas/{code}/usage: su gente y sus datos.
func (h *AreasHandler) Usage(w http.ResponseWriter, r *http.Request) {
	a, ok, err := h.areaByCode(r.Context(), r.PathValue("code"))
	if err != nil || !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "área no encontrada")
		return
	}
	u, err := h.Queries.AreaUsage(r.Context(), a.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el área")
		return
	}
	writeData(w, http.StatusOK, usageOf(u))
}

// Delete es DELETE /api/areas/{code}: solo un área vacía y que no sea SOC ni NOC.
func (h *AreasHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	a, ok, err := h.areaByCode(ctx, r.PathValue("code"))
	if err != nil || !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "área no encontrada")
		return
	}
	if a.IsSystem {
		problemdetails.Write(w, r, http.StatusConflict, "system-area", "SOC y NOC no se borran")
		return
	}
	u, err := h.Queries.AreaUsage(ctx, a.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el área")
		return
	}
	if !usageOf(u).Empty {
		problemdetails.Write(w, r, http.StatusConflict, "area-not-empty", "el área tiene gente o datos: únela a otra área primero")
		return
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		if err := q.DeleteEmptyAreaGroups(ctx, a.ID); err != nil {
			return err
		}
		if err := q.DeleteArea(ctx, a.ID); err != nil {
			return err
		}
		if a.DepartmentID.Valid {
			return q.SyncDepartmentLeadAreas(ctx, uuid.UUID(a.DepartmentID.Bytes))
		}
		return nil
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el área")
		return
	}
	h.AuditLog.Log(ctx, "area.delete", audit.LevelWarn, audit.Success(), map[string]any{"area": a.Code, "name": a.Name})
	writeNoContent(w)
}

// Merge es POST /api/areas/{code}/merge {into}: pasa toda la gente (con su
// nivel; si ya estaba en el destino, queda con el de más rango) y todos los
// datos del área al destino. El área queda vacía, para borrarla.
func (h *AreasHandler) Merge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Into string `json:"into"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	from, ok, err := h.areaByCode(ctx, r.PathValue("code"))
	if err != nil || !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "área no encontrada")
		return
	}
	to, ok, err := h.areaByCode(ctx, req.Into)
	if err != nil || !ok || !to.Active || to.ID == from.ID {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige otra área, encendida, para unirla")
		return
	}
	if from.IsSystem {
		problemdetails.Write(w, r, http.StatusConflict, "system-area", "SOC y NOC no se unen a otra área")
		return
	}
	before, err := h.Queries.AreaUsage(ctx, from.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el área")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	moved := 0
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		// El origen deja de compartir equipo: así sacarlo no saca a nadie de sus hermanas.
		if err := q.ClearAreaShare(ctx, from.ID); err != nil {
			return err
		}
		n, err := mergeAreaPeople(ctx, q, from.Code, to.Code, actor.ID)
		if err != nil {
			return err
		}
		moved = n
		if err := q.MoveAreaGroups(ctx, db.MoveAreaGroupsParams{FromID: from.ID, ToID: to.ID}); err != nil {
			return err
		}
		return q.MoveAreaData(ctx, db.MoveAreaDataParams{FromID: from.ID, ToID: to.ID})
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo unir el área")
		return
	}
	h.AuditLog.Log(ctx, "area.merge", audit.LevelWarn, audit.Success(), map[string]any{
		"from": from.Code, "into": to.Code, "people": moved, "tickets": before.Tickets, "assets": before.Assets,
		"teams": before.Teams, "policies": before.Policies, "tasks": before.Tasks, "goals": before.Goals, "windows": before.Windows,
	})
	after, err := h.Queries.AreaUsage(ctx, from.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el área")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"moved": moved, "usage": usageOf(after)})
}

// mergeAreaPeople pasa a cada persona del área origen al destino: con el
// nivel de más rango entre los dos y la jefatura si la tenía en alguna. Si el
// destino comparte equipo, entra también a sus hermanas.
func mergeAreaPeople(ctx context.Context, q *db.Queries, from, to string, actor uuid.UUID) (int, error) {
	areas, levels, err := placementCatalog(ctx, q)
	if err != nil {
		return 0, err
	}
	ids, err := q.ListAreaUserIDs(ctx, from)
	if err != nil {
		return 0, err
	}
	rank := func(levelID string) int32 {
		if l, ok := levels[levelID]; ok {
			return l.Rank
		}
		return -1
	}
	moved := 0
	for _, id := range ids {
		shapes, err := q.ListUserGroupShapes(ctx, id)
		if err != nil {
			return moved, err
		}
		current := derivePlacement(shapesOf(shapes), activeSet(areas))
		var src *placementArea
		for i := range current.Areas {
			if current.Areas[i].Code == from {
				src = &current.Areas[i]
			}
		}
		if src == nil {
			continue
		}
		want := placementDTO{Extras: current.Extras}
		inTarget := false
		for _, a := range current.Areas {
			switch a.Code {
			case from:
				continue
			case to:
				inTarget = true
				if rank(src.LevelID) > rank(a.LevelID) {
					a.LevelID = src.LevelID
				}
				a.Lead = a.Lead || src.Lead
			}
			want.Areas = append(want.Areas, a)
		}
		if !inTarget {
			want.Areas = append(want.Areas, placementArea{Code: to, LevelID: src.LevelID, Lead: src.Lead})
		}
		if _, _, err := applyPlacement(ctx, q, id, want, areas, levels, actor); err != nil {
			return moved, err
		}
		if err := propagateShared(ctx, q, id, current, actor); err != nil {
			return moved, err
		}
		moved++
	}
	return moved, nil
}
