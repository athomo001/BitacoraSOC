// Package ticketmail decide qué avisos por correo manda la Ticketera, a quién
// y con qué texto (spec/15-ticketera-avisos-correo.md). Es lógica pura: el
// handler junta los datos (ticket, correos de las personas, configuración) y
// guarda el resultado en la cola; el despachador lo envía.
package ticketmail

import (
	"slices"
	"strings"
)

// Eventos del equipo (spec/15 §4.2).
const (
	TeamCreated               = "team.created"
	TeamAssigned              = "team.assigned"
	TeamResolverAdded         = "team.resolver_added"
	TeamSLAResponseBreached   = "team.sla_response_breached"
	TeamSLAResolutionWarning  = "team.sla_resolution_warning"
	TeamSLAResolutionBreached = "team.sla_resolution_breached"
	TeamReopened              = "team.reopened"
	TeamPendingVendor         = "team.pending_vendor"
	TeamResolved              = "team.resolved"
	TeamMerged                = "team.merged"
	TeamClientChanged         = "team.client_changed"
)

// Eventos al cliente (spec/15 §4.3).
const (
	ClientOpened        = "client.opened"
	ClientComment       = "client.comment"
	ClientPendingVendor = "client.pending_vendor"
	ClientResumed       = "client.resumed"
	ClientResolved      = "client.resolved"
	ClientReopened      = "client.reopened"
	ClientClosed        = "client.closed"
)

// TeamEvents y ClientEvents, en el orden del panel.
var (
	TeamEvents = []string{TeamCreated, TeamAssigned, TeamResolverAdded, TeamSLAResponseBreached, TeamSLAResolutionWarning,
		TeamSLAResolutionBreached, TeamReopened, TeamPendingVendor, TeamResolved, TeamMerged, TeamClientChanged}
	ClientEvents = []string{ClientOpened, ClientComment, ClientPendingVendor, ClientResumed, ClientResolved, ClientReopened, ClientClosed}
)

// ValidEvent: un evento que el panel puede encender.
func ValidEvent(e string) bool {
	return slices.Contains(TeamEvents, e) || slices.Contains(ClientEvents, e)
}

// IsClient: el evento va al cliente (nunca lleva nada interno).
func IsClient(e string) bool { return strings.HasPrefix(e, "client.") }

// Reglas de "Afecta al cliente" por defecto (spec/15 §4.3).
const (
	AffectsP1P2      = "p1p2"
	AffectsIncidents = "incidents"
	AffectsNone      = "none"
)

// BatchOptions: ventanas para juntar comentarios al cliente (0 = sin agrupar).
var BatchOptions = []int{0, 5, 15, 30, 60}

// MaxBackupEmails: tope de la copia de respaldo.
const MaxBackupEmails = 20

// Settings es la parte de avisos de Administración → Ticketera.
type Settings struct {
	Enabled       bool
	TeamEnabled   bool
	ClientEnabled bool
	Events        []string
	Backup        []string
	SkipActor     bool
	TeamLink      bool
	IncludePin    bool
	BatchMinutes  int
	AffectsRule   string
	Signature     string
}

// On: el evento manda correo (maestro, grupo y evento encendidos).
func (s Settings) On(event string) bool {
	if !s.Enabled || !slices.Contains(s.Events, event) {
		return false
	}
	if IsClient(event) {
		return s.ClientEnabled
	}
	return s.TeamEnabled
}

// AffectsByDefault: si un ticket nuevo viene con "Afecta al cliente"
// marcado. Los requerimientos nunca.
func AffectsByDefault(rule, ticketType, priority string) bool {
	if ticketType != "incident" {
		return false
	}
	switch rule {
	case AffectsIncidents:
		return true
	case AffectsP1P2:
		return priority == "p1_critical" || priority == "p2_high"
	}
	return false
}

// Party son los correos de las personas de un ticket que pueden recibir un
// aviso del equipo. Target es la persona puntual del evento (el nuevo
// responsable, quien se sumó, los creadores al unir).
type Party struct {
	Responsible string
	Resolvers   []string
	Backup      []string
	Target      []string
	Actor       string
}

// TeamRecipients aplica la columna "A quién" de spec/15 §4.2: sin repetidos,
// sin vacíos y, si skipActor, sin quien hizo el cambio.
func TeamRecipients(event string, p Party, skipActor bool) []string {
	var list []string
	switch event {
	case TeamCreated, TeamPendingVendor, TeamResolved, TeamClientChanged:
		list = p.Backup
	case TeamAssigned, TeamResolverAdded:
		list = p.Target
	case TeamSLAResponseBreached:
		if strings.TrimSpace(p.Responsible) != "" {
			list = []string{p.Responsible}
		} else {
			list = p.Backup
		}
	case TeamSLAResolutionWarning, TeamReopened:
		list = append([]string{p.Responsible}, p.Resolvers...)
	case TeamSLAResolutionBreached:
		list = append(append([]string{p.Responsible}, p.Resolvers...), p.Backup...)
	case TeamMerged:
		list = append(append([]string{}, p.Target...), p.Responsible)
	}
	skip := ""
	if skipActor {
		skip = strings.ToLower(strings.TrimSpace(p.Actor))
	}
	return Unique(list, skip)
}

// Unique deja cada correo una sola vez (sin importar mayúsculas), sin vacíos
// y sin `skip`.
func Unique(list []string, skip string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, e := range list {
		e = strings.TrimSpace(e)
		k := strings.ToLower(e)
		if e == "" || seen[k] || (skip != "" && k == skip) {
			continue
		}
		seen[k] = true
		out = append(out, e)
	}
	return out
}

// RetryDelayMinutes: espera antes del intento n+1 (spec/15 §7: 1, 5 y 30 min).
func RetryDelayMinutes(attemptsSoFar int) int {
	switch attemptsSoFar {
	case 0:
		return 1
	case 1:
		return 5
	default:
		return 30
	}
}
