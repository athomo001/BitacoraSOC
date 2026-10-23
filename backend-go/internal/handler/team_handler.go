package handler

import (
	"context"
	"crypto/rand"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// CapAreaLead marca a un grupo como jefatura de sus áreas (spec/16 §3.5).
const CapAreaLead = "area:lead"

// TeamHandler es Mi equipo: la jefatura de área (spec/16 §3.5, 9d, diseño
// aprobado por el dueño 2026-10-13). La jefatura ve a la gente de sus áreas,
// cómo está hoy (Dotación y guardias) y su carga de tickets; puede agregar
// personas, cambiarles el grupo y darlas de baja o reactivarlas, siempre
// dentro de sus áreas y nunca con permisos de administrador. Todo queda en
// Auditoría. Las guardias y el escalamiento del área llegan en 9e.
type TeamHandler struct {
	Queries *db.Queries
	// Pool abre las transacciones (el pgxpool; en las pruebas, una
	// transacción externa que se deshace al final).
	Pool interface {
		Begin(ctx context.Context) (pgx.Tx, error)
	}
	AuditLog *audit.Logger
	// Resumen mensual (9.7): el correo (Notify) con los destinatarios válidos de Reportes.
	Notify  *Notifier
	Reports *ReportsHandler
	Now     func() time.Time
}

type teamAreaDTO struct {
	Code string `json:"code"`
	Name string `json:"name"`
	// Lead: es jefatura del área (el auditor ve las demás solo para la Calidad).
	Lead bool `json:"lead"`
	// Quality: el área usa la Bitácora y tiene la pestaña Calidad (10f).
	Quality bool `json:"quality"`
}

type leadGroupDTO struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Level string    `json:"level"`
}

type teamDayDTO struct {
	Date      string `json:"date"`
	Condition string `json:"condition"`
}

type teamPersonDTO struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
	FullName string    `json:"fullName"`
	Email    string    `json:"email"`
	Active   bool      `json:"active"`
	Editable bool      `json:"editable"`
	// Removable: la jefatura la puede sacar del área (Sacar del equipo).
	Removable bool `json:"removable"`
	// Areas: en la vista del departamento, las áreas en que está.
	Areas    []string       `json:"areas,omitempty"`
	Groups   []leadGroupDTO `json:"groups"`
	Today    string         `json:"today"`
	Week     []teamDayDTO   `json:"week"`
	Tickets  int64          `json:"tickets"`
	Breached int64          `json:"breached"`
}

type teamStatsDTO struct {
	People   int   `json:"people"`
	Tickets  int64 `json:"tickets"`
	Breached int64 `json:"breached"`
	Away     int   `json:"away"`
}

// leadAreas: las áreas activas de las que el usuario es jefatura; el admin
// lo es de todas.
func (h *TeamHandler) leadAreas(ctx context.Context, user middleware.AuthenticatedUser) ([]db.ListLeadAreasRow, error) {
	if user.Role == "admin" {
		rows, err := h.Queries.ListActiveAreas(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]db.ListLeadAreasRow, 0, len(rows))
		for _, r := range rows {
			out = append(out, db.ListLeadAreasRow(r))
		}
		return out, nil
	}
	return h.Queries.ListLeadAreas(ctx, user.ID)
}

// leadScope resuelve el área pedida (?area= o el cuerpo) contra las del
// usuario. Escribe el error y devuelve ok=false si no es suya.
func (h *TeamHandler) leadScope(w http.ResponseWriter, r *http.Request, code string) (middleware.AuthenticatedUser, db.ListLeadAreasRow, map[string]bool, bool) {
	user, _ := middleware.UserFromContext(r.Context())
	areas, err := h.leadAreas(r.Context(), user)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return user, db.ListLeadAreasRow{}, nil, false
	}
	codes := map[string]bool{}
	var area db.ListLeadAreasRow
	for _, a := range areas {
		codes[a.Code] = true
		if a.Code == code {
			area = a
		}
	}
	if area.Code == "" {
		problemdetails.Write(w, r, http.StatusForbidden, "not-area-lead", "no eres jefatura de esa área")
		return user, area, nil, false
	}
	return user, area, codes, true
}

// groupAssignable: la jefatura asigna los grupos del área que no salen de
// sus áreas y que no dan jefatura (solo el admin nombra jefaturas).
func groupAssignable(areaCodes, capabilities []string, lead map[string]bool, isAdmin bool) bool {
	if isAdmin {
		return true
	}
	if slices.Contains(capabilities, CapAreaLead) {
		return false
	}
	for _, c := range areaCodes {
		if !lead[c] {
			return false
		}
	}
	return true
}

// personManageable: la jefatura no toca administradores, ni a sí misma, ni a
// quien tiene grupos de otras áreas o de jefatura (eso es del admin). Los
// grupos sin área (permisos generales) no la bloquean.
func personManageable(role db.UserRole, self bool, groups []db.ListUserGroupsWithAreasRow, lead map[string]bool, isAdmin bool) bool {
	if self || role == db.UserRoleAdmin {
		return false
	}
	if isAdmin {
		return true
	}
	for _, g := range groups {
		if len(g.AreaCodes) > 0 && !groupAssignable(g.AreaCodes, g.Capabilities, lead, false) {
			return false
		}
	}
	return true
}

// dayCondition: vacaciones, licencia o trámite médico mandan; si no, la
// guardia; si no, lo que diga Dotación (oficina por defecto).
func dayCondition(assigned string, onGuard bool) string {
	switch assigned {
	case "vacation", "medical_leave", "medical_appointment":
		return assigned
	}
	if onGuard {
		return "guardia"
	}
	if assigned == "" {
		return "office"
	}
	return assigned
}

func teamLocation() *time.Location {
	if loc, err := time.LoadLocation("America/Santiago"); err == nil {
		return loc
	}
	return time.UTC
}

// weekDays: lunes a viernes de la semana de hoy.
func weekDays(today time.Time) []time.Time {
	offset := (int(today.Weekday()) + 6) % 7
	monday := today.AddDate(0, 0, -offset)
	days := make([]time.Time, 5)
	for i := range days {
		days[i] = monday.AddDate(0, 0, i)
	}
	return days
}

func pgDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

// Areas es GET /api/team/areas: las áreas de las que soy jefatura.
func (h *TeamHandler) Areas(w http.ResponseWriter, r *http.Request) {
	user, _ := middleware.UserFromContext(r.Context())
	areas, lead, err := h.visibleAreas(r.Context(), user)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return
	}
	operativo, err := h.qualityAreas(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return
	}
	out := make([]teamAreaDTO, 0, len(areas))
	for _, a := range areas {
		// Al auditor solo le sirven las áreas con Calidad.
		if !lead[a.Code] && !operativo[a.Code] {
			continue
		}
		out = append(out, teamAreaDTO{Code: a.Code, Name: a.Name, Lead: lead[a.Code], Quality: operativo[a.Code]})
	}
	writeData(w, http.StatusOK, out)
}

// Get es GET /api/team?area=: la gente del área, cómo está y su carga. Con
// ?department= es el departamento completo (solo para mirar).
func (h *TeamHandler) Get(w http.ResponseWriter, r *http.Request) {
	if dep := r.URL.Query().Get("department"); dep != "" {
		h.getDepartment(w, r, dep)
		return
	}
	user, area, lead, ok := h.leadScope(w, r, r.URL.Query().Get("area"))
	if !ok {
		return
	}
	view, err := h.teamView(r.Context(), user, area, lead)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
		return
	}
	writeData(w, http.StatusOK, view)
}

type teamViewDTO struct {
	Area   teamAreaDTO     `json:"area"`
	Stats  teamStatsDTO    `json:"stats"`
	People []teamPersonDTO `json:"people"`
	// Groups: los grupos del área que la jefatura puede asignar.
	Groups []leadGroupDTO `json:"groups"`
}

// teamView arma Mi equipo → Personas de un área.
func (h *TeamHandler) teamView(ctx context.Context, user middleware.AuthenticatedUser, area db.ListLeadAreasRow, lead map[string]bool) (teamViewDTO, error) {
	isAdmin := user.Role == "admin"
	now := time.Now()
	loc := teamLocation()
	y, m, d := now.In(loc).Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	days := weekDays(today)
	from, to := days[0], days[len(days)-1]
	if today.Before(from) || today.After(to) {
		// Fin de semana: la fila "hoy" igual se calcula.
		if today.Before(from) {
			from = today
		} else {
			to = today
		}
	}

	people, err := h.Queries.ListAreaPeople(ctx, db.ListAreaPeopleParams{Now: pgtype.Timestamptz{Time: now, Valid: true}, AreaID: area.ID})
	if err != nil {
		return teamViewDTO{}, err
	}
	memberships, err := h.Queries.ListAreaPeopleGroups(ctx, area.ID)
	if err != nil {
		return teamViewDTO{}, err
	}
	areaGroups, err := h.Queries.ListAreaGroups(ctx, area.ID)
	if err != nil {
		return teamViewDTO{}, err
	}
	assignments, err := h.Queries.ListAssignmentsForRange(ctx, db.ListAssignmentsForRangeParams{FromDate: pgDate(from), ToDate: pgDate(to)})
	if err != nil {
		return teamViewDTO{}, err
	}
	slots, err := h.Queries.ListGuardSlotsForRange(ctx, db.ListGuardSlotsForRangeParams{FromDate: pgDate(from), ToDate: pgDate(to)})
	if err != nil {
		return teamViewDTO{}, err
	}

	const dayFmt = "2006-01-02"
	assigned := map[uuid.UUID]map[string]string{}
	for _, a := range assignments {
		if assigned[a.UserID] == nil {
			assigned[a.UserID] = map[string]string{}
		}
		assigned[a.UserID][a.AssignedDate.Time.Format(dayFmt)] = string(a.Condition)
	}
	onGuard := func(id uuid.UUID, day time.Time) bool {
		for _, s := range slots {
			if s.UserID.Valid && s.MemberActive && uuid.UUID(s.UserID.Bytes) == id &&
				!day.Before(s.WeekStartDate.Time) && !day.After(s.WeekEndDate.Time) {
				return true
			}
		}
		return false
	}
	groupsOf := map[uuid.UUID][]leadGroupDTO{}
	for _, g := range memberships {
		groupsOf[g.UserID] = append(groupsOf[g.UserID], leadGroupDTO{ID: g.ID, Name: g.Name})
	}

	stats := teamStatsDTO{}
	out := make([]teamPersonDTO, 0, len(people))
	for _, p := range people {
		groups, err := h.Queries.ListUserGroupsWithAreas(ctx, p.ID)
		if err != nil {
			return teamViewDTO{}, err
		}
		person := teamPersonDTO{
			ID: p.ID, Username: p.Username, FullName: p.FullName, Email: p.Email, Active: p.Active,
			Editable:  personManageable(p.Role, p.ID == user.ID, groups, lead, isAdmin),
			Removable: personRemovable(p.Role, p.ID == user.ID, groups, area.Code, lead, isAdmin),
			Groups:    groupsOf[p.ID], Tickets: p.OpenTickets, Breached: p.BreachedTickets,
			Today: dayCondition(assigned[p.ID][today.Format(dayFmt)], onGuard(p.ID, today)),
		}
		if person.Groups == nil {
			person.Groups = []leadGroupDTO{}
		}
		for _, day := range days {
			person.Week = append(person.Week, teamDayDTO{
				Date: day.Format(dayFmt), Condition: dayCondition(assigned[p.ID][day.Format(dayFmt)], onGuard(p.ID, day)),
			})
		}
		if p.Active {
			stats.People++
			stats.Tickets += p.OpenTickets
			stats.Breached += p.BreachedTickets
			if person.Today == "vacation" || person.Today == "medical_leave" {
				stats.Away++
			}
		}
		out = append(out, person)
	}

	assignable := make([]leadGroupDTO, 0, len(areaGroups))
	for _, g := range areaGroups {
		if groupAssignable(g.AreaCodes, g.Capabilities, lead, isAdmin) {
			assignable = append(assignable, leadGroupDTO{ID: g.ID, Name: g.Name, Level: g.LevelName})
		}
	}
	return teamViewDTO{Area: teamAreaDTO{Code: area.Code, Name: area.Name}, Stats: stats, People: out, Groups: assignable}, nil
}

// target carga a la persona y verifica que la jefatura pueda tocarla.
func (h *TeamHandler) target(w http.ResponseWriter, r *http.Request, user middleware.AuthenticatedUser, area db.ListLeadAreasRow, lead map[string]bool) (db.User, bool) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return db.User{}, false
	}
	person, err := h.Queries.GetUserByID(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "persona no encontrada")
		return db.User{}, false
	}
	groups, err := h.Queries.ListUserGroupsWithAreas(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return db.User{}, false
	}
	inArea := false
	for _, g := range groups {
		if slices.Contains(g.AreaCodes, area.Code) {
			inArea = true
		}
	}
	if !inArea {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la persona no es de esta área")
		return db.User{}, false
	}
	if !personManageable(person.Role, person.ID == user.ID, groups, lead, user.Role == "admin") {
		problemdetails.Write(w, r, http.StatusForbidden, "not-manageable", "esta persona es administradora, jefatura o tiene grupos de otras áreas: la gestiona el administrador")
		return db.User{}, false
	}
	return person, true
}

// assignableGroup verifica que el grupo pedido sea del área y asignable.
func (h *TeamHandler) assignableGroup(w http.ResponseWriter, r *http.Request, area db.ListLeadAreasRow, lead map[string]bool, isAdmin bool, groupID uuid.UUID) (db.ListAreaGroupsRow, bool) {
	groups, err := h.Queries.ListAreaGroups(r.Context(), area.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los grupos")
		return db.ListAreaGroupsRow{}, false
	}
	for _, g := range groups {
		if g.ID == groupID && groupAssignable(g.AreaCodes, g.Capabilities, lead, isAdmin) {
			return g, true
		}
	}
	problemdetails.Write(w, r, http.StatusBadRequest, "invalid-group", "elige un grupo de tu área")
	return db.ListAreaGroupsRow{}, false
}

// PersonTickets es GET /api/team/people/{id}/tickets?area=.
func (h *TeamHandler) PersonTickets(w http.ResponseWriter, r *http.Request) {
	_, area, _, ok := h.leadScope(w, r, r.URL.Query().Get("area"))
	if !ok {
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	groups, err := h.Queries.ListUserGroupsWithAreas(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	inArea := slices.ContainsFunc(groups, func(g db.ListUserGroupsWithAreasRow) bool { return slices.Contains(g.AreaCodes, area.Code) })
	if !inArea {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la persona no es de esta área")
		return
	}
	rows, err := h.Queries.ListPersonOpenTickets(r.Context(), db.ListPersonOpenTicketsParams{Now: pgtype.Timestamptz{Time: time.Now(), Valid: true}, UserID: id})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus tickets")
		return
	}
	type ticketDTO struct {
		ID       uuid.UUID `json:"id"`
		Number   string    `json:"number"`
		Title    string    `json:"title"`
		Status   string    `json:"status"`
		Breached bool      `json:"breached"`
	}
	out := make([]ticketDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, ticketDTO{ID: t.ID, Number: t.TicketNumber, Title: t.Title, Status: string(t.Status), Breached: t.Breached})
	}
	writeData(w, http.StatusOK, out)
}

var teamUsername = regexp.MustCompile(`^[a-z0-9._-]{3,40}$`)

type createTeamPersonRequest struct {
	Area     string    `json:"area"`
	FullName string    `json:"fullName"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
	GroupID  uuid.UUID `json:"groupId"`
}

// tempPassword: 14 caracteres sin los que se confunden (0/O, 1/l/I).
func tempPassword() (string, error) {
	const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 14)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b), nil
}

// CreatePerson es POST /api/team/people: alta con contraseña temporal (se
// muestra una vez a la jefatura) y el grupo elegido de su área. Siempre rol
// usuario.
func (h *TeamHandler) CreatePerson(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createTeamPersonRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	user, area, lead, ok := h.leadScope(w, r, req.Area)
	if !ok {
		return
	}
	req.FullName = strings.TrimSpace(req.FullName)
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.FullName == "" || !teamUsername.MatchString(req.Username) || !strings.Contains(req.Email, "@") {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "nombre, usuario (3 a 40 letras minúsculas, números, punto o guion) y correo son obligatorios")
		return
	}
	group, ok := h.assignableGroup(w, r, area, lead, user.Role == "admin", req.GroupID)
	if !ok {
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

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar a la persona")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := h.Queries.WithTx(tx)
	created, err := q.CreateTeamUser(ctx, db.CreateTeamUserParams{
		Username: req.Username, Email: req.Email, FullName: pgtype.Text{String: req.FullName, Valid: true}, PasswordHash: hash,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-user", "ya existe alguien con ese usuario o correo")
		return
	}
	if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
		UserID: created.ID, PermissionGroupID: group.ID, AssignedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
	}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo asignar el grupo")
		return
	}
	if err := propagateShared(ctx, q, created.ID, placementDTO{}, user.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo asignar el grupo")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar a la persona")
		return
	}
	h.AuditLog.Log(ctx, "team.person.create", audit.LevelInfo, audit.Success(), map[string]any{
		"area": area.Code, "userId": created.ID.String(), "username": created.Username, "group": group.Name,
	})
	writeData(w, http.StatusCreated, map[string]any{"id": created.ID, "username": created.Username, "tempPassword": password})
}

type teamGroupRequest struct {
	Area    string    `json:"area"`
	GroupID uuid.UUID `json:"groupId"`
}

// SetGroup es PUT /api/team/people/{id}/group: cambia el grupo de la persona
// en el área (quita los del área que la jefatura asigna y pone el elegido).
// Los grupos generales o de otras áreas no se tocan.
func (h *TeamHandler) SetGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req teamGroupRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	user, area, lead, ok := h.leadScope(w, r, req.Area)
	if !ok {
		return
	}
	isAdmin := user.Role == "admin"
	person, ok := h.target(w, r, user, area, lead)
	if !ok {
		return
	}
	group, ok := h.assignableGroup(w, r, area, lead, isAdmin, req.GroupID)
	if !ok {
		return
	}
	current, err := h.Queries.ListUserGroupsWithAreas(ctx, person.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	before, err := placementOf(ctx, h.Queries, person.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		for _, g := range current {
			if g.ID != group.ID && slices.Contains(g.AreaCodes, area.Code) && groupAssignable(g.AreaCodes, g.Capabilities, lead, isAdmin) {
				if err := q.RemoveUserPermissionGroup(ctx, db.RemoveUserPermissionGroupParams{UserID: person.ID, PermissionGroupID: g.ID}); err != nil {
					return err
				}
			}
		}
		if !slices.ContainsFunc(current, func(g db.ListUserGroupsWithAreasRow) bool { return g.ID == group.ID }) {
			if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
				UserID: person.ID, PermissionGroupID: group.ID, AssignedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
			}); err != nil {
				return err
			}
		}
		// El nuevo nivel vale también en las áreas que comparten equipo.
		return propagateShared(ctx, q, person.ID, before, user.ID)
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cambiar el grupo")
		return
	}
	h.AuditLog.Log(ctx, "team.person.group", audit.LevelInfo, audit.Success(), map[string]any{
		"area": area.Code, "userId": person.ID.String(), "username": person.Username, "group": group.Name,
	})
	writeNoContent(w)
}

// personRemovable: la jefatura puede sacar a la persona del área si no es
// administradora ni ella misma y todos sus grupos del área son de los que
// asigna (un grupo compartido con otra área o de jefatura lo saca el admin).
// El admin saca a cualquiera menos a sí mismo.
func personRemovable(role db.UserRole, self bool, groups []db.ListUserGroupsWithAreasRow, areaCode string, lead map[string]bool, isAdmin bool) bool {
	if self {
		return false
	}
	if isAdmin {
		return true
	}
	if role == db.UserRoleAdmin {
		return false
	}
	for _, g := range groups {
		if slices.Contains(g.AreaCodes, areaCode) && !groupAssignable(g.AreaCodes, g.Capabilities, lead, false) {
			return false
		}
	}
	return true
}

type teamCandidateDTO struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
	Name     string    `json:"name"`
	// Areas: las áreas en que ya está (sigue en ellas).
	Areas []string `json:"areas"`
}

// Candidates es GET /api/team/candidates?area=: las cuentas activas que
// todavía no están en el área, para «Agregar a alguien que ya existe». La
// jefatura no ve a los administradores.
func (h *TeamHandler) Candidates(w http.ResponseWriter, r *http.Request) {
	user, area, _, ok := h.leadScope(w, r, r.URL.Query().Get("area"))
	if !ok {
		return
	}
	rows, err := h.Queries.ListTeamCandidates(r.Context(), area.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la gente")
		return
	}
	out := make([]teamCandidateDTO, 0, len(rows))
	for _, c := range rows {
		if c.Role == string(db.UserRoleAdmin) && user.Role != "admin" {
			continue
		}
		out = append(out, teamCandidateDTO{ID: c.ID, Username: c.Username, Name: c.Name, Areas: c.AreaNames})
	}
	writeData(w, http.StatusOK, out)
}

// Join es POST /api/team/people/{id}/join {area, groupId}: suma al área a
// alguien que ya tiene cuenta, con un grupo del área que la jefatura asigna.
// Sus otras áreas no se tocan.
func (h *TeamHandler) Join(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req teamGroupRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	user, area, lead, ok := h.leadScope(w, r, req.Area)
	if !ok {
		return
	}
	isAdmin := user.Role == "admin"
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	rows, err := h.Queries.ListTeamCandidates(ctx, area.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la gente")
		return
	}
	idx := slices.IndexFunc(rows, func(c db.ListTeamCandidatesRow) bool { return c.ID == id })
	if idx < 0 || (rows[idx].Role == string(db.UserRoleAdmin) && !isAdmin) {
		problemdetails.Write(w, r, http.StatusBadRequest, "not-candidate", "esa persona ya está en el área, no está activa o la agrega el administrador")
		return
	}
	group, ok := h.assignableGroup(w, r, area, lead, isAdmin, req.GroupID)
	if !ok {
		return
	}
	before, err := placementOf(ctx, h.Queries, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
			UserID: id, PermissionGroupID: group.ID, AssignedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
		}); err != nil {
			return err
		}
		// Si el área comparte equipo, entra también a sus hermanas.
		return propagateShared(ctx, q, id, before, user.ID)
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar a la persona")
		return
	}
	h.AuditLog.Log(ctx, "team.person.join", audit.LevelInfo, audit.Success(), map[string]any{
		"area": area.Code, "userId": id.String(), "username": rows[idx].Username, "group": group.Name,
	})
	writeNoContent(w)
}

// Leave es DELETE /api/team/people/{id}?area=: saca a la persona del área
// (le quita sus grupos del área). La cuenta sigue activa y sus entradas
// quedan; dar de baja una cuenta es del administrador (Usuarios y grupos).
func (h *TeamHandler) Leave(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, area, lead, ok := h.leadScope(w, r, r.URL.Query().Get("area"))
	if !ok {
		return
	}
	isAdmin := user.Role == "admin"
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	person, err := h.Queries.GetUserByID(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "persona no encontrada")
		return
	}
	groups, err := h.Queries.ListUserGroupsWithAreas(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	var inArea []db.ListUserGroupsWithAreasRow
	for _, g := range groups {
		if slices.Contains(g.AreaCodes, area.Code) {
			inArea = append(inArea, g)
		}
	}
	if len(inArea) == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la persona no es de esta área")
		return
	}
	if !personRemovable(person.Role, person.ID == user.ID, groups, area.Code, lead, isAdmin) {
		problemdetails.Write(w, r, http.StatusForbidden, "not-manageable", "esta persona es administradora, eres tú o tiene un grupo compartido con otra área: la saca el administrador")
		return
	}
	before, err := placementOf(ctx, h.Queries, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer sus grupos")
		return
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := h.Queries.WithTx(tx)
		for _, g := range inArea {
			if err := q.RemoveUserPermissionGroup(ctx, db.RemoveUserPermissionGroupParams{UserID: id, PermissionGroupID: g.ID}); err != nil {
				return err
			}
		}
		// Si el área comparte equipo, sale también de sus hermanas.
		return propagateShared(ctx, q, id, before, user.ID)
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo sacar a la persona")
		return
	}
	h.AuditLog.Log(ctx, "team.person.leave", audit.LevelInfo, audit.Success(), map[string]any{"area": area.Code, "userId": id.String(), "username": person.Username})
	writeNoContent(w)
}
