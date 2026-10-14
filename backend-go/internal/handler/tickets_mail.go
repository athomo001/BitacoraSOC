package handler

import (
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ticketmail"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Avisos por correo dentro de un ticket (spec/15 §5): "Afecta al cliente",
// "Avisar a" (Para/CC) y "Correos enviados" con "Reenviar".

type ticketMailItemDTO struct {
	ID        uuid.UUID  `json:"id"`
	Event     string     `json:"event"`
	Group     string     `json:"group"`
	To        []string   `json:"to"`
	Cc        []string   `json:"cc"`
	Subject   string     `json:"subject"`
	Status    string     `json:"status"`
	Attempts  int32      `json:"attempts"`
	Error     string     `json:"error,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	SendAfter time.Time  `json:"sendAfter"`
	SentAt    *time.Time `json:"sentAt,omitempty"`
}

type ticketMailsDTO struct {
	// MailEnabled / ClientEnabled: si no están, la pantalla no muestra la casilla.
	MailEnabled   bool                `json:"mailEnabled"`
	ClientEnabled bool                `json:"clientEnabled"`
	AffectsClient bool                `json:"affectsClient"`
	To            []string            `json:"to"`
	Cc            []string            `json:"cc"`
	Custom        bool                `json:"custom"`
	Items         []ticketMailItemDTO `json:"items"`
}

func (h *TicketsHandler) ticketMails(r *http.Request, t db.Ticket) (ticketMailsDTO, error) {
	ctx := r.Context()
	s, err := h.Queries.GetTicketSettings(ctx)
	if err != nil {
		return ticketMailsDTO{}, err
	}
	d := ticketMailsDTO{MailEnabled: s.MailEnabled, ClientEnabled: s.MailEnabled && s.MailClientEnabled, AffectsClient: t.AffectsClient, To: []string{}, Cc: []string{}, Items: []ticketMailItemDTO{}}
	if h.Mailer != nil {
		d.To, d.Cc, d.Custom = h.Mailer.clientRecipients(ctx, t)
	}
	rows, err := h.Queries.ListTicketMails(ctx, t.ID)
	if err != nil {
		return ticketMailsDTO{}, err
	}
	for _, row := range rows {
		item := ticketMailItemDTO{ID: row.ID, Event: row.Event, Group: row.MailGroup, To: nonNilStrings(row.ToEmails), Cc: nonNilStrings(row.CcEmails),
			Subject: row.Subject, Status: row.Status, Attempts: row.Attempts, Error: row.LastError.String, CreatedAt: row.CreatedAt.Time,
			SendAfter: row.SendAfter.Time, SentAt: timestamptzPtr(row.SentAt)}
		d.Items = append(d.Items, item)
	}
	return d, nil
}

// Mails es GET /api/tickets/{id}/mails.
func (h *TicketsHandler) Mails(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	t, err := h.Queries.GetTicket(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	d, err := h.ticketMails(r, t)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los correos del ticket")
		return
	}
	writeData(w, 200, d)
}

type ticketNotifyRequest struct {
	AffectsClient *bool `json:"affectsClient"`
	// To/Cc: los destinatarios de este ticket. Reset vuelve a los del cliente.
	To    *[]string `json:"to"`
	Cc    *[]string `json:"cc"`
	Reset bool      `json:"reset"`
}

// maxTicketRecipients: tope de Para + CC propios de un ticket.
const maxTicketRecipients = 40

// SetNotify es PUT /api/tickets/{id}/notify: "Afecta al cliente" y "Avisar a".
// Marcar "Afecta al cliente" en un ticket abierto manda "Ticket abierto".
func (h *TicketsHandler) SetNotify(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	var req ticketNotifyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	old, err := h.Queries.GetTicket(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if old.MergedIntoID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "ticket-merged", "este ticket se unió a otro")
		return
	}
	p := db.SetTicketMailRecipientsParams{ID: id}
	if req.AffectsClient != nil {
		p.AffectsClient = pgtype.Bool{Bool: *req.AffectsClient, Valid: true}
	}
	switch {
	case req.Reset:
		p.SetRecipients = true // NotifyTo/Cc nil: vuelven los del cliente
	case req.To != nil || req.Cc != nil:
		to, cc := []string{}, []string{}
		if req.To != nil {
			to = ticketmail.Unique(*req.To, "")
		}
		if req.Cc != nil {
			cc = ticketmail.Unique(*req.Cc, "")
		}
		if len(to)+len(cc) > maxTicketRecipients {
			problemdetails.Write(w, r, 400, "invalid-payload", "hasta 40 destinatarios por ticket")
			return
		}
		for _, e := range append(append([]string{}, to...), cc...) {
			if !directory.ValidEmail(e) {
				problemdetails.Write(w, r, 400, "invalid-payload", "correo no válido: "+e)
				return
			}
		}
		p.SetRecipients, p.NotifyTo, p.NotifyCc = true, to, cc
	}
	t, err := h.Queries.SetTicketMailRecipients(ctx, p)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar")
		return
	}
	actor, _ := middleware.UserFromContext(ctx)
	h.AuditLog.Log(ctx, "ticket.mail_recipients.updated", audit.LevelInfo, audit.Success(), map[string]any{
		"ticketId": id.String(), "affectsClient": t.AffectsClient, "custom": t.NotifyTo != nil || t.NotifyCc != nil,
	})
	if t.AffectsClient && !old.AffectsClient && t.Status != db.TicketStatusResolved && t.Status != db.TicketStatusClosed {
		h.Mailer.Emit(ctx, mailEmission{Event: ticketmail.ClientOpened, TicketID: id, ActorID: actor.ID})
	}
	h.notifyChanged(ctx, id)
	d, err := h.ticketMails(r, t)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los correos del ticket")
		return
	}
	writeData(w, 200, d)
}

// RetryMail es POST /api/tickets/{id}/mails/{mailId}/retry: vuelve a intentar
// un envío que falló.
func (h *TicketsHandler) RetryMail(w http.ResponseWriter, r *http.Request) {
	id, err1 := uuid.Parse(r.PathValue("id"))
	mailID, err2 := uuid.Parse(r.PathValue("mailId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, 404, "not-found", "correo no encontrado")
		return
	}
	ctx := r.Context()
	n, err := h.Queries.RetryTicketMail(ctx, db.RetryTicketMailParams{ID: mailID, TicketID: id})
	if err != nil || n == 0 {
		problemdetails.Write(w, r, 404, "not-found", "no hay un envío fallido con ese id")
		return
	}
	h.AuditLog.Log(ctx, "ticket.mail.retry", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": id.String(), "mailId": mailID.String()})
	w.WriteHeader(http.StatusNoContent)
}
