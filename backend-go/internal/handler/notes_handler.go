package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
)

// NotesHandler cubre el Pizarrón Admin (`admin_notes`, fila singleton visible
// para toda la sala) y la Libreta Personal (`personal_notes`, 1:1 por
// usuario) — Fase 9, spec/04-contratos-api.md sección "Notas Operativas".
// Ambas con autosave/debounce de 3s desde el frontend.
type NotesHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

type notesDTO struct {
	Content              string     `json:"content"`
	LastEditedByUsername *string    `json:"lastEditedByUsername,omitempty"`
	UpdatedAt            *time.Time `json:"updatedAt,omitempty"`
}

func (h *NotesHandler) GetAdmin(w http.ResponseWriter, r *http.Request) {
	row, err := h.Queries.GetAdminNotes(r.Context())
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeData(w, http.StatusOK, notesDTO{Content: ""})
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el pizarrón")
		return
	}
	dto := notesDTO{Content: row.Content, LastEditedByUsername: textPtr(row.LastEditedByUsername)}
	if row.UpdatedAt.Valid {
		dto.UpdatedAt = &row.UpdatedAt.Time
	}
	writeData(w, http.StatusOK, dto)
}

type putNotesRequest struct {
	Content string `json:"content"`
}

func (h *NotesHandler) PutAdmin(w http.ResponseWriter, r *http.Request) {
	var req putNotesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	note, err := h.Queries.UpsertAdminNotes(ctx, db.UpsertAdminNotesParams{Content: req.Content, LastEditedBy: optionalUUID(&user.ID)})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el pizarrón")
		return
	}
	h.AuditLog.Log(ctx, "notes.admin_updated", audit.LevelInfo, audit.Success(), nil)
	dto := notesDTO{Content: note.Content, LastEditedByUsername: &user.Username}
	if note.UpdatedAt.Valid {
		dto.UpdatedAt = &note.UpdatedAt.Time
	}
	writeData(w, http.StatusOK, dto)
}

func (h *NotesHandler) GetPersonal(w http.ResponseWriter, r *http.Request) {
	user, _ := middleware.UserFromContext(r.Context())
	row, err := h.Queries.GetPersonalNotes(r.Context(), user.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeData(w, http.StatusOK, notesDTO{Content: ""})
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la libreta")
		return
	}
	dto := notesDTO{Content: row.Content}
	if row.UpdatedAt.Valid {
		dto.UpdatedAt = &row.UpdatedAt.Time
	}
	writeData(w, http.StatusOK, dto)
}

func (h *NotesHandler) PutPersonal(w http.ResponseWriter, r *http.Request) {
	var req putNotesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	note, err := h.Queries.UpsertPersonalNotes(ctx, db.UpsertPersonalNotesParams{UserID: user.ID, Content: req.Content})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la libreta")
		return
	}
	dto := notesDTO{Content: note.Content}
	if note.UpdatedAt.Valid {
		dto.UpdatedAt = &note.UpdatedAt.Time
	}
	writeData(w, http.StatusOK, dto)
}
