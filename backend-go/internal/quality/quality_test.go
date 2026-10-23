package quality

import (
	"fmt"
	"testing"
	"time"
)

var base = time.Date(2026, 10, 14, 8, 0, 0, 0, time.UTC)

func at(h, m int) time.Time {
	return base.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
}

func rule(t *testing.T, r Result, key string) Rule {
	t.Helper()
	for _, x := range r.Rules {
		if x.Key == key {
			return x
		}
	}
	t.Fatalf("falta la regla %s", key)
	return Rule{}
}

// spaced: n entradas distintas y largas, una por hora desde las 08:00.
func spaced(n int, text string) []Entry {
	out := make([]Entry, 0, n)
	for i := range n {
		out = append(out, Entry{Type: "operativa", Content: fmt.Sprintf(text, string(rune('A'+i))), At: at(i, 0)})
	}
	return out
}

func TestFewEntriesAreNotEvaluated(t *testing.T) {
	r := Evaluate(spaced(MinEntries-1, "Revisión de consola del firewall sin hallazgos, nota %s"), nil)
	if r.Evaluated || r.Status != StatusNotEnough || r.Entries != MinEntries-1 || len(r.Rules) != 0 {
		t.Fatalf("con menos de %d entradas no se evalúa: %+v", MinEntries, r)
	}
}

func TestCleanShiftScoresFull(t *testing.T) {
	r := Evaluate(spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s"), nil)
	if !r.Evaluated || r.Score != 100 || r.Status != StatusExcellent || r.Shifts != 1 {
		t.Fatalf("un turno parejo y técnico queda en 100: %+v", r)
	}
	if v := rule(t, r, RuleVocabulary); v.Points != 10 {
		t.Fatalf("el bono llega a 10: %+v", v)
	}
}

// La fórmula del legacy: 1,5 por cada 1 % de copia, con tope 40, y el bono
// de vocabulario de 1 por cada 10 %.
func TestLegacyFormula(t *testing.T) {
	entries := spaced(10, "Coordinación general con el equipo de terreno, nota %s")
	for i := range 5 {
		entries[i].Content = "Revisión de consola sin hallazgos relevantes en el turno"
	}
	r := Evaluate(entries, nil)
	c := rule(t, r, RuleCopy)
	if c.Count != 4 || c.Pct != 40 || c.Points != -40 || !c.Flagged || len(c.Examples) != 1 || c.Examples[0].Times != 5 {
		t.Fatalf("copia: %+v", c)
	}
	if v := rule(t, r, RuleVocabulary); v.Pct != 50 || v.Points != 5 {
		t.Fatalf("vocabulario: %+v", v)
	}
	if r.Score != 65 || r.Status != StatusSimplified {
		t.Fatalf("100 - 40 + 5 = 65, simplificado: %+v", r)
	}
}

func TestCopyIgnoresNumbersAndAddresses(t *testing.T) {
	entries := spaced(10, "Coordinación general con el equipo de terreno, nota %s")
	entries[0].Content = "Se revisa el ticket 48211 desde 10.0.0.1 a las 08:15, sin hallazgos"
	entries[1].Content = "Se revisa el ticket 48212 desde 10.0.0.7 a las 09:40, sin hallazgos"
	if c := rule(t, Evaluate(entries, nil), RuleCopy); c.Count != 1 {
		t.Fatalf("copiar y cambiar el número también es copia: %+v", c)
	}
}

func TestBurstSkipsSameTicket(t *testing.T) {
	entries := spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s")
	entries[1].At = entries[0].At.Add(time.Minute)
	entries[0].Ticket, entries[1].Ticket = "t1", "t1"
	entries[3].At = entries[2].At.Add(time.Minute)
	entries[4].At = entries[3].At.Add(time.Minute)
	b := rule(t, Evaluate(entries, nil), RuleBurst)
	if b.Count != 2 || len(b.Examples) != 1 || b.Examples[0].Count != 3 {
		t.Fatalf("el seguimiento del mismo ticket no es ráfaga; la racha es de 3: %+v", b)
	}
}

func TestShortWithDatumDoesNotCount(t *testing.T) {
	entries := spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s")
	entries[0].Content = "Bloqueo IP 10.2.3.4 en FW"
	entries[1].Content = "Reinicio de srv-db2"
	entries[2].Content = "Revisado ok"
	entries[3].Content = "Sin novedad"
	entries[3].Service = "s1"
	s := rule(t, Evaluate(entries, nil), RuleShort)
	if s.Count != 1 || s.Examples[0].Text != "Revisado ok" {
		t.Fatalf("solo «Revisado ok» es corta sin datos: %+v", s)
	}
}

func TestNightShiftIsOneShift(t *testing.T) {
	entries := spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s")
	for i := range entries {
		entries[i].At = at(13, 0).Add(time.Duration(i) * 70 * time.Minute) // 21:00 → 07:30
	}
	r := Evaluate(entries, nil)
	if r.Shifts != 1 {
		t.Fatalf("un turno de noche no se parte a medianoche: %d turnos", r.Shifts)
	}
}

func TestChecklistShift(t *testing.T) {
	entries := spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s")
	// Turno 1 (con checklist 08:00–20:00): registra al principio y al final.
	for i := range 5 {
		entries[i].At = at(0, 10+i*5)
	}
	entries[4].At = at(11, 50)
	// Turno 2: el día siguiente, sin checklist, parejo.
	for i := 5; i < 10; i++ {
		entries[i].At = at(24+i-5, 0)
	}
	checks := []Check{
		{At: at(0, 0), Start: true, Shift: "Día"},
		{At: at(12, 0), Start: false, Shift: "Día"},
		// Turno 3: checklist de inicio y cierre sin ninguna entrada.
		{At: at(48, 0), Start: true, Shift: "Día", Span: 12 * time.Hour},
	}
	r := Evaluate(entries, checks)
	if r.Shifts != 3 {
		t.Fatalf("3 turnos: %+v", r)
	}
	g := rule(t, r, RuleGaps)
	if g.Count != 2 || len(g.Examples) != 2 || g.Examples[0].Shift != "Día" || !g.Examples[0].At.Equal(at(0, 25)) || !g.Examples[0].Until.Equal(at(11, 50)) {
		t.Fatalf("tramos sin registros (turno 1 y el turno 3 vacío): %+v", g)
	}
	rt := rule(t, r, RuleRoutine)
	if rt.Count != 1 || rt.Pct != 33.3 || rt.Points != -25 || !rt.Flagged {
		t.Fatalf("el turno con checklist y sin entradas cuenta como solo apertura y cierre: %+v", rt)
	}
}

func TestRoutineByKeywordWithoutChecklist(t *testing.T) {
	entries := spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s")
	entries[8].At, entries[8].Content = at(30, 0), "Inicio de turno sin novedades"
	entries[9].At, entries[9].Content = at(41, 0), "Cierre de turno"
	r := Evaluate(entries, nil)
	if rt := rule(t, r, RuleRoutine); r.Shifts != 3 || rt.Count != 2 {
		t.Fatalf("dos turnos de solo rutina (sin checklist): %d turnos, %+v", r.Shifts, rt)
	}
}

func TestBatchIgnoresDatesAndAddresses(t *testing.T) {
	entries := spaced(10, "Revisión de alertas del firewall perimetral sin hallazgos, nota %s")
	entries[0].Content = "Se atienden tickets 48211, 48213, 48220 y 48231 por caída de enlace"
	entries[1].Content = "Revisión del 2026-10-14 a las 08:15 desde 10.0.0.1 hacia 10.0.0.2, caso 1234"
	b := rule(t, Evaluate(entries, nil), RuleBatch)
	if b.Count != 1 {
		t.Fatalf("solo la primera junta varios casos: %+v", b)
	}
}

func TestVocabularyWholeWords(t *testing.T) {
	if technical("Se entrega el equipo de tipo principal") {
		t.Fatal("«equipo» y «tipo» no son «ip»")
	}
	for _, s := range []string{"Alertas revisadas", "Caída del enlace", "Revisión de logs", "Dos servidores reiniciados"} {
		if !technical(s) {
			t.Fatalf("%q tiene un término del oficio", s)
		}
	}
}

func TestStatusCuts(t *testing.T) {
	for score, want := range map[int]string{100: StatusExcellent, 90: StatusExcellent, 89: StatusStable, 75: StatusStable, 74: StatusSimplified, 50: StatusSimplified, 49: StatusFiller, 0: StatusFiller} {
		if got := StatusFor(score); got != want {
			t.Fatalf("%d: %s, quería %s", score, got, want)
		}
	}
}
