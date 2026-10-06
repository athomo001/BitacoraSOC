package mailtpl

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"
	"text/template"
)

// OutOfOfficeColumn es un día de la grilla ("Lun", "06/10").
type OutOfOfficeColumn struct{ DayShort, DateShort string }

// OutOfOfficeRow es una persona con su estado por día: telework, training,
// vacation, medical-leave, medical-appointment u office (celda vacía).
type OutOfOfficeRow struct {
	Name, CargoLabel string
	Days             []string
}

// OutOfOfficeOptions es lo que recibía buildOutOfOfficeCalendarEmail del legacy.
type OutOfOfficeOptions struct {
	Columns              []OutOfOfficeColumn
	Rows                 []OutOfOfficeRow
	PeriodLabel, LogoSrc string
	BrandName, Title     string
	Year                 int
}

//go:embed templates/out_of_office.html
var outOfOfficeSource string

var outOfOfficeTemplate = template.Must(template.New("out-of-office").Parse(outOfOfficeSource))

type outOfOfficeStatus struct{ emoji, label, color string }

// Mismos emojis, textos y colores que STATUS_META del legacy.
var outOfOfficeMeta = map[string]outOfOfficeStatus{
	"telework":            {"🏠", "Teletrabajo", "#047857"},
	"training":            {"🎓", "Charla/Capacitación", "#b45309"},
	"vacation":            {"🏖️", "Vacaciones", "#b91c1c"},
	"medical-leave":       {"🤒", "Licencia Médica", "#b91c1c"},
	"medical-appointment": {"🏥", "Trámite Médico", "#0e7490"},
}

var outOfOfficeLegend = []string{"telework", "training", "vacation", "medical-leave", "medical-appointment"}

// escapeCalendar es e() de outOfOfficeCalendar.js (no escapa el apóstrofo).
func escapeCalendar(v string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(v)
}

// RenderOutOfOffice arma el correo "Personal Fuera de la Oficina" (calendario
// semanal Lun–Vie) igual que buildOutOfOfficeCalendarEmail del legacy.
func RenderOutOfOffice(o OutOfOfficeOptions) (string, error) {
	e := escapeCalendar
	var header strings.Builder
	for _, c := range o.Columns {
		fmt.Fprintf(&header, `
    <th style="text-align:center; padding:10px 6px; color:#5B695D; font-size:12px; white-space:nowrap; border-bottom: 2px solid #D7DEC0; border-left: 1px solid #D7DEC0;">
      %s<br><span style="font-weight:400; font-size:10.5px;">%s</span>
    </th>
  `, e(c.DayShort), e(c.DateShort))
	}
	var body strings.Builder
	if len(o.Rows) == 0 {
		fmt.Fprintf(&body, `<tr><td colspan="%d" style="padding:20px; text-align:center; font-style:italic; color:#5B695D; font-size:13px;">Sin personal registrado para la semana seleccionada</td></tr>`, 1+len(o.Columns))
	}
	for i, row := range o.Rows {
		border := "1px solid #D7DEC0"
		if i == len(o.Rows)-1 {
			border = "none"
		}
		var cells strings.Builder
		for _, status := range row.Days {
			content := ""
			if m, ok := outOfOfficeMeta[status]; ok {
				content = fmt.Sprintf(`<span style="font-size:22px; line-height:1;">%s</span><br><span style="display:inline-block; margin-top:3px; font-size:9.5px; font-weight:700; text-transform:uppercase; color:%s;">%s</span>`, m.emoji, m.color, e(m.label))
			}
			fmt.Fprintf(&cells, `<td style="padding:10px 4px; border-bottom:%s; border-left: 1px solid #D7DEC0; text-align:center; vertical-align:middle;">%s</td>`, border, content)
		}
		cargo := ""
		if row.CargoLabel != "" {
			cargo = `<br><span style="font-size:11px; font-weight:400; color:#5B695D;">` + e(row.CargoLabel) + `</span>`
		}
		fmt.Fprintf(&body, `
          <tr>
            <td style="padding:12px 8px; border-bottom:%s; color:#173831; font-size:14px; font-weight:700; line-height:1.35; white-space:nowrap;">%s%s</td>
            %s
          </tr>
        `, border, e(row.Name), cargo, cells.String())
	}
	var legend strings.Builder
	for _, status := range outOfOfficeLegend {
		m := outOfOfficeMeta[status]
		fmt.Fprintf(&legend, `<span style="display:inline-block; margin:0 14px 8px 0; font-size:12px; color:#5B695D; white-space:nowrap;"><span style="font-size:15px;">%s</span> %s</span>`, m.emoji, e(m.label))
	}
	var out bytes.Buffer
	err := outOfOfficeTemplate.Execute(&out, map[string]any{
		"LogoSrc": e(o.LogoSrc), "BrandName": e(o.BrandName), "Title": e(o.Title), "PeriodLabel": e(o.PeriodLabel),
		// mj-table recorta los espacios del final de su contenido.
		"HeaderCells": header.String(), "BodyRows": strings.TrimRight(body.String(), " \n"),
		"Legend": legend.String(), "Year": o.Year,
	})
	return out.String(), err
}
