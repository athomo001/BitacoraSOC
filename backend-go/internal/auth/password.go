// Package auth contiene los primitivos de autenticación: hashing de
// contraseñas, JWT y TOTP. Ver spec/07-backend-arquitectura-go.md sección 6.5.
package auth

import "golang.org/x/crypto/bcrypt"

// BcryptCost es el costo objetivo para hashes nuevos — subido desde el
// costo 8 del legacy (bcryptjs) según la guía vigente de OWASP para 2026.
// Ver spec/07-backend-arquitectura-go.md sección 6.5.
const BcryptCost = 12

// HashPassword cifra una contraseña en texto plano con bcrypt a BcryptCost.
func HashPassword(plaintext string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword verifica plaintext contra un hash — incluidos los hashes
// migrados del legacy (bcryptjs, costo 8): bcrypt es autodescriptivo, el
// costo embebido en el hash no importa para verificar.
func CheckPassword(hash, plaintext string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext))
}

// NeedsRehash indica si un hash ya válido quedó por debajo del costo
// objetivo actual (típicamente un hash heredado del legacy) — el llamador
// re-hashea la misma contraseña ya verificada tras un login exitoso,
// transparente para el usuario. Ver spec/07-backend-arquitectura-go.md
// sección 6.5 ("re-hash oportunista en login").
func NeedsRehash(hash string) bool {
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		// Hash ilegible/corrupto: no es este helper el que decide qué hacer
		// con eso, solo informa que "no" necesita rehash por costo.
		return false
	}
	return cost < BcryptCost
}
