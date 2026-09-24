package reporting

import "testing"

func TestRenderShiftReportHTMLIsNonEmptyAndEscaped(t *testing.T) {
	report := ShiftReport{TicketCount: 2, IncidentCount: 1, PendingForNextShift: `<script>alert(1)</script>`, ServicesDown: []string{"Core & DNS"}}
	html := RenderShiftReportHTML(report)
	if html == "" || contains(html, "<script>alert(1)</script>") || !contains(html, "Core &amp; DNS") || !contains(html, "2") {
		t.Fatalf("unsafe or incomplete report: %s", html)
	}
}

func TestHasActivityRejectsEmptyShift(t *testing.T) {
	if HasActivity(ShiftReport{}) {
		t.Fatal("empty shift must not produce a report")
	}
	if !HasActivity(ShiftReport{TicketCount: 1}) {
		t.Fatal("ticket activity should produce a report")
	}
}

func contains(value, needle string) bool {
	for i := 0; i+len(needle) <= len(value); i++ {
		if value[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
