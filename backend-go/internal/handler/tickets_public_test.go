package handler

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Regresión: la vista pública serializaba db.TicketComment tal cual
// (user_id, author_name) — datos del técnico que el spec exige ocultar.
func TestPublicTicketDTO_HidesTechnicianAndInternalComments(t *testing.T) {
	technician := uuid.New()
	comments := []db.TicketComment{
		{ID: uuid.New(), UserID: pgtype.UUID{Bytes: technician, Valid: true}, AuthorName: "carlos.soto", Content: "Cuadrilla en sitio", IsPublic: true},
		{ID: uuid.New(), UserID: pgtype.UUID{Bytes: technician, Valid: true}, AuthorName: "carlos.soto", Content: "llamar al +56 9 1234 5678", IsPublic: false},
	}
	body, err := json.Marshal(toPublicTicketDTO(db.Ticket{TicketNumber: "TKT-2026-00042"}, "Banco Austral", comments))
	if err != nil {
		t.Fatal(err)
	}
	out := string(body)
	for _, leak := range []string{"carlos.soto", technician.String(), "user_id", "author_name", "+56 9"} {
		if strings.Contains(out, leak) {
			t.Fatalf("la vista pública expone %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, "Cuadrilla en sitio") || !strings.Contains(out, publicAuthorLabel) || !strings.Contains(out, "Banco Austral") {
		t.Fatalf("falta el comunicado público o el cliente: %s", out)
	}
}

func TestPublicPinMatches(t *testing.T) {
	pin := pgtype.Text{String: "482913", Valid: true}
	if !publicPinMatches(pin, "482913") {
		t.Fatal("PIN correcto rechazado")
	}
	for _, wrong := range []string{"", "482914", "48291", "4829130"} {
		if publicPinMatches(pin, wrong) {
			t.Fatalf("PIN %q aceptado", wrong)
		}
	}
	if !publicPinMatches(pgtype.Text{}, "") {
		t.Fatal("sin PIN configurado no se pide PIN")
	}
}
