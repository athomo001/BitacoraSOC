package legacyetl

import (
	"encoding/json"
	"testing"
)

// Una colección con datos que ningún paso lee (y que no está en "no se
// migra") tiene que aparecer en el informe: si no, se perdería sin aviso.
func TestUnreadCollections(t *testing.T) {
	ex := &Export{Data: map[string][]json.RawMessage{
		"users":         {json.RawMessage(`{}`)},
		"checks":        {json.RawMessage(`{}`), json.RawMessage(`{}`)},
		"avisoLogs":     {json.RawMessage(`{}`)},
		"shiftClosures": {},
	}}
	var out []any
	if err := ex.Decode("users", &out); err != nil {
		t.Fatal(err)
	}
	got := ex.Unread([]string{"avisoLogs"})
	if len(got) != 1 || got[0] != "checks (2)" {
		t.Fatalf("se esperaba solo checks (2), salió %v", got)
	}
}
