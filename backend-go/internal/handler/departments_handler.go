package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// DepartmentsHandler es Administración → Departamentos y áreas (spec/16
// §3.5.1, diseño aprobado por el dueño 2026-10-22): agrupar áreas en un
// departamento, su jefatura (jefatura de todas sus áreas), las áreas que
// comparten equipo y qué ve cada CSM en Gestión. Solo el admin.
type DepartmentsHandler struct {
	Queries *db.Queries
	Pool    interface {
		Begin(ctx context.Context) (pgx.Tx, error)
	}
	AuditLog *audit.Logger
}

type departmentLeadDTO struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type departmentDTO struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	// Areas: los códigos de sus áreas; Shared: las que comparten equipo.
	Areas  []string            `json:"areas"`
	Shared []string            `json:"shared"`
	Leads  []departmentLeadDTO `json:"leads"`
	// CSMs: las CSM asignadas y a qué áreas va cada una.
	CSMs []departmentCSMDTO `json:"csms"`
}

func (h *DepartmentsHandler) list(ctx context.Context) ([]departmentDTO, error) {
	rows, err := h.Queries.ListDepartments(ctx)
	if err != nil {
		return nil, err
	}
	leads, err := h.Queries.ListDepartmentLeads(ctx)
	if err != nil {
		return nil, err
	}
	csms, err := h.departmentCSMs(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]departmentDTO, 0, len(rows))
	for _, d := range rows {
		dto := departmentDTO{ID: d.ID, Name: d.Name, Areas: d.AreaCodes, Shared: d.SharedCodes, Leads: []departmentLeadDTO{}, CSMs: csms[d.ID]}
		if dto.CSMs == nil {
			dto.CSMs = []departmentCSMDTO{}
		}
		if len(dto.Shared) < 2 {
			dto.Shared = []string{}
		}
		for _, l := range leads {
			if l.DepartmentID == d.ID {
				dto.Leads = append(dto.Leads, departmentLeadDTO{ID: l.UserID, Name: l.Name})
			}
		}
		out = append(out, dto)
	}
	return out, nil
}

// List es GET /api/departments.
func (h *DepartmentsHandler) List(w http.ResponseWriter, r *http.Request) {
	out, err := h.list(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los departamentos")
		return
	}
	writeData(w, http.StatusOK, out)
}

func (h *DepartmentsHandler) find(ctx context.Context, id uuid.UUID) (departmentDTO, bool, error) {
	all, err := h.list(ctx)
	if err != nil {
		return departmentDTO{}, false, err
	}
	i := slices.IndexFunc(all, func(d departmentDTO) bool { return d.ID == id })
	if i < 0 {
		return departmentDTO{}, false, nil
	}
	return all[i], true, nil
}

func (h *DepartmentsHandler) writeOne(w http.ResponseWriter, r *http.Request, id uuid.UUID, status int) {
	d, ok, err := h.find(r.Context(), id)
	if err != nil || !ok {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el departamento")
		return
	}
	writeData(w, status, d)
}

// Create es POST /api/departments {name}: el departamento y su grupo de
// jefatura (todavía sin gente ni áreas).
func (h *DepartmentsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name, ok := cleanAreaName(req.Name)
	if !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre es obligatorio (hasta 60 caracteres)")
		return
	}
	var id uuid.UUID
	err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		d, err := q.CreateDepartment(ctx, name)
		if err != nil {
			return errDuplicateDepartment
		}
		id = d.ID
		base := "jefatura_dep_" + slugCode(name)
		code := base
		for i := 2; ; i++ {
			taken, err := q.GroupCodeTaken(ctx, code)
			if err != nil {
				return err
			}
			if !taken {
				break
			}
			code = fmt.Sprintf("%s_%d", base, i)
		}
		_, err = q.CreateDepartmentLeadGroup(ctx, db.CreateDepartmentLeadGroupParams{Code: code, Name: "Jefatura " + name, DepartmentID: pgtype.UUID{Bytes: d.ID, Valid: true}})
		return err
	})
	if errors.Is(err, errDuplicateDepartment) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-department", "ya existe un departamento con ese nombre")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el departamento")
		return
	}
	h.AuditLog.Log(ctx, "department.create", audit.LevelInfo, audit.Success(), map[string]any{"departmentId": id.String(), "name": name})
	h.writeOne(w, r, id, http.StatusCreated)
}

var errDuplicateDepartment = errors.New("departamento repetido")

type departmentPatch struct {
	Name *string `json:"name"`
	// Areas: todas sus áreas (las que se quitan quedan sin departamento).
	Areas *[]string `json:"areas"`
	// Shared: las áreas que comparten equipo (de las suyas).
	Shared *[]string `json:"shared"`
}

// Patch es PATCH /api/departments/{id} {name?, areas?, shared?}. Marcar
// áreas que comparten equipo iguala su gente.
func (h *DepartmentsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req departmentPatch
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	current, ok, err := h.find(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el departamento")
		return
	}
	if !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "departamento no encontrado")
		return
	}
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	known := map[string]db.Area{}
	for _, a := range areas {
		known[a.Code] = a
	}
	codes := current.Areas
	var movedFrom []uuid.UUID
	if req.Areas != nil {
		codes = []string{}
		for _, c := range *req.Areas {
			a, ok := known[c]
			if !ok || slices.Contains(codes, c) {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "área inválida o repetida: "+c)
				return
			}
			// Un área de otro departamento se mueve a este (deja aquel).
			if a.DepartmentID.Valid && uuid.UUID(a.DepartmentID.Bytes) != id {
				movedFrom = append(movedFrom, uuid.UUID(a.DepartmentID.Bytes))
			}
			codes = append(codes, c)
		}
	}
	shared := current.Shared
	if req.Shared != nil {
		shared = []string{}
		for _, c := range *req.Shared {
			if !slices.Contains(codes, c) {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "solo comparten equipo áreas del departamento")
				return
			}
			if !slices.Contains(shared, c) {
				shared = append(shared, c)
			}
		}
	}
	shared = slices.DeleteFunc(slices.Clone(shared), func(c string) bool { return !slices.Contains(codes, c) })
	var name string
	if req.Name != nil {
		n, ok := cleanAreaName(*req.Name)
		if !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre es obligatorio (hasta 60 caracteres)")
			return
		}
		name = n
	}
	actor, _ := middleware.UserFromContext(ctx)
	equalized := 0
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		if name != "" && name != current.Name {
			if err := q.RenameDepartment(ctx, db.RenameDepartmentParams{ID: id, Name: name}); err != nil {
				return errDuplicateDepartment
			}
			if err := q.RenameDepartmentLeadGroup(ctx, db.RenameDepartmentLeadGroupParams{DepartmentID: pgtype.UUID{Bytes: id, Valid: true}, Name: "Jefatura " + name}); err != nil {
				return err
			}
		}
		// Un área que entra o sale del departamento deja sus CSM de antes.
		var changed []uuid.UUID
		for c, a := range known {
			if slices.Contains(codes, c) != slices.Contains(current.Areas, c) {
				changed = append(changed, a.ID)
			}
		}
		if err := q.DeleteAreaScopes(ctx, changed); err != nil {
			return err
		}
		if err := q.ClearDepartmentAreas(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
			return err
		}
		if err := q.SetAreasDepartment(ctx, db.SetAreasDepartmentParams{DepartmentID: id, Codes: codes}); err != nil {
			return err
		}
		if err := q.SetSharedAreas(ctx, db.SetSharedAreasParams{DepartmentID: id, Codes: shared}); err != nil {
			return err
		}
		if err := q.SyncDepartmentLeadAreas(ctx, id); err != nil {
			return err
		}
		// El departamento de donde salió un área deja de dirigirla.
		for _, from := range movedFrom {
			if err := q.SyncDepartmentLeadAreas(ctx, from); err != nil {
				return err
			}
		}
		// Marcar áreas que comparten equipo iguala su gente (si cambió el conjunto).
		if len(shared) > 1 && !sameSet(shared, current.Shared) {
			n, err := equalizeShared(ctx, q, shared, actor.ID)
			equalized = n
			return err
		}
		return nil
	})
	if errors.Is(err, errDuplicateDepartment) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-department", "ya existe un departamento con ese nombre")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el departamento")
		return
	}
	h.AuditLog.Log(ctx, "department.update", audit.LevelInfo, audit.Success(), map[string]any{
		"departmentId": id.String(), "name": cmpOr(name, current.Name), "areas": strings.Join(codes, ", "), "shared": strings.Join(shared, ", "), "equalized": equalized,
	})
	h.writeOne(w, r, id, http.StatusOK)
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// sameSet: los mismos códigos, en cualquier orden.
func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for _, x := range a {
		if !slices.Contains(b, x) {
			return false
		}
	}
	return true
}

// SetLeads es PUT /api/departments/{id}/leads {userIds}: la jefatura del
// departamento (jefatura de todas sus áreas).
func (h *DepartmentsHandler) SetLeads(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req struct {
		UserIDs []uuid.UUID `json:"userIds"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	rows, err := h.Queries.ListDepartments(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el departamento")
		return
	}
	i := slices.IndexFunc(rows, func(d db.ListDepartmentsRow) bool { return d.ID == id })
	if i < 0 || rows[i].LeadGroupID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "departamento no encontrado")
		return
	}
	group := rows[i].LeadGroupID
	actor, _ := middleware.UserFromContext(ctx)
	names := []string{}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		if err := q.ClearGroupMembers(ctx, group); err != nil {
			return err
		}
		for _, u := range req.UserIDs {
			person, err := q.GetUserByID(ctx, u)
			if err != nil || !person.Active {
				return errUnknownUser
			}
			if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
				UserID: u, PermissionGroupID: group, AssignedBy: pgtype.UUID{Bytes: actor.ID, Valid: actor.ID != uuid.Nil},
			}); err != nil {
				return err
			}
			names = append(names, person.Username)
		}
		return nil
	})
	if errors.Is(err, errUnknownUser) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "alguna persona no existe o no está activa")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la jefatura")
		return
	}
	h.AuditLog.Log(ctx, "department.leads", audit.LevelInfo, audit.Success(), map[string]any{"departmentId": id.String(), "leads": strings.Join(names, ", ")})
	h.writeOne(w, r, id, http.StatusOK)
}

var errUnknownUser = errors.New("persona desconocida")

// Delete es DELETE /api/departments/{id}: sus áreas quedan sin departamento
// y su jefatura se borra; la gente de las áreas no cambia.
func (h *DepartmentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	d, ok, err := h.find(ctx, id)
	if err != nil || !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "departamento no encontrado")
		return
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		if err := q.ClearDepartmentScopes(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
			return err
		}
		if err := q.ClearDepartmentAreas(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
			return err
		}
		return q.DeleteDepartment(ctx, id)
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el departamento")
		return
	}
	h.AuditLog.Log(ctx, "department.delete", audit.LevelWarn, audit.Success(), map[string]any{"departmentId": id.String(), "name": d.Name})
	writeNoContent(w)
}

// ===== CSM del departamento =====

// CapCSM: la persona es CSM (Gestión de clientes). Se marca en su panel
// (permisos extra, decisión del dueño 2026-10-22); a qué departamento y áreas
// va se asigna en cada departamento. Una CSM sin departamento ve todo.
const CapCSM = "csm"

type departmentCSMDTO struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	// Areas: las áreas del departamento que ve; vacío = todas.
	Areas []string `json:"areas"`
}

// departmentCSMs: las CSM de cada departamento, a partir de los alcances
// (una fila del departamento = todas sus áreas; filas de áreas = esas).
func (h *DepartmentsHandler) departmentCSMs(ctx context.Context) (map[uuid.UUID][]departmentCSMDTO, error) {
	scopes, err := h.Queries.ListManagementScopes(ctx)
	if err != nil {
		return nil, err
	}
	people, err := h.Queries.ListMarkedCSMs(ctx)
	if err != nil {
		return nil, err
	}
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		return nil, err
	}
	name := map[uuid.UUID]string{}
	for _, p := range people {
		name[p.ID] = p.Name
	}
	areaOf := map[uuid.UUID]db.Area{}
	for _, a := range areas {
		areaOf[a.ID] = a
	}
	type key struct{ dep, user uuid.UUID }
	all := map[key]bool{}
	some := map[key][]string{}
	var order []key
	add := func(k key) {
		if _, seen := all[k]; !seen {
			all[k] = false
			order = append(order, k)
		}
	}
	for _, s := range scopes {
		if _, ok := name[s.UserID]; !ok {
			continue
		}
		switch {
		case s.DepartmentID.Valid:
			k := key{uuid.UUID(s.DepartmentID.Bytes), s.UserID}
			add(k)
			all[k] = true
		case s.AreaID.Valid:
			a, ok := areaOf[uuid.UUID(s.AreaID.Bytes)]
			if !ok || !a.DepartmentID.Valid {
				continue
			}
			k := key{uuid.UUID(a.DepartmentID.Bytes), s.UserID}
			add(k)
			some[k] = append(some[k], a.Code)
		}
	}
	out := map[uuid.UUID][]departmentCSMDTO{}
	for _, k := range order {
		dto := departmentCSMDTO{ID: k.user, Name: name[k.user], Areas: []string{}}
		if !all[k] {
			dto.Areas = some[k]
		}
		out[k.dep] = append(out[k.dep], dto)
	}
	return out, nil
}

// CSMPeople es GET /api/departments/csm-people: quienes están marcados como CSM.
func (h *DepartmentsHandler) CSMPeople(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListMarkedCSMs(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la gente")
		return
	}
	out := make([]departmentLeadDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, departmentLeadDTO{ID: p.ID, Name: p.Name})
	}
	writeData(w, http.StatusOK, out)
}

// SetCSMs es PUT /api/departments/{id}/csms {csms: [{id, areas}]}: las CSM
// del departamento y a qué áreas va cada una (vacío = todas).
func (h *DepartmentsHandler) SetCSMs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req struct {
		CSMs []struct {
			ID    uuid.UUID `json:"id"`
			Areas []string  `json:"areas"`
		} `json:"csms"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	d, ok, err := h.find(ctx, id)
	if err != nil || !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "departamento no encontrado")
		return
	}
	people, err := h.Queries.ListMarkedCSMs(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la gente")
		return
	}
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	idOf := map[string]uuid.UUID{}
	for _, a := range areas {
		idOf[a.Code] = a.ID
	}
	for _, c := range req.CSMs {
		if !slices.ContainsFunc(people, func(p db.ListMarkedCSMsRow) bool { return p.ID == c.ID }) {
			problemdetails.Write(w, r, http.StatusBadRequest, "not-csm", "esa persona no está marcada como CSM (Usuarios y grupos)")
			return
		}
		for _, a := range c.Areas {
			if !slices.Contains(d.Areas, a) {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "solo áreas del departamento: "+a)
				return
			}
		}
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		if err := q.ClearDepartmentScopes(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
			return err
		}
		seen := map[uuid.UUID]bool{}
		for _, c := range req.CSMs {
			if seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			if len(c.Areas) == 0 {
				if err := q.AddManagementScope(ctx, db.AddManagementScopeParams{UserID: c.ID, DepartmentID: pgtype.UUID{Bytes: id, Valid: true}}); err != nil {
					return err
				}
				continue
			}
			for _, a := range slices.Compact(slices.Sorted(slices.Values(c.Areas))) {
				if err := q.AddManagementScope(ctx, db.AddManagementScopeParams{UserID: c.ID, AreaID: pgtype.UUID{Bytes: idOf[a], Valid: true}}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	h.AuditLog.Log(ctx, "department.csms", audit.LevelInfo, audit.Success(), map[string]any{"departmentId": id.String(), "csms": len(req.CSMs)})
	h.writeOne(w, r, id, http.StatusOK)
}
