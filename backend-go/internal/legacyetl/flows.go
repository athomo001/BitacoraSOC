package legacyetl

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
)

// Flujo de llamadas del legacy (catalogLogSources.escalationFlow) y
// mantenciones programadas (clientEscalationRules de tipo
// scheduled_maintenance). Decisión del dueño 2026-09-30: en cada servicio
// del cliente, el paso 1 es el aviso por correo a PARA/CC (si existe) y
// después van los pasos de llamada en su orden.

type legacyFlowStep struct {
	Order       int    `json:"order"`
	Title       string `json:"title"`
	Type        string `json:"type"`
	ContactName string `json:"contactName"`
	ContactTel  string `json:"contactTel"`
	Contacts    []struct {
		Name string `json:"name"`
		Tel  string `json:"tel"`
	} `json:"contacts"`
}

func (m *Migrator) servicesOf(ctx context.Context, org uuid.UUID) ([]uuid.UUID, error) {
	rows, err := m.tx.Query(ctx, `SELECT id FROM services WHERE organization_id = $1 ORDER BY name`, org)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// flowContact devuelve el contacto de la empresa con ese teléfono o lo crea.
func (m *Migrator) flowContact(ctx context.Context, org uuid.UUID, name, tel string) (uuid.UUID, bool, error) {
	phone := directory.NormalizePhone(tel)
	if phone != "" {
		if id, ok := m.contactPhone[org.String()+"|"+phone]; ok {
			return id, false, nil
		}
	}
	name = directory.Sanitize(name, 120)
	if name == "" {
		name = strings.TrimSpace(tel)
	}
	if name == "" {
		return uuid.Nil, false, nil
	}
	id := ID("flowContacts", org.String()+"|"+phone+"|"+normName(name))
	now := time.Now()
	if err := m.insertContact(ctx, &Step{Skipped: map[string]int{}}, id, org, name, "", "external", "manual", false,
		"Flujo de llamadas (legacy).", now, now, "", tel); err != nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

func (m *Migrator) migrateCallFlows(ctx context.Context) error {
	var sources []struct {
		ID             string           `json:"_id"`
		Name           string           `json:"name"`
		EscalationFlow []legacyFlowStep `json:"escalationFlow"`
		// Leyenda bajo el flujo ("Llamar 3 veces y 1 minutos por cada
		// llamada"): pasa al Recordatorio de la política de cada servicio.
		EscalationLegend string `json:"escalationLegend"`
	}
	if err := m.ex.Decode("catalogLogSources", &sources); err != nil {
		return err
	}
	withFlow := 0
	for _, s := range sources {
		if len(s.EscalationFlow) > 0 {
			withFlow++
		}
	}
	step := newStep("flujos de llamadas", withFlow)
	m.rep.Steps = append(m.rep.Steps, step)
	created := 0
	for _, s := range sources {
		if len(s.EscalationFlow) == 0 {
			continue
		}
		org, ok := m.clientOrgs[s.ID]
		if !ok {
			step.skip("cliente sin organización")
			continue
		}
		services, err := m.servicesOf(ctx, org)
		if err != nil {
			return err
		}
		if len(services) == 0 {
			step.skip("el cliente no tiene servicios donde colgar el flujo")
			step.note("%s: flujo de %d pasos sin servicio; crear un servicio y asignarlo en Administración → Escalamiento", s.Name, len(s.EscalationFlow))
			continue
		}
		flow := append([]legacyFlowStep(nil), s.EscalationFlow...)
		sortFlow(flow)
		// Cada llamado es un grupo propio de su paso (kind 'step', 000030):
		// primero se arman sus personas (y el pool con nombre, que sí se
		// comparte), después cada servicio recibe sus llamados.
		type built struct {
			title    string
			mode     string
			contacts []uuid.UUID
			pool     *uuid.UUID
		}
		var calls []built
		for i, fs := range flow {
			title := strings.TrimSpace(fs.Title)
			if title == "" {
				title = "Paso " + itoa(i+1)
			}
			people := []struct{ name, tel string }{}
			if fs.ContactName != "" || fs.ContactTel != "" {
				people = append(people, struct{ name, tel string }{fs.ContactName, fs.ContactTel})
			}
			for _, c := range fs.Contacts {
				people = append(people, struct{ name, tel string }{c.Name, c.Tel})
			}
			mode := strings.ToLower(strings.TrimSpace(fs.Type))
			if mode != "pool" && mode != "sequential" {
				mode = "unique"
			}
			b := built{title: title, mode: mode}
			seen := map[uuid.UUID]bool{}
			for _, p := range people {
				contact, isNew, err := m.flowContact(ctx, org, p.name, p.tel)
				if err != nil {
					return err
				}
				if contact == uuid.Nil || seen[contact] {
					continue
				}
				if isNew {
					created++
				}
				seen[contact] = true
				b.contacts = append(b.contacts, contact)
			}
			// Un paso pool del legacy ("POOL de Mundo") pasa a un pool con
			// nombre: el llamado lo tiene como un solo integrante y sus
			// personas se llaman en orden (decisión del dueño 2026-10-05).
			if mode == "pool" && len(b.contacts) > 0 {
				pool := ID("escalation_pools", s.ID+":"+itoa(i))
				if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_pools (id, organization_id, name) VALUES ($1,$2,$3)`, pool, org, title); err != nil {
					return err
				}
				for pos, c := range b.contacts {
					if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_pool_members (pool_id, contact_id, position) VALUES ($1,$2,$3)`, pool, c, pos); err != nil {
						return err
					}
				}
				b.pool = &pool
				step.note("%s: pool «%s» con %d personas", s.Name, title, len(b.contacts))
			}
			calls = append(calls, b)
		}
		for _, svc := range services {
			policy := ID("escalation_policies", svc.String())
			var exists bool
			if err := m.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM escalation_policies WHERE id = $1)`, policy).Scan(&exists); err != nil {
				return err
			}
			next := 1
			if exists {
				next = 2 // el paso 1 es el aviso por correo a PARA/CC
			} else if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_policies (id, service_id, active) VALUES ($1,$2,true)`, policy, svc); err != nil {
				return err
			}
			for i, b := range calls {
				team := ID("teams", "flow:"+s.ID+":"+itoa(i)+":"+svc.String())
				if err := m.createTeam(ctx, team, nil, s.Name+" · "+b.title, "step", "client"); err != nil {
					return err
				}
				if b.pool != nil {
					if _, err := m.tx.Exec(ctx, `INSERT INTO team_members (id, team_id, pool_id, recipient_type, role_in_team, priority, active) VALUES ($1,$2,$3,'to','primary',0,true)`,
						uuid.New(), team, *b.pool); err != nil {
						return err
					}
				} else {
					for pos, c := range b.contacts {
						c := c
						if _, err := m.addMember(ctx, team, &c, nil, "to", "primary", pos); err != nil {
							return err
						}
					}
				}
				if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_steps (id, policy_id, step_order, team_id, mode, wait_before_escalate_minutes, title) VALUES ($1,$2,$3,$4,$5,0,$6)`,
					uuid.New(), policy, next+i, team, b.mode, b.title); err != nil {
					return err
				}
			}
			if legend := strings.TrimSpace(s.EscalationLegend); legend != "" {
				if _, err := m.tx.Exec(ctx, `UPDATE escalation_policies SET reminder = $2 WHERE id = $1`, policy, legend); err != nil {
					return err
				}
			}
		}
		step.note("%s: %d pasos de llamada en %d servicios", s.Name, len(flow), len(services))
		step.Loaded++
	}
	if created > 0 {
		step.note("%d personas del flujo no estaban en el directorio y se crearon como contactos", created)
	}
	return nil
}

func sortFlow(flow []legacyFlowStep) {
	for i := 1; i < len(flow); i++ {
		for j := i; j > 0 && flow[j].Order < flow[j-1].Order; j-- {
			flow[j], flow[j-1] = flow[j-1], flow[j]
		}
	}
}

// legacyClientRule es un clientEscalationRules del legacy: mantención
// programada (scheduled_maintenance) o aviso por cliente (special_alert).
type legacyClientRule struct {
	ID               string  `json:"_id"`
	ClientID         *string `json:"clientId"`
	Name             string  `json:"name"`
	RuleType         string  `json:"ruleType"`
	Enabled          bool    `json:"enabled"`
	Blocking         bool    `json:"blocking"`
	Priority         int     `json:"priority"`
	MaintenanceTitle string  `json:"maintenanceTitle"`
	AlertMessage     string  `json:"alertMessage"`
	ValidFrom        *string `json:"validFrom"`
	ValidTo          *string `json:"validTo"`
	// Avisos por cliente.
	Contexts                []string          `json:"contexts"`
	Timezone                string            `json:"timezone"`
	HolidayDates            []string          `json:"holidayDates"`
	TimeWindows             []json.RawMessage `json:"timeWindows"`
	Channels                []string          `json:"channels"`
	AcknowledgementRequired *bool             `json:"acknowledgementRequired"`
}

// migrateClientRules pasa las mantenciones programadas (con fecha de
// inicio y fin) a ventanas de mantenimiento en cada servicio del cliente, y
// los avisos por cliente (special_alert) a client_alert_rules.
func (m *Migrator) migrateClientRules(ctx context.Context) error {
	var rows []legacyClientRule
	if err := m.ex.Decode("clientEscalationRules", &rows); err != nil {
		return err
	}
	step := newStep("reglas de alerta del cliente", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	windows := 0
	for _, r := range rows {
		name := strings.TrimSpace(r.Name)
		if name == "" {
			name = "(sin nombre)"
		}
		from, okFrom := ParseTime(deref(r.ValidFrom))
		to, okTo := ParseTime(deref(r.ValidTo))
		if r.RuleType != "scheduled_maintenance" {
			org, ok := uuid.UUID{}, false
			if r.ClientID != nil {
				org, ok = m.clientOrgs[*r.ClientID]
			}
			if !ok || strings.TrimSpace(r.AlertMessage) == "" {
				step.skip("aviso sin cliente o sin mensaje")
				continue
			}
			if err := m.insertClientAlert(ctx, org, strings.TrimSpace(r.Name), r, from, okFrom, to, okTo); err != nil {
				return err
			}
			step.note("aviso por cliente: %s", name)
			step.Loaded++
			continue
		}
		// Con horario (p. ej. «entre 02:00 y 04:00 los domingos») es una
		// ventana que se repite (9.7, decisión del dueño 2026-10-15).
		if rules, bad := legacyWindowRules(r.TimeWindows); len(rules) > 0 || bad != "" {
			if bad != "" {
				step.skip("mantención con un horario que la 2.0 no repite (" + bad + "); recrearla a mano")
				step.note("horario %s, no migrada: %s", bad, name)
				continue
			}
			org, ok := uuid.UUID{}, false
			if r.ClientID != nil {
				org, ok = m.clientOrgs[*r.ClientID]
			}
			if !ok {
				step.skip("mantención sin cliente (la 2.0 exige servicio, activo o zona)")
				step.note("sin cliente, no migrada: %s", name)
				continue
			}
			if err := m.insertWindowSeries(ctx, org, r, rules, from, okFrom, to, okTo); err != nil {
				return err
			}
			step.note("se repite: %s", name)
			step.Loaded++
			continue
		}
		if !okFrom || !okTo || !to.After(from) {
			step.skip("regla sin fechas ni horario: recrearla como ventana si hace falta")
			step.note("sin fechas, no migrada: %s", name)
			continue
		}
		org, ok := uuid.UUID{}, false
		if r.ClientID != nil {
			org, ok = m.clientOrgs[*r.ClientID]
		}
		if !ok {
			step.skip("mantención sin cliente (la 2.0 exige servicio, activo o zona)")
			step.note("sin cliente, no migrada: %s", name)
			continue
		}
		services, err := m.servicesOf(ctx, org)
		if err != nil {
			return err
		}
		if len(services) == 0 {
			step.skip("el cliente de la mantención no tiene servicios")
			continue
		}
		title := strings.TrimSpace(r.MaintenanceTitle)
		if title == "" {
			title = name
		}
		priority := r.Priority
		if priority <= 0 {
			priority = 100
		}
		for _, svc := range services {
			if _, err := m.tx.Exec(ctx, `INSERT INTO maintenance_windows (service_id, title, notes, starts_at, ends_at, suppress_notifications, priority, created_by, active)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, svc, truncate(title, 200), nz(r.AlertMessage), from, to, r.Blocking, priority, m.firstAdmin, r.Enabled); err != nil {
				return err
			}
			windows++
		}
		step.Loaded++
	}
	if windows > 0 {
		step.note("%d ventanas de mantenimiento (una por servicio del cliente)", windows)
	}
	return nil
}

// legacyTimeWindow es un timeWindows del legacy (ClientEscalationRule).
type legacyTimeWindow struct {
	Mode        string `json:"mode"`
	StartTime   string `json:"startTime"`
	EndTime     string `json:"endTime"`
	DaysOfWeek  []int  `json:"daysOfWeek"`
	HolidayOnly bool   `json:"holidayOnly"`
}

// legacyWindowRules traduce los horarios de una mantención del legacy a
// reglas semanales de la 2.0. «always» sin días es la ventana continua de
// siempre (sin reglas). «between_hours» y «always» con días se repiten; el
// resto de los modos (fuera de horario, solo feriados…) devuelve bad.
func legacyWindowRules(raw []json.RawMessage) (rules []agenda.WindowRule, bad string) {
	for _, item := range raw {
		var w legacyTimeWindow
		if json.Unmarshal(item, &w) != nil {
			continue
		}
		if w.Mode == "" {
			w.Mode = "always"
		}
		days := w.DaysOfWeek
		if len(days) == 0 {
			days = []int{0, 1, 2, 3, 4, 5, 6}
		}
		var rule agenda.WindowRule
		switch {
		case w.HolidayOnly:
			return nil, "solo feriados"
		case w.Mode == "always" && len(w.DaysOfWeek) == 0:
			continue
		case w.Mode == "always":
			rule = agenda.WindowRule{Kind: agenda.WindowWeekly, Weekdays: days, Start: "00:00", End: "23:59"}
		case w.Mode == "between_hours":
			rule = agenda.WindowRule{Kind: agenda.WindowWeekly, Weekdays: days, Start: w.StartTime, End: w.EndTime}
		default:
			return nil, w.Mode
		}
		if rule.Validate() != nil {
			return nil, w.Mode + " " + w.StartTime + "-" + w.EndTime
		}
		rules = append(rules, rule)
	}
	return rules, ""
}

// insertWindowSeries crea una serie por horario, sobre el cliente, con la
// vigencia de la regla. Las ventanas las genera el servidor al arrancar.
func (m *Migrator) insertWindowSeries(ctx context.Context, org uuid.UUID, r legacyClientRule, rules []agenda.WindowRule, from time.Time, okFrom bool, to time.Time, okTo bool) error {
	tz := strings.TrimSpace(r.Timezone)
	if tz == "" {
		tz = "America/Santiago"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc, tz = time.UTC, "UTC"
	}
	validFrom := agenda.Day(time.Now(), loc)
	if okFrom {
		validFrom = agenda.Day(from, loc)
	}
	var validTo *time.Time
	if okTo {
		d := agenda.Day(to, loc)
		if d.Before(validFrom) {
			d = validFrom
		}
		validTo = &d
	}
	title := strings.TrimSpace(r.MaintenanceTitle)
	if title == "" {
		title = strings.TrimSpace(r.Name)
	}
	if title == "" {
		title = "Mantención programada"
	}
	priority := r.Priority
	if priority <= 0 {
		priority = 100
	}
	for _, rule := range rules {
		raw, _ := json.Marshal(rule)
		if _, err := m.tx.Exec(ctx, `INSERT INTO maintenance_window_series (organization_id, title, notes, suppress_notifications, priority, rule,
			valid_from, valid_to, timezone, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			org, truncate(title, 200), nz(r.AlertMessage), r.Blocking, priority, raw, validFrom, validTo, tz, r.Enabled, m.firstAdmin); err != nil {
			return err
		}
	}
	return nil
}
