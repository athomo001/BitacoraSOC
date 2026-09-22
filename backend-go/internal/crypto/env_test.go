package crypto_test

import (
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
)

func TestLoadKeyFromEnv_DecodificaBase64Valido(t *testing.T) {
	raw := randomKey(t)
	encoded := base64.StdEncoding.EncodeToString(raw)

	key, err := crypto.LoadKeyFromEnv(encoded)
	if err != nil {
		t.Fatalf("LoadKeyFromEnv() error inesperado: %v", err)
	}
	if string(key) != string(raw) {
		t.Fatalf("LoadKeyFromEnv() no devolvió la llave original decodificada")
	}
}

func TestLoadKeyFromEnv_RechazaLongitudIncorrecta(t *testing.T) {
	tooShort := make([]byte, 16) // AES-128, no AES-256
	_, _ = rand.Read(tooShort)
	encoded := base64.StdEncoding.EncodeToString(tooShort)

	if _, err := crypto.LoadKeyFromEnv(encoded); err == nil {
		t.Fatalf("LoadKeyFromEnv() con llave de 16 bytes debería fallar, no devolvió error")
	}
}

func TestLoadKeyFromEnv_RechazaBase64Invalido(t *testing.T) {
	if _, err := crypto.LoadKeyFromEnv("esto no es base64 válido!!"); err == nil {
		t.Fatalf("LoadKeyFromEnv() con base64 inválido debería fallar, no devolvió error")
	}
}
