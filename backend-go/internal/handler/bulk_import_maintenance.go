package handler

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Ventanas de mantenimiento por CSV (10g): una fila es una ventana suelta,
// como «Programar» de a una. aplica_a dice a qué, con el mismo nombre que la
// pantalla: «cliente:MUNDO», «servicio:FW-MUNDO», «area:SOC», «equipo:Redes»,
// y con NOC «activo:srv-01» o «zona:RM». La que ya está cargada (mismo
// título, horario y destino) no se repite; la que ya terminó no se carga.

var windowImportColumns = []string{"titulo", "aplica_a", "inicio", "fin", "silenciar_avisos", "notas"}

type windowTarget struct {
	kind string // servicio | activo | zona | cliente | area | equipo
	id   uuid.UUID
}

type windowCatalog struct {
	targets map[string]lookup[uuid.UUID] // tipo → código o nombre → id
	loc     *time.Location
}

func (h *BulkImportHandler) windowCatalog(ctx context.Context) (windowCatalog, error) {
	c := windowCatalog{targets: map[string]lookup[uuid.UUID]{}, loc: importLocation(ctx, h.Queries)}
	for _, k := range []string{"cliente", "area", "equipo"} {
		c.targets[k] = newLookup[uuid.UUID]()
	}
	clients, err := h.Queries.ListOrganizations(ctx, db.ListOrganizationsParams{ClientsOnly: true, Active: pgtype.Bool{Bool: true, Valid: true}})
	if err != nil {
		return c, err
	}
	for _, o := range clients {
		c.targets["cliente"].add(o.Code, o.ID)
		c.targets["cliente"].add(o.Name, o.ID)
	}
	areas, err := h.Queries.ListAreas(ctx)
	if err != nil {
		return c, err
	}
	for _, a := range areas {
		if a.Active {
			c.targets["area"].add(a.Code, a.ID)
			c.targets["area"].add(a.Name, a.ID)
		}
	}
	teams, err := h.Queries.ListTeams(ctx, db.ListTeamsParams{Active: pgtype.Bool{Bool: true, Valid: true}})
	if err != nil {
		return c, err
	}
	for _, t := range teams {
		c.targets["equipo"].add(t.Name, t.ID)
	}
	flags, err := repository.ModuleFlags(ctx, h.Queries)
	if err != nil {
		return c, err
	}
	if flags.Enabled(modules.SOC) {
		if err := c.addServices(ctx, h.Queries); err != nil {
			return c, err
		}
	}
	if flags.Enabled(modules.NOC) {
		if err := c.addNOC(ctx, h.Queries); err != nil {
			return c, err
		}
	}
	return c, nil
}

func (c windowCatalog) addServices(ctx context.Context, q *db.Queries) error {
	services, err := q.ListServices(ctx, db.ListServicesParams{Active: pgtype.Bool{Bool: true, Valid: true}})
	if err != nil {
		return err
	}
	l := newLookup[uuid.UUID]()
	for _, s := range services {
		l.add(s.Code, s.ID)
	}
	c.targets["servicio"] = l
	return nil
}

func (c windowCatalog) addNOC(ctx context.Context, q *db.Queries) error {
	assets, err := q.ListInventory(ctx, db.ListInventoryParams{})
	if err != nil {
		return err
	}
	l := newLookup[uuid.UUID]()
	for _, a := range assets {
		l.add(a.Code, a.ID)
	}
	c.targets["activo"] = l
	units, err := q.ListTerritorialUnits(ctx, db.ListTerritorialUnitsParams{Active: pgtype.Bool{Bool: true, Valid: true}, PageSize: 100000})
	if err != nil {
		return err
	}
	z := newLookup[uuid.UUID]()
	for _, u := range units {
		z.add(u.Code, u.ID)
		z.add(u.Name, u.ID)
	}
	c.targets["zona"] = z
	return nil
}

var targetAlias = map[string]string{"cliente": "cliente", "servicio": "servicio", "activo": "activo", "zona": "zona", "area": "area", "área": "area", "equipo": "equipo"}

func (c windowCatalog) target(cell string) (windowTarget, string) {
	kind, ref, found := strings.Cut(cell, ":")
	kind = targetAlias[strings.ToLower(strings.TrimSpace(kind))]
	l, ok := c.targets[kind]
	if !found || !ok {
		names := make([]string, 0, len(c.targets))
		for _, k := range []string{"cliente", "servicio", "activo", "zona", "area", "equipo"} {
			if _, on := c.targets[k]; on {
				names = append(names, k+":")
			}
		}
		return windowTarget{}, fmt.Sprintf("aplica_a «%s»: empieza con %s", cell, strings.Join(names, ", "))
	}
	id, msg := l.find(kind, ref)
	return windowTarget{kind: kind, id: id}, msg
}

func (t windowTarget) matches(m db.MaintenanceWindow) bool {
	field := map[string]pgtype.UUID{"servicio": m.ServiceID, "activo": m.AssetID, "zona": m.TerritorialUnitID, "cliente": m.OrganizationID, "area": m.AreaID, "equipo": m.TeamID}[t.kind]
	return field.Valid && uuid.UUID(field.Bytes) == t.id
}

func (t windowTarget) params(p *db.CreateMaintenanceWindowParams) {
	id := pgUUIDOf(t.id)
	switch t.kind {
	case "servicio":
		p.ServiceID = id
	case "activo":
		p.AssetID = id
	case "zona":
		p.TerritorialUnitID = id
	case "cliente":
		p.OrganizationID = id
	case "area":
		p.AreaID = id
	default:
		p.TeamID = id
	}
}

func (c windowCatalog) parseWindowRow(cols map[string]string) (db.CreateMaintenanceWindowParams, windowTarget, string) {
	p := db.CreateMaintenanceWindowParams{Title: cols["titulo"], Notes: optText(cols["notas"]), Priority: 100}
	if p.Title == "" {
		return p, windowTarget{}, "falta el título"
	}
	t, msg := c.target(cols["aplica_a"])
	if msg != "" {
		return p, t, msg
	}
	t.params(&p)
	start, ok1 := parseLocalTime(cols["inicio"], c.loc)
	end, ok2 := parseLocalTime(cols["fin"], c.loc)
	switch {
	case !ok1 || !ok2:
		return p, t, "inicio y fin van como AAAA-MM-DD HH:MM"
	case !end.After(start):
		return p, t, "el fin tiene que ser después del inicio"
	case end.Before(time.Now()):
		return p, t, "esa ventana ya terminó"
	}
	suppress, ok := parseYesNo(cols["silenciar_avisos"], true)
	if !ok {
		return p, t, "silenciar_avisos va como sí o no"
	}
	p.StartsAt, p.EndsAt, p.SuppressNotifications = pgTime(start), pgTime(end), suppress
	return p, t, ""
}

// Windows es POST /api/maintenance-windows/import?dryRun=true (cuerpo: el CSV).
func (h *BulkImportHandler) Windows(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lines, ok := readUpload(w, r, maxImportCSVBytes, "titulo", "aplica_a", "inicio", "fin")
	if !ok {
		return
	}
	c, err := h.windowCatalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los destinos")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	seen := map[string]int{}
	rows := make([]importRow, 0, len(lines))
	for _, l := range lines {
		row := csvRowResult{Line: l.line, Code: l.cols["inicio"], Name: l.cols["titulo"]}
		p, t, msg := c.parseWindowRow(l.cols)
		if msg != "" {
			rows = append(rows, failRow(row, msg))
			continue
		}
		key := fmt.Sprintf("%s|%s|%d|%d", strings.ToLower(p.Title), t.id, p.StartsAt.Time.Unix(), p.EndsAt.Time.Unix())
		if prev, dup := seen[key]; dup {
			rows = append(rows, failRow(row, fmt.Sprintf("la ventana se repite (también en la fila %d)", prev)))
			continue
		}
		seen[key] = l.line
		existing, err := h.Queries.ListWindowsAt(ctx, db.ListWindowsAtParams{Title: p.Title, StartsAt: p.StartsAt, EndsAt: p.EndsAt})
		if err != nil {
			rows = append(rows, failRow(row, "no se pudo revisar si ya estaba"))
			continue
		}
		if slices.ContainsFunc(existing, t.matches) {
			row.Action, row.Detail = "unchanged", "ya está cargada"
			rows = append(rows, importRow{csvRowResult: row})
			continue
		}
		p.CreatedBy = actor.ID
		row.Action = "create"
		row.Detail = fmt.Sprintf("%s · %s a %s", l.cols["aplica_a"], p.StartsAt.Time.In(c.loc).Format("02-01-2006 15:04"), p.EndsAt.Time.In(c.loc).Format("02-01-2006 15:04"))
		rows = append(rows, importRow{csvRowResult: row, apply: func(ctx context.Context, q *db.Queries) error {
			m, err := q.CreateMaintenanceWindow(ctx, p)
			if err != nil {
				return err
			}
			if t.kind == "cliente" && h.ClientNotice != nil {
				h.ClientNotice(ctx, t.id, m.Title, m.StartsAt.Time, actor.ID)
			}
			return nil
		}})
	}
	h.finish(w, r, "maintenance_window.import", rows)
}

// WindowsTemplate es GET /api/maintenance-windows/import/template.
func (h *BulkImportHandler) WindowsTemplate(w http.ResponseWriter, r *http.Request) {
	writeCSV(w, "ventanas-de-mantenimiento.csv", [][]string{windowImportColumns,
		{"Actualización de firmware", "cliente:MUNDO", "2026-11-05 22:00", "2026-11-06 02:00", "sí", "Aviso enviado al cliente"}})
}
