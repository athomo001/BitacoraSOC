package handler

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

func TestPlanPlacement(t *testing.T) {
	active := map[string]bool{"soc": true, "noc": true, "infra": true}
	n1, n2 := "lvl-n1", "lvl-n2"
	socN2 := groupShape{ID: uuid.New(), Level: n2, Areas: []string{"soc"}, Caps: []string{}}
	analyst := groupShape{ID: uuid.New(), Level: n1, Areas: []string{"soc", "noc"}, Caps: []string{"directory:write"}}
	infraLead := groupShape{ID: uuid.New(), Areas: []string{"infra"}, Caps: []string{CapAreaLead}}
	oldArea := groupShape{ID: uuid.New(), Level: n1, Areas: []string{"vieja"}, Caps: []string{}}

	t.Run("sin cambios no toca nada", func(t *testing.T) {
		current := []groupShape{socN2, infraLead}
		want := derivePlacement(append(current, groupShape{ID: uuid.New(), Level: n1, Areas: []string{"infra"}}), active)
		remove, add := planPlacement(append(current, groupShape{ID: uuid.New(), Level: n1, Areas: []string{"infra"}}), want, active)
		if len(remove) != 0 || len(add) != 0 {
			t.Fatalf("remove %v add %v", remove, add)
		}
	})

	t.Run("subir de nivel cambia el grupo del área", func(t *testing.T) {
		remove, add := planPlacement([]groupShape{socN2}, placementDTO{Areas: []placementArea{{Code: "soc", LevelID: n1}}}, active)
		if !slices.Equal(remove, []uuid.UUID{socN2.ID}) || len(add) != 1 || add[0].Area != "soc" || add[0].Level != n1 {
			t.Fatalf("remove %v add %+v", remove, add)
		}
	})

	t.Run("un grupo de dos áreas: cambiar una rearma la otra", func(t *testing.T) {
		want := placementDTO{Areas: []placementArea{{Code: "soc", LevelID: n2}, {Code: "noc", LevelID: n1}}, Extras: []string{"directory:write"}}
		remove, add := planPlacement([]groupShape{analyst}, want, active)
		if !slices.Equal(remove, []uuid.UUID{analyst.ID}) {
			t.Fatalf("quita el grupo SOC+NOC: %v", remove)
		}
		got := map[string]string{}
		extras := 0
		for _, s := range add {
			if s.Area == "" {
				extras++
			} else {
				got[s.Area] = s.Level
			}
		}
		if got["soc"] != n2 || got["noc"] != n1 || extras != 1 {
			t.Fatalf("arma SOC N2, NOC N1 y Directorio: %+v", add)
		}
	})

	t.Run("quitar el área quita la jefatura", func(t *testing.T) {
		remove, add := planPlacement([]groupShape{infraLead}, placementDTO{}, active)
		if !slices.Equal(remove, []uuid.UUID{infraLead.ID}) || len(add) != 0 {
			t.Fatalf("remove %v add %+v", remove, add)
		}
	})

	t.Run("marcar jefe arma el grupo de jefatura", func(t *testing.T) {
		remove, add := planPlacement([]groupShape{socN2}, placementDTO{Areas: []placementArea{{Code: "soc", LevelID: n2, Lead: true}}}, active)
		if len(remove) != 0 || len(add) != 1 || !slices.Equal(add[0].Caps, []string{CapAreaLead}) || add[0].Area != "soc" {
			t.Fatalf("remove %v add %+v", remove, add)
		}
	})

	t.Run("las áreas apagadas no se tocan", func(t *testing.T) {
		remove, _ := planPlacement([]groupShape{oldArea}, placementDTO{}, active)
		if len(remove) != 0 {
			t.Fatalf("no quita el grupo de un área apagada: %v", remove)
		}
	})
}

func TestDerivePlacement(t *testing.T) {
	active := map[string]bool{"soc": true, "infra": true}
	got := derivePlacement([]groupShape{
		{Level: "n2", Areas: []string{"soc"}},
		{Areas: []string{"infra"}, Caps: []string{CapAreaLead, "directory:write"}},
		{Level: "n1", Areas: []string{"vieja"}},
	}, active)
	if len(got.Areas) != 2 || got.Areas[0] != (placementArea{Code: "soc", LevelID: "n2"}) || got.Areas[1] != (placementArea{Code: "infra", Lead: true}) {
		t.Fatalf("áreas: %+v", got.Areas)
	}
	if !slices.Equal(got.Extras, []string{"directory:write"}) {
		t.Fatalf("extras: %v", got.Extras)
	}
}
