package checklist

import "testing"

func TestEvaluateComputesParentFromWorstChild(t *testing.T) {
	parent := "parent"
	items := []Item{
		{ID: parent, Title: "Servicios"},
		{ID: "child-green", ParentID: &parent, Title: "DNS"},
		{ID: "child-red", ParentID: &parent, Title: "Firewall"},
	}
	result, err := Evaluate(items, map[string]Observation{
		"child-green": {Status: Green},
		"child-red":   {Status: Red, Observation: "sin respuesta"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result[parent].Status != Red || !result[parent].IsComputed {
		t.Fatalf("parent = %#v, want computed red", result[parent])
	}
	if result[parent].Observation != "" {
		t.Fatalf("computed parent observation = %q, want empty", result[parent].Observation)
	}
}

func TestEvaluateRejectsRedLeafWithoutObservation(t *testing.T) {
	_, err := Evaluate([]Item{{ID: "leaf", Title: "VPN"}}, map[string]Observation{
		"leaf": {Status: Red},
	})
	if err == nil {
		t.Fatal("expected missing observation error")
	}
}
