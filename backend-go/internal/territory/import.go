// Package territory implementa el import de la jerarquía territorial
// país-agnóstica (spec/01-arquitectura.md sección 4, spec/03b-guia-import-
// territorial.md, HU-TERR-2/3): JSON anidado, upsert por code (idempotente)
// y parcial (una rama con error se salta y se reporta, el resto sigue).
// Sin DB: la persistencia entra por Store, así la lógica de árbol/paths/
// conteos se prueba sin Postgres.
package territory

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Kind es el ENUM técnico territorial_kind — nunca se muestra tal cual en la
// UI (HU-TERR-1: el frontend usa app_config.territorial_kind_labels).
type Kind string

const (
	KindCountry Kind = "country"
	KindRegion  Kind = "region"
	KindZone    Kind = "zone"
	KindSite    Kind = "site"
)

var kindDepth = map[Kind]int{KindCountry: 0, KindRegion: 1, KindZone: 2, KindSite: 3}

// Valid dice si k es un valor del ENUM.
func (k Kind) Valid() bool {
	_, ok := kindDepth[k]
	return ok
}

// CanContain dice si un nodo de este kind puede tener un hijo de kind child.
// Estrictamente más profundo, pero se permite saltar niveles (la plantilla
// oficial es país → región → sitio, sin zona).
func (k Kind) CanContain(child Kind) bool {
	p, okP := kindDepth[k]
	c, okC := kindDepth[child]
	return okP && okC && c > p
}

// Node es un nodo del JSON de import (mismo shape recursivo que
// spec/04-contratos-api.md POST /api/territorial-units/import).
type Node struct {
	Code      string   `json:"code"`
	Kind      Kind     `json:"kind"`
	Name      string   `json:"name"`
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
	Children  []Node   `json:"children,omitempty"`
}

// ItemError es una entrada de errors[] en la respuesta del import.
type ItemError struct {
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

// Result es la respuesta 200 del import.
type Result struct {
	ImportedCount int         `json:"importedCount"`
	UpdatedCount  int         `json:"updatedCount"`
	Errors        []ItemError `json:"errors"`
}

// UpsertParams es lo que Import le pide persistir a Store por cada nodo.
type UpsertParams struct {
	ParentID  *uuid.UUID
	Kind      Kind
	Code      string
	Name      string
	Path      string
	Latitude  *float64
	Longitude *float64
}

// UpsertResult es lo que Store devuelve por cada nodo persistido.
type UpsertResult struct {
	ID       uuid.UUID
	Path     string
	Inserted bool
}

// Store persiste un nodo con upsert por code. Cada llamada debe ser atómica
// por sí sola (savepoint): si falla, no deja nada a medias y Import sigue
// con la rama siguiente. Si el code ya existía con otro path, Store también
// debe reubicar sus descendientes (ver repository.TerritoryStore).
type Store interface {
	Upsert(ctx context.Context, p UpsertParams) (UpsertResult, error)
}

// ErrEmptyImport se devuelve cuando el payload no trae ningún nodo.
var ErrEmptyImport = errors.New("el import no contiene ningún nodo")

// ParseImport acepta un nodo raíz suelto o un array de raíces ("uno o varios
// nodos raíz", spec/04-contratos-api.md).
func ParseImport(raw []byte) ([]Node, error) {
	trimmed := bytes.TrimSpace(raw)
	var roots []Node
	if len(trimmed) > 0 && trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &roots); err != nil {
			return nil, err
		}
	} else {
		var single Node
		if err := json.Unmarshal(trimmed, &single); err != nil {
			return nil, err
		}
		roots = []Node{single}
	}
	if len(roots) == 0 {
		return nil, ErrEmptyImport
	}
	return roots, nil
}

// ValidateStructure detecta errores de forma del árbol completo — kind
// desconocido o fuera de orden (ej. region dentro de zone). Son 400 para
// todo el request (spec/04-contratos-api.md), no errores parciales: un
// árbol con los niveles al revés indica un archivo mal armado de raíz, no
// una fila suelta con un dato malo.
func ValidateStructure(roots []Node) []ItemError {
	var errs []ItemError
	var walk func(n Node, parent *Node)
	walk = func(n Node, parent *Node) {
		switch {
		case !n.Kind.Valid():
			errs = append(errs, ItemError{Code: n.Code, Reason: fmt.Sprintf("kind %q inválido (country|region|zone|site)", n.Kind)})
		case parent != nil && parent.Kind.Valid() && !parent.Kind.CanContain(n.Kind):
			errs = append(errs, ItemError{Code: n.Code, Reason: fmt.Sprintf("kind %q no puede ir dentro de %q (%s)", n.Kind, parent.Kind, parent.Code)})
		}
		for _, c := range n.Children {
			walk(c, &n)
		}
	}
	for _, r := range roots {
		walk(r, nil)
	}
	return errs
}

// Import persiste el árbol de arriba hacia abajo. Asume ValidateStructure
// ya pasó. Una rama con error (datos del nodo o falla del Store) se reporta
// en Result.Errors y se omite completa — sus hijos no se importan, porque
// quedarían sin padre. El resto del árbol sigue.
func Import(ctx context.Context, store Store, roots []Node) (Result, error) {
	res := Result{Errors: []ItemError{}}
	seen := map[string]bool{}

	var walk func(n Node, parentID *uuid.UUID, parentPath string) error
	walk = func(n Node, parentID *uuid.UUID, parentPath string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		code := strings.TrimSpace(n.Code)
		reason := validateNode(n, code, seen)
		if reason == "" {
			seen[code] = true
			path := PathLabel(code)
			if parentPath != "" {
				path = parentPath + "." + path
			}
			out, err := store.Upsert(ctx, UpsertParams{
				ParentID: parentID, Kind: n.Kind, Code: code, Name: strings.TrimSpace(n.Name),
				Path: path, Latitude: n.Latitude, Longitude: n.Longitude,
			})
			if err == nil {
				if out.Inserted {
					res.ImportedCount++
				} else {
					res.UpdatedCount++
				}
				id := out.ID
				for _, c := range n.Children {
					if err := walk(c, &id, out.Path); err != nil {
						return err
					}
				}
				return nil
			}
			reason = "no se pudo guardar: " + err.Error()
		}
		if skipped := countDescendants(n); skipped > 0 {
			reason += fmt.Sprintf(" (se omitieron %d descendiente(s))", skipped)
		}
		res.Errors = append(res.Errors, ItemError{Code: code, Reason: reason})
		return nil
	}

	for _, r := range roots {
		if err := walk(r, nil, ""); err != nil {
			return res, err
		}
	}
	return res, nil
}

func validateNode(n Node, code string, seen map[string]bool) string {
	switch {
	case code == "":
		return "code vacío"
	case strings.TrimSpace(n.Name) == "":
		return "name vacío"
	case seen[code]:
		return "code repetido dentro del mismo archivo"
	case n.Latitude != nil && (*n.Latitude < -90 || *n.Latitude > 90):
		return "latitude fuera de rango (-90..90)"
	case n.Longitude != nil && (*n.Longitude < -180 || *n.Longitude > 180):
		return "longitude fuera de rango (-180..180)"
	}
	return ""
}

func countDescendants(n Node) int {
	total := 0
	for _, c := range n.Children {
		total += 1 + countDescendants(c)
	}
	return total
}

// PathLabel convierte un code en una etiqueta ltree válida. ltree (Postgres
// 16+) acepta letras ASCII, dígitos, '_' y '-' por etiqueta; todo lo demás
// (puntos, espacios, tildes) se reemplaza por '_' rune a rune. El code
// original se guarda intacto en su columna — path es solo el índice del
// árbol, no un identificador que alguien lea.
func PathLabel(code string) string {
	var b strings.Builder
	for _, r := range code {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}
