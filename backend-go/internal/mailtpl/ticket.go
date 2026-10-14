package mailtpl

import (
	"strings"
)

// TicketNotice es un aviso de la Ticketera (spec/15 §6). No es un diseño
// nuevo: es el aviso simple del legacy (PasswordRecovery): Arial, 600 px,
// título azul #1976d2, una tabla de datos y un botón, con versión en texto.
type TicketNotice struct {
	Subject    string
	Title      string
	Intro      string
	Rows       [][2]string
	Comments   []string
	ButtonText string
	ButtonURL  string
	Footer     string
}

// Ticket arma el correo. Todo lo que viene de los datos se escapa.
func Ticket(appTitle string, n TicketNotice) Mail {
	var html, text strings.Builder
	html.WriteString(`
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1976d2;">` + escapeBulletin(n.Title) + `</h2>`)
	text.WriteString(n.Title + "\n\n")
	if n.Intro != "" {
		html.WriteString(`
      <p>` + escapeBulletin(n.Intro) + `</p>`)
		text.WriteString(n.Intro + "\n\n")
	}
	if len(n.Rows) > 0 {
		html.WriteString(`
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">`)
		for _, r := range n.Rows {
			html.WriteString(`
        <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e0e0e0; color: #666; width: 35%;">` + escapeBulletin(r[0]) +
				`</td><td style="padding: 6px 8px; border-bottom: 1px solid #e0e0e0;">` + escapeBulletin(r[1]) + `</td></tr>`)
			text.WriteString(r[0] + ": " + r[1] + "\n")
		}
		html.WriteString(`
      </table>`)
		text.WriteString("\n")
	}
	for _, c := range n.Comments {
		lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(c), "\r\n", "\n"), "\n")
		for i, l := range lines {
			lines[i] = escapeBulletin(l)
		}
		html.WriteString(`
      <div style="margin: 12px 0; padding: 10px 14px; border-left: 3px solid #1976d2; background: #f5f9ff;">` + strings.Join(lines, "<br>") + `</div>`)
		text.WriteString(strings.TrimSpace(c) + "\n\n")
	}
	if n.ButtonURL != "" {
		html.WriteString(`
      <div style="text-align: center; margin: 30px 0;">
        <a href="` + escapeBulletin(n.ButtonURL) + `" style="background-color: #1976d2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">
          ` + escapeBulletin(n.ButtonText) + `
        </a>
      </div>
      <p><small>O copia y pega este enlace en tu navegador:<br>` + escapeBulletin(n.ButtonURL) + `</small></p>`)
		text.WriteString(n.ButtonText + ": " + n.ButtonURL + "\n\n")
	}
	html.WriteString(`
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">` + escapeBulletin(n.Footer) + `</p>
    </div>
  `)
	text.WriteString(n.Footer)
	return Mail{Subject: BrandedSubject(appTitle, n.Subject), HTML: html.String(), Text: text.String()}
}
