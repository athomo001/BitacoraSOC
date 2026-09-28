package checklist

import (
	"errors"
	"fmt"
	"strings"
)

// MaxDepth: ítem → sub-ítem → sub-sub-ítem. Más niveles no caben en la
// pantalla del analista y el legacy tampoco los tenía.
const MaxDepth = 3

// MaxItems acota una plantilla: un checklist de turno se completa en minutos.
const MaxItems = 200

// TemplateItem es un ítem tal como llega del editor de plantillas: `Key` es
// el id existente o una clave temporal del navegador para los nuevos, y
// `ParentKey` apunta a otra `Key` de la misma lista.
type TemplateItem struct {
	Key       string
	ParentKey string
	Title     string
}

// ValidateTemplate revisa lo que el backend no puede dejar pasar al guardar
// una plantilla: nombre, al menos un ítem, títulos sin repetir entre
// hermanos, padres que existen y aparecen ANTES que sus hijos (orden de
// pantalla, sin ciclos) y profundidad máxima. Devuelve los ítems con los
// títulos ya recortados.
func ValidateTemplate(name string, items []TemplateItem) ([]TemplateItem, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("la plantilla necesita un nombre")
	}
	if len(items) == 0 {
		return nil, errors.New("la plantilla necesita al menos un ítem")
	}
	if len(items) > MaxItems {
		return nil, fmt.Errorf("una plantilla admite hasta %d ítems", MaxItems)
	}
	depth := make(map[string]int, len(items))
	siblings := make(map[string]map[string]bool)
	out := make([]TemplateItem, 0, len(items))
	for _, item := range items {
		title := strings.TrimSpace(item.Title)
		if item.Key == "" {
			return nil, errors.New("cada ítem necesita una clave")
		}
		if _, dup := depth[item.Key]; dup {
			return nil, fmt.Errorf("ítem repetido: %q", item.Key)
		}
		if title == "" {
			return nil, errors.New("hay un ítem sin nombre")
		}
		level := 1
		if item.ParentKey != "" {
			parentDepth, ok := depth[item.ParentKey]
			if !ok {
				return nil, fmt.Errorf("el sub-ítem %q apunta a un ítem que no está antes en la lista", title)
			}
			level = parentDepth + 1
		}
		if level > MaxDepth {
			return nil, fmt.Errorf("%q supera los %d niveles permitidos", title, MaxDepth)
		}
		group := siblings[item.ParentKey]
		if group == nil {
			group = make(map[string]bool)
			siblings[item.ParentKey] = group
		}
		lower := strings.ToLower(title)
		if group[lower] {
			return nil, fmt.Errorf("%q está repetido en el mismo nivel", title)
		}
		group[lower] = true
		depth[item.Key] = level
		out = append(out, TemplateItem{Key: item.Key, ParentKey: item.ParentKey, Title: title})
	}
	return out, nil
}
