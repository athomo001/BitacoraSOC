package handler

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Carga masiva del Inventario por CSV (9.2): un archivo por tipo, con las
// columnas comunes más los campos del tipo. El archivo se lee y se procesa en
// memoria y nunca se guarda: la revisión (?dryRun=true) y la carga final
// reciben el mismo archivo desde el navegador. Cada fila se busca por código:
// si existe se actualiza (los cambios quedan en su historial como «Carga
// masiva»); si no, se crea. Las filas con error no se cargan; el resto sí.

const maxInventoryCSVBytes = 5 << 20

var inventoryCommonColumns = []string{"codigo", "nombre", "area", "localidad", "cliente", "marca_modelo", "serie", "rack", "posicion", "ips", "responsables"}

// ipKindAlias: lo que se escribe en la columna ips antes del «=».
var ipKindAlias = map[string]string{
	"red": "network", "network": "network", "lan": "network",
	"vip": "vip", "balanceo": "vip", "balanceo (vip)": "vip",
	"ilo": "management", "idrac": "management", "administracion": "management", "administración": "management", "admin": "management", "gestion": "management", "gestión": "management", "management": "management",
	"otra": "other", "other": "other",
}

type csvRowResult struct {
	Line   int    `json:"line"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Action string `json:"action"` // create | update | unchanged | error
	Detail string `json:"detail,omitempty"`
	Error  string `json:"error,omitempty"`
}

type csvImportResult struct {
	Rows      []csvRowResult `json:"rows"`
	Created   int            `json:"created"`
	Updated   int            `json:"updated"`
	Unchanged int            `json:"unchanged"`
	Errors    int            `json:"errors"`
	Applied   bool           `json:"applied"`
}

// readCSV detecta el separador («;» de Excel en español o «,») y quita el BOM.
func readCSV(raw []byte) ([][]string, error) {
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(raw) {
		return nil, errors.New("el archivo no está en UTF-8: en Excel, guárdalo como «CSV UTF-8»")
	}
	first := string(raw)
	if i := strings.IndexByte(first, '\n'); i >= 0 {
		first = first[:i]
	}
	r := csv.NewReader(bytes.NewReader(raw))
	r.Comma = ','
	if strings.Count(first, ";") > strings.Count(first, ",") {
		r.Comma = ';'
	}
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	return r.ReadAll()
}

type csvLookups struct {
	units     map[string]uuid.UUID // código o nombre (en minúsculas) → id; nil = ambiguo
	ambiguous map[string]bool
	orgs      map[string]uuid.UUID
	users     map[string]uuid.UUID
	areaName  map[string]string // nombre o código (minúsculas) → código
	respType  map[string]string // nombre o código (minúsculas) → código
}

func (h *InventoryHandler) lookups(ctx context.Context) (csvLookups, error) {
	l := csvLookups{units: map[string]uuid.UUID{}, ambiguous: map[string]bool{}, orgs: map[string]uuid.UUID{}, users: map[string]uuid.UUID{}, areaName: map[string]string{}, respType: map[string]string{}}
	units, err := h.Queries.ListTerritorialUnits(ctx, db.ListTerritorialUnitsParams{PageSize: 100000})
	if err != nil {
		return l, err
	}
	for _, u := range units {
		l.units[strings.ToLower(u.Code)] = u.ID
		name := strings.ToLower(u.Name)
		if _, seen := l.units[name]; seen && l.units[name] != u.ID {
			l.ambiguous[name] = true
		}
		l.units[name] = u.ID
	}
	orgs, err := h.Queries.ListOrganizations(ctx, db.ListOrganizationsParams{})
	if err != nil {
		return l, err
	}
	for _, o := range orgs {
		l.orgs[strings.ToLower(o.Name)] = o.ID
		l.orgs[strings.ToLower(o.Code)] = o.ID
	}
	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{})
	if err != nil {
		return l, err
	}
	for _, u := range users {
		l.users[strings.ToLower(u.Username)] = u.ID
		l.users[strings.ToLower(u.Email)] = u.ID
	}
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return l, err
	}
	for _, a := range areas {
		l.areaName[strings.ToLower(a.Code)] = a.Code
		l.areaName[strings.ToLower(a.Name)] = a.Code
	}
	types, err := h.Queries.ListResponsibilityTypes(ctx)
	if err != nil {
		return l, err
	}
	for _, t := range types {
		l.respType[strings.ToLower(t.Code)] = t.Code
		l.respType[strings.ToLower(t.Name)] = t.Code
	}
	return l, nil
}

// splitList: «a; b; c» → [a b c] (sin vacíos).
func splitList(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ";") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// rowInput convierte una fila en la misma entrada que usa el formulario.
func rowInput(kind string, cols map[string]string, l csvLookups) (inventoryInput, string) {
	in := inventoryInput{Kind: kind, Code: cols["codigo"], Name: cols["nombre"], Model: cols["marca_modelo"], Serial: cols["serie"],
		Rack: cols["rack"], RackPosition: cols["posicion"], Attributes: map[string]string{}, Extra: map[string]string{}, IPs: []assetIPDTO{}, Responsibles: []assetResponsibleDTO{}}
	if in.Name == "" {
		in.Name = in.Code
	}
	area, ok := l.areaName[strings.ToLower(cols["area"])]
	if !ok {
		return in, fmt.Sprintf("área «%s» no existe", cols["area"])
	}
	in.Area = area
	if v := strings.ToLower(cols["localidad"]); v != "" {
		if l.ambiguous[v] {
			return in, fmt.Sprintf("hay más de una localidad «%s»: usa su código", cols["localidad"])
		}
		id, ok := l.units[v]
		if !ok {
			return in, fmt.Sprintf("localidad «%s» no existe", cols["localidad"])
		}
		in.TerritorialUnitID = &id
	}
	if v := strings.ToLower(cols["cliente"]); v != "" {
		id, ok := l.orgs[v]
		if !ok {
			return in, fmt.Sprintf("cliente «%s» no existe en Organizaciones", cols["cliente"])
		}
		in.ClientID = &id
	}
	for _, p := range splitList(cols["ips"]) {
		k, addr, found := strings.Cut(p, "=")
		if !found {
			k, addr = "red", p
		}
		kind, ok := ipKindAlias[strings.ToLower(strings.TrimSpace(k))]
		if !ok {
			return in, fmt.Sprintf("tipo de IP «%s» no se reconoce (Red, VIP, iLO u Otra)", k)
		}
		in.IPs = append(in.IPs, assetIPDTO{Kind: kind, Address: strings.TrimSpace(addr)})
	}
	for _, p := range splitList(cols["responsables"]) {
		what, who, found := strings.Cut(p, "=")
		if !found {
			return in, fmt.Sprintf("responsable «%s»: escribe qué=área:Nombre, persona:usuario u org:Organización", p)
		}
		t, ok := l.respType[strings.ToLower(strings.TrimSpace(what))]
		if !ok {
			return in, fmt.Sprintf("tipo de responsabilidad «%s» no existe", what)
		}
		prefix, name, _ := strings.Cut(strings.TrimSpace(who), ":")
		name = strings.ToLower(strings.TrimSpace(name))
		rs := assetResponsibleDTO{Type: t}
		switch strings.ToLower(strings.TrimSpace(prefix)) {
		case "área", "area":
			code, ok := l.areaName[name]
			if !ok {
				return in, fmt.Sprintf("área responsable «%s» no existe", name)
			}
			rs.Area = code
		case "persona", "usuario":
			id, ok := l.users[name]
			if !ok {
				return in, fmt.Sprintf("usuario «%s» no existe", name)
			}
			rs.UserID = &id
		case "org", "organización", "organizacion":
			id, ok := l.orgs[name]
			if !ok {
				return in, fmt.Sprintf("organización «%s» no existe", name)
			}
			rs.OrganizationID = &id
		default:
			return in, fmt.Sprintf("responsable «%s»: empieza con área:, persona: u org:", who)
		}
		in.Responsibles = append(in.Responsibles, rs)
	}
	return in, ""
}

// Import es POST /api/inventory/import?kind=&dryRun=true (cuerpo: el CSV).
func (h *InventoryHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	kindCode := r.URL.Query().Get("kind")
	kind, err := h.Queries.GetAssetKind(ctx, kindCode)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-kind", "elige el tipo de equipo del archivo")
		return
	}
	var fields []kindField
	_ = json.Unmarshal(kind.Fields, &fields)
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxInventoryCSVBytes))
	if err != nil {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "too-large", "el archivo supera 5 MB: divídelo en partes")
		return
	}
	records, err := readCSV(raw)
	raw = nil // el archivo no se guarda: solo vive mientras se procesa
	if err != nil || len(records) < 2 {
		msg := "el archivo no trae filas"
		if err != nil {
			msg = err.Error()
		}
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-csv", msg)
		return
	}
	header := make([]string, len(records[0]))
	for i, c := range records[0] {
		header[i] = strings.ToLower(strings.TrimSpace(c))
	}
	if !contains(header, "codigo") || !contains(header, "area") {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-csv", "faltan las columnas «codigo» y «area»: baja la plantilla del tipo")
		return
	}
	l, err := h.lookups(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los catálogos")
		return
	}
	known := map[string]bool{}
	for _, c := range inventoryCommonColumns {
		known[c] = true
	}
	for _, f := range fields {
		known[f.Key] = true
	}
	dryRun := r.URL.Query().Get("dryRun") == "true"
	names := h.names(ctx)
	res := csvImportResult{Rows: []csvRowResult{}, Applied: !dryRun}
	seen := map[string]int{}
	for i, rec := range records[1:] {
		line := i + 2
		cols := map[string]string{}
		attrs := map[string]string{}
		extra := map[string]string{}
		empty := true
		for j, v := range rec {
			if j >= len(header) {
				break
			}
			v = strings.TrimSpace(v)
			if v != "" {
				empty = false
			}
			switch {
			case known[header[j]] && !contains(inventoryCommonColumns, header[j]):
				attrs[header[j]] = v
			case known[header[j]]:
				cols[header[j]] = v
			case header[j] != "" && v != "":
				extra[header[j]] = v // columnas que no son del tipo: «otros datos»
			}
		}
		if empty {
			continue
		}
		row := csvRowResult{Line: line, Code: cols["codigo"], Name: cols["nombre"]}
		fail := func(msg string) {
			row.Action, row.Error = "error", msg
			res.Errors++
			res.Rows = append(res.Rows, row)
		}
		if row.Code == "" {
			fail("falta el código")
			continue
		}
		if prev, dup := seen[strings.ToLower(row.Code)]; dup {
			fail(fmt.Sprintf("el código se repite (también en la fila %d)", prev))
			continue
		}
		seen[strings.ToLower(row.Code)] = line
		in, msg := rowInput(kind.Code, cols, l)
		if msg != "" {
			fail(msg)
			continue
		}
		in.Attributes, in.Extra = attrs, extra
		ri, msg := h.resolve(ctx, in)
		if msg != "" {
			fail(msg)
			continue
		}
		existing, err := h.Queries.GetAssetIDByCode(ctx, ri.in.Code)
		if errors.Is(err, pgx.ErrNoRows) {
			existing = uuid.Nil
		} else if err != nil {
			fail("no se pudo buscar el código")
			continue
		}
		if existing == uuid.Nil {
			if !acc.canEdit(append([]uuid.UUID{ri.areaID}, ri.respArea...)) {
				fail("solo cargas equipos de tus áreas")
				continue
			}
			row.Action, row.Detail = "create", fmt.Sprintf("%d IP · %d responsables", len(ri.in.IPs), len(ri.in.Responsibles))
			if !dryRun {
				if err := h.createFromImport(ctx, ri); err != nil {
					fail("no se pudo crear: " + err.Error())
					continue
				}
			}
			res.Created++
			res.Rows = append(res.Rows, row)
			continue
		}
		a, err := h.Queries.GetInventoryAsset(ctx, existing)
		if err != nil {
			fail("no se pudo leer el equipo existente")
			continue
		}
		areas, _ := h.Queries.ListAssetResponsibleAreas(ctx, existing)
		if !acc.canEdit(areas) {
			fail("ese equipo es de otra área")
			continue
		}
		before, err := h.detail(ctx, a, areas, acc)
		if err != nil {
			fail("no se pudo leer el equipo existente")
			continue
		}
		// Lo que el archivo no trae se mantiene: columnas vacías no borran datos.
		for k, v := range before.Extra {
			if _, ok := ri.in.Extra[k]; !ok {
				ri.in.Extra[k] = v
			}
		}
		diff := changes(before, ri.in, ri.fields, names)
		if len(diff) == 0 {
			row.Action, row.Detail = "unchanged", "sin cambios"
			res.Unchanged++
			res.Rows = append(res.Rows, row)
			continue
		}
		row.Action, row.Detail = "update", strings.Join(diff, " · ")
		if !dryRun {
			if err := h.apply(ctx, existing, ri, diff, "import", "inventory.asset.import"); err != nil {
				fail("no se pudo actualizar: " + err.Error())
				continue
			}
		}
		res.Updated++
		res.Rows = append(res.Rows, row)
	}
	if !dryRun {
		h.AuditLog.Log(ctx, "inventory.import", audit.LevelInfo, audit.Success(), map[string]any{"kind": kind.Code, "created": res.Created, "updated": res.Updated, "errors": res.Errors})
	}
	writeData(w, http.StatusOK, res)
}

func (h *InventoryHandler) createFromImport(ctx context.Context, ri resolvedInput) error {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	id, err := save(ctx, q, uuid.Nil, ri)
	if err != nil {
		return err
	}
	if err = q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: "import", Description: "Equipo creado por carga masiva.", HappenedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, UserID: userUUID(ctx)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// writeCSV responde un CSV para Excel en español: «;» y BOM UTF-8 (tildes bien).
func writeCSV(w http.ResponseWriter, name string, rows [][]string) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	_, _ = w.Write([]byte("\xef\xbb\xbf"))
	cw := csv.NewWriter(w)
	cw.Comma = ';'
	_ = cw.WriteAll(rows)
}

func (h *InventoryHandler) kindColumns(w http.ResponseWriter, r *http.Request) (db.AssetKind, []kindField, []string, bool) {
	kind, err := h.Queries.GetAssetKind(r.Context(), r.URL.Query().Get("kind"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-kind", "elige el tipo de equipo")
		return kind, nil, nil, false
	}
	var fields []kindField
	_ = json.Unmarshal(kind.Fields, &fields)
	cols := append([]string{}, inventoryCommonColumns...)
	for _, f := range fields {
		cols = append(cols, f.Key)
	}
	return kind, fields, cols, true
}

// Template es GET /api/inventory/import/template?kind=: encabezados y una fila de ejemplo.
func (h *InventoryHandler) Template(w http.ResponseWriter, r *http.Request) {
	kind, fields, cols, ok := h.kindColumns(w, r)
	if !ok {
		return
	}
	example := []string{"srv-ejemplo-01", "SRV-EJEMPLO-01", "Infraestructura", "", "", "Dell PowerEdge R650", "7HXK2T3", "DC1-R04", "U22-U23",
		"Red=10.10.4.22; Red=10.10.4.32; iLO=10.10.99.22", "Configuración y sistema=área:TI; Hardware=área:Infraestructura"}
	for _, f := range fields {
		switch f.Kind {
		case "list":
			example = append(example, f.Options[0])
		case "number":
			example = append(example, "0")
		case "date":
			example = append(example, "2026-12-31")
		default:
			example = append(example, "")
		}
	}
	writeCSV(w, "inventario-"+kind.Code+".csv", [][]string{cols, example})
}

// Export es GET /api/inventory/export?kind=: lo que hay, en el mismo formato de la carga.
func (h *InventoryHandler) Export(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	acc, ok := h.access(w, r)
	if !ok {
		return
	}
	kind, fields, cols, ok := h.kindColumns(w, r)
	if !ok {
		return
	}
	var areas []uuid.UUID
	if !acc.viewAll {
		areas = acc.list()
	}
	list, err := h.Queries.ListInventory(ctx, db.ListInventoryParams{Areas: areas, Kind: queryText(kind.Code), IncludeInactive: false})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar")
		return
	}
	ipName := map[string]string{"network": "Red", "vip": "VIP", "management": "iLO", "other": "Otra"}
	rows := [][]string{cols}
	for _, item := range list {
		a, err := h.Queries.GetInventoryAsset(ctx, item.ID)
		if err != nil {
			continue
		}
		d, err := h.detail(ctx, a, nil, acc)
		if err != nil {
			continue
		}
		ips := []string{}
		for _, ip := range d.IPs {
			ips = append(ips, ipName[ip.Kind]+"="+ip.Address)
		}
		resp := []string{}
		for _, rs := range d.Responsibles {
			switch {
			case rs.Area != "":
				resp = append(resp, rs.TypeName+"=área:"+rs.AreaName)
			case rs.OrganizationID != nil:
				resp = append(resp, rs.TypeName+"=org:"+rs.OrganizationName)
			case rs.UserID != nil:
				resp = append(resp, rs.TypeName+"=persona:"+rs.UserName)
			}
		}
		deref := func(p *string) string {
			if p == nil {
				return ""
			}
			return *p
		}
		row := []string{d.Code, d.Name, d.AreaName, deref(d.PlaceName), deref(d.ClientName), deref(d.Model), deref(d.Serial), deref(d.Rack), deref(d.RackPosition), strings.Join(ips, "; "), strings.Join(resp, "; ")}
		for _, f := range fields {
			row = append(row, d.Attributes[f.Key])
		}
		rows = append(rows, row)
	}
	writeCSV(w, "inventario-"+kind.Code+"-exportado.csv", rows)
}
