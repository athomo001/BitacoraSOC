package backup

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/klauspost/compress/zstd"
)

type Envelope struct {
	Version int                        `json:"version"`
	Kind    string                     `json:"kind"`
	From    string                     `json:"windowFrom,omitempty"`
	To      string                     `json:"windowTo,omitempty"`
	Tables  map[string]json.RawMessage `json:"tables"`
}

// Cabeceras: con frase (BKP-1, como siempre) o sin frase, cifrado con la
// llave de la instalación (BKP-K1). La cabecera dice cuál pedir al abrir.
const (
	headerPassphrase   = "BITACORA-BKP-1\n"
	headerInstallation = "BITACORA-BKP-K1\n"
)

// ErrPassphraseRequired: el respaldo se hizo con frase y no vino.
var ErrPassphraseRequired = errors.New("backup: este respaldo se hizo con frase: escríbela")

// NeedsPassphrase dice si el respaldo se hizo con frase (si no, lo abre la
// llave de la instalación).
func NeedsPassphrase(data []byte) bool { return !bytes.HasPrefix(data, []byte(headerInstallation)) }

// Encode cifra con la frase (sha256 de la frase como llave).
func Encode(envelope Envelope, passphrase string) ([]byte, error) {
	return encode(envelope, sha256.Sum256([]byte(passphrase)), headerPassphrase)
}

// EncodeWithKey cifra con la llave de la instalación (respaldo sin frase).
func EncodeWithKey(envelope Envelope, key [32]byte) ([]byte, error) {
	return encode(envelope, key, headerInstallation)
}

func encode(envelope Envelope, key [32]byte, header string) ([]byte, error) {
	raw, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(19)))
	if err != nil {
		return nil, err
	}
	compressed := encoder.EncodeAll(raw, nil)
	encoder.Close()
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	sealed := aead.Seal(nonce, nonce, compressed, nil)
	return []byte(header + base64.RawStdEncoding.EncodeToString(sealed)), nil
}

// Open abre un respaldo de cualquiera de los dos tipos: sin frase con la
// llave de la instalación; con frase, con la frase (ErrPassphraseRequired
// si no vino).
func Open(data []byte, passphrase string, installation [32]byte) (Envelope, error) {
	if !NeedsPassphrase(data) {
		return decode(data, installation, headerInstallation)
	}
	if passphrase == "" {
		return Envelope{}, ErrPassphraseRequired
	}
	return Decode(data, passphrase)
}

// Decode abre un respaldo hecho con frase.
func Decode(data []byte, passphrase string) (Envelope, error) {
	return decode(data, sha256.Sum256([]byte(passphrase)), headerPassphrase)
}

func decode(data []byte, key [32]byte, header string) (Envelope, error) {
	if !bytes.HasPrefix(data, []byte(header)) {
		return Envelope{}, fmt.Errorf("backup: header inválido")
	}
	sealed, err := base64.RawStdEncoding.DecodeString(string(data[len(header):]))
	if err != nil {
		return Envelope{}, err
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return Envelope{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return Envelope{}, err
	}
	if len(sealed) < aead.NonceSize() {
		return Envelope{}, fmt.Errorf("backup: payload truncado")
	}
	plain, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], nil)
	if err != nil {
		if header == headerInstallation {
			return Envelope{}, fmt.Errorf("backup: este respaldo sin frase es de otra instalación (otra APP_ENCRYPTION_KEY)")
		}
		return Envelope{}, fmt.Errorf("backup: passphrase o checksum inválido")
	}
	decoder, err := zstd.NewReader(nil)
	if err != nil {
		return Envelope{}, err
	}
	raw, err := decoder.DecodeAll(plain, nil)
	decoder.Close()
	if err != nil {
		return Envelope{}, err
	}
	var envelope Envelope
	if err = json.Unmarshal(raw, &envelope); err != nil {
		return Envelope{}, err
	}
	return envelope, nil
}
