// Package shadowdiff compara la escalación del legacy contra la resolución
// del motor nuevo sobre los mismos casos (Fase 7 tarea 8: prototipo del
// "shadow-diff real de escalación" que exige el checklist de paridad de la
// Fase 14 antes del corte). El legacy guarda el flujo en
// CatalogLogSource.escalationFlow: pasos `unique` (un contacto con nombre y
// teléfono) o `pool` (una lista de contactos). El nuevo devuelve pasos con
// modo y miembros con canales (GET /api/escalation/resolve).
//
// Se compara lo que le importa al operador a las 3 AM: ¿son los mismos pasos,
// en el mismo modo, con las mismas personas y los mismos teléfonos? Nombres y
// teléfonos se normalizan (tildes, espacios, guiones) para no reportar como
// diferencia "José Pérez / +56 9 1111 2222" vs "Jose Perez / +56911112222".
package shadowdiff

import (
	"fmt"
	"sort"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
)

// LegacyContact es un contacto de un paso pool del legacy.
type LegacyContact struct {
	Name string `json:"name"`
	Tel  string `json:"tel"`
}

// LegacyStep es un paso de CatalogLogSource.escalationFlow.
type LegacyStep struct {
	Order       int             `json:"order"`
	Title       string          `json:"title"`
	Type        string          `json:"type"` // unique | pool
	ContactName string          `json:"contactName"`
	ContactTel  string          `json:"contactTel"`
	Contacts    []LegacyContact `json:"contacts"`
}

// NewMember es un miembro resuelto por el motor nuevo.
type NewMember struct {
	Name   string
	Phones []string
}

// NewStep es un paso resuelto por el motor nuevo.
type NewStep struct {
	Order   int
	Mode    string
	Members []NewMember
}

// Kind es el tipo de discrepancia.
type Kind string

const (
	KindStepCount     Kind = "step_count"
	KindModeMismatch  Kind = "mode_mismatch"
	KindMissingPerson Kind = "missing_person" // está en el legacy, falta en el nuevo
	KindExtraPerson   Kind = "extra_person"   // está en el nuevo, no en el legacy
	KindPhoneMismatch Kind = "phone_mismatch"
)

// Discrepancy es una diferencia concreta, con el paso donde ocurre.
type Discrepancy struct {
	Step   int    `json:"step"`
	Kind   Kind   `json:"kind"`
	Detail string `json:"detail"`
}

type person struct {
	display string
	phones  map[string]bool
}

func legacyPeople(s LegacyStep) map[string]person {
	out := map[string]person{}
	add := func(name, tel string) {
		key := directory.NormalizeName(name)
		if key == "" {
			return
		}
		p := out[key]
		if p.phones == nil {
			p = person{display: name, phones: map[string]bool{}}
		}
		if n := directory.NormalizePhone(tel); n != "" {
			p.phones[n] = true
		}
		out[key] = p
	}
	if s.Type == "pool" {
		for _, c := range s.Contacts {
			add(c.Name, c.Tel)
		}
	} else {
		add(s.ContactName, s.ContactTel)
	}
	return out
}

func newPeople(s NewStep) map[string]person {
	out := map[string]person{}
	for _, m := range s.Members {
		key := directory.NormalizeName(m.Name)
		p := person{display: m.Name, phones: map[string]bool{}}
		for _, ph := range m.Phones {
			if n := directory.NormalizePhone(ph); n != "" {
				p.phones[n] = true
			}
		}
		out[key] = p
	}
	return out
}

// legacyMode traduce el tipo de paso del legacy al modo del motor nuevo.
func legacyMode(t string) string {
	if t == "pool" {
		return "pool"
	}
	return "unique"
}

// Compare devuelve las discrepancias entre el flujo legacy y la resolución
// nueva, paso a paso (por orden).
func Compare(legacy []LegacyStep, fresh []NewStep) []Discrepancy {
	var out []Discrepancy
	if len(legacy) != len(fresh) {
		out = append(out, Discrepancy{Kind: KindStepCount, Detail: fmt.Sprintf("legacy tiene %d pasos, el nuevo %d", len(legacy), len(fresh))})
	}
	byOrder := map[int]NewStep{}
	for _, s := range fresh {
		byOrder[s.Order] = s
	}
	sorted := append([]LegacyStep(nil), legacy...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Order < sorted[j].Order })
	for i, l := range sorted {
		order := i + 1 // el legacy a veces tiene huecos en `order`; se compara por posición
		n, ok := byOrder[order]
		if !ok {
			continue // ya reportado como step_count
		}
		if want := legacyMode(l.Type); n.Mode != want {
			out = append(out, Discrepancy{Step: order, Kind: KindModeMismatch, Detail: fmt.Sprintf("legacy %s (%s), nuevo %s", l.Type, want, n.Mode)})
		}
		lp, np := legacyPeople(l), newPeople(n)
		for _, key := range sortedKeys(lp) {
			lper := lp[key]
			nper, found := np[key]
			if !found {
				out = append(out, Discrepancy{Step: order, Kind: KindMissingPerson, Detail: lper.display + " está en el legacy y no en el nuevo"})
				continue
			}
			for ph := range lper.phones {
				if !nper.phones[ph] {
					out = append(out, Discrepancy{Step: order, Kind: KindPhoneMismatch,
						Detail: fmt.Sprintf("%s: el legacy tiene %s y el nuevo %s", lper.display, ph, joinKeys(nper.phones))})
				}
			}
		}
		for _, key := range sortedKeys(np) {
			if _, found := lp[key]; !found {
				out = append(out, Discrepancy{Step: order, Kind: KindExtraPerson, Detail: np[key].display + " está en el nuevo y no en el legacy"})
			}
		}
	}
	return out
}

func sortedKeys(m map[string]person) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func joinKeys(m map[string]bool) string {
	if len(m) == 0 {
		return "(sin teléfono)"
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ", ")
}

// CaseResult es el resultado de comparar un caso.
type CaseResult struct {
	Name          string        `json:"name"`
	Discrepancies []Discrepancy `json:"discrepancies"`
	Error         string        `json:"error,omitempty"`
}

// Report agrupa todos los casos.
type Report struct {
	Cases []CaseResult `json:"cases"`
}

// Markdown arma el reporte legible (resumen + detalle por caso).
func (r Report) Markdown() string {
	var b strings.Builder
	ok, diff, failed := 0, 0, 0
	b.WriteString("# Shadow-diff de escalación (legacy vs Bitácora Ops)\n\n")
	b.WriteString("| Caso | Resultado |\n| --- | --- |\n")
	for _, c := range r.Cases {
		switch {
		case c.Error != "":
			failed++
			fmt.Fprintf(&b, "| %s | ERROR: %s |\n", c.Name, c.Error)
		case len(c.Discrepancies) == 0:
			ok++
			fmt.Fprintf(&b, "| %s | OK |\n", c.Name)
		default:
			diff++
			plural := "discrepancia"
			if len(c.Discrepancies) > 1 {
				plural = "discrepancias"
			}
			fmt.Fprintf(&b, "| %s | %d %s |\n", c.Name, len(c.Discrepancies), plural)
		}
	}
	fmt.Fprintf(&b, "\nCasos: %d · sin diferencias: %d · con diferencias: %d · con error: %d\n", len(r.Cases), ok, diff, failed)
	for _, c := range r.Cases {
		if len(c.Discrepancies) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n## %s\n\n", c.Name)
		for _, d := range c.Discrepancies {
			step := "general"
			if d.Step > 0 {
				step = fmt.Sprintf("paso %d", d.Step)
			}
			fmt.Fprintf(&b, "- **%s** (%s): %s\n", d.Kind, step, d.Detail)
		}
	}
	return b.String()
}
