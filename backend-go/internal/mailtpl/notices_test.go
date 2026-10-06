package mailtpl

import (
	"strings"
	"testing"
	"time"
)

func TestSMTPTestLikeLegacy(t *testing.T) {
	m := SMTPTest("Bitácora CDC", time.Date(2026, 10, 5, 17, 4, 5, 123e6, time.FixedZone("CLT", -3*3600)))
	if m.Subject != "Prueba de Configuracion SMTP - Bitácora CDC" {
		t.Fatalf("asunto %q", m.Subject)
	}
	want := `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Prueba Exitosa</h2>
        <p>Correo de prueba enviado desde <strong>Bitácora CDC</strong>.</p>
        <p>La configuracion SMTP esta funcionando correctamente.</p>
        <hr>
        <small>Fecha: 2026-10-05T20:04:05.123Z</small>
      </div>
    `
	if m.HTML != want {
		t.Fatalf("html distinto:\n%s", m.HTML)
	}
	if SMTPTest("", time.Now()).Subject != "Prueba de Configuracion SMTP" {
		t.Fatal("sin título va el asunto solo")
	}
	if !strings.Contains(SMTPTest("", time.Now()).HTML, "<strong>el sistema</strong>") {
		t.Fatal("sin título dice 'el sistema'")
	}
}

func TestForcedPasswordChangeLikeLegacy(t *testing.T) {
	m := ForcedPasswordChange("Bitácora CDC", "Ana Rojas")
	if m.Subject != "[Bitácora CDC] Cambio obligatorio de contraseña" {
		t.Fatalf("asunto %q", m.Subject)
	}
	want := `
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #1f2937;">
            <h2 style="margin: 0 0 12px; color: #b91c1c;">Cambio obligatorio de contraseña</h2>
            <p>Hola <strong>Ana Rojas</strong>,</p>
            <p>
              Se ha aplicado una política de seguridad en <strong>Bitácora CDC</strong>.
              En tu próximo ingreso deberás cambiar tu contraseña obligatoriamente.
            </p>
            <p>Si tienes dudas, contacta al administrador del sistema.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="font-size: 12px; color: #6b7280; margin: 0;">Mensaje automático de Equipo Bitácora CDC.</p>
          </div>
        `
	if m.HTML != want {
		t.Fatalf("html distinto:\n%s", m.HTML)
	}
	if !strings.HasPrefix(m.Text, "Hola Ana Rojas,\n\nSe ha aplicado una política de seguridad en Bitácora CDC.") || !strings.HasSuffix(m.Text, "Saludos,\nEquipo Bitácora CDC") {
		t.Fatalf("texto %q", m.Text)
	}
	plain := ForcedPasswordChange("", "")
	if plain.Subject != "Cambio obligatorio de contraseña" || !strings.Contains(plain.HTML, "Hola <strong>usuario</strong>") || !strings.Contains(plain.HTML, "Equipo SOC") {
		t.Fatalf("sin título ni nombre: %q", plain.Subject)
	}
}
