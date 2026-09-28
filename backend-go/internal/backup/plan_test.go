package backup

import (
	"strings"
	"testing"
	"time"
)

func TestRestoreOrder_ParentsBeforeChildren(t *testing.T) {
	tables := []string{"shift_check_services", "users", "shift_checks", "checklist_items", "checklist_templates", "work_shifts"}
	fks := []FK{
		{"shift_check_services", "shift_checks"}, {"shift_check_services", "checklist_items"},
		{"shift_checks", "users"}, {"shift_checks", "work_shifts"}, {"shift_checks", "checklist_templates"},
		{"checklist_items", "checklist_templates"}, {"checklist_items", "checklist_items"}, // árbol: se ignora
		{"work_shifts", "checklist_templates"},
	}
	order, err := RestoreOrder(tables, fks)
	if err != nil {
		t.Fatal(err)
	}
	pos := map[string]int{}
	for i, name := range order {
		pos[name] = i
	}
	for _, fk := range fks {
		if fk.Child != fk.Parent && pos[fk.Child] < pos[fk.Parent] {
			t.Fatalf("%s quedó antes que %s: %v", fk.Child, fk.Parent, order)
		}
	}
	if len(order) != len(tables) {
		t.Fatalf("faltan tablas: %v", order)
	}
}

func TestRestoreOrder_ReportsCycles(t *testing.T) {
	_, err := RestoreOrder([]string{"a", "b", "c"}, []FK{{"a", "b"}, {"b", "a"}})
	if err == nil || !strings.Contains(err.Error(), "a, b") {
		t.Fatalf("un ciclo a↔b debe reportarse: %v", err)
	}
}

func TestRestoreOrder_IgnoresTablesNotInBackup(t *testing.T) {
	order, err := RestoreOrder([]string{"entries"}, []FK{{"entries", "users"}})
	if err != nil || len(order) != 1 {
		t.Fatalf("una FK hacia una tabla ausente no bloquea: %v %v", order, err)
	}
}

func santiago(t *testing.T) *time.Location {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestNextRun(t *testing.T) {
	loc := santiago(t)
	s := Schedule{IntervalDays: 1, Hour: 3, Minute: 0, Location: loc}
	before := time.Date(2026, 9, 27, 2, 30, 0, 0, loc)
	if got := NextRun(before, s); !got.Equal(time.Date(2026, 9, 27, 3, 0, 0, 0, loc)) {
		t.Fatalf("antes de las 03:00 toca hoy: %v", got)
	}
	after := time.Date(2026, 9, 27, 3, 0, 0, 0, loc)
	if got := NextRun(after, s); !got.Equal(time.Date(2026, 9, 28, 3, 0, 0, 0, loc)) {
		t.Fatalf("justo a las 03:00 ya pasó: mañana: %v", got)
	}
}

func TestNextRunAfterBackup_RespectsInterval(t *testing.T) {
	loc := santiago(t)
	ran := time.Date(2026, 9, 27, 3, 0, 5, 0, loc)
	if got := NextRunAfterBackup(ran, Schedule{IntervalDays: 7, Hour: 3, Location: loc}); !got.Equal(time.Date(2026, 10, 4, 3, 0, 0, 0, loc)) {
		t.Fatalf("cada 7 días: %v", got)
	}
	if got := NextRunAfterBackup(ran, Schedule{IntervalDays: 1, Hour: 3, Location: loc}); !got.Equal(time.Date(2026, 9, 28, 3, 0, 0, 0, loc)) {
		t.Fatalf("diario: %v", got)
	}
}

func TestPurgePreservesCatalogs(t *testing.T) {
	for _, table := range []string{"schema_migrations", "system_features", "backup_config"} {
		if !PreservedOnPurge[table] {
			t.Fatalf("la purga no puede vaciar %s", table)
		}
	}
	for _, table := range []string{"users", "entries", "audit_log", "backup_runs"} {
		if PreservedOnPurge[table] {
			t.Fatalf("la purga debe vaciar %s", table)
		}
	}
}
