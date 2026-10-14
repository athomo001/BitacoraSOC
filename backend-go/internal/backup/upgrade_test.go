package backup

import (
	"encoding/json"
	"testing"
)

// Un respaldo de antes de 000033 trae module_scope y los interruptores
// SOC/NOC; al restaurarlo, las áreas salen de ahí.
func TestUpgradeTablesBuildsAreasFromOldBackup(t *testing.T) {
	tables := map[string]json.RawMessage{
		"app_config":        json.RawMessage(`[{"id": true, "soc_module_enabled": true, "noc_module_enabled": false}]`),
		"permission_groups": json.RawMessage(`[{"id": "g1", "module_scope": "both"}, {"id": "g2", "module_scope": "noc"}, {"id": "g3", "module_scope": "none"}]`),
	}
	upgradeTables(tables)

	var areas []struct {
		ID     string `json:"id"`
		Code   string `json:"code"`
		Active bool   `json:"active"`
	}
	if err := json.Unmarshal(tables["areas"], &areas); err != nil || len(areas) != 2 {
		t.Fatalf("areas: %s", tables["areas"])
	}
	if areas[0].Code != "soc" || !areas[0].Active || areas[1].Code != "noc" || areas[1].Active {
		t.Fatalf("SOC activa y NOC no: %+v", areas)
	}
	var links []map[string]string
	_ = json.Unmarshal(tables["permission_group_areas"], &links)
	want := []map[string]string{
		{"permission_group_id": "g1", "area_id": areaSOCID},
		{"permission_group_id": "g1", "area_id": areaNOCID},
		{"permission_group_id": "g2", "area_id": areaNOCID},
	}
	if len(links) != len(want) {
		t.Fatalf("links: %v", links)
	}
	for i := range want {
		if links[i]["permission_group_id"] != want[i]["permission_group_id"] || links[i]["area_id"] != want[i]["area_id"] {
			t.Fatalf("links[%d] = %v, quería %v", i, links[i], want[i])
		}
	}
}

func TestUpgradeTablesLeavesNewBackupsAlone(t *testing.T) {
	tables := map[string]json.RawMessage{"areas": json.RawMessage(`[{"code":"ti","default_profile":"gestion"}]`)}
	upgradeTables(tables)
	if string(tables["areas"]) != `[{"code":"ti","default_profile":"gestion"}]` {
		t.Fatalf("un respaldo que ya trae áreas con perfil no se toca: %s", tables["areas"])
	}
}

func TestUpgradeTablesFillsAreaProfiles(t *testing.T) {
	// Respaldo entre 000033 y 000034: trae áreas, pero sin perfil.
	tables := map[string]json.RawMessage{"areas": json.RawMessage(`[{"code":"soc"},{"code":"noc"},{"code":"infra"}]`)}
	upgradeTables(tables)
	var areas []map[string]string
	_ = json.Unmarshal(tables["areas"], &areas)
	want := map[string]string{"soc": "operativo", "noc": "operativo", "infra": "resolutor"}
	for _, a := range areas {
		if a["default_profile"] != want[a["code"]] {
			t.Fatalf("%s: perfil %q, quería %q", a["code"], a["default_profile"], want[a["code"]])
		}
	}
}
