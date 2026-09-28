package checklist

import (
	"fmt"
	"regexp"
	"strings"
)

type Status string

const (
	Green Status = "verde"
	Red   Status = "rojo"
)

type Item struct {
	ID       string
	ParentID *string
	Title    string
}

type Observation struct {
	Status      Status
	Observation string
}

type Result struct {
	Status      Status
	Observation string
	IsComputed  bool
}

// Evaluate validates leaf input and derives every parent using worst-status-wins.
// Parent observations stay empty because they describe the aggregate, not a new leaf.
func Evaluate(items []Item, observations map[string]Observation) (map[string]Result, error) {
	children := make(map[string][]Item)
	byID := make(map[string]Item, len(items))
	for _, item := range items {
		byID[item.ID] = item
		if item.ParentID != nil {
			children[*item.ParentID] = append(children[*item.ParentID], item)
		}
	}
	results := make(map[string]Result, len(items))
	var visit func(Item) (Result, error)
	visit = func(item Item) (Result, error) {
		if existing, ok := results[item.ID]; ok {
			return existing, nil
		}
		itemChildren := children[item.ID]
		if len(itemChildren) == 0 {
			observation, ok := observations[item.ID]
			if !ok {
				return Result{}, fmt.Errorf("falta estado para el ítem %q", item.Title)
			}
			if observation.Status != Green && observation.Status != Red {
				return Result{}, fmt.Errorf("estado inválido para el ítem %q", item.Title)
			}
			if observation.Status == Red && observation.Observation == "" {
				return Result{}, fmt.Errorf("el ítem rojo %q requiere observación", item.Title)
			}
			result := Result{Status: observation.Status, Observation: observation.Observation}
			results[item.ID] = result
			return result, nil
		}
		status := Green
		for _, child := range itemChildren {
			childResult, err := visit(child)
			if err != nil {
				return Result{}, err
			}
			if childResult.Status == Red {
				status = Red
			}
		}
		result := Result{Status: status, IsComputed: true}
		results[item.ID] = result
		return result, nil
	}
	for _, item := range items {
		if _, err := visit(item); err != nil {
			return nil, err
		}
	}
	for _, item := range items {
		if item.ParentID != nil {
			if _, ok := byID[*item.ParentID]; !ok {
				return nil, fmt.Errorf("padre inexistente para el ítem %q", item.Title)
			}
		}
	}
	return results, nil
}

// Groups devuelve los ítems que tienen sub-ítems. Esos se calculan con
// "peor estado gana" y nunca se responden a mano; las hojas (sin hijos,
// tengan o no padre) son las únicas que el analista evalúa.
func Groups(items []Item) map[string]bool {
	groups := make(map[string]bool)
	for _, item := range items {
		if item.ParentID != nil {
			groups[*item.ParentID] = true
		}
	}
	return groups
}

var keywordPattern = regexp.MustCompile(`[[:alnum:]]{4,}`)

func relatedTitles(left, right string) bool {
	seen := make(map[string]struct{})
	for _, word := range keywordPattern.FindAllString(strings.ToLower(left), -1) {
		seen[word] = struct{}{}
	}
	for _, word := range keywordPattern.FindAllString(strings.ToLower(right), -1) {
		if _, ok := seen[word]; ok {
			return true
		}
	}
	return false
}

// Correlate enlaza cada hoja en rojo con la primera hoja en rojo ANTERIOR
// (en el orden de la plantilla) cuyo título comparte una palabra clave —
// posible misma causa (`correlated_from_service_id`). Solo hacia atrás, así
// dos ítems relacionados nunca quedan apuntándose entre sí. Devuelve
// ítem → ítem del que se correlaciona.
func Correlate(items []Item, results map[string]Result) map[string]string {
	groups := Groups(items)
	var redLeaves []Item
	for _, item := range items {
		if !groups[item.ID] && results[item.ID].Status == Red {
			redLeaves = append(redLeaves, item)
		}
	}
	links := make(map[string]string)
	for i, item := range redLeaves {
		for _, earlier := range redLeaves[:i] {
			if relatedTitles(earlier.Title, item.Title) {
				links[item.ID] = earlier.ID
				break
			}
		}
	}
	return links
}
