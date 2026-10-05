package reporting

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestRecipientsTrimsAndDeduplicates(t *testing.T) {
	got := Recipients([]string{" noc@synet.cl ", "", "NOC@synet.cl", "jefatura@synet.cl"})
	if len(got) != 2 || got[0] != "noc@synet.cl" || got[1] != "jefatura@synet.cl" {
		t.Fatalf("got %#v", got)
	}
}

func TestClockFormatsTimeOfDay(t *testing.T) {
	if got := clock(pgtype.Time{Microseconds: (18*60 + 5) * 60_000_000, Valid: true}); got != "18:05" {
		t.Fatalf("got %q", got)
	}
}
