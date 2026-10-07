package handler

import (
	"crypto/subtle"
	"github.com/google/uuid"
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Seguimiento público de ticket (spec/06 §6.4): la página sin login para el
// cliente vive en /p/tickets/:token (Angular) y lee de
// GET /api/public/tickets/{token}. "Oculta 100% de PII de técnicos,
// comentarios internos y notas de escalación" — por eso tiene DTOs propios
// y nunca serializa structs de sqlc (antes salían user_id y author_name).

// publicAuthorLabel reemplaza el nombre del técnico en cada comunicado.
const publicAuthorLabel = "Mesa de Operaciones"

type publicCommentDTO struct {
	Author    string    `json:"author"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
	// ImageIDs: imágenes del comentario (GET /api/public/tickets/{token}/images/{id}).
	ImageIDs []uuid.UUID `json:"imageIds"`
}

type publicTicketDTO struct {
	TicketNumber   string             `json:"ticketNumber"`
	Title          string             `json:"title"`
	TicketType     string             `json:"ticketType"`
	Status         string             `json:"status"`
	Priority       string             `json:"priority"`
	ClientName     string             `json:"clientName"`
	OpenAt         *time.Time         `json:"openAt"`
	LastUpdateAt   *time.Time         `json:"lastUpdateAt"`
	PublicComments []publicCommentDTO `json:"publicComments"`
	// MergedInto: si el ticket se unió a otro, su número; lo de arriba es el
	// avance de ese principal (mismo cliente, se validó al unir).
	MergedInto *string `json:"mergedInto,omitempty"`
}

func publicImageIDs(rows []db.ListTicketImagesRow, commentID uuid.UUID) []uuid.UUID {
	out := []uuid.UUID{}
	for _, i := range rows {
		if i.IsPublic && i.CommentID.Valid && uuid.UUID(i.CommentID.Bytes) == commentID {
			out = append(out, i.ID)
		}
	}
	return out
}

func toPublicTicketDTO(t db.Ticket, clientName string, comments []db.TicketComment, images []db.ListTicketImagesRow) publicTicketDTO {
	out := publicTicketDTO{
		TicketNumber: t.TicketNumber, Title: t.Title, TicketType: string(t.TicketType), Status: string(t.Status),
		Priority: string(t.Priority), ClientName: clientName,
		OpenAt: timestamptzPtr(t.CreatedAt), LastUpdateAt: timestamptzPtr(t.UpdatedAt),
		PublicComments: make([]publicCommentDTO, 0, len(comments)),
	}
	for _, c := range comments {
		if !c.IsPublic {
			continue // defensa en profundidad: la consulta ya filtra, pero esto nunca debe filtrarse
		}
		out.PublicComments = append(out.PublicComments, publicCommentDTO{Author: publicAuthorLabel, Content: c.Content, CreatedAt: c.CreatedAt.Time, ImageIDs: publicImageIDs(images, c.ID)})
	}
	return out
}

// publicPinMatches compara en tiempo constante (una comparación normal
// filtra por timing cuántos dígitos iniciales acertó el atacante).
func publicPinMatches(stored pgtype.Text, given string) bool {
	if !stored.Valid {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(stored.String), []byte(given)) == 1
}

func (h *TicketsHandler) Public(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	ctx := r.Context()
	t, err := h.Queries.GetPublicTicket(ctx, pgtype.Text{String: token, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if t.PublicTrackingPin.Valid {
		// Un PIN de 6 dígitos son 10^6 combinaciones: sin tope por token se
		// prueba entero en minutos repartiendo el ataque entre varias IPs.
		if h.PinLimiter != nil && !h.PinLimiter.Allow("ticket-pin:"+token) {
			problemdetails.Write(w, r, http.StatusTooManyRequests, "too-many-attempts", "demasiados intentos de PIN, espera unos minutos")
			return
		}
		if !publicPinMatches(t.PublicTrackingPin, r.URL.Query().Get("pin")) {
			problemdetails.Write(w, r, 401, "pin-required", "PIN requerido o incorrecto")
			return
		}
	}
	// Unido a otro: el cliente ve el avance del principal (mismo cliente).
	var mergedInto *string
	if t.MergedIntoID.Valid {
		if main, mainErr := h.Queries.GetTicket(ctx, uuid.UUID(t.MergedIntoID.Bytes)); mainErr == nil {
			mergedInto = &main.TicketNumber
			t = main
		}
	}
	comments, err := h.Queries.ListPublicTicketComments(ctx, t.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el seguimiento")
		return
	}
	clientName := ""
	if org, orgErr := h.Queries.GetOrganization(ctx, t.ClientID); orgErr == nil {
		clientName = org.Name
	}
	images, err := h.Queries.ListTicketImages(ctx, t.ID)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cargar el seguimiento")
		return
	}
	dto := toPublicTicketDTO(t, clientName, comments, images)
	dto.MergedInto = mergedInto
	writeData(w, 200, dto)
}
