package rotation

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func at(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return ts
}

func TestResolve_SlotWinsWhenNoOverride(t *testing.T) {
	member := uuid.New()
	slot := &Slot{TeamMemberID: member, WeekStart: at(t, "2026-09-21T00:00:00Z"), WeekEnd: at(t, "2026-09-28T00:00:00Z")}
	now := at(t, "2026-09-23T12:00:00Z")

	got := Resolve(nil, slot, now)
	if got == nil {
		t.Fatal("esperaba resolución por slot, obtuve nil")
	}
	if got.TeamMemberID != member || got.Via != ViaSlot {
		t.Fatalf("resolución inesperada: %+v", got)
	}
}

func TestResolve_OverrideWinsOverSlot(t *testing.T) {
	regular := uuid.New()
	replacement := uuid.New()
	slot := &Slot{TeamMemberID: regular, WeekStart: at(t, "2026-09-21T00:00:00Z"), WeekEnd: at(t, "2026-09-28T00:00:00Z")}
	override := Override{
		OriginalTeamMemberID:    &regular,
		ReplacementTeamMemberID: replacement,
		Start:                   at(t, "2026-09-23T00:00:00Z"),
		End:                     at(t, "2026-09-25T00:00:00Z"),
	}
	now := at(t, "2026-09-23T12:00:00Z")

	got := Resolve([]Override{override}, slot, now)
	if got == nil || got.TeamMemberID != replacement || got.Via != ViaOverride {
		t.Fatalf("esperaba que el override reemplazara al slot regular, obtuve %+v", got)
	}
}

func TestResolve_OverrideWithoutOriginalAppliesRegardlessOfSlot(t *testing.T) {
	replacement := uuid.New()
	override := Override{
		ReplacementTeamMemberID: replacement,
		Start:                   at(t, "2026-09-23T00:00:00Z"),
		End:                     at(t, "2026-09-25T00:00:00Z"),
	}
	now := at(t, "2026-09-23T12:00:00Z")

	// Cobertura ad-hoc: sin OriginalTeamMemberID, aplica aunque no haya
	// slot regular vigente ese período.
	got := Resolve([]Override{override}, nil, now)
	if got == nil || got.TeamMemberID != replacement {
		t.Fatalf("esperaba que el override ad-hoc aplicara sin slot regular, obtuve %+v", got)
	}
}

func TestResolve_OverrideForDifferentOriginalDoesNotApply(t *testing.T) {
	regular := uuid.New()
	other := uuid.New()
	replacement := uuid.New()
	slot := &Slot{TeamMemberID: regular, WeekStart: at(t, "2026-09-21T00:00:00Z"), WeekEnd: at(t, "2026-09-28T00:00:00Z")}
	override := Override{
		OriginalTeamMemberID:    &other, // reemplaza a otra persona, no a la del slot vigente
		ReplacementTeamMemberID: replacement,
		Start:                   at(t, "2026-09-23T00:00:00Z"),
		End:                     at(t, "2026-09-25T00:00:00Z"),
	}
	now := at(t, "2026-09-23T12:00:00Z")

	got := Resolve([]Override{override}, slot, now)
	if got == nil || got.TeamMemberID != regular || got.Via != ViaSlot {
		t.Fatalf("el override no debía aplicar, esperaba el slot regular, obtuve %+v", got)
	}
}

func TestResolve_PausedSlotIsIgnoredWithoutOverride(t *testing.T) {
	member := uuid.New()
	slot := &Slot{TeamMemberID: member, WeekStart: at(t, "2026-09-21T00:00:00Z"), WeekEnd: at(t, "2026-09-28T00:00:00Z"), IsPaused: true}
	now := at(t, "2026-09-23T12:00:00Z")

	// HU-5: pausar sin cargar un override deja "nadie de turno" — estado
	// válido, no un error ni un reemplazo automático inventado.
	got := Resolve(nil, slot, now)
	if got != nil {
		t.Fatalf("esperaba nil (slot pausado sin cobertura), obtuve %+v", got)
	}
}

func TestResolve_NothingVigenteReturnsNil(t *testing.T) {
	now := at(t, "2026-09-23T12:00:00Z")
	if got := Resolve(nil, nil, now); got != nil {
		t.Fatalf("esperaba nil sin slot ni overrides, obtuve %+v", got)
	}

	member := uuid.New()
	slot := &Slot{TeamMemberID: member, WeekStart: at(t, "2026-09-07T00:00:00Z"), WeekEnd: at(t, "2026-09-14T00:00:00Z")}
	if got := Resolve(nil, slot, now); got != nil {
		t.Fatalf("esperaba nil (semana ya pasada), obtuve %+v", got)
	}
}

func TestResolve_OverrideBoundariesAreHalfOpen(t *testing.T) {
	member := uuid.New()
	override := Override{
		ReplacementTeamMemberID: member,
		Start:                   at(t, "2026-09-23T00:00:00Z"),
		End:                     at(t, "2026-09-25T00:00:00Z"),
	}
	// Exactamente en el borde de End: ya no vigente (mismo criterio que
	// escalation.ActiveWindow: [Start, End)).
	if got := Resolve([]Override{override}, nil, override.End); got != nil {
		t.Fatalf("esperaba nil justo en End, obtuve %+v", got)
	}
	// Exactamente en Start: sí vigente.
	if got := Resolve([]Override{override}, nil, override.Start); got == nil {
		t.Fatal("esperaba resolución justo en Start")
	}
}
