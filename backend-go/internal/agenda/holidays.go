package agenda

import (
	"embed"
	"encoding/json"
	"path"
	"sort"
	"strings"
)

// Los feriados que trae la app, un archivo por país (decisión del dueño
// 2026-10-14: se importan desde un archivo incluido, sin depender de
// internet; el admin agrega o quita a mano los regionales). Para sumar un
// país o un año basta con agregar o completar su archivo; nada en el código
// depende de Chile.
//
//go:embed holidays/*.json
var holidayFiles embed.FS

// Holiday es un feriado de la lista incluida.
type Holiday struct {
	Date string `json:"date"`
	Name string `json:"name"`
}

// HolidaySet es un país con sus feriados por año.
type HolidaySet struct {
	Country string               `json:"country"`
	Name    string               `json:"name"`
	Years   map[string][]Holiday `json:"years"`
}

// HolidayCountry resume un país para elegirlo en la pantalla.
type HolidayCountry struct {
	Country string `json:"country"`
	Name    string `json:"name"`
	Years   []int  `json:"years"`
}

func loadHolidaySets() []HolidaySet {
	entries, _ := holidayFiles.ReadDir("holidays")
	out := make([]HolidaySet, 0, len(entries))
	for _, e := range entries {
		raw, err := holidayFiles.ReadFile(path.Join("holidays", e.Name()))
		if err != nil {
			continue
		}
		var set HolidaySet
		if json.Unmarshal(raw, &set) == nil && set.Country != "" {
			out = append(out, set)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// HolidayCountries: los países y años que se pueden importar.
func HolidayCountries() []HolidayCountry {
	sets := loadHolidaySets()
	out := make([]HolidayCountry, 0, len(sets))
	for _, s := range sets {
		c := HolidayCountry{Country: s.Country, Name: s.Name}
		for y := range s.Years {
			var n int
			for _, ch := range y {
				n = n*10 + int(ch-'0')
			}
			c.Years = append(c.Years, n)
		}
		sort.Ints(c.Years)
		out = append(out, c)
	}
	return out
}

// HolidaysFor: los feriados de un país en un año (nil si no vienen incluidos).
func HolidaysFor(country string, year string) []Holiday {
	for _, s := range loadHolidaySets() {
		if strings.EqualFold(s.Country, country) {
			return s.Years[year]
		}
	}
	return nil
}
