package legacyetl

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

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
		// Un equipo por paso, compartido por los servicios del cliente.
		type built struct {
			team uuid.UUID
			mode string
		}
		var teams []built
		for i, fs := range flow {
			title := strings.TrimSpace(fs.Title)
			if title == "" {
				title = "Paso " + itoa(i+1)
			}
			team := ID("teams", "flow:"+s.ID+":"+itoa(i))
			o := org
			if err := m.createTeam(ctx, team, &o, s.Name+" · "+title, "escalation", "client"); err != nil {
				return err
			}
			people := []struct{ name, tel string }{}
			if fs.ContactName != "" || fs.ContactTel != "" {
				people = append(people, struct{ name, tel string }{fs.ContactName, fs.ContactTel})
			}
			for _, c := range fs.Contacts {
				people = append(people, struct{ name, tel string }{c.Name, c.Tel})
			}
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
				c := contact
				if _, err := m.addMember(ctx, team, &c, nil, "to", "primary", len(seen)-1); err != nil {
					return err
				}
			}
			mode := strings.ToLower(strings.TrimSpace(fs.Type))
			if mode != "pool" && mode != "sequential" {
				mode = "unique"
			}
			teams = append(teams, built{team, mode})
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
			for i, t := range teams {
				if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_steps (id, policy_id, step_order, team_id, mode, wait_before_escalate_minutes) VALUES ($1,$2,$3,$4,$5,0)`,
					uuid.New(), policy, next+i, t.team, t.mode); err != nil {
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

// migrateClientRules pasa las mantenciones programadas (con fecha de
// inicio y fin) a ventanas de mantenimiento en cada servicio del cliente;
// las alertas recurrentes se listan (la 2.0 aún no tiene recurrencia).
func (m *Migrator) migrateClientRules(ctx context.Context) error {
	var rows []struct {
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
	}
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
		if r.RuleType != "scheduled_maintenance" || !okFrom || !okTo || !to.After(from) {
			step.skip("regla recurrente: la 2.0 aún no tiene recurrencia (post-corte); recrearla como ventana si hace falta")
			step.note("recurrente, no migrada: %s", name)
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
