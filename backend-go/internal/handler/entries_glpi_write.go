package handler

import (
	"context"
	"net/http"
	"regexp"
	"strconv"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// De la Bitácora a GLPI (10d.2, spec/18 §4.5): «Crear en GLPI» desde una
// entrada (queda enlazada; el ticket llega a la Ticketera como GLPI-… y se
// trabaja en GLPI) y «También en GLPI» en sus seguimientos.

var glpiNumberRe = regexp.MustCompile(`^[0-9]{1,9}$`)

// entryGlpiNumber: el número de GLPI enlazado a la entrada, o 0.
func entryGlpiNumber(e db.GetEntryRow) int {
	if !e.GlpiTicketID.Valid || !glpiNumberRe.MatchString(e.GlpiTicketID.String) {
		return 0
	}
	n, _ := strconv.Atoi(e.GlpiTicketID.String)
	return n
}

// entryArea: el área de los grupos al crear desde una entrada (SOC o NOC
// según su ámbito; general: cualquiera).
func (h *EntriesHandler) entryArea(ctx context.Context, scope db.EntryScope) uuid.UUID {
	code := map[db.EntryScope]string{db.EntryScopeSoc: "soc", db.EntryScopeNoc: "noc"}[scope]
	if code == "" {
		return uuid.Nil
	}
	if areas, err := h.Queries.ListTicketAreas(ctx); err == nil {
		for _, a := range areas {
			if a.Code == code {
				return a.ID
			}
		}
	}
	return uuid.Nil
}

// glpiCreateTarget: la entrada se puede crear en GLPI (escritura encendida,
// sin un ticket de GLPI enlazado). Devuelve la entrada, la config y su cliente.
func (h *EntriesHandler) glpiCreateTarget(w http.ResponseWriter, r *http.Request) (db.GetEntryRow, db.GlpiConfig, uuid.UUID, bool) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return db.GetEntryRow{}, db.GlpiConfig{}, uuid.Nil, false
	}
	cfg, ready := h.Glpi.writeReady(ctx)
	if !ready {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-write-off", "«Escribir en GLPI» está apagado (Administración → GLPI)")
		return db.GetEntryRow{}, cfg, uuid.Nil, false
	}
	e, err := h.Queries.GetEntry(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return e, cfg, uuid.Nil, false
	}
	if e.GlpiTicketID.Valid && e.GlpiTicketID.String != "" {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-linked", "la entrada ya está enlazada a GLPI-"+e.GlpiTicketID.String)
		return e, cfg, uuid.Nil, false
	}
	client := uuid.Nil
	if rows, err := h.Queries.ListEntriesForAPI(ctx, db.ListEntriesForAPIParams{ID: pgtype.UUID{Bytes: id, Valid: true}, MaxRows: 1}); err == nil && len(rows) > 0 {
		if c, err := uuid.Parse(rows[0].ClientID); err == nil {
			client = c
		}
	}
	return e, cfg, client, true
}

func (h *EntriesHandler) glpiPreview(ctx context.Context, cfg db.GlpiConfig, e db.GetEntryRow, client uuid.UUID) glpiCreatePreviewDTO {
	urgency := "medium"
	if e.EntryType == db.EntryTypeIncidente || e.EntryType == db.EntryTypeOfensa {
		urgency = "high"
	}
	p := h.Glpi.createPreview(ctx, cfg, client, h.entryArea(ctx, e.Scope), urgency, "medium", ticketTitleFromContent(e.Content), e.Content)
	if client == uuid.Nil {
		p.Problem = "la entrada no tiene cliente: elige su servicio o activo antes de crearla en GLPI"
	}
	return p
}

// GlpiCreatePreview es GET /api/entries/{id}/glpi-create.
func (h *EntriesHandler) GlpiCreatePreview(w http.ResponseWriter, r *http.Request) {
	e, cfg, client, ok := h.glpiCreateTarget(w, r)
	if !ok {
		return
	}
	writeData(w, http.StatusOK, h.glpiPreview(r.Context(), cfg, e, client))
}

// CreateInGlpi es POST /api/entries/{id}/glpi-create: crea el ticket en GLPI
// y deja la entrada enlazada a él.
func (h *EntriesHandler) CreateInGlpi(w http.ResponseWriter, r *http.Request) {
	e, cfg, client, ok := h.glpiCreateTarget(w, r)
	if !ok {
		return
	}
	var req glpiCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ctx := r.Context()
	preview := h.glpiPreview(ctx, cfg, e, client)
	if preview.Problem != "" {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-no-entity", preview.Problem)
		return
	}
	glpiID, err := h.Glpi.createInGlpi(ctx, cfg, preview, req, userEmail(ctx, h.Queries))
	if err != nil {
		h.AuditLog.Log(ctx, "glpi.ticket.created", audit.LevelWarn, audit.Failure(explain(err).Error), map[string]any{"entryId": e.ID.String(), "from": "entry"})
		writeCreateError(w, r, err)
		return
	}
	number := strconv.Itoa(glpiID)
	if _, err := h.Queries.SetEntryGlpiTicket(ctx, db.SetEntryGlpiTicketParams{ID: e.ID, GlpiTicketID: pgtype.Text{String: number, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "se creó GLPI-"+number+" pero no se pudo enlazar a la entrada")
		return
	}
	h.AuditLog.Log(ctx, "glpi.ticket.created", audit.LevelInfo, audit.Success(), map[string]any{"entryId": e.ID.String(), "from": "entry", "glpiId": glpiID})
	writeData(w, http.StatusCreated, map[string]any{"glpiTicketId": number, "glpiTicketUrl": glpi.WebURL(cfg.ApiUrl, glpi.Ticket, glpiID)})
}

// pushEntryComment: «También en GLPI» manda el seguimiento al ticket de GLPI
// enlazado. Devuelve el estado del envío ("" si no se mandó).
func (h *EntriesHandler) pushEntryComment(ctx context.Context, e db.GetEntryRow, commentID uuid.UUID, text string) string {
	number := entryGlpiNumber(e)
	if number == 0 || !h.Glpi.WriteReady(ctx) {
		return ""
	}
	user, _ := middleware.UserFromContext(ctx)
	outbox, err := h.Queries.InsertGlpiOutbox(ctx, db.InsertGlpiOutboxParams{Kind: "followup", GlpiTicketID: int32(number),
		EntryID: pgtype.UUID{Bytes: e.ID, Valid: true}, EntryCommentID: pgtype.UUID{Bytes: commentID, Valid: true},
		Content: glpiSignature(text, user.Username), IsPrivate: true, CreatedBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	if err != nil {
		return ""
	}
	_ = h.Queries.SetEntryCommentPush(ctx, db.SetEntryCommentPushParams{ID: commentID, State: pgtype.Text{String: "queued", Valid: true}})
	h.Glpi.SendNow(ctx, outbox)
	return "queued"
}
