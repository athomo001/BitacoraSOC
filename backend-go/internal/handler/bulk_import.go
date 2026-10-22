package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Cargas masivas por CSV (10g): usuarios, organizaciones con sus servicios,
// ventanas de mantenimiento y entradas históricas de la Bitácora. Igual que
// la del Inventario: plantilla, revisión fila por fila (?dryRun=true) y
// carga; el archivo se procesa en memoria y no se guarda. Cada fila se busca
// por su clave: si existe se actualiza (lo que el archivo deja vacío se
// mantiene), si no se crea. Las filas con error no se cargan; el resto sí,
// cada una en su propia transacción.
type BulkImportHandler struct {
	Queries  *db.Queries
	Pool     txBeginner
	AuditLog *audit.Logger
	// ClientNotice: lo mismo que al crear una ventana de un cliente a mano
	// (la tarea «Avisar al cliente» del CSM).
	ClientNotice func(ctx context.Context, client uuid.UUID, title string, start time.Time, actor uuid.UUID)
}

const maxImportCSVBytes = 5 << 20

// csvLine: una fila con sus columnas por encabezado normalizado.
type csvLine struct {
	line int
	cols map[string]string
}

// importRow: lo que la revisión muestra de una fila y, si hay algo que
// guardar, cómo guardarlo.
type importRow struct {
	csvRowResult
	apply func(ctx context.Context, q *db.Queries) error
}

var headerFold = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n", " ", "_")

// csvHeader: «Cumpleaños» → «cumpleanos», «Aplica a» → «aplica_a».
func csvHeader(s string) string {
	return headerFold.Replace(strings.ToLower(strings.TrimSpace(s)))
}

// readUpload lee el CSV del cuerpo y devuelve sus filas no vacías. Exige
// las columnas `required`; responde el error si algo falla.
func readUpload(w http.ResponseWriter, r *http.Request, maxBytes int64, required ...string) ([]csvLine, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBytes))
	if err != nil {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "too-large", fmt.Sprintf("el archivo supera %d MB: divídelo en partes", maxBytes>>20))
		return nil, false
	}
	records, err := readCSV(raw)
	if err != nil || len(records) < 2 {
		msg := "el archivo no trae filas"
		if err != nil {
			msg = err.Error()
		}
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-csv", msg)
		return nil, false
	}
	header := make([]string, len(records[0]))
	for i, c := range records[0] {
		header[i] = csvHeader(c)
	}
	for _, c := range required {
		if !contains(header, c) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-csv", "falta la columna «"+c+"»: baja la plantilla")
			return nil, false
		}
	}
	out := []csvLine{}
	for i, rec := range records[1:] {
		cols := map[string]string{}
		empty := true
		for j, v := range rec {
			if j >= len(header) || header[j] == "" {
				continue
			}
			v = strings.TrimSpace(v)
			if v != "" {
				empty = false
			}
			cols[header[j]] = v
		}
		if !empty {
			out = append(out, csvLine{line: i + 2, cols: cols})
		}
	}
	return out, true
}

func failRow(row csvRowResult, msg string) importRow {
	row.Action, row.Error = "error", msg
	return importRow{csvRowResult: row}
}

// finish guarda las filas (si no es solo revisión), cuenta y responde.
func (h *BulkImportHandler) finish(w http.ResponseWriter, r *http.Request, event string, rows []importRow) {
	ctx := r.Context()
	dryRun := r.URL.Query().Get("dryRun") == "true"
	res := csvImportResult{Rows: make([]csvRowResult, 0, len(rows)), Applied: !dryRun}
	for _, row := range rows {
		if !dryRun && row.apply != nil && (row.Action == "create" || row.Action == "update") {
			err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error { return row.apply(ctx, h.Queries.WithTx(tx)) })
			if err != nil {
				row.Action, row.Error, row.Secret = "error", "no se pudo guardar: "+err.Error(), ""
			}
		}
		switch row.Action {
		case "create":
			res.Created++
		case "update":
			res.Updated++
		case "unchanged":
			res.Unchanged++
		default:
			res.Errors++
		}
		res.Rows = append(res.Rows, row.csvRowResult)
	}
	if !dryRun {
		h.AuditLog.Log(ctx, event, audit.LevelInfo, audit.Success(), map[string]any{"created": res.Created, "updated": res.Updated, "errors": res.Errors})
	}
	writeData(w, http.StatusOK, res)
}

// lookup: nombre o código (en minúsculas) → valor; los nombres repetidos
// quedan marcados como ambiguos.
type lookup[T comparable] struct {
	byKey     map[string]T
	ambiguous map[string]bool
}

func newLookup[T comparable]() lookup[T] {
	return lookup[T]{byKey: map[string]T{}, ambiguous: map[string]bool{}}
}

func (l lookup[T]) add(key string, v T) {
	key = strings.ToLower(strings.TrimSpace(key))
	if key == "" {
		return
	}
	if prev, seen := l.byKey[key]; seen && prev != v {
		l.ambiguous[key] = true
	}
	l.byKey[key] = v
}

// find: el valor, o el motivo para la fila («no existe», «hay más de uno»).
func (l lookup[T]) find(what, key string) (T, string) {
	k := strings.ToLower(strings.TrimSpace(key))
	v, ok := l.byKey[k]
	switch {
	case l.ambiguous[k]:
		return v, fmt.Sprintf("hay más de un %s «%s»: usa su código", what, key)
	case !ok:
		return v, fmt.Sprintf("%s «%s» no existe", what, key)
	}
	return v, ""
}

// importLocation: la zona horaria de la Agenda (la de la instalación).
func importLocation(ctx context.Context, q *db.Queries) *time.Location {
	if s, err := q.GetAgendaSettings(ctx); err == nil {
		if loc, err := time.LoadLocation(s.Timezone); err == nil {
			return loc
		}
	}
	return time.UTC
}

var localTimeLayouts = []string{"2006-01-02 15:04", "2006-01-02T15:04", "2006-01-02 15:04:05", "2006-01-02T15:04:05", "02-01-2006 15:04", "02/01/2006 15:04", "02-01-2006 15:04:05", "02/01/2006 15:04:05"}

// parseLocalTime: «2026-11-05 22:00» (o día-mes-año) en la hora de la
// instalación, o una fecha con zona (RFC 3339, como sale el export).
func parseLocalTime(s string, loc *time.Location) (time.Time, bool) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	for _, layout := range localTimeLayouts {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// parseDay: «1990-05-14», «14-05-1990» o «14/05/1990».
func parseDay(s string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02", "02-01-2006", "02/01/2006"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// parseYesNo: sí/no, x, 1/0, true/false; vacío = def.
func parseYesNo(s string, def bool) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "":
		return def, true
	case "si", "sí", "s", "x", "1", "true", "yes", "y":
		return true, true
	case "no", "n", "0", "false":
		return false, true
	}
	return false, false
}
