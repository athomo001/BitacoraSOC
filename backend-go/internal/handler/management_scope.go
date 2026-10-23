package handler

import (
	"context"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Qué ve cada CSM en Gestión (spec/16 §3.5.1, decisión del dueño
// 2026-10-22): sin alcance, todo (como antes); con alcance (departamentos o
// áreas, Administración → Departamentos y áreas), los tickets, metas e
// indicadores de esas áreas y los clientes que atienden, más los suyos.

// loadManagementScope: las áreas del alcance de una persona con perfil
// Gestión (nil = ve todo).
func loadManagementScope(ctx context.Context, q *db.Queries, id uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := q.ListManagementScopeAreas(ctx, id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	out := make(map[uuid.UUID]bool, len(rows))
	for _, a := range rows {
		out[a] = true
	}
	return out, nil
}

// limited: una CSM con alcance ve solo lo suyo en Gestión.
func (u agendaUser) limited() bool { return !u.admin && u.scope != nil }

// seesArea: el área entra en lo que ve en Gestión (sus jefaturas, su alcance
// o todo).
func (u agendaUser) seesArea(id uuid.UUID) bool {
	return u.admin || u.leads[id] || (u.gestion && (u.scope == nil || u.scope[id]))
}

// clientScope: los clientes que ve una CSM con alcance (nil = todos).
func (h *ManagementHandler) clientScope(ctx context.Context, u agendaUser) (map[uuid.UUID]bool, error) {
	if !u.limited() {
		return nil, nil
	}
	areas := make([]uuid.UUID, 0, len(u.scope)+len(u.leads))
	for a := range u.scope {
		areas = append(areas, a)
	}
	for a := range u.leads {
		areas = append(areas, a)
	}
	ids, err := h.Queries.ListClientsWithTicketsInAreas(ctx, areas)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// clientAllowed: el cliente entra en lo que ve (todos, los que atienden sus
// áreas o los que tiene a cargo).
func clientAllowed(scope map[uuid.UUID]bool, client uuid.UUID, csm pgtype.UUID, me uuid.UUID) bool {
	return scope == nil || scope[client] || (csm.Valid && uuid.UUID(csm.Bytes) == me)
}

// clientVisible: lo mismo para un cliente por su id (la ficha, el resumen,
// las notas).
func (h *ManagementHandler) clientVisible(ctx context.Context, u agendaUser, client uuid.UUID) (bool, error) {
	scope, err := h.clientScope(ctx, u)
	if err != nil || scope == nil {
		return err == nil, err
	}
	if scope[client] {
		return true, nil
	}
	org, err := h.Queries.GetOrganization(ctx, client)
	if err != nil {
		return false, nil
	}
	return clientAllowed(scope, client, org.CsmUserID, u.id), nil
}
