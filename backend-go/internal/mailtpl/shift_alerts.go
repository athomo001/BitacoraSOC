package mailtpl

import (
	"fmt"
	"strings"
	"time"
)

// legacyStamp es new Date().toLocaleString('es-CL') del legacy: «16-10-2026, 9:30:00».
func legacyStamp(t time.Time) string {
	return fmt.Sprintf("%s, %d:%02d:%02d", t.Format("02-01-2006"), t.Hour(), t.Minute(), t.Second())
}

// ChecklistMissing es sendChecklistAlertEmail del legacy (routes/smtp.js): no
// se hizo el checklist de inicio antes de la hora configurada. Mismo HTML.
func ChecklistMissing(appTitle, alertTime string, now time.Time) Mail {
	systemName := AppTitleForText(appTitle)
	dateLabel := now.Format("02-01-2006")
	html := fmt.Sprintf(`
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">⚠️ Checklist no realizado</h2>
        <p>No se registró el checklist antes de las <strong>%s</strong> (%s).</p>
        <p>Por favor revisar y completar el checklist correspondiente.</p>
        <hr style="margin-top: 20px;">
        <small style="color: #666;">%s - %s</small>
      </div>
    `, escapeBulletin(alertTime), dateLabel, escapeBulletin(systemName), legacyStamp(now))
	text := strings.Join([]string{
		"Checklist no realizado",
		"",
		fmt.Sprintf("No se registró el checklist antes de las %s (%s).", alertTime, dateLabel),
		"Por favor revisar y completar el checklist correspondiente.",
	}, "\n")
	return Mail{Subject: BrandedSubject(appTitle, "Checklist pendiente"), HTML: html, Text: text}
}

// GuardUncovered es sendEscalationInternalReminderEmail del legacy
// (routes/smtp.js): una semana futura con una guardia sin nadie. Mismo HTML;
// además nombra las guardias que faltan.
func GuardUncovered(appTitle string, cargos []string, weekStart, weekEnd time.Time, daysAhead int, guards []string, now time.Time) Mail {
	systemName := AppTitleForText(appTitle)
	cargosText := "N2"
	if len(cargos) > 0 {
		cargosText = strings.Join(cargos, ", ")
	}
	week := weekStart.Format("02-01-2006") + " al " + weekEnd.Format("02-01-2006")
	lead := fmt.Sprintf("%d día(s)", daysAhead)
	missing := ""
	if len(guards) > 0 {
		missing = fmt.Sprintf("\n        <p><strong>Guardias sin cubrir:</strong> %s</p>", escapeBulletin(strings.Join(guards, ", ")))
	}
	html := fmt.Sprintf(`
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #1565c0;">🔔 Recordatorio de escalación interna</h2>
        <p>Se detectó una semana futura sin escalación interna cargada en la ventana de anticipación (<strong>%s</strong>).</p>
        <p><strong>Semana objetivo:</strong> %s</p>%s
        <p>Fecha de evaluación: <strong>%s</strong>.</p>
        <p><strong>Cargos objetivo:</strong> %s</p>
        <hr style="margin-top: 20px;">
        <small style="color: #666;">%s - %s</small>
      </div>
    `, lead, week, missing, now.Format("02-01-2006"), escapeBulletin(cargosText), escapeBulletin(systemName), legacyStamp(now))
	text := strings.Join([]string{
		"Recordatorio de escalación interna",
		"",
		"Se detectó una semana futura sin escalación interna cargada en la ventana de anticipación (" + lead + ").",
		"Semana objetivo: " + week,
		"Guardias sin cubrir: " + strings.Join(guards, ", "),
		"Cargos objetivo: " + cargosText,
	}, "\n")
	return Mail{Subject: BrandedSubject(appTitle, "Recordatorio de escalación interna"), HTML: html, Text: text}
}
