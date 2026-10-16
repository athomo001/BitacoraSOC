package tickets

import (
	"testing"
	"time"
)

func TestFormatNumber(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		prefix, year string
		digits       int
		n            int64
		want         string
	}{
		{"TKT", "yyyy", 5, 42, "TKT-2026-00042"},
		{"INF", "none", 6, 42, "INF-000042"},
		{"SOC", "yy", 4, 42, "SOC-26-0042"},
		{"TI", "none", 3, 12345, "TI-12345"},
	}
	for _, c := range cases {
		if got := FormatNumber(c.prefix, c.year, c.digits, c.n, now); got != c.want {
			t.Errorf("%+v → %q, quería %q", c, got, c.want)
		}
	}
}
