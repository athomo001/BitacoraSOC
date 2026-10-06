package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Pools de escalamiento (decisión del dueño 2026-10-05): grupo con nombre de
// personas de una empresa o área — TI-Mundo, Redes-Mundo, Ciber-Mundo; una
// empresa puede tener varios — que se agrega a un nivel como un solo
// integrante y se llama en orden: si uno no contesta, el siguiente.

type poolDTO struct {
	ID               uuid.UUID  `json:"id"`
	Name             string     `json:"name"`
	OrganizationID   *uuid.UUID `json:"organizationId,omitempty"`
	OrganizationName *string    `json:"organizationName,omitempty"`
	Active           bool       `json:"active"`
	Members          int64      `json:"members"`
	UsedIn           int64      `json:"usedIn"`
}

type poolMemberDTO struct {
	ID               uuid.UUID  `json:"id"`
	ContactID        *uuid.UUID `json:"contactId,omitempty"`
	UserID           *uuid.UUID `json:"userId,omitempty"`
	Name             string     `json:"name"`
	OrganizationName *string    `json:"organizationName,omitempty"`
	Position         int32      `json:"position"`
}

// ListPools es GET /api/escalation/pools.
func (h *EscalationHandler) ListPools(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListEscalationPools(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los pools")
		return
	}
	out := make([]poolDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, poolDTO{ID: p.ID, Name: p.Name, OrganizationID: uuidPtr(p.OrganizationID), OrganizationName: textPtr(p.OrganizationName),
			Active: p.Active, Members: p.Members, UsedIn: p.UsedIn})
	}
	writeData(w, http.StatusOK, out)
}

type poolRequest struct {
	Name           *string    `json:"name"`
	OrganizationID *uuid.UUID `json:"organizationId"`
	// ClearOrganization deja el pool sin empresa (mezcla de varias).
	ClearOrganization bool  `json:"clearOrganization"`
	Active            *bool `json:"active"`
}

func poolName(raw *string) (string, bool) {
	if raw == nil {
		return "", false
	}
	name := strings.TrimSpace(*raw)
	return name, name != "" && len([]rune(name)) <= 80
}

// CreatePool es POST /api/escalation/pools {name, organizationId?}.
func (h *EscalationHandler) CreatePool(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req poolRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name, ok := poolName(req.Name)
	if !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el pool necesita un nombre (hasta 80 caracteres), ej. TI")
		return
	}
	p, err := h.Queries.CreateEscalationPool(ctx, db.CreateEscalationPoolParams{OrganizationID: optionalUUID(req.OrganizationID), Name: name})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate", "ya hay un pool con ese nombre en esa empresa")
		return
	}
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la empresa indicada no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el pool")
		return
	}
	h.AuditLog.Log(ctx, "escalation.pool.created", audit.LevelInfo, audit.Success(), map[string]any{"poolId": p.ID.String(), "name": p.Name})
	writeData(w, http.StatusCreated, poolDTO{ID: p.ID, Name: p.Name, OrganizationID: uuidPtr(p.OrganizationID), Active: p.Active})
}

// PatchPool es PATCH /api/escalation/pools/{id}.
func (h *EscalationHandler) PatchPool(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	var req poolRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	params := db.UpdateEscalationPoolParams{ID: id, Active: optionalBool(req.Active)}
	if req.Name != nil {
		name, ok := poolName(req.Name)
		if !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre no puede quedar vacío (hasta 80 caracteres)")
			return
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if req.OrganizationID != nil || req.ClearOrganization {
		params.SetOrganization = true
		params.OrganizationID = optionalUUID(req.OrganizationID)
	}
	p, err := h.Queries.UpdateEscalationPool(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate", "ya hay un pool con ese nombre en esa empresa")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el pool")
		return
	}
	h.AuditLog.Log(ctx, "escalation.pool.updated", audit.LevelInfo, audit.Success(), map[string]any{"poolId": p.ID.String(), "name": p.Name, "active": p.Active})
	writeData(w, http.StatusOK, poolDTO{ID: p.ID, Name: p.Name, OrganizationID: uuidPtr(p.OrganizationID), Active: p.Active})
}

// DeletePool es DELETE /api/escalation/pools/{id}: sale de los niveles donde estaba.
func (h *EscalationHandler) DeletePool(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	n, err := h.Queries.DeleteEscalationPool(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el pool")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	h.AuditLog.Log(ctx, "escalation.pool.deleted", audit.LevelWarn, audit.Success(), map[string]any{"poolId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

// ListPoolMembers es GET /api/escalation/pools/{id}/members (en orden de llamada).
func (h *EscalationHandler) ListPoolMembers(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	rows, err := h.Queries.ListEscalationPoolMembers(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las personas del pool")
		return
	}
	out := make([]poolMemberDTO, 0, len(rows))
	for _, m := range rows {
		out = append(out, poolMemberDTO{ID: m.ID, ContactID: uuidPtr(m.ContactID), UserID: uuidPtr(m.UserID), Name: m.Name,
			OrganizationName: textPtr(m.OrganizationName), Position: m.Position})
	}
	writeData(w, http.StatusOK, out)
}

type putPoolMembersRequest struct {
	Members []struct {
		ContactID *uuid.UUID `json:"contactId"`
		UserID    *uuid.UUID `json:"userId"`
	} `json:"members"`
}

// PutPoolMembers es PUT /api/escalation/pools/{id}/members: la lista
// completa en orden de llamada (reemplaza la anterior).
func (h *EscalationHandler) PutPoolMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	var req putPoolMembersRequest
	if err := decodeJSON(w, r, &req); err != nil || len(req.Members) > 50 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica members: [{contactId} o {userId}] en orden (hasta 50)")
		return
	}
	if _, err := h.Queries.GetEscalationPool(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "pool no encontrado")
		return
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el pool")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	if err := q.ClearEscalationPoolMembers(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el pool")
		return
	}
	seen := map[uuid.UUID]bool{}
	for i, m := range req.Members {
		if (m.ContactID == nil) == (m.UserID == nil) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cada persona es un contacto o un usuario, no ambos")
			return
		}
		key := uuid.Nil
		if m.ContactID != nil {
			key = *m.ContactID
		} else {
			key = *m.UserID
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		err := q.AddEscalationPoolMember(ctx, db.AddEscalationPoolMemberParams{PoolID: id, ContactID: optionalUUID(m.ContactID), UserID: optionalUUID(m.UserID), Position: int32(i)})
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "una de las personas indicadas no existe")
			return
		}
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el pool")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el pool")
		return
	}
	h.AuditLog.Log(ctx, "escalation.pool.members", audit.LevelInfo, audit.Success(), map[string]any{"poolId": id.String(), "members": len(seen)})
	h.ListPoolMembers(w, r)
}
