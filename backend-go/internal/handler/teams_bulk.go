package handler

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// teamUsage: qué usa un equipo, para avisar antes de borrarlo.
type teamUsage struct {
	// Steps: "QRadar · DPP #2, …": política y número de llamado (vacío si ninguna lo usa).
	Steps   string `json:"steps"`
	Raci    int32  `json:"raci"`
	Guards  int32  `json:"guards"`
	Tickets int32  `json:"tickets"`
}

type bulkTeamsRequest struct {
	IDs    []uuid.UUID `json:"ids"`
	Action string      `json:"action"` // activate | deactivate | delete
}

// Bulk es POST /api/teams/bulk (canvas "Equipos y llamados de escalamiento",
// 2026-10-07): activar, desactivar o borrar varios equipos.
//
// Borrar es en cascada (decisión del dueño): se van sus llamados en las
// políticas, su RACI, sus guardias (ciclos, turnos y reemplazos), integrantes
// y cobertura; los tickets quedan sin equipo asignado. Los contactos del
// Directorio no se tocan. La pantalla avisa antes qué se lleva.
func (h *TeamsHandler) Bulk(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req bulkTeamsRequest
	if err := decodeJSON(w, r, &req); err != nil || len(req.IDs) == 0 || len(req.IDs) > 500 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "ids (1 a 500) es obligatorio")
		return
	}
	switch req.Action {
	case "activate", "deactivate":
		n, err := h.Queries.SetTeamsActive(ctx, db.SetTeamsActiveParams{Active: req.Action == "activate", Ids: req.IDs})
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron actualizar los equipos")
			return
		}
		h.AuditLog.Log(ctx, "team.bulk."+req.Action, audit.LevelInfo, audit.Success(), map[string]any{"teams": n})
		writeData(w, http.StatusOK, map[string]any{"updated": n})
	case "delete":
		h.bulkDelete(w, r, req.IDs)
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "action debe ser activate, deactivate o delete")
	}
}

func (h *TeamsHandler) bulkDelete(w http.ResponseWriter, r *http.Request, ids []uuid.UUID) {
	ctx := r.Context()
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo iniciar la transacción")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := h.Queries.WithTx(tx)
	fail := func(msg string) {
		h.AuditLog.Log(ctx, "team.bulk.delete", audit.LevelError, audit.Failure(msg), map[string]any{"teams": len(ids)})
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", msg)
	}
	tickets, err := q.UnassignTeamTickets(ctx, ids)
	if err != nil {
		fail("no se pudieron liberar los tickets")
		return
	}
	policies, err := q.DeleteStepsOfTeams(ctx, ids)
	if err != nil {
		fail("no se pudieron quitar los llamados")
		return
	}
	// Las políticas que perdieron un llamado quedan numeradas 1..n.
	renumbered := map[uuid.UUID]bool{}
	for _, p := range policies {
		if renumbered[p] {
			continue
		}
		renumbered[p] = true
		if msg := renumber(ctx, q, p, nil); msg != "" {
			fail(msg)
			return
		}
	}
	raci, err := q.DeleteRaciOfTeams(ctx, ids)
	if err != nil {
		fail("no se pudo quitar el RACI")
		return
	}
	if err := q.DeleteTeamGuards(ctx, ids); err != nil {
		fail("no se pudieron quitar las guardias")
		return
	}
	if err := q.DeleteTeamCycles(ctx, ids); err != nil {
		fail("no se pudieron quitar los ciclos de guardia")
		return
	}
	n, err := q.DeleteTeams(ctx, ids)
	if err != nil {
		fail("no se pudieron borrar los equipos")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		fail("no se pudo guardar")
		return
	}
	h.AuditLog.Log(ctx, "team.bulk.delete", audit.LevelWarn, audit.Success(), map[string]any{
		"teams": n, "steps": len(policies), "raci": raci, "ticketsUnassigned": tickets})
	writeData(w, http.StatusOK, map[string]any{"deleted": n, "steps": len(policies), "raci": raci, "ticketsUnassigned": tickets})
}
