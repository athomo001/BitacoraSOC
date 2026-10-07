package handler

import "testing"

// El CSV del legacy trae "N2"; quien lo arma a mano suele escribir el nombre
// del equipo ("Guardia N2") o con tildes ("Trámite Médico").
func TestCSVConditionAcceptsLegacyCodesAndTeamNames(t *testing.T) {
	cases := map[string][2]string{
		"N2":                  {"Guardia N2", ""},
		"Guardia N2":          {"Guardia N2", ""},
		"guardia n1_no_habil": {"Guardia N1_NO_HABIL", ""},
		"N1 No Hábil":         {"Guardia N1_NO_HABIL", ""},
		"Charla/Capacitación": {"Guardia OL", ""},
		"Vacaciones":          {"", "vacation"},
		"Trámite Médico":      {"", "medical_appointment"},
		"Licencia médica":     {"", "medical_leave"},
	}
	for raw, want := range cases {
		team, dot, ok := csvCondition(raw)
		if !ok || team != want[0] || dot != want[1] {
			t.Errorf("csvCondition(%q) = %q, %q, %v; quiero %q, %q", raw, team, dot, ok, want[0], want[1])
		}
	}
	if _, _, ok := csvCondition("Guardia"); ok {
		t.Error(`"Guardia" sola no es una condición`)
	}
}
