package handler

import (
	"strings"
	"testing"
)

func TestValidSenderName(t *testing.T) {
	for _, ok := range []string{"", "Bitácora Ops", "NOC · Sala 24/7", strings.Repeat("á", 100)} {
		if !validSenderName(ok) {
			t.Errorf("%q debería ser válido", ok)
		}
	}
	for _, bad := range []string{"x\r\nBcc: todos@empresa.cl", "tab\tnombre", strings.Repeat("a", 101)} {
		if validSenderName(bad) {
			t.Errorf("%q debería rechazarse", bad)
		}
	}
}
