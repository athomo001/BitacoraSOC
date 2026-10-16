package handler

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Etiquetas de la Bitácora (paridad con el legacy, decisiones del dueño
// 2026-10-16): al escribir se sugieren las que ya existen (para todos) y el
// admin ve cuánto se usa cada una, la renombra o la borra en todas las
// entradas a la vez. Como en el legacy, una etiqueta va hasta 50 caracteres.

const maxTagLen = 50

// SuggestTags: GET /api/entries/tags?q= — hasta 10, las más usadas primero.
func (h *EntriesHandler) SuggestTags(w http.ResponseWriter, r *http.Request) {
	prefix := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(prefix) > maxTagLen {
		prefix = string([]rune(prefix)[:maxTagLen])
	}
	// Un % o _ escritos se buscan tal cual.
	prefix = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(prefix)
	rows, err := h.Queries.SuggestEntryTags(r.Context(), db.SuggestEntryTagsParams{Prefix: prefix, MaxRows: 10})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las etiquetas")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, t := range rows {
		out = append(out, map[string]any{"tag": t.Tag, "uses": t.Uses})
	}
	writeData(w, http.StatusOK, out)
}

type tagStatDTO struct {
	Tag      string    `json:"tag"`
	Uses     int32     `json:"uses"`
	LastUsed time.Time `json:"lastUsed"`
}

// TagStats: GET /api/admin/entry-tags (admin) — todas, con su uso.
func (h *EntriesHandler) TagStats(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListEntryTagStats(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las etiquetas")
		return
	}
	out := make([]tagStatDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, tagStatDTO{Tag: t.Tag, Uses: t.Uses, LastUsed: t.LastUsed.Time})
	}
	writeData(w, http.StatusOK, out)
}

// RenameTag: POST /api/admin/entry-tags/rename {from, to} (admin). Si la
// nueva ya existe, las dos se juntan.
func (h *EntriesHandler) RenameTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	req.To = strings.TrimSpace(req.To)
	if req.From == "" || req.To == "" || utf8.RuneCountInString(req.To) > maxTagLen {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica la etiqueta y su nombre nuevo (hasta 50 caracteres)")
		return
	}
	if req.From == req.To {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre nuevo es igual al actual")
		return
	}
	ctx := r.Context()
	n, err := h.Queries.RenameEntryTag(ctx, db.RenameEntryTagParams{FromTag: req.From, ToTag: req.To})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo renombrar la etiqueta")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ninguna entrada tiene esa etiqueta")
		return
	}
	h.AuditLog.Log(ctx, "entries.tag.rename", audit.LevelInfo, audit.Success(), map[string]any{"from": req.From, "to": req.To, "entries": n})
	writeData(w, http.StatusOK, map[string]any{"entries": n})
}

// DeleteTag: POST /api/admin/entry-tags/delete {tag} (admin). La quita de
// todas las entradas; las entradas quedan.
func (h *EntriesHandler) DeleteTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tag string `json:"tag"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.Tag == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica la etiqueta")
		return
	}
	ctx := r.Context()
	n, err := h.Queries.DeleteEntryTag(ctx, req.Tag)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar la etiqueta")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ninguna entrada tiene esa etiqueta")
		return
	}
	h.AuditLog.Log(ctx, "entries.tag.delete", audit.LevelInfo, audit.Success(), map[string]any{"tag": req.Tag, "entries": n})
	writeData(w, http.StatusOK, map[string]any{"entries": n})
}
