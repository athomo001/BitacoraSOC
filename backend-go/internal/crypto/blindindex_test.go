package crypto_test

import (
	"bytes"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
)

func TestBlindIndex_DeterministicAndKeyed(t *testing.T) {
	a, _ := crypto.New(bytes.Repeat([]byte{1}, crypto.KeySize))
	b, _ := crypto.New(bytes.Repeat([]byte{2}, crypto.KeySize))

	if a.BlindIndex("+56912345678") != a.BlindIndex("+56912345678") {
		t.Fatal("el índice debe ser determinista para buscar por igualdad")
	}
	if a.BlindIndex("+56912345678") == b.BlindIndex("+56912345678") {
		t.Fatal("con otra llave debe dar otro índice (no es un sha256 plano reversible por diccionario)")
	}
	if a.BlindIndex("x") == a.BlindIndex("y") {
		t.Fatal("valores distintos no pueden chocar")
	}
	if a.BlindIndex("") != "" {
		t.Fatal("un valor vacío no se indexa")
	}
}
