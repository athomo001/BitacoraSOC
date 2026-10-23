package mailtpl

import (
	"bytes"
	"fmt"
	"strings"
)

// ClientSummaryArea son los incidentes resueltos de un área, por prioridad.
type ClientSummaryArea struct {
	Area           string
	P1, P2, P3, P4 int
}

// ClientSummaryGoal es una meta del cliente con su avance.
type ClientSummaryGoal struct {
	Name        string
	Done, Total int
	State       string
}

// ClientSummaryOptions arma el «Exportar resumen» de la Gestión (spec/16 §4.4.4).
type ClientSummaryOptions struct {
	Title, PeriodLabel   string
	LogoSrc, BrandName   string
	SLAPct, SLATarget    int // SLAPct -1 = sin datos
	Response, Resolution string
	Incidents            []ClientSummaryArea
	Goals                []ClientSummaryGoal
	Year                 int
	// NoTickets: la Ticketera está apagada; el resumen son solo las metas.
	NoTickets bool
}

// RenderClientSummary usa la plantilla de lista del legacy (la del correo de
// dotación en formato lista) tal cual, como el resumen mensual de la
// jefatura: el legacy no tiene un resumen por cliente y el dueño pidió no
// diseñar correos nuevos (spec/16 §4.4.4).
func RenderClientSummary(o ClientSummaryOptions) (string, error) {
	e := escapeCalendar
	var rows strings.Builder
	cell := `padding:14px 8px; border-bottom:1px solid #D7DEC0; color:#173831; font-size:15px;`
	section := func(label string) {
		fmt.Fprintf(&rows, `
      <tr>
        <td colspan="5" style="padding:18px 8px 6px; border-bottom:1px solid #D7DEC0; color:#5B695D; font-size:13px; font-weight:700; letter-spacing:0.04em;">%s</td>
      </tr>
    `, e(label))
	}
	if !o.NoTickets {
		slaColor := scheduleGreen
		if o.SLAPct >= 0 && o.SLAPct < o.SLATarget {
			slaColor = "#F57C00"
		}
		sla := `<span style="color:#5B695D;">-</span>`
		if o.SLAPct >= 0 {
			sla = fmt.Sprintf(`<span style="display:inline-block; white-space:nowrap; background-color:%s; color:#FFFFFF; padding:6px 12px; border-radius:4px; font-size:13px; line-height:1; font-weight:700;">%d %%</span>`, slaColor, o.SLAPct)
		}
		section("INDICADORES DEL PERÍODO")
		fmt.Fprintf(&rows, `
      <tr>
        <td style="%[1]s font-size:16px; font-weight:700;">Tickets en SLA<br><span style="font-size:13px; font-weight:400; color:#5B695D;">objetivo %[2]d %%</span></td>
        <td colspan="2" style="%[1]s">%[3]s</td>
        <td style="%[1]s">1.ª respuesta<br><span style="font-weight:bold; font-size:17px;">%[4]s</span></td>
        <td style="%[1]s text-align:right;">Resolución<br><span style="font-weight:bold; font-size:17px;">%[5]s</span></td>
      </tr>
    `, cell, o.SLATarget, sla, e(o.Response), e(o.Resolution))

		section("INCIDENTES RESUELTOS")
		if len(o.Incidents) == 0 {
			fmt.Fprintf(&rows, `
      <tr><td colspan="5" style="%s color:#5B695D;">Sin incidentes en el período.</td></tr>
    `, cell)
		}
		for _, a := range o.Incidents {
			n := func(v int) string {
				if v == 0 {
					return `<span style="color:#5B695D;">0</span>`
				}
				return fmt.Sprintf(`<span style="font-weight:bold; font-size:17px;">%d</span>`, v)
			}
			total := a.P1 + a.P2 + a.P3 + a.P4
			fmt.Fprintf(&rows, `
      <tr>
        <td style="%[1]s font-size:16px; font-weight:700;">%[2]s<br><span style="font-size:13px; font-weight:400; color:#5B695D;">%[3]d en total</span></td>
        <td style="%[1]s">P1<br>%[4]s</td>
        <td style="%[1]s">P2<br>%[5]s</td>
        <td style="%[1]s">P3<br>%[6]s</td>
        <td style="%[1]s text-align:right;">P4<br>%[7]s</td>
      </tr>
    `, cell, e(a.Area), total, n(a.P1), n(a.P2), n(a.P3), n(a.P4))
		}
	}

	section("METAS")
	if len(o.Goals) == 0 {
		fmt.Fprintf(&rows, `
      <tr><td colspan="5" style="%s color:#5B695D; border-bottom:none;">Sin metas en el período.</td></tr>
    `, cell)
	}
	for i, g := range o.Goals {
		border := "1px solid #D7DEC0"
		if i == len(o.Goals)-1 {
			border = "none"
		}
		bg := scheduleGreen
		switch g.State {
		case "En riesgo":
			bg = "#F57C00"
		case "En curso", "Por confirmar":
			bg = "#1E88E5"
		}
		badge := fmt.Sprintf(`<span style="display:inline-block; white-space:nowrap; background-color:%s; color:#FFFFFF; padding:6px 12px; border-radius:4px; font-size:13px; line-height:1; font-weight:700;">%s</span>`, bg, e(strings.ToUpper(g.State)))
		progress := "Sin hitos"
		if g.Total > 0 {
			progress = fmt.Sprintf("%d de %d hitos", g.Done, g.Total)
		}
		fmt.Fprintf(&rows, `
      <tr>
        <td colspan="3" style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:16px; font-weight:700; line-height:1.35;">%[2]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#5B695D; font-size:14px; white-space:nowrap;">%[3]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; text-align:right;">%[4]s</td>
      </tr>
    `, border, e(g.Name), e(progress), badge)
	}
	brand := o.BrandName
	if brand == "" {
		brand = "Bitácora CDC"
	}
	var buf bytes.Buffer
	err := scheduleListTemplate.Execute(&buf, map[string]any{
		"LogoSrc":     e(o.LogoSrc),
		"BrandName":   e(brand),
		"Categories":  "RESUMEN DE SERVICIO",
		"Title":       e(o.Title),
		"PeriodLabel": e(o.PeriodLabel),
		"Rows":        strings.TrimRight(rows.String(), " \n"),
		"Year":        o.Year,
		"H1":          "", "H2": "", "H3": "", "H4": "", "H5": "",
	})
	return buf.String(), err
}
