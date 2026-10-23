package handler

import (
	"context"
	"net/http"
	"slices"
	"sort"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// Mi equipo del departamento (spec/16 §3.5.1, diseño aprobado 2026-10-22):
// la jefatura del departamento ve a toda su gente junta, con sus áreas, y
// el Resumen mensual y la Calidad del departamento. Es solo para mirar:
// agregar o cambiar a alguien se hace eligiendo un área.

type teamDepartmentDTO struct {
	ID    uuid.UUID     `json:"id"`
	Name  string        `json:"name"`
	Areas []teamAreaDTO `json:"areas"`
	// Quality: alguna de sus áreas usa la Bitácora.
	Quality bool `json:"quality"`
	// Lead: es jefatura del departamento (el auditor lo ve solo para la Calidad).
	Lead bool `json:"lead"`
}

// visibleDepartments: los departamentos que el usuario ve en Mi equipo. El
// admin, todos; el auditor, los que tienen Calidad; el resto, los que dirige.
func (h *TeamHandler) visibleDepartments(ctx context.Context, user middleware.AuthenticatedUser) ([]teamDepartmentDTO, error) {
	rows, err := h.Queries.ListDepartments(ctx)
	if err != nil {
		return nil, err
	}
	leads, err := h.Queries.ListDepartmentLeads(ctx)
	if err != nil {
		return nil, err
	}
	areas, err := h.Queries.ListActiveAreas(ctx)
	if err != nil {
		return nil, err
	}
	operativo, err := h.qualityAreas(ctx)
	if err != nil {
		return nil, err
	}
	out := []teamDepartmentDTO{}
	for _, d := range rows {
		isLead := user.Role == "admin" || slices.ContainsFunc(leads, func(l db.ListDepartmentLeadsRow) bool { return l.DepartmentID == d.ID && l.UserID == user.ID })
		dto := teamDepartmentDTO{ID: d.ID, Name: d.Name, Areas: []teamAreaDTO{}, Lead: isLead}
		for _, a := range areas {
			if slices.Contains(d.AreaCodes, a.Code) {
				dto.Areas = append(dto.Areas, teamAreaDTO{Code: a.Code, Name: a.Name, Lead: isLead, Quality: operativo[a.Code]})
				dto.Quality = dto.Quality || operativo[a.Code]
			}
		}
		if len(dto.Areas) == 0 || (!isLead && !(user.Role == "auditor" && dto.Quality)) {
			continue
		}
		out = append(out, dto)
	}
	return out, nil
}

// Departments es GET /api/team/departments.
func (h *TeamHandler) Departments(w http.ResponseWriter, r *http.Request) {
	user, _ := middleware.UserFromContext(r.Context())
	out, err := h.visibleDepartments(r.Context(), user)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus departamentos")
		return
	}
	writeData(w, http.StatusOK, out)
}

// departmentScope resuelve ?department= contra los del usuario y devuelve
// sus áreas. leadOnly: solo la jefatura (no el auditor).
func (h *TeamHandler) departmentScope(w http.ResponseWriter, r *http.Request, raw string, leadOnly bool) (middleware.AuthenticatedUser, teamDepartmentDTO, []db.ListLeadAreasRow, bool) {
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	id, err := uuid.Parse(raw)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "departamento inválido")
		return user, teamDepartmentDTO{}, nil, false
	}
	deps, err := h.visibleDepartments(ctx, user)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus departamentos")
		return user, teamDepartmentDTO{}, nil, false
	}
	i := slices.IndexFunc(deps, func(d teamDepartmentDTO) bool { return d.ID == id })
	if i < 0 || (leadOnly && !deps[i].Lead) {
		problemdetails.Write(w, r, http.StatusForbidden, "not-department-lead", "no eres jefatura de ese departamento")
		return user, teamDepartmentDTO{}, nil, false
	}
	all, err := h.Queries.ListActiveAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return user, teamDepartmentDTO{}, nil, false
	}
	var areas []db.ListLeadAreasRow
	for _, a := range all {
		if slices.ContainsFunc(deps[i].Areas, func(x teamAreaDTO) bool { return x.Code == a.Code }) {
			areas = append(areas, db.ListLeadAreasRow(a))
		}
	}
	return user, deps[i], areas, true
}

// getDepartment: Mi equipo → Personas del departamento, la gente de todas
// sus áreas una vez, con las áreas en que está.
func (h *TeamHandler) getDepartment(w http.ResponseWriter, r *http.Request, raw string) {
	ctx := r.Context()
	user, dep, areas, ok := h.departmentScope(w, r, raw, true)
	if !ok {
		return
	}
	lead := map[string]bool{}
	for _, a := range areas {
		lead[a.Code] = true
	}
	byID := map[uuid.UUID]*teamPersonDTO{}
	var order []uuid.UUID
	for _, a := range areas {
		v, err := h.teamView(ctx, user, a, lead)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el equipo")
			return
		}
		for _, p := range v.People {
			if cur, ok := byID[p.ID]; ok {
				cur.Areas = append(cur.Areas, a.Name)
				cur.Groups = append(cur.Groups, p.Groups...)
				continue
			}
			p.Areas = []string{a.Name}
			p.Editable, p.Removable = false, false
			cp := p
			byID[p.ID] = &cp
			order = append(order, p.ID)
		}
	}
	out := teamViewDTO{Area: teamAreaDTO{Code: "", Name: dep.Name}, People: make([]teamPersonDTO, 0, len(order)), Groups: []leadGroupDTO{}}
	for _, id := range order {
		p := byID[id]
		out.People = append(out.People, *p)
		if p.Active {
			out.Stats.People++
			out.Stats.Tickets += p.Tickets
			out.Stats.Breached += p.Breached
			if p.Today == "vacation" || p.Today == "medical_leave" {
				out.Stats.Away++
			}
		}
	}
	sort.SliceStable(out.People, func(i, j int) bool { return out.People[i].FullName < out.People[j].FullName })
	writeData(w, http.StatusOK, out)
}

// monthlyDepartment junta el resumen de cada área del departamento: por
// persona suma tareas y tickets; las entradas, la calidad, las metas y los
// días ausente son de la persona y cuentan una vez.
func (h *TeamHandler) monthlyDepartment(ctx context.Context, dep teamDepartmentDTO, areas []db.ListLeadAreasRow, month time.Time) (monthlyDataDTO, bool, error) {
	out := monthlyDataDTO{Month: month.Format("2006-01"), AreaName: dep.Name, Version: monthlyVersion, Total: monthlyPersonDTO{Name: "Total " + dep.Name}}
	frozen := true
	byID := map[uuid.UUID]*monthlyPersonDTO{}
	var order []uuid.UUID
	for _, a := range areas {
		d, f, err := h.monthly(ctx, a, month)
		if err != nil {
			return out, false, err
		}
		frozen = frozen && f
		out.BizDays = d.BizDays
		if d.ComputedAt.After(out.ComputedAt) {
			out.ComputedAt = d.ComputedAt
		}
		for _, p := range d.People {
			cur, ok := byID[p.ID]
			if !ok {
				cp := p
				byID[p.ID] = &cp
				order = append(order, p.ID)
				continue
			}
			cur.Tasks += p.Tasks
			cur.OnTime += p.OnTime
			cur.DoneLate += p.DoneLate
			cur.OpenLate += p.OpenLate
			cur.Skipped += p.Skipped
			cur.Tickets += p.Tickets
			cur.TicketsSLA += p.TicketsSLA
			cur.AbsentDays = max(cur.AbsentDays, p.AbsentDays)
			cur.GoalsDone = max(cur.GoalsDone, p.GoalsDone)
			if p.Entries > cur.Entries {
				cur.Entries, cur.Quality = p.Entries, p.Quality
			}
		}
	}
	t := &out.Total
	sum, n := 0, 0
	for _, id := range order {
		p := byID[id]
		out.People = append(out.People, *p)
		t.Tasks += p.Tasks
		t.OnTime += p.OnTime
		t.DoneLate += p.DoneLate
		t.OpenLate += p.OpenLate
		t.Skipped += p.Skipped
		t.Tickets += p.Tickets
		t.TicketsSLA += p.TicketsSLA
		t.AbsentDays += p.AbsentDays
		t.GoalsDone += p.GoalsDone
		t.Entries += p.Entries
		if p.Quality >= 0 {
			sum += p.Quality
			n++
		}
	}
	t.Quality = -1
	if n > 0 {
		t.Quality = (sum*2 + n) / (2 * n)
	}
	sort.SliceStable(out.People, func(i, j int) bool { return out.People[i].Name < out.People[j].Name })
	return out, frozen, nil
}
