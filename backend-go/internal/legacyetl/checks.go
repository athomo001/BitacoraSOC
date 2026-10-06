package legacyetl

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// legacyShiftTime es un turno con su horario, para deducir el turno de un
// checklist viejo que no lo guardó (getCurrentShift del legacy).
type legacyShiftTime struct {
	id         uuid.UUID
	start, end string
	tz         *time.Location
}

func (s legacyShiftTime) contains(t time.Time) bool {
	hm := t.In(s.tz).Format("15:04")
	if s.start <= s.end {
		return hm >= s.start && hm < s.end
	}
	return hm >= s.start || hm < s.end // cruza medianoche
}

// migrateShiftChecks trae el historial de checklists de inicio y cierre de
// turno (colección "checks" del respaldo, modelo ShiftCheck): cada check con
// sus servicios en verde/rojo y su observación, enlazados al ítem de la
// plantilla cuando existe. Si el check no guardó el turno (los más viejos),
// se deduce por la hora, como getCurrentShift del legacy.
func (m *Migrator) migrateShiftChecks(ctx context.Context) error {
	var rows []struct {
		ID            string  `json:"_id"`
		ChecklistID   string  `json:"checklistId"`
		ChecklistName string  `json:"checklistName"`
		UserID        string  `json:"userId"`
		Type          string  `json:"type"`
		CheckDate     string  `json:"checkDate"`
		CreatedAt     string  `json:"createdAt"`
		ShiftID       *string `json:"shiftId"`
		Services      []struct {
			ServiceID    string `json:"serviceId"`
			ServiceTitle string `json:"serviceTitle"`
			Status       string `json:"status"`
			Observation  string `json:"observation"`
		} `json:"services"`
	}
	if err := m.ex.Decode("checks", &rows); err != nil {
		return err
	}
	step := newStep("historial de checklists", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	if len(rows) == 0 {
		return nil
	}

	templates, err := m.idSet(ctx, `SELECT id FROM checklist_templates`)
	if err != nil {
		return err
	}
	items, err := m.idSet(ctx, `SELECT id FROM checklist_items`)
	if err != nil {
		return err
	}
	var shifts []legacyShiftTime
	r, err := m.tx.Query(ctx, `SELECT id, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), timezone FROM work_shifts ORDER BY start_time`)
	if err != nil {
		return err
	}
	for r.Next() {
		var s legacyShiftTime
		var tz string
		if err := r.Scan(&s.id, &s.start, &s.end, &tz); err != nil {
			r.Close()
			return err
		}
		if s.tz, err = time.LoadLocation(tz); err != nil {
			s.tz = time.UTC
		}
		shifts = append(shifts, s)
	}
	r.Close()

	services, deduced, archived := 0, 0, 0
	for _, c := range rows {
		user, ok := m.users[c.UserID]
		if !ok {
			step.skip("de un usuario que no viene en la exportación")
			continue
		}
		template := ID("checklistTemplates", c.ChecklistID)
		if !templates[template] {
			// La plantilla se borró en el legacy: se recrea inactiva con el
			// nombre que guardó el check, para no perder su historial.
			name := strings.TrimSpace(c.ChecklistName)
			if name == "" {
				name = "Checklist eliminado"
			}
			if _, err := m.tx.Exec(ctx, `INSERT INTO checklist_templates (id, name, is_active) VALUES ($1,$2,false)`, template, name+" (eliminada)"); err != nil {
				return err
			}
			templates[template] = true
			archived++
		}
		if c.Type != "inicio" && c.Type != "cierre" {
			step.skip("sin tipo inicio/cierre")
			continue
		}
		when := timeOr(c.CheckDate, timeOr(c.CreatedAt, time.Time{}))
		if when.IsZero() {
			step.skip("sin fecha")
			continue
		}
		var shift uuid.UUID
		if c.ShiftID != nil {
			shift = m.shifts[*c.ShiftID]
		}
		if shift == uuid.Nil {
			for _, s := range shifts {
				if s.contains(when) {
					shift = s.id
					break
				}
			}
			if shift == uuid.Nil && len(shifts) > 0 {
				shift = shifts[0].id
			}
			if shift == uuid.Nil {
				step.skip("sin turno al que asignarlo")
				continue
			}
			deduced++
		}
		hasRed := false
		for _, s := range c.Services {
			if s.Status == "rojo" {
				hasRed = true
			}
		}
		check := ID("checks", c.ID)
		if _, err := m.tx.Exec(ctx, `INSERT INTO shift_checks (id, checklist_template_id, user_id, work_shift_id, check_type, check_date, has_red_services)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`, check, template, user, shift, c.Type, when, hasRed); err != nil {
			return err
		}
		for i, s := range c.Services {
			status := s.Status
			if status != "verde" && status != "rojo" {
				continue
			}
			var item *uuid.UUID
			if id := ID("checklistItems", c.ChecklistID+":"+s.ServiceID); items[id] {
				item = &id
			}
			title := strings.TrimSpace(s.ServiceTitle)
			if title == "" {
				title = "(sin nombre)"
			}
			if _, err := m.tx.Exec(ctx, `INSERT INTO shift_check_services (id, shift_check_id, checklist_item_id, service_title, status, observation)
				VALUES ($1,$2,$3,$4,$5,$6)`, ID("checkServices", fmt.Sprintf("%s:%d", c.ID, i)), check, item, title, status, strings.TrimSpace(s.Observation)); err != nil {
				return err
			}
			services++
		}
		step.Loaded++
	}
	step.note("%d servicios revisados; a %d checks sin turno guardado se les dedujo por la hora", services, deduced)
	if archived > 0 {
		step.note("%d plantillas ya borradas en el legacy se recrearon inactivas para conservar su historial", archived)
	}
	return nil
}

// idSet lee una columna de UUID a un conjunto.
func (m *Migrator) idSet(ctx context.Context, query string) (map[uuid.UUID]bool, error) {
	rows, err := m.tx.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// migrateWorkShiftMembers trae workShiftAssignments (WorkShiftAssignment del
// legacy): las personas de cada turno y sus días. A ellas les llegan los
// recordatorios de turno (shiftReminderScheduler del legacy).
func (m *Migrator) migrateWorkShiftMembers(ctx context.Context) error {
	var rows []struct {
		UserID      string  `json:"userId"`
		WorkShiftID string  `json:"workShiftId"`
		Weekdays    []int   `json:"weekdays"`
		Active      *bool   `json:"active"`
		ValidFrom   *string `json:"validFrom"`
		ValidTo     *string `json:"validTo"`
	}
	if err := m.ex.Decode("workShiftAssignments", &rows); err != nil {
		return err
	}
	step := newStep("personas del turno", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	for _, a := range rows {
		user, ok1 := m.users[a.UserID]
		shift, ok2 := m.shifts[a.WorkShiftID]
		if !ok1 || !ok2 {
			step.skip("de una persona o turno que no viene en la exportación")
			continue
		}
		days := []int{}
		for _, d := range a.Weekdays {
			if d >= 0 && d <= 6 {
				days = append(days, d)
			}
		}
		if len(days) == 0 {
			step.skip("sin días")
			continue
		}
		var from, to *time.Time
		if a.ValidFrom != nil {
			if t, ok := ParseTime(*a.ValidFrom); ok {
				from = &t
			}
		}
		if a.ValidTo != nil {
			if t, ok := ParseTime(*a.ValidTo); ok {
				to = &t
			}
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO work_shift_members (work_shift_id, user_id, weekdays, active, valid_from, valid_to)
			VALUES ($1,$2,$3,$4,$5::date,$6::date) ON CONFLICT (work_shift_id, user_id) DO NOTHING`,
			shift, user, days, a.Active == nil || *a.Active, from, to); err != nil {
			return err
		}
		step.Loaded++
	}
	if step.Loaded > 0 {
		step.note("los recordatorios de turno les llegan a estas personas, como en el legacy")
	}
	return nil
}
