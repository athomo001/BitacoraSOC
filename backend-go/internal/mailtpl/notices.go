package mailtpl

import (
	"fmt"
	"strings"
	"time"
)

// SMTPTest es el correo de prueba de routes/smtp.js del legacy
// (testSmtpConnection con sendMail): asunto "Prueba de Configuracion SMTP -
// Título" y la fecha en ISO UTC como new Date().toISOString().
func SMTPTest(appTitle string, now time.Time) Mail {
	title := strings.TrimSpace(appTitle)
	subject := "Prueba de Configuracion SMTP"
	if title != "" {
		subject += " - " + title
	}
	html := fmt.Sprintf(`
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Prueba Exitosa</h2>
        <p>Correo de prueba enviado desde <strong>%s</strong>.</p>
        <p>La configuracion SMTP esta funcionando correctamente.</p>
        <hr>
        <small>Fecha: %s</small>
      </div>
    `, escapeBulletin(AppTitleForText(title)), now.UTC().Format("2006-01-02T15:04:05.000Z"))
	return Mail{Subject: subject, HTML: html, Text: "Este es un correo de prueba. La configuracion SMTP funciona correctamente."}
}

// ForcedPasswordChange es el aviso de POST /api/users/force-password-change-all
// del legacy (routes/users.js): "[Título] Cambio obligatorio de contraseña".
func ForcedPasswordChange(appTitle, recipientName string) Mail {
	title := strings.TrimSpace(appTitle)
	systemName, teamName, subject := "la plataforma", "Equipo SOC", "Cambio obligatorio de contraseña"
	if title != "" {
		systemName, teamName, subject = title, "Equipo "+title, "["+title+"] Cambio obligatorio de contraseña"
	}
	name := strings.TrimSpace(recipientName)
	if name == "" {
		name = "usuario"
	}
	text := strings.Join([]string{
		"Hola " + name + ",",
		"",
		"Se ha aplicado una política de seguridad en " + systemName + ".",
		"En tu próximo ingreso deberás cambiar tu contraseña obligatoriamente.",
		"",
		"Si tienes dudas, contacta al administrador del sistema.",
		"",
		"Saludos,",
		teamName,
	}, "\n")
	html := fmt.Sprintf(`
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #1f2937;">
            <h2 style="margin: 0 0 12px; color: #b91c1c;">Cambio obligatorio de contraseña</h2>
            <p>Hola <strong>%s</strong>,</p>
            <p>
              Se ha aplicado una política de seguridad en <strong>%s</strong>.
              En tu próximo ingreso deberás cambiar tu contraseña obligatoriamente.
            </p>
            <p>Si tienes dudas, contacta al administrador del sistema.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="font-size: 12px; color: #6b7280; margin: 0;">Mensaje automático de %s.</p>
          </div>
        `, escapeBulletin(name), escapeBulletin(systemName), escapeBulletin(teamName))
	return Mail{Subject: subject, HTML: html, Text: text}
}
