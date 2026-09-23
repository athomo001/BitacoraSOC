package auth_test

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/pquerna/otp/totp"
)

func TestGenerateTOTPSecret_DevuelveSecretYQR(t *testing.T) {
	enrollment, err := auth.GenerateTOTPSecret("ana", "BitacoraSOC")
	if err != nil {
		t.Fatalf("GenerateTOTPSecret() error inesperado: %v", err)
	}
	if enrollment.Secret == "" {
		t.Fatal("Secret vacío")
	}
	if enrollment.QRCodeDataURL == "" || len(enrollment.QRCodeDataURL) < 100 {
		t.Fatal("QRCodeDataURL vacío o sospechosamente corto")
	}
}

func TestVerifyTOTPCode_CodigoValidoPasa(t *testing.T) {
	enrollment, err := auth.GenerateTOTPSecret("ana", "BitacoraSOC")
	if err != nil {
		t.Fatalf("GenerateTOTPSecret() error inesperado: %v", err)
	}

	code, err := totp.GenerateCode(enrollment.Secret, time.Now())
	if err != nil {
		t.Fatalf("generando código de prueba: %v", err)
	}

	if !auth.VerifyTOTPCode(enrollment.Secret, code) {
		t.Fatal("VerifyTOTPCode() debería aceptar un código válido recién generado")
	}
}

func TestVerifyTOTPCode_CodigoInvalidoFalla(t *testing.T) {
	enrollment, err := auth.GenerateTOTPSecret("ana", "BitacoraSOC")
	if err != nil {
		t.Fatalf("GenerateTOTPSecret() error inesperado: %v", err)
	}
	if auth.VerifyTOTPCode(enrollment.Secret, "000000") {
		t.Fatal("VerifyTOTPCode() no debería aceptar un código arbitrario")
	}
}
