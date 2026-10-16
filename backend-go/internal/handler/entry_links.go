package handler

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Enlazar una entrada ya guardada a un ticket, interno o de GLPI, desde su
// detalle (pedido del dueño 2026-10-16). Al escribir ya se podía poner el
// número del interno; ahora también después, y se ve en el detalle.

type entryTicketDTO struct {
	ID     uuid.UUID `json:"id"`
	Number string    `json:"number"`
	Title  string    `json:"title"`
}

// entryLinks completa el detalle con el ticket interno y el de GLPI.
func (h *EntriesHandler) entryLinks(ctx context.Context, dto *entryDetailDTO, ticketID pgtype.UUID, glpiID pgtype.Text) {
	if ticketID.Valid {
		if t, err := h.Queries.GetTicket(ctx, ticketID.Bytes); err == nil {
			dto.Ticket = &entryTicketDTO{ID: t.ID, Number: t.TicketNumber, Title: t.Title}
		}
	}
	if glpiID.Valid && glpiID.String != "" {
		dto.GlpiTicketID = glpiID.String
		if cfg, err := h.Queries.GetGlpiConfig(ctx); err == nil {
			dto.GlpiTicketURL = glpiTicketURL(cfg.ApiUrl, glpiID.String)
		}
	}
}

// glpiTicketURL arma el enlace a la ficha del ticket en GLPI a partir de la
// URL de la API configurada (https://glpi.empresa.cl/apirest.php).
func glpiTicketURL(apiURL, id string) string {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if base == "" || !strings.HasPrefix(base, "http") {
		return ""
	}
	base = strings.TrimSuffix(base, "/apirest.php")
	return base + "/front/ticket.form.php?id=" + id
}

var glpiTicketNumber = regexp.MustCompile(`^\d{1,12}$`)

// SetGlpiTicket: PUT /api/entries/{id}/glpi-ticket {glpiTicketId}; vacío lo quita.
func (h *EntriesHandler) SetGlpiTicket(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	var req struct {
		GlpiTicketID string `json:"glpiTicketId"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	number := strings.TrimPrefix(strings.TrimSpace(req.GlpiTicketID), "#")
	if number != "" && !glpiTicketNumber.MatchString(number) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el número de GLPI son solo dígitos (por ejemplo 12345)")
		return
	}
	ctx := r.Context()
	value := pgtype.Text{String: number, Valid: number != ""}
	if _, err := h.Queries.SetEntryGlpiTicket(ctx, db.SetEntryGlpiTicketParams{ID: id, GlpiTicketID: value}); errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	} else if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el enlace")
		return
	}
	event := "entry.glpi_linked"
	if number == "" {
		event = "entry.glpi_unlinked"
	}
	h.AuditLog.Log(ctx, event, audit.LevelInfo, audit.Success(), map[string]any{"entryId": id.String(), "glpiTicketId": number})
	h.Get(w, r)
}

// UnlinkEntry: DELETE /api/entries/{id}/ticket-link — quita el ticket interno
// (con la Ticketera encendida, como al enlazarlo). Deja una nota en el ticket.
func (h *TicketsHandler) UnlinkEntry(w http.ResponseWriter, r *http.Request) {
	entryID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	ctx := r.Context()
	row, err := h.Queries.GetEntry(ctx, entryID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	if !row.TicketID.Valid {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := h.Queries.LinkEntryToTicket(ctx, db.LinkEntryToTicketParams{ID: entryID}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo quitar el enlace")
		return
	}
	u, _ := middleware.UserFromContext(ctx)
	_, _ = h.Queries.CreateTicketComment(ctx, db.CreateTicketCommentParams{TicketID: row.TicketID.Bytes, UserID: pgtype.UUID{Bytes: u.ID, Valid: true}, AuthorName: u.Username, Content: "Entrada de bitácora desvinculada: " + entryID.String(), IsPublic: false})
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "entry.ticket_unlinked", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entryID.String(), "ticketId": uuid.UUID(row.TicketID.Bytes).String()})
	}
	w.WriteHeader(http.StatusNoContent)
}
