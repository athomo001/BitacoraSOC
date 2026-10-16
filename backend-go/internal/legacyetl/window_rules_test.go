package legacyetl

import (
	"encoding/json"
	"testing"
)

func rawWindows(t *testing.T, s string) []json.RawMessage {
	t.Helper()
	var out []json.RawMessage
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestLegacyWindowRules(t *testing.T) {
	// «always» sin días: la ventana continua de siempre, sin reglas.
	if rules, bad := legacyWindowRules(rawWindows(t, `[{"mode":"always","startTime":"09:00","endTime":"17:00","daysOfWeek":[]}]`)); len(rules) != 0 || bad != "" {
		t.Fatalf("always: %+v %q", rules, bad)
	}
	// Entre las 02:00 y 04:00 los domingos: se repite cada semana.
	rules, bad := legacyWindowRules(rawWindows(t, `[{"mode":"between_hours","startTime":"02:00","endTime":"04:00","daysOfWeek":[0]}]`))
	if bad != "" || len(rules) != 1 || rules[0].Start != "02:00" || rules[0].End != "04:00" || len(rules[0].Weekdays) != 1 || rules[0].Weekdays[0] != 0 {
		t.Fatalf("between_hours: %+v %q", rules, bad)
	}
	// Todo el día los sábados.
	rules, _ = legacyWindowRules(rawWindows(t, `[{"mode":"always","daysOfWeek":[6]}]`))
	if len(rules) != 1 || rules[0].Start != "00:00" || rules[0].End != "23:59" {
		t.Fatalf("always con días: %+v", rules)
	}
	// Los modos que la 2.0 no repite se informan.
	for _, s := range []string{
		`[{"mode":"outside_business_hours","startTime":"09:00","endTime":"18:00"}]`,
		`[{"mode":"between_hours","startTime":"02:00","endTime":"04:00","holidayOnly":true}]`,
	} {
		if _, bad := legacyWindowRules(rawWindows(t, s)); bad == "" {
			t.Errorf("debía informar el modo: %s", s)
		}
	}
}
