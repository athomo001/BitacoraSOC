package mailtpl

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestScheduleListMatchesLegacy: mismo correo que buildEscalationScheduleEmail
// del legacy (testdata/schedulelist, hecho con su código en
// America/Santiago; año fijo en 2026).
func TestScheduleListMatchesLegacy(t *testing.T) {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin zona horaria America/Santiago")
	}
	files, _ := filepath.Glob("testdata/schedulelist/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			var c struct {
				Schedule []struct {
					AnalystName, CargoLabel, RoleCode string
					StartDate, EndDate                time.Time
				}
				PeriodLabel, BrandName, Title, CategoriesLabel string
				LogoCid                                        *string
			}
			want := readGolden(t, f, &c)
			o := ScheduleListOptions{PeriodLabel: c.PeriodLabel, BrandName: c.BrandName, Title: c.Title, Categories: c.CategoriesLabel, Year: 2026, Location: loc}
			if c.LogoCid != nil {
				o.LogoSrc = *c.LogoCid
			}
			for _, s := range c.Schedule {
				o.Entries = append(o.Entries, ScheduleEntry{AnalystName: s.AnalystName, CargoLabel: s.CargoLabel, RoleCode: s.RoleCode, Start: s.StartDate, End: s.EndDate})
			}
			got, err := RenderScheduleList(o)
			if err != nil {
				t.Fatal(err)
			}
			sameAsLegacy(t, got, want)
		})
	}
}

func TestScheduleListEscapesNames(t *testing.T) {
	got, _ := RenderScheduleList(ScheduleListOptions{Entries: []ScheduleEntry{{AnalystName: "<script>x</script>", RoleCode: "<b>"}}})
	if strings.Contains(got, "<script>") || strings.Contains(got, ">"+"<B>") {
		t.Fatal("nombre y código deben ir escapados")
	}
}
