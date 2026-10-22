package handler

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Entradas históricas por CSV (10g): registros que vienen de planillas de
// fuera, con su fecha y su autor reales (lo que el legacy hacía a mano con
// scripts/csv-to-json-entries.js). Las columnas son las del «Exportar CSV»
// de la Bitácora, así que un export vuelve a entrar. Solo se agregan: la
// misma entrada (autor, minuto y texto) no se repite al subir dos veces.

const maxEntriesCSVBytes = 20 << 20

var entryImportColumns = []string{"fecha", "autor", "tipo", "ambito", "tags", "contenido", "servicio"}

type entryCatalog struct {
	authors  lookup[uuid.UUID] // usuario o correo → id
	services lookup[uuid.UUID] // código → id (con SOC)
	loc      *time.Location
}

func (h *BulkImportHandler) entryCatalog(ctx context.Context) (entryCatalog, error) {
	c := entryCatalog{authors: newLookup[uuid.UUID](), loc: importLocation(ctx, h.Queries)}
	users, err := h.Queries.ListUsers(ctx, db.ListUsersParams{})
	if err != nil {
		return c, err
	}
	for _, u := range users {
		c.authors.add(u.Username, u.ID)
		c.authors.add(u.Email, u.ID)
	}
	flags, err := repository.ModuleFlags(ctx, h.Queries)
	if err != nil {
		return c, err
	}
	if flags.Enabled(modules.SOC) {
		c.services = newLookup[uuid.UUID]()
		services, err := h.Queries.ListServices(ctx, db.ListServicesParams{})
		if err != nil {
			return c, err
		}
		for _, s := range services {
			c.services.add(s.Code, s.ID)
		}
	}
	return c, nil
}

// entryTags: «firewall|cliente:mundo» (como sale el export) o con «;».
func entryTags(cell string) ([]string, string) {
	tags := []string{}
	for _, t := range strings.FieldsFunc(cell, func(r rune) bool { return r == '|' || r == ';' }) {
		if t = strings.TrimSpace(t); t == "" {
			continue
		}
		if utf8.RuneCountInString(t) > maxTagLen {
			return nil, fmt.Sprintf("la etiqueta «%s» pasa de %d caracteres", t, maxTagLen)
		}
		tags = append(tags, t)
	}
	return tags, ""
}

func (c entryCatalog) parseEntryRow(cols map[string]string) (db.ImportEntryParams, string) {
	p := db.ImportEntryParams{Content: cols["contenido"], EntryType: db.EntryTypeOperativa, Scope: db.EntryScopeGeneral}
	if p.Content == "" {
		return p, "falta el contenido"
	}
	at, ok := parseLocalTime(cols["fecha"], c.loc)
	if !ok {
		return p, "la fecha va como AAAA-MM-DD HH:MM"
	}
	if at.After(time.Now()) {
		return p, "la fecha es futura"
	}
	p.CreatedAt = pgTime(at)
	author, msg := c.authors.find("usuario", cols["autor"])
	if msg != "" {
		return p, msg
	}
	p.UserID = author
	if v := strings.ToLower(cols["tipo"]); v != "" {
		if !validEntryType(v) {
			return p, fmt.Sprintf("tipo «%s»: usa operativa, incidente u ofensa", cols["tipo"])
		}
		p.EntryType = db.EntryType(v)
	}
	if v := strings.ToLower(cols["ambito"]); v != "" {
		if v != "general" && v != "soc" && v != "noc" {
			return p, fmt.Sprintf("ámbito «%s»: usa general, soc o noc", cols["ambito"])
		}
		p.Scope = db.EntryScope(v)
	}
	if p.Tags, msg = entryTags(cols["tags"]); msg != "" {
		return p, msg
	}
	if v := cols["servicio"]; v != "" && c.services.byKey != nil {
		id, msg := c.services.find("servicio", v)
		if msg != "" {
			return p, msg
		}
		p.ServiceID = pgtype.UUID{Bytes: id, Valid: true}
	}
	return p, ""
}

// Entries es POST /api/entries/import?dryRun=true (cuerpo: el CSV).
func (h *BulkImportHandler) Entries(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lines, ok := readUpload(w, r, maxEntriesCSVBytes, "fecha", "autor", "contenido")
	if !ok {
		return
	}
	c, err := h.entryCatalog(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los usuarios")
		return
	}
	seen := map[string]int{}
	rows := make([]importRow, 0, len(lines))
	for _, l := range lines {
		row := csvRowResult{Line: l.line, Code: l.cols["fecha"], Name: snippet(l.cols["contenido"], 60)}
		p, msg := c.parseEntryRow(l.cols)
		if msg != "" {
			rows = append(rows, failRow(row, msg))
			continue
		}
		key := fmt.Sprintf("%s|%d|%s", p.UserID, p.CreatedAt.Time.Truncate(time.Minute).Unix(), p.Content)
		if prev, dup := seen[key]; dup {
			rows = append(rows, failRow(row, fmt.Sprintf("la entrada se repite (también en la fila %d)", prev)))
			continue
		}
		seen[key] = l.line
		exists, err := h.Queries.EntryImported(ctx, db.EntryImportedParams{UserID: p.UserID, CreatedAt: p.CreatedAt, Content: p.Content})
		if err != nil {
			rows = append(rows, failRow(row, "no se pudo revisar si ya estaba"))
			continue
		}
		if exists {
			row.Action, row.Detail = "unchanged", "ya está en la Bitácora"
			rows = append(rows, importRow{csvRowResult: row})
			continue
		}
		row.Action = "create"
		row.Detail = fmt.Sprintf("%s · %s · %s", l.cols["autor"], p.EntryType, p.Scope)
		rows = append(rows, importRow{csvRowResult: row, apply: func(ctx context.Context, q *db.Queries) error {
			return q.ImportEntry(ctx, p)
		}})
	}
	h.finish(w, r, "entry.import", rows)
}

// snippet: el comienzo del texto, en una línea.
func snippet(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// EntriesTemplate es GET /api/entries/import/template.
func (h *BulkImportHandler) EntriesTemplate(w http.ResponseWriter, r *http.Request) {
	writeCSV(w, "bitacora-entradas.csv", [][]string{entryImportColumns,
		{"2024-03-14 08:30", "jperez", "operativa", "soc", "firewall|cliente:mundo", "Revisión de alertas del turno de noche: sin novedades.", ""}})
}
