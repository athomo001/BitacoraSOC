package ticketmail

import (
	"slices"
	"strings"
	"testing"
)

func on(events ...string) Settings {
	return Settings{Enabled: true, TeamEnabled: true, ClientEnabled: true, Events: events, Signature: "Mesa de Operaciones"}
}

func TestOnNeedsMasterGroupAndEvent(t *testing.T) {
	s := on(TeamCreated, ClientOpened)
	if !s.On(TeamCreated) || !s.On(ClientOpened) || s.On(TeamResolved) {
		t.Fatal("solo los eventos encendidos")
	}
	s.ClientEnabled = false
	if s.On(ClientOpened) || !s.On(TeamCreated) {
		t.Fatal("el grupo cliente apagado corta solo los del cliente")
	}
	s.Enabled = false
	if s.On(TeamCreated) {
		t.Fatal("el maestro apagado corta todo")
	}
}

func TestAffectsByDefault(t *testing.T) {
	cases := []struct {
		rule, typ, prio string
		want            bool
	}{
		{AffectsP1P2, "incident", "p1_critical", true},
		{AffectsP1P2, "incident", "p2_high", true},
		{AffectsP1P2, "incident", "p3_medium", false},
		{AffectsP1P2, "service_request", "p1_critical", false},
		{AffectsIncidents, "incident", "p4_low", true},
		{AffectsNone, "incident", "p1_critical", false},
	}
	for _, c := range cases {
		if got := AffectsByDefault(c.rule, c.typ, c.prio); got != c.want {
			t.Errorf("%s %s %s = %v", c.rule, c.typ, c.prio, got)
		}
	}
}

func TestTeamRecipientsNoDuplicatesAndSkipsActor(t *testing.T) {
	p := Party{Responsible: "ana@x.cl", Resolvers: []string{"Ana@x.cl", "beto@x.cl"}, Backup: []string{"noc@x.cl", "beto@x.cl"}, Actor: "beto@x.cl"}
	got := TeamRecipients(TeamSLAResolutionBreached, p, true)
	if !slices.Equal(got, []string{"ana@x.cl", "noc@x.cl"}) {
		t.Fatalf("got %v", got)
	}
	if got := TeamRecipients(TeamSLAResolutionBreached, p, false); len(got) != 3 {
		t.Fatalf("sin saltar al autor: %v", got)
	}
}

func TestTakingTicketYourselfSendsNothing(t *testing.T) {
	p := Party{Target: []string{"ana@x.cl"}, Actor: "ana@x.cl"}
	if got := TeamRecipients(TeamAssigned, p, true); len(got) != 0 {
		t.Fatalf("Tomar con 'no avisar al autor' no avisa: %v", got)
	}
}

func TestResponseBreachFallsBackToBackup(t *testing.T) {
	got := TeamRecipients(TeamSLAResponseBreached, Party{Backup: []string{"noc@x.cl"}}, true)
	if !slices.Equal(got, []string{"noc@x.cl"}) {
		t.Fatalf("sin responsable va a la copia de respaldo: %v", got)
	}
}

func TestClientMailHasNothingInternal(t *testing.T) {
	d := TicketData{Number: "TKT-2026-00061", Title: "Caída enlace", Priority: "p1_critical", Status: "in_progress",
		ClientName: "Banco", TeamName: "Redes Internas", Responsible: "ana.tecnica", CreatedBy: "beto", TrackingURL: "https://x/p/tickets/tok", Pin: "123456"}
	m := Render("Bitácora Ops", ClientComment, d, on(), []string{"Estamos <revisando>"})
	for _, internal := range []string{"Redes Internas", "ana.tecnica", "beto", "123456"} {
		if strings.Contains(m.HTML, internal) || strings.Contains(m.Text, internal) {
			t.Errorf("el correo al cliente no puede llevar %q", internal)
		}
	}
	if !strings.Contains(m.HTML, "Estamos &lt;revisando&gt;") {
		t.Error("el comentario va escapado")
	}
	if m.Subject != "[Bitácora Ops] TKT-2026-00061 · Nuevo comentario: Caída enlace" {
		t.Errorf("asunto: %q", m.Subject)
	}
	if !strings.Contains(m.HTML, "Mesa de Operaciones") {
		t.Error("firma ante el cliente")
	}
	s := on()
	s.IncludePin = true
	if m := Render("", ClientComment, d, s, nil); !strings.Contains(m.HTML, "123456") {
		t.Error("con 'incluir PIN' el PIN va")
	}
}

func TestTeamMailSubjectAndLink(t *testing.T) {
	d := TicketData{Number: "TKT-2026-00061", Title: "Caída enlace MPLS Temuco", Priority: "p1_critical", TeamURL: "https://x/tickets?id=1"}
	s := on()
	s.TeamLink = true
	m := Render("Marca", TeamCreated, d, s, nil)
	if m.Subject != "[Marca] Nuevo ticket TKT-2026-00061 · P1 · Caída enlace MPLS Temuco" {
		t.Errorf("asunto: %q", m.Subject)
	}
	if !strings.Contains(m.HTML, "https://x/tickets?id=1") {
		t.Error("botón Abrir el ticket")
	}
	s.TeamLink = false
	if m := Render("Marca", TeamCreated, d, s, nil); strings.Contains(m.HTML, "https://x/tickets?id=1") {
		t.Error("sin enlace si está apagado")
	}
}

func TestRetryDelays(t *testing.T) {
	if RetryDelayMinutes(0) != 1 || RetryDelayMinutes(1) != 5 || RetryDelayMinutes(2) != 30 {
		t.Fatal("1, 5 y 30 minutos")
	}
}
