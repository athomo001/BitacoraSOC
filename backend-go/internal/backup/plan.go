package backup

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Reglas puras de respaldos (sin base de datos): en qué orden se restauran las
// tablas, cuándo toca la próxima copia automática y qué copias vencieron.

// FK es una clave foránea entre dos tablas: Child apunta a Parent.
type FK struct{ Child, Parent string }

// RestoreOrder ordena las tablas para insertarlas sin violar claves foráneas:
// cada tabla después de todas las que referencia. Las referencias a sí misma
// (árboles como checklist_items) no cuentan: se insertan en un solo INSERT y
// Postgres valida la FK al final de la sentencia. Un ciclo entre tablas
// distintas no tiene orden válido y se reporta en vez de fallar a medias.
func RestoreOrder(tables []string, fks []FK) ([]string, error) {
	present := make(map[string]bool, len(tables))
	for _, t := range tables {
		present[t] = true
	}
	parents := make(map[string]map[string]bool, len(tables))
	for _, fk := range fks {
		if fk.Child == fk.Parent || !present[fk.Child] || !present[fk.Parent] {
			continue
		}
		if parents[fk.Child] == nil {
			parents[fk.Child] = map[string]bool{}
		}
		parents[fk.Child][fk.Parent] = true
	}
	sorted := append([]string(nil), tables...)
	sort.Strings(sorted) // orden estable: mismo resultado en cada corrida
	var out []string
	done := make(map[string]bool, len(tables))
	for len(out) < len(sorted) {
		progress := false
		for _, t := range sorted {
			if done[t] {
				continue
			}
			ready := true
			for p := range parents[t] {
				if !done[p] {
					ready = false
					break
				}
			}
			if ready {
				done[t] = true
				out = append(out, t)
				progress = true
			}
		}
		if !progress {
			var stuck []string
			for _, t := range sorted {
				if !done[t] {
					stuck = append(stuck, t)
				}
			}
			return nil, fmt.Errorf("ciclo de claves foráneas entre: %s", strings.Join(stuck, ", "))
		}
	}
	return out, nil
}

// Schedule es la programación de copias automáticas.
type Schedule struct {
	IntervalDays int
	Hour, Minute int
	Location     *time.Location
}

// NextRun es la primera hora programada estrictamente posterior a `after`.
func NextRun(after time.Time, s Schedule) time.Time {
	loc := s.Location
	if loc == nil {
		loc = time.UTC
	}
	local := after.In(loc)
	candidate := time.Date(local.Year(), local.Month(), local.Day(), s.Hour, s.Minute, 0, 0, loc)
	if !candidate.After(local) {
		candidate = candidate.AddDate(0, 0, 1)
	}
	return candidate
}

// NextRunAfterBackup: tras una copia a las `ranAt`, la siguiente toca
// `IntervalDays` días después, a la hora programada.
func NextRunAfterBackup(ranAt time.Time, s Schedule) time.Time {
	days := s.IntervalDays
	if days < 1 {
		days = 1
	}
	return NextRun(ranAt.AddDate(0, 0, days-1), s)
}

// RetentionCutoff: las copias automáticas iniciadas antes de este instante vencieron.
func RetentionCutoff(now time.Time, retentionDays int) time.Time {
	return now.AddDate(0, 0, -retentionDays)
}

// PreservedOnPurge son las tablas que la purga NO vacía: el historial de
// migraciones y los catálogos que siembran las migraciones (sin ellos el
// sistema queda roto, no "recién instalado"). backup_config vuelve a su fila
// por defecto en vez de desaparecer.
var PreservedOnPurge = map[string]bool{
	"schema_migrations": true,
	"system_features":   true,
	"backup_config":     true,
}

// PurgeConfirmation es la frase exacta que exige la purga (la misma del legacy).
const PurgeConfirmation = "PURGAR TODO"

// ReplaceConfirmation es la frase que exige restaurar reemplazando todo.
const ReplaceConfirmation = "RESTAURAR"
