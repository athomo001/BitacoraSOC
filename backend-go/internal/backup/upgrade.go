package backup

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// Ids fijos de las áreas de sistema (migración 000033). Los respaldos de
// antes de esa migración se actualizan con estos mismos ids.
const (
	areaSOCID = "a0000000-0000-4000-8000-000000000001"
	areaNOCID = "a0000000-0000-4000-8000-000000000002"
)

// upgradeTables actualiza un respaldo anterior al esquema de hoy, antes de
// restaurarlo. Hoy: los respaldos de antes de 000033 no traen `areas` ni
// `permission_group_areas`; lo mismo sale de app_config.soc/noc_module_enabled
// y de permission_groups.module_scope, que sí traen (esas columnas ya no
// existen y la restauración las ignora).
func upgradeTables(tables map[string]json.RawMessage) {
	if _, ok := tables["areas"]; !ok {
		buildAreas(tables)
	}
	fillAreaProfiles(tables)
}

// fillAreaProfiles: los respaldos de antes de 000034 no traen el perfil de
// cada área; sin esto SOC y NOC quedarían como Resolutor (el default).
func fillAreaProfiles(tables map[string]json.RawMessage) {
	var areas []map[string]any
	if err := json.Unmarshal(tables["areas"], &areas); err != nil {
		return
	}
	for _, a := range areas {
		if _, ok := a["default_profile"]; ok {
			continue
		}
		a["default_profile"] = "resolutor"
		if a["code"] == "soc" || a["code"] == "noc" {
			a["default_profile"] = "operativo"
		}
	}
	tables["areas"], _ = json.Marshal(areas)
}

func buildAreas(tables map[string]json.RawMessage) {
	var config []struct {
		SOC bool `json:"soc_module_enabled"`
		NOC bool `json:"noc_module_enabled"`
	}
	_ = json.Unmarshal(tables["app_config"], &config)
	soc, noc := false, false
	if len(config) > 0 {
		soc, noc = config[0].SOC, config[0].NOC
	}
	areas, _ := json.Marshal([]map[string]any{
		{"id": areaSOCID, "code": "soc", "name": "SOC", "active": soc, "is_system": true, "sort_order": 10},
		{"id": areaNOCID, "code": "noc", "name": "NOC", "active": noc, "is_system": true, "sort_order": 20},
	})
	tables["areas"] = areas

	var groups []struct {
		ID    string `json:"id"`
		Scope string `json:"module_scope"`
	}
	_ = json.Unmarshal(tables["permission_groups"], &groups)
	links := []map[string]string{}
	for _, g := range groups {
		if g.Scope == "soc" || g.Scope == "both" {
			links = append(links, map[string]string{"permission_group_id": g.ID, "area_id": areaSOCID})
		}
		if g.Scope == "noc" || g.Scope == "both" {
			links = append(links, map[string]string{"permission_group_id": g.ID, "area_id": areaNOCID})
		}
	}
	tables["permission_group_areas"], _ = json.Marshal(links)
}

// ensureCatalogDefaults deja las filas que siembran las migraciones si
// faltan después de purgar o de restaurar un respaldo anterior a ellas: sin
// ellas el sistema queda roto (sin SOC/NOC, sin niveles, y crear un ticket
// falla porque la configuración de la Ticketera no existe).
func ensureCatalogDefaults(ctx context.Context, tx pgx.Tx) error {
	for _, q := range []string{
		`INSERT INTO ticket_settings (id) VALUES (true) ON CONFLICT DO NOTHING`,
		`INSERT INTO areas (id, code, name, active, is_system, sort_order, default_profile) VALUES
			('` + areaSOCID + `', 'soc', 'SOC', false, true, 10, 'operativo'),
			('` + areaNOCID + `', 'noc', 'NOC', false, true, 20, 'operativo')
		 ON CONFLICT DO NOTHING`,
		`INSERT INTO levels (id, code, name, rank) VALUES
			('a0000000-0000-4000-8000-000000000101', 'n1', 'N1', 1),
			('a0000000-0000-4000-8000-000000000102', 'n2', 'N2', 2),
			('a0000000-0000-4000-8000-000000000103', 'n3', 'N3', 3)
		 ON CONFLICT DO NOTHING`,
	} {
		if _, err := tx.Exec(ctx, q); err != nil {
			return err
		}
	}
	return nil
}
