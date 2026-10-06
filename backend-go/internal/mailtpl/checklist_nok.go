package mailtpl

import (
	"fmt"
	"strings"
	"time"
)

// NokService es un servicio en rojo del checklist, con su observación.
type NokService struct{ Title, Observation string }

// escapeNok es escapeHtml de routes/checklist.js del legacy (sí escapa el apóstrofo).
func escapeNok(v string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(v)
}

// legacyLocaleString es new Date().toLocaleString() del servidor legacy
// (Node sin LANG = en-US): "10/5/2026, 3:04:05 PM".
func legacyLocaleString(t time.Time) string {
	return t.Format("1/2/2006, 3:04:05 PM")
}

// ChecklistNok es la alerta "checklist con ítems NOK" del legacy
// (buildNokChecklistEmailHtml de routes/checklist.js) con su asunto:
// "[Título] Alerta NOK checklist <turno> (<tipo>)".
func ChecklistNok(appTitle, username, shiftName, checkType string, cargos []string, services []NokService, at time.Time) Mail {
	if strings.TrimSpace(shiftName) == "" {
		shiftName = "Sin turno"
	}
	if strings.TrimSpace(username) == "" {
		username = "N/A"
	}
	cargoText := strings.Join(cargos, ", ")
	if cargoText == "" {
		cargoText = "N/A"
	}
	var items strings.Builder
	for i, s := range services {
		title, obs := s.Title, s.Observation
		if title == "" {
			title = "-"
		}
		if obs == "" {
			obs = "-"
		}
		fmt.Fprintf(&items, `
    <tr>
      <td style="padding: 10px; border: 1px solid #ddd; vertical-align: top;">%d</td>
      <td style="padding: 10px; border: 1px solid #ddd; vertical-align: top;"><strong>%s</strong></td>
      <td style="padding: 10px; border: 1px solid #ddd; vertical-align: top; white-space: pre-wrap;">%s</td>
    </tr>
  `, i+1, escapeNok(title), escapeNok(obs))
	}
	html := fmt.Sprintf(`
    <div style="font-family: Arial, sans-serif; color: #1f2937;">
      <h2 style="margin-bottom: 8px;">Alerta checklist con items NOK</h2>
      <p style="margin: 0 0 8px 0;"><strong>Analista:</strong> %s</p>
      <p style="margin: 0 0 8px 0;"><strong>Turno:</strong> %s</p>
      <p style="margin: 0 0 8px 0;"><strong>Tipo de checklist:</strong> %s</p>
      <p style="margin: 0 0 8px 0;"><strong>Cargos notificados:</strong> %s</p>
      <p style="margin: 0 0 16px 0;"><strong>Fecha:</strong> %s</p>

      <table style="width: 100%%; border-collapse: collapse; margin-top: 8px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left; width: 48px;">#</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Servicio NOK</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Detalle / observacion</th>
          </tr>
        </thead>
        <tbody>
          %s
        </tbody>
      </table>
    </div>
  `, escapeNok(username), escapeNok(shiftName), escapeNok(strings.ToUpper(checkType)), escapeNok(cargoText), legacyLocaleString(at), items.String())
	return Mail{
		Subject: BrandedSubject(appTitle, fmt.Sprintf("Alerta NOK checklist %s (%s)", shiftName, checkType)),
		HTML:    html,
		Text:    "",
	}
}
