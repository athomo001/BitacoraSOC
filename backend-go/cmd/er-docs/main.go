// er-docs genera docs/modelo-de-datos.md (diagramas entidad-relación en
// Mermaid, uno por dominio) leyendo el esquema real que usa sqlc
// (sql/schema/0001_init_schema.sql), con todos los ALTER de las migraciones
// ya aplicados. El documento no se edita a mano: se regenera.
//
// Uso:
//
//	go run ./cmd/er-docs -schema sql/schema/0001_init_schema.sql -out ../docs/modelo-de-datos.md
//
// Una tabla nueva que no esté en `domains` hace fallar la generación, para
// que nadie se olvide de ubicarla en un dominio.
package main

import (
	"flag"
	"fmt"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
)

type column struct {
	name, typ   string
	notNull, pk bool
	unique      bool
	refTable    string
}

type table struct {
	name   string
	cols   []*column
	pkCols []string
}

func (t *table) col(name string) *column {
	for _, c := range t.cols {
		if c.name == name {
			return c
		}
	}
	return nil
}

type domain struct {
	title, intro string
	tables       []string
}

var domains = []domain{
	{"Usuarios, acceso y permisos", "Cuentas, sesiones revocadas, llaves de API y los grupos de permisos que acotan qué módulos y capacidades tiene cada usuario.",
		[]string{"users", "login_rate_limits", "token_denylist", "api_keys", "permission_groups", "user_permission_groups"}},
	{"Territorio, organizaciones y activos", "Árbol territorial genérico (país → región → zona → sitio), organizaciones con tipos configurables, sus servicios y los activos.",
		[]string{"territorial_units", "organization_types", "organizations", "services", "catalog_log_sources", "assets"}},
	{"Directorio de contactos", "Personas externas e internas a las que se avisa, con sus canales.",
		[]string{"contacts", "contact_channels"}},
	{"Ticketera", "Tickets con SLA, comentarios, tareas con tiempo, resolutores, imágenes, padre/hijo y unidos.",
		[]string{"tickets", "ticket_comments", "ticket_tasks", "ticket_resolvers", "ticket_images"}},
	{"Equipos y escalamiento", "Equipos, políticas con sus llamados, pools con nombre, incidentes con sus intentos y notas, ventanas de mantenimiento y RACI. Un equipo con `kind = 'step'` es el grupo de personas de un solo llamado: no tiene organización, no aparece en Equipos y se borra con su paso.",
		[]string{"team_groups", "teams", "team_members", "team_coverage", "escalation_policies", "escalation_steps", "escalation_pools", "escalation_pool_members", "escalation_incidents", "escalation_incident_notes", "escalation_action_logs", "maintenance_windows", "raci_assignments"}},
	{"Turnos, guardias y dotación", "Turnos de trabajo y sus integrantes, guardias con hora exacta (ciclos, tramos y reemplazos), dotación, recordatorios y cierre de turno.",
		[]string{"work_shifts", "work_shift_members", "work_shift_assignments", "work_shift_notification_schedules", "rotation_cycles", "rotation_slots", "rotation_overrides", "shift_reminders", "shift_reminder_sends", "shift_closures", "public_share_links"}},
	{"Checklists", "Plantillas de checklist de inicio y cierre de turno y sus ejecuciones.",
		[]string{"checklist_templates", "checklist_items", "shift_checks", "shift_check_services"}},
	{"Bitácora", "Entradas, comentarios, adjuntos, borradores y eventos del sistema.",
		[]string{"entries", "entry_comments", "entry_attachments", "entry_drafts", "system_events"}},
	{"Reportes y avisos por cliente", "Historial de reportes enviados, tipos de operación, eventos del informe y las reglas de aviso por cliente con su acuse.",
		[]string{"report_history", "report_operation_types", "report_events", "client_alert_rules", "client_alert_acks"}},
	{"Auditoría, notas y alertas de sala", "Registro de auditoría (solo se agrega), notas del admin y personales, y alertas programadas en pantalla.",
		[]string{"audit_log", "admin_notes", "personal_notes", "scheduled_alerts"}},
	{"Configuración y respaldos", "Configuración única de la instalación, correo, marca, funcionalidades activables y respaldos.",
		[]string{"app_config", "smtp_config", "app_branding", "system_features", "backup_config", "backup_runs"}},
	{"Complementos", "Complementos instalados, sus archivos y su almacenamiento.",
		[]string{"complements", "complement_files", "complement_uploads", "complement_storage"}},
	{"Ingesta de alertas (después del corte)", "Tablas creadas para la ingesta de alertas del backlog posterior al corte; todavía sin uso.",
		[]string{"message_templates", "alert_ingestion_rules"}},
}

func main() {
	schemaPath := flag.String("schema", "sql/schema/0001_init_schema.sql", "esquema SQL")
	outPath := flag.String("out", "../docs/modelo-de-datos.md", "archivo de salida")
	flag.Parse()

	raw, err := os.ReadFile(*schemaPath)
	if err != nil {
		fail(err)
	}
	tables, order, err := parse(string(raw))
	if err != nil {
		fail(err)
	}
	doc, err := render(tables, order)
	if err != nil {
		fail(err)
	}
	if err := os.WriteFile(*outPath, []byte(doc), 0o644); err != nil {
		fail(err)
	}
	fmt.Printf("%d tablas en %d dominios → %s\n", len(tables), len(domains), *outPath)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "er-docs:", err)
	os.Exit(1)
}

// statements quita los comentarios y separa por ';', respetando textos entre
// comillas simples y bloques $$ … $$ (funciones y DO).
func statements(sql string) []string {
	var out []string
	var b strings.Builder
	inQuote, inDollar := false, false
	for i := 0; i < len(sql); i++ {
		c := sql[i]
		switch {
		case inQuote:
			b.WriteByte(c)
			if c == '\'' {
				inQuote = false
			}
		case inDollar:
			b.WriteByte(c)
			if c == '$' && i+1 < len(sql) && sql[i+1] == '$' {
				b.WriteByte('$')
				i++
				inDollar = false
			}
		case c == '-' && i+1 < len(sql) && sql[i+1] == '-':
			for i < len(sql) && sql[i] != '\n' {
				i++
			}
			b.WriteByte('\n')
		case c == '\'':
			inQuote = true
			b.WriteByte(c)
		case c == '$' && i+1 < len(sql) && sql[i+1] == '$':
			inDollar = true
			b.WriteString("$$")
			i++
		case c == ';':
			out = append(out, strings.TrimSpace(b.String()))
			b.Reset()
		default:
			b.WriteByte(c)
		}
	}
	if s := strings.TrimSpace(b.String()); s != "" {
		out = append(out, s)
	}
	return out
}

// splitTop separa por comas que no están dentro de paréntesis ni comillas.
func splitTop(s string) []string {
	var parts []string
	depth, start := 0, 0
	inQuote := false
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == '\'':
			inQuote = !inQuote
		case inQuote:
		case c == '(':
			depth++
		case c == ')':
			depth--
		case c == ',' && depth == 0:
			parts = append(parts, strings.TrimSpace(s[start:i]))
			start = i + 1
		}
	}
	return append(parts, strings.TrimSpace(s[start:]))
}

var (
	reCreate   = regexp.MustCompile(`(?is)^CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\((.*)\)\s*$`)
	reAlter    = regexp.MustCompile(`(?is)^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(\w+)\s+(.*)$`)
	reDrop     = regexp.MustCompile(`(?is)^DROP TABLE (?:IF EXISTS )?(\w+)`)
	reRef      = regexp.MustCompile(`(?i)\bREFERENCES\s+(\w+)`)
	reFK       = regexp.MustCompile(`(?is)FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES\s+(\w+)`)
	rePK       = regexp.MustCompile(`(?is)PRIMARY KEY\s*\(([^)]*)\)`)
	reUnique   = regexp.MustCompile(`(?is)^UNIQUE\s*\(([^)]*)\)`)
	reAddCol   = regexp.MustCompile(`(?is)^ADD COLUMN (?:IF NOT EXISTS )?(.*)$`)
	reDropCol  = regexp.MustCompile(`(?is)^DROP COLUMN (?:IF EXISTS )?(\w+)`)
	reRenCol   = regexp.MustCompile(`(?is)^RENAME COLUMN (\w+) TO (\w+)`)
	reSetNN    = regexp.MustCompile(`(?is)^ALTER COLUMN (\w+) SET NOT NULL`)
	reDropNN   = regexp.MustCompile(`(?is)^ALTER COLUMN (\w+) DROP NOT NULL`)
	reAddCons  = regexp.MustCompile(`(?is)^ADD (?:CONSTRAINT \w+ )?(.*)$`)
	reTypeStop = regexp.MustCompile(`(?i)^(NOT|NULL|DEFAULT|PRIMARY|REFERENCES|UNIQUE|CHECK|GENERATED|CONSTRAINT|COLLATE)$`)
)

func names(list string) []string {
	var out []string
	for _, n := range strings.Split(list, ",") {
		out = append(out, strings.TrimSpace(n))
	}
	return out
}

func parseColumn(def string) *column {
	f := strings.Fields(def)
	c := &column{name: strings.Trim(f[0], `"`)} // audit_log."timestamp"
	var typ []string
	i := 1
	for ; i < len(f) && !reTypeStop.MatchString(f[i]); i++ {
		typ = append(typ, f[i])
	}
	c.typ = strings.Join(typ, " ")
	// Sin los textos entre comillas: DEFAULT 'unique' no es una restricción.
	rest := strings.ToUpper(regexp.MustCompile(`'[^']*'`).ReplaceAllString(strings.Join(f[i:], " "), "''"))
	c.notNull = strings.Contains(rest, "NOT NULL")
	c.pk = strings.Contains(rest, "PRIMARY KEY")
	c.unique = regexp.MustCompile(`\bUNIQUE\b`).MatchString(rest)
	if m := reRef.FindStringSubmatch(def); m != nil {
		c.refTable = m[1]
	}
	if c.pk {
		c.notNull = true
	}
	return c
}

// constraint aplica una restricción de tabla (en CREATE TABLE o ADD CONSTRAINT).
func constraint(t *table, def string) {
	if m := reFK.FindStringSubmatch(def); m != nil {
		cols := names(m[1])
		if len(cols) == 1 {
			if c := t.col(cols[0]); c != nil {
				c.refTable = m[2]
			}
		}
		return
	}
	if m := rePK.FindStringSubmatch(def); m != nil {
		t.pkCols = names(m[1])
		for _, n := range t.pkCols {
			if c := t.col(n); c != nil {
				c.pk, c.notNull = true, true
			}
		}
		return
	}
	if m := reUnique.FindStringSubmatch(def); m != nil {
		if cols := names(m[1]); len(cols) == 1 {
			if c := t.col(cols[0]); c != nil {
				c.unique = true
			}
		}
	}
}

func isConstraint(def string) bool {
	// "UNIQUE(a, b)" va pegado al paréntesis: solo cuenta la palabra.
	u := strings.ToUpper(regexp.MustCompile(`^\w+`).FindString(def))
	return u == "CONSTRAINT" || u == "PRIMARY" || u == "FOREIGN" || u == "UNIQUE" || u == "CHECK" || u == "EXCLUDE"
}

func parse(sql string) (map[string]*table, []string, error) {
	tables := map[string]*table{}
	var order []string
	for _, st := range statements(sql) {
		if m := reCreate.FindStringSubmatch(st); m != nil {
			t := createTable(m[1], m[2])
			tables[t.name] = t
			order = append(order, t.name)
			continue
		}
		if m := reDrop.FindStringSubmatch(st); m != nil {
			delete(tables, m[1])
			continue
		}
		m := reAlter.FindStringSubmatch(st)
		if m == nil {
			continue
		}
		t := tables[m[1]]
		if t == nil {
			return nil, nil, fmt.Errorf("ALTER sobre una tabla desconocida: %s", m[1])
		}
		for _, action := range splitTop(m[2]) {
			alter(t, action)
		}
	}
	return tables, order, nil
}

func createTable(name, body string) *table {
	t := &table{name: name}
	defs := splitTop(body)
	for _, def := range defs {
		if def != "" && !isConstraint(def) {
			t.cols = append(t.cols, parseColumn(def))
		}
	}
	for _, c := range t.cols {
		if c.pk {
			t.pkCols = []string{c.name}
		}
	}
	// Después de las columnas: una restricción puede nombrar cualquiera.
	for _, def := range defs {
		if def != "" && isConstraint(def) {
			constraint(t, def)
		}
	}
	return t
}

// alter aplica una acción de ALTER TABLE.
func alter(t *table, action string) {
	if m := reAddCol.FindStringSubmatch(action); m != nil {
		t.cols = append(t.cols, parseColumn(m[1]))
		return
	}
	if m := reDropCol.FindStringSubmatch(action); m != nil {
		t.cols = slices.DeleteFunc(t.cols, func(c *column) bool { return c.name == m[1] })
		return
	}
	if m := reRenCol.FindStringSubmatch(action); m != nil {
		if c := t.col(m[1]); c != nil {
			c.name = m[2]
		}
		return
	}
	if m := reSetNN.FindStringSubmatch(action); m != nil {
		if c := t.col(m[1]); c != nil {
			c.notNull = true
		}
		return
	}
	if m := reDropNN.FindStringSubmatch(action); m != nil {
		if c := t.col(m[1]); c != nil {
			c.notNull = false
		}
		return
	}
	if m := reAddCons.FindStringSubmatch(action); m != nil {
		constraint(t, m[1])
	}
}

// mermaidType deja el tipo en una sola palabra válida para Mermaid:
// "NUMERIC(9,6)" → "numeric", "TEXT[]" → "text[]", "DOUBLE PRECISION" → "double_precision".
func mermaidType(t string) string {
	t = strings.ToLower(regexp.MustCompile(`\([^)]*\)`).ReplaceAllString(t, ""))
	return strings.ReplaceAll(strings.TrimSpace(t), " ", "_")
}

// Columnas de autoría ("creado por", "cerrado por"…): se listan en la entidad
// pero no se dibuja su línea a users, que llenaría cada diagrama.
func authorship(c *column) bool {
	return c.refTable == "users" && strings.HasSuffix(c.name, "_by")
}

// checkDomains exige que cada tabla esté en exactamente un dominio.
func checkDomains(tables map[string]*table, order []string) error {
	placed := map[string]bool{}
	for _, d := range domains {
		for _, n := range d.tables {
			if tables[n] == nil {
				return fmt.Errorf("el dominio %q nombra una tabla que no existe: %s", d.title, n)
			}
			if placed[n] {
				return fmt.Errorf("tabla en dos dominios: %s", n)
			}
			placed[n] = true
		}
	}
	var missing []string
	for _, n := range order {
		if tables[n] != nil && !placed[n] {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("tablas sin dominio (agregarlas a `domains` en cmd/er-docs): %s", strings.Join(missing, ", "))
	}
	return nil
}

func render(tables map[string]*table, order []string) (string, error) {
	if err := checkDomains(tables, order); err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("# Modelo de datos\n\n")
	b.WriteString("> Generado por `backend-go/cmd/er-docs` desde `backend-go/sql/schema/0001_init_schema.sql`, el esquema que usa sqlc, con todas las migraciones aplicadas. **No se edita a mano**: si cambia el esquema, se regenera con `go run ./cmd/er-docs` desde `backend-go/`.\n\n")
	fmt.Fprintf(&b, "%d tablas en PostgreSQL, agrupadas en %d dominios. Notación pata de gallo: `||` uno, `|o` / `o|` cero o uno, `o{` cero o muchos. La etiqueta de cada línea es la columna que hace la referencia.\n\n", len(tables), len(domains))
	b.WriteString("- Cada entidad muestra todas sus columnas salvo `created_at` y `updated_at`. `PK` clave primaria, `FK` referencia a otra tabla, `UK` valor único.\n")
	b.WriteString("- Las tablas de otros dominios aparecen como cajas sin columnas: son la misma tabla, dibujada donde se une.\n")
	b.WriteString("- Las columnas de autoría que apuntan a `users` (`created_by`, `closed_by`…) se listan pero no se dibujan, para que los diagramas se puedan leer.\n")
	b.WriteString("- Los tipos, restricciones e índices exactos están en el esquema.\n\n")
	b.WriteString("Correspondencia con el legacy (MongoDB): [modelo-er-legacy-2.0.md](modelo-er-legacy-2.0.md).\n\n")
	b.WriteString("## Índice\n\n")
	for i, d := range domains {
		fmt.Fprintf(&b, "%d. [%s](#%d-%s) — %d tablas\n", i+1, d.title, i+1, anchor(d.title), len(d.tables))
	}
	for i, d := range domains {
		fmt.Fprintf(&b, "\n---\n\n## %d. %s\n\n%s\n\n", i+1, d.title, d.intro)
		b.WriteString("```mermaid\nerDiagram\n")
		for _, n := range d.tables {
			writeEntity(&b, tables[n])
		}
		if rels := relations(d, tables); len(rels) > 0 {
			b.WriteString("\n" + strings.Join(rels, "\n") + "\n")
		}
		b.WriteString("```\n")
	}
	return b.String(), nil
}

func writeEntity(b *strings.Builder, t *table) {
	fmt.Fprintf(b, "    %s {\n", strings.ToUpper(t.name))
	for _, c := range t.cols {
		if c.name == "created_at" || c.name == "updated_at" {
			continue
		}
		var keys []string
		if c.pk {
			keys = append(keys, "PK")
		}
		if c.refTable != "" {
			keys = append(keys, "FK")
		}
		if c.unique && !c.pk {
			keys = append(keys, "UK")
		}
		line := fmt.Sprintf("        %s %s", mermaidType(c.typ), c.name)
		if len(keys) > 0 {
			line += " " + strings.Join(keys, ", ")
		}
		b.WriteString(line + "\n")
	}
	b.WriteString("    }\n")
}

// relations dibuja una línea por cada referencia de las tablas del dominio.
// Mermaid: el lado izquierdo es el padre (|| o |o) y el derecho el hijo
// (o{ muchos, o| a lo más uno).
func relations(d domain, tables map[string]*table) []string {
	var rels []string
	for _, n := range d.tables {
		t := tables[n]
		for _, c := range t.cols {
			if c.refTable == "" || authorship(c) {
				continue
			}
			parent := "||"
			if !c.notNull {
				parent = "|o"
			}
			child := "o{"
			if c.unique || (len(t.pkCols) == 1 && t.pkCols[0] == c.name) {
				child = "o|"
			}
			rels = append(rels, fmt.Sprintf("    %s %s--%s %s : \"%s\"", strings.ToUpper(c.refTable), parent, child, strings.ToUpper(n), c.name))
		}
	}
	sort.Strings(rels)
	return rels
}

// anchor reproduce el ancla que GitHub genera para un título.
func anchor(title string) string {
	s := strings.ToLower(title)
	s = regexp.MustCompile(`[^\p{L}\p{N} -]`).ReplaceAllString(s, "")
	return strings.ReplaceAll(s, " ", "-")
}
