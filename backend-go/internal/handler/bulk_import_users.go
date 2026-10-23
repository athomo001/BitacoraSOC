package handler

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Usuarios por CSV (10g): cada fila se busca por usuario. Los nuevos entran
// como en el alta de a uno: contraseña temporal que se muestra una sola vez
// y que se cambia al entrar. La columna areas deja a la persona en esas
// áreas y niveles («SOC=N1; NOC»), como el panel de Usuarios y grupos; la
// jefatura y los permisos extra que ya tenga se respetan.

var userImportColumns = []string{"usuario", "nombre", "correo", "rol", "areas", "cargo", "cumpleanos"}

var roleAlias = map[string]string{
	"usuario": "user", "user": "user", "analista": "user",
	"admin": "admin", "administrador": "admin", "administradora": "admin",
	"auditor": "auditor", "auditora": "auditor",
}

var roleName = map[string]string{"user": "usuario", "admin": "admin", "auditor": "auditor"}

type userCatalog struct {
	users   map[string]db.User // usuario → fila
	byEmail map[string]string  // correo → usuario
	areas   map[string]db.Area
	levels  map[string]db.Level
	area    lookup[string] // código o nombre → código
	level   lookup[string] // código o nombre → id
}

func (h *BulkImportHandler) userCatalog(ctx context.Context) (userCatalog, error) {
	c := userCatalog{users: map[string]db.User{}, byEmail: map[string]string{}, area: newLookup[string](), level: newLookup[string]()}
	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{})
	if err != nil {
		return c, err
	}
	for _, u := range users {
		c.users[u.Username] = u
		c.byEmail[strings.ToLower(u.Email)] = u.Username
	}
	if c.areas, c.levels, err = placementCatalog(ctx, h.Queries); err != nil {
		return c, err
	}
	for _, a := range c.areas {
		c.area.add(a.Code, a.Code)
		c.area.add(a.Name, a.Code)
	}
	for id, l := range c.levels {
		c.level.add(l.Code, id)
		c.level.add(l.Name, id)
	}
	return c, nil
}

// parseAreas: «SOC=N1; NOC» → áreas con su nivel.
func (c userCatalog) parseAreas(cell string) ([]placementArea, string) {
	out := []placementArea{}
	for _, p := range splitList(cell) {
		name, lvl, _ := strings.Cut(p, "=")
		code, msg := c.area.find("área", name)
		if msg != "" {
			return nil, msg
		}
		if slices.ContainsFunc(out, func(a placementArea) bool { return a.Code == code }) {
			return nil, fmt.Sprintf("el área «%s» se repite", name)
		}
		a := placementArea{Code: code}
		if strings.TrimSpace(lvl) != "" {
			if a.LevelID, msg = c.level.find("nivel", lvl); msg != "" {
				return nil, msg
			}
		}
		out = append(out, a)
	}
	return out, ""
}

func (c userCatalog) areasText(areas []placementArea) string {
	parts := make([]string, 0, len(areas))
	for _, a := range areas {
		s := c.areas[a.Code].Name
		if a.LevelID != "" {
			s += "=" + c.levels[a.LevelID].Name
		}
		parts = append(parts, s)
	}
	return strings.Join(parts, "; ")
}

// userRowInput: lo que trae una fila, ya validado.
type userRowInput struct {
	username, fullName, email, role, cargo string
	birthday                               *time.Time
	areas                                  []placementArea
	setAreas                               bool
}

func (c userCatalog) parseUserRow(cols map[string]string) (userRowInput, string) {
	in := userRowInput{username: strings.ToLower(cols["usuario"]), fullName: cols["nombre"], email: strings.ToLower(cols["correo"]), cargo: cols["cargo"]}
	if !teamUsername.MatchString(in.username) {
		return in, "el usuario va de 3 a 40 letras minúsculas, números, punto o guion"
	}
	if in.email != "" && !strings.Contains(in.email, "@") {
		return in, fmt.Sprintf("el correo «%s» no es válido", cols["correo"])
	}
	if owner, taken := c.byEmail[in.email]; in.email != "" && taken && owner != in.username {
		return in, fmt.Sprintf("el correo ya es de %s", owner)
	}
	if v := cols["rol"]; v != "" {
		role, ok := roleAlias[strings.ToLower(v)]
		if !ok {
			return in, fmt.Sprintf("rol «%s»: usa usuario, admin o auditor", v)
		}
		in.role = role
	}
	if v := cols["cumpleanos"]; v != "" {
		day, ok := parseDay(v)
		if !ok || day.After(time.Now()) || day.Year() < 1900 {
			return in, "el cumpleaños va como AAAA-MM-DD y no puede ser futuro"
		}
		in.birthday = &day
	}
	if v := cols["areas"]; v != "" {
		areas, msg := c.parseAreas(v)
		if msg != "" {
			return in, msg
		}
		in.areas, in.setAreas = areas, true
	}
	return in, ""
}

// Users es POST /api/users/import?dryRun=true (cuerpo: el CSV).
func (h *BulkImportHandler) Users(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lines, ok := readUpload(w, r, maxImportCSVBytes, "usuario")
	if !ok {
		return
	}
	c, err := h.userCatalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los usuarios")
		return
	}
	me, _ := middleware.UserFromContext(ctx)
	dryRun := r.URL.Query().Get("dryRun") == "true"
	seen := map[string]int{}
	rows := make([]importRow, 0, len(lines))
	for _, l := range lines {
		row := csvRowResult{Line: l.line, Code: strings.ToLower(l.cols["usuario"]), Name: l.cols["nombre"]}
		in, msg := c.parseUserRow(l.cols)
		if prev, dup := seen[in.username]; msg == "" && dup {
			msg = fmt.Sprintf("el usuario se repite (también en la fila %d)", prev)
		}
		if msg != "" {
			rows = append(rows, failRow(row, msg))
			continue
		}
		seen[in.username] = l.line
		existing, found := c.users[in.username]
		switch {
		case !found:
			rows = append(rows, h.newUserRow(row, in, c, me.ID, dryRun))
		case existing.ID == me.ID && in.role != "" && in.role != "admin":
			rows = append(rows, failRow(row, "no puedes quitarte el rol de administrador a ti mismo"))
		default:
			rows = append(rows, h.updateUserRow(ctx, row, in, existing, c, me.ID))
		}
	}
	h.finish(w, r, "users.import", rows)
}

func (h *BulkImportHandler) newUserRow(row csvRowResult, in userRowInput, c userCatalog, actor uuid.UUID, dryRun bool) importRow {
	if in.fullName == "" || in.email == "" {
		return failRow(row, "para crear a alguien faltan el nombre y el correo")
	}
	if in.role == "" {
		in.role = "user"
	}
	row.Action = "create"
	row.Detail = roleName[in.role]
	if len(in.areas) > 0 {
		row.Detail += " · " + c.areasText(in.areas)
	}
	if dryRun {
		return importRow{csvRowResult: row}
	}
	password, err := tempPassword()
	if err != nil {
		return failRow(row, "no se pudo generar la contraseña")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return failRow(row, "no se pudo procesar la contraseña")
	}
	row.Secret = password
	return importRow{csvRowResult: row, apply: func(ctx context.Context, q *db.Queries) error {
		u, err := q.CreateTeamUser(ctx, db.CreateTeamUserParams{Username: in.username, Email: in.email, FullName: pgtype.Text{String: in.fullName, Valid: true}, PasswordHash: hash})
		if err != nil {
			return err
		}
		if _, err := q.UpdateUserAdmin(ctx, userChanges(u.ID, in)); err != nil {
			return err
		}
		for _, a := range in.areas {
			groupID, err := ensureShapedGroup(ctx, q, shapeSpec{Area: a.Code, Level: a.LevelID, Caps: []string{}}, c.areas, c.levels)
			if err != nil {
				return err
			}
			if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{UserID: u.ID, PermissionGroupID: groupID, AssignedBy: pgtype.UUID{Bytes: actor, Valid: actor != uuid.Nil}}); err != nil {
				return err
			}
		}
		return propagateShared(ctx, q, u.ID, placementDTO{}, actor)
	}}
}

// userChanges: los campos de la fila que se escriben (vacío = se mantiene).
func userChanges(id uuid.UUID, in userRowInput) db.UpdateUserAdminParams {
	p := db.UpdateUserAdminParams{ID: id, FullName: optText(in.fullName), Email: optText(in.email), CargoLabel: optText(in.cargo)}
	if in.role != "" {
		p.Role = db.NullUserRole{UserRole: db.UserRole(in.role), Valid: true}
	}
	if in.birthday != nil {
		p.SetBirthday, p.Birthday = true, pgDate(*in.birthday)
	}
	return p
}

func (h *BulkImportHandler) updateUserRow(ctx context.Context, row csvRowResult, in userRowInput, u db.User, c userCatalog, actor uuid.UUID) importRow {
	var diff []string
	if in.fullName != "" && in.fullName != u.FullName.String {
		diff = append(diff, "nombre")
	}
	if in.email != "" && in.email != strings.ToLower(u.Email) {
		diff = append(diff, "correo")
	}
	if in.role != "" && in.role != string(u.Role) {
		diff = append(diff, "rol: "+roleName[string(u.Role)]+" → "+roleName[in.role])
	}
	if in.cargo != "" && in.cargo != u.CargoLabel.String {
		diff = append(diff, "cargo")
	}
	if in.birthday != nil && (!u.Birthday.Valid || !u.Birthday.Time.Equal(*in.birthday)) {
		diff = append(diff, "cumpleaños")
	}
	var current placementDTO
	if in.setAreas {
		shapes, err := h.Queries.ListUserGroupShapes(ctx, u.ID)
		if err != nil {
			return failRow(row, "no se pudieron leer sus áreas")
		}
		current = derivePlacement(shapesOf(shapes), activeSet(c.areas))
		if !sameAreas(current.Areas, in.areas) {
			diff = append(diff, "áreas: "+cmpText(c.areasText(current.Areas))+" → "+c.areasText(in.areas))
		}
	}
	if len(diff) == 0 {
		row.Action, row.Detail = "unchanged", "sin cambios"
		return importRow{csvRowResult: row}
	}
	row.Action, row.Detail = "update", strings.Join(diff, " · ")
	return importRow{csvRowResult: row, apply: func(ctx context.Context, q *db.Queries) error {
		if _, err := q.UpdateUserAdmin(ctx, userChanges(u.ID, in)); err != nil {
			return err
		}
		if !in.setAreas {
			return nil
		}
		return applyAreas(ctx, q, u.ID, in.areas, current, c, actor)
	}}
}

// applyAreas deja a la persona en esas áreas, con la jefatura y los
// permisos extra que ya tenía.
func applyAreas(ctx context.Context, q *db.Queries, userID uuid.UUID, areas []placementArea, current placementDTO, c userCatalog, actor uuid.UUID) error {
	want := placementDTO{Areas: make([]placementArea, 0, len(areas)), Extras: current.Extras}
	for _, a := range areas {
		a.Lead = slices.ContainsFunc(current.Areas, func(x placementArea) bool { return x.Code == a.Code && x.Lead })
		want.Areas = append(want.Areas, a)
	}
	sets, err := sharedSets(ctx, q)
	if err != nil {
		return err
	}
	_, _, err = applyPlacement(ctx, q, userID, shareTeam(current, want, sets), c.areas, c.levels, actor)
	return err
}

// sameAreas: las mismas áreas con el mismo nivel, en cualquier orden.
func sameAreas(a, b []placementArea) bool {
	if len(a) != len(b) {
		return false
	}
	for _, x := range b {
		if !slices.ContainsFunc(a, func(y placementArea) bool { return y.Code == x.Code && y.LevelID == x.LevelID }) {
			return false
		}
	}
	return true
}

func cmpText(s string) string {
	if s == "" {
		return "ninguna"
	}
	return s
}

// UsersTemplate es GET /api/users/import/template.
func (h *BulkImportHandler) UsersTemplate(w http.ResponseWriter, r *http.Request) {
	writeCSV(w, "usuarios.csv", [][]string{userImportColumns, {"jperez", "Juan Pérez", "jperez@empresa.cl", "usuario", "SOC=N1", "Analista SOC", "1990-05-14"}})
}

// UsersExport es GET /api/users/export: los usuarios activos en el mismo
// formato de la carga, para corregir y volver a subir.
func (h *BulkImportHandler) UsersExport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	c, err := h.userCatalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar")
		return
	}
	names := make([]string, 0, len(c.users))
	for name, u := range c.users {
		if u.Active && !u.IsGuest {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	rows := [][]string{userImportColumns}
	for _, name := range names {
		u := c.users[name]
		shapes, err := h.Queries.ListUserGroupShapes(ctx, u.ID)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar")
			return
		}
		birthday := ""
		if u.Birthday.Valid {
			birthday = u.Birthday.Time.Format("2006-01-02")
		}
		areas := c.areasText(derivePlacement(shapesOf(shapes), activeSet(c.areas)).Areas)
		rows = append(rows, []string{u.Username, u.FullName.String, u.Email, roleName[string(u.Role)], areas, u.CargoLabel.String, birthday})
	}
	writeCSV(w, "usuarios-exportado.csv", rows)
}
