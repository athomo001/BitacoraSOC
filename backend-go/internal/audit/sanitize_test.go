package audit_test

import (
	"strings"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
)

func TestSanitizeMetadata_RedactaClavesSensibles(t *testing.T) {
	input := map[string]any{
		"username":    "ana",
		"password":    "hunter2",
		"newPassword": "hunter3",
		"token":       "abc.def.ghi",
		"jwtToken":    "abc.def.ghi",
		"apiSecret":   "sh",
		"safeField":   "valor normal",
	}

	out := audit.SanitizeMetadata(input)

	for _, sensitiveKey := range []string{"password", "newPassword", "token", "jwtToken", "apiSecret"} {
		if out[sensitiveKey] != audit.RedactedValue {
			t.Errorf("clave %q = %v, se esperaba el valor redactado %q", sensitiveKey, out[sensitiveKey], audit.RedactedValue)
		}
	}
	if out["username"] != "ana" || out["safeField"] != "valor normal" {
		t.Errorf("se redactaron campos que no debían tocarse: %+v", out)
	}
}

func TestSanitizeMetadata_RedactaSinImportarMayusculas(t *testing.T) {
	out := audit.SanitizeMetadata(map[string]any{"Password": "x", "PASSWORD_HASH": "y"})
	if out["Password"] != audit.RedactedValue || out["PASSWORD_HASH"] != audit.RedactedValue {
		t.Errorf("la redacción debería ser insensible a mayúsculas: %+v", out)
	}
}

func TestSanitizeMetadata_TruncaSiExcedeElTope(t *testing.T) {
	huge := strings.Repeat("a", audit.MaxMetadataBytes+1000)
	out := audit.SanitizeMetadata(map[string]any{"blob": huge})

	if out["_truncated"] != true {
		t.Fatalf("se esperaba _truncated=true, metadata = %+v", out)
	}
	if _, hasOriginalSize := out["_originalSize"]; !hasOriginalSize {
		t.Fatalf("se esperaba _originalSize presente cuando se trunca, metadata = %+v", out)
	}
	if _, hasBlob := out["blob"]; hasBlob {
		t.Fatalf("el metadata truncado no debería conservar el campo gigante original: %+v", out)
	}
}

func TestSanitizeMetadata_NoTruncaSiEstaDentroDelTope(t *testing.T) {
	out := audit.SanitizeMetadata(map[string]any{"campo": "corto"})
	if _, truncated := out["_truncated"]; truncated {
		t.Fatalf("no debería marcarse _truncated para metadata chico: %+v", out)
	}
}

func TestSanitizeMetadata_NilNoRompe(t *testing.T) {
	out := audit.SanitizeMetadata(nil)
	if out == nil {
		t.Fatal("SanitizeMetadata(nil) no debería devolver nil (el llamador no debería tener que chequear)")
	}
}
