package legacyetl

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// Vector generado con encryptWithPassphrase del legacy (Node): contraseña
// "clave de prueba", PBKDF2-SHA256 10.000, AES-256-GCM.
const nodePassphraseBackup = `{"encrypted":true,"salt":"000102030405060708090a0b0c0d0e0f","iv":"a0a1a2a3a4a5a6a7a8a9aaab","authTag":"80f373008930dc545a43b2c388c58bfd","ciphertext":"a672cd58b66fccdfe806f337c175f15336c2bd2e0f8dfdede651dacb9c150b9abd7ffa283bf530027c6d8dbaf1af10821ef1"}`

func writeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "backup.zip")
	f, _ := os.Create(p)
	zw := zip.NewWriter(f)
	for name, content := range files {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	_ = zw.Close()
	_ = f.Close()
	return p
}

func TestOpenBackupZipWithKeyringAndUploads(t *testing.T) {
	p := writeZip(t, map[string]string{
		"data.json":                       `{"metadata":{"version":"3.1"},"data":{"users":[{"_id":"a"}]}}`,
		"secrets/encryption-keyring.json": `{"version":1,"keys":["` + testKey + `"]}`,
		"secrets/key.pem":                 "no se usa",
		"uploads/entries/foto.png":        "png",
	})
	b, err := OpenBackup(p, "")
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if len(b.Export.Data["users"]) != 1 || len(b.Keys) != 1 {
		t.Fatalf("datos o llaves: %d usuarios, %d llaves", len(b.Export.Data["users"]), len(b.Keys))
	}
	if got, err := b.Keys.Decrypt(nodeCipher); err != nil || got != "ana.perez@empresa.cl" {
		t.Fatalf("la llave del ZIP no descifra: %q %v", got, err)
	}
	if _, ok := b.Uploads["entries/foto.png"]; !ok || len(b.Uploads) != 1 {
		t.Fatalf("uploads: %v", b.Uploads)
	}
}

func TestOpenBackupWithPassphrase(t *testing.T) {
	p := writeZip(t, map[string]string{"data.json": nodePassphraseBackup})
	if _, err := OpenBackup(p, ""); err != ErrPassphraseRequired {
		t.Fatalf("sin contraseña: %v", err)
	}
	if _, err := OpenBackup(p, "otra clave"); err != ErrBadPassphrase {
		t.Fatalf("contraseña equivocada: %v", err)
	}
	b, err := OpenBackup(p, "clave de prueba")
	if err != nil || b.Export.Metadata.Version != "3.1" {
		t.Fatalf("con contraseña: %+v %v", b, err)
	}
	_ = b.Close()
}

func TestOpenBackupRejectsTruncatedZip(t *testing.T) {
	p := writeZip(t, map[string]string{"data.json": `{"data":{}}`})
	raw, _ := os.ReadFile(p)
	_ = os.WriteFile(p, raw[:len(raw)-30], 0o600) // sin el índice final, como el respaldo del 23-09
	if _, err := OpenBackup(p, ""); err == nil {
		t.Fatal("un ZIP cortado debería rechazarse con un motivo claro")
	}
}
