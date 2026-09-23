package auth_test

import (
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword_VerificaConCheckPassword(t *testing.T) {
	hash, err := auth.HashPassword("Contraseña-de-prueba-123")
	if err != nil {
		t.Fatalf("HashPassword() error inesperado: %v", err)
	}
	if err := auth.CheckPassword(hash, "Contraseña-de-prueba-123"); err != nil {
		t.Fatalf("CheckPassword() con la contraseña correcta debería pasar, dio: %v", err)
	}
}

func TestCheckPassword_ContraseñaIncorrectaFalla(t *testing.T) {
	hash, err := auth.HashPassword("correcta")
	if err != nil {
		t.Fatalf("HashPassword() error inesperado: %v", err)
	}
	if err := auth.CheckPassword(hash, "incorrecta"); err == nil {
		t.Fatal("CheckPassword() con contraseña incorrecta debería fallar, no devolvió error")
	}
}

func TestHashPassword_UsaCosto12(t *testing.T) {
	hash, err := auth.HashPassword("cualquier-cosa")
	if err != nil {
		t.Fatalf("HashPassword() error inesperado: %v", err)
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		t.Fatalf("bcrypt.Cost() error inesperado: %v", err)
	}
	if cost != auth.BcryptCost {
		t.Fatalf("costo del hash = %d, se esperaba %d (spec/07-backend-arquitectura-go.md sección 6.5)", cost, auth.BcryptCost)
	}
}

func TestCheckPassword_VerificaHashLegacyDeCostoMenor(t *testing.T) {
	// Simula un password_hash migrado del legacy (bcryptjs, costo 8) —
	// debe seguir verificando sin cambios, sin resetear la contraseña.
	legacyHash, err := bcrypt.GenerateFromPassword([]byte("clave-legacy"), 8)
	if err != nil {
		t.Fatalf("generando hash legacy de prueba: %v", err)
	}
	if err := auth.CheckPassword(string(legacyHash), "clave-legacy"); err != nil {
		t.Fatalf("CheckPassword() debería verificar un hash legacy de costo 8, dio: %v", err)
	}
}

func TestNeedsRehash_DetectaCostoMenorAlObjetivo(t *testing.T) {
	legacyHash, err := bcrypt.GenerateFromPassword([]byte("clave-legacy"), 8)
	if err != nil {
		t.Fatalf("generando hash legacy de prueba: %v", err)
	}
	if !auth.NeedsRehash(string(legacyHash)) {
		t.Fatal("NeedsRehash() debería ser true para un hash de costo 8 (objetivo es 12)")
	}

	freshHash, err := auth.HashPassword("clave-nueva")
	if err != nil {
		t.Fatalf("HashPassword() error inesperado: %v", err)
	}
	if auth.NeedsRehash(freshHash) {
		t.Fatal("NeedsRehash() no debería marcar un hash recién creado a costo objetivo")
	}
}
