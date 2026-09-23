package auth

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image/png"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// TOTPEnrollment es lo que POST /api/auth/mfa/setup devuelve (spec/04-contratos-api.md):
// el secreto (para guardarlo cifrado en users.mfa_secret_encrypted) y un QR
// listo para pegar en un <img src="...">.
type TOTPEnrollment struct {
	Secret        string
	QRCodeDataURL string
}

// GenerateTOTPSecret genera un secreto TOTP nuevo para accountName (el
// username) bajo el issuer "Bitácora Ops", con su QR codificado en base64.
func GenerateTOTPSecret(accountName, issuer string) (TOTPEnrollment, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: accountName,
	})
	if err != nil {
		return TOTPEnrollment{}, fmt.Errorf("auth: generando secreto TOTP: %w", err)
	}

	img, err := key.Image(256, 256)
	if err != nil {
		return TOTPEnrollment{}, fmt.Errorf("auth: generando imagen QR: %w", err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return TOTPEnrollment{}, fmt.Errorf("auth: codificando QR a PNG: %w", err)
	}

	return TOTPEnrollment{
		Secret:        key.Secret(),
		QRCodeDataURL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, nil
}

// VerifyTOTPCode valida un código de 6 dígitos contra secret, con la
// ventana de tolerancia estándar de otp (±1 paso de 30s) para tolerar
// pequeños desfases de reloj entre el teléfono y el servidor.
func VerifyTOTPCode(secret, code string) bool {
	valid, err := totp.ValidateCustom(code, secret, time.Now(), totp.ValidateOpts{
		Period:    30,
		Skew:      1,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil {
		return false
	}
	return valid
}
