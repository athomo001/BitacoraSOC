package escalation

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func ids(n int) []uuid.UUID {
	out := make([]uuid.UUID, n)
	for i := range out {
		out[i] = uuid.New()
	}
	return out
}

func TestChoose_AssetPolicyWins(t *testing.T) {
	// Caso Calama: el router 3 tiene su propia política y la zona tiene otra.
	u := ids(3)
	assetPolicy, zonePolicy := uuid.New(), uuid.New()
	levels := []Level{{UnitID: u[0], PolicyID: &zonePolicy}}
	got, ok := Choose(&assetPolicy, levels)
	if !ok || got.Via != ViaAsset || *got.PolicyID != assetPolicy {
		t.Fatalf("got %+v, want política del activo", got)
	}
}

func TestChoose_FallsBackToMostSpecificUnitPolicy(t *testing.T) {
	u := ids(3) // Calama (zona), Antofagasta (región), Chile (país) — de lo más específico a lo menos
	regionPolicy, countryPolicy := uuid.New(), uuid.New()
	levels := []Level{{UnitID: u[0]}, {UnitID: u[1], PolicyID: &regionPolicy}, {UnitID: u[2], PolicyID: &countryPolicy}}
	got, ok := Choose(nil, levels)
	if !ok || got.Via != ViaTerritorialUnit || *got.PolicyID != regionPolicy || *got.UnitID != u[1] {
		t.Fatalf("got %+v, want política de la región (la más específica)", got)
	}
}

func TestChoose_CoverageOnDeeperUnitBeatsPolicyHigherUp(t *testing.T) {
	// La especificidad manda: una cuadrilla que cubre Calama gana a la política
	// general de la región.
	u := ids(2)
	regionPolicy := uuid.New()
	team := uuid.New()
	levels := []Level{{UnitID: u[0], Coverage: []CoverageTeam{{TeamID: team, Priority: 0}}}, {UnitID: u[1], PolicyID: &regionPolicy}}
	got, ok := Choose(nil, levels)
	if !ok || got.Via != ViaTeamCoverage || *got.UnitID != u[0] {
		t.Fatalf("got %+v, want cobertura de Calama", got)
	}
}

func TestChoose_PolicyBeatsCoverageOnSameLevel(t *testing.T) {
	u := ids(1)
	policy := uuid.New()
	levels := []Level{{UnitID: u[0], PolicyID: &policy, Coverage: []CoverageTeam{{TeamID: uuid.New()}}}}
	got, _ := Choose(nil, levels)
	if got.Via != ViaTerritorialUnit {
		t.Fatalf("en el mismo nivel la política explícita debe ganar a la cobertura, got %s", got.Via)
	}
}

func TestChoose_NothingApplies(t *testing.T) {
	if _, ok := Choose(nil, []Level{{UnitID: uuid.New()}}); ok {
		t.Fatal("sin política ni cobertura debe fallar ruidosamente (404), no devolver algo vacío")
	}
}

func TestCoverageSteps_OrderedByPriority(t *testing.T) {
	// HU-3: dos equipos cubren la misma unidad → ambos, menor priority primero.
	backup, primary := uuid.New(), uuid.New()
	steps := CoverageSteps([]CoverageTeam{{TeamID: backup, Priority: 5}, {TeamID: primary, Priority: 1}})
	if len(steps) != 2 || steps[0].TeamID != primary || steps[0].Order != 1 || steps[1].Order != 2 || steps[0].Mode != ModePool {
		t.Fatalf("steps = %+v", steps)
	}
}

func members() []Member {
	return []Member{
		{ID: uuid.New(), Name: "Respaldo", Role: RoleBackup, Priority: 0},
		{ID: uuid.New(), Name: "Técnico B", Role: RolePrimary, Priority: 2},
		{ID: uuid.New(), Name: "Técnico A", Role: RolePrimary, Priority: 1},
	}
}

func TestOrderMembers(t *testing.T) {
	got := OrderMembers(members())
	if got[0].Name != "Técnico A" || got[1].Name != "Técnico B" || got[2].Name != "Respaldo" {
		t.Fatalf("orden = %s, %s, %s (principales primero, luego por prioridad)", got[0].Name, got[1].Name, got[2].Name)
	}
}

func TestRecipients_ByMode(t *testing.T) {
	if r := Recipients(ModePool, members()); len(r) != 3 {
		t.Fatalf("pool avisa a todos, got %d", len(r))
	}
	for _, mode := range []Mode{ModeUnique, ModeSequential} {
		r := Recipients(mode, members())
		if len(r) != 1 || r[0].Name != "Técnico A" {
			t.Fatalf("%s avisa solo al principal, got %+v", mode, r)
		}
	}
	if r := Recipients(ModeUnique, nil); len(r) != 0 {
		t.Fatal("sin miembros no hay destinatarios")
	}
}

func steps3() []Step {
	return []Step{
		{Order: 1, Mode: ModeSequential, Members: members()},
		{Order: 2, Mode: ModeUnique, Members: []Member{{ID: uuid.New(), Name: "Supervisor", Role: RolePrimary}}},
		{Order: 3, Mode: ModePool, Members: []Member{{ID: uuid.New(), Name: "Jefatura", Role: RoleLead}}},
	}
}

func TestNext_AnsweredStops(t *testing.T) {
	n := Next(steps3(), 1, nil, ResultAnswered)
	if n.EscalatedToNextStep || n.NextMember != nil || n.Exhausted {
		t.Fatalf("si contestó no se escala: %+v", n)
	}
}

func TestNext_SequentialTriesNextMemberOfSameStepFirst(t *testing.T) {
	s := steps3()
	ordered := OrderMembers(s[0].Members)
	n := Next(s, 1, []uuid.UUID{ordered[0].ID}, ResultNoAnswer)
	if n.EscalatedToNextStep || n.NextMember == nil || n.NextMember.ID != ordered[1].ID {
		t.Fatalf("sequential: primero el siguiente del mismo paso, got %+v", n)
	}
}

func TestNext_EscalatesWhenStepExhausted(t *testing.T) {
	s := steps3()
	all := []uuid.UUID{}
	for _, m := range s[0].Members {
		all = append(all, m.ID)
	}
	n := Next(s, 1, all, ResultBusy)
	if !n.EscalatedToNextStep || n.NextStepOrder != 2 {
		t.Fatalf("agotado el paso 1 se pasa al 2, got %+v", n)
	}
}

func TestNext_UniqueEscalatesImmediately(t *testing.T) {
	n := Next(steps3(), 2, nil, ResultUnreachable)
	if !n.EscalatedToNextStep || n.NextStepOrder != 3 {
		t.Fatalf("unique no tiene a quién más llamar en su paso, got %+v", n)
	}
}

func TestNext_LastStepExhausted(t *testing.T) {
	n := Next(steps3(), 3, nil, ResultNoAnswer)
	if n.EscalatedToNextStep || !n.Exhausted {
		t.Fatalf("en el último paso sin respuesta no hay a dónde escalar, got %+v", n)
	}
}

func TestNext_ExplicitEscalationSkipsRemainingMembers(t *testing.T) {
	n := Next(steps3(), 1, nil, ResultEscalatedNextTier)
	if !n.EscalatedToNextStep || n.NextStepOrder != 2 {
		t.Fatalf("escalated_next_tier salta directo al paso siguiente, got %+v", n)
	}
}

func TestActiveWindow(t *testing.T) {
	now := time.Date(2026, 9, 23, 3, 0, 0, 0, time.UTC)
	past := Window{ID: uuid.New(), StartsAt: now.Add(-3 * time.Hour), EndsAt: now.Add(-time.Hour), Suppress: true, Priority: 1}
	info := Window{ID: uuid.New(), StartsAt: now.Add(-time.Hour), EndsAt: now.Add(time.Hour), Suppress: false, Priority: 1}
	suppress := Window{ID: uuid.New(), StartsAt: now.Add(-time.Hour), EndsAt: now.Add(time.Hour), Suppress: true, Priority: 50}

	if w := ActiveWindow([]Window{past}, now); w != nil {
		t.Fatal("una ventana ya terminada no aplica")
	}
	if w := ActiveWindow([]Window{info}, now); w == nil || w.Suppress {
		t.Fatal("una ventana informativa aplica pero no suprime")
	}
	if w := ActiveWindow([]Window{info, suppress}, now); w == nil || w.ID != suppress.ID {
		t.Fatal("si alguna ventana activa suprime, gana la que suprime (no se despacha)")
	}
}
