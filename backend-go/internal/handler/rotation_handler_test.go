package handler

import (
	"strings"
	"testing"
)

func TestCleanRecipients(t *testing.T) {
	got, bad := cleanRecipients([]string{" noc@empresa.cl ", "", "NOC@empresa.cl", "jefe@empresa.cl"})
	if bad != "" || strings.Join(got, ",") != "noc@empresa.cl,jefe@empresa.cl" {
		t.Fatalf("limpieza incorrecta: %v %q", got, bad)
	}
	if _, bad := cleanRecipients([]string{"ok@empresa.cl", "no-es-correo"}); bad != "no-es-correo" {
		t.Fatalf("debió rechazar el correo inválido, rechazó %q", bad)
	}
	if got, bad := cleanRecipients(nil); bad != "" || got == nil || len(got) != 0 {
		t.Fatalf("sin destinatarios debe quedar lista vacía (no nil): %v", got)
	}
}
