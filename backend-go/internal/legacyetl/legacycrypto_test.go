package legacyetl

import (
	"os"
	"path/filepath"
	"testing"
)

// Vector generado con el crypto de Node (mismo código que encryption.js del
// legacy: aes-256-gcm, IV de 16 bytes, "iv:tag:cifrado" en hex).
const (
	testKey    = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	nodeCipher = "0f0e0d0c0b0a09080706050403020100:f4c4bed1b69d30f50e0b3bcf90b4bc92:82e8d94e3af2c41c2fb9c4e40cb2f942c5db06de"
)

func TestDecryptNodeVector(t *testing.T) {
	keys := addKey(nil, "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100") // otra llave primero
	keys = addKey(keys, testKey)
	got, err := keys.Decrypt(nodeCipher)
	if err != nil || got != "ana.perez@empresa.cl" {
		t.Fatalf("Decrypt = %q, %v", got, err)
	}
	// En claro (teléfonos viejos) pasa tal cual.
	if got, _ := keys.Decrypt("+56 9 1234 5678"); got != "+56 9 1234 5678" {
		t.Fatalf("texto en claro: %q", got)
	}
	// Con una llave equivocada falla (no devuelve basura).
	if _, err := addKey(nil, "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100").Decrypt(nodeCipher); err != ErrDecrypt {
		t.Fatalf("llave equivocada: %v", err)
	}
}

func TestLoadLegacyKeysReadsOnlyTheKey(t *testing.T) {
	dir := t.TempDir()
	env := filepath.Join(dir, ".env")
	_ = os.WriteFile(env, []byte("MONGO_ROOT_PASSWORD=otra-cosa\nENCRYPTION_KEY=\""+testKey+"\"\nJWT_SECRET=x\n"), 0o600)
	ring := filepath.Join(dir, "keyring.json")
	_ = os.WriteFile(ring, []byte(`{"version":1,"keys":["`+testKey+`","no-es-hex","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}`), 0o600)
	keys, err := LoadLegacyKeys(env, ring)
	if err != nil || len(keys) != 2 {
		t.Fatalf("llaves: %d, %v (la repetida y la inválida no cuentan)", len(keys), err)
	}
	if _, err := LoadLegacyKeys(filepath.Join(dir, "no-existe"), ""); err == nil {
		t.Fatal("sin .env debería fallar")
	}
	empty := filepath.Join(dir, "vacio.env")
	_ = os.WriteFile(empty, []byte("ENCRYPTION_KEY=corta\n"), 0o600)
	if _, err := LoadLegacyKeys(empty, ""); err == nil {
		t.Fatal("una llave inválida debería fallar")
	}
}
