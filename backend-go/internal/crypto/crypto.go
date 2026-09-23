// Package crypto cifra/descifra strings en reposo (contraseñas de integración
// como smtp_config.password_encrypted, y a futuro contacts/contact_channels)
// con AES-256-GCM. Decisión explícita: llamada de función explícita
// (Encrypt/Decrypt), no un tipo mágico con Scan/Value estilo database/sql —
// mismo principio que ya fijaba spec/08-fase6-modulos-diferidos.md ("en Go no
// hay getters mágicos de ORM, el descifrado es una llamada de función
// explícita"), documentado en detalle en spec/07-backend-arquitectura-go.md
// sección 6.6.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// KeySize es el tamaño requerido de la llave para AES-256 (32 bytes).
const KeySize = 32

// Box cifra/descifra con una llave AES-256-GCM fija, cargada una vez al
// arrancar el proceso (ver internal/crypto.LoadKeyFromEnv).
type Box struct {
	aead     cipher.AEAD
	indexKey []byte // subllave HMAC para BlindIndex, derivada de la misma llave maestra
}

// New construye un Box a partir de una llave de exactamente KeySize bytes.
func New(key []byte) (*Box, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("crypto: la llave debe tener %d bytes, tiene %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: creando cipher AES: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: creando GCM: %w", err)
	}
	return &Box{aead: aead, indexKey: deriveIndexKey(key)}, nil
}

// Encrypt cifra plaintext y devuelve un string base64 (nonce + ciphertext +
// tag) listo para guardar en una columna TEXT.
func (b *Box) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("crypto: generando nonce: %w", err)
	}
	sealed := b.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt revierte Encrypt. Falla si la llave no coincide o si el ciphertext
// fue alterado (el tag de autenticación de GCM lo detecta).
func (b *Box) Decrypt(ciphertext string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("crypto: decodificando base64: %w", err)
	}
	nonceSize := b.aead.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("crypto: ciphertext demasiado corto")
	}
	nonce, sealed := raw[:nonceSize], raw[nonceSize:]
	plaintext, err := b.aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("crypto: descifrando (llave incorrecta o dato alterado): %w", err)
	}
	return string(plaintext), nil
}
