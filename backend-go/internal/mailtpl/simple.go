package mailtpl

import (
	"fmt"
	"regexp"
	"strings"
)

// DefaultAppTitle es el nombre que llevan los correos mientras no exista
// Administración → Marca (en el legacy, appConfig.appTitle).
const DefaultAppTitle = "Bitácora Ops"

// BrandedSubject es formatBrandedSubject del legacy: "[Título] asunto".
func BrandedSubject(appTitle, subject string) string {
	title, subject := strings.TrimSpace(appTitle), strings.TrimSpace(subject)
	switch {
	case title != "" && subject != "":
		return "[" + title + "] " + subject
	case subject != "":
		return subject
	default:
		return title
	}
}

// AppTitleForText es getAppTitleForText del legacy.
func AppTitleForText(appTitle string) string {
	if t := strings.TrimSpace(appTitle); t != "" {
		return t
	}
	return "el sistema"
}

// Mail es un correo con su versión HTML y la de texto plano (el legacy
// mandaba las dos).
type Mail struct{ Subject, HTML, Text string }

// PasswordRecovery es buildPasswordRecoveryEmail del legacy con el asunto
// que armaba routes/auth.js. resetURL lo arma la app (token hexadecimal).
func PasswordRecovery(resetURL, appTitle string) Mail {
	title := strings.TrimSpace(appTitle)
	systemName, teamName, subject := AppTitleForText(title), "Equipo de soporte", "Recuperación de Contraseña"
	if title != "" {
		teamName, subject = "Equipo "+title, "Recuperación de Contraseña - "+title
	}
	text := fmt.Sprintf("Hola,\n\nHemos recibido una solicitud para resetear tu contraseña en %s.\n\nHaz click en el siguiente enlace para crear una nueva contraseña:\n%s\n\nEste enlace expirará en 5 minutos.\n\nSi no solicitaste este cambio, ignora este email.\n\nSaludos,\n%s", systemName, resetURL, teamName)
	html := fmt.Sprintf(`
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1976d2;">Recuperación de Contraseña</h2>
      <p>Hola,</p>
      <p>Hemos recibido una solicitud para resetear tu contraseña en %s.</p>
      <p>Haz click en el siguiente botón para crear una nueva contraseña:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="%s" style="background-color: #1976d2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Resetear Contraseña
        </a>
      </div>
      <p><small>O copia y pega este enlace en tu navegador:<br>%s</small></p>
      <p style="color: #f44336;"><strong>⏰ Este enlace expirará en 5 minutos.</strong></p>
      <p>Si no solicitaste este cambio, ignora este email.</p>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">Saludos,<br>%s</p>
    </div>
  `, escapeBulletin(systemName), escapeBulletin(resetURL), escapeBulletin(resetURL), escapeBulletin(teamName))
	return Mail{Subject: subject, HTML: html, Text: text}
}

// \s de JavaScript incluye los espacios Unicode.
var reminderBullet = regexp.MustCompile(`^(\*|-|•)[\s\x{00a0}\x{feff}\x{2028}\x{2029}\p{Zs}]+(.*)$`)

// ShiftReminder es buildReminderHtml del legacy (templates/email/shiftReminder.js)
// con el asunto de shiftReminderScheduler: "[Título] etiqueta".
func ShiftReminder(appTitle, label, reminderText string) Mail {
	safeTitle := escapeBulletin(AppTitleForText(appTitle))
	normalized := strings.ReplaceAll(strings.ReplaceAll(reminderText, "\r\n", "\n"), "\r", "\n")
	var body strings.Builder
	for _, line := range strings.Split(normalized, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			body.WriteString(`<div style="height:12px;line-height:12px;">&nbsp;</div>`)
			continue
		}
		if m := reminderBullet.FindStringSubmatch(trimmed); m != nil {
			body.WriteString(`<div style="margin:0 0 6px 0;color:#111111;font-size:15px;line-height:1.6;">&bull; ` + escapeBulletin(m[2]) + `</div>`)
			continue
		}
		body.WriteString(`<div style="margin:0 0 10px 0;color:#111111;font-size:15px;line-height:1.6;">` + strings.ReplaceAll(escapeBulletin(line), "  ", " &nbsp;") + `</div>`)
	}
	html := `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" width="560" style="border-collapse:collapse;margin:24px auto;background:#ffffff;border:1px solid #ddd;border-radius:4px;">
    <tr>
      <td style="background:#1565c0;padding:20px 24px;">
        <p style="margin:0;font-size:13px;color:#bbdefb;">` + safeTitle + `</p>
        <h2 style="margin:4px 0 0 0;color:#ffffff;font-size:20px;">Recordatorio de Turno</h2>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 24px;">
        <div style="margin:0;color:#111111;">` + body.String() + `</div>
        <p style="margin:24px 0 0 0;font-size:12px;color:#888888;line-height:1.5;">
          Este es un recordatorio automático generado por ` + safeTitle + `. No responder a este correo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
	return Mail{Subject: BrandedSubject(appTitle, label), HTML: html, Text: reminderText}
}
