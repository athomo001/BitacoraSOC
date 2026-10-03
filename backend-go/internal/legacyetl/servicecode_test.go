package legacyetl

import "testing"

func TestServiceCodeSinIDDelLegacy(t *testing.T) {
	used := map[string]bool{}
	cases := []struct{ org, legacy, want string }{
		{"junji", "qradar_696993296a90fd3291f4b656", "junji_qradar"},
		{"netics", "todo_todito_6981f0c96ea4611d898de666", "netics_todo_todito"},
		{"gnl quinteros", "CiberVigilancia", "gnl_quinteros_cibervigilancia"},
		{"junji", "QRADAR", "junji_qradar_2"},
	}
	for _, c := range cases {
		if got := serviceCode(c.org, c.legacy, used); got != c.want {
			t.Errorf("serviceCode(%q, %q) = %q, se esperaba %q", c.org, c.legacy, got, c.want)
		}
	}
}
