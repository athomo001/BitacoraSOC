package legacyetl

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/handler"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/reminders"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// NotMigrated son las colecciones que no se migran por diseño (spec/13 §3).
var NotMigrated = []string{
	"tokenDenylist", "avisoLogs", "apiLogs", "customFonts", "glpiConfigs", "logForwardingConfigs",
	"complementSharedRecords", "catalogEvents",
}

// Options del ensayo.
type Options struct {
	// DryRun hace toda la carga y al final la deshace: sirve para ver el
	// reporte sin dejar datos.
	DryRun bool
}

// Migrator carga una exportación en una base 2.0 vacía, dentro de una sola
// transacción. Los mapas relacionan ObjectId del legacy con UUID de la 2.0.
type Migrator struct {
	tx     pgx.Tx
	q      *db.Queries
	ex     *Export
	legacy LegacyKeys
	box    *crypto.Box
	rep    *Report

	users       map[string]uuid.UUID
	firstAdmin  uuid.UUID
	orgs        map[string]uuid.UUID // nombre normalizado → organización
	orgCodes    map[string]bool
	clientOrgs  map[string]uuid.UUID // clientId del legacy → organización
	services    map[string]uuid.UUID
	shifts      map[string]uuid.UUID
	contactMail map[string]uuid.UUID // organización|correo normalizado → contacto
	// escalationContacts: contacto de escalación del legacy → contacto 2.0
	// (propio o el del directorio con el que se unió), para la iteración 2.
	escalationContacts map[string]uuid.UUID
	teamSlugs          map[string]bool
	contactPhone       map[string]uuid.UUID // organización|teléfono normalizado → contacto
	// uploads son los archivos del ZIP del respaldo (complementos publicados).
	uploads map[string]*zip.File
}

// Run hace el ensayo completo. El destino tiene que estar migrado y vacío.
func Run(ctx context.Context, pool *pgxpool.Pool, backup *Backup, legacy LegacyKeys, box *crypto.Box, opts Options) (*Report, error) {
	ex := backup.Export
	rep := &Report{ExportCreatedAt: ex.Metadata.CreatedAt, ExportVersion: ex.Metadata.Version, NotMigrated: NotMigrated}
	if err := checkTarget(ctx, pool); err != nil {
		return rep, err
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return rep, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	m := &Migrator{
		tx: tx, q: db.New(tx), ex: ex, legacy: legacy, box: box, rep: rep,
		users: map[string]uuid.UUID{}, orgs: map[string]uuid.UUID{}, orgCodes: map[string]bool{}, clientOrgs: map[string]uuid.UUID{},
		services: map[string]uuid.UUID{}, shifts: map[string]uuid.UUID{}, contactMail: map[string]uuid.UUID{}, escalationContacts: map[string]uuid.UUID{},
		teamSlugs: map[string]bool{}, uploads: backup.Uploads, contactPhone: map[string]uuid.UUID{},
	}
	steps := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"usuarios", m.migrateUsers},
		{"organizaciones", m.migrateOrganizations},
		{"servicios", m.migrateServices},
		{"contactos del directorio", m.migrateDirectoryContacts},
		{"contactos de escalación", m.migrateEscalationContacts},
		{"personal externo", m.migrateExternalPersons},
		{"turnos", m.migrateWorkShifts},
		{"plantillas de checklist", m.migrateChecklistTemplates},
		{"entradas", m.migrateEntries},
		{"notas", m.migrateNotes},
		{"correo (SMTP)", m.migrateSMTP},
		{"recordatorios de turno", m.migrateShiftReminders},
		{"avisos de dotación", m.migrateNotificationSchedules},
		{"escalación por servicio", m.migrateEscalation},
		{"flujos de llamadas", m.migrateCallFlows},
		{"RACI", m.migrateRaci},
		{"guardias y dotación", m.migrateShiftAssignments},
		{"complementos", m.migrateComplements},
		{"reglas de alerta del cliente", m.migrateClientRules},
		{"historial de reportes", m.migrateReportHistory},
		{"tipos de operación", m.migrateOperationTypes},
		{"configuración", m.migrateAppConfig},
		{"auditoría", m.migrateAudit},
		{"verificación", m.verify},
	}
	for _, s := range steps {
		if err := s.fn(ctx); err != nil {
			return rep, fmt.Errorf("paso %s: %w", s.name, err)
		}
	}
	if opts.DryRun {
		return rep, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return rep, err
	}
	rep.Committed = true
	return rep, nil
}

// checkTarget exige un destino con todas las migraciones y sin datos: cada
// ensayo parte de cero (scripts/etl-reset.sh).
func checkTarget(ctx context.Context, pool *pgxpool.Pool) error {
	var hasLatest bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.report_operation_types') IS NOT NULL`).Scan(&hasLatest); err != nil {
		return err
	}
	if !hasLatest {
		return errors.New("el destino no tiene todas las migraciones: corre scripts/etl-reset.sh")
	}
	var users, entries int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM entries)`).Scan(&users, &entries); err != nil {
		return err
	}
	if users > 0 || entries > 0 {
		return fmt.Errorf("el destino ya tiene datos (%d usuarios, %d entradas): el ETL carga sobre una base vacía (scripts/etl-reset.sh)", users, entries)
	}
	return nil
}

// ===== utilidades =====

func nz(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func timeOr(s string, fallback time.Time) time.Time {
	if t, ok := ParseTime(s); ok {
		return t
	}
	return fallback
}

var nonCode = regexp.MustCompile(`[^a-z0-9]+`)

// normName compara nombres sin tildes, mayúsculas ni espacios de más.
func normName(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, _ := transform.String(t, strings.ToLower(strings.TrimSpace(s)))
	return strings.Join(strings.Fields(out), " ")
}

func (m *Migrator) uniqueCode(name string) string {
	base := strings.Trim(nonCode.ReplaceAllString(normName(name), "_"), "_")
	if base == "" {
		base = "org"
	}
	code := base
	for i := 2; m.orgCodes[code]; i++ {
		code = fmt.Sprintf("%s_%d", base, i)
	}
	m.orgCodes[code] = true
	return code
}

// legacyIDSuffix: el legacy armaba el código del servicio como nombre_<ObjectId>.
var legacyIDSuffix = regexp.MustCompile(`_[0-9a-f]{24}$`)

// serviceCode deja un código legible: cliente_servicio, sin el id del legacy
// ("qradar_696993296a90fd3291f4b656" de JUNJI → "junji_qradar").
func serviceCode(orgName, legacyCode string, used map[string]bool) string {
	svc := legacyIDSuffix.ReplaceAllString(strings.ToLower(strings.TrimSpace(legacyCode)), "")
	base := strings.Trim(nonCode.ReplaceAllString(normName(orgName)+"_"+svc, "_"), "_")
	if base == "" {
		base = "servicio"
	}
	code := base
	for i := 2; used[code]; i++ {
		code = fmt.Sprintf("%s_%d", base, i)
	}
	used[code] = true
	return code
}

// orgFor devuelve (o crea) la organización con ese nombre.
func (m *Migrator) orgFor(ctx context.Context, name, orgType string, id uuid.UUID) (uuid.UUID, bool, error) {
	key := normName(name)
	if existing, ok := m.orgs[key]; ok {
		return existing, false, nil
	}
	if id == uuid.Nil {
		id = ID("organizations", key)
	}
	_, err := m.tx.Exec(ctx, `INSERT INTO organizations (id, name, code, type, active) VALUES ($1, $2, $3, $4, true)`,
		id, strings.TrimSpace(name), m.uniqueCode(name), orgType)
	if err != nil {
		return uuid.Nil, false, err
	}
	m.orgs[key] = id
	return id, true, nil
}

func (m *Migrator) decrypt(step *Step, field, v string) string {
	plain, err := m.legacy.Decrypt(v)
	if err != nil {
		step.skip(field + " no se pudo descifrar (se omite ese dato)")
		return ""
	}
	return plain
}

// ===== usuarios =====

type legacyUser struct {
	ID                 string  `json:"_id"`
	Username           string  `json:"username"`
	Email              string  `json:"email"`
	FullName           string  `json:"fullName"`
	Phone              *string `json:"phone"`
	Birthday           *string `json:"birthday"`
	Password           string  `json:"password"`
	Role               string  `json:"role"`
	CargoLabel         string  `json:"cargoLabel"`
	MFAEnabled         bool    `json:"mfaEnabled"`
	MFASecret          *string `json:"mfaSecret"`
	MustChangePassword bool    `json:"mustChangePassword"`
	FailedAttempts     int     `json:"failedAttempts"`
	LockedUntil        *string `json:"lockedUntil"`
	GuestExpiresAt     *string `json:"guestExpiresAt"`
	IsActive           bool    `json:"isActive"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (m *Migrator) migrateUsers(ctx context.Context) error {
	var rows []legacyUser
	if err := m.ex.Decode("users", &rows); err != nil {
		return err
	}
	step := newStep("usuarios", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	seenUser, seenMail := map[string]bool{}, map[string]bool{}
	now := time.Now()
	var members []groupMember
	for _, u := range rows {
		username := strings.TrimSpace(u.Username)
		email := strings.ToLower(strings.TrimSpace(u.Email))
		switch {
		case username == "" || email == "" || !strings.HasPrefix(u.Password, "$2"):
			step.skip("sin usuario, correo o contraseña bcrypt")
			continue
		case seenUser[strings.ToLower(username)] || seenMail[email]:
			step.skip("usuario o correo repetido")
			continue
		}
		seenUser[strings.ToLower(username)], seenMail[email] = true, true
		role := u.Role
		switch role {
		case "admin", "user", "auditor", "guest":
		default:
			step.note("rol desconocido %q → user", role)
			role = "user"
		}
		mfa, mfaSecret := u.MFAEnabled, (*string)(nil)
		if mfa {
			plain := m.decrypt(step, "secreto MFA", deref(u.MFASecret))
			if plain == "" {
				mfa = false
				step.note("un usuario tenía MFA y su secreto no se pudo migrar: deberá volver a configurarlo")
			} else if enc, err := m.box.Encrypt(plain); err == nil {
				mfaSecret = &enc
			}
		}
		var birthday *time.Time
		if t, ok := ParseTime(deref(u.Birthday)); ok {
			birthday = &t
		}
		var locked, guestExp *time.Time
		if t, ok := ParseTime(deref(u.LockedUntil)); ok {
			locked = &t
		}
		if t, ok := ParseTime(deref(u.GuestExpiresAt)); ok {
			guestExp = &t
		}
		id := ID("users", u.ID)
		_, err := m.tx.Exec(ctx, `INSERT INTO users (id, username, email, full_name, phone, birthday, password_hash, role, cargo_label,
			mfa_enabled, mfa_secret_encrypted, is_guest, guest_expires_at, must_change_password, failed_login_attempts, locked_until, active, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
			id, username, email, nz(u.FullName), nz(deref(u.Phone)), birthday, u.Password, role, nz(u.CargoLabel),
			mfa, mfaSecret, role == "guest", guestExp, u.MustChangePassword, u.FailedAttempts, locked, u.IsActive,
			timeOr(u.CreatedAt, now), timeOr(u.UpdatedAt, now))
		if err != nil {
			return err
		}
		m.users[u.ID] = id
		if role == "user" || role == "auditor" {
			members = append(members, groupMember{user: id, cargo: strings.TrimSpace(u.CargoLabel)})
		}
		if role == "admin" && u.IsActive && m.firstAdmin == uuid.Nil {
			m.firstAdmin = id
		}
		step.Loaded++
	}
	if m.firstAdmin == uuid.Nil {
		return errors.New("la exportación no tiene ningún administrador activo")
	}
	return m.permissionGroups(ctx, step, members)
}

type groupMember struct {
	user  uuid.UUID
	cargo string
}

// Cargos que en el legacy podían además eliminar contactos del directorio
// (FULL_DIRECTORY_CARGOS de routes/directory.js).
var fullDirectoryCargos = map[string]bool{"n2": true, "n3": true, "jefe area": true, "gerente area": true, "arquitecto siem": true}

// permissionGroups: en la 2.0 un analista solo ve SOC si un grupo de
// permisos lo incluye; sin esto los usuarios migrados no veían servicios ni
// escalamiento. Un grupo por cargo del legacy (SOC), con los permisos de
// directorio que daba ese cargo; quien no tenía cargo queda en "Sin cargo"
// (solo lectura).
func (m *Migrator) permissionGroups(ctx context.Context, step *Step, members []groupMember) error {
	type group struct {
		id    uuid.UUID
		label string
		caps  []string
	}
	groups := map[string]*group{}
	for _, mb := range members {
		key := normName(mb.cargo)
		if _, ok := groups[key]; !ok {
			g := &group{label: mb.cargo, caps: []string{}}
			switch {
			case key == "":
				g.label = "Sin cargo"
			case fullDirectoryCargos[key]:
				g.caps = []string{"directory:write", "directory:delete"}
			default:
				g.caps = []string{"directory:write"}
			}
			code := strings.Trim(nonCode.ReplaceAllString(key, "_"), "_")
			if code == "" {
				code = "sin_cargo"
			}
			g.id = ID("permissionGroups", code)
			if _, err := m.tx.Exec(ctx, `INSERT INTO permission_groups (id, code, name, module_scope, capabilities) VALUES ($1, $2, $3, 'soc', $4)`,
				g.id, code, g.label, g.caps); err != nil {
				return err
			}
			groups[key] = g
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2)`, mb.user, groups[key].id); err != nil {
			return err
		}
	}
	if len(groups) > 0 {
		step.note("%d grupos de permisos SOC según el cargo del legacy, con %d usuarios", len(groups), len(members))
	}
	return nil
}

// ===== organizaciones y servicios =====

type legacyNamed struct {
	ID     string `json:"_id"`
	Name   string `json:"name"`
	Code   string `json:"code"`
	Active *bool  `json:"active"`
}

type legacyService struct {
	ID       string `json:"_id"`
	ClientID string `json:"clientId"`
	Name     string `json:"name"`
	Code     string `json:"code"`
	Active   bool   `json:"active"`
}

type legacyContact struct {
	ID            string  `json:"_id"`
	Name          string  `json:"name"`
	Organization  string  `json:"organization"`
	Role          string  `json:"role"`
	ContactType   string  `json:"contactType"`
	Email         string  `json:"email"`
	Phone         string  `json:"phone"`
	Notes         string  `json:"notes"`
	ServiceID     *string `json:"serviceId"`
	Favorite      bool    `json:"favorite"`
	IsMailingList bool    `json:"isMailingList"`
	Active        bool    `json:"active"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

type legacyDirectoryContact struct {
	ID         string `json:"_id"`
	Name       string `json:"name"`
	Company    string `json:"company"`
	Position   string `json:"position"`
	Scope      string `json:"scope"`
	Source     string `json:"source"`
	Type       string `json:"type"`
	Email      string `json:"email"`
	Phone      string `json:"phone"`
	IsFavorite bool   `json:"isFavorite"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

const noOrganization = "Sin organización"

func (m *Migrator) migrateOrganizations(ctx context.Context) error {
	var clients, sources []legacyNamed
	var dir []legacyDirectoryContact
	var contacts []legacyContact
	var services []legacyService
	for coll, out := range map[string]any{"clients": &clients, "catalogLogSources": &sources, "directoryContacts": &dir, "contacts": &contacts, "services": &services} {
		if err := m.ex.Decode(coll, out); err != nil {
			return err
		}
	}
	step := newStep("organizaciones", len(clients)+len(sources))
	m.rep.Steps = append(m.rep.Steps, step)

	// Clientes: clients y catalogLogSources (en el legacy el cliente real
	// vivía en catalogLogSources, ADR 0010); mismos nombres se unen.
	for _, c := range append(clients, sources...) {
		if strings.TrimSpace(c.Name) == "" {
			step.skip("cliente sin nombre")
			continue
		}
		id, created, err := m.orgFor(ctx, c.Name, "client", uuid.Nil)
		if err != nil {
			return err
		}
		m.clientOrgs[c.ID] = id
		if created {
			step.Loaded++
		} else {
			step.skip("mismo cliente en clients y catalogLogSources (unido)")
		}
	}

	// Empresas mencionadas en contactos: internas si casi todos sus contactos
	// del directorio son internos.
	internal, total := map[string]int{}, map[string]int{}
	for _, d := range dir {
		k := normName(d.Company)
		total[k]++
		if strings.EqualFold(d.Scope, "internal") {
			internal[k]++
		}
	}
	names := map[string]string{}
	for _, d := range dir {
		if strings.TrimSpace(d.Company) != "" {
			names[normName(d.Company)] = strings.TrimSpace(d.Company)
		}
	}
	for _, c := range contacts {
		if strings.TrimSpace(c.Organization) != "" {
			names[normName(c.Organization)] = strings.TrimSpace(c.Organization)
		}
	}
	keys := make([]string, 0, len(names))
	for k := range names {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fromContacts := 0
	for _, k := range keys {
		orgType := "client"
		if total[k] > 0 && internal[k]*2 > total[k] {
			orgType = "internal"
		}
		if _, created, err := m.orgFor(ctx, names[k], orgType, uuid.Nil); err != nil {
			return err
		} else if created {
			fromContacts++
		}
	}
	step.Read += len(keys)
	step.Loaded += fromContacts
	if merged := len(keys) - fromContacts; merged > 0 {
		step.Skipped["empresa de contactos que ya era cliente (unida)"] += merged
	}
	if fromContacts > 0 {
		step.note("%d organizaciones salen de los nombres de empresa de los contactos", fromContacts)
	}

	// Clientes que la exportación referencia pero no trae: se nombran con la
	// empresa más frecuente entre los contactos de sus servicios.
	byService := map[string]map[string]int{}
	for _, c := range contacts {
		if c.ServiceID != nil && strings.TrimSpace(c.Organization) != "" {
			if byService[*c.ServiceID] == nil {
				byService[*c.ServiceID] = map[string]int{}
			}
			byService[*c.ServiceID][strings.TrimSpace(c.Organization)]++
		}
	}
	missing, inferred := 0, 0
	for _, s := range services {
		if _, ok := m.clientOrgs[s.ClientID]; ok || s.ClientID == "" {
			continue
		}
		name, best := "", 0
		for org, n := range byService[s.ID] {
			if n > best || (n == best && org < name) {
				name, best = org, n
			}
		}
		if name == "" {
			name = "Cliente sin registro " + s.ClientID[len(s.ClientID)-6:]
		}
		id, created, err := m.orgFor(ctx, name, "client", uuid.Nil)
		if err != nil {
			return err
		}
		m.clientOrgs[s.ClientID] = id
		inferred++
		if created {
			missing++
		}
	}
	if missing > 0 {
		step.Loaded += missing
	}
	if inferred > 0 {
		step.note("%d servicios apuntaban a clientes que no vienen en la exportación: se asignaron a la empresa de sus contactos (revisar)", inferred)
	}
	if _, _, err := m.orgFor(ctx, noOrganization, "internal", uuid.Nil); err != nil {
		return err
	}
	return nil
}

func (m *Migrator) migrateServices(ctx context.Context) error {
	var rows []legacyService
	if err := m.ex.Decode("services", &rows); err != nil {
		return err
	}
	step := newStep("servicios", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	seen := map[string]uuid.UUID{}
	codes := map[string]bool{}
	orgNames := map[uuid.UUID]string{}
	for name, id := range m.orgs {
		orgNames[id] = name
	}
	for _, s := range rows {
		org, ok := m.clientOrgs[s.ClientID]
		switch {
		case !ok:
			step.skip("sin cliente")
			continue
		case strings.TrimSpace(s.Name) == "" || strings.TrimSpace(s.Code) == "":
			step.skip("sin nombre o código")
			continue
		}
		key := org.String() + "|" + strings.ReplaceAll(normName(s.Name), " ", "")
		if kept, dup := seen[key]; dup {
			// "QRADAR"/"Qradar", "Ciber Vigilancia"/"CiberVigilancia": uno solo, y
			// lo que apuntaba al repetido apunta al que queda.
			m.services[s.ID] = kept
			step.skip("mismo servicio repetido en el cliente (unido)")
			continue
		}
		id := ID("services", s.ID)
		seen[key] = id
		code := serviceCode(orgNames[org], s.Code, codes)
		if _, err := m.tx.Exec(ctx, `INSERT INTO services (id, organization_id, name, code, active) VALUES ($1,$2,$3,$4,$5)`,
			id, org, strings.TrimSpace(s.Name), code, s.Active); err != nil {
			return err
		}
		m.services[s.ID] = id
		step.Loaded++
	}
	return nil
}

// ===== contactos =====

func (m *Migrator) insertContact(ctx context.Context, step *Step, id, org uuid.UUID, name, position, scope, source string, favorite bool, notes string, created, updated time.Time, email, phone string) error {
	_, err := m.tx.Exec(ctx, `INSERT INTO contacts (id, organization_id, name, position, scope, source, is_favorite, notes, active, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)`,
		id, org, name, nz(position), scope, source, favorite, nz(notes), created, updated)
	if err != nil {
		return err
	}
	problems, err := handler.ImportContactChannels(ctx, m.q, m.box, id, email, phone)
	if err != nil {
		return err
	}
	for _, p := range problems {
		step.skip(p + " (el contacto se migra sin ese dato)")
	}
	if e := directory.NormalizeEmail(email); e != "" {
		m.contactMail[org.String()+"|"+e] = id
	}
	if p := directory.NormalizePhone(phone); p != "" {
		if _, ok := m.contactPhone[org.String()+"|"+p]; !ok {
			m.contactPhone[org.String()+"|"+p] = id
		}
	}
	step.Loaded++
	return nil
}

func (m *Migrator) orgOrNone(ctx context.Context, name string) (uuid.UUID, error) {
	if strings.TrimSpace(name) == "" {
		return m.orgs[normName(noOrganization)], nil
	}
	id, _, err := m.orgFor(ctx, name, "client", uuid.Nil)
	return id, err
}

func (m *Migrator) migrateDirectoryContacts(ctx context.Context) error {
	var rows []legacyDirectoryContact
	if err := m.ex.Decode("directoryContacts", &rows); err != nil {
		return err
	}
	step := newStep("contactos del directorio", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	for _, d := range rows {
		name := directory.Sanitize(d.Name, 120)
		if name == "" {
			step.skip("sin nombre")
			continue
		}
		org, err := m.orgOrNone(ctx, d.Company)
		if err != nil {
			return err
		}
		scope := "external"
		if strings.EqualFold(d.Scope, "internal") {
			scope = "internal"
		}
		source := "manual"
		if strings.EqualFold(d.Source, "sync") {
			source = "user_sync"
		}
		notes := ""
		if strings.EqualFold(d.Type, "list") {
			notes = "Lista de correo (legacy)."
		}
		if err := m.insertContact(ctx, step, ID("directoryContacts", d.ID), org, name, d.Position, scope, source, d.IsFavorite, notes,
			timeOr(d.CreatedAt, now), timeOr(d.UpdatedAt, now), m.decrypt(step, "correo", d.Email), m.decrypt(step, "teléfono", d.Phone)); err != nil {
			return err
		}
	}
	return nil
}

func (m *Migrator) migrateEscalationContacts(ctx context.Context) error {
	var rows []legacyContact
	if err := m.ex.Decode("contacts", &rows); err != nil {
		return err
	}
	var services []legacyService
	_ = m.ex.Decode("services", &services)
	serviceName := map[string]string{}
	for _, s := range services {
		serviceName[s.ID] = s.Name
	}
	step := newStep("contactos de escalación", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	for _, c := range rows {
		name := directory.Sanitize(c.Name, 120)
		if name == "" {
			step.skip("sin nombre")
			continue
		}
		org, err := m.orgOrNone(ctx, c.Organization)
		if err != nil {
			return err
		}
		email := m.decrypt(step, "correo", c.Email)
		// Para armar equipos y políticas en la iteración 2 (spec/13 §3).
		parts := []string{"Escalación legacy"}
		if c.Role != "" {
			parts = append(parts, "rol "+c.Role)
		}
		if c.ServiceID != nil && serviceName[*c.ServiceID] != "" {
			parts = append(parts, "servicio "+serviceName[*c.ServiceID])
		}
		if c.IsMailingList {
			parts = append(parts, "lista de correo")
		}
		notes := strings.Join(parts, " · ") + "."
		if strings.TrimSpace(c.Notes) != "" {
			notes += "\n" + strings.TrimSpace(c.Notes)
		}
		if e := directory.NormalizeEmail(email); e != "" {
			if existing, dup := m.contactMail[org.String()+"|"+e]; dup {
				// Ya está en el directorio: no se duplica, pero conserva su rol
				// de escalación y su servicio en las notas.
				if _, err := m.tx.Exec(ctx, `UPDATE contacts SET notes = concat_ws(E'\n', notes, $2::text) WHERE id = $1`, existing, notes); err != nil {
					return err
				}
				m.escalationContacts[c.ID] = existing
				step.skip("ya estaba en el directorio (unido; su rol de escalación queda en las notas)")
				continue
			}
		}
		if err := m.insertContact(ctx, step, ID("contacts", c.ID), org, name, "", "external", "manual", c.Favorite, notes,
			timeOr(c.CreatedAt, now), timeOr(c.UpdatedAt, now), email, m.decrypt(step, "teléfono", c.Phone)); err != nil {
			return err
		}
		m.escalationContacts[c.ID] = ID("contacts", c.ID)
	}
	return nil
}

func (m *Migrator) migrateExternalPersons(ctx context.Context) error {
	var rows []struct {
		ID        string `json:"_id"`
		Name      string `json:"name"`
		Position  string `json:"position"`
		Email     string `json:"email"`
		Phone     string `json:"phone"`
		Active    bool   `json:"active"`
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := m.ex.Decode("externalPersons", &rows); err != nil {
		return err
	}
	step := newStep("personal externo", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	if len(rows) == 0 {
		return nil
	}
	org, _, err := m.orgFor(ctx, "Personal externo", "contractor", uuid.Nil)
	if err != nil {
		return err
	}
	now := time.Now()
	for _, p := range rows {
		name := directory.Sanitize(p.Name, 120)
		if name == "" {
			step.skip("sin nombre")
			continue
		}
		if err := m.insertContact(ctx, step, ID("externalPersons", p.ID), org, name, p.Position, "internal", "manual", false,
			"Personal externo de turnos (legacy).", timeOr(p.CreatedAt, now), timeOr(p.UpdatedAt, now),
			m.decrypt(step, "correo", p.Email), m.decrypt(step, "teléfono", p.Phone)); err != nil {
			return err
		}
	}
	return nil
}

// ===== turnos y checklist =====

func (m *Migrator) migrateWorkShifts(ctx context.Context) error {
	var rows []struct {
		ID                string `json:"_id"`
		Name              string `json:"name"`
		StartTime         string `json:"startTime"`
		EndTime           string `json:"endTime"`
		Timezone          string `json:"timezone"`
		Type              string `json:"type"`
		Active            bool   `json:"active"`
		EmailReportConfig struct {
			Recipients       []string `json:"recipients"`
			IncludeChecklist *bool    `json:"includeChecklist"`
			IncludeEntries   *bool    `json:"includeEntries"`
			SubjectTemplate  string   `json:"subjectTemplate"`
		} `json:"emailReportConfig"`
	}
	if err := m.ex.Decode("workShifts", &rows); err != nil {
		return err
	}
	step := newStep("turnos", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	for _, w := range rows {
		if !reminders.ValidTime(w.StartTime) || !reminders.ValidTime(w.EndTime) || strings.TrimSpace(w.Name) == "" {
			step.skip("sin nombre u horario válido")
			continue
		}
		tz := w.Timezone
		if _, err := time.LoadLocation(tz); tz == "" || err != nil {
			tz = "America/Santiago"
		}
		recipients := []string{}
		for _, r := range w.EmailReportConfig.Recipients {
			if directory.ValidEmail(strings.TrimSpace(r)) {
				recipients = append(recipients, strings.TrimSpace(r))
			}
		}
		shiftType := w.Type
		if shiftType == "" {
			shiftType = "regular"
		}
		// Mismos valores por defecto que el modelo WorkShift del legacy.
		cfg := w.EmailReportConfig
		subject := strings.TrimSpace(cfg.SubjectTemplate)
		if subject == "" {
			subject = "Reporte SOC [fecha] [turno]"
		}
		id := ID("workShifts", w.ID)
		if _, err := m.tx.Exec(ctx, `INSERT INTO work_shifts (id, name, start_time, end_time, timezone, shift_type, email_recipients, active,
			email_include_checklist, email_include_entries, email_subject_template)
			VALUES ($1,$2,$3::time,$4::time,$5,$6,$7,$8,$9,$10,$11)`, id, strings.TrimSpace(w.Name), w.StartTime, w.EndTime, tz, shiftType, recipients, w.Active,
			cfg.IncludeChecklist == nil || *cfg.IncludeChecklist, cfg.IncludeEntries == nil || *cfg.IncludeEntries, subject); err != nil {
			return err
		}
		m.shifts[w.ID] = id
		if len(recipients) == 0 {
			step.note("turno sin destinatarios del reporte de cierre: %s (se configuran en Administración → Turnos)", strings.TrimSpace(w.Name))
		}
		step.Loaded++
	}
	return nil
}

type legacyChecklistItem struct {
	ID       string                `json:"_id"`
	Title    string                `json:"title"`
	Order    int                   `json:"order"`
	IsActive *bool                 `json:"isActive"`
	Children []legacyChecklistItem `json:"children"`
}

func (m *Migrator) migrateChecklistTemplates(ctx context.Context) error {
	var rows []struct {
		ID         string `json:"_id"`
		Name       string `json:"name"`
		IsActive   bool   `json:"isActive"`
		CreatedAt  string `json:"createdAt"`
		AssignedTo []struct {
			ShiftID string `json:"shiftId"`
			Type    string `json:"type"`
		} `json:"assignedTo"`
		Items []legacyChecklistItem `json:"items"`
	}
	if err := m.ex.Decode("checklistTemplates", &rows); err != nil {
		return err
	}
	step := newStep("plantillas de checklist", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	items := 0
	for _, t := range rows {
		if strings.TrimSpace(t.Name) == "" {
			step.skip("sin nombre")
			continue
		}
		id := ID("checklistTemplates", t.ID)
		if _, err := m.tx.Exec(ctx, `INSERT INTO checklist_templates (id, name, is_active, created_at) VALUES ($1,$2,$3,$4)`,
			id, strings.TrimSpace(t.Name), t.IsActive, timeOr(t.CreatedAt, now)); err != nil {
			return err
		}
		var insert func(list []legacyChecklistItem, parent *uuid.UUID) error
		insert = func(list []legacyChecklistItem, parent *uuid.UUID) error {
			sort.SliceStable(list, func(i, j int) bool { return list[i].Order < list[j].Order })
			for i, it := range list {
				if strings.TrimSpace(it.Title) == "" || (it.IsActive != nil && !*it.IsActive) {
					continue
				}
				itemID := ID("checklistItems", t.ID+":"+it.ID)
				if _, err := m.tx.Exec(ctx, `INSERT INTO checklist_items (id, template_id, parent_item_id, title, item_order) VALUES ($1,$2,$3,$4,$5)`,
					itemID, id, parent, strings.TrimSpace(it.Title), i); err != nil {
					return err
				}
				items++
				if err := insert(it.Children, &itemID); err != nil {
					return err
				}
			}
			return nil
		}
		if err := insert(t.Items, nil); err != nil {
			return err
		}
		// Asignación a turnos: inicio/cierre (el legacy permitía varias; la
		// 2.0 una por momento: gana la plantilla activa).
		for _, a := range t.AssignedTo {
			shift, ok := m.shifts[a.ShiftID]
			if !ok {
				continue
			}
			col := "checklist_template_start_id"
			if a.Type == "cierre" {
				col = "checklist_template_end_id"
			}
			cond := col + " IS NULL"
			if t.IsActive {
				cond = "true"
			}
			if _, err := m.tx.Exec(ctx, `UPDATE work_shifts SET `+col+` = $1 WHERE id = $2 AND `+cond, id, shift); err != nil {
				return err
			}
		}
		step.Loaded++
	}
	step.note("%d ítems", items)
	return nil
}

// ===== entradas y notas =====

func (m *Migrator) migrateEntries(ctx context.Context) error {
	var rows []struct {
		ID           string   `json:"_id"`
		Content      string   `json:"content"`
		EntryType    string   `json:"entryType"`
		Tags         []string `json:"tags"`
		CreatedBy    string   `json:"createdBy"`
		ClientID     *string  `json:"clientId"`
		ClientName   string   `json:"clientName"`
		GlpiTicketID *string  `json:"glpiTicketId"`
		CreatedAt    string   `json:"createdAt"`
		UpdatedAt    string   `json:"updatedAt"`
	}
	if err := m.ex.Decode("entries", &rows); err != nil {
		return err
	}
	step := newStep("entradas", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	// Servicios de cada cliente: una entrada con cliente queda en SOC con el
	// servicio de ese cliente (no como etiqueta "cliente:X" en General).
	byOrg := map[uuid.UUID][]uuid.UUID{}
	svcRows, err := m.tx.Query(ctx, `SELECT organization_id, id FROM services ORDER BY name`)
	if err != nil {
		return err
	}
	for svcRows.Next() {
		var org, svc uuid.UUID
		if err := svcRows.Scan(&org, &svc); err != nil {
			svcRows.Close()
			return err
		}
		byOrg[org] = append(byOrg[org], svc)
	}
	svcRows.Close()
	linked, ambiguous := 0, 0
	for _, e := range rows {
		user, ok := m.users[e.CreatedBy]
		if !ok {
			step.skip("su autor no existe en la exportación")
			continue
		}
		if strings.TrimSpace(e.Content) == "" {
			step.skip("sin contenido")
			continue
		}
		entryType := e.EntryType
		switch entryType {
		case "operativa", "incidente", "ofensa", "checklist":
		default:
			entryType = "operativa"
		}
		tags := []string{}
		for _, t := range e.Tags {
			if t = strings.TrimSpace(t); t != "" {
				tags = append(tags, t)
			}
		}
		scope, service := "general", (*uuid.UUID)(nil)
		if c := strings.TrimSpace(e.ClientName); c != "" || e.ClientID != nil {
			org, ok := uuid.Nil, false
			if e.ClientID != nil {
				org, ok = m.clientOrgs[*e.ClientID]
			}
			if !ok && c != "" {
				org, ok = m.orgs[normName(c)]
			}
			switch svcs := byOrg[org]; {
			case ok && len(svcs) == 1:
				scope, service = "soc", &svcs[0]
				linked++
			case ok && len(svcs) > 1:
				// Varios servicios: no se adivina cuál; queda en SOC y el
				// cliente como etiqueta para poder filtrarlo.
				scope = "soc"
				tags = append(tags, "cliente:"+c)
				ambiguous++
			case c != "":
				tags = append(tags, "cliente:"+c)
			}
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO entries (id, user_id, entry_type, scope, content, tags, service_id, glpi_ticket_id, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, ID("entries", e.ID), user, entryType, scope, e.Content, tags, service, nz(deref(e.GlpiTicketID)),
			timeOr(e.CreatedAt, now), timeOr(e.UpdatedAt, now)); err != nil {
			return err
		}
		step.Loaded++
	}
	if linked > 0 {
		step.note("%d entradas quedaron en SOC con el servicio de su cliente", linked)
	}
	if ambiguous > 0 {
		step.note("%d entradas son de un cliente con varios servicios: quedan en SOC sin servicio y con la etiqueta cliente:X (revisar)", ambiguous)
	}
	return nil
}

func (m *Migrator) migrateNotes(ctx context.Context) error {
	var admin []struct {
		Content      string `json:"content"`
		LastEditedBy string `json:"lastEditedBy"`
		UpdatedAt    string `json:"updatedAt"`
	}
	var personal []struct {
		UserID    string `json:"userId"`
		Content   string `json:"content"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := m.ex.Decode("adminNotes", &admin); err != nil {
		return err
	}
	if err := m.ex.Decode("personalNotes", &personal); err != nil {
		return err
	}
	step := newStep("notas", len(admin)+len(personal))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	for _, a := range admin {
		var editor *uuid.UUID
		if id, ok := m.users[a.LastEditedBy]; ok {
			editor = &id
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO admin_notes (id, content, last_edited_by, updated_at) VALUES (true,$1,$2,$3)
			ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, last_edited_by = EXCLUDED.last_edited_by, updated_at = EXCLUDED.updated_at`,
			a.Content, editor, timeOr(a.UpdatedAt, now)); err != nil {
			return err
		}
		step.Loaded++
	}
	seen := map[uuid.UUID]bool{}
	for _, p := range personal {
		user, ok := m.users[p.UserID]
		switch {
		case !ok:
			step.skip("nota personal de un usuario que ya no existe")
			continue
		case seen[user]:
			step.skip("segunda nota del mismo usuario")
			continue
		}
		seen[user] = true
		if _, err := m.tx.Exec(ctx, `INSERT INTO personal_notes (id, user_id, content, updated_at) VALUES ($1,$2,$3,$4)`,
			ID("personalNotes", p.UserID), user, p.Content, timeOr(p.UpdatedAt, now)); err != nil {
			return err
		}
		step.Loaded++
	}
	return nil
}

// ===== configuración =====

func (m *Migrator) migrateSMTP(ctx context.Context) error {
	var rows []struct {
		Host        string `json:"host"`
		Port        int    `json:"port"`
		Username    string `json:"username"`
		Password    string `json:"password"`
		SenderEmail string `json:"senderEmail"`
		SenderName  string `json:"senderName"`
		UseTLS      bool   `json:"useTLS"`
		IsActive    bool   `json:"isActive"`
	}
	if err := m.ex.Decode("smtpConfigs", &rows); err != nil {
		return err
	}
	step := newStep("correo (SMTP)", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	for _, s := range rows {
		if !s.IsActive {
			step.skip("configuración inactiva")
			continue
		}
		if s.Host == "" || s.Port == 0 || !directory.ValidEmail(s.SenderEmail) {
			step.skip("sin servidor, puerto o remitente válido")
			continue
		}
		var pass *string
		if plain := m.decrypt(step, "contraseña SMTP", s.Password); plain != "" {
			enc, err := m.box.Encrypt(plain)
			if err != nil {
				return err
			}
			pass = &enc
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO smtp_config (id, host, port, username, password_encrypted, from_address, from_name, require_tls)
			VALUES (true,$1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (id) DO UPDATE SET host=EXCLUDED.host, port=EXCLUDED.port, username=EXCLUDED.username, password_encrypted=EXCLUDED.password_encrypted,
			from_address=EXCLUDED.from_address, from_name=EXCLUDED.from_name, require_tls=EXCLUDED.require_tls`,
			s.Host, s.Port, nz(s.Username), pass, s.SenderEmail, nz(s.SenderName), s.UseTLS); err != nil {
			return err
		}
		step.Loaded++
		break
	}
	return nil
}

func (m *Migrator) migrateShiftReminders(ctx context.Context) error {
	var rows []struct {
		ID             string   `json:"_id"`
		Label          string   `json:"label"`
		ReminderText   string   `json:"reminderText"`
		FrequencyType  string   `json:"frequencyType"`
		IntervalHours  int      `json:"intervalHours"`
		FixedTimes     []string `json:"fixedTimes"`
		TargetShiftIDs []string `json:"targetShiftIds"`
		Enabled        bool     `json:"enabled"`
		CreatedAt      string   `json:"createdAt"`
	}
	if err := m.ex.Decode("shiftReminders", &rows); err != nil {
		return err
	}
	step := newStep("recordatorios de turno", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	for _, r := range rows {
		freq := r.FrequencyType
		if freq != reminders.FrequencyFixed {
			freq = reminders.FrequencyHours
		}
		interval := r.IntervalHours
		if interval < 1 || interval > 24 {
			interval = 4
		}
		times := []string{}
		for _, t := range r.FixedTimes {
			if reminders.ValidTime(t) {
				times = append(times, t)
			}
		}
		targets := []uuid.UUID{}
		for _, s := range r.TargetShiftIDs {
			if id, ok := m.shifts[s]; ok {
				targets = append(targets, id)
			}
		}
		label, text := strings.TrimSpace(r.Label), strings.TrimSpace(r.ReminderText)
		if label == "" || text == "" || (freq == reminders.FrequencyFixed && len(times) == 0) {
			step.skip("sin nombre, texto u horas")
			continue
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO shift_reminders (id, label, reminder_text, frequency_type, interval_hours, fixed_times, target_shift_ids, enabled, created_by, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, ID("shiftReminders", r.ID), truncate(label, 150), truncate(text, 5000), freq, interval, times, targets,
			r.Enabled, m.firstAdmin, timeOr(r.CreatedAt, now)); err != nil {
			return err
		}
		step.Loaded++
	}
	return nil
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func (m *Migrator) migrateNotificationSchedules(ctx context.Context) error {
	var rows []struct {
		ID           string   `json:"_id"`
		Name         string   `json:"name"`
		Enabled      bool     `json:"enabled"`
		Frequency    string   `json:"frequency"`
		DayOfWeek    int      `json:"dayOfWeek"`
		Time         string   `json:"time"`
		RoleFilter   []string `json:"roleFilter"`
		Recipients   []string `json:"recipients"`
		CcRecipients []string `json:"ccRecipients"`
		LastSentAt   string   `json:"lastSentAt"`
		CreatedAt    string   `json:"createdAt"`
		TargetPeriod string   `json:"targetPeriod"`
		EmailFormat  string   `json:"emailFormat"`
	}
	if err := m.ex.Decode("shiftNotificationSchedules", &rows); err != nil {
		return err
	}
	step := newStep("avisos de dotación", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	now := time.Now()
	for _, s := range rows {
		freq := s.Frequency
		if freq != "monthly" {
			freq = "weekly"
		}
		if strings.TrimSpace(s.Name) == "" || !reminders.ValidTime(s.Time) || s.DayOfWeek < 0 || s.DayOfWeek > 6 {
			step.skip("sin nombre, día u hora válidos")
			continue
		}
		var last *time.Time
		if t, ok := ParseTime(s.LastSentAt); ok {
			last = &t
		}
		nonNil := func(v []string) []string {
			if v == nil {
				return []string{}
			}
			return v
		}
		// Mismos valores por defecto que el modelo del legacy: semana actual y
		// formato lista. En el calendario el legacy no usaba roleFilter (eran
		// códigos de guardia: TELEWORK, OL…); en la 2.0 el filtro es por cargo,
		// así que esos códigos no se traen.
		target := s.TargetPeriod
		if target != "next_week" {
			target = "current_week"
		}
		format := s.EmailFormat
		if format != "calendar" {
			format = "list"
		}
		roleFilter := nonNil(s.RoleFilter)
		if format == "calendar" {
			roleFilter = []string{}
		} else {
			step.note("aviso %q en formato lista (guardias de escalamiento): no se envía hasta el rediseño de escalamiento", strings.TrimSpace(s.Name))
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO work_shift_notification_schedules (id, name, enabled, frequency, day_of_week, send_time, role_filter, recipients, cc_recipients, last_sent_at, created_by, created_at, target_period, email_format)
			VALUES ($1,$2,$3,$4,$5,$6::time,$7,$8,$9,$10,$11,$12,$13,$14)`, ID("shiftNotificationSchedules", s.ID), strings.TrimSpace(s.Name), s.Enabled, freq, s.DayOfWeek, s.Time,
			roleFilter, nonNil(s.Recipients), nonNil(s.CcRecipients), last, m.firstAdmin, timeOr(s.CreatedAt, now), target, format); err != nil {
			return err
		}
		step.Loaded++
	}
	return nil
}

func (m *Migrator) migrateAppConfig(ctx context.Context) error {
	var rows []struct {
		ShiftCheckCooldownHours *int     `json:"shiftCheckCooldownHours"`
		AlertNokEnabled         *bool    `json:"alertNokEnabled"`
		AlertNokRoleTarget      []string `json:"alertNokRoleTarget"`
		// Marca (comentario del dueño #8).
		AppTitle                string `json:"appTitle"`
		LogoURL                 string `json:"logoUrl"`
		FaviconURL              string `json:"faviconUrl"`
		TitleFont               string `json:"titleFont"`
		IncidentEmailPaletteKey string `json:"incidentEmailPaletteKey"`
		LoginTheme              string `json:"loginTheme"`
	}
	if err := m.ex.Decode("appConfigs", &rows); err != nil {
		return err
	}
	step := newStep("configuración", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	if _, err := m.tx.Exec(ctx, `INSERT INTO app_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING`); err != nil {
		return err
	}
	// El legacy era un SOC: se enciende SOC y se da el setup por hecho (los
	// datos ya están). NOC se enciende después desde Módulos si aplica.
	if _, err := m.tx.Exec(ctx, `UPDATE app_config SET soc_module_enabled = true, setup_completed_at = COALESCE(setup_completed_at, now())`); err != nil {
		return err
	}
	step.note("módulo SOC encendido y setup marcado como hecho; NOC queda apagado")
	for _, c := range rows {
		if c.ShiftCheckCooldownHours != nil {
			minutes := min(max(*c.ShiftCheckCooldownHours*60, 0), 1440)
			if _, err := m.tx.Exec(ctx, `UPDATE app_config SET shift_check_cooldown_minutes = $1`, minutes); err != nil {
				return err
			}
		}
		if c.AlertNokEnabled != nil {
			targets := c.AlertNokRoleTarget
			if targets == nil {
				targets = []string{}
			}
			if _, err := m.tx.Exec(ctx, `UPDATE app_config SET alert_nok_enabled = $1, alert_nok_role_target = $2`, *c.AlertNokEnabled, targets); err != nil {
				return err
			}
			// En el legacy la alerta NOK era una sola para todos los checklists;
			// en la 2.0 va por plantilla: cada una hereda la del legacy.
			tag, err := m.tx.Exec(ctx, `UPDATE checklist_templates SET alert_nok_enabled = $1, alert_nok_cargos = $2`, *c.AlertNokEnabled && len(targets) > 0, targets)
			if err != nil {
				return err
			}
			if *c.AlertNokEnabled {
				step.note("alerta NOK del checklist a los cargos %s en %d plantillas", strings.Join(targets, ", "), tag.RowsAffected())
			}
		}
		if err := m.migrateBranding(ctx, step, c.AppTitle, c.LogoURL, c.FaviconURL, c.TitleFont, c.IncidentEmailPaletteKey, c.LoginTheme); err != nil {
			return err
		}
		step.Loaded++
		break
	}
	return nil
}

// migrateBranding pasa la marca del legacy a app_branding: nombre, logo
// (el archivo de uploads/logos del ZIP), favicon externo, paleta del correo
// de incidente y tema del login. La fuente del título del legacy venía en
// el frontend (assets), no en el respaldo: se sube en Administración → Marca.
func (m *Migrator) migrateBranding(ctx context.Context, step *Step, title, logoURL, faviconURL, titleFont, palette, loginTheme string) error {
	if _, err := m.tx.Exec(ctx, `INSERT INTO app_branding (id) VALUES (true) ON CONFLICT (id) DO NOTHING`); err != nil {
		return err
	}
	if t := strings.TrimSpace(title); t != "" {
		if _, err := m.tx.Exec(ctx, `UPDATE app_branding SET app_title = $1`, t); err != nil {
			return err
		}
		step.note("marca: nombre visible «%s»", t)
	}
	switch palette {
	case "cdc-verde", "noche-azul", "slate-pro", "carbon", "indigo", "bosque":
		if _, err := m.tx.Exec(ctx, `UPDATE app_branding SET incident_palette = $1`, palette); err != nil {
			return err
		}
	}
	switch loginTheme {
	case "crt", "infoflow", "modern", "surrealism", "win311", "unix89":
		if _, err := m.tx.Exec(ctx, `UPDATE app_branding SET login_theme = $1`, loginTheme); err != nil {
			return err
		}
	}
	if u := strings.TrimSpace(faviconURL); strings.HasPrefix(u, "https://") {
		if _, err := m.tx.Exec(ctx, `UPDATE app_branding SET favicon_url = $1`, u); err != nil {
			return err
		}
	}
	if rel := strings.TrimPrefix(strings.TrimSpace(logoURL), "/uploads/"); rel != "" && rel != logoURL {
		if f, ok := m.uploads[rel]; ok && f.UncompressedSize64 <= 2<<20 {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			raw, err := io.ReadAll(rc)
			_ = rc.Close()
			if err != nil {
				return err
			}
			mime := http.DetectContentType(raw)
			if strings.HasPrefix(mime, "image/") {
				if _, err := m.tx.Exec(ctx, `UPDATE app_branding SET logo = $1, logo_type = $2, logo_name = $3`, raw, mime, path.Base(rel)); err != nil {
					return err
				}
				step.note("marca: logo %s", path.Base(rel))
			}
		} else {
			step.note("marca: el logo %s no está en el respaldo; súbelo en Administración → Marca", logoURL)
		}
	}
	if f := strings.TrimSpace(titleFont); f != "" {
		step.note("marca: la fuente del título del legacy («%s») venía en el frontend; súbela en Administración → Marca para usarla", f)
	}
	return nil
}

// ===== auditoría =====

func (m *Migrator) migrateAudit(ctx context.Context) error {
	var rows []struct {
		Timestamp string `json:"timestamp"`
		Event     string `json:"event"`
		Level     string `json:"level"`
		Source    string `json:"source"`
		SourceID  any    `json:"sourceId"`
		Actor     struct {
			UserID   json.RawMessage `json:"userId"`
			Username string          `json:"username"`
			Role     string          `json:"role"`
		} `json:"actor"`
		Request struct {
			RequestID         string `json:"requestId"`
			IP                string `json:"ip"`
			Path              string `json:"path"`
			Method            string `json:"method"`
			UserAgent         string `json:"userAgent"`
			DeviceFingerprint string `json:"deviceFingerprint"`
			IPChanged         bool   `json:"ipChanged"`
			PreviousIP        string `json:"previousIp"`
		} `json:"request"`
		Result struct {
			Success *bool  `json:"success"`
			Reason  string `json:"reason"`
		} `json:"result"`
		Metadata any `json:"metadata"`
	}
	if err := m.ex.Decode("auditLogs", &rows); err != nil {
		return err
	}
	step := newStep("auditoría", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	batch := make([][]any, 0, len(rows))
	for _, a := range rows {
		ts, ok := ParseTime(a.Timestamp)
		if !ok || strings.TrimSpace(a.Event) == "" {
			step.skip("sin fecha o evento")
			continue
		}
		var actor *uuid.UUID
		if id, ok := m.users[OID(a.Actor.UserID)]; ok {
			actor = &id
		}
		success := true
		if a.Result.Success != nil {
			success = *a.Result.Success
		}
		level := strings.ToLower(a.Level)
		if level != "warn" && level != "error" {
			level = "info"
		}
		source := a.Source
		if source == "" {
			source = "core"
		}
		var meta []byte
		if a.Metadata != nil {
			meta, _ = json.Marshal(CleanMetadata(a.Metadata))
		}
		var sourceID *string
		if a.SourceID != nil {
			s := fmt.Sprint(a.SourceID)
			sourceID = &s
		}
		batch = append(batch, []any{ts, a.Event, level, actor, nz(a.Actor.Username), nz(a.Actor.Role), nz(a.Request.RequestID), nz(a.Request.IP),
			nz(a.Request.Path), nz(a.Request.Method), nz(a.Request.UserAgent), nz(a.Request.DeviceFingerprint), a.Request.IPChanged,
			nz(a.Request.PreviousIP), success, nz(a.Result.Reason), source, sourceID, meta})
	}
	n, err := m.tx.CopyFrom(ctx, pgx.Identifier{"audit_log"}, []string{"timestamp", "event", "level", "actor_user_id", "actor_username", "actor_role",
		"request_id", "request_ip", "request_path", "request_method", "user_agent", "device_fingerprint", "ip_changed", "previous_ip",
		"success", "reason", "source", "source_id", "metadata"}, pgx.CopyFromRows(batch))
	if err != nil {
		return err
	}
	step.Loaded = int(n)
	return nil
}
