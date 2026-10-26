package complements

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// ManifestFile es el archivo con el que un complemento declara qué agrega a
// la app (spec/11 §12.2): en la raíz del ZIP o servido por el complemento
// servicio en <dirección>/complement.json. Sin él, el complemento es una
// pestaña en «Complementos», como siempre.
const ManifestFile = "complement.json"

// Manifest es complement.json ya validado.
type Manifest struct {
	Version   string         `json:"version,omitempty"`
	Pages     []Slot         `json:"pages,omitempty"`
	Panels    []Slot         `json:"panels,omitempty"`
	Actions   []Slot         `json:"actions,omitempty"`
	Topbar    *Slot          `json:"topbar,omitempty"`
	Settings  []SettingField `json:"settings,omitempty"`
	Events    []string       `json:"events,omitempty"`
	Schedules []Schedule     `json:"schedules,omitempty"`
	Data      []string       `json:"data,omitempty"`
}

// Slot es un lugar de la pantalla donde el complemento se muestra (siempre
// como iframe del origen aislado). Module solo en las páginas; Target en
// pestañas y acciones.
type Slot struct {
	ID     string `json:"id,omitempty"`
	Module string `json:"module,omitempty"`
	Target string `json:"target,omitempty"`
	Title  string `json:"title,omitempty"`
	Path   string `json:"path,omitempty"`
}

// SettingField es un campo de la configuración que arma la app. Los de tipo
// secret se guardan cifrados y nunca vuelven a la pantalla.
type SettingField struct {
	Key      string   `json:"key"`
	Label    string   `json:"label"`
	Type     string   `json:"type"`
	Help     string   `json:"help,omitempty"`
	Required bool     `json:"required,omitempty"`
	Options  []string `json:"options,omitempty"`
	Default  any      `json:"default,omitempty"`
}

// Schedule es una tarea programada: cada cierto tiempo (every) o a una hora
// (at, con días opcionales).
type Schedule struct {
	Name  string   `json:"name"`
	Title string   `json:"title,omitempty"`
	Every string   `json:"every,omitempty"`
	At    string   `json:"at,omitempty"`
	Days  []string `json:"days,omitempty"`
}

// Dónde puede ir cada cosa.
var (
	PageModules   = []string{"reports", "shifts", "tickets", "escalation", "admin"}
	PanelTargets  = []string{"entry", "ticket", "client", "asset"}
	ActionTargets = []string{"entry", "ticket"}
	SettingTypes  = []string{"text", "secret", "number", "boolean", "select"}
	// DataScopes son permisos de la API de integraciones (spec/19 §4).
	DataScopes = []string{"entries:read", "entries:write", "tickets:read", "tickets:write", "clients:read", "oncall:read"}
	// Events son los eventos de la cola de la 10b que un complemento puede recibir.
	Events = []string{
		"entry.created", "entry.comment_added", "entry.follow_up.closed",
		"ticket.created", "ticket.assigned", "ticket.updated", "ticket.comment_added", "ticket.sla_breached",
		"escalation.incident.opened", "escalation.incident.closed",
	}
	weekdays = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
)

var (
	slotIDRe     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,40}$`)
	settingKeyRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,40}$`)
	versionRe    = regexp.MustCompile(`^[0-9A-Za-z.+-]{1,32}$`)
	atRe         = regexp.MustCompile(`^([01][0-9]|2[0-3]):([0-5][0-9])$`)
)

const (
	maxSlots       = 20
	maxSettings    = 20
	minEvery       = 5 * time.Minute
	maxEvery       = 7 * 24 * time.Hour
	maxManifestLen = 64 << 10
)

// ParseManifest lee y valida complement.json. server dice si el complemento
// corre en un servicio: solo así puede recibir eventos y tareas programadas.
// Un rechazo es *ErrInvalid con el motivo en lenguaje claro.
func ParseManifest(raw []byte, server bool) (Manifest, error) {
	var m Manifest
	if len(raw) > maxManifestLen {
		return m, invalid("%s pesa más de 64 KB", ManifestFile)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return m, invalid("%s no se puede leer: %s", ManifestFile, strings.TrimPrefix(err.Error(), "json: "))
	}
	if m.Version != "" && !versionRe.MatchString(m.Version) {
		return m, invalid("la versión de %s usa letras, números, puntos y guiones (hasta 32)", ManifestFile)
	}
	if len(m.Pages)+len(m.Panels)+len(m.Actions) > maxSlots {
		return m, invalid("%s declara más de %d páginas, pestañas y acciones", ManifestFile, maxSlots)
	}
	if err := checkSlots("página", m.Pages, func(s Slot) string {
		return choose(s.Module, PageModules, "el módulo de la página %q es reports, shifts, tickets, escalation o admin", s.ID)
	}); err != nil {
		return m, err
	}
	if err := checkSlots("pestaña", m.Panels, func(s Slot) string {
		return choose(s.Target, PanelTargets, "la pestaña %q va en entry, ticket, client o asset", s.ID)
	}); err != nil {
		return m, err
	}
	if err := checkSlots("acción", m.Actions, func(s Slot) string {
		return choose(s.Target, ActionTargets, "la acción %q va en entry o ticket", s.ID)
	}); err != nil {
		return m, err
	}
	if m.Topbar != nil {
		if reason := checkPath(m.Topbar.Path); reason != "" {
			return m, invalid("la barra superior: %s", reason)
		}
	}
	if err := checkSettings(m.Settings); err != nil {
		return m, err
	}
	for _, d := range m.Data {
		if !slices.Contains(DataScopes, d) {
			return m, invalid("permiso de datos desconocido en %s: %s", ManifestFile, d)
		}
	}
	m.Data = dedupe(m.Data)
	if !server && (len(m.Events) > 0 || len(m.Schedules) > 0) {
		return m, invalid("un complemento en ZIP no recibe eventos ni tareas programadas: eso necesita un servicio")
	}
	for _, e := range m.Events {
		if !slices.Contains(Events, e) {
			return m, invalid("evento desconocido en %s: %s", ManifestFile, e)
		}
	}
	m.Events = dedupe(m.Events)
	names := map[string]bool{}
	for i, s := range m.Schedules {
		if !slotIDRe.MatchString(s.Name) || names[s.Name] {
			return m, invalid("cada tarea programada necesita un nombre propio en minúsculas, números y guiones")
		}
		names[s.Name] = true
		if len([]rune(s.Title)) > 80 {
			return m, invalid("el título de la tarea %q pasa de 80 caracteres", s.Name)
		}
		if _, err := NextRun(s, time.Now(), time.UTC); err != nil {
			return m, err
		}
		m.Schedules[i].Days = dedupe(s.Days)
	}
	return m, nil
}

func choose(v string, allowed []string, format string, a ...any) string {
	if slices.Contains(allowed, v) {
		return ""
	}
	return fmt.Sprintf(format, a...)
}

func checkSlots(what string, slots []Slot, place func(Slot) string) error {
	seen := map[string]bool{}
	for _, s := range slots {
		if !slotIDRe.MatchString(s.ID) || seen[s.ID] {
			return invalid("cada %s necesita un id propio en minúsculas, números y guiones", what)
		}
		seen[s.ID] = true
		if t := strings.TrimSpace(s.Title); t == "" || len([]rune(t)) > 60 {
			return invalid("la %s %q necesita un título de hasta 60 caracteres", what, s.ID)
		}
		if reason := place(s); reason != "" {
			return invalid("%s", reason)
		}
		if reason := checkPath(s.Path); reason != "" {
			return invalid("la %s %q: %s", what, s.ID, reason)
		}
	}
	return nil
}

// checkPath: la ruta es relativa a la carpeta del complemento (vacía = su
// archivo de entrada), sin salir de ella.
func checkPath(p string) string {
	if p == "" {
		return ""
	}
	if len(p) > 200 || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || strings.Contains(p, "://") {
		return "la ruta es relativa a la carpeta del complemento (hasta 200 caracteres)"
	}
	for _, seg := range strings.Split(strings.SplitN(p, "?", 2)[0], "/") {
		if seg == ".." {
			return "la ruta no puede salir de la carpeta del complemento"
		}
	}
	return ""
}

func checkSettings(fields []SettingField) error {
	if len(fields) > maxSettings {
		return invalid("la configuración admite hasta %d campos", maxSettings)
	}
	seen := map[string]bool{}
	for _, f := range fields {
		if !settingKeyRe.MatchString(f.Key) || seen[f.Key] {
			return invalid("cada campo de la configuración necesita una clave propia (letras, números y _)")
		}
		seen[f.Key] = true
		if l := strings.TrimSpace(f.Label); l == "" || len([]rune(l)) > 80 || len([]rune(f.Help)) > 300 {
			return invalid("el campo %q necesita un nombre de hasta 80 caracteres (y una ayuda de hasta 300)", f.Key)
		}
		if !slices.Contains(SettingTypes, f.Type) {
			return invalid("el campo %q es text, secret, number, boolean o select", f.Key)
		}
		if f.Type == "select" && (len(f.Options) == 0 || len(f.Options) > 30) {
			return invalid("el campo %q necesita entre 1 y 30 opciones", f.Key)
		}
		if f.Type == "secret" && f.Default != nil {
			return invalid("el campo secreto %q no puede traer un valor por defecto", f.Key)
		}
	}
	return nil
}

func dedupe(in []string) []string {
	out := []string{}
	for _, v := range in {
		if !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

// ===== Lo que el admin aprueba =====

// Item es una cosa que el complemento agrega y el admin aprueba una por una.
// Key es estable entre versiones: lo aprobado sigue aprobado si la versión
// nueva lo vuelve a declarar.
type Item struct {
	Key   string `json:"key"`
	Kind  string `json:"kind"` // page | panel | action | topbar | settings | event | schedule | data
	House bool   `json:"house"`
}

// Items lista lo que el admin tiene que revisar. La barra superior y las
// páginas en Administración son solo para complementos «de la casa»
// (decisión del dueño, 2026-10-26).
func (m Manifest) Items() []Item {
	var out []Item
	for _, p := range m.Pages {
		out = append(out, Item{Key: "page:" + p.ID, Kind: "page", House: p.Module == "admin"})
	}
	for _, p := range m.Panels {
		out = append(out, Item{Key: "panel:" + p.ID, Kind: "panel"})
	}
	for _, a := range m.Actions {
		out = append(out, Item{Key: "action:" + a.ID, Kind: "action"})
	}
	if m.Topbar != nil {
		out = append(out, Item{Key: "topbar", Kind: "topbar", House: true})
	}
	if len(m.Settings) > 0 {
		out = append(out, Item{Key: "settings", Kind: "settings"})
	}
	for _, e := range m.Events {
		out = append(out, Item{Key: "event:" + e, Kind: "event"})
	}
	for _, s := range m.Schedules {
		out = append(out, Item{Key: "schedule:" + s.Name, Kind: "schedule"})
	}
	for _, d := range m.Data {
		out = append(out, Item{Key: "data:" + d, Kind: "data"})
	}
	return out
}

// Effective es lo aprobado que vale hoy: lo que sigue declarado y, si pide
// «de la casa», solo si el complemento lo es.
func (m Manifest) Effective(approved []string, house bool) map[string]bool {
	out := map[string]bool{}
	for _, it := range m.Items() {
		if slices.Contains(approved, it.Key) && (!it.House || house) {
			out[it.Key] = true
		}
	}
	return out
}

// ApprovedData son los permisos de datos aprobados, en el orden de DataScopes.
func (m Manifest) ApprovedData(eff map[string]bool) []string {
	out := []string{}
	for _, d := range DataScopes {
		if eff["data:"+d] {
			out = append(out, d)
		}
	}
	return out
}

// ApprovedEvents son los eventos aprobados.
func (m Manifest) ApprovedEvents(eff map[string]bool) []string {
	out := []string{}
	for _, e := range m.Events {
		if eff["event:"+e] {
			out = append(out, e)
		}
	}
	return out
}

// ===== Tareas programadas =====

// NextRun calcula la próxima vez después de from, en la zona horaria de la
// instalación.
func NextRun(s Schedule, from time.Time, loc *time.Location) (time.Time, error) {
	switch {
	case s.Every != "" && s.At == "" && len(s.Days) == 0:
		d, err := parseEvery(s.Every)
		if err != nil {
			return time.Time{}, invalid("la tarea %q: %s", s.Name, err.Error())
		}
		return from.Add(d), nil
	case s.At != "" && s.Every == "":
		m := atRe.FindStringSubmatch(s.At)
		if m == nil {
			return time.Time{}, invalid("la tarea %q: la hora va como HH:MM (por ejemplo 08:00)", s.Name)
		}
		for _, d := range s.Days {
			if !slices.Contains(weekdays, d) {
				return time.Time{}, invalid("la tarea %q: los días van como mon, tue, wed, thu, fri, sat o sun", s.Name)
			}
		}
		hh, _ := strconv.Atoi(m[1])
		mm, _ := strconv.Atoi(m[2])
		local := from.In(loc)
		for i := 0; i <= 7; i++ {
			day := local.AddDate(0, 0, i)
			at := time.Date(day.Year(), day.Month(), day.Day(), hh, mm, 0, 0, loc)
			if !at.After(from) {
				continue
			}
			if len(s.Days) == 0 || slices.Contains(s.Days, weekdays[at.Weekday()]) {
				return at, nil
			}
		}
		return time.Time{}, invalid("la tarea %q no tiene ningún día válido", s.Name)
	}
	return time.Time{}, invalid("la tarea %q lleva every (por ejemplo «6h») o at con days, no los dos", s.Name)
}

// parseEvery acepta «15m», «6h», «1d» (también lo de time.ParseDuration).
func parseEvery(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	var d time.Duration
	if n, ok := strings.CutSuffix(s, "d"); ok {
		days, err := strconv.Atoi(n)
		if err != nil {
			return 0, fmt.Errorf("every va como 15m, 6h o 1d")
		}
		d = time.Duration(days) * 24 * time.Hour
	} else {
		var err error
		if d, err = time.ParseDuration(s); err != nil {
			return 0, fmt.Errorf("every va como 15m, 6h o 1d")
		}
	}
	if d < minEvery || d > maxEvery {
		return 0, fmt.Errorf("every va de 5 minutos a 7 días")
	}
	return d, nil
}
