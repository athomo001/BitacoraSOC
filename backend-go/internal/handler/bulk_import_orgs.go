package handler

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Organizaciones por CSV (10g): cada fila se busca por código. La columna
// servicios («FW-MUNDO=Firewall; EDR-MUNDO=EDR») agrega o renombra
// servicios; nunca borra. Solo con SOC encendido (sin SOC no hay servicios:
// la columna ni aparece). El mandante es otra organización que ya existe o
// que va más arriba en el mismo archivo.

type orgService struct {
	id         uuid.UUID
	orgID      uuid.UUID
	code, name string
}

type orgCatalog struct {
	byCode   map[string]db.ListOrganizationsRow // código en minúsculas
	ref      lookup[string]                     // código o nombre → código en minúsculas
	types    lookup[string]                     // código o nombre del tipo → código
	typeName map[string]string
	services map[string]orgService // código en minúsculas
	soc      bool
}

func (h *BulkImportHandler) orgCatalog(ctx context.Context) (orgCatalog, error) {
	c := orgCatalog{byCode: map[string]db.ListOrganizationsRow{}, ref: newLookup[string](), types: newLookup[string](), typeName: map[string]string{}, services: map[string]orgService{}}
	orgs, err := h.Queries.ListOrganizations(ctx, db.ListOrganizationsParams{})
	if err != nil {
		return c, err
	}
	for _, o := range orgs {
		code := strings.ToLower(o.Code)
		c.byCode[code] = o
		c.ref.add(o.Code, code)
		c.ref.add(o.Name, code)
	}
	types, err := h.Queries.ListOrganizationTypes(ctx)
	if err != nil {
		return c, err
	}
	for _, t := range types {
		c.types.add(t.Code, t.Code)
		c.types.add(t.Name, t.Code)
		c.typeName[t.Code] = t.Name
	}
	flags, err := repository.ModuleFlags(ctx, h.Queries)
	if err != nil {
		return c, err
	}
	if c.soc = flags.Enabled(modules.SOC); c.soc {
		services, err := h.Queries.ListServices(ctx, db.ListServicesParams{})
		if err != nil {
			return c, err
		}
		for _, s := range services {
			c.services[strings.ToLower(s.Code)] = orgService{id: s.ID, orgID: s.OrganizationID, code: s.Code, name: s.Name}
		}
	}
	return c, nil
}

func (c orgCatalog) columns() []string {
	cols := []string{"codigo", "nombre", "tipo", "mandante"}
	if c.soc {
		cols = append(cols, "servicios")
	}
	return cols
}

type serviceInput struct{ code, name string }

type orgRowInput struct {
	code, name, kind, via string
	services              []serviceInput
}

// parseOrgRow valida la fila; inFile son los códigos de las filas de más arriba.
func (c orgCatalog) parseOrgRow(cols map[string]string, inFile map[string]bool, svcSeen map[string]int, line int) (orgRowInput, string) {
	in := orgRowInput{code: cols["codigo"], name: cols["nombre"]}
	if in.code == "" {
		return in, "falta el código"
	}
	if v := cols["tipo"]; v != "" {
		kind, msg := c.types.find("tipo", v)
		if msg != "" {
			return in, msg
		}
		in.kind = kind
	}
	if v := cols["mandante"]; v != "" {
		via := strings.ToLower(v)
		if !inFile[via] {
			code, msg := c.ref.find("mandante", v)
			if msg != "" {
				return in, msg + " (si va en este archivo, ponlo más arriba)"
			}
			via = code
		}
		if via == strings.ToLower(in.code) {
			return in, "una organización no puede ser su propio mandante"
		}
		in.via = via
	}
	if !c.soc {
		return in, ""
	}
	for _, p := range splitList(cols["servicios"]) {
		code, name, _ := strings.Cut(p, "=")
		s := serviceInput{code: strings.TrimSpace(code), name: strings.TrimSpace(name)}
		if s.name == "" {
			s.name = s.code
		}
		key := strings.ToLower(s.code)
		if prev, dup := svcSeen[key]; dup {
			return in, fmt.Sprintf("el servicio %s se repite (también en la fila %d)", s.code, prev)
		}
		svcSeen[key] = line
		in.services = append(in.services, s)
	}
	return in, ""
}

// Organizations es POST /api/organizations/import?dryRun=true (cuerpo: el CSV).
func (h *BulkImportHandler) Organizations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lines, ok := readUpload(w, r, maxImportCSVBytes, "codigo")
	if !ok {
		return
	}
	c, err := h.orgCatalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las organizaciones")
		return
	}
	// ids: las organizaciones por código, también las que crea este archivo
	// (las llena la carga, fila por fila, para el mandante de las de abajo).
	ids := map[string]uuid.UUID{}
	for code, o := range c.byCode {
		ids[code] = o.ID
	}
	seen := map[string]int{}
	svcSeen := map[string]int{}
	inFile := map[string]bool{}
	rows := make([]importRow, 0, len(lines))
	for _, l := range lines {
		row := csvRowResult{Line: l.line, Code: l.cols["codigo"], Name: l.cols["nombre"]}
		key := strings.ToLower(row.Code)
		if prev, dup := seen[key]; key != "" && dup {
			rows = append(rows, failRow(row, fmt.Sprintf("el código se repite (también en la fila %d)", prev)))
			continue
		}
		in, msg := c.parseOrgRow(l.cols, inFile, svcSeen, l.line)
		if msg != "" {
			rows = append(rows, failRow(row, msg))
			continue
		}
		seen[key] = l.line
		existing, found := c.byCode[key]
		var ir importRow
		if found {
			ir = c.updateOrgRow(row, in, existing, ids)
		} else {
			ir = c.newOrgRow(row, in, ids)
		}
		if ir.Action != "error" {
			inFile[key] = true
		}
		rows = append(rows, ir)
	}
	h.finish(w, r, "organizations.import", rows)
}

// serviceChanges: qué servicios se crean o se renombran en la organización.
func (c orgCatalog) serviceChanges(orgID uuid.UUID, services []serviceInput) ([]string, []serviceInput, string) {
	var diff []string
	var todo []serviceInput
	for _, s := range services {
		cur, exists := c.services[strings.ToLower(s.code)]
		switch {
		case !exists:
			diff, todo = append(diff, "servicio nuevo "+s.code), append(todo, s)
		case cur.orgID != orgID:
			return nil, nil, fmt.Sprintf("el servicio %s es de otra organización", s.code)
		case cur.name != s.name:
			diff, todo = append(diff, "servicio "+s.code+" se renombra"), append(todo, s)
		}
	}
	return diff, todo, ""
}

func (c orgCatalog) applyServices(ctx context.Context, q *db.Queries, orgID uuid.UUID, todo []serviceInput) error {
	for _, s := range todo {
		if cur, exists := c.services[strings.ToLower(s.code)]; exists {
			if _, err := q.UpdateService(ctx, db.UpdateServiceParams{ID: cur.id, Name: optText(s.name)}); err != nil {
				return err
			}
			continue
		}
		if _, err := q.CreateService(ctx, db.CreateServiceParams{OrganizationID: orgID, Name: s.name, Code: s.code}); err != nil {
			return err
		}
	}
	return nil
}

func viaParams(via string, ids map[string]uuid.UUID) (pgtype.UUID, error) {
	id, ok := ids[via]
	if !ok {
		return pgtype.UUID{}, fmt.Errorf("el mandante %s no quedó cargado", via)
	}
	return pgUUIDOf(id), nil
}

func (c orgCatalog) newOrgRow(row csvRowResult, in orgRowInput, ids map[string]uuid.UUID) importRow {
	if in.name == "" {
		return failRow(row, "para crearla falta el nombre")
	}
	if in.kind == "" {
		in.kind = "client"
	}
	_, todo, msg := c.serviceChanges(uuid.Nil, in.services)
	if msg != "" {
		return failRow(row, msg)
	}
	row.Action = "create"
	row.Detail = c.typeName[in.kind]
	if len(todo) > 0 {
		row.Detail += fmt.Sprintf(" · %d servicios", len(todo))
	}
	return importRow{csvRowResult: row, apply: func(ctx context.Context, q *db.Queries) error {
		org, err := q.CreateOrganization(ctx, db.CreateOrganizationParams{Name: in.name, Code: in.code, Type: in.kind})
		if isUniqueViolation(err) {
			return fmt.Errorf("el código %s lo usa una organización eliminada", in.code)
		}
		if err != nil {
			return err
		}
		ids[strings.ToLower(in.code)] = org.ID
		if in.via != "" {
			via, err := viaParams(in.via, ids)
			if err != nil {
				return err
			}
			if _, err := q.UpdateOrganization(ctx, db.UpdateOrganizationParams{ID: org.ID, SetVia: true, ViaOrganizationID: via}); err != nil {
				return err
			}
		}
		return c.applyServices(ctx, q, org.ID, todo)
	}}
}

func (c orgCatalog) updateOrgRow(row csvRowResult, in orgRowInput, o db.ListOrganizationsRow, ids map[string]uuid.UUID) importRow {
	var diff []string
	if in.name != "" && in.name != o.Name {
		diff = append(diff, "nombre")
	}
	if in.kind != "" && in.kind != o.Type {
		diff = append(diff, "tipo: "+c.typeName[o.Type]+" → "+c.typeName[in.kind])
	}
	if in.via != "" && (!o.ViaOrganizationID.Valid || ids[in.via] != uuid.UUID(o.ViaOrganizationID.Bytes)) {
		diff = append(diff, "mandante")
	}
	svcDiff, todo, msg := c.serviceChanges(o.ID, in.services)
	if msg != "" {
		return failRow(row, msg)
	}
	diff = append(diff, svcDiff...)
	if len(diff) == 0 {
		row.Action, row.Detail = "unchanged", "sin cambios"
		return importRow{csvRowResult: row}
	}
	row.Action, row.Detail = "update", strings.Join(diff, " · ")
	return importRow{csvRowResult: row, apply: func(ctx context.Context, q *db.Queries) error {
		p := db.UpdateOrganizationParams{ID: o.ID, Name: optText(in.name), Type: optText(in.kind)}
		if in.via != "" {
			via, err := viaParams(in.via, ids)
			if err != nil {
				return err
			}
			p.SetVia, p.ViaOrganizationID = true, via
		}
		if _, err := q.UpdateOrganization(ctx, p); err != nil {
			return err
		}
		return c.applyServices(ctx, q, o.ID, todo)
	}}
}

// OrganizationsTemplate es GET /api/organizations/import/template.
func (h *BulkImportHandler) OrganizationsTemplate(w http.ResponseWriter, r *http.Request) {
	c, err := h.orgCatalog(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo armar la plantilla")
		return
	}
	example := []string{"MUNDO", "Mundo Telecomunicaciones", "Cliente", ""}
	if c.soc {
		example = append(example, "FW-MUNDO=Firewall perimetral; EDR-MUNDO=EDR")
	}
	writeCSV(w, "organizaciones.csv", [][]string{c.columns(), example})
}

// OrganizationsExport es GET /api/organizations/export: lo que hay, en el
// mismo formato de la carga.
func (h *BulkImportHandler) OrganizationsExport(w http.ResponseWriter, r *http.Request) {
	c, err := h.orgCatalog(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar")
		return
	}
	services := map[uuid.UUID][]string{}
	for _, s := range c.services {
		services[s.orgID] = append(services[s.orgID], s.code+"="+s.name)
	}
	for _, list := range services {
		slices.Sort(list)
	}
	orgs, err := h.Queries.ListOrganizations(r.Context(), db.ListOrganizationsParams{})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar")
		return
	}
	rows := [][]string{c.columns()}
	for _, o := range orgs {
		via := ""
		if o.ViaName.Valid {
			via = o.ViaName.String
		}
		row := []string{o.Code, o.Name, c.typeName[o.Type], via}
		if c.soc {
			row = append(row, strings.Join(services[o.ID], "; "))
		}
		rows = append(rows, row)
	}
	writeCSV(w, "organizaciones-exportado.csv", rows)
}
