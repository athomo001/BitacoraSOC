package directory

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
)

// Row es una fila válida del CSV de contactos, ya limpia.
type Row struct {
	Line         int
	Name         string
	Email        string
	Phone        string
	Organization string // nombre o código tal como vino; el handler lo resuelve a organizations
	Position     string
	Specialty    string
	Scope        Scope
	IsFavorite   bool
}

// RowError es una fila rechazada (se reporta y el resto del archivo sigue).
type RowError struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
}

// Alias de encabezado aceptados — los del legacy (plantilla
// plantilla_contactos_directorio.csv, en español) más sus equivalentes en
// inglés, y la columna nueva "Especialidad" (contacts.specialty no existía en
// el legacy). "Tipo" (External/List) se acepta y se ignora: el esquema nuevo
// no distingue listas de distribución de personas.
var headerAliases = map[string][]string{
	"name":         {"nombre", "name"},
	"email":        {"correo", "email", "mail", "correo electrónico", "correo electronico"},
	"phone":        {"teléfono", "telefono", "phone", "fono", "celular"},
	"organization": {"empresa", "organización", "organizacion", "organization", "company"},
	"position":     {"cargo", "position", "rol", "role"},
	"specialty":    {"especialidad", "specialty"},
	"scope":        {"ámbito", "ambito", "scope"},
	"favorite":     {"favorito", "favorite", "isfavorite"},
}

// ParseCSV lee el CSV de la plantilla (BOM de Excel, campos entre comillas,
// separador coma). Una fila con errores se reporta y se omite; nunca aborta
// el resto del archivo — mismo comportamiento que el import del legacy.
func ParseCSV(text string) ([]Row, []RowError) {
	text = strings.TrimPrefix(text, "\xef\xbb\xbf")
	if strings.TrimSpace(text) == "" {
		return nil, []RowError{{Line: 0, Reason: "el archivo CSV está vacío"}}
	}

	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1 // filas con menos columnas no son un error de formato
	r.TrimLeadingSpace = true

	header, err := r.Read()
	if err != nil {
		return nil, []RowError{{Line: 1, Reason: "no se pudo leer el encabezado: " + err.Error()}}
	}
	col := map[string]int{}
	for i, h := range header {
		key := strings.ToLower(strings.TrimSpace(h))
		for field, aliases := range headerAliases {
			for _, a := range aliases {
				if key == a {
					col[field] = i
				}
			}
		}
	}
	if _, ok := col["name"]; !ok {
		return nil, []RowError{{Line: 1, Reason: "falta la columna Nombre"}}
	}

	var rows []Row
	var errs []RowError
	line := 1
	for {
		values, err := r.Read()
		line++
		if err == io.EOF {
			break
		}
		if err != nil {
			errs = append(errs, RowError{Line: line, Reason: "fila mal formada: " + err.Error()})
			continue
		}
		get := func(field string) string {
			if i, ok := col[field]; ok && i < len(values) {
				return values[i]
			}
			return ""
		}
		if strings.TrimSpace(strings.Join(values, "")) == "" {
			continue // línea en blanco
		}

		row := Row{
			Line:         line,
			Name:         Sanitize(get("name"), 120),
			Email:        NormalizeEmail(Sanitize(get("email"), 180)),
			Phone:        Sanitize(get("phone"), 80),
			Organization: Sanitize(get("organization"), 160),
			Position:     Sanitize(get("position"), 120),
			Specialty:    Sanitize(get("specialty"), 120),
			Scope:        parseScope(get("scope")),
			IsFavorite:   parseBool(get("favorite")),
		}

		var problems []string
		if row.Name == "" {
			problems = append(problems, "el nombre es obligatorio")
		}
		if row.Email != "" && !ValidEmail(row.Email) {
			problems = append(problems, fmt.Sprintf("correo con formato inválido (%s)", row.Email))
		}
		if len(problems) > 0 {
			errs = append(errs, RowError{Line: line, Reason: strings.Join(problems, ", ")})
			continue
		}
		rows = append(rows, row)
	}
	return rows, errs
}

func parseScope(v string) Scope {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "internal", "interno", "interna":
		return ScopeInternal
	}
	return ScopeExternal
}

func parseBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "si", "sí", "yes", "x":
		return true
	}
	return false
}
