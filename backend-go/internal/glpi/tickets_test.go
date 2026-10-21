package glpi_test

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi/glpitest"
)

func TestTextPasaElHTMLDeGLPIATexto(t *testing.T) {
	cases := map[string]string{
		// GLPI 10 guarda el HTML codificado.
		"&#60;p&#62;Hola&#60;br /&#62;mundo&#60;/p&#62;": "Hola\nmundo",
		"<ul><li>uno</li><li>dos</li></ul>":              "- uno\n- dos",
		"<p>A &amp; B&nbsp;</p><p></p><p></p><p>C</p>":   "A & B\n\nC",
		"texto plano": "texto plano",
	}
	for in, want := range cases {
		if got := glpi.Text(in); got != want {
			t.Errorf("Text(%q) = %q; quiero %q", in, got, want)
		}
	}
}

func TestParseDate(t *testing.T) {
	loc := time.FixedZone("CLT", -3*3600)
	if at, ok := glpi.ParseDate("2026-10-20 11:52:00", loc); !ok || !at.Equal(time.Date(2026, 10, 20, 14, 52, 0, 0, time.UTC)) {
		t.Errorf("ParseDate: %v %v", at, ok)
	}
	for _, empty := range []string{"", "0000-00-00 00:00:00", "mañana"} {
		if _, ok := glpi.ParseDate(empty, loc); ok {
			t.Errorf("ParseDate(%q) debió venir vacía", empty)
		}
	}
}

func TestBuscaSoloLoQueCambio(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	s.Set("Ticket",
		map[string]any{"id": 3, "date_mod": "2026-10-20 08:00:00", "is_deleted": 0},
		map[string]any{"id": 1, "date_mod": "2026-10-20 10:00:00", "is_deleted": 0},
		map[string]any{"id": 2, "date_mod": "2026-10-20 10:30:00", "is_deleted": 1})
	sess := open(t, s)
	defer sess.Close()
	ctx := context.Background()
	if ids, err := glpi.SearchTicketIDs(ctx, sess, glpi.TicketQuery{}); err != nil || ids != nil {
		t.Fatalf("sin entidades no se busca nada: %v %v", ids, err)
	}
	ids, err := glpi.SearchTicketIDs(ctx, sess, glpi.TicketQuery{Entities: []int{4, 9}, ModifiedAfter: "2026-10-20 09:00:00"})
	if err != nil || !reflect.DeepEqual(ids, []int{1}) {
		t.Fatalf("cambiados: %v %v", ids, err)
	}
	q := s.Searches[0]
	if q.Get("criteria[0][criteria][1][link]") != "OR" || q.Get("criteria[0][criteria][1][value]") != "9" || q.Get("criteria[1][field]") != "19" ||
		q.Get("criteria[1][searchtype]") != "morethan" || q.Get("forcedisplay[0]") != "2" {
		t.Errorf("criterios: %v", q)
	}
	ids, err = glpi.SearchTicketIDs(ctx, sess, glpi.TicketQuery{Entities: []int{4}, ModifiedAfter: "2026-10-20 09:00:00", Trashed: true})
	if err != nil || !reflect.DeepEqual(ids, []int{2}) || s.Searches[1].Get("is_deleted") != "1" {
		t.Fatalf("papelera: %v %v", ids, err)
	}
}

func TestFetchTicket(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	s.Set("Ticket", map[string]any{"id": 7, "name": "Caída", "content": "&#60;p&#62;Sin enlace&#60;/p&#62;", "status": 4, "entities_id": 3,
		"date": "2026-10-20 07:00:00", "takeintoaccount_delay_stat": 600})
	s.Set("Ticket/7/Group_Ticket", map[string]any{"groups_id": 5, "type": 1}, map[string]any{"groups_id": 10, "type": 2})
	s.Set("Ticket/7/Ticket_User", map[string]any{"users_id": 40, "type": 1}, map[string]any{"users_id": 41, "type": 2})
	s.Set("Ticket/7/ITILFollowup", map[string]any{"id": 1, "users_id": 41, "content": "Revisando", "is_private": 1, "date": "2026-10-20 07:05:00"})
	s.Set("Ticket/7/TicketTask", map[string]any{"id": 2, "users_id": 40, "users_id_tech": 41, "content": "Pruebas", "actiontime": 900})
	s.Set("Ticket/7/ITILSolution", map[string]any{"id": 3, "content": "Rechazada", "status": 4})
	sess := open(t, s)
	defer sess.Close()
	ctx := context.Background()
	td, err := glpi.FetchTicket(ctx, sess, 7)
	if err != nil {
		t.Fatal(err)
	}
	if td.Content != "Sin enlace" || !reflect.DeepEqual(td.Groups, []int{10}) || !reflect.DeepEqual(td.Techs, []int{41}) || td.TakeIntoAccount != "2026-10-20 07:10:00" {
		t.Errorf("ticket: %+v", td)
	}
	if len(td.Notes) != 2 || !td.Notes[0].Private || td.Notes[1].Kind != "task" || td.Notes[1].UserID != 41 || td.Notes[1].Seconds != 900 {
		t.Errorf("seguimientos (la solución rechazada no entra): %+v", td.Notes)
	}
	if _, err := glpi.FetchTicket(ctx, sess, 8); !errors.Is(err, glpi.ErrNotFound) {
		t.Errorf("un ticket que no está: %v", err)
	}
}

func TestGroupsSoloLosAsignables(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	s.Set("Group", map[string]any{"id": 2, "completename": "Redes", "is_assign": 1}, map[string]any{"id": 3, "completename": "Avisos", "is_assign": 0},
		map[string]any{"id": 1, "completename": "Mesa N1", "is_assign": 1})
	sess := open(t, s)
	defer sess.Close()
	groups, err := glpi.Groups(context.Background(), sess)
	if err != nil || !reflect.DeepEqual(groups, []glpi.Group{{ID: 1, Name: "Mesa N1"}, {ID: 2, Name: "Redes"}}) {
		t.Fatalf("grupos: %+v %v", groups, err)
	}
}
