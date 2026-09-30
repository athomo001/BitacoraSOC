package legacyetl

import (
	"encoding/json"
	"testing"
)

func TestIDIsStable(t *testing.T) {
	a, b := ID("users", "6a88b6df6db69249b35e7a49"), ID("users", "6a88b6df6db69249b35e7a49")
	if a != b {
		t.Fatal("el mismo documento debe dar siempre el mismo UUID")
	}
	if a == ID("contacts", "6a88b6df6db69249b35e7a49") {
		t.Fatal("la colección forma parte del UUID")
	}
}

func TestOID(t *testing.T) {
	buffer := `{"buffer":{"0":106,"1":136,"2":182,"3":223,"4":109,"5":182,"6":146,"7":73,"8":179,"9":94,"10":122,"11":73}}`
	for raw, want := range map[string]string{
		`"6a88b6df6db69249b35e7a49"`:          "6a88b6df6db69249b35e7a49",
		`{"$oid":"6a88b6df6db69249b35e7a49"}`: "6a88b6df6db69249b35e7a49",
		buffer:                                "6a88b6df6db69249b35e7a49",
		`null`:                                "",
		`{"buffer":{"0":1}}`:                  "",
	} {
		if got := OID(json.RawMessage(raw)); got != want {
			t.Errorf("OID(%s) = %q, want %q", raw, got, want)
		}
	}
}

func TestCleanMetadataTurnsBuffersIntoHex(t *testing.T) {
	var meta any
	_ = json.Unmarshal([]byte(`{"userId":{"buffer":{"0":106,"1":136,"2":182,"3":223,"4":109,"5":182,"6":146,"7":73,"8":179,"9":94,"10":122,"11":73}},"ids":[{"buffer":{"0":0,"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0,"10":0,"11":1}}],"n":3}`), &meta)
	out, _ := json.Marshal(CleanMetadata(meta))
	want := `{"ids":["000000000000000000000001"],"n":3,"userId":"6a88b6df6db69249b35e7a49"}`
	if string(out) != want {
		t.Fatalf("CleanMetadata = %s", out)
	}
}

func TestNormName(t *testing.T) {
	if normName("  Ciber  Vigilancía ") != "ciber vigilancia" || normName("JUNJI") != normName("junji") {
		t.Fatal("normName debe ignorar tildes, mayúsculas y espacios de más")
	}
}

func TestParseTime(t *testing.T) {
	if _, ok := ParseTime("2026-09-23T14:24:53.092Z"); !ok {
		t.Fatal("fecha ISO del legacy")
	}
	if _, ok := ParseTime("mañana"); ok {
		t.Fatal("texto inválido no es fecha")
	}
}
