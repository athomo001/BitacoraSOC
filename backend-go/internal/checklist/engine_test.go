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

// Regresión (Fases 10-13): el handler trataba "tiene padre" como "es grupo"
// y rechazaba justamente las hojas de una plantilla jerárquica.
func TestGroupsAreItemsWithChildrenNotItemsWithParent(t *testing.T) {
	parent := "sede-norte"
	items := []Item{
		{ID: parent, Title: "Conectividad Sede Norte"},
		{ID: "router", ParentID: &parent, Title: "Router Principal"},
		{ID: "switch", ParentID: &parent, Title: "Switch Backup"},
		{ID: "camaras", Title: "Cámaras Sala de Control"},
	}
	groups := Groups(items)
	if !groups[parent] {
		t.Fatal("un ítem con sub-ítems es grupo")
	}
	for _, leaf := range []string{"router", "switch", "camaras"} {
		if groups[leaf] {
			t.Fatalf("%q es hoja (con o sin padre) y se evalúa a mano", leaf)
		}
	}
}

func TestCorrelateLinksLaterRedLeafToEarlierOneOnly(t *testing.T) {
	parent := "sede"
	items := []Item{
		{ID: "troncal", Title: "Enlace Troncal Fibra"},
		{ID: parent, Title: "Sede Norte"},
		{ID: "backup", ParentID: &parent, Title: "Enlace Backup Fibra"},
		{ID: "dns", Title: "DNS interno"},
	}
	results := map[string]Result{
		"troncal": {Status: Red},
		parent:    {Status: Red, IsComputed: true},
		"backup":  {Status: Red},
		"dns":     {Status: Red},
	}
	links := Correlate(items, results)
	if links["backup"] != "troncal" {
		t.Fatalf("backup debería correlacionarse con troncal, got %#v", links)
	}
	if _, ok := links["troncal"]; ok {
		t.Fatal("el primero no apunta al segundo: nada de enlaces circulares")
	}
	if _, ok := links[parent]; ok {
		t.Fatal("un grupo calculado nunca se correlaciona")
	}
	if _, ok := links["dns"]; ok {
		t.Fatal("sin palabra clave compartida no hay correlación")
	}
}
