// Package audit formaliza la convención audit.Log() (spec/07-backend-arquitectura-go.md
// sección 6): un solo helper llamado desde todo handler mutante, con
// sanitización de secretos y tope de tamaño ya resueltos acá para que un
// call site nunca tenga que acordarse de hacerlo a mano.
package audit

import (
	"encoding/json"
	"strings"
)

// RedactedValue reemplaza cualquier campo de metadata cuya clave matchee un
// patrón sensible — un audit_log es append-only e inmutable, así que un
// secreto que se cuele acá no se puede corregir después.
const RedactedValue = "[REDACTED]"

// MaxMetadataBytes es el tope de tamaño de metadata ya validado en
// producción por el legacy (spec/07-backend-arquitectura-go.md sección 6.1).
const MaxMetadataBytes = 10 * 1024

// sensitiveKeyFragments: una clave se redacta si contiene alguno de estos
// fragmentos (case-insensitive) — cubre password/newPassword/currentPassword,
// token/jwtToken/tempToken, secret/apiSecret, etc. sin tener que enumerar
// cada variante exacta.
var sensitiveKeyFragments = []string{"password", "token", "jwt", "secret"}

// SanitizeMetadata redacta claves sensibles y trunca metadata si excede
// MaxMetadataBytes. Nunca devuelve nil, así el llamador no necesita
// chequearlo antes de persistir.
func SanitizeMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return map[string]any{}
	}

	redacted := make(map[string]any, len(metadata))
	for key, value := range metadata {
		if isSensitiveKey(key) {
			redacted[key] = RedactedValue
			continue
		}
		redacted[key] = value
	}

	encoded, err := json.Marshal(redacted)
	if err == nil && len(encoded) > MaxMetadataBytes {
		return map[string]any{
			"_truncated":    true,
			"_originalSize": len(encoded),
		}
	}

	return redacted
}

func isSensitiveKey(key string) bool {
	lower := strings.ToLower(key)
	for _, fragment := range sensitiveKeyFragments {
		if strings.Contains(lower, fragment) {
			return true
		}
	}
	return false
}
