package checklist

import "fmt"

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
