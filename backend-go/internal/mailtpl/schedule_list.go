package mailtpl

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"
	"text/template"
	"time"
)

// ScheduleEntry es una fila del correo de dotación en lista: quién, desde y
// hasta cuándo, su cargo y el código del turno (N2, TELEWORK, VACATION…).
type ScheduleEntry struct {
	AnalystName, CargoLabel, RoleCode string
	Start, End                        time.Time
}

// ScheduleListOptions es lo que recibía buildEscalationScheduleEmail del legacy.
type ScheduleListOptions struct {
	Entries                      []ScheduleEntry
	PeriodLabel, LogoSrc         string
	BrandName, Title, Categories string
	Year                         int
	// Location para fechas y horas (el legacy usaba la zona del servidor,
	// America/Santiago).
	Location *time.Location
}

//go:embed templates/schedule_list.html
var scheduleListSource string

var scheduleListTemplate = template.Must(template.New("schedule-list").Parse(scheduleListSource))

// scheduleGreen es el verde de los turnos de guardia del legacy.
const scheduleGreen = "#155F50"

type scheduleBadge struct{ label, bg string }

// Mismos textos y colores que getBadgeInfo del legacy.
var scheduleBadges = map[string]scheduleBadge{
	"N2":                  {"OPERADOR N2", scheduleGreen},
	"TI":                  {"ESPECIALISTA TI", scheduleGreen},
	"N1_NO_HABIL":         {"GUARDIA N1", scheduleGreen},
	"TELEWORK":            {"TELETRABAJO", "#1E88E5"},
	"OL":                  {"CHARLA/CAPACITACIÓN", "#795548"},
	"VACATION":            {"VACACIONES", "#F57C00"},
	"MEDICAL_LEAVE":       {"LICENCIA MÉDICA", "#D32F2F"},
	"MEDICAL_APPOINTMENT": {"TRÁMITE MÉDICO", "#8E24AA"},
}

var spanishWeekdays = [...]string{"Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"}

func scheduleBadgeFor(roleCode string) scheduleBadge {
	if b, ok := scheduleBadges[roleCode]; ok {
		return b
	}
	if roleCode == "" {
		roleCode = "TURNO"
	}
	return scheduleBadge{strings.ToUpper(roleCode), "#5B695D"}
}

// RenderScheduleList arma el correo de dotación en formato lista
// ("Turnos de Escalamiento SOC") igual que buildEscalationScheduleEmail.
func RenderScheduleList(o ScheduleListOptions) (string, error) {
	e := escapeCalendar
	loc := o.Location
	if loc == nil {
		loc = time.Local
	}
	date := func(t time.Time) string {
		if t.IsZero() {
			return "-"
		}
		return t.In(loc).Format("02-01-2006")
	}
	clock := func(t time.Time) string {
		if t.IsZero() {
			return "-"
		}
		return t.In(loc).Format("15:04")
	}
	weekday := func(t time.Time) string {
		if t.IsZero() {
			return ""
		}
		return spanishWeekdays[t.In(loc).Weekday()]
	}
	var rows strings.Builder
	for i, s := range o.Entries {
		border := "1px solid #D7DEC0"
		if i == len(o.Entries)-1 {
			border = "none"
		}
		b := scheduleBadgeFor(s.RoleCode)
		badge := fmt.Sprintf(`<span style="display:inline-block; white-space:nowrap; background-color:%s; color:#FFFFFF; padding:6px 12px; border-radius:4px; font-size:13px; line-height:1; font-weight:700;">%s</span>`, b.bg, e(b.label))
		cargo := s.CargoLabel
		if cargo == "" {
			cargo = "-"
		}
		fmt.Fprintf(&rows, `
      <tr>
        <!-- Se incrementa el tamaño de fuente de la información del analista -->
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:16px; font-weight:700; line-height:1.35;">%[2]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">
          <!-- Día de la semana y fecha con fuentes aumentadas -->
          <span style="font-weight:bold; font-size:17px; display:inline-block; margin-bottom:2px;">%[3]s</span><br>
          <span style="white-space:nowrap;">%[4]s</span><br>
          <span style="white-space:nowrap;">%[5]s</span>
        </td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#173831; font-size:15px;">
          <!-- Finalización del turno con fuentes aumentadas -->
          <span style="font-weight:bold; font-size:17px; display:inline-block; margin-bottom:2px;">%[6]s</span><br>
          <span style="white-space:nowrap;">%[7]s</span><br>
          <span style="white-space:nowrap;">%[8]s</span>
        </td>
        <td style="padding:14px 8px; border-bottom:%[1]s; color:#5B695D; font-size:14px; white-space:nowrap;">%[9]s</td>
        <td style="padding:14px 8px; border-bottom:%[1]s; text-align:right;">%[10]s</td>
      </tr>
    `, border, e(s.AnalystName), weekday(s.Start), date(s.Start), clock(s.Start), weekday(s.End), date(s.End), clock(s.End), e(cargo), badge)
	}
	categories := strings.TrimSpace(o.Categories)
	if categories == "" {
		categories = "CALENDARIO"
	}
	brand := o.BrandName
	if brand == "" {
		brand = "Bitácora CDC"
	}
	title := o.Title
	if title == "" {
		title = "Turnos de Escalamiento SOC"
	}
	var buf bytes.Buffer
	err := scheduleListTemplate.Execute(&buf, map[string]any{
		"LogoSrc":     e(o.LogoSrc),
		"BrandName":   e(brand),
		"Categories":  e(strings.ToUpper(categories)),
		"Title":       e(title),
		"PeriodLabel": e(o.PeriodLabel),
		"Rows":        strings.TrimRight(rows.String(), " \n"), // mj-table recorta el final
		"Year":        o.Year,
	})
	return buf.String(), err
}
