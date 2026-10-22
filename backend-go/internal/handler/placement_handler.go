package handler

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
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
	CapNoticesSend:          "Enviar avisos con acuse",
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
	return placementCatalog(ctx, h.Queries)
}

// placementCatalog: las áreas encendidas por código y los niveles por id.
func placementCatalog(ctx context.Context, q *db.Queries) (map[string]db.Area, map[string]db.Level, error) {
	areas, err := q.ListAreas(ctx)
	if err != nil {
		return nil, nil, err
	}
	levels, err := q.ListLevels(ctx)
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

// ===== Ficha del área (Áreas y niveles → un área → Personas, 2026-10-14) =====

type areaPersonDTO struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
	FullName string    `json:"fullName"`
	Email    string    `json:"email"`
	Active   bool      `json:"active"`
	// LevelID: "" = en el área sin nivel.
	LevelID string   `json:"levelId"`
	Lead    bool     `json:"lead"`
	Extras  []string `json:"extras"`
}

// AreaPeople es GET /api/areas/{code}/people: la gente del área con su
// nivel, si es jefatura y sus permisos extra.
func (h *PlacementHandler) AreaPeople(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.PathValue("code")
	areas, _, err := h.catalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	if _, ok := areas[code]; !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "área no encontrada o apagada")
		return
	}
	ids, err := h.Queries.ListAreaUserIDs(ctx, code)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la gente del área")
		return
	}
	out := make([]areaPersonDTO, 0, len(ids))
	for _, id := range ids {
		u, err := h.Queries.GetUserByID(ctx, id)
		if err != nil {
			continue
		}
		rows, err := h.Queries.ListUserGroupShapes(ctx, id)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
			return
		}
		p := derivePlacement(shapesOf(rows), activeSet(areas))
		person := areaPersonDTO{ID: u.ID, Username: u.Username, FullName: u.FullName.String, Email: u.Email, Active: u.Active, Extras: p.Extras}
		for _, a := range p.Areas {
			if a.Code == code {
				person.LevelID, person.Lead = a.LevelID, a.Lead
			}
		}
		out = append(out, person)
	}
	slices.SortFunc(out, func(a, b areaPersonDTO) int {
		return strings.Compare(strings.ToLower(cmp.Or(a.FullName, a.Username)), strings.ToLower(cmp.Or(b.FullName, b.Username)))
	})
	writeData(w, http.StatusOK, out)
}

type newAreaPersonRequest struct {
	FullName string `json:"fullName"`
	Username string `json:"username"`
	Email    string `json:"email"`
	LevelID  string `json:"levelId"`
}

// CreateAreaPerson es POST /api/areas/{code}/people: una persona nueva,
// ya ubicada en el área con su nivel. Rol usuario y contraseña temporal,
// que se muestra una vez.
func (h *PlacementHandler) CreateAreaPerson(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.PathValue("code")
	var req newAreaPersonRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.FullName == "" || !teamUsername.MatchString(req.Username) || !strings.Contains(req.Email, "@") {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "nombre, usuario (3 a 40 letras minúsculas, números, punto o guion) y correo son obligatorios")
		return
	}
	areas, levels, err := h.catalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	if _, ok := areas[code]; !ok {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "área no encontrada o apagada")
		return
	}
	if _, ok := levels[req.LevelID]; req.LevelID != "" && !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "nivel inválido")
		return
	}
	password, err := tempPassword()
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo generar la contraseña")
		return
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo procesar la contraseña")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	var created db.User
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		u, err := q.CreateTeamUser(ctx, db.CreateTeamUserParams{
			Username: req.Username, Email: req.Email, FullName: pgtype.Text{String: req.FullName, Valid: true}, PasswordHash: hash,
		})
		if err != nil {
			return errDuplicateUser
		}
		created = u
		groupID, err := ensureShapedGroup(ctx, q, shapeSpec{Area: code, Level: req.LevelID, Caps: []string{}}, areas, levels)
		if err != nil {
			return err
		}
		return q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
			UserID: u.ID, PermissionGroupID: groupID, AssignedBy: pgtype.UUID{Bytes: actor.ID, Valid: actor.ID != uuid.Nil},
		})
	})
	if errors.Is(err, errDuplicateUser) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-user", "ya existe alguien con ese usuario o correo")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar a la persona")
		return
	}
	h.AuditLog.Log(ctx, "area.person.create", audit.LevelInfo, audit.Success(), map[string]any{"area": code, "userId": created.ID.String(), "username": created.Username})
	writeData(w, http.StatusCreated, map[string]any{"id": created.ID, "username": created.Username, "tempPassword": password})
}

var errDuplicateUser = errors.New("usuario repetido")
