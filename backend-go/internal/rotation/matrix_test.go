package rotation

import "testing"

func TestMeta_KnownCondition(t *testing.T) {
	m := Meta(ConditionTelework)
	if m.Label != "Teletrabajo" || m.Marker == "" {
		t.Fatalf("metadata de teletrabajo inesperada: %+v", m)
	}
}

func TestMeta_UnknownConditionFallsBackToOffice(t *testing.T) {
	m := Meta(Condition("algo-inventado"))
	if m.Label != conditionMeta[ConditionOffice].Label {
		t.Fatalf("una condición desconocida debía tratarse como oficina, obtuve %+v", m)
	}
	// Día sin asignación cargada tampoco debe romper la presentación.
	if m2 := Meta(Condition("")); m2.Label != conditionMeta[ConditionOffice].Label {
		t.Fatalf("condición vacía debía tratarse como oficina, obtuve %+v", m2)
	}
}

func TestHasSpecial(t *testing.T) {
	if HasSpecial([]Condition{ConditionOffice, ConditionOffice}) {
		t.Fatal("solo oficina no debería marcarse como novedad")
	}
	if HasSpecial(nil) {
		t.Fatal("sin asignaciones cargadas no debería marcarse como novedad")
	}
	if !HasSpecial([]Condition{ConditionOffice, ConditionVacation}) {
		t.Fatal("un día de vacaciones en la semana sí es una novedad")
	}
}

func TestSortRows_SpecialFirstThenAlphabetical(t *testing.T) {
	rows := []RowInput{
		{Key: "1", Name: "Zoe", Conditions: []Condition{ConditionOffice}},
		{Key: "2", Name: "Ana", Conditions: []Condition{ConditionVacation}},
		{Key: "3", Name: "Beto", Conditions: []Condition{ConditionOffice}},
		{Key: "4", Name: "Carla", Conditions: []Condition{ConditionTelework}},
	}

	sorted := SortRows(rows)
	got := []string{sorted[0].Name, sorted[1].Name, sorted[2].Name, sorted[3].Name}
	want := []string{"Ana", "Carla", "Beto", "Zoe"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("orden inesperado: %v, quería %v", got, want)
		}
	}
}

func TestSortRows_DoesNotMutateInput(t *testing.T) {
	rows := []RowInput{
		{Key: "1", Name: "Zoe", Conditions: []Condition{ConditionOffice}},
		{Key: "2", Name: "Ana", Conditions: []Condition{ConditionVacation}},
	}
	_ = SortRows(rows)
	if rows[0].Name != "Zoe" {
		t.Fatal("SortRows no debería mutar el slice de entrada")
	}
}
