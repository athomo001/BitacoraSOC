// Package directory contiene las reglas puras del Directorio Global de
// Contactos (spec/04-contratos-api.md, HU-DIR-1/2), portadas del legacy
// (backend/src/controllers/directoryContactController.js y
// utils/directory-sync.js en ../BitacoraSOC-legacy): limpieza de texto,
// normalización de correo/teléfono antes de indexarlos, parseo del CSV de la
// plantilla oficial y agrupación de duplicados. Sin DB ni HTTP.
package directory

import (
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Scope refleja el ENUM contact_scope.
type Scope string

const (
	ScopeInternal Scope = "internal"
	ScopeExternal Scope = "external"
)

var (
	dashOnly    = regexp.MustCompile(`^[-–—]+$`)
	emailRegex  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
	phoneLike   = regexp.MustCompile(`^\+?[0-9\-\s]+$`)
	nullTokens  = map[string]bool{"n/a": true, "na": true, "null": true, "undefined": true, "sin dato": true, "sin datos": true}
	spaceRunsRe = regexp.MustCompile(`\s+`)
)

// Sanitize recorta, limita a max runes y convierte a vacío los "no-datos"
// típicos de planillas (n/a, null, sin dato, ---) — sanitizeText() del legacy.
func Sanitize(value string, max int) string {
	s := strings.TrimSpace(value)
	if r := []rune(s); len(r) > max {
		s = strings.TrimSpace(string(r[:max]))
	}
	lower := strings.ToLower(s)
	if s == "" || dashOnly.MatchString(lower) || nullTokens[lower] {
		return ""
	}
	return s
}

// NormalizeEmail deja el correo en la forma canónica que se indexa.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// ValidEmail aplica la misma validación de formato que el import del legacy.
func ValidEmail(email string) bool {
	return emailRegex.MatchString(email)
}

// NormalizePhone deja solo dígitos (y un "+" inicial). El legacy hasheaba el
// teléfono tal cual lo tipearon, así que "+56 9 1234 5678" y "+56912345678"
// nunca coincidían al buscar ni al consolidar duplicados.
func NormalizePhone(phone string) string {
	s := strings.TrimSpace(phone)
	var b strings.Builder
	for i, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		}
	}
	out := b.String()
	if strings.Trim(out, "+") == "" {
		return ""
	}
	return out
}

// LooksLikePhone decide si una búsqueda libre debe probarse también contra el
// índice del teléfono (misma regla del legacy: dígitos/+/guiones/espacios, 6+).
func LooksLikePhone(query string) bool {
	return len(query) >= 6 && phoneLike.MatchString(query)
}

// NormalizeName compara nombres sin tildes, mayúsculas ni espacios repetidos.
func NormalizeName(name string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(strings.TrimSpace(name))) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return spaceRunsRe.ReplaceAllString(b.String(), " ")
}

// Record es lo mínimo de un contacto que necesita la detección de duplicados.
type Record struct {
	ID             string
	EmailHash      string
	PhoneHash      string
	NormName       string
	OrganizationID string
}

// GroupDuplicates une contactos que comparten índice de correo, índice de
// teléfono, o nombre normalizado dentro de la MISMA organización (union-find,
// como mergeDirectoryDuplicates() del legacy). A diferencia del legacy NO une
// por nombre solo ni por similitud difusa (Levenshtein): dos "Juan Pérez" de
// empresas distintas pueden ser personas distintas, y la spec pide consolidar
// por email_hash/phone_hash. Devuelve solo grupos de 2+, con IDs en el orden
// de entrada (el primero es el más antiguo si la entrada viene ordenada así).
func GroupDuplicates(records []Record) [][]string {
	parent := make([]int, len(records))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		if parent[i] != i {
			parent[i] = find(parent[i])
		}
		return parent[i]
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			if ra < rb {
				parent[rb] = ra
			} else {
				parent[ra] = rb
			}
		}
	}

	firstByKey := map[string]int{}
	for i, r := range records {
		keys := []string{}
		if r.EmailHash != "" {
			keys = append(keys, "e:"+r.EmailHash)
		}
		if r.PhoneHash != "" {
			keys = append(keys, "p:"+r.PhoneHash)
		}
		if r.NormName != "" && r.OrganizationID != "" {
			keys = append(keys, "n:"+r.OrganizationID+"|"+r.NormName)
		}
		for _, k := range keys {
			if j, ok := firstByKey[k]; ok {
				union(j, i)
			} else {
				firstByKey[k] = i
			}
		}
	}

	byRoot := map[int][]int{}
	for i := range records {
		root := find(i)
		byRoot[root] = append(byRoot[root], i)
	}
	roots := make([]int, 0, len(byRoot))
	for root, members := range byRoot {
		if len(members) > 1 {
			roots = append(roots, root)
		}
	}
	sort.Ints(roots)

	groups := make([][]string, 0, len(roots))
	for _, root := range roots {
		members := byRoot[root]
		sort.Ints(members)
		ids := make([]string, 0, len(members))
		for _, i := range members {
			ids = append(ids, records[i].ID)
		}
		groups = append(groups, ids)
	}
	return groups
}
