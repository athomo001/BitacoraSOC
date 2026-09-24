package backup

import (
	"encoding/json"
	"testing"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	want := Envelope{Version: 1, Kind: "delta", Tables: map[string]json.RawMessage{"entries": json.RawMessage(`[{"id":"1"}]`)}}
	data, err := Encode(want, "qa-passphrase")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decode(data, "qa-passphrase")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != want.Kind || string(got.Tables["entries"]) != string(want.Tables["entries"]) {
		t.Fatalf("roundtrip mismatch: %#v", got)
	}
}
