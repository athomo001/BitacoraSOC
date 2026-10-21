package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Notas internas del CSM (spec/16 §4.7.1; diseño y propuestas aprobados por
// el dueño 2026-10-21): solo las ve el perfil Gestión, ni el admin ni las
// jefaturas de otras áreas. Edita y borra el autor; fijar, cualquiera de CSM.
// La Auditoría registra que existe una nota, nunca su texto (así tampoco
// llega al SIEM).

const maxClientNote = 5000

type clientNoteDTO struct {
	ID         uuid.UUID  `json:"id"`
	AuthorID   *uuid.UUID `json:"authorId"`
	AuthorName string     `json:"authorName"`
	Content    string     `json:"content"`
	Pinned     bool       `json:"pinned"`
	EditedAt   *time.Time `json:"editedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	Mine       bool       `json:"mine"`
}

func toClientNoteDTO(n db.ClientNote, me uuid.UUID) clientNoteDTO {
	return clientNoteDTO{ID: n.ID, AuthorID: uuidPtr(n.AuthorID), AuthorName: n.AuthorName, Content: n.Content, Pinned: n.Pinned,
		EditedAt: timestamptzPtr(n.EditedAt), CreatedAt: n.CreatedAt.Time, Mine: n.AuthorID.Valid && uuid.UUID(n.AuthorID.Bytes) == me}
}

// csmUser: solo el perfil Gestión (la gente de CSM).
func (h *ManagementHandler) csmUser(w http.ResponseWriter, r *http.Request) (agendaUser, bool) {
	u, err := loadAgendaUser(r.Context(), h.Queries)
	if err != nil {
		mgmtFail(w, r)
		return u, false
	}
	if !u.gestion {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "las notas internas las ve solo el equipo de CSM")
		return u, false
	}
	return u, true
}

// ClientNotes es GET /api/management/clients/{id}/notes.
func (h *ManagementHandler) ClientNotes(w http.ResponseWriter, r *http.Request) {
	u, ok := h.csmUser(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	rows, err := h.Queries.ListClientNotes(r.Context(), id)
	if err != nil {
		mgmtFail(w, r)
		return
	}
	out := make([]clientNoteDTO, 0, len(rows))
	for _, n := range rows {
		out = append(out, toClientNoteDTO(n, u.id))
	}
	writeData(w, http.StatusOK, out)
}

type clientNoteRequest struct {
	Content string `json:"content"`
}

func cleanNote(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req clientNoteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return "", false
	}
	content := strings.TrimSpace(req.Content)
	if content == "" || len([]rune(content)) > maxClientNote {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la nota no puede ir vacía (hasta 5000 caracteres)")
		return "", false
	}
	return content, true
}

// CreateClientNote es POST /api/management/clients/{id}/notes.
func (h *ManagementHandler) CreateClientNote(w http.ResponseWriter, r *http.Request) {
	u, ok := h.csmUser(w, r)
	if !ok {
		return
	}
	client, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
		return
	}
	content, ok := cleanNote(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	n, err := h.Queries.CreateClientNote(ctx, db.CreateClientNoteParams{ClientID: client, AuthorID: pgtype.UUID{Bytes: u.id, Valid: true},
		AuthorName: user.Username, Content: content})
	if err != nil {
		if isForeignKeyViolation(err) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "cliente no encontrado")
			return
		}
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "management.note.create", audit.LevelInfo, audit.Success(), map[string]any{"clientId": client.String(), "noteId": n.ID.String()})
	writeData(w, http.StatusCreated, toClientNoteDTO(n, u.id))
}

// noteFor carga la nota (404 si no existe).
func (h *ManagementHandler) noteFor(w http.ResponseWriter, r *http.Request) (db.ClientNote, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "nota no encontrada")
		return db.ClientNote{}, false
	}
	n, err := h.Queries.GetClientNote(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "nota no encontrada")
		return n, false
	}
	if err != nil {
		mgmtFail(w, r)
		return n, false
	}
	return n, true
}

func isAuthor(n db.ClientNote, me uuid.UUID) bool {
	return n.AuthorID.Valid && uuid.UUID(n.AuthorID.Bytes) == me
}

// UpdateClientNote es PUT /api/management/notes/{id}: solo el autor.
func (h *ManagementHandler) UpdateClientNote(w http.ResponseWriter, r *http.Request) {
	u, ok := h.csmUser(w, r)
	if !ok {
		return
	}
	n, ok := h.noteFor(w, r)
	if !ok {
		return
	}
	if !isAuthor(n, u.id) {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "solo quien escribió la nota la edita")
		return
	}
	content, ok := cleanNote(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	n, err := h.Queries.UpdateClientNote(ctx, db.UpdateClientNoteParams{ID: n.ID, Content: content})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "management.note.update", audit.LevelInfo, audit.Success(), map[string]any{"clientId": n.ClientID.String(), "noteId": n.ID.String()})
	writeData(w, http.StatusOK, toClientNoteDTO(n, u.id))
}

// PinClientNote es POST /api/management/notes/{id}/pin {pinned}: cualquiera de CSM.
func (h *ManagementHandler) PinClientNote(w http.ResponseWriter, r *http.Request) {
	u, ok := h.csmUser(w, r)
	if !ok {
		return
	}
	n, ok := h.noteFor(w, r)
	if !ok {
		return
	}
	var req struct {
		Pinned bool `json:"pinned"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ctx := r.Context()
	n, err := h.Queries.PinClientNote(ctx, db.PinClientNoteParams{ID: n.ID, Pinned: req.Pinned, PinnedBy: pgtype.UUID{Bytes: u.id, Valid: true}})
	if err != nil {
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "management.note.pin", audit.LevelInfo, audit.Success(), map[string]any{"clientId": n.ClientID.String(), "noteId": n.ID.String(), "pinned": req.Pinned})
	writeData(w, http.StatusOK, toClientNoteDTO(n, u.id))
}

// DeleteClientNote es DELETE /api/management/notes/{id}: solo el autor.
func (h *ManagementHandler) DeleteClientNote(w http.ResponseWriter, r *http.Request) {
	u, ok := h.csmUser(w, r)
	if !ok {
		return
	}
	n, ok := h.noteFor(w, r)
	if !ok {
		return
	}
	if !isAuthor(n, u.id) {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "solo quien escribió la nota la borra")
		return
	}
	ctx := r.Context()
	if _, err := h.Queries.DeleteClientNote(ctx, n.ID); err != nil {
		mgmtFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "management.note.delete", audit.LevelInfo, audit.Success(), map[string]any{"clientId": n.ClientID.String(), "noteId": n.ID.String()})
	w.WriteHeader(http.StatusNoContent)
}
