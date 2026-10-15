package mailtpl

import (
	"bytes"
	"fmt"
	"strings"
	"time"
)

// AgendaItem es una fila del resumen diario de la Agenda (spec/16 §4.5).
type AgendaItem struct {
	Task, Detail, Who, Client string
	Due                       time.Time
	// State: "late" (atrasada), "today" (vence hoy) o "soon" (aviso antes del vencimiento).
	State string
}

// AgendaDigestOptions arma el resumen diario o un aviso inmediato de la Agenda.
type AgendaDigestOptions struct {
	Items                     []AgendaItem
	Title, PeriodLabel        string
	LogoSrc, BrandName, Intro string
	// OpenTickets: tickets abiertos de la persona (0 = no se muestra).
	OpenTickets int
	Year        int
	Location    *time.Location
}

var agendaBadges = map[string]scheduleBadge{
	"late":  {"ATRASADA", "#D32F2F"},
	"today": {"VENCE HOY", "#F57C00"},
	"soon":  {"PRÓXIMA", scheduleGreen},
}

// RenderAgendaDigest usa la plantilla de lista del legacy (la del correo de
// dotación en formato lista) tal cual, con sus mismas filas y colores: el
// resumen diario no tiene un formato propio en el legacy (decisión del dueño
// 2026-10-15: no diseñar un correo nuevo).
func RenderAgendaDigest(o AgendaDigestOptions) (string, error) {
	e := escapeCalendar
	loc := o.Location
	if loc == nil {
		loc = time.Local
	}
	var rows strings.Builder
	for i, it := range o.Items {
		border := "1px solid #D7DEC0"
		if i == len(o.Items)-1 && o.OpenTickets == 0 {
			border = "none"
		}
		b, ok := agendaBadges[it.State]
		if !ok {
			b = agendaBadges["soon"]
		}
		badge := fmt.Sprintf(`<span style="display:inline-block; white-space:nowrap; background-color:%s; color:#FFFFFF; padding:6px 12px; border-radius:4px; font-size:13px; line-height:1; font-weight:700;">%s</span>`, b.bg, e(b.label))
		due := it.Due.In(loc)
		client := it.Client
		if client == "" {
			client = "-"
		}
		fmt.Fprintf(&rows, `
      <tr>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:16px; font-weight:700; line-height:1.35;">%[2]s<br><span style="font-size:13px; font-weight:400; color:#5B695D;">%[3]s</span></td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">
          <span style="font-weight:bold; font-size:17px; display:inline-block; margin-bottom:2px;">%[4]s</span><br>
          <span style="white-space:nowrap;">%[5]s</span><br>
          <span style="white-space:nowrap;">%[6]s</span>
        </td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">%[7]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#5B695D; font-size:14px;">%[8]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; text-align:right;">%[9]s</td>
      </tr>
    `, border, e(it.Task), e(it.Detail), spanishWeekdays[due.Weekday()], due.Format("02-01-2006"), due.Format("15:04"), e(it.Who), e(client), badge)
	}
	if o.OpenTickets > 0 {
		label := "1 ticket abierto a tu nombre"
		if o.OpenTickets > 1 {
			label = fmt.Sprintf("%d tickets abiertos a tu nombre", o.OpenTickets)
		}
		fmt.Fprintf(&rows, `
      <tr>
        <td colspan="5" style="padding:14px 8px; border-bottom:none; color:#173831; font-size:15px;">%s</td>
      </tr>
    `, e(label))
	}
	if o.Intro != "" {
		rows.WriteString(fmt.Sprintf(`
      <tr>
        <td colspan="5" style="padding:14px 8px 0; border-bottom:none; color:#5B695D; font-size:14px;">%s</td>
      </tr>
    `, e(o.Intro)))
	}
	brand := o.BrandName
	if brand == "" {
		brand = "Bitácora CDC"
	}
	var buf bytes.Buffer
	err := scheduleListTemplate.Execute(&buf, map[string]any{
		"LogoSrc":     e(o.LogoSrc),
		"BrandName":   e(brand),
		"Categories":  "AGENDA",
		"Title":       e(o.Title),
		"PeriodLabel": e(o.PeriodLabel),
		"Rows":        strings.TrimRight(rows.String(), " \n"),
		"Year":        o.Year,
		"H1":          "TAREA", "H2": "VENCE", "H3": "RESPONSABLE", "H4": "CLIENTE", "H5": "ESTADO",
	})
	return buf.String(), err
}
