package legacyetl

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Export es la exportación JSON del legacy (respaldo "json-auto"): cada
// colección como documentos crudos, que cada paso decodifica a su forma.
type Export struct {
	Metadata struct {
		CreatedAt   string `json:"createdAt"`
		Version     string `json:"version"`
		Collections int    `json:"collections"`
		Type        string `json:"type"`
	} `json:"metadata"`
	Data map[string][]json.RawMessage `json:"data"`

	// read son las colecciones que algún paso leyó.
	read map[string]bool
}

// Decode llena out (puntero a slice) con los documentos de una colección.
func (e *Export) Decode(collection string, out any) error {
	if e.read == nil {
		e.read = map[string]bool{}
	}
	e.read[collection] = true
	raw, err := json.Marshal(e.Data[collection])
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%s: %w", collection, err)
	}
	return nil
}

// Collections devuelve los nombres de colección con su cantidad.
func (e *Export) Collections() map[string]int {
	out := map[string]int{}
	for k, v := range e.Data {
		out[k] = len(v)
	}
	return out
}

// namespace fija los UUID derivados de ObjectId: el mismo documento del
// legacy da siempre el mismo UUID, ensayo tras ensayo.
var namespace = uuid.MustParse("5f0c6b7e-2a1d-4c8e-9b3a-7d1e0f4a6c21")

// ID es el UUID estable de un documento del legacy.
func ID(collection, oid string) uuid.UUID {
	return uuid.NewSHA1(namespace, []byte(collection+":"+oid))
}

// ParseTime lee las fechas de la exportación (ISO 8601). Vacío o inválido
// da la hora cero, y ok=false.
func ParseTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// OID lee una referencia del legacy: texto, {"$oid": …} o el ObjectId
// serializado como buffer {"buffer": {"0": n, …, "11": n}}.
func OID(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if v, ok := m["$oid"]; ok {
		_ = json.Unmarshal(v, &s)
		return s
	}
	if b, ok := m["buffer"]; ok {
		if hexed, ok := bufferHex(b); ok {
			return hexed
		}
	}
	return ""
}

func bufferHex(raw json.RawMessage) (string, bool) {
	var m map[string]int
	if json.Unmarshal(raw, &m) != nil || len(m) != 12 {
		return "", false
	}
	b := make([]byte, 12)
	for k, v := range m {
		i, err := strconv.Atoi(k)
		if err != nil || i < 0 || i > 11 || v < 0 || v > 255 {
			return "", false
		}
		b[i] = byte(v)
	}
	return hex.EncodeToString(b), true
}

// CleanMetadata recorre metadatos de auditoría y reemplaza los ObjectId en
// forma de buffer por su texto hex (en el JSON del legacy quedaron como
// {"buffer":{"0":…}}).
func CleanMetadata(v any) any {
	switch x := v.(type) {
	case map[string]any:
		if len(x) == 1 {
			if b, ok := x["buffer"].(map[string]any); ok && len(b) == 12 {
				raw, _ := json.Marshal(b)
				if hexed, ok := bufferHex(raw); ok {
					return hexed
				}
			}
		}
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(x))
		for _, k := range keys {
			out[k] = CleanMetadata(x[k])
		}
		return out
	case []any:
		for i := range x {
			x[i] = CleanMetadata(x[i])
		}
		return x
	default:
		return v
	}
}

// Unread son las colecciones con documentos que ningún paso leyó y que no
// están en skip (las que no se migran por diseño): datos que se perderían
// sin aviso.
func (e *Export) Unread(skip []string) []string {
	skipped := map[string]bool{}
	for _, s := range skip {
		skipped[s] = true
	}
	var out []string
	for name, docs := range e.Data {
		if len(docs) > 0 && !e.read[name] && !skipped[name] {
			out = append(out, fmt.Sprintf("%s (%d)", name, len(docs)))
		}
	}
	sort.Strings(out)
	return out
}
