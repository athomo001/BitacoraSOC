// territorial-seed transforma el JSON combinado de
// dr5hn/countries-states-cities-database (countries+states+cities.json) al
// formato de POST /api/territorial-units/import, para un país — el "script
// de 10 líneas" que menciona spec/03b-guia-import-territorial.md sección 3,
// versionado para que cualquier instalación en otro país no tenga que
// reescribirlo. Aplica el mapeo de la sección 4 de esa guía:
//
//	país   → kind=country, code=iso2
//	estado → kind=region,  code=iso3166_2 (ej. CL-RM) o {iso2}-{iso2 del estado}
//	ciudad → kind=zone,    code={codeRegión}-{SLUG DEL NOMBRE} (ej. CL-AN-CALAMA)
//
// Uso:
//
//	go run ./cmd/territorial-seed -in countries+states+cities.json -country CL -out ../seed/territorial_units_chile.json
//
// Licencia de los datos: ODbL v1.0 (dr5hn) — exige atribución, ver
// THIRD-PARTY-NOTICES.md en la raíz del repo.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/territory"
	"golang.org/x/text/unicode/norm"
)

// Solo los campos que se usan del dataset — el resto (traducciones,
// timezones, moneda...) se ignora al decodificar.
type sourceCountry struct {
	ISO2      string        `json:"iso2"`
	Name      string        `json:"name"`
	Latitude  string        `json:"latitude"`
	Longitude string        `json:"longitude"`
	States    []sourceState `json:"states"`
}

type sourceState struct {
	ID        int          `json:"id"`
	Name      string       `json:"name"`
	ISO2      string       `json:"iso2"`       // esquema actual del dataset
	ISO31662  string       `json:"iso3166_2"`  // esquema actual del dataset (ej. "CL-RM")
	StateCode string       `json:"state_code"` // esquema anterior (el que describía 03b originalmente)
	Latitude  string       `json:"latitude"`
	Longitude string       `json:"longitude"`
	Cities    []sourceCity `json:"cities"`
}

type sourceCity struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Latitude  string `json:"latitude"`
	Longitude string `json:"longitude"`
}

func main() {
	in := flag.String("in", "", "ruta a countries+states+cities.json de dr5hn")
	country := flag.String("country", "", "ISO 3166-1 alpha-2 del país (ej. CL)")
	out := flag.String("out", "", "archivo de salida (por defecto stdout)")
	flag.Parse()
	if *in == "" || *country == "" {
		flag.Usage()
		os.Exit(2)
	}
	if err := run(*in, strings.ToUpper(*country), *out); err != nil {
		fmt.Fprintln(os.Stderr, "territorial-seed:", err)
		os.Exit(1)
	}
}

func run(inPath, iso2, outPath string) error {
	raw, err := os.ReadFile(inPath)
	if err != nil {
		return err
	}
	var countries []sourceCountry
	if err := json.Unmarshal(raw, &countries); err != nil {
		return fmt.Errorf("parseando dataset: %w", err)
	}
	var src *sourceCountry
	for i := range countries {
		if countries[i].ISO2 == iso2 {
			src = &countries[i]
			break
		}
	}
	if src == nil {
		return fmt.Errorf("país %s no encontrado en el dataset", iso2)
	}

	root := transform(*src)
	if errs := territory.ValidateStructure([]territory.Node{root}); len(errs) > 0 {
		return fmt.Errorf("el resultado no pasa la validación del import: %+v", errs)
	}

	body, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if outPath == "" {
		_, err = os.Stdout.Write(body)
		return err
	}
	if err := os.WriteFile(outPath, body, 0o644); err != nil {
		return err
	}
	regions, zones := len(root.Children), 0
	for _, r := range root.Children {
		zones += len(r.Children)
	}
	fmt.Fprintf(os.Stderr, "territorial-seed: %s → %d regiones, %d zonas → %s\n", iso2, regions, zones, outPath)
	return nil
}

func transform(c sourceCountry) territory.Node {
	root := territory.Node{
		Code: c.ISO2, Kind: territory.KindCountry, Name: c.Name,
		Latitude: coord(c.Latitude), Longitude: coord(c.Longitude),
	}
	for _, s := range c.States {
		region := territory.Node{
			Code: regionCode(c.ISO2, s), Kind: territory.KindRegion, Name: strings.TrimSpace(s.Name),
			Latitude: coord(s.Latitude), Longitude: coord(s.Longitude),
		}
		used := map[string]bool{}
		for _, city := range s.Cities {
			code := region.Code + "-" + slug(city.Name)
			if used[code] {
				// Dos ciudades homónimas dentro de la misma región: se
				// desambigua con el id estable del dataset, no con un
				// contador (un contador cambiaría de dueño entre versiones
				// del dataset y rompería la idempotencia del reimport).
				code += "-" + strconv.Itoa(city.ID)
			}
			used[code] = true
			region.Children = append(region.Children, territory.Node{
				Code: code, Kind: territory.KindZone, Name: strings.TrimSpace(city.Name),
				Latitude: coord(city.Latitude), Longitude: coord(city.Longitude),
			})
		}
		sort.Slice(region.Children, func(i, j int) bool { return region.Children[i].Name < region.Children[j].Name })
		root.Children = append(root.Children, region)
	}
	sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Code < root.Children[j].Code })
	return root
}

// regionCode compone un code único global (territorial_units.code es UNIQUE
// global, no por país — spec/03b sección 4).
func regionCode(countryISO2 string, s sourceState) string {
	switch {
	case s.ISO31662 != "":
		return s.ISO31662
	case s.ISO2 != "":
		return countryISO2 + "-" + s.ISO2
	case s.StateCode != "":
		return countryISO2 + "-" + s.StateCode
	}
	return countryISO2 + "-" + strconv.Itoa(s.ID)
}

// slug: mayúsculas ASCII sin tildes, cualquier otro carácter → '-'.
// "Ñuñoa" → "NUNOA", "San José de Maipo" → "SAN-JOSE-DE-MAIPO".
func slug(name string) string {
	var b strings.Builder
	lastDash := true
	for _, r := range norm.NFD.String(name) {
		switch {
		case unicode.Is(unicode.Mn, r):
			continue // marca diacrítica suelta tras NFD
		case r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			b.WriteRune(unicode.ToUpper(r))
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}

// coord parsea la coordenada (el dataset las trae como string) redondeada a
// 6 decimales — la precisión de NUMERIC(9,6) en territorial_units.
func coord(s string) *float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return nil
	}
	f = math.Round(f*1e6) / 1e6
	return &f
}
