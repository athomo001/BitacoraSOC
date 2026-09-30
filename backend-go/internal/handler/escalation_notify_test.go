package handler

import "testing"

func TestNotifyStepIndex(t *testing.T) {
	steps := []resolvedStepDTO{{Order: 1}, {Order: 2}, {Order: 4}}
	two, four, nine := int32(2), int32(4), int32(9)
	if i, ok := notifyStepIndex(steps, nil); !ok || i != 0 {
		t.Fatalf("sin paso pedido va al primero: %d %v", i, ok)
	}
	if i, ok := notifyStepIndex(steps, &two); !ok || i != 1 {
		t.Fatalf("paso 2 → índice 1: %d %v", i, ok)
	}
	if i, ok := notifyStepIndex(steps, &four); !ok || i != 2 {
		t.Fatalf("paso 4 → índice 2 (los órdenes pueden saltar): %d %v", i, ok)
	}
	if _, ok := notifyStepIndex(steps, &nine); ok {
		t.Fatal("un paso que no existe debe rechazarse")
	}
	if _, ok := notifyStepIndex(nil, nil); ok {
		t.Fatal("sin pasos no hay a quién avisar")
	}
}
