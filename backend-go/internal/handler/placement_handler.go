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

// PlacementHandler es el panel de la persona en Usuarios y grupos: en qué
// áreas está, con qué nivel, de cuáles es jefatura y qué permisos extra tiene
// (diseño "Usuarios por área y nivel", aprobado por el dueño 2026-10-13).
// Los grupos se arman solos por debajo («Infraestructura N1», «Jefatura
// Infraestructura», «Directorio: escribir»); los grupos hechos a mano se
// respetan mientras sigan de acuerdo con lo elegido.
type PlacementHandler struct {
	Queries *db.Queries
	Pool    interface {
		Begin(ctx context.Context) (pgx.Tx, error)
	}
	AuditLog *audit.Logger
}

// extraCapabilities: los permisos extra del panel (todas las capacidades
// menos la jefatura, que va por área) y el nombre de su grupo automático.
var extraCapabilities = map[string]string{
	"directory:write":       "Directorio: escribir",
	"directory:delete":      "Directorio: borrar",
	"tickets:change_client": "Tickets: cambiar cliente",
}

type placementArea struct {
	Code string `json:"code"`
	// LevelID: "" = en el área sin nivel.
	LevelID string `json:"levelId"`
	Lead    bool   `json:"lead"`
}

type placementDTO struct {
	Areas  []placementArea `json:"areas"`
	Extras []string        `json:"extras"`
}

// groupShape es un grupo visto por su forma.
type groupShape struct {
	ID    uuid.UUID
	Level string // "" = sin nivel
	Caps  []string
	Areas []string
}

// shapeSpec es un grupo automático que hace falta.
type shapeSpec struct {
	Area  string // "" = sin área (permiso extra)
	Level string
	Caps  []string
}

func shapesOf(rows []db.ListUserGroupShapesRow) []groupShape {
	out := make([]groupShape, 0, len(rows))
	for _, r := range rows {
		level := ""
		if r.LevelID.Valid {
			level = uuid.UUID(r.LevelID.Bytes).String()
		}
		out = append(out, groupShape{ID: r.ID, Level: level, Caps: r.Capabilities, Areas: r.AreaCodes})
	}
	return out
}

// derivePlacement: lo que muestran los grupos de la persona. Las áreas
// apagadas no se muestran.
func derivePlacement(groups []groupShape, active map[string]bool) placementDTO {
	levels := map[string]string{}
	leads := map[string]bool{}
	extras := map[string]bool{}
	var order []string
	for _, g := range groups {
		for _, a := range g.Areas {
			if !active[a] {
				continue
			}
			if _, seen := levels[a]; !seen {
				order = append(order, a)
				levels[a] = ""
			}
			if g.Level != "" && levels[a] == "" {
				levels[a] = g.Level
			}
			if slices.Contains(g.Caps, CapAreaLead) {
				leads[a] = true
			}
		}
		for _, c := range g.Caps {
			if _, ok := extraCapabilities[c]; ok {
				extras[c] = true
			}
		}
	}
	out := placementDTO{Areas: []placementArea{}, Extras: []string{}}
	for _, a := range order {
		out.Areas = append(out.Areas, placementArea{Code: a, LevelID: levels[a], Lead: leads[a]})
	}
	for c := range extras {
		out.Extras = append(out.Extras, c)
	}
	slices.Sort(out.Extras)
	return out
}

// planPlacement decide qué grupos quitar y cuáles automáticos agregar para
// llegar a lo elegido. Se queda con todo grupo que esté de acuerdo (sus áreas
// elegidas con ese nivel, su jefatura elegida, sus permisos extra elegidos);
// las áreas apagadas no se tocan.
func planPlacement(current []groupShape, want placementDTO, active map[string]bool) (remove []uuid.UUID, add []shapeSpec) {
	level := map[string]string{}
	lead := map[string]bool{}
	for _, a := range want.Areas {
		level[a.Code] = a.LevelID
		if a.Lead {
			lead[a.Code] = true
		}
	}
	keep := func(g groupShape) bool {
		for _, a := range g.Areas {
			if !active[a] {
				continue
			}
			lvl, in := level[a]
			if !in || (g.Level != "" && g.Level != lvl) {
				return false
			}
			if slices.Contains(g.Caps, CapAreaLead) && !lead[a] {
				return false
			}
		}
		for _, c := range g.Caps {
			if _, extra := extraCapabilities[c]; extra && !slices.Contains(want.Extras, c) {
				return false
			}
		}
		return true
	}
	var kept []groupShape
	for _, g := range current {
		if keep(g) {
			kept = append(kept, g)
		} else {
			remove = append(remove, g.ID)
		}
	}
	covered := func(match func(groupShape) bool) bool { return slices.ContainsFunc(kept, match) }
	for _, a := range want.Areas {
		if !covered(func(g groupShape) bool { return slices.Contains(g.Areas, a.Code) && g.Level == a.LevelID }) &&
			(a.LevelID != "" || !covered(func(g groupShape) bool { return slices.Contains(g.Areas, a.Code) })) {
			add = append(add, shapeSpec{Area: a.Code, Level: a.LevelID, Caps: []string{}})
		}
		if a.Lead && !covered(func(g groupShape) bool {
			return slices.Contains(g.Areas, a.Code) && slices.Contains(g.Caps, CapAreaLead)
		}) {
			add = append(add, shapeSpec{Area: a.Code, Caps: []string{CapAreaLead}})
		}
	}
	for _, c := range want.Extras {
		if !covered(func(g groupShape) bool { return slices.Contains(g.Caps, c) }) {
			add = append(add, shapeSpec{Caps: []string{c}})
		}
	}
	return remove, add
}

func (h *PlacementHandler) catalog(ctx context.Context) (map[string]db.Area, map[string]db.Level, error) {
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		return nil, nil, err
	}
	levels, err := h.Queries.ListLevels(ctx)
	if err != nil {
		return nil, nil, err
	}
	am := map[string]db.Area{}
	for _, a := range areas {
		if a.Active {
			am[a.Code] = a
		}
	}
	lm := map[string]db.Level{}
	for _, l := range levels {
		lm[l.ID.String()] = l
	}
	return am, lm, nil
}

func activeSet(areas map[string]db.Area) map[string]bool {
	out := map[string]bool{}
	for code := range areas {
		out[code] = true
	}
	return out
}

// Get es GET /api/users/{id}/placement.
func (h *PlacementHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	areas, _, err := h.catalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	rows, err := h.Queries.ListUserGroupShapes(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	writeData(w, http.StatusOK, derivePlacement(shapesOf(rows), activeSet(areas)))
}

// ensureShapedGroup busca el grupo automático con esa forma o lo crea.
func ensureShapedGroup(ctx context.Context, q *db.Queries, spec shapeSpec, areas map[string]db.Area, levels map[string]db.Level) (uuid.UUID, error) {
	var levelID pgtype.UUID
	if spec.Level != "" {
		levelID = pgtype.UUID{Bytes: levels[spec.Level].ID, Valid: true}
	}
	areaCodes := []string{}
	if spec.Area != "" {
		areaCodes = []string{spec.Area}
	}
	found, err := q.FindShapedGroup(ctx, db.FindShapedGroupParams{LevelID: levelID, Capabilities: spec.Caps, AreaCodes: areaCodes})
	if err == nil {
		return found, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}

	area := areas[spec.Area]
	profile := "operativo"
	if spec.Area != "" {
		profile = area.DefaultProfile
	}
	var code, name string
	switch {
	case slices.Contains(spec.Caps, CapAreaLead):
		code, name = "jefatura_"+area.Code, "Jefatura "+area.Name
	case spec.Area == "":
		code, name = "extra_"+strings.NewReplacer(":", "_").Replace(spec.Caps[0]), extraCapabilities[spec.Caps[0]]
	case spec.Level != "":
		code, name = area.Code+"_"+levels[spec.Level].Code, area.Name+" "+levels[spec.Level].Name
	default:
		code, name = area.Code, area.Name
	}
	base := code
	for i := 2; ; i++ {
		taken, err := q.GroupCodeTaken(ctx, code)
		if err != nil {
			return uuid.Nil, err
		}
		if !taken {
			break
		}
		code = fmt.Sprintf("%s_%d", base, i)
	}
	g, err := q.CreatePermissionGroup(ctx, db.CreatePermissionGroupParams{
		Code: code, Name: name, Capabilities: spec.Caps, Profile: profile, LevelID: levelID,
	})
	if err != nil {
		return uuid.Nil, err
	}
	if len(areaCodes) > 0 {
		if _, err := q.AddGroupAreasByCode(ctx, db.AddGroupAreasByCodeParams{GroupID: g.ID, Codes: areaCodes}); err != nil {
			return uuid.Nil, err
		}
	}
	return g.ID, nil
}

// Put es PUT /api/users/{id}/placement: deja a la persona en esas áreas y
// niveles, con esa jefatura y esos permisos extra.
func (h *PlacementHandler) Put(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req placementDTO
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if _, err := h.Queries.GetUserByID(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	areas, levels, err := h.catalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	seen := map[string]bool{}
	for _, a := range req.Areas {
		if _, ok := areas[a.Code]; !ok || seen[a.Code] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "área inválida o repetida: "+a.Code)
			return
		}
		seen[a.Code] = true
		if _, ok := levels[a.LevelID]; a.LevelID != "" && !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "nivel inválido")
			return
		}
	}
	for _, c := range req.Extras {
		if _, ok := extraCapabilities[c]; !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "permiso extra inválido: "+c)
			return
		}
	}
	actor, _ := middleware.UserFromContext(ctx)

	var added, removed int
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		rows, err := q.ListUserGroupShapes(ctx, id)
		if err != nil {
			return err
		}
		remove, add := planPlacement(shapesOf(rows), req, activeSet(areas))
		for _, g := range remove {
			if err := q.RemoveUserPermissionGroup(ctx, db.RemoveUserPermissionGroupParams{UserID: id, PermissionGroupID: g}); err != nil {
				return err
			}
		}
		for _, spec := range add {
			groupID, err := ensureShapedGroup(ctx, q, spec, areas, levels)
			if err != nil {
				return err
			}
			if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
				UserID: id, PermissionGroupID: groupID, AssignedBy: pgtype.UUID{Bytes: actor.ID, Valid: actor.ID != uuid.Nil},
			}); err != nil {
				return err
			}
		}
		added, removed = len(add), len(remove)
		return nil
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	rows, err := h.Queries.ListUserGroupShapes(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	placement := derivePlacement(shapesOf(rows), activeSet(areas))
	summary := make([]string, 0, len(placement.Areas))
	for _, a := range placement.Areas {
		s := a.Code
		if a.LevelID != "" {
			s += " " + levels[a.LevelID].Name
		}
		if a.Lead {
			s += " (jefatura)"
		}
		summary = append(summary, s)
	}
	h.AuditLog.Log(ctx, "user.placement.update", audit.LevelInfo, audit.Success(), map[string]any{
		"userId": id.String(), "areas": strings.Join(summary, ", "), "extras": strings.Join(placement.Extras, ", "),
		"groupsAdded": added, "groupsRemoved": removed,
	})
	writeData(w, http.StatusOK, placement)
}
