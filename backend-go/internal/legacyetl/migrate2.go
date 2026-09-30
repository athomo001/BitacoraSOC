package legacyetl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/complements"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
)

// Iteración 2 (spec/13 §3): escalación, RACI, guardias y dotación,
// complementos publicados y reglas de alerta del cliente.

func (m *Migrator) teamSlug(name string) string {
	base := strings.Trim(nonCode.ReplaceAllString(normName(name), "-"), "-")
	if base == "" {
		base = "equipo"
	}
	slug := base
	for i := 2; m.teamSlugs[slug]; i++ {
		slug = base + "-" + itoa(i)
	}
	m.teamSlugs[slug] = true
	return slug
}

func itoa(i int) string {
	const digits = "0123456789"
	if i < 10 {
		return digits[i : i+1]
	}
	return itoa(i/10) + digits[i%10:i%10+1]
}

func (m *Migrator) createTeam(ctx context.Context, id uuid.UUID, org *uuid.UUID, name, kind, audience string) error {
	_, err := m.tx.Exec(ctx, `INSERT INTO teams (id, organization_id, name, slug, kind, audience, active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
		id, org, name, m.teamSlug(name), kind, audience)
	return err
}

func (m *Migrator) addMember(ctx context.Context, team uuid.UUID, contact, user *uuid.UUID, recipient, role string, priority int) (uuid.UUID, error) {
	id := uuid.New()
	_, err := m.tx.Exec(ctx, `INSERT INTO team_members (id, team_id, user_id, contact_id, recipient_type, role_in_team, priority, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
		id, team, user, contact, recipient, role, priority)
	return id, err
}

// ===== escalación por servicio =====

func (m *Migrator) migrateEscalation(ctx context.Context) error {
	var contacts []legacyContact
	var services []legacyService
	if err := m.ex.Decode("contacts", &contacts); err != nil {
		return err
	}
	_ = m.ex.Decode("services", &services)
	serviceName := map[uuid.UUID]string{}
	for _, s := range services {
		if id, ok := m.services[s.ID]; ok && serviceName[id] == "" {
			serviceName[id] = strings.TrimSpace(s.Name)
		}
	}
	step := newStep("escalación por servicio", len(contacts))
	m.rep.Steps = append(m.rep.Steps, step)

	type member struct {
		contact   uuid.UUID
		recipient string
	}
	escalation := map[uuid.UUID][]member{}
	preventive := map[uuid.UUID][]member{}
	// Avisos preventivos sin servicio: el legacy los mandaba por empresa.
	preventiveByOrg := map[uuid.UUID][]member{}
	for _, c := range contacts {
		contact, ok := m.escalationContacts[c.ID]
		if !ok {
			step.skip("el contacto no se migró")
			continue
		}
		isPreventive := strings.EqualFold(c.ContactType, "preventive") || strings.EqualFold(c.Role, "PREVENTIVO")
		if c.ServiceID == nil {
			if !isPreventive {
				step.skip("sin servicio (queda solo en el directorio)")
				continue
			}
			var org uuid.UUID
			if err := m.tx.QueryRow(ctx, `SELECT organization_id FROM contacts WHERE id = $1`, contact).Scan(&org); err != nil {
				return err
			}
			preventiveByOrg[org] = append(preventiveByOrg[org], member{contact, "to"})
			step.Loaded++
			continue
		}
		svc, ok := m.services[*c.ServiceID]
		if !ok {
			step.skip("su servicio no se migró")
			continue
		}
		recipient := "to"
		if strings.EqualFold(c.Role, "CC") {
			recipient = "cc"
		}
		if isPreventive {
			preventive[svc] = append(preventive[svc], member{contact, "to"})
		} else {
			escalation[svc] = append(escalation[svc], member{contact, recipient})
		}
		step.Loaded++
	}

	orgOf := func(svc uuid.UUID) *uuid.UUID {
		var org uuid.UUID
		if err := m.tx.QueryRow(ctx, `SELECT organization_id FROM services WHERE id = $1`, svc).Scan(&org); err != nil {
			return nil
		}
		return &org
	}
	orgName := func(org *uuid.UUID) string {
		if org == nil {
			return ""
		}
		var n string
		_ = m.tx.QueryRow(ctx, `SELECT name FROM organizations WHERE id = $1`, *org).Scan(&n)
		return n
	}
	svcs := make([]uuid.UUID, 0, len(escalation))
	for s := range escalation {
		svcs = append(svcs, s)
	}
	sort.Slice(svcs, func(i, j int) bool { return svcs[i].String() < svcs[j].String() })
	teams, policies := 0, 0
	for _, svc := range svcs {
		org := orgOf(svc)
		team := ID("teams", "escalation:"+svc.String())
		if err := m.createTeam(ctx, team, org, serviceName[svc]+" · "+orgName(org), "escalation", "client"); err != nil {
			return err
		}
		seen := map[uuid.UUID]bool{}
		for i, mb := range escalation[svc] {
			if seen[mb.contact] {
				continue
			}
			seen[mb.contact] = true
			c := mb.contact
			if _, err := m.addMember(ctx, team, &c, nil, mb.recipient, "primary", i); err != nil {
				return err
			}
		}
		policy := ID("escalation_policies", svc.String())
		if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_policies (id, service_id, active) VALUES ($1,$2,true)`, policy, svc); err != nil {
			return err
		}
		// El legacy avisaba a todos los PARA con los CC en copia: modo pool.
		if _, err := m.tx.Exec(ctx, `INSERT INTO escalation_steps (id, policy_id, step_order, team_id, mode, wait_before_escalate_minutes) VALUES ($1,$2,1,$3,'pool',0)`,
			uuid.New(), policy, team); err != nil {
			return err
		}
		teams++
		policies++
	}
	for svc, list := range preventive {
		org := orgOf(svc)
		team := ID("teams", "preventive:"+svc.String())
		if err := m.createTeam(ctx, team, org, serviceName[svc]+" · "+orgName(org)+" · preventivo", "escalation", "client"); err != nil {
			return err
		}
		seen := map[uuid.UUID]bool{}
		for i, mb := range list {
			if seen[mb.contact] {
				continue
			}
			seen[mb.contact] = true
			c := mb.contact
			if _, err := m.addMember(ctx, team, &c, nil, "to", "primary", i); err != nil {
				return err
			}
		}
		teams++
	}
	for org, list := range preventiveByOrg {
		o := org
		team := ID("teams", "preventive-org:"+org.String())
		if err := m.createTeam(ctx, team, &o, orgName(&o)+" · avisos preventivos", "escalation", "client"); err != nil {
			return err
		}
		seen := map[uuid.UUID]bool{}
		for i, mb := range list {
			if seen[mb.contact] {
				continue
			}
			seen[mb.contact] = true
			c := mb.contact
			if _, err := m.addMember(ctx, team, &c, nil, "to", "primary", i); err != nil {
				return err
			}
		}
		teams++
	}
	step.note("%d equipos y %d políticas de escalación (un paso, avisa a todos los PARA con los CC en copia)", teams, policies)
	if n := len(preventive) + len(preventiveByOrg); n > 0 {
		step.note("%d de esos equipos son de avisos preventivos (sin política: se usan desde Equipos)", n)
	}

	return nil
}

// ===== RACI =====

func (m *Migrator) migrateRaci(ctx context.Context) error {
	type person struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Phone string `json:"phone"`
	}
	var rows []struct {
		ID          string `json:"_id"`
		ClientID    string `json:"clientId"`
		Topic       string `json:"topic"`
		Activity    string `json:"activity"`
		Active      bool   `json:"active"`
		Responsible person `json:"responsible"`
		Accountable person `json:"accountable"`
		Consulted   person `json:"consulted"`
		Informed    person `json:"informed"`
	}
	if err := m.ex.Decode("raciEntries", &rows); err != nil {
		return err
	}
	step := newStep("RACI", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	teamByPerson := map[string]uuid.UUID{}
	assignments := 0
	for _, r := range rows {
		org, ok := m.clientOrgs[r.ClientID]
		if !ok {
			step.skip("su cliente no viene en la exportación")
			continue
		}
		topic := strings.TrimSpace(r.Topic)
		if a := strings.TrimSpace(r.Activity); a != "" {
			topic += " — " + a
		}
		if topic == "" {
			step.skip("sin tema")
			continue
		}
		for _, role := range []struct {
			name string
			p    person
		}{{"responsible", r.Responsible}, {"accountable", r.Accountable}, {"consulted", r.Consulted}, {"informed", r.Informed}} {
			name := directory.Sanitize(role.p.Name, 120)
			email := directory.NormalizeEmail(role.p.Email)
			if name == "" && email == "" {
				continue
			}
			key := org.String() + "|" + email + "|" + normName(name)
			team, ok := teamByPerson[key]
			if !ok {
				contact, known := m.contactMail[org.String()+"|"+email]
				if !known || email == "" {
					if name == "" {
						name = email
					}
					contact = ID("raciPeople", key)
					if err := m.insertContact(ctx, &Step{Skipped: map[string]int{}}, contact, org, name, "", "external", "manual", false,
						"Persona del RACI (legacy).", now, now, role.p.Email, role.p.Phone); err != nil {
						return err
					}
				}
				team = ID("teams", "raci:"+key)
				if err := m.createTeam(ctx, team, &org, name+" (RACI)", "raci", "client"); err != nil {
					return err
				}
				if _, err := m.addMember(ctx, team, &contact, nil, "to", "primary", 0); err != nil {
					return err
				}
				teamByPerson[key] = team
			}
			if _, err := m.tx.Exec(ctx, `INSERT INTO raci_assignments (id, client_id, topic, role, team_id, active) VALUES ($1,$2,$3,$4,$5,$6)`,
				uuid.New(), org, topic, role.name, team, r.Active); err != nil {
				return err
			}
			assignments++
		}
		step.Loaded++
	}
	step.note("%d asignaciones R/A/C/I con %d personas", assignments, len(teamByPerson))
	return nil
}

// ===== guardias y dotación =====

// dotaciónCodes: códigos del legacy que son una condición del día (matriz
// de dotación); el resto de los códigos son roles de guardia.
var dotacionCodes = map[string]string{
	"TELEWORK": "telework", "OFFICE": "office", "VACATION": "vacation", "MEDICAL_LEAVE": "medical_leave",
	"MEDICAL_APPOINTMENT": "medical_appointment", "TRAINING": "training",
}

func (m *Migrator) migrateShiftAssignments(ctx context.Context) error {
	var rows []struct {
		UserID           string `json:"userId"`
		ExternalPersonID string `json:"externalPersonId"`
		RoleCode         string `json:"roleCode"`
		WeekStartDate    string `json:"weekStartDate"`
		WeekEndDate      string `json:"weekEndDate"`
		IsPaused         bool   `json:"isPaused"`
	}
	if err := m.ex.Decode("shiftAssignments", &rows); err != nil {
		return err
	}
	step := newStep("guardias y dotación", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)

	type guard struct {
		cycle   uuid.UUID
		members map[string]uuid.UUID
	}
	guards := map[string]*guard{}
	days, slots := 0, 0
	for _, a := range rows {
		start, ok1 := ParseTime(a.WeekStartDate)
		end, ok2 := ParseTime(a.WeekEndDate)
		if !ok1 || !ok2 || end.Before(start) {
			step.skip("sin fechas válidas")
			continue
		}
		code := strings.ToUpper(strings.TrimSpace(a.RoleCode))
		user, isUser := m.users[a.UserID]
		externalContact := ID("externalPersons", a.ExternalPersonID)
		isExternal := a.ExternalPersonID != "" && m.contactExists(ctx, externalContact)

		if cond, ok := dotacionCodes[code]; ok {
			if !isUser {
				step.skip("dotación de un usuario que no viene en la exportación")
				continue
			}
			for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
				tag, err := m.tx.Exec(ctx, `INSERT INTO work_shift_assignments (user_id, assigned_date, condition, notes) VALUES ($1,$2,$3,'Legacy')
					ON CONFLICT (user_id, assigned_date) DO NOTHING`, user, d.Format("2006-01-02"), cond)
				if err != nil {
					return err
				}
				days += int(tag.RowsAffected())
			}
			step.Loaded++
			continue
		}
		if !isUser && !isExternal {
			step.skip("guardia de alguien que no viene en la exportación")
			continue
		}
		g, ok := guards[code]
		if !ok {
			team := ID("teams", "oncall:"+code)
			if err := m.createTeam(ctx, team, nil, "Guardia "+code, "oncall", "internal"); err != nil {
				return err
			}
			cycle := ID("rotation_cycles", code)
			// Semana de lunes a lunes; la hora de cambio no viene en el legacy.
			if _, err := m.tx.Exec(ctx, `INSERT INTO rotation_cycles (id, team_id, start_day_of_week, start_time_utc, duration_days, timezone, active)
				VALUES ($1,$2,1,'12:00',7,'America/Santiago',true)`, cycle, team); err != nil {
				return err
			}
			g = &guard{cycle: cycle, members: map[string]uuid.UUID{}}
			guards[code] = g
			step.note("equipo \"Guardia %s\" con ciclo semanal (cambio lunes 09:00 Santiago: revisar)", code)
		}
		memberKey := a.UserID + "|" + a.ExternalPersonID
		member, ok := g.members[memberKey]
		if !ok {
			var err error
			team := ID("teams", "oncall:"+code)
			if isUser {
				member, err = m.addMember(ctx, team, nil, &user, "to", "primary", len(g.members))
			} else {
				member, err = m.addMember(ctx, team, &externalContact, nil, "to", "primary", len(g.members))
			}
			if err != nil {
				return err
			}
			g.members[memberKey] = member
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO rotation_slots (cycle_id, team_member_id, week_start_date, week_end_date, is_paused) VALUES ($1,$2,$3,$4,$5)`,
			g.cycle, member, start.Format("2006-01-02"), end.Format("2006-01-02"), a.IsPaused); err != nil {
			return err
		}
		slots++
		step.Loaded++
	}
	if days > 0 || slots > 0 {
		step.note("%d días de dotación y %d semanas de guardia", days, slots)
	}
	return nil
}

func (m *Migrator) contactExists(ctx context.Context, id uuid.UUID) bool {
	var ok bool
	_ = m.tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM contacts WHERE id = $1)`, id).Scan(&ok)
	return ok
}

// ===== complementos =====

func (m *Migrator) migrateComplements(ctx context.Context) error {
	var rows []struct {
		Slug            string `json:"slug"`
		Name            string `json:"name"`
		Status          string `json:"status"`
		IframePath      string `json:"iframePath"`
		BaseURL         string `json:"baseUrl"`
		InternalBaseURL string `json:"internalBaseUrl"`
		HealthPath      string `json:"healthPath"`
		Permissions     struct {
			Scopes             []string `json:"scopes"`
			AllowedCollections []string `json:"allowedCollections"`
		} `json:"permissions"`
		Visibility struct {
			Roles []string `json:"roles"`
		} `json:"visibility"`
		RuntimePolicy struct {
			CSP struct {
				ExtraConnectSrc []string `json:"extraConnectSrc"`
			} `json:"csp"`
		} `json:"runtimePolicy"`
		SourceArtifact struct {
			SourceType            string `json:"sourceType"`
			PublishedRelativePath string `json:"publishedRelativePath"`
		} `json:"sourceArtifact"`
	}
	if err := m.ex.Decode("complements", &rows); err != nil {
		return err
	}
	step := newStep("complementos", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	for _, c := range rows {
		if !complements.ValidSlug(c.Slug) {
			step.skip("identificador inválido")
			continue
		}
		status := c.Status
		if status != "maintenance" && status != "disabled" {
			status = "active"
		}
		roles := []string{}
		for _, r := range c.Visibility.Roles {
			switch r {
			case "admin", "user", "auditor", "guest":
				roles = append(roles, r)
			}
		}
		hosts := []string{}
		for _, h := range c.RuntimePolicy.CSP.ExtraConnectSrc {
			if o, ok := complements.NormalizeHost(h); ok {
				hosts = append(hosts, o)
			}
		}
		name := strings.TrimSpace(c.Name)
		if name == "" {
			name = c.Slug
		}
		id := ID("complements", c.Slug)
		if c.SourceArtifact.SourceType != "zip-static" {
			// Servicio: se registra sin token (el admin lo regenera desde su ficha).
			if !strings.HasPrefix(c.BaseURL, "http") {
				step.skip("servicio sin dirección válida")
				continue
			}
			scopes, _ := cleanScopes(c.Permissions.Scopes)
			if _, err := m.tx.Exec(ctx, `INSERT INTO complements (id, slug, name, source_type, status, entry_path, base_url, internal_base_url, health_path,
				scopes, allowed_collections, connect_hosts, visible_roles, created_by) VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8,$9,$10,'{}',$11,$12)`,
				id, c.Slug, truncate(name, 80), status, "/"+strings.TrimPrefix(c.IframePath, "/"), strings.TrimRight(c.BaseURL, "/"),
				nz(strings.TrimRight(c.InternalBaseURL, "/")), nz(c.HealthPath), scopes, collectionsOf(c.Permissions.AllowedCollections), roles, m.firstAdmin); err != nil {
				return err
			}
			step.note("%s: servicio registrado sin token (regenerarlo desde su ficha y ponerlo en el servicio)", c.Slug)
			step.Loaded++
			continue
		}
		prefix := strings.Trim(strings.TrimPrefix(c.SourceArtifact.PublishedRelativePath, "uploads/"), "/") + "/"
		var files []complements.File
		var total int64
		for rel, f := range m.uploads {
			if !strings.HasPrefix(rel, prefix) {
				continue
			}
			p := path.Clean(strings.TrimPrefix(rel, prefix))
			rc, err := f.Open()
			if err != nil {
				return err
			}
			content, err := io.ReadAll(io.LimitReader(rc, complements.MaxFileBytes+1))
			_ = rc.Close()
			if err != nil || len(content) > complements.MaxFileBytes {
				step.skip("archivo ilegible o demasiado grande")
				continue
			}
			sum := sha256.Sum256(content)
			files = append(files, complements.File{Path: p, ContentType: complements.ContentType(p), SHA256: hex.EncodeToString(sum[:]), Content: content})
			total += int64(len(content))
		}
		entry := strings.TrimPrefix(c.IframePath, "/")
		if entry == "" {
			entry = "index.html"
		}
		if len(files) == 0 {
			step.skip("sus archivos no vienen en el respaldo (volver a subir el ZIP)")
			continue
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO complements (id, slug, name, source_type, status, entry_path, scopes, allowed_collections, connect_hosts,
			visible_roles, created_by, artifact_bytes, artifact_files, published_at) VALUES ($1,$2,$3,'zip_static',$4,$5,'{}','{}',$6,$7,$8,$9,$10,now())`,
			id, c.Slug, truncate(name, 80), status, entry, hosts, roles, m.firstAdmin, total, len(files)); err != nil {
			return err
		}
		for _, f := range files {
			if _, err := m.tx.Exec(ctx, `INSERT INTO complement_files (complement_id, path, content_type, sha256, content) VALUES ($1,$2,$3,$4,$5)`,
				id, f.Path, f.ContentType, f.SHA256, f.Content); err != nil {
				return err
			}
		}
		step.note("%s: publicado con %d archivos del respaldo", c.Slug, len(files))
		step.Loaded++
	}
	return nil
}

var runtimeScopes = map[string]bool{"READ_CONTEXT": true, "READ_LOGS": true, "WRITE_ENTRIES": true, "READ_STORAGE": true, "WRITE_STORAGE": true, "WRITE_LOGS": true}

func cleanScopes(in []string) ([]string, bool) {
	out := []string{}
	for _, s := range in {
		if runtimeScopes[s] {
			out = append(out, s)
		}
	}
	return out, len(out) == len(in)
}

func collectionsOf(in []string) []string {
	out := []string{}
	for _, c := range in {
		switch c {
		case "entries", "shared_storage":
			out = append(out, c)
		case "auditlogs", "audit_log":
			out = append(out, "audit_log")
		}
	}
	return out
}
