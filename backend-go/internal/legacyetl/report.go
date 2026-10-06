package legacyetl

import (
	"fmt"
	"io"
	"sort"
	"strings"
)

// Step es el resultado de un paso: cuántos documentos leyó, cuántos cargó y
// por qué descartó el resto. Nunca guarda datos personales, solo motivos.
type Step struct {
	Name    string         `json:"name"`
	Read    int            `json:"read"`
	Loaded  int            `json:"loaded"`
	Skipped map[string]int `json:"skipped"`
	Notes   []string       `json:"notes,omitempty"`
}

func newStep(name string, read int) *Step {
	return &Step{Name: name, Read: read, Skipped: map[string]int{}}
}

func (s *Step) skip(reason string) { s.Skipped[reason]++ }

func (s *Step) note(format string, a ...any) { s.Notes = append(s.Notes, fmt.Sprintf(format, a...)) }

// SkippedTotal suma los descartes.
func (s *Step) SkippedTotal() int {
	n := 0
	for _, v := range s.Skipped {
		n += v
	}
	return n
}

// Report es el resultado de un ensayo.
type Report struct {
	ExportCreatedAt string   `json:"exportCreatedAt"`
	ExportVersion   string   `json:"exportVersion"`
	Steps           []*Step  `json:"steps"`
	NotMigrated     []string `json:"notMigrated"`
	// Unread: colecciones con datos que el ETL no lee ni declara como "no se
	// migran". Deberían quedar vacías: si no, falta un paso.
	Unread    []string `json:"unread,omitempty"`
	Committed bool     `json:"committed"`
}

// Print muestra el reporte como tabla legible.
func (r *Report) Print(w io.Writer) {
	fmt.Fprintf(w, "Exportación del legacy %s (formato %s)\n\n", r.ExportCreatedAt, r.ExportVersion)
	fmt.Fprintf(w, "%-34s %8s %8s %10s\n", "paso", "leídos", "cargados", "descartes")
	for _, s := range r.Steps {
		fmt.Fprintf(w, "%-34s %8d %8d %10d\n", s.Name, s.Read, s.Loaded, s.SkippedTotal())
		reasons := make([]string, 0, len(s.Skipped))
		for k := range s.Skipped {
			reasons = append(reasons, k)
		}
		sort.Strings(reasons)
		for _, k := range reasons {
			fmt.Fprintf(w, "    · %d %s\n", s.Skipped[k], k)
		}
		for _, n := range s.Notes {
			fmt.Fprintf(w, "    ↳ %s\n", n)
		}
	}
	if len(r.NotMigrated) > 0 {
		fmt.Fprintf(w, "\nNo se migran (por diseño, spec/13 §3): %s\n", strings.Join(r.NotMigrated, ", "))
	}
	if len(r.Unread) > 0 {
		fmt.Fprintf(w, "\n⚠ Colecciones con datos que el ETL no lee (se perderían): %s\n", strings.Join(r.Unread, ", "))
	}
	if r.Committed {
		fmt.Fprintln(w, "\nCarga confirmada.")
	} else {
		fmt.Fprintln(w, "\nNada se guardó (ensayo en seco o error).")
	}
}
