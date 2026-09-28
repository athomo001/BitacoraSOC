// Package tickets tiene las reglas puras de la ticketera ITIL (Fase 10):
// qué transiciones de estado existen, cómo se calcula la prioridad y cómo
// corre el reloj de SLA con pausas por espera de proveedor. Sin base de
// datos ni HTTP, para que las mismas reglas las use el handler, las pruebe
// un test y las refleje la pantalla sin ambigüedad.
package tickets

import "time"

type Status string

const (
	New           Status = "new"
	Assigned      Status = "assigned"
	InProgress    Status = "in_progress"
	PendingVendor Status = "pending_vendor"
	Resolved      Status = "resolved"
	Closed        Status = "closed"
	Cancelled     Status = "cancelled"
)

// transitions: desde cada estado, a cuáles se puede pasar. Antes el backend
// aceptaba cualquier salto (new → closed, revivir un cancelado).
var transitions = map[Status][]Status{
	New:           {Assigned, Cancelled},
	Assigned:      {InProgress, Cancelled},
	InProgress:    {PendingVendor, Resolved},
	PendingVendor: {InProgress},
	Resolved:      {Closed, InProgress},
	Closed:        {InProgress},
	Cancelled:     {},
}

func Transitions(from Status) []Status {
	return append([]Status(nil), transitions[from]...)
}

func CanTransition(from, to Status) bool {
	for _, candidate := range transitions[from] {
		if candidate == to {
			return true
		}
	}
	return false
}

// IsReopen: volver a "en curso" desde resuelto o cerrado cuenta como reapertura.
func IsReopen(from, to Status) bool {
	return to == InProgress && (from == Resolved || from == Closed)
}

func IsOpen(s Status) bool {
	return s != Resolved && s != Closed && s != Cancelled
}

// Priority aplica la matriz impacto × urgencia de ITIL.
func Priority(impact, urgency string) string {
	switch {
	case impact == "high" && (urgency == "high" || urgency == "critical"):
		return "p1_critical"
	case impact == "high" || urgency == "critical":
		return "p2_high"
	case impact == "medium" || urgency == "medium":
		return "p3_medium"
	default:
		return "p4_low"
	}
}

// ClockState es lo que la pantalla pinta con el semáforo.
type ClockState string

const (
	OnTime   ClockState = "on_time"
	AtRisk   ClockState = "at_risk"
	Breached ClockState = "breached"
	Paused   ClockState = "paused"
	Met      ClockState = "met"
)

// atRiskPercent: desde qué porcentaje consumido un SLA se marca en riesgo.
const atRiskPercent = 75

type SLAInput struct {
	Status           Status
	CreatedAt        time.Time
	ResponseDueAt    time.Time
	ResolutionDueAt  time.Time
	PausedSeconds    int64
	OnHoldSince      *time.Time
	FirstRespondedAt *time.Time
	ResolvedAt       *time.Time
}

type Clock struct {
	State            ClockState `json:"state"`
	DueAt            time.Time  `json:"dueAt"`
	Percent          int        `json:"percent"`
	RemainingSeconds int64      `json:"remainingSeconds"`
	ElapsedSeconds   int64      `json:"elapsedSeconds"`
	PausedForSeconds int64      `json:"pausedForSeconds,omitempty"`
}

// ResolutionClock: el vencimiento real es el pactado más todo el tiempo en
// pausa (anterior y en curso). Mientras está en pausa el reloj no avanza.
func ResolutionClock(in SLAInput, now time.Time) Clock {
	paused := time.Duration(in.PausedSeconds) * time.Second
	var pausedNow time.Duration
	if in.OnHoldSince != nil && now.After(*in.OnHoldSince) {
		pausedNow = now.Sub(*in.OnHoldSince)
	}
	due := in.ResolutionDueAt.Add(paused + pausedNow)
	total := in.ResolutionDueAt.Sub(in.CreatedAt)
	reference := now
	if in.ResolvedAt != nil {
		reference = *in.ResolvedAt
	}
	elapsed := reference.Sub(in.CreatedAt) - paused - pausedNow
	c := Clock{DueAt: due, ElapsedSeconds: seconds(elapsed), RemainingSeconds: seconds(due.Sub(reference)), Percent: percent(elapsed, total)}
	switch {
	case in.ResolvedAt != nil && !in.ResolvedAt.After(due):
		c.State = Met
	case reference.After(due):
		c.State = Breached
	case pausedNow > 0:
		c.State = Paused
		c.PausedForSeconds = seconds(pausedNow)
	case c.Percent >= atRiskPercent:
		c.State = AtRisk
	default:
		c.State = OnTime
	}
	return c
}

// ResponseClock: se cumple con la primera acción del equipo (cambio de
// estado o comentario). La pausa no aplica: responder no depende del proveedor.
func ResponseClock(in SLAInput, now time.Time) Clock {
	total := in.ResponseDueAt.Sub(in.CreatedAt)
	reference := now
	if in.FirstRespondedAt != nil {
		reference = *in.FirstRespondedAt
	}
	elapsed := reference.Sub(in.CreatedAt)
	c := Clock{DueAt: in.ResponseDueAt, ElapsedSeconds: seconds(elapsed), RemainingSeconds: seconds(in.ResponseDueAt.Sub(reference)), Percent: percent(elapsed, total)}
	switch {
	case in.FirstRespondedAt != nil && !in.FirstRespondedAt.After(in.ResponseDueAt):
		c.State = Met
	case reference.After(in.ResponseDueAt):
		c.State = Breached
	case c.Percent >= atRiskPercent:
		c.State = AtRisk
	default:
		c.State = OnTime
	}
	return c
}

func seconds(d time.Duration) int64 { return int64(d / time.Second) }

func percent(elapsed, total time.Duration) int {
	if total <= 0 {
		return 100
	}
	p := int(elapsed * 100 / total)
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}
