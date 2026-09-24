// Package rotation contiene las reglas puras del motor de rotación unificado
// (spec/01-arquitectura.md sección "Unificación de los dos sistemas de
// turnos", spec/02-alcance-y-roadmap.md Fase 8, HU-4/HU-5): quién está de
// guardia ahora para un equipo, y cómo se arma/ordena la matriz semanal de
// dotación/teletrabajo. Sin DB ni HTTP — el handler arma estos structs desde
// Postgres y llama a estas funciones, mismo patrón que internal/escalation.
package rotation

import (
	"time"

	"github.com/google/uuid"
)

// Slot es la asignación regular de guardia de un team_member para una
// semana concreta del ciclo (rotation_slots).
type Slot struct {
	TeamMemberID uuid.UUID
	WeekStart    time.Time
	WeekEnd      time.Time
	IsPaused     bool
}

// Override reemplaza a un team_member durante una ventana concreta
// (rotation_overrides) sin borrar el slot regular — HU-5: licencia médica,
// vacaciones, etc. Si OriginalTeamMemberID es nil, el override aplica sin
// importar quién tenga el slot regular ese período (cobertura ad-hoc).
type Override struct {
	OriginalTeamMemberID    *uuid.UUID
	ReplacementTeamMemberID uuid.UUID
	Start                   time.Time
	End                     time.Time
}

// Via indica de dónde salió la resolución.
type Via string

const (
	ViaOverride Via = "override"
	ViaSlot     Via = "slot"
)

// Current es quién está de guardia ahora y desde/hasta cuándo (forma de
// GET /api/rotation-slots/current: {currentMember, since, until}).
type Current struct {
	TeamMemberID uuid.UUID
	Since        time.Time
	Until        time.Time
	Via          Via
}

// Resolve aplica la precedencia de HU-4: un override vigente gana siempre
// sobre el slot regular (mismo orden que el legacy ShiftOverride >
// ShiftAssignment, ver ../BitacoraSOC-legacy/backend/src/controllers/
// escalationController.js). Un slot pausado (HU-5) se ignora sin buscar
// reemplazo automático — pausar y dejar a alguien sin cubrir es una señal
// para el admin, no un bug que el sistema deba tapar solo; si corresponde
// cubrir el hueco, el admin carga un override. Sin nada vigente devuelve
// nil, nunca error: "nadie de turno ahora" es un estado válido de UI.
func Resolve(overrides []Override, slot *Slot, now time.Time) *Current {
	for _, o := range overrides {
		if now.Before(o.Start) || !now.Before(o.End) {
			continue
		}
		if o.OriginalTeamMemberID != nil && (slot == nil || *o.OriginalTeamMemberID != slot.TeamMemberID) {
			continue
		}
		return &Current{TeamMemberID: o.ReplacementTeamMemberID, Since: o.Start, Until: o.End, Via: ViaOverride}
	}
	if slot != nil && !slot.IsPaused && !now.Before(slot.WeekStart) && now.Before(slot.WeekEnd) {
		return &Current{TeamMemberID: slot.TeamMemberID, Since: slot.WeekStart, Until: slot.WeekEnd, Via: ViaSlot}
	}
	return nil
}
