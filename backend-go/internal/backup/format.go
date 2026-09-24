package backup

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
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

func Encode(envelope Envelope, passphrase string) ([]byte, error) {
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
	key := sha256.Sum256([]byte(passphrase))
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
	return []byte("BITACORA-BKP-1\n" + base64.RawStdEncoding.EncodeToString(sealed)), nil
}

func Decode(data []byte, passphrase string) (Envelope, error) {
	const header = "BITACORA-BKP-1\n"
	if !bytes.HasPrefix(data, []byte(header)) {
		return Envelope{}, fmt.Errorf("backup: header inválido")
	}
	sealed, err := base64.RawStdEncoding.DecodeString(string(data[len(header):]))
	if err != nil {
		return Envelope{}, err
	}
	key := sha256.Sum256([]byte(passphrase))
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
