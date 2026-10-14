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

func TestUpgradeTablesFillsGuardAreas(t *testing.T) {
	tables := map[string]json.RawMessage{
		"areas": json.RawMessage(`[{"id":"` + areaSOCID + `","code":"soc","default_profile":"operativo"}]`),
		"teams": json.RawMessage(`[{"name":"Guardia N2","kind":"oncall"},{"name":"Guardia TI","kind":"oncall"},{"name":"Mundo","kind":"escalation"}]`),
	}
	upgradeTables(tables)
	var teams []map[string]any
	_ = json.Unmarshal(tables["teams"], &teams)
	var areas []map[string]any
	_ = json.Unmarshal(tables["areas"], &areas)
	if len(areas) != 2 || areas[1]["code"] != "ti" {
		t.Fatalf("se agrega el área TI: %v", areas)
	}
	if teams[0]["area_id"] != areaSOCID || teams[1]["area_id"] != areas[1]["id"] || teams[2]["area_id"] != nil {
		t.Fatalf("áreas de las guardias: %v", teams)
	}
}

func TestUpgradeTablesFillsModuleFlags(t *testing.T) {
	tables := map[string]json.RawMessage{
		"app_config": json.RawMessage(`[{"id":true}]`),
		"areas":      json.RawMessage(`[{"code":"soc","active":true,"default_profile":"operativo"},{"code":"noc","active":false,"default_profile":"operativo"}]`),
	}
	upgradeTables(tables)
	var config []map[string]any
	_ = json.Unmarshal(tables["app_config"], &config)
	if config[0]["soc_module_enabled"] != true || config[0]["noc_module_enabled"] != false {
		t.Fatalf("los módulos salen de las áreas del respaldo: %v", config)
	}
}

func TestUpgradeTablesFillsTicketAreas(t *testing.T) {
	tables := map[string]json.RawMessage{
		"areas":   json.RawMessage(`[{"code":"soc","active":true,"default_profile":"operativo"}]`),
		"tickets": json.RawMessage(`[{"id":"t1","scope":"soc"},{"id":"t2","scope":"noc"},{"id":"t3","scope":"general"}]`),
	}
	upgradeTables(tables)
	var tickets []map[string]any
	_ = json.Unmarshal(tables["tickets"], &tickets)
	want := []string{areaSOCID, areaNOCID, areaSOCID}
	for i, tk := range tickets {
		if tk["area_id"] != want[i] || tk["requested_area_id"] != want[i] {
			t.Errorf("ticket %v: área %v, pedido por %v; quería %s", tk["id"], tk["area_id"], tk["requested_area_id"], want[i])
		}
	}
}
