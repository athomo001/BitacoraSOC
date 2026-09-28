package handler

import "testing"

// Regresión: shift_checks viajaba en el delta sin shift_check_services, así
// que un check importado quedaba sin ninguno de sus ítems.
func TestDeltaImportOrderCoversExactlyTheExportedTables(t *testing.T) {
	seen := make(map[string]bool, len(deltaImportOrder))
	for _, name := range deltaImportOrder {
		if _, ok := deltaSpecs[name]; !ok {
			t.Fatalf("%q se importa pero nunca se exporta", name)
		}
		if seen[name] {
			t.Fatalf("%q aparece dos veces en el orden de importación", name)
		}
		seen[name] = true
	}
	for name := range deltaSpecs {
		if !seen[name] {
			t.Fatalf("%q se exporta pero nunca se importa", name)
		}
	}
}

func TestDeltaImportsChildrenAfterParents(t *testing.T) {
	position := make(map[string]int, len(deltaImportOrder))
	for i, name := range deltaImportOrder {
		position[name] = i
	}
	for child, parent := range map[string]string{
		"shift_check_services": "shift_checks",
		"shift_closures":       "shift_checks",
		"entry_comments":       "entries",
		"ticket_comments":      "tickets",
		"ticket_tasks":         "tickets",
	} {
		if position[child] < position[parent] {
			t.Fatalf("%q debe importarse después de %q", child, parent)
		}
	}
}
