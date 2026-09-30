package handler

import (
	"net/url"
	"strings"
	"testing"
)

func TestParseAuditFilter(t *testing.T) {
	f, bad := parseAuditFilter(url.Values{
		"event": {" Auth ,setup", "ticket"}, "level": {"warn"}, "result": {"fail"},
		"from": {"2026-09-01T00:00:00Z"}, "to": {"2026-09-30T00:00:00Z"}, "q": {"10.0.%_x"},
	})
	if bad != "" {
		t.Fatal(bad)
	}
	if strings.Join(f.Events, "|") != "auth|setup|ticket" || f.Level.String != "warn" || !f.Success.Valid || f.Success.Bool {
		t.Fatalf("filtros mal leídos: %+v", f)
	}
	// El texto libre llega literal a ILIKE: % y _ no son comodines.
	if f.Q.String != `10.0.\%\_x` {
		t.Fatalf("q sin escapar: %q", f.Q.String)
	}
	if meta := f.metadata(); len(meta["event"].([]string)) != 3 || meta["success"] != false {
		t.Fatalf("metadata del export incompleto: %v", meta)
	}

	empty, bad := parseAuditFilter(url.Values{})
	if bad != "" || empty.Events != nil || empty.Success.Valid || empty.Q.Valid {
		t.Fatalf("sin filtros no debe filtrar nada: %+v %s", empty, bad)
	}

	for name, q := range map[string]url.Values{
		"nivel":       {"level": {"debug"}},
		"resultado":   {"result": {"yes"}},
		"actor":       {"actorUserId": {"no-uuid"}},
		"fecha":       {"from": {"ayer"}},
		"rango":       {"from": {"2026-09-30T00:00:00Z"}, "to": {"2026-09-01T00:00:00Z"}},
		"texto largo": {"q": {string(make([]byte, 201))}},
		"demasiados":  {"event": {strings.Repeat("a,", 21)}},
	} {
		if _, bad := parseAuditFilter(q); bad == "" {
			t.Errorf("%s: esperaba error de validación", name)
		}
	}
}
