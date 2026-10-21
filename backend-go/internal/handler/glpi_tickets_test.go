package handler

import (
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Cómo se traduce cada campo de GLPI (spec/18 §3.3).
func TestGlpiTicketFields(t *testing.T) {
	status := map[int]db.TicketStatus{1: db.TicketStatusNew, 2: db.TicketStatusAssigned, 3: db.TicketStatusInProgress,
		4: db.TicketStatusPendingVendor, 5: db.TicketStatusResolved, 6: db.TicketStatusClosed, 0: db.TicketStatusNew}
	for in, want := range status {
		if got := glpiTicketStatus(in); got != want {
			t.Errorf("estado %d = %s; quiero %s", in, got, want)
		}
	}
	priority := map[int]db.ItilPriority{6: db.ItilPriorityP1Critical, 5: db.ItilPriorityP1Critical, 4: db.ItilPriorityP2High,
		3: db.ItilPriorityP3Medium, 2: db.ItilPriorityP4Low, 1: db.ItilPriorityP4Low}
	for in, want := range priority {
		if got := glpiPriority(in); got != want {
			t.Errorf("prioridad %d = %s; quiero %s", in, got, want)
		}
	}
	level := map[int]string{1: "low", 2: "low", 3: "medium", 4: "high", 5: "high"}
	for in, want := range level {
		if got := glpiLevel(in); got != want {
			t.Errorf("nivel %d = %s; quiero %s", in, got, want)
		}
	}
}
