package legacyetl

import (
	"archive/zip"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
)

// ErrPassphraseRequired: el respaldo manual se hizo con contraseña.
var ErrPassphraseRequired = errors.New("el respaldo viene cifrado con contraseña: defínela en LEGACY_BACKUP_PASSPHRASE")

// ErrBadPassphrase: la contraseña no abre el respaldo (o está dañado).
var ErrBadPassphrase = errors.New("la contraseña del respaldo no es correcta o el archivo está dañado")

// Backup es un respaldo del legacy abierto: los datos, las llaves que trae
// (secrets/encryption-keyring.json en los ZIP) y los archivos subidos.
type Backup struct {
	Export *Export
	// Keys son las llaves del keyring que viene dentro del ZIP (vacío en un
	// .json suelto).
	Keys LegacyKeys
	// Uploads son los archivos de uploads/ del ZIP (imágenes de entradas,
	// logos), por ruta relativa. Se leen con OpenUpload.
	Uploads map[string]*zip.File
	zip     *zip.ReadCloser
}

// Close libera el ZIP.
func (b *Backup) Close() error {
	if b.zip != nil {
		return b.zip.Close()
	}
	return nil
}

// OpenUpload abre un archivo de uploads/ del respaldo.
func (b *Backup) OpenUpload(rel string) (io.ReadCloser, error) {
	f, ok := b.Uploads[rel]
	if !ok {
		return nil, os.ErrNotExist
	}
	return f.Open()
}

// OpenBackup abre un respaldo del legacy tal como sale: el ZIP (automático
// o manual, con data.json, uploads/, global/ y secrets/) o un JSON suelto.
// Si data.json viene cifrado con contraseña (respaldo manual), usa
// passphrase. Los certificados TLS que trae el ZIP se ignoran.
func OpenBackup(p, passphrase string) (*Backup, error) {
	if strings.EqualFold(path.Ext(p), ".zip") {
		return openZip(p, passphrase)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("no se pudo abrir el respaldo: %w", err)
	}
	ex, err := parseData(raw, passphrase)
	if err != nil {
		return nil, err
	}
	return &Backup{Export: ex, Uploads: map[string]*zip.File{}}, nil
}

func openZip(p, passphrase string) (*Backup, error) {
	z, err := zip.OpenReader(p)
	if err != nil {
		return nil, fmt.Errorf("el ZIP no se puede leer (¿respaldo incompleto o cortado?): %w", err)
	}
	b := &Backup{Uploads: map[string]*zip.File{}, zip: z}
	var data *zip.File
	for _, f := range z.File {
		name := strings.ReplaceAll(f.Name, `\`, "/")
		switch {
		case name == "data.json":
			data = f
		case name == "secrets/encryption-keyring.json":
			if raw, err := readZipFile(f, 1<<20); err == nil {
				var ring struct {
					Keys []string `json:"keys"`
				}
				if json.Unmarshal(raw, &ring) == nil {
					for _, k := range ring.Keys {
						b.Keys = addKey(b.Keys, k)
					}
				}
			}
		case strings.HasPrefix(name, "uploads/") && !f.FileInfo().IsDir():
			b.Uploads[strings.TrimPrefix(name, "uploads/")] = f
		}
	}
	if data == nil {
		_ = z.Close()
		return nil, errors.New("el ZIP no trae data.json: no parece un respaldo del legacy")
	}
	raw, err := readZipFile(data, 4<<30)
	if err != nil {
		_ = z.Close()
		return nil, fmt.Errorf("no se pudo leer data.json del ZIP: %w", err)
	}
	b.Export, err = parseData(raw, passphrase)
	if err != nil {
		_ = z.Close()
		return nil, err
	}
	return b, nil
}

func readZipFile(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, limit))
}

// passphraseEnvelope es el formato de encryptWithPassphrase del legacy
// (routes/backup.js): PBKDF2-SHA256 10.000 iteraciones, AES-256-GCM.
type passphraseEnvelope struct {
	Encrypted  bool   `json:"encrypted"`
	Salt       string `json:"salt"`
	IV         string `json:"iv"`
	AuthTag    string `json:"authTag"`
	Ciphertext string `json:"ciphertext"`
}

func parseData(raw []byte, passphrase string) (*Export, error) {
	// Un respaldo cifrado es un objeto chico en la cabecera; se mira el
	// comienzo sin decodificar 250 MB dos veces.
	head := raw
	if len(head) > 256 {
		head = head[:256]
	}
	if bytes.Contains(head, []byte(`"encrypted":true`)) && bytes.Contains(raw[:min(len(raw), 4096)], []byte(`"salt"`)) {
		var env passphraseEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			return nil, fmt.Errorf("respaldo cifrado con formato inválido: %w", err)
		}
		if passphrase == "" {
			return nil, ErrPassphraseRequired
		}
		plain, err := decryptPassphrase(env, passphrase)
		if err != nil {
			return nil, err
		}
		raw = plain
	}
	var e Export
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, fmt.Errorf("data.json no es el formato del legacy: %w", err)
	}
	if e.Data == nil {
		return nil, errors.New("data.json no trae el bloque data")
	}
	return &e, nil
}

func decryptPassphrase(env passphraseEnvelope, passphrase string) ([]byte, error) {
	salt, err1 := hex.DecodeString(env.Salt)
	iv, err2 := hex.DecodeString(env.IV)
	tag, err3 := hex.DecodeString(env.AuthTag)
	body, err4 := hex.DecodeString(env.Ciphertext)
	if err := errors.Join(err1, err2, err3, err4); err != nil {
		return nil, ErrBadPassphrase
	}
	key, err := pbkdf2.Key(sha256.New, passphrase, salt, 10000, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return nil, ErrBadPassphrase
	}
	plain, err := gcm.Open(nil, iv, append(body, tag...), nil)
	if err != nil {
		return nil, ErrBadPassphrase
	}
	return plain, nil
}
