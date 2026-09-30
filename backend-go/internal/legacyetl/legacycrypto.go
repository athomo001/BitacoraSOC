// Package legacyetl migra la exportación JSON del legacy a la base de la 2.0
// (spec/13-etl.md). Se corre muchas veces (ensayos) sobre un destino vacío:
// IDs estables, carga en una sola transacción y un reporte sin datos
// personales.
package legacyetl

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// LegacyKeys son las llaves AES-256 del legacy, en el orden en que las
// probaba encryption.js: la de ENCRYPTION_KEY y luego las del keyring.
type LegacyKeys [][]byte

var hexKey = regexp.MustCompile(`^[a-f0-9]{64}$`)

func addKey(keys LegacyKeys, raw string) LegacyKeys {
	raw = strings.ToLower(strings.TrimSpace(strings.Trim(strings.TrimSpace(raw), `"'`)))
	if !hexKey.MatchString(raw) {
		return keys
	}
	k, _ := hex.DecodeString(raw)
	for _, existing := range keys {
		if string(existing) == string(k) {
			return keys
		}
	}
	return append(keys, k)
}

// LoadLegacyKeys lee ENCRYPTION_KEY del .env del legacy y, si existe, su
// keyring (secrets/encryption-keyring.json). Nunca devuelve ni imprime el
// contenido del .env: solo toma esa línea.
func LoadLegacyKeys(envPath, keyringPath string) (LegacyKeys, error) {
	var keys LegacyKeys
	if envPath != "" {
		f, err := os.Open(envPath)
		if err != nil {
			return nil, fmt.Errorf("no se pudo abrir el .env del legacy: %w", err)
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if v, ok := strings.CutPrefix(line, "ENCRYPTION_KEY="); ok {
				keys = addKey(keys, v)
			}
		}
		_ = f.Close()
	}
	if keyringPath != "" {
		if raw, err := os.ReadFile(keyringPath); err == nil {
			var ring struct {
				Keys []string `json:"keys"`
			}
			if json.Unmarshal(raw, &ring) == nil {
				for _, k := range ring.Keys {
					keys = addKey(keys, k)
				}
			}
		}
	}
	if len(keys) == 0 {
		return nil, errors.New("no se encontró ENCRYPTION_KEY válida (64 caracteres hex) en el .env ni en el keyring del legacy")
	}
	return keys, nil
}

// MergeKeys une dos juegos de llaves sin repetir, en orden.
func MergeKeys(a, b LegacyKeys) LegacyKeys {
	out := append(LegacyKeys{}, a...)
	for _, k := range b {
		out = addKey(out, hex.EncodeToString(k))
	}
	return out
}

var gcmValue = regexp.MustCompile(`^[0-9a-fA-F]{32}:[0-9a-fA-F]{32}:[0-9a-fA-F]*$`)

// IsEncrypted dice si un valor tiene el formato cifrado del legacy.
func IsEncrypted(v string) bool { return gcmValue.MatchString(v) }

// ErrDecrypt: ninguna llave abre el valor (llave equivocada o dato dañado).
var ErrDecrypt = errors.New("ninguna llave del legacy descifra el valor")

// Decrypt abre un valor "iv:tag:cifrado" (AES-256-GCM con IV de 16 bytes,
// como encryption.js del legacy). Un valor que no tiene ese formato se
// devuelve tal cual: el legacy guardaba algunos teléfonos en claro.
func (k LegacyKeys) Decrypt(v string) (string, error) {
	if v == "" || !IsEncrypted(v) {
		return v, nil
	}
	parts := strings.Split(v, ":")
	iv, _ := hex.DecodeString(parts[0])
	tag, _ := hex.DecodeString(parts[1])
	body, _ := hex.DecodeString(parts[2])
	sealed := append(body, tag...)
	for _, key := range k {
		block, err := aes.NewCipher(key)
		if err != nil {
			continue
		}
		gcm, err := cipher.NewGCMWithNonceSize(block, len(iv))
		if err != nil {
			continue
		}
		if plain, err := gcm.Open(nil, iv, sealed, nil); err == nil {
			return string(plain), nil
		}
	}
	return "", ErrDecrypt
}
