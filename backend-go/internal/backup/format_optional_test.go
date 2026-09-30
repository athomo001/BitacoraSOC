package backup

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestOptionalPassphrase(t *testing.T) {
	env := Envelope{Version: 1, Kind: "full", Tables: map[string]json.RawMessage{"users": json.RawMessage(`[{"id":1}]`)}}
	var install, other [32]byte
	install[0], other[0] = 1, 2

	// Sin frase: lo abre la instalación sola, sin pedir nada.
	data, err := EncodeWithKey(env, install)
	if err != nil {
		t.Fatal(err)
	}
	if NeedsPassphrase(data) {
		t.Fatal("un respaldo sin frase no debe pedirla")
	}
	if got, err := Open(data, "", install); err != nil || got.Kind != "full" {
		t.Fatalf("sin frase: %v", err)
	}
	if _, err := Open(data, "", other); err == nil {
		t.Fatal("otra instalación no debe poder abrirlo")
	}

	// Con frase: la pide si falta y la usa si viene.
	withPass, err := Encode(env, "frase-larga")
	if err != nil {
		t.Fatal(err)
	}
	if !NeedsPassphrase(withPass) {
		t.Fatal("un respaldo con frase debe pedirla")
	}
	if _, err := Open(withPass, "", install); !errors.Is(err, ErrPassphraseRequired) {
		t.Fatalf("sin la frase: %v", err)
	}
	if got, err := Open(withPass, "frase-larga", install); err != nil || len(got.Tables) != 1 {
		t.Fatalf("con la frase: %v", err)
	}
}
