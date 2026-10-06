package mailtpl

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestOutOfOfficeMatchesLegacy: mismo correo que buildOutOfOfficeCalendarEmail
// del legacy (testdata/outofoffice, hecho con su código; año fijo en 2026).
func TestOutOfOfficeMatchesLegacy(t *testing.T) {
	files, _ := filepath.Glob("testdata/outofoffice/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			var c struct {
				Columns []struct{ DayShort, DateShort string }
				Rows    []struct {
					Name, CargoLabel string
					Days             []struct{ Status string }
				}
				PeriodLabel, BrandName, Title string
				LogoCid                       *string
			}
			want := readGolden(t, f, &c)
			o := OutOfOfficeOptions{PeriodLabel: c.PeriodLabel, BrandName: c.BrandName, Title: c.Title, Year: 2026}
			if c.LogoCid != nil {
				o.LogoSrc = *c.LogoCid
			}
			for _, col := range c.Columns {
				o.Columns = append(o.Columns, OutOfOfficeColumn{DayShort: col.DayShort, DateShort: col.DateShort})
			}
			for _, r := range c.Rows {
				row := OutOfOfficeRow{Name: r.Name, CargoLabel: r.CargoLabel}
				for _, d := range r.Days {
					row.Days = append(row.Days, d.Status)
				}
				o.Rows = append(o.Rows, row)
			}
			got, err := RenderOutOfOffice(o)
			if err != nil {
				t.Fatal(err)
			}
			sameAsLegacy(t, got, want)
		})
	}
}

func TestOutOfOfficeEscapesNames(t *testing.T) {
	got, _ := RenderOutOfOffice(OutOfOfficeOptions{Rows: []OutOfOfficeRow{{Name: "<script>x</script>"}}})
	if strings.Contains(got, "<script>") {
		t.Fatal("el nombre debe ir escapado")
	}
}
