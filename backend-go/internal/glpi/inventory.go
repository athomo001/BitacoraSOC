package glpi

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Itemtypes de GLPI que se importan (decisión del dueño 2026-10-15).
const (
	Computer         = "Computer"
	NetworkEquipment = "NetworkEquipment"
)

// Item es un equipo de GLPI con lo que la Bitácora toma de él. Los campos
// vacíos son «GLPI no lo trae»: al importar no borran lo que ya hay.
type Item struct {
	Itemtype     string   `json:"itemtype"`
	ID           int      `json:"id"`
	Name         string   `json:"name"`
	Serial       string   `json:"serial"`
	Manufacturer string   `json:"manufacturer"`
	Model        string   `json:"model"`
	Type         string   `json:"type"`
	Location     string   `json:"location"`
	Entity       string   `json:"entity"`
	EntityID     int      `json:"entityId"`
	OS           string   `json:"os"`
	OSVersion    string   `json:"osVersion"`
	CPU          string   `json:"cpu"`
	RAMMB        int      `json:"ramMb"`
	Disk         string   `json:"disk"`
	IPs          []string `json:"ips"`
}

// Key identifica un ítem de GLPI («Computer:1042»).
func Key(itemtype string, id int) string { return itemtype + ":" + strconv.Itoa(id) }

// Entity es una entidad de GLPI.
type Entity struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// Snapshot es todo lo que se leyó de GLPI en una corrida.
type Snapshot struct {
	Items []Item
	// Trashed: en la papelera de GLPI (Key → nombre).
	Trashed map[string]string
	// Warnings: datos que no se pudieron leer (el resto sí se importa; esos
	// campos no se tocan).
	Warnings []string
}

// Options dice qué tipos se traen.
type Options struct {
	Computers bool
	Network   bool
}

// Entities lee las entidades que ve el usuario del token.
func Entities(ctx context.Context, s *Session) ([]Entity, error) {
	rows, err := s.List(ctx, "Entity", nil)
	if err != nil {
		return nil, err
	}
	out := make([]Entity, 0, len(rows))
	for _, r := range rows {
		name := Str(r["completename"])
		if name == "" {
			name = Str(r["name"])
		}
		out = append(out, Entity{ID: Int(r["id"]), Name: name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// ComputerTypes lee los tipos de computador de GLPI (Server, Laptop…).
func ComputerTypes(ctx context.Context, s *Session) ([]string, error) {
	rows, err := s.List(ctx, "ComputerType", nil)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if n := Str(r["name"]); n != "" {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out, nil
}

// itemFields: de dónde sale cada dato en cada itemtype (con expand_dropdowns
// los desplegables vienen con su nombre).
var itemFields = map[string]struct{ model, typ string }{
	Computer:         {"computermodels_id", "computertypes_id"},
	NetworkEquipment: {"networkequipmentmodels_id", "networkequipmenttypes_id"},
}

// Fetch lee los equipos y sus componentes. Si no se pueden leer los equipos
// o las entidades, falla entero (no se importa nada); si falla un componente
// (SO, CPU, RAM, disco, IP), sigue sin ese dato y lo anota en Warnings.
func Fetch(ctx context.Context, s *Session, opt Options) (Snapshot, error) {
	snap := Snapshot{Trashed: map[string]string{}}
	entities, err := Entities(ctx, s)
	if err != nil {
		return snap, fmt.Errorf("entidades: %w", err)
	}
	entityID := map[string]int{}
	for _, e := range entities {
		entityID[e.Name] = e.ID
	}
	var types []string
	if opt.Computers {
		types = append(types, Computer)
	}
	if opt.Network {
		types = append(types, NetworkEquipment)
	}
	index := map[string]int{}
	for _, it := range types {
		rows, err := s.List(ctx, it, url.Values{"expand_dropdowns": {"true"}})
		if err != nil {
			return snap, fmt.Errorf("%s: %w", it, err)
		}
		f := itemFields[it]
		for _, r := range rows {
			if Int(r["is_template"]) == 1 {
				continue // plantilla de GLPI, no es un equipo
			}
			item := Item{Itemtype: it, ID: Int(r["id"]), Name: Str(r["name"]), Serial: Str(r["serial"]),
				Manufacturer: Str(r["manufacturers_id"]), Model: Str(r[f.model]), Type: Str(r[f.typ]),
				Location: Str(r["locations_id"]), Entity: Str(r["entities_id"])}
			item.EntityID = entityID[item.Entity]
			if it == NetworkEquipment {
				item.RAMMB = Int(r["ram"])
			}
			if item.Name == "" {
				item.Name = fmt.Sprintf("%s-%d", it, item.ID)
			}
			index[Key(it, item.ID)] = len(snap.Items)
			snap.Items = append(snap.Items, item)
		}
		trashed, err := s.List(ctx, it, url.Values{"is_deleted": {"true"}})
		if err != nil {
			return snap, fmt.Errorf("%s (papelera): %w", it, err)
		}
		for _, r := range trashed {
			if Int(r["is_template"]) != 1 {
				snap.Trashed[Key(it, Int(r["id"]))] = Str(r["name"])
			}
		}
	}
	at := func(r map[string]any, typeField, idField string) *Item {
		i, ok := index[Key(Str(r[typeField]), Int(r[idField]))]
		if !ok {
			return nil
		}
		return &snap.Items[i]
	}
	warn := func(what string, err error) {
		snap.Warnings = append(snap.Warnings, fmt.Sprintf("No se pudo leer %s: %s", what, Explain(err).Error))
	}

	// Sistema operativo (lo llena el GLPI Agent).
	if names, err := dropdownNames(ctx, s, "OperatingSystem", "name"); err != nil {
		warn("el sistema operativo", err)
	} else if versions, err := dropdownNames(ctx, s, "OperatingSystemVersion", "name"); err != nil {
		warn("la versión del sistema operativo", err)
	} else if rows, err := s.List(ctx, "Item_OperatingSystem", nil); err != nil {
		warn("el sistema operativo", err)
	} else {
		for _, r := range rows {
			if item := at(r, "itemtype", "items_id"); item != nil && item.OS == "" {
				item.OS, item.OSVersion = names[Int(r["operatingsystems_id"])], versions[Int(r["operatingsystemversions_id"])]
			}
		}
	}

	// CPU: «2 × Xeon Gold 6226R».
	if names, err := dropdownNames(ctx, s, "DeviceProcessor", "designation"); err != nil {
		warn("los procesadores", err)
	} else if rows, err := s.List(ctx, "Item_DeviceProcessor", nil); err != nil {
		warn("los procesadores", err)
	} else {
		cpus := map[*Item][]string{}
		for _, r := range rows {
			if item := at(r, "itemtype", "items_id"); item != nil {
				if n := names[Int(r["deviceprocessors_id"])]; n != "" {
					cpus[item] = append(cpus[item], n)
				}
			}
		}
		for item, list := range cpus {
			item.CPU = grouped(list)
		}
	}

	// RAM: suma de los módulos (MB).
	if rows, err := s.List(ctx, "Item_DeviceMemory", nil); err != nil {
		warn("la memoria", err)
	} else {
		ram := map[*Item]int{}
		for _, r := range rows {
			if item := at(r, "itemtype", "items_id"); item != nil {
				ram[item] += Int(r["size"])
			}
		}
		for item, mb := range ram {
			if mb > 0 {
				item.RAMMB = mb
			}
		}
	}

	// Disco: «2 × 960 GB».
	if rows, err := s.List(ctx, "Item_DeviceHardDrive", nil); err != nil {
		warn("los discos", err)
	} else {
		disks := map[*Item][]string{}
		for _, r := range rows {
			if item := at(r, "itemtype", "items_id"); item != nil {
				if mb := Int(r["capacity"]); mb > 0 {
					disks[item] = append(disks[item], FormatMB(mb))
				}
			}
		}
		for item, list := range disks {
			item.Disk = grouped(list)
		}
	}

	// IP: las del equipo, sin loopback ni enlace local.
	if rows, err := s.List(ctx, "IPAddress", nil); err != nil {
		warn("las direcciones IP", err)
	} else {
		for _, r := range rows {
			item := at(r, "mainitemtype", "mainitems_id")
			ip := net.ParseIP(Str(r["name"]))
			if item == nil || ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
				continue
			}
			addr := ip.String()
			dup := false
			for _, x := range item.IPs {
				dup = dup || x == addr
			}
			if !dup {
				item.IPs = append(item.IPs, addr)
			}
		}
		for i := range snap.Items {
			sort.Strings(snap.Items[i].IPs)
		}
	}
	return snap, nil
}

// dropdownNames lee un catálogo de GLPI como id → nombre.
func dropdownNames(ctx context.Context, s *Session, itemtype, field string) (map[int]string, error) {
	rows, err := s.List(ctx, itemtype, nil)
	if err != nil {
		return nil, err
	}
	out := make(map[int]string, len(rows))
	for _, r := range rows {
		out[Int(r["id"])] = Str(r[field])
	}
	return out, nil
}

// grouped: [a a b] → «2 × a + b».
func grouped(list []string) string {
	counts := map[string]int{}
	var order []string
	for _, x := range list {
		if counts[x] == 0 {
			order = append(order, x)
		}
		counts[x]++
	}
	parts := make([]string, 0, len(order))
	for _, x := range order {
		if counts[x] > 1 {
			parts = append(parts, fmt.Sprintf("%d × %s", counts[x], x))
		} else {
			parts = append(parts, x)
		}
	}
	return strings.Join(parts, " + ")
}

// FormatMB: 983040 → «960 GB», 1966080 → «1,9 TB» (GLPI guarda MB).
func FormatMB(mb int) string {
	gb := float64(mb) / 1024
	if gb >= 1000 {
		return strings.Replace(strconv.FormatFloat(gb/1024, 'f', 1, 64), ".", ",", 1) + " TB"
	}
	return strconv.FormatFloat(gb, 'f', 0, 64) + " GB"
}

// RAMGB: MB → GB para el campo «RAM (GB)» (128, 15.5).
func RAMGB(mb int) string {
	if mb <= 0 {
		return ""
	}
	gb := float64(mb) / 1024
	if gb == float64(int(gb)) {
		return strconv.Itoa(int(gb))
	}
	return strconv.FormatFloat(gb, 'f', 1, 64)
}
