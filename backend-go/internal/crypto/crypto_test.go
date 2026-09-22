package crypto_test

import (
	"crypto/rand"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
)

func randomKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, crypto.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("generando llave aleatoria de prueba: %v", err)
	}
	return key
}

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	box, err := crypto.New(randomKey(t))
	if err != nil {
		t.Fatalf("New() error inesperado: %v", err)
	}

	plaintext := "smtp-password-de-prueba-123"

	ciphertext, err := box.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error inesperado: %v", err)
	}
	if ciphertext == plaintext {
		t.Fatalf("Encrypt() devolvió el texto plano sin cifrar")
	}

	got, err := box.Decrypt(ciphertext)
	if err != nil {
		t.Fatalf("Decrypt() error inesperado: %v", err)
	}
	if got != plaintext {
		t.Fatalf("Decrypt() = %q, se esperaba %q", got, plaintext)
	}
}

func TestDecrypt_LlaveIncorrectaFalla(t *testing.T) {
	writer, err := crypto.New(randomKey(t))
	if err != nil {
		t.Fatalf("New() error inesperado: %v", err)
	}
	ciphertext, err := writer.Encrypt("dato-sensible")
	if err != nil {
		t.Fatalf("Encrypt() error inesperado: %v", err)
	}

	reader, err := crypto.New(randomKey(t)) // llave distinta a propósito
	if err != nil {
		t.Fatalf("New() error inesperado: %v", err)
	}
	if _, err := reader.Decrypt(ciphertext); err == nil {
		t.Fatalf("Decrypt() con llave incorrecta debería fallar, no devolvió error")
	}
}

func TestDecrypt_CiphertextAlteradoFalla(t *testing.T) {
	box, err := crypto.New(randomKey(t))
	if err != nil {
		t.Fatalf("New() error inesperado: %v", err)
	}
	ciphertext, err := box.Encrypt("dato-sensible")
	if err != nil {
		t.Fatalf("Encrypt() error inesperado: %v", err)
	}

	// Cambia el último carácter del base64 para simular manipulación del dato
	// en reposo — el tag de autenticación de GCM debe detectarlo.
	tampered := []byte(ciphertext)
	last := len(tampered) - 1
	if tampered[last] == 'A' {
		tampered[last] = 'B'
	} else {
		tampered[last] = 'A'
	}

	if _, err := box.Decrypt(string(tampered)); err == nil {
		t.Fatalf("Decrypt() con ciphertext alterado debería fallar, no devolvió error")
	}
}

func TestEncrypt_NonceDistintoPorLlamada(t *testing.T) {
	box, err := crypto.New(randomKey(t))
	if err != nil {
		t.Fatalf("New() error inesperado: %v", err)
	}

	a, err := box.Encrypt("mismo-texto-plano")
	if err != nil {
		t.Fatalf("Encrypt() error inesperado: %v", err)
	}
	b, err := box.Encrypt("mismo-texto-plano")
	if err != nil {
		t.Fatalf("Encrypt() error inesperado: %v", err)
	}
	if a == b {
		t.Fatalf("dos cifrados del mismo texto plano dieron el mismo ciphertext (nonce no se está randomizando)")
	}
}
