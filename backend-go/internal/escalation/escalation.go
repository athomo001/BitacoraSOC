// Package escalation contiene las reglas puras del motor de escalación
// unificado SOC/NOC (spec/01-arquitectura.md sección 4, docs/adr/0004,
// HU-1/1t/1u/1z/2/3/3b): qué política aplica, qué pasos salen de una
// cobertura territorial, a quién se avisa en cada modo, y a quién se llama
// después de un intento fallido. Sin DB ni HTTP — el handler arma estos
// structs desde Postgres y llama a estas funciones.
package escalation

import (
	"sort"
	"time"

	"github.com/google/uuid"
)

// Via es de dónde salió la resolución (campo resolvedVia de la API).
type Via string

const (
	ViaService         Via = "service"
	ViaAsset           Via = "asset"
	ViaTerritorialUnit Via = "territorial_unit"
	ViaTeamCoverage    Via = "team_coverage"
)

// Mode refleja el ENUM escalation_mode.
type Mode string

const (
	ModeUnique     Mode = "unique"     // un solo destinatario: el principal del equipo
	ModePool       Mode = "pool"       // todos los miembros a la vez
	ModeSequential Mode = "sequential" // miembros uno tras otro dentro del mismo paso
)

// Result refleja el ENUM contact_attempt_result.
type Result string

const (
	ResultAnswered          Result = "answered"
	ResultNoAnswer          Result = "no_answer"
	ResultBusy              Result = "busy"
	ResultUnreachable       Result = "unreachable"
	ResultEscalatedNextTier Result = "escalated_next_tier"
)

// ValidResult dice si r es un valor del ENUM.
func ValidResult(r string) bool {
	switch Result(r) {
	case ResultAnswered, ResultNoAnswer, ResultBusy, ResultUnreachable, ResultEscalatedNextTier:
		return true
	}
	return false
}

// Role refleja el ENUM team_role.
type Role string

const (
	RolePrimary Role = "primary"
	RoleBackup  Role = "backup"
	RoleLead    Role = "lead"
)

// CoverageTeam es un equipo que cubre una unidad territorial.
type CoverageTeam struct {
	TeamID   uuid.UUID
	Priority int32
}

// Level es una unidad territorial del camino desde la unidad del activo
// hacia la raíz, con lo que haya configurado en ella.
type Level struct {
	UnitID   uuid.UUID
	PolicyID *uuid.UUID
	Coverage []CoverageTeam
}

// Choice es la fuente de la resolución elegida.
type Choice struct {
	Via      Via
	PolicyID *uuid.UUID
	UnitID   *uuid.UUID
	Coverage []CoverageTeam
}

// Choose aplica la precedencia de resolución territorial (HU-1 y el caso
// Calama de spec/01): la política del activo gana siempre; si no hay, se sube
// por el árbol desde la unidad del activo (levels viene de lo más específico
// a lo menos) y gana el primer nivel con algo configurado. Dentro de un
// mismo nivel, una política explícita gana a la cobertura de equipos. Sin
// nada aplicable devuelve ok=false: la API responde 404 — un NOC sin saber a
// quién avisar tiene que ser ruidoso, no una lista vacía.
func Choose(assetPolicy *uuid.UUID, levels []Level) (Choice, bool) {
	if assetPolicy != nil {
		return Choice{Via: ViaAsset, PolicyID: assetPolicy}, true
	}
	for _, l := range levels {
		unit := l.UnitID
		if l.PolicyID != nil {
			return Choice{Via: ViaTerritorialUnit, PolicyID: l.PolicyID, UnitID: &unit}, true
		}
		if len(l.Coverage) > 0 {
			return Choice{Via: ViaTeamCoverage, UnitID: &unit, Coverage: l.Coverage}, true
		}
	}
	return Choice{}, false
}

// Step es un paso de escalación ya resuelto.
type Step struct {
	Order       int32
	TeamID      uuid.UUID
	Mode        Mode
	WaitMinutes int32
	Members     []Member
}

// CoverageSteps convierte los equipos que cubren una unidad en pasos: uno
// por equipo, ordenados por prioridad (menor = se avisa primero, HU-3), en
// modo pool (la cuadrilla completa a la vez) y sin espera configurada.
func CoverageSteps(teams []CoverageTeam) []Step {
	sorted := append([]CoverageTeam(nil), teams...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Priority < sorted[j].Priority })
	steps := make([]Step, 0, len(sorted))
	for i, t := range sorted {
		steps = append(steps, Step{Order: int32(i + 1), TeamID: t.TeamID, Mode: ModePool})
	}
	return steps
}

// Member es un miembro de equipo (usuario interno o contacto del directorio).
type Member struct {
	ID       uuid.UUID
	Name     string
	Role     Role
	Priority int32
}

func roleRank(r Role) int {
	switch r {
	case RolePrimary:
		return 0
	case RoleLead:
		return 1
	}
	return 2 // backup al final
}

// OrderMembers ordena para llamar: principales primero, después líder y
// respaldo; dentro de cada rol, por prioridad ascendente.
func OrderMembers(members []Member) []Member {
	out := append([]Member(nil), members...)
	sort.SliceStable(out, func(i, j int) bool {
		if ri, rj := roleRank(out[i].Role), roleRank(out[j].Role); ri != rj {
			return ri < rj
		}
		return out[i].Priority < out[j].Priority
	})
	return out
}

// Recipients decide a quién avisa un paso (HU-3b): pool = todo el equipo a
// la vez; unique/sequential = solo el primero en el orden de llamada.
func Recipients(mode Mode, members []Member) []Member {
	ordered := OrderMembers(members)
	if mode == ModePool || len(ordered) == 0 {
		return ordered
	}
	return ordered[:1]
}

// NextAction es lo que corresponde hacer después de registrar un intento.
type NextAction struct {
	EscalatedToNextStep bool
	NextStepOrder       int32
	NextMember          *Member // siguiente a llamar dentro del mismo paso (sequential)
	Exhausted           bool    // no queda nadie a quién escalar
}

// Next calcula el siguiente paso tras un intento (HU-1t). Si contestaron, no
// se escala. En modo sequential se prueba antes al siguiente miembro no
// intentado del mismo paso; agotado el paso (o en unique/pool, o si el
// operador marcó escalated_next_tier) se pasa al paso siguiente. En el
// último paso sin respuesta, Exhausted.
func Next(steps []Step, currentOrder int32, tried []uuid.UUID, result Result) NextAction {
	if result == ResultAnswered {
		return NextAction{}
	}
	var current *Step
	for i := range steps {
		if steps[i].Order == currentOrder {
			current = &steps[i]
		}
	}
	if current != nil && current.Mode == ModeSequential && result != ResultEscalatedNextTier {
		triedSet := map[uuid.UUID]bool{}
		for _, id := range tried {
			triedSet[id] = true
		}
		for _, m := range OrderMembers(current.Members) {
			if !triedSet[m.ID] {
				member := m
				return NextAction{NextMember: &member}
			}
		}
	}
	var next *Step
	for i := range steps {
		if steps[i].Order > currentOrder && (next == nil || steps[i].Order < next.Order) {
			next = &steps[i]
		}
	}
	if next == nil {
		return NextAction{Exhausted: true}
	}
	return NextAction{EscalatedToNextStep: true, NextStepOrder: next.Order}
}

// Window es una ventana de mantenimiento candidata para un scope.
type Window struct {
	ID       uuid.UUID
	Title    string
	StartsAt time.Time
	EndsAt   time.Time
	Suppress bool
	Priority int32
}

// ActiveWindow devuelve la ventana que aplica ahora, o nil. Si alguna activa
// suprime avisos, gana esa (no se despacha el correo); si solo hay
// informativas, se devuelve una para anotarla en el cuerpo del correo.
// Desempate por prioridad ascendente (idea del legacy ClientEscalationRule).
func ActiveWindow(windows []Window, now time.Time) *Window {
	var best *Window
	for i := range windows {
		w := windows[i]
		if now.Before(w.StartsAt) || !now.Before(w.EndsAt) {
			continue
		}
		switch {
		case best == nil:
			best = &windows[i]
		case w.Suppress && !best.Suppress:
			best = &windows[i]
		case w.Suppress == best.Suppress && w.Priority < best.Priority:
			best = &windows[i]
		}
	}
	return best
}
