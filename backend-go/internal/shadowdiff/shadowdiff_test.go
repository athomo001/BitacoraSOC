package shadowdiff

import (
	"strings"
	"testing"
)

func legacyFlow() []LegacyStep {
	return []LegacyStep{
		{Order: 1, Title: "Analista N1", Type: "unique", ContactName: "José Pérez", ContactTel: "+56 9 1111 2222"},
		{Order: 2, Title: "Cuadrilla", Type: "pool", Contacts: []LegacyContact{{Name: "Ana Soto", Tel: "+56912340001"}, {Name: "Luis Rojas", Tel: "+56912340002"}}},
	}
}

func matchingNew() []NewStep {
	return []NewStep{
		{Order: 1, Mode: "unique", Members: []NewMember{{Name: "Jose Perez", Phones: []string{"+56911112222"}}}},
		{Order: 2, Mode: "pool", Members: []NewMember{{Name: "Luis Rojas", Phones: []string{"+56 9 1234 0002"}}, {Name: "Ana Soto", Phones: []string{"+56912340001"}}}},
	}
}

func TestCompare_Equivalent(t *testing.T) {
	if d := Compare(legacyFlow(), matchingNew()); len(d) != 0 {
		t.Fatalf("mismas personas con otro formato de nombre/teléfono no son discrepancia: %+v", d)
	}
}

func TestCompare_DetectsDiscrepancies(t *testing.T) {
	newSteps := matchingNew()
	newSteps[0].Members[0].Phones = []string{"+56999999999"}       // teléfono distinto
	newSteps[1].Mode = "sequential"                                // pool → sequential
	newSteps[1].Members = newSteps[1].Members[:1]                  // falta Ana
	newSteps = append(newSteps, NewStep{Order: 3, Mode: "unique"}) // paso extra
	d := Compare(legacyFlow(), newSteps)
	kinds := map[Kind]int{}
	for _, x := range d {
		kinds[x.Kind]++
	}
	for _, k := range []Kind{KindPhoneMismatch, KindModeMismatch, KindMissingPerson, KindStepCount} {
		if kinds[k] == 0 {
			t.Errorf("falta discrepancia %s en %+v", k, d)
		}
	}
}

func TestCompare_ExtraPersonInNew(t *testing.T) {
	newSteps := matchingNew()
	newSteps[1].Members = append(newSteps[1].Members, NewMember{Name: "Técnico Nuevo"})
	d := Compare(legacyFlow(), newSteps)
	if len(d) != 1 || d[0].Kind != KindExtraPerson || d[0].Step != 2 {
		t.Fatalf("got %+v", d)
	}
}

func TestReport_Markdown(t *testing.T) {
	r := Report{Cases: []CaseResult{
		{Name: "SIEM Cliente A", Discrepancies: nil},
		{Name: "Firewall Cliente B", Discrepancies: []Discrepancy{{Step: 1, Kind: KindPhoneMismatch, Detail: "x"}}},
		{Name: "EDR Cliente C", Error: "sin política en el sistema nuevo (404)"},
	}}
	md := r.Markdown()
	for _, want := range []string{"| SIEM Cliente A | OK", "| Firewall Cliente B | 1 discrepancia", "| EDR Cliente C | ERROR", "phone_mismatch", "Casos: 3 · sin diferencias: 1 · con diferencias: 1 · con error: 1"} {
		if !strings.Contains(md, want) {
			t.Errorf("el reporte no contiene %q:\n%s", want, md)
		}
	}
}
