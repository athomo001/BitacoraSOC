package handler

import (
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

func TestCsvHeader_SinTildesNiEspacios(t *testing.T) {
	for in, want := range map[string]string{"Cumpleaños": "cumpleanos", " Aplica a ": "aplica_a", "ÁREAS": "areas", "codigo": "codigo"} {
		if got := csvHeader(in); got != want {
			t.Errorf("csvHeader(%q) = %q, quería %q", in, got, want)
		}
	}
}

func TestParseLocalTime_FormatosYZona(t *testing.T) {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin base de zonas horarias")
	}
	want := time.Date(2026, 11, 5, 22, 0, 0, 0, loc)
	for _, s := range []string{"2026-11-05 22:00", "2026-11-05T22:00", "05-11-2026 22:00", "05/11/2026 22:00:00", want.Format(time.RFC3339)} {
		got, ok := parseLocalTime(s, loc)
		if !ok || !got.Equal(want) {
			t.Errorf("parseLocalTime(%q) = %v, %v", s, got, ok)
		}
	}
	if _, ok := parseLocalTime("mañana", loc); ok {
		t.Error("«mañana» no es una fecha")
	}
}

func TestParseDayYYesNo(t *testing.T) {
	for _, s := range []string{"1990-05-14", "14-05-1990", "14/05/1990"} {
		if d, ok := parseDay(s); !ok || d.Format("2006-01-02") != "1990-05-14" {
			t.Errorf("parseDay(%q) = %v, %v", s, d, ok)
		}
	}
	cases := []struct {
		in       string
		def, out bool
		ok       bool
	}{{"", true, true, true}, {"Sí", false, true, true}, {"x", false, true, true}, {"NO", true, false, true}, {"quizás", true, false, false}}
	for _, c := range cases {
		if got, ok := parseYesNo(c.in, c.def); got != c.out || ok != c.ok {
			t.Errorf("parseYesNo(%q) = %v, %v", c.in, got, ok)
		}
	}
}

func TestLookup_NombreRepetidoEsAmbiguo(t *testing.T) {
	l := newLookup[string]()
	l.add("RM", "a")
	l.add("Santiago", "a")
	l.add("Santiago", "b")
	if v, msg := l.find("zona", "rm"); v != "a" || msg != "" {
		t.Errorf("rm = %q, %q", v, msg)
	}
	if _, msg := l.find("zona", "Santiago"); !strings.Contains(msg, "más de un") {
		t.Errorf("Santiago debería ser ambiguo: %q", msg)
	}
	if _, msg := l.find("zona", "Lima"); !strings.Contains(msg, "no existe") {
		t.Errorf("Lima: %q", msg)
	}
}

func TestEntryTags_SeparadoresYLargo(t *testing.T) {
	tags, msg := entryTags("firewall| cliente:mundo ;;vpn")
	if msg != "" || strings.Join(tags, ",") != "firewall,cliente:mundo,vpn" {
		t.Errorf("tags = %v, %q", tags, msg)
	}
	if _, msg := entryTags(strings.Repeat("x", maxTagLen+1)); msg == "" {
		t.Error("una etiqueta de más de 50 caracteres no entra")
	}
}

func TestUserCatalog_AreasConNivel(t *testing.T) {
	n1 := uuid.New()
	c := userCatalog{
		areas:  map[string]db.Area{"soc": {Code: "soc", Name: "SOC"}, "noc": {Code: "noc", Name: "NOC"}},
		levels: map[string]db.Level{n1.String(): {ID: n1, Code: "n1", Name: "N1"}},
		area:   newLookup[string](), level: newLookup[string](),
	}
	for code, a := range c.areas {
		c.area.add(code, code)
		c.area.add(a.Name, code)
	}
	c.level.add("n1", n1.String())
	c.level.add("N1", n1.String())

	got, msg := c.parseAreas("SOC=N1; noc")
	if msg != "" || len(got) != 2 || got[0].LevelID != n1.String() || got[1].LevelID != "" {
		t.Fatalf("parseAreas = %+v, %q", got, msg)
	}
	if c.areasText(got) != "SOC=N1; NOC" {
		t.Errorf("areasText = %q", c.areasText(got))
	}
	if !sameAreas(got, []placementArea{got[1], got[0]}) {
		t.Error("el orden no importa")
	}
	if sameAreas(got, []placementArea{got[0], {Code: "noc", LevelID: n1.String()}}) {
		t.Error("otro nivel es otra ubicación")
	}
	if _, msg := c.parseAreas("SOC; soc"); !strings.Contains(msg, "se repite") {
		t.Errorf("área repetida: %q", msg)
	}
	if _, msg := c.parseAreas("SOC=N9"); !strings.Contains(msg, "no existe") {
		t.Errorf("nivel inexistente: %q", msg)
	}
}

func TestUserRow_Validaciones(t *testing.T) {
	c := userCatalog{users: map[string]db.User{}, byEmail: map[string]string{"ana@x.cl": "ana"}, area: newLookup[string](), level: newLookup[string]()}
	cases := map[string]map[string]string{
		"minúsculas":   {"usuario": "a"},
		"ya es de ana": {"usuario": "pedro", "correo": "ana@x.cl"},
		"rol «jefe»":   {"usuario": "pedro", "rol": "jefe"},
		"no puede ser": {"usuario": "pedro", "cumpleanos": "2999-01-01"},
	}
	for want, cols := range cases {
		if _, msg := c.parseUserRow(cols); !strings.Contains(msg, want) {
			t.Errorf("%v: %q no dice %q", cols, msg, want)
		}
	}
	in, msg := c.parseUserRow(map[string]string{"usuario": "Pedro", "rol": "Administrador", "correo": "Pedro@X.cl"})
	if msg != "" || in.username != "pedro" || in.role != "admin" || in.email != "pedro@x.cl" {
		t.Errorf("fila buena: %+v, %q", in, msg)
	}
}

func TestWindowTarget_SoloLosDestinosEncendidos(t *testing.T) {
	c := windowCatalog{targets: map[string]lookup[uuid.UUID]{"cliente": newLookup[uuid.UUID](), "area": newLookup[uuid.UUID]()}}
	id := uuid.New()
	c.targets["cliente"].add("MUNDO", id)
	if got, msg := c.target("Cliente: mundo"); msg != "" || got.id != id || got.kind != "cliente" {
		t.Errorf("cliente = %+v, %q", got, msg)
	}
	_, msg := c.target("servicio:FW")
	if _, offered, _ := strings.Cut(msg, "empieza con "); offered != "cliente:, area:" {
		t.Errorf("sin SOC, servicio no se ofrece: %q", msg)
	}
}
