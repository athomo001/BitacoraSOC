package mailtpl

import (
	"bytes"
	_ "embed"
	"fmt"
	"regexp"
	"strings"
	"text/template"
	"time"

	"golang.org/x/text/unicode/norm"
)

// ShiftService es un ítem del checklist (services de ShiftCheck en el legacy).
type ShiftService struct {
	ServiceID, Title, Status, Observation, ParentID string
	correlated                                      *shiftCorrelation
}

type shiftCorrelation struct{ Title, Observation string }

// ShiftChecklist es el checklist de inicio o de cierre del turno.
type ShiftChecklist struct {
	CreatedAt     time.Time
	ChecklistID   string
	ChecklistName string
	Services      []ShiftService
}

// ShiftEntry es una entrada de la bitácora del periodo. Time reemplaza la
// hora calculada de CreatedAt (el legacy mostraba entryTime tal cual, "14:21").
type ShiftEntry struct {
	EntryType, Content, ClientName, Time string
	CreatedAt                            time.Time
}

// ShiftReportOptions es lo que recibía generateReportHTML del legacy.
type ShiftReportOptions struct {
	ShiftName, StartTime, EndTime    string
	IncludeChecklist, IncludeEntries bool
	Entry, Exit                      *ShiftChecklist
	Entries                          []ShiftEntry
	PeriodStart, PeriodEnd           *time.Time
	AppTitle, FaviconURL             string
	Now                              time.Time // si no hay fin de periodo, la fecha del encabezado
	Location                         *time.Location
}

//go:embed templates/shift_report.html
var shiftSource string

var shiftTemplate = template.Must(template.New("shift").Parse(shiftSource))

type shiftCard struct {
	IsChild                                           bool
	HeaderBg, Indicator, Title, EntryBlock, ExitBlock string
}

type shiftEntryView struct{ Header, Subtitle, Content string }

// RenderShiftReport arma el "Reporte de Turno" igual que generateReportHTML
// del legacy (backend/src/utils/shift-report.js).
func RenderShiftReport(o ShiftReportOptions) (string, error) {
	loc := o.Location
	if loc == nil {
		loc = time.Local
	}
	e := escapeShift
	appTitle := strings.TrimSpace(o.AppTitle)
	favicon := strings.TrimSpace(o.FaviconURL)
	dateRef := o.Now
	if o.PeriodEnd != nil {
		dateRef = *o.PeriodEnd
	}
	periodLabel := ""
	if o.PeriodStart != nil && o.PeriodEnd != nil {
		periodLabel = fmt.Sprintf("%s %s - %s %s", shiftDate(o.PeriodStart, loc), shiftTime(o.PeriodStart, loc), shiftDate(o.PeriodEnd, loc), shiftTime(o.PeriodEnd, loc))
	}

	entry, exit := cloneChecklist(o.Entry), cloneChecklist(o.Exit)
	if o.IncludeChecklist {
		correlateServices(entry)
		correlateServices(exit)
	}
	type row struct {
		serviceID   string
		entry, exit *ShiftService
	}
	var rows []row
	parentIDs := map[string]bool{}
	if o.IncludeChecklist {
		keyOf := func(s ShiftService) string {
			if s.ServiceID != "" {
				return s.ServiceID
			}
			return s.Title
		}
		entryMap, exitMap := map[string]*ShiftService{}, map[string]*ShiftService{}
		var order []string
		seen := map[string]bool{}
		add := func(c *ShiftChecklist, m map[string]*ShiftService) {
			if c == nil {
				return
			}
			for i := range c.Services {
				k := keyOf(c.Services[i])
				m[k] = &c.Services[i]
				if !seen[k] {
					seen[k] = true
					order = append(order, k)
				}
			}
		}
		add(entry, entryMap)
		add(exit, exitMap)
		for _, k := range order {
			id := ""
			if s := entryMap[k]; s != nil && s.ServiceID != "" {
				id = s.ServiceID
			} else if s := exitMap[k]; s != nil {
				id = s.ServiceID
			}
			rows = append(rows, row{serviceID: id, entry: entryMap[k], exit: exitMap[k]})
		}
		for _, c := range []*ShiftChecklist{entry, exit} {
			if c != nil {
				for _, s := range c.Services {
					if s.ParentID != "" {
						parentIDs[s.ParentID] = true
					}
				}
			}
		}
	}
	var leaves []row
	for _, r := range rows {
		if !parentIDs[r.serviceID] {
			leaves = append(leaves, r)
		}
	}
	compare := sameChecklistContext(entry, exit)
	entryTime, exitTime := shiftTime(checkTime(entry), loc), shiftTime(checkTime(exit), loc)

	totalOK, totalError := 0, 0
	for _, r := range leaves {
		hasError := (r.entry != nil && r.entry.Status == "rojo") || (r.exit != nil && r.exit.Status == "rojo")
		hasOK := (r.entry != nil && r.entry.Status == "verde") || (r.exit != nil && r.exit.Status == "verde")
		if hasError {
			totalError++
		} else if hasOK {
			totalOK++
		}
	}
	counts := map[string]int{}
	for _, en := range o.Entries {
		counts[canonicalEntryType(en.EntryType)]++
	}

	var cards []shiftCard
	for _, r := range leaves {
		title := "Servicio"
		if r.entry != nil && r.entry.Title != "" {
			title = r.entry.Title
		} else if r.exit != nil && r.exit.Title != "" {
			title = r.exit.Title
		}
		isChild := (r.entry != nil && r.entry.ParentID != "") || (r.exit != nil && r.exit.ParentID != "")
		c := shiftCard{IsChild: isChild, Title: e(title), HeaderBg: "#f7f9fb",
			EntryBlock: serviceStatusBlock(r.entry, nil, false, false),
			ExitBlock:  serviceStatusBlock(r.exit, r.entry, true, compare)}
		if isChild {
			c.HeaderBg, c.Indicator = "#fafbfc", `<span style="color:#78909c;margin-right:6px;font-weight:700;">└─</span>`
		}
		cards = append(cards, c)
	}

	entryLabel, exitLabel := "—", "—"
	if entry != nil {
		entryLabel = entryTime
	}
	if exit != nil {
		exitLabel = exitTime
	}
	var entries []shiftEntryView
	for _, en := range o.Entries {
		date := shiftDate(&en.CreatedAt, loc)
		hour := en.Time
		if hour == "" {
			hour = shiftTime(&en.CreatedAt, loc)
		}
		header := e(hour)
		if date != "" {
			header += " • " + e(date)
		}
		typeLabel := "ENTRADA"
		if en.EntryType != "" {
			typeLabel = strings.ToUpper(en.EntryType)
		}
		subtitle := "Tipo: " + e(typeLabel)
		if en.ClientName != "" {
			subtitle += " • Cliente: " + e(en.ClientName)
		}
		entries = append(entries, shiftEntryView{Header: header, Subtitle: subtitle, Content: strings.ReplaceAll(e(en.Content), "\n", "<br>")})
	}
	footer := appTitle
	if footer == "" {
		footer = "el sistema"
	}
	data := map[string]any{
		"Favicon":          e(favicon),
		"AppTitle":         e(appTitle),
		"ShiftName":        e(o.ShiftName),
		"StartTime":        e(o.StartTime),
		"EndTime":          e(o.EndTime),
		"DateLabel":        e(shiftDate(&dateRef, loc)),
		"PeriodLabel":      e(periodLabel),
		"CardOK":           summaryCard("OK", totalOK, "#e8f5e9", "#c8e6c9", "#1b5e20", "#2e7d32"),
		"CardNoOK":         summaryCard("NO OK", totalError, "#ffebee", "#ffcdd2", "#b71c1c", "#c62828"),
		"CardEntries":      summaryCard("Entradas", len(o.Entries), "#e3f2fd", "#bbdefb", "#0d47a1", "#1565c0"),
		"IncludeEntries":   o.IncludeEntries,
		"CardOperativa":    summaryCard("Operativa", counts["operativa"], "#e8f5e9", "#c8e6c9", "#1b5e20", "#2e7d32"),
		"CardOfensa":       summaryCard("Ofensa", counts["ofensa"], "#fff8e1", "#ffecb3", "#ef6c00", "#f57c00"),
		"CardIncidente":    summaryCard("Incidente", counts["incidente"], "#ffebee", "#ffcdd2", "#b71c1c", "#c62828"),
		"IncludeChecklist": o.IncludeChecklist,
		"NoChecklistData":  len(leaves) == 0,
		"Compare":          compare,
		"SplitColumns":     o.IncludeChecklist && len(leaves) > 0 && !compare,
		"Cards":            cards,
		"EntryTime":        e(entryTime),
		"ExitTime":         e(exitTime),
		"EntryColumn":      compactColumn(entry, parentIDs, "Entrada", entryLabel),
		"ExitColumn":       compactColumn(exit, parentIDs, "Salida", exitLabel),
		"Entries":          entries,
		"FooterTitle":      e(footer),
	}
	var out bytes.Buffer
	if err := shiftTemplate.Execute(&out, data); err != nil {
		return "", err
	}
	return outlookConditionals.ReplaceAllString(out.String(), ""), nil
}

// ShiftReportSubject es el asunto del legacy: la plantilla del turno con
// [fecha]/[turno]/[hora] y el título de la app adelante ("[Bitácora CDC] …").
func ShiftReportSubject(tpl, appTitle, date, shiftName, hour string) string {
	subject := caseInsensitive("[fecha]").ReplaceAllLiteralString(tpl, date)
	subject = caseInsensitive("[turno]").ReplaceAllLiteralString(subject, shiftName)
	subject = caseInsensitive("[hora]").ReplaceAllLiteralString(subject, hour)
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

func caseInsensitive(literal string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)` + regexp.QuoteMeta(literal))
}

// escapeShift es escapeHtml de shift-report.js (vacío si no hay valor).
func escapeShift(v string) string {
	if v == "" {
		return ""
	}
	return escapeBulletin(v)
}

// shiftTime es formatTime del legacy: toLocaleTimeString('es-CL') → "09:05 a. m.".
func shiftTime(t *time.Time, loc *time.Location) string {
	if t == nil || t.IsZero() {
		return "No completado"
	}
	l := t.In(loc)
	h := l.Hour() % 12
	if h == 0 {
		h = 12
	}
	suffix := "a. m."
	if l.Hour() >= 12 {
		suffix = "p. m."
	}
	return fmt.Sprintf("%02d:%02d %s", h, l.Minute(), suffix)
}

// shiftDate es formatDate del legacy: dd-mm-aaaa.
func shiftDate(t *time.Time, loc *time.Location) string {
	if t == nil || t.IsZero() {
		return ""
	}
	return t.In(loc).Format("02-01-2006")
}

func checkTime(c *ShiftChecklist) *time.Time {
	if c == nil {
		return nil
	}
	return &c.CreatedAt
}

func cloneChecklist(c *ShiftChecklist) *ShiftChecklist {
	if c == nil {
		return nil
	}
	cp := *c
	cp.Services = append([]ShiftService(nil), c.Services...)
	return &cp
}

// stripMarks: normalize('NFD').replace(/[̀-ͯ]/g, ”) del legacy.
func stripMarks(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if r < 0x300 || r > 0x36f {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normalizeName(s string) string { return strings.ToLower(strings.TrimSpace(stripMarks(s))) }

var spaces = regexp.MustCompile(`\s+`)

func canonicalEntryType(v string) string {
	switch spaces.ReplaceAllString(normalizeName(v), "") {
	case "operativa", "operativas":
		return "operativa"
	case "ofensa", "ofensas":
		return "ofensa"
	case "incidente", "incidentes":
		return "incidente"
	}
	return ""
}

func sameChecklistContext(a, b *ShiftChecklist) bool {
	if a == nil || b == nil {
		return false
	}
	if a.ChecklistID != "" && b.ChecklistID != "" {
		return a.ChecklistID == b.ChecklistID
	}
	na, nb := normalizeName(a.ChecklistName), normalizeName(b.ChecklistName)
	if na != "" && nb != "" {
		return na == nb
	}
	return false
}

var (
	parenthesized = regexp.MustCompile(`\(.*?\)`)
	stopWords     = map[string]bool{"todos": true, "los": true, "conectar": true, "actualizar": true, "revision": true, "general": true, "salud": true,
		"delitos": true, "turno": true, "anterior": true, "del": true, "con": true, "para": true, "una": true, "uno": true, "las": true,
		"por": true, "sus": true, "componentes": true, "alerta": true, "alertas": true, "plataforma": true, "graves": true, "criticos": true}
)

func keywordsFor(title string) []string {
	clean := strings.ToLower(stripMarks(parenthesized.ReplaceAllString(title, "")))
	var out []string
	for _, w := range spaces.Split(clean, -1) {
		w = strings.TrimSpace(w)
		if len([]rune(w)) > 2 && !stopWords[w] {
			out = append(out, w)
		}
	}
	return out
}

// correlateServices es correlateBackendServices del legacy: un ítem en rojo
// sin observación toma la de un pariente (hijo, padre o hermano) en rojo con
// observación, o la de otro ítem cuya observación mencione sus palabras clave.
func correlateServices(c *ShiftChecklist) {
	if c == nil {
		return
	}
	var withObs []*ShiftService
	for i := range c.Services {
		if s := &c.Services[i]; s.Status == "rojo" && s.Observation != "" {
			withObs = append(withObs, s)
		}
	}
	find := func(pred func(*ShiftService) bool) *ShiftService {
		for _, o := range withObs {
			if pred(o) {
				return o
			}
		}
		return nil
	}
	for i := range c.Services {
		s := &c.Services[i]
		if s.Status != "rojo" || s.Observation != "" {
			continue
		}
		var match *ShiftService
		if s.ServiceID != "" {
			match = find(func(o *ShiftService) bool { return o.ParentID != "" && o.ParentID == s.ServiceID })
		}
		if match == nil && s.ParentID != "" {
			match = find(func(o *ShiftService) bool { return o.ServiceID != "" && o.ServiceID == s.ParentID })
			if match == nil {
				match = find(func(o *ShiftService) bool { return o.ParentID == s.ParentID && o.ServiceID != s.ServiceID })
			}
		}
		if match == nil {
			keywords := keywordsFor(s.Title)
			if s.ParentID != "" {
				for _, p := range c.Services {
					if p.ServiceID == s.ParentID {
						seen := map[string]bool{}
						var merged []string
						for _, k := range append(keywords, keywordsFor(p.Title)...) {
							if !seen[k] {
								seen[k] = true
								merged = append(merged, k)
							}
						}
						keywords = merged
						break
					}
				}
			}
			if len(keywords) > 0 {
				match = find(func(o *ShiftService) bool {
					if o.Title == s.Title {
						return false
					}
					obs := normalizeName(o.Observation)
					for _, k := range keywords {
						if strings.Contains(obs, k) {
							return true
						}
					}
					return false
				})
			}
		}
		if match != nil {
			s.correlated = &shiftCorrelation{Title: match.Title, Observation: match.Observation}
		}
	}
}

func statusPill(label, color string) string {
	return fmt.Sprintf(`<span style="display:inline-block;background:%s;color:#ffffff;font-size:11px;font-weight:700;line-height:1;padding:6px 10px;border-radius:999px;letter-spacing:0.2px;">%s</span>`, color, label)
}

func summaryCard(label string, value int, bg, border, valueColor, labelColor string) string {
	return fmt.Sprintf(`
    <td style="display:table-cell !important;width:33.3333%% !important;vertical-align:top;padding:0 5px;">
      <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background-color:%s;border:1px solid %s;border-radius:8px;">
        <tr>
          <td style="padding:16px 10px 14px 10px;text-align:center;">
            <p style="margin:0 0 6px 0;font-size:30px;font-weight:700;color:%s;line-height:1;">%d</p>
            <p style="margin:0;font-size:12px;font-weight:600;color:%s;letter-spacing:0.4px;">%s</p>
          </td>
        </tr>
      </table>
    </td>
  `, bg, border, valueColor, value, labelColor, label)
}

// serviceStatusBlock es renderServiceStatusBlock del legacy.
func serviceStatusBlock(s, entryService *ShiftService, isExit, allowRepaired bool) string {
	if s == nil {
		return `
      <div style="font-size:12px;color:#90a4ae;line-height:1.3;">—</div>
    `
	}
	repaired := isExit && allowRepaired && s.Status == "verde" && entryService != nil && entryService.Status == "rojo"
	pill := statusPill("OK", "#2e7d32")
	if repaired {
		pill = statusPill("REPARADO", "#f57f17")
	} else if s.Status == "rojo" {
		pill = statusPill("ERROR", "#c62828")
	}
	observation := strings.TrimSpace(s.Observation)
	repairedHint, obsHTML, corrHTML := "", "", ""
	if repaired {
		repairedHint = `<div style="margin-top:6px;font-size:11px;color:#8d6e63;line-height:1.25;">Fue ERROR en entrada</div>`
	}
	if observation != "" {
		obsHTML = `<div style="margin-top:6px;font-size:12px;color:#37474f;line-height:1.35;"><strong>Obs:</strong> ` + escapeShift(observation) + `</div>`
	} else if s.correlated != nil {
		corrHTML = fmt.Sprintf(`
      <div style="margin-top:6px;padding:6px 8px;background-color:#fffdf6;border-radius:4px;border:1px dashed #ffd54f;font-size:11px;line-height:1.3;color:#263238;">
        <strong style="color:#ef6c00;">Causa relacionada (%s):</strong>
        <div style="font-style:italic;margin-top:2px;">"%s"</div>
      </div>
    `, escapeShift(s.correlated.Title), escapeShift(s.correlated.Observation))
	}
	return fmt.Sprintf(`
    <div>%s</div>
    %s
    %s
    %s
  `, pill, repairedHint, obsHTML, corrHTML)
}

// compactColumn es renderCompactChecklistColumn del legacy (plantillas de
// entrada y salida distintas: dos listas lado a lado).
func compactColumn(c *ShiftChecklist, parentIDs map[string]bool, title, timeLabel string) string {
	var services []ShiftService
	if c != nil {
		for _, s := range c.Services {
			if s.ServiceID == "" || !parentIDs[s.ServiceID] {
				services = append(services, s)
			}
		}
	}
	rows := `<tr><td style="padding:7px 0;font-size:12px;color:#90a4ae;">Sin registros</td></tr>`
	if len(services) > 0 {
		var b strings.Builder
		for _, s := range services {
			isChild := s.ParentID != ""
			pill := statusPill("OK", "#2e7d32")
			if s.Status == "rojo" {
				pill = statusPill("ERROR", "#c62828")
			}
			name := "Servicio"
			if s.Title != "" {
				name = s.Title
			}
			indicator, indent := "", ""
			if isChild {
				indicator, indent = `<span style="color:#90a4ae;font-weight:700;margin-right:4px;">└─</span>`, "padding-left:16px;"
			}
			detail := ""
			if obs := strings.TrimSpace(s.Observation); obs != "" {
				detail = `<div style="margin:3px 0 0 0;font-size:11px;color:#546e7a;line-height:1.3;"><strong>Obs:</strong> ` + escapeShift(obs) + `</div>`
			} else if s.correlated != nil {
				detail = `<div style="margin:3px 0 0 0;font-size:11px;color:#8d6e63;line-height:1.3;">↳ ` + escapeShift(s.correlated.Title) + `: "` + escapeShift(s.correlated.Observation) + `"</div>`
			}
			fmt.Fprintf(&b, `
        <tr>
          <td style="padding:7px 0;border-top:1px solid #eef2f5;%s">
            <div style="font-size:12px;color:#263238;line-height:1.5;">%s<span style="margin-left:6px;font-weight:600;">%s%s</span></div>
            %s
          </td>
        </tr>
      `, indent, pill, indicator, escapeShift(name), detail)
		}
		rows = b.String()
	}
	// mj-text recorta los espacios del contenido.
	return strings.TrimSpace(fmt.Sprintf(`
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ea;border-radius:8px;background:#ffffff;overflow:hidden;">
      <tr>
        <td style="background:#f7f9fb;padding:11px 13px;font-size:13px;font-weight:700;color:#263238;">%s <span style="color:#78909c;font-weight:600;">(%s)</span></td>
      </tr>
      <tr>
        <td style="padding:2px 13px 9px 13px;">
          <table role="presentation" width="100%%" cellpadding="0" cellspacing="0">%s</table>
        </td>
      </tr>
    </table>
  `, escapeShift(title), escapeShift(timeLabel), rows))
}
