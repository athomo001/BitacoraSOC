package mailtpl

import (
	"bytes"
	"fmt"
	"strings"
)

// MonthlyRow es una persona (o el total) del resumen mensual de la jefatura.
type MonthlyRow struct {
	Name, Level string
	// OnTimePct, SLAPct: -1 = sin datos.
	Tasks, OnTimePct, OpenLate, Skipped int
	Tickets, SLAPct, AbsentDays         int
	// GoalsDone: metas cumplidas en el mes; van bajo el nombre (la plantilla
	// del legacy tiene cinco columnas y no se le agrega una).
	GoalsDone int
}

// MonthlySummaryOptions arma el correo del resumen mensual (spec/16 §6.1, 9.7).
type MonthlySummaryOptions struct {
	Rows               []MonthlyRow
	Total              MonthlyRow
	Title, PeriodLabel string
	LogoSrc, BrandName string
	Intro              string
	Year               int
}

func monthlyPct(v int) string {
	if v < 0 {
		return "-"
	}
	return fmt.Sprintf("%d %%", v)
}

func monthlyBadge(v int) string {
	if v < 0 {
		return `<span style="color:#5B695D;">-</span>`
	}
	bg := scheduleGreen
	switch {
	case v < 75:
		bg = "#D32F2F"
	case v < 90:
		bg = "#F57C00"
	}
	return fmt.Sprintf(`<span style="display:inline-block; white-space:nowrap; background-color:%s; color:#FFFFFF; padding:6px 12px; border-radius:4px; font-size:13px; line-height:1; font-weight:700;">%s</span>`, bg, monthlyPct(v))
}

// RenderMonthlySummary usa la plantilla de lista del legacy (la del correo de
// dotación en formato lista) tal cual, como el resumen diario: el legacy no
// tiene un correo de resumen mensual y el dueño pidió no diseñar uno nuevo
// (decisión 2026-10-15).
func RenderMonthlySummary(o MonthlySummaryOptions) (string, error) {
	e := escapeCalendar
	var rows strings.Builder
	row := func(r MonthlyRow, last, bold bool) {
		border := "1px solid #D7DEC0"
		if last {
			border = "none"
		}
		weight := "700"
		name := e(r.Name)
		if r.Level != "" {
			name += fmt.Sprintf(`<br><span style="font-size:13px; font-weight:400; color:#5B695D;">%s</span>`, e(r.Level))
		}
		if r.GoalsDone > 0 {
			goals := fmt.Sprintf("%d metas cumplidas", r.GoalsDone)
			if r.GoalsDone == 1 {
				goals = "1 meta cumplida"
			}
			name += fmt.Sprintf(`<br><span style="font-size:13px; font-weight:400; color:#5B695D;">%s</span>`, goals)
		}
		if bold {
			weight = "800"
		}
		late := fmt.Sprintf("%d abiertos", r.OpenLate)
		if r.OpenLate == 1 {
			late = "1 abierto"
		}
		fmt.Fprintf(&rows, `
      <tr>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:16px; font-weight:%[2]s; line-height:1.35;">%[3]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">
          <span style="font-weight:bold; font-size:17px; display:inline-block; margin-bottom:2px;">%[4]d</span><br>
          <span style="white-space:nowrap;">a tiempo</span> %[5]s
        </td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">%[6]s<br><span style="font-size:13px; color:#5B695D;">%[7]d omitidas</span></td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">
          <span style="font-weight:bold; font-size:17px; display:inline-block; margin-bottom:2px;">%[8]d</span><br>
          <span style="white-space:nowrap;">en SLA</span> %[9]s
        </td>
        <td style="padding:14px 8px; border-bottom:%[1]s; text-align:right; color:#5B695D; font-size:14px;">%[10]d días</td>
      </tr>
    `, border, weight, name, r.Tasks, monthlyBadge(r.OnTimePct), e(late), r.Skipped, r.Tickets, monthlyBadge(r.SLAPct), r.AbsentDays)
	}
	for _, r := range o.Rows {
		row(r, false, false)
	}
	row(o.Total, o.Intro == "", true)
	if o.Intro != "" {
		fmt.Fprintf(&rows, `
      <tr>
        <td colspan="5" style="padding:14px 8px 0; border-bottom:none; color:#5B695D; font-size:14px;">%s</td>
      </tr>
    `, e(o.Intro))
	}
	brand := o.BrandName
	if brand == "" {
		brand = "Bitácora CDC"
	}
	var buf bytes.Buffer
	err := scheduleListTemplate.Execute(&buf, map[string]any{
		"LogoSrc":     e(o.LogoSrc),
		"BrandName":   e(brand),
		"Categories":  "RESUMEN MENSUAL",
		"Title":       e(o.Title),
		"PeriodLabel": e(o.PeriodLabel),
		"Rows":        strings.TrimRight(rows.String(), " \n"),
		"Year":        o.Year,
		"H1":          "PERSONA", "H2": "TAREAS", "H3": "ATRASOS", "H4": "TICKETS", "H5": "AUSENTE",
	})
	return buf.String(), err
}
