package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// blindIndexLabel separa la subllave del índice ciego de la llave de cifrado:
// nunca se usa el mismo material de llave para AES y para HMAC.
const blindIndexLabel = "bitacora-ops/blind-index/v1"

// BlindIndex devuelve un HMAC-SHA256 (hex) determinista de value, para buscar
// por igualdad sobre datos cifrados (contacts.email_hash/phone_hash) sin
// descifrar. El legacy usaba sha256 plano: un teléfono tiene tan poca entropía
// que ese hash se revierte por fuerza bruta en minutos; con HMAC hace falta
// además la llave del servidor. value debe venir ya normalizado por quien
// llama (ver internal/directory). Vacío → vacío (no se indexa).
func (b *Box) BlindIndex(value string) string {
	if value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, b.indexKey)
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func deriveIndexKey(key []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(blindIndexLabel))
	return mac.Sum(nil)
}
