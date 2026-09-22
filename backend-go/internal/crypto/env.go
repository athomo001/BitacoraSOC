package crypto

import (
	"encoding/base64"
	"fmt"
)

// LoadKeyFromEnv decodifica una llave AES-256 desde su representación
// base64 (tal como se espera en la variable de entorno APP_ENCRYPTION_KEY).
// Falla explícitamente si no decodifica a exactamente KeySize bytes, en vez
// de arrancar el proceso con una llave silenciosamente truncada/rellenada.
func LoadKeyFromEnv(base64Value string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(base64Value)
	if err != nil {
		return nil, fmt.Errorf("crypto: APP_ENCRYPTION_KEY no es base64 válido: %w", err)
	}
	if len(key) != KeySize {
		return nil, fmt.Errorf("crypto: APP_ENCRYPTION_KEY debe decodificar a %d bytes, decodificó a %d", KeySize, len(key))
	}
	return key, nil
}
