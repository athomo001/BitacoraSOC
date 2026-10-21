package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// De la Ticketera a GLPI (10d.2, spec/18 §4.3–4.4).

// isCommentRequest: POST /api/tickets/{id}/comments (lo único que se puede
// hacer desde la app sobre un GLPI-…, con «Escribir en GLPI» encendido).
func isCommentRequest(r *http.Request) bool {
	return r.Method == http.MethodPost && strings.HasSuffix(strings.TrimRight(r.URL.Path, "/"), "/comments")
}

// addGlpiComment: un comentario en un GLPI-… queda en la app y sale a GLPI
// como seguimiento (privado salvo que se marque visible). No reabre, no
// marca respuesta ni manda correos: eso es de GLPI.
func (h *TicketsHandler) addGlpiComment(w http.ResponseWriter, r *http.Request, ticket db.Ticket, req commentRequest) {
	ctx := r.Context()
	if !h.Glpi.WriteReady(ctx) || !ticket.GlpiID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-readonly", glpiReadOnlyMessage)
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" || len(req.ImageIDs) > 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "en un ticket de GLPI se comenta solo con texto")
		return
	}
	u, _ := middleware.UserFromContext(ctx)
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	comment, err := q.CreateTicketComment(ctx, db.CreateTicketCommentParams{TicketID: ticket.ID, UserID: pgtype.UUID{Bytes: u.ID, Valid: true},
		AuthorName: u.Username, Content: content, IsPublic: req.IsPublic})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	outbox, err := q.InsertGlpiOutbox(ctx, db.InsertGlpiOutboxParams{Kind: "followup", GlpiTicketID: ticket.GlpiID.Int32,
		TicketID: pgtype.UUID{Bytes: ticket.ID, Valid: true}, TicketCommentID: pgtype.UUID{Bytes: comment.ID, Valid: true},
		Content: glpiSignature(content, u.Username), IsPrivate: !req.IsPublic, CreatedBy: pgtype.UUID{Bytes: u.ID, Valid: true}})
	if err == nil {
		err = q.SetTicketCommentPush(ctx, db.SetTicketCommentPushParams{ID: comment.ID, State: pgtype.Text{String: "queued", Valid: true}})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	h.Glpi.SendNow(ctx, outbox)
	if h.AuditLog != nil {
		h.AuditLog.Log(ctx, "ticket.comment_added", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": ticket.ID.String(), "glpi": true, "public": req.IsPublic})
	}
	h.notifyChanged(ctx, ticket.ID)
	writeData(w, http.StatusCreated, h.commentWithPush(ctx, comment))
}

// pushToCopy: un comentario nuevo de un ticket de la app con copia en GLPI
// sale como seguimiento de la copia («van y vuelven»).
func (h *TicketsHandler) pushToCopy(ctx context.Context, ticket db.Ticket, comment db.TicketComment, author string, actor uuid.UUID) bool {
	if !ticket.GlpiCopyID.Valid || isGlpiTicket(ticket) || !h.Glpi.WriteReady(ctx) {
		return false
	}
	outbox, err := h.Queries.InsertGlpiOutbox(ctx, db.InsertGlpiOutboxParams{Kind: "followup", GlpiTicketID: ticket.GlpiCopyID.Int32,
		TicketID: pgtype.UUID{Bytes: ticket.ID, Valid: true}, TicketCommentID: pgtype.UUID{Bytes: comment.ID, Valid: true},
		Content: glpiSignature(comment.Content, author), IsPrivate: !comment.IsPublic, CreatedBy: pgtype.UUID{Bytes: actor, Valid: actor != uuid.Nil}})
	if err != nil {
		return false
	}
	_ = h.Queries.SetTicketCommentPush(ctx, db.SetTicketCommentPushParams{ID: comment.ID, State: pgtype.Text{String: "queued", Valid: true}})
	h.Glpi.SendNow(ctx, outbox)
	return true
}

// commentWithPush: el comentario con su estado de envío a GLPI ya resuelto.
func (h *TicketsHandler) commentWithPush(ctx context.Context, c db.TicketComment) ticketCommentDTO {
	if fresh, err := h.Queries.GetTicketComment(ctx, c.ID); err == nil {
		c = fresh
	}
	return toTicketCommentDTO(c)
}

// glpiCopyDTO: la copia en GLPI de un ticket de la app.
type glpiCopyDTO struct {
	ID  int    `json:"id"`
	URL string `json:"url,omitempty"`
}

// GlpiCopyPreview es GET /api/tickets/{id}/glpi-copy: la vista previa de
// «Crear en GLPI» (entidad del cliente, grupo del área, tipo, urgencia).
func (h *TicketsHandler) GlpiCopyPreview(w http.ResponseWriter, r *http.Request) {
	t, cfg, ok := h.copyTarget(w, r)
	if !ok {
		return
	}
	writeData(w, http.StatusOK, h.copyPreview(r.Context(), cfg, t))
}

func (h *TicketsHandler) copyPreview(ctx context.Context, cfg db.GlpiConfig, t db.Ticket) glpiCreatePreviewDTO {
	desc := t.TicketNumber + " en Bitácora Ops\n\n" + t.Description
	return h.Glpi.createPreview(ctx, cfg, t.ClientID, t.AreaID, string(t.Urgency), string(t.Impact), t.Title, desc)
}

// copyTarget: el ticket se puede copiar (de la app, sin copia, escritura encendida).
func (h *TicketsHandler) copyTarget(w http.ResponseWriter, r *http.Request) (db.Ticket, db.GlpiConfig, bool) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return db.Ticket{}, db.GlpiConfig{}, false
	}
	cfg, ready := h.Glpi.writeReady(ctx)
	if !ready {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-write-off", "«Escribir en GLPI» está apagado (Administración → GLPI)")
		return db.Ticket{}, cfg, false
	}
	t, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return t, cfg, false
	}
	if isGlpiTicket(t) {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-readonly", "este ticket ya vive en GLPI")
		return t, cfg, false
	}
	if t.GlpiCopyID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-copy-exists", "este ticket ya tiene su copia en GLPI")
		return t, cfg, false
	}
	return t, cfg, true
}

// CreateGlpiCopy es POST /api/tickets/{id}/glpi-copy: crea la copia en GLPI
// al momento (se ve el número o el error) y la deja enlazada al ticket.
func (h *TicketsHandler) CreateGlpiCopy(w http.ResponseWriter, r *http.Request) {
	t, cfg, ok := h.copyTarget(w, r)
	if !ok {
		return
	}
	var req glpiCreateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	ctx := r.Context()
	preview := h.copyPreview(ctx, cfg, t)
	if preview.Problem != "" {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-no-entity", preview.Problem)
		return
	}
	glpiID, err := h.Glpi.createInGlpi(ctx, cfg, preview, req, userEmail(ctx, h.Queries))
	if err != nil {
		h.AuditLog.Log(ctx, "glpi.ticket.created", audit.LevelWarn, audit.Failure(explain(err).Error), map[string]any{"ticketId": t.ID.String(), "from": "ticket"})
		writeCreateError(w, r, err)
		return
	}
	if n, err := h.Queries.SetTicketGlpiCopy(ctx, db.SetTicketGlpiCopyParams{ID: t.ID, GlpiCopyID: pgtype.Int4{Int32: int32(glpiID), Valid: true}}); err != nil || n == 0 {
		problemdetails.Write(w, r, 500, "internal-error", "se creó GLPI-"+strconv.Itoa(glpiID)+" pero no se pudo enlazar al ticket")
		return
	}
	h.AuditLog.Log(ctx, "glpi.ticket.created", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": t.ID.String(), "from": "ticket", "glpiId": glpiID})
	h.notifyChanged(ctx, t.ID)
	writeData(w, http.StatusCreated, glpiCopyDTO{ID: glpiID, URL: glpi.WebURL(cfg.ApiUrl, glpi.Ticket, glpiID)})
}
