package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Importar eventos del catálogo desde un archivo (paridad con el legacy:
// POST /admin/catalog/events/import recibía CSV o JSON). Lo que ya existe
// (mismo nombre y categoría) se salta en vez de duplicarse.

const (
	maxEventsFileBytes = 2 << 20
	maxEventsPerImport = 2000
)

// Encabezados aceptados: los campos del legacy (CatalogEvent) y en español.
var eventHeaderAliases = map[string][]string{
	"name":          {"name", "nombre", "evento"},
	"parent":        {"parent", "category", "categoria", "categoría", "padre"},
	"description":   {"description", "descripcion", "descripción"},
	"motivoDefault": {"motivodefault", "motivo_default", "motivo", "motivo por defecto", "reason"},
	"enabled":       {"enabled", "active", "activo", "habilitado"},
}

type importEventsResult struct {
	Created int        `json:"created"`
	Skipped int        `json:"skipped"`
	Errors  []rowError `json:"errors"`
}

type rowError struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
}

// ImportReportEvents: POST /api/report-events/import (multipart, campo "file": .csv o .json).
func (h *ReportsHandler) ImportReportEvents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, maxEventsFileBytes+64<<10)
	if err := r.ParseMultipartForm(maxEventsFileBytes); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "adjunta el archivo en el campo 'file' (máximo 2MB)")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "falta el archivo en el campo 'file'")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxEventsFileBytes+1))
	if err != nil || len(raw) > maxEventsFileBytes {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el archivo supera los 2MB")
		return
	}
	rows, bad := parseEventsFile(strings.TrimPrefix(string(raw), "\xef\xbb\xbf"))
	if bad != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-file", bad)
		return
	}
	if len(rows) > maxEventsPerImport {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-file", fmt.Sprintf("máximo %d eventos por archivo", maxEventsPerImport))
		return
	}
	keys, err := h.Queries.ListReportEventKeys(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el catálogo")
		return
	}
	seen := map[string]bool{}
	for _, k := range keys {
		seen[k.Name+"\x00"+k.Parent] = true
	}
	res := importEventsResult{Errors: []rowError{}}
	for _, row := range rows {
		req := row.req
		if msg := req.validate(); msg != "" {
			res.Errors = append(res.Errors, rowError{Line: row.line, Reason: msg})
			continue
		}
		key := strings.ToLower(req.Name) + "\x00" + strings.ToLower(req.Parent)
		if seen[key] {
			res.Skipped++
			continue
		}
		if _, err := h.Queries.CreateReportEvent(ctx, db.CreateReportEventParams{
			Name: req.Name, Parent: req.Parent, Description: req.Description, MotivoDefault: req.MotivoDefault, Enabled: req.Enabled == nil || *req.Enabled,
		}); err != nil {
			res.Errors = append(res.Errors, rowError{Line: row.line, Reason: "no se pudo guardar"})
			continue
		}
		seen[key] = true
		res.Created++
	}
	h.AuditLog.Log(ctx, "report.event.imported", audit.LevelInfo, audit.Success(), map[string]any{
		"created": res.Created, "skipped": res.Skipped, "errors": len(res.Errors)})
	writeData(w, http.StatusOK, res)
}

type eventRow struct {
	line int
	req  reportEventRequest
}

// parseEventsFile acepta un arreglo JSON (como mandaba el legacy) o un CSV con encabezado.
func parseEventsFile(text string) ([]eventRow, string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, "el archivo está vacío"
	}
	if strings.HasPrefix(text, "[") || strings.HasPrefix(text, "{") {
		var list []reportEventRequest
		if strings.HasPrefix(text, "{") { // {"events": [...]}, el cuerpo del legacy
			var wrapped struct {
				Events []reportEventRequest `json:"events"`
			}
			if err := json.Unmarshal([]byte(text), &wrapped); err != nil {
				return nil, "el JSON no se pudo leer: " + err.Error()
			}
			list = wrapped.Events
		} else if err := json.Unmarshal([]byte(text), &list); err != nil {
			return nil, "el JSON no se pudo leer: " + err.Error()
		}
		out := make([]eventRow, 0, len(list))
		for i, e := range list {
			out = append(out, eventRow{line: i + 1, req: e})
		}
		return out, ""
	}
	rd := csv.NewReader(strings.NewReader(text))
	rd.FieldsPerRecord = -1
	rd.TrimLeadingSpace = true
	header, err := rd.Read()
	if err != nil {
		return nil, "no se pudo leer el encabezado del CSV"
	}
	col := map[string]int{}
	for i, h := range header {
		k := strings.ToLower(strings.TrimSpace(h))
		for field, aliases := range eventHeaderAliases {
			for _, a := range aliases {
				if k == a {
					if _, dup := col[field]; !dup {
						col[field] = i
					}
				}
			}
		}
	}
	if _, ok := col["name"]; !ok {
		return nil, "el CSV necesita una columna 'nombre' (o 'name')"
	}
	var out []eventRow
	for line := 2; ; line++ {
		rec, err := rd.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Sprintf("línea %d: %v", line, err)
		}
		get := func(f string) string {
			if i, ok := col[f]; ok && i < len(rec) {
				return rec[i]
			}
			return ""
		}
		if strings.TrimSpace(strings.Join(rec, "")) == "" {
			continue
		}
		req := reportEventRequest{Name: get("name"), Parent: get("parent"), Description: get("description"), MotivoDefault: get("motivoDefault")}
		if v := strings.ToLower(strings.TrimSpace(get("enabled"))); v != "" {
			on := v == "true" || v == "1" || v == "si" || v == "sí" || v == "yes" || v == "x"
			req.Enabled = &on
		}
		out = append(out, eventRow{line: line, req: req})
	}
	return out, ""
}
