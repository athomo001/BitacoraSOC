// Package quality calcula el puntaje de calidad de registro de una persona
// (10f, Mi equipo → Calidad; spec/08 §7). Parte de las 7 heurísticas del
// legacy (calculateUserQuality en backend/src/routes/reports.js), con sus
// mismos puntos y límites, y las mejoras que eligió el dueño (2026-10-22):
//
//   - El turno es el real: va del checklist de inicio al de cierre de la
//     persona. Sin checklist, el turno se arma con sus entradas y se corta
//     cuando pasan más de 9 horas sin registrar (un turno de noche no se
//     parte a medianoche, como pasaba al agrupar por día).
//   - «Solo al inicio y al final» pasa a medir el tramo más largo sin
//     registros dentro del turno; «Solo apertura y cierre», los turnos sin
//     entradas propias (con checklist) o con solo la rutina de inicio y
//     cierre (sin él).
//   - La copia se compara sin números, IP, fechas ni horas: copiar una
//     entrada y cambiar el número de ticket también cuenta.
//   - Una entrada corta con un dato concreto (IP, equipo, ticket, CVE o un
//     ticket, servicio o activo enlazado) no baja; varias entradas seguidas
//     sobre el mismo ticket o incidente no son ráfaga. El vocabulario se
//     busca por palabra completa (en el legacy «ip» calzaba con «equipo»).
//
// Es determinista y cada descuento se explica con ejemplos de las propias
// entradas.
package quality

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// MinEntries: con menos entradas en el período no se evalúa (decisión del dueño).
const MinEntries = 10

// Las claves de las reglas, en el orden en que se muestran.
const (
	RuleCopy       = "copy"
	RuleBurst      = "burst"
	RuleBatch      = "batch"
	RuleGaps       = "gaps"
	RuleShort      = "short"
	RuleRoutine    = "routine"
	RuleVocabulary = "vocabulary"
)

// Los estados del legacy (Excelente ≥90, Estable ≥75, Simplificado ≥50,
// Sospecha de relleno bajo 50), más «sin evaluar».
const (
	StatusExcellent   = "excelente"
	StatusStable      = "estable"
	StatusSimplified  = "simplificado"
	StatusFiller      = "relleno"
	StatusNotEnough   = "sin_evaluar"
	maxExamples       = 3
	burstGap          = 2 * time.Minute
	shiftBreak        = 9 * time.Hour
	gapLimit          = 4 * time.Hour
	gapMinShift       = 5 * time.Hour
	checkTolerance    = 30 * time.Minute
	closeSearchWindow = 18 * time.Hour
	defaultShiftSpan  = 12 * time.Hour
	shortLimit        = 40
)

// Entry es una entrada de la Bitácora que cuenta (el handler ya dejó fuera
// el checklist y lo que entra por API o complementos).
type Entry struct {
	Type    string // operativa, incidente, ofensa
	Content string
	Tags    []string
	At      time.Time
	Ticket  string // id del ticket enlazado ("" si no tiene)
	Service string // id del servicio ("" si no tiene)
	Asset   bool   // tiene un activo enlazado
}

// Check es un checklist de inicio o de cierre de la persona.
type Check struct {
	At    time.Time
	Start bool          // true = inicio, false = cierre
	Shift string        // nombre del turno
	Span  time.Duration // duración planificada del turno (0 = desconocida)
}

// Example es una muestra para explicar una regla. Según la regla trae el
// texto (copia, lote, cortas), la hora y cuántas (ráfagas) o el turno y el
// tramo (tramos sin registros, turnos sin entradas).
type Example struct {
	Text  string     `json:"text,omitempty"`
	Times int        `json:"times,omitempty"`
	At    *time.Time `json:"at,omitempty"`
	Until *time.Time `json:"until,omitempty"`
	Shift string     `json:"shift,omitempty"`
	Count int        `json:"count,omitempty"`
}

// Rule es el resultado de una regla: el porcentaje medido (sobre entradas o
// turnos), cuántos de cuántos, los puntos (negativos bajan, positivos suman)
// y si pasa el límite que el legacy marcaba como vicio.
type Rule struct {
	Key      string    `json:"key"`
	Pct      float64   `json:"pct"`
	Count    int       `json:"count"`
	Of       int       `json:"of"`
	Points   float64   `json:"points"`
	Flagged  bool      `json:"flagged"`
	Examples []Example `json:"examples,omitempty"`
}

// Result es el puntaje de una persona en el período.
type Result struct {
	Entries   int    `json:"entries"`
	Shifts    int    `json:"shifts"`
	Evaluated bool   `json:"evaluated"`
	Score     int    `json:"score"`
	Status    string `json:"status"`
	Rules     []Rule `json:"rules"`
}

// StatusFor: el estado de un puntaje, con los cortes del legacy.
func StatusFor(score int) string {
	switch {
	case score >= 90:
		return StatusExcellent
	case score >= 75:
		return StatusStable
	case score >= 50:
		return StatusSimplified
	default:
		return StatusFiller
	}
}

// Evaluate calcula el puntaje de una persona con sus entradas y checklists
// del período.
func Evaluate(entries []Entry, checks []Check) Result {
	sorted := append([]Entry(nil), entries...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })
	shifts := buildShifts(sorted, checks)
	res := Result{Entries: len(sorted), Shifts: len(shifts), Status: StatusNotEnough, Rules: []Rule{}}
	if len(sorted) < MinEntries {
		return res
	}
	res.Rules = []Rule{
		copyRule(sorted),
		burstRule(sorted),
		batchRule(sorted),
		gapsRule(shifts),
		shortRule(sorted),
		routineRule(shifts),
		vocabularyRule(sorted),
	}
	score := 100.0
	for _, r := range res.Rules {
		score += r.Points
	}
	res.Score = int(math.Max(0, math.Min(100, math.Round(score))))
	res.Evaluated = true
	res.Status = StatusFor(res.Score)
	return res
}

// pct1: porcentaje con un decimal, como el toFixed(1) del legacy (los
// puntos se calculan sobre el valor ya redondeado).
func pct1(n, of int) float64 {
	if of == 0 {
		return 0
	}
	return math.Round(float64(n)*1000/float64(of)) / 10
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// penalty: un descuento en negativo (sin «-0» cuando no baja nada).
func penalty(v float64) float64 {
	if v = round1(v); v == 0 {
		return 0
	}
	return -v
}

// ---------- Turnos ----------

type shift struct {
	start, end time.Time
	name       string
	checklist  bool
	entries    []Entry
}

// buildShifts arma los turnos: primero los del checklist (de inicio a
// cierre, o la duración planificada si no hubo cierre) y después agrupa las
// entradas que quedaron fuera, cortando cuando pasan más de 9 horas.
func buildShifts(entries []Entry, checks []Check) []*shift {
	out := checklistShifts(checks)
	var loose []Entry
	for _, e := range entries {
		if s := shiftOf(out, e.At); s != nil {
			s.entries = append(s.entries, e)
		} else {
			loose = append(loose, e)
		}
	}
	var cur *shift
	for _, e := range loose {
		if cur == nil || e.At.Sub(cur.end) > shiftBreak {
			cur = &shift{start: e.At, end: e.At}
			out = append(out, cur)
		}
		cur.entries = append(cur.entries, e)
		cur.end = e.At
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].start.Before(out[j].start) })
	return out
}

// checklistShifts: un turno por cada checklist de inicio, hasta el cierre
// que lo sigue (dentro de 18 horas) o, sin cierre, la duración planificada.
func checklistShifts(checks []Check) []*shift {
	cs := append([]Check(nil), checks...)
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].At.Before(cs[j].At) })
	var out []*shift
	for i, c := range cs {
		if !c.Start {
			continue
		}
		span := c.Span
		if span <= 0 {
			span = defaultShiftSpan
		}
		end := c.At.Add(span)
		if i+1 < len(cs) && !cs[i+1].Start && cs[i+1].At.Sub(c.At) <= closeSearchWindow {
			end = cs[i+1].At
		}
		// Un inicio sin cierre no se pisa con el turno siguiente.
		if len(out) > 0 && out[len(out)-1].end.After(c.At) {
			out[len(out)-1].end = c.At
		}
		out = append(out, &shift{start: c.At, end: end, name: c.Shift, checklist: true})
	}
	return out
}

// shiftOf: el turno con checklist donde cae una hora (con 30 minutos de
// margen a cada lado: hay quien registra antes de hacer el checklist).
func shiftOf(shifts []*shift, at time.Time) *shift {
	for _, s := range shifts {
		if !at.Before(s.start.Add(-checkTolerance)) && !at.After(s.end.Add(checkTolerance)) {
			return s
		}
	}
	return nil
}

// ---------- Texto ----------

var (
	reURL      = regexp.MustCompile(`(?i)\bhttps?://\S+`)
	reIPv4     = regexp.MustCompile(`\b\d{1,3}(?:\.\d{1,3}){3}(?:/\d{1,2})?\b`)
	reDate     = regexp.MustCompile(`\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b`)
	reTime     = regexp.MustCompile(`\b\d{1,2}:\d{2}(?::\d{2})?\b`)
	reDigits   = regexp.MustCompile(`\d+`)
	reNonWord  = regexp.MustCompile(`[^\p{L}\p{N}#]+`)
	reTicket   = regexp.MustCompile(`(?i)(ticket|inc|incidente|caso|ofensa|id|solicitud|sd)\s*#?\s*\d+`)
	reLongNum  = regexp.MustCompile(`\b\d{4,8}\b`)
	reCVE      = regexp.MustCompile(`(?i)\bcve-\d{4}-\d{3,}\b`)
	reHash     = regexp.MustCompile(`(?i)\b[0-9a-f]{32,}\b`)
	reHost     = regexp.MustCompile(`(?i)\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\b`)
	reHostLike = regexp.MustCompile(`(?i)\b[a-z]{2,}[-_]?[a-z]*\d+[a-z0-9-]*\b`)
	reCaseRef  = regexp.MustCompile(`#\d+`)
	accents    = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
)

func fold(s string) string {
	out, _, err := transform.String(accents, strings.ToLower(s))
	if err != nil {
		return strings.ToLower(s)
	}
	return out
}

// copyKey: el texto sin mayúsculas, tildes, URL, IP, fechas, horas ni
// números, para que copiar y cambiar el número también cuente.
func copyKey(s string) string {
	t := fold(strings.TrimSpace(s))
	for _, re := range []*regexp.Regexp{reURL, reIPv4, reDate, reTime} {
		t = re.ReplaceAllString(t, " # ")
	}
	t = reDigits.ReplaceAllString(t, "#")
	return strings.TrimSpace(reNonWord.ReplaceAllString(t, " "))
}

// excerpt recorta un texto para mostrarlo como ejemplo.
func excerpt(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > 140 {
		return string(r[:139]) + "…"
	}
	return s
}

// ---------- Reglas ----------

// copyRule: 1,5 puntos por cada 1 % de entradas repetidas, hasta 40; se
// marca sobre el 20 %.
func copyRule(entries []Entry) Rule {
	type group struct {
		first string
		times int
		order int
	}
	groups := map[string]*group{}
	for i, e := range entries {
		k := copyKey(e.Content)
		if len([]rune(k)) <= 5 {
			continue
		}
		if g, ok := groups[k]; ok {
			g.times++
			continue
		}
		groups[k] = &group{first: e.Content, times: 1, order: i}
	}
	dup := 0
	var rep []*group
	for _, g := range groups {
		if g.times > 1 {
			dup += g.times - 1
			rep = append(rep, g)
		}
	}
	sort.Slice(rep, func(i, j int) bool {
		if rep[i].times != rep[j].times {
			return rep[i].times > rep[j].times
		}
		return rep[i].order < rep[j].order
	})
	p := pct1(dup, len(entries))
	r := Rule{Key: RuleCopy, Pct: p, Count: dup, Of: len(entries), Points: penalty(math.Min(p*1.5, 40)), Flagged: p > 20}
	for _, g := range rep {
		if len(r.Examples) == maxExamples {
			break
		}
		r.Examples = append(r.Examples, Example{Text: excerpt(g.first), Times: g.times})
	}
	return r
}

// sameThread: dos entradas del mismo ticket, o del mismo incidente (incidente
// u ofensa sobre el mismo servicio), son el seguimiento de un caso y no ráfaga.
func sameThread(a, b Entry) bool {
	if a.Ticket != "" && a.Ticket == b.Ticket {
		return true
	}
	incident := func(e Entry) bool { return e.Type == "incidente" || e.Type == "ofensa" }
	return incident(a) && incident(b) && a.Service != "" && a.Service == b.Service
}

// burstRule: 1 punto por cada 1 % de entradas a menos de 2 minutos de la
// anterior, hasta 30; se marca sobre el 25 %. El ejemplo es la racha más larga.
func burstRule(entries []Entry) Rule {
	n := 0
	var best, cur Example
	var curStart time.Time
	for i := 1; i < len(entries); i++ {
		prev, e := entries[i-1], entries[i]
		if e.At.Sub(prev.At) < burstGap && !sameThread(prev, e) {
			n++
			if cur.Count == 0 {
				curStart = prev.At
				cur = Example{Count: 1}
			}
			cur.Count++
			end := e.At
			start := curStart
			cur.At, cur.Until = &start, &end
			if cur.Count > best.Count {
				best = cur
			}
			continue
		}
		cur = Example{}
	}
	p := pct1(n, len(entries))
	r := Rule{Key: RuleBurst, Pct: p, Count: n, Of: len(entries), Points: penalty(math.Min(p, 30)), Flagged: p > 25}
	if best.Count > 0 {
		r.Examples = []Example{best}
	}
	return r
}

// batchRule: 0,8 puntos por cada 1 % de entradas que juntan más de 2 tickets
// o números de caso, hasta 20; se marca sobre el 20 %. Fechas, horas e IP no
// cuentan como números de caso.
func batchRule(entries []Entry) Rule {
	n := 0
	var ex []Example
	for _, e := range entries {
		t := e.Content
		for _, re := range []*regexp.Regexp{reURL, reIPv4, reDate, reTime} {
			t = re.ReplaceAllString(t, " ")
		}
		if len(reTicket.FindAllString(t, -1)) > 2 || len(reLongNum.FindAllString(t, -1)) > 2 {
			n++
			if len(ex) < 2 {
				ex = append(ex, Example{Text: excerpt(e.Content)})
			}
		}
	}
	p := pct1(n, len(entries))
	return Rule{Key: RuleBatch, Pct: p, Count: n, Of: len(entries), Points: penalty(math.Min(p*0.8, 20)), Flagged: p > 20, Examples: ex}
}

// gapsRule: 0,5 puntos por cada 1 % de turnos con más de 4 horas seguidas
// sin registros, hasta 20; se marca sobre el 25 %. Con checklist se mide de
// inicio a cierre; sin él, entre la primera y la última entrada (si el turno
// tiene 3 o más y dura más de 5 horas, como en el legacy).
func gapsRule(shifts []*shift) Rule {
	n := 0
	var ex []Example
	for _, s := range shifts {
		from, until := longestGap(s)
		if until.Sub(from) <= gapLimit {
			continue
		}
		n++
		if len(ex) < maxExamples {
			ex = append(ex, Example{At: &from, Until: &until, Shift: s.name})
		}
	}
	p := pct1(n, len(shifts))
	return Rule{Key: RuleGaps, Pct: p, Count: n, Of: len(shifts), Points: penalty(math.Min(p*0.5, 20)), Flagged: p > 25, Examples: ex}
}

// longestGap: el tramo más largo sin registros de un turno que se puede
// medir (cero si el turno es corto o tiene muy pocas entradas sin checklist).
func longestGap(s *shift) (time.Time, time.Time) {
	var from, until time.Time
	if s.end.Sub(s.start) <= gapMinShift || (!s.checklist && len(s.entries) < 3) {
		return from, until
	}
	points := make([]time.Time, 0, len(s.entries)+2)
	for _, e := range s.entries {
		points = append(points, e.At)
	}
	if s.checklist {
		points = append(points, s.start, s.end)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].Before(points[j]) })
	for i := 1; i < len(points); i++ {
		if points[i].Sub(points[i-1]) > until.Sub(from) {
			from, until = points[i-1], points[i]
		}
	}
	return from, until
}

// hasDatum: la entrada trae un dato concreto aunque sea corta.
func hasDatum(e Entry) bool {
	if e.Ticket != "" || e.Service != "" || e.Asset {
		return true
	}
	c := e.Content
	for _, re := range []*regexp.Regexp{reIPv4, reURL, reCVE, reHash, reTicket, reLongNum, reCaseRef, reHost} {
		if re.MatchString(c) {
			return true
		}
	}
	if strings.Contains(c, "::") {
		return true
	}
	// Nombres de equipo tipo «fw01», «srv-db2».
	return reHostLike.MatchString(c)
}

// shortRule: 0,4 puntos por cada 1 % de entradas de menos de 40 caracteres
// sin un dato concreto, hasta 15; se marca sobre el 30 %.
func shortRule(entries []Entry) Rule {
	n := 0
	var ex []Example
	for _, e := range entries {
		if len([]rune(strings.TrimSpace(e.Content))) < shortLimit && !hasDatum(e) {
			n++
			if len(ex) < maxExamples {
				ex = append(ex, Example{Text: excerpt(e.Content)})
			}
		}
	}
	p := pct1(n, len(entries))
	return Rule{Key: RuleShort, Pct: p, Count: n, Of: len(entries), Points: penalty(math.Min(p*0.4, 15)), Flagged: p > 30, Examples: ex}
}

var routineWords = []string{"iniciodeturno", "cierredeturno", "inicio de turno", "cierre de turno", "[inicio]", "[cierre]"}
var routineTags = map[string]bool{"iniciodeturno": true, "cierredeturno": true, "inicio": true, "cierre": true}

func isRoutine(e Entry) bool {
	t := fold(e.Content)
	for _, w := range routineWords {
		if strings.Contains(t, w) {
			return true
		}
	}
	for _, tag := range e.Tags {
		if routineTags[fold(strings.TrimSpace(tag))] {
			return true
		}
	}
	return false
}

// onlyRoutine: el turno no tiene entradas propias.
func onlyRoutine(s *shift) bool {
	if len(s.entries) == 0 {
		return true
	}
	if len(s.entries) > 2 {
		return false
	}
	for _, e := range s.entries {
		if isRoutine(e) {
			return true
		}
	}
	return false
}

// routineRule: 25 puntos fijos si más del 30 % de los turnos no tienen
// entradas propias: con checklist y sin ninguna entrada, o con 1 o 2
// entradas y una es la rutina de inicio o cierre de turno.
func routineRule(shifts []*shift) Rule {
	n := 0
	var ex []Example
	for _, s := range shifts {
		if !onlyRoutine(s) {
			continue
		}
		n++
		if len(ex) < 8 {
			at := s.start
			ex = append(ex, Example{At: &at, Shift: s.name})
		}
	}
	p := pct1(n, len(shifts))
	pts := 0.0
	if p > 30 {
		pts = -25
	}
	return Rule{Key: RuleRoutine, Pct: p, Count: n, Of: len(shifts), Points: pts, Flagged: p > 30, Examples: ex}
}

// El glosario del legacy (sin tildes); se busca por palabra completa, en
// singular o plural.
var glossary = map[string]bool{}

func init() {
	for _, w := range []string{"firewall", "puerto", "ip", "ticket", "bloqueo", "incidente", "alerta", "servidor", "caida", "backup",
		"vpn", "vulnerabilidad", "ofensa", "siem", "antivirus", "correo", "phishing", "analisis", "log", "ips", "ids",
		"mantenimiento", "nok", "monitoreo", "novedad", "turno", "cierre", "inicio"} {
		glossary[w] = true
	}
}

func technical(content string) bool {
	for _, w := range strings.FieldsFunc(fold(content), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if glossary[w] || glossary[strings.TrimSuffix(w, "s")] || glossary[strings.TrimSuffix(w, "es")] {
			return true
		}
	}
	return false
}

// vocabularyRule: suma 1 punto por cada 10 % de entradas con términos del
// oficio, hasta 10.
func vocabularyRule(entries []Entry) Rule {
	n := 0
	for _, e := range entries {
		if technical(e.Content) {
			n++
		}
	}
	p := pct1(n, len(entries))
	return Rule{Key: RuleVocabulary, Pct: p, Count: n, Of: len(entries), Points: round1(math.Min(p/10, 10))}
}
