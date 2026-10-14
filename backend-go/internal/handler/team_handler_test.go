package handler

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

func TestGroupAssignable(t *testing.T) {
	lead := map[string]bool{"infra": true, "ti": true}
	cases := []struct {
		name  string
		areas []string
		caps  []string
		admin bool
		want  bool
	}{
		{"grupo de su área", []string{"infra"}, nil, false, true},
		{"grupo de dos áreas suyas", []string{"infra", "ti"}, []string{"directory:write"}, false, true},
		{"grupo que sale de sus áreas", []string{"infra", "soc"}, nil, false, false},
		{"grupo de jefatura", []string{"infra"}, []string{CapAreaLead}, false, false},
		{"el admin asigna cualquiera", []string{"soc"}, []string{CapAreaLead}, true, true},
	}
	for _, c := range cases {
		if got := groupAssignable(c.areas, c.caps, lead, c.admin); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestPersonManageable(t *testing.T) {
	lead := map[string]bool{"infra": true}
	infra := db.ListUserGroupsWithAreasRow{AreaCodes: []string{"infra"}}
	general := db.ListUserGroupsWithAreasRow{AreaCodes: []string{}, Capabilities: []string{"directory:write"}}
	soc := db.ListUserGroupsWithAreasRow{AreaCodes: []string{"soc"}}
	leadGroup := db.ListUserGroupsWithAreasRow{AreaCodes: []string{"infra"}, Capabilities: []string{CapAreaLead}}
	cases := []struct {
		name   string
		role   db.UserRole
		self   bool
		groups []db.ListUserGroupsWithAreasRow
		admin  bool
		want   bool
	}{
		{"persona de su área", db.UserRoleUser, false, []db.ListUserGroupsWithAreasRow{infra}, false, true},
		{"con un grupo general", db.UserRoleUser, false, []db.ListUserGroupsWithAreasRow{infra, general}, false, true},
		{"también de otra área", db.UserRoleUser, false, []db.ListUserGroupsWithAreasRow{infra, soc}, false, false},
		{"otra jefatura", db.UserRoleUser, false, []db.ListUserGroupsWithAreasRow{leadGroup}, false, false},
		{"un administrador", db.UserRoleAdmin, false, []db.ListUserGroupsWithAreasRow{infra}, false, false},
		{"a sí misma", db.UserRoleUser, true, []db.ListUserGroupsWithAreasRow{infra}, false, false},
		{"el admin con otra área", db.UserRoleUser, false, []db.ListUserGroupsWithAreasRow{infra, soc}, true, true},
		{"el admin a otro admin", db.UserRoleAdmin, false, nil, true, false},
	}
	for _, c := range cases {
		if got := personManageable(c.role, c.self, c.groups, lead, c.admin); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestDayCondition(t *testing.T) {
	cases := []struct {
		assigned string
		guard    bool
		want     string
	}{
		{"", false, "office"},
		{"telework", false, "telework"},
		{"telework", true, "guardia"},
		{"vacation", true, "vacation"},
		{"medical_leave", false, "medical_leave"},
		{"", true, "guardia"},
	}
	for _, c := range cases {
		if got := dayCondition(c.assigned, c.guard); got != c.want {
			t.Errorf("dayCondition(%q, %v) = %q, want %q", c.assigned, c.guard, got, c.want)
		}
	}
}

func TestWeekDays(t *testing.T) {
	for _, day := range []string{"2026-10-12", "2026-10-14", "2026-10-16", "2026-10-18"} {
		d, _ := time.Parse("2006-01-02", day)
		got := weekDays(d)
		if got[0].Format("2006-01-02") != "2026-10-12" || got[4].Format("2006-01-02") != "2026-10-16" {
			t.Errorf("weekDays(%s) = %s..%s", day, got[0].Format("2006-01-02"), got[4].Format("2006-01-02"))
		}
	}
}
