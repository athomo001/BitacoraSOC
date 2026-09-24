package reporting

import (
	"bytes"
	"html/template"
)

type ShiftReport struct {
	TicketCount         int
	IncidentCount       int
	SLABreaches         int
	PendingForNextShift string
	Observations        string
	ServicesDown        []string
}

func HasActivity(report ShiftReport) bool {
	return report.TicketCount > 0 || report.IncidentCount > 0 || report.SLABreaches > 0 || len(report.ServicesDown) > 0 || report.PendingForNextShift != "" || report.Observations != ""
}

var shiftReportTemplate = template.Must(template.New("shift-report").Parse(`<!doctype html>
<html lang="es"><body style="margin:0;background:#f3f5f6;color:#20252b;font-family:Arial,sans-serif;line-height:1.45">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:16px">
<table role="presentation" width="100%" style="box-sizing:border-box;max-width:680px;margin:auto;background:#fff;border:1px solid #d8dde2">
<tr><td style="padding:24px;border-bottom:4px solid #087f8c"><h1 style="margin:0;font-size:22px">Reporte de turno</h1><p style="margin:6px 0 0;color:#66717b">Bitácora Ops · cierre operativo</p></td></tr>
<tr><td style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="8"><tr><td><strong>Tickets resueltos</strong><br>{{.TicketCount}}</td><td><strong>Incidentes</strong><br>{{.IncidentCount}}</td><td><strong>SLA incumplidos</strong><br>{{.SLABreaches}}</td></tr></table>
{{if .ServicesDown}}<h2 style="font-size:16px">Servicios pendientes</h2><ul>{{range .ServicesDown}}<li>{{.}}</li>{{end}}</ul>{{end}}
{{if .PendingForNextShift}}<h2 style="font-size:16px">Pendientes para el siguiente turno</h2><p style="white-space:pre-wrap">{{.PendingForNextShift}}</p>{{end}}
{{if .Observations}}<h2 style="font-size:16px">Observaciones</h2><p style="white-space:pre-wrap">{{.Observations}}</p>{{end}}
</td></tr></table></td></tr></table></body></html>`))

func RenderShiftReportHTML(report ShiftReport) string {
	var output bytes.Buffer
	_ = shiftReportTemplate.Execute(&output, report)
	return output.String()
}

func RenderShiftReportText(report ShiftReport) string {
	return "Reporte de turno\n\nTickets resueltos: " + itoa(report.TicketCount) + "\nIncidentes: " + itoa(report.IncidentCount) + "\nSLA incumplidos: " + itoa(report.SLABreaches) + "\nPendientes: " + report.PendingForNextShift + "\nObservaciones: " + report.Observations
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}
