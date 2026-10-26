package complements

import (
	"archive/zip"
	"bytes"
	"slices"
	"strings"
	"testing"
	"time"
)

const fullManifest = `{
  "version": "1.3.0",
  "pages": [{"id": "incidentes", "module": "reports", "title": "Incidentes por cliente", "path": "index.html"},
            {"id": "enlaces", "module": "admin", "title": "Enlaces"}],
  "panels": [{"id": "reputacion", "target": "ticket", "title": "Reputación", "path": "panel.html?modo=ticket"}],
  "actions": [{"id": "buscar", "target": "entry", "title": "Buscar en VirusTotal"}],
  "topbar": {"path": "barra.html"},
  "settings": [{"key": "apiKey", "label": "Llave", "type": "secret", "required": true},
               {"key": "umbral", "label": "Umbral", "type": "number", "default": 5}],
  "events": ["escalation.incident.opened", "escalation.incident.opened"],
  "schedules": [{"name": "revisar", "every": "6h"}, {"name": "lunes", "at": "08:00", "days": ["mon"]}],
  "data": ["entries:read", "tickets:read", "entries:read"]
}`

func TestParseManifestCompleto(t *testing.T) {
	m, err := ParseManifest([]byte(fullManifest), true)
	if err != nil {
		t.Fatalf("ParseManifest: %v", err)
	}
	if len(m.Events) != 1 || len(m.Data) != 2 {
		t.Fatalf("no quitó repetidos: events=%v data=%v", m.Events, m.Data)
	}
	var keys []string
	house := map[string]bool{}
	for _, it := range m.Items() {
		keys = append(keys, it.Key)
		house[it.Key] = it.House
	}
	want := []string{"page:incidentes", "page:enlaces", "panel:reputacion", "action:buscar", "topbar", "settings",
		"event:escalation.incident.opened", "schedule:revisar", "schedule:lunes", "data:entries:read", "data:tickets:read"}
	if !slices.Equal(keys, want) {
		t.Fatalf("Items = %v, quería %v", keys, want)
	}
	if !house["topbar"] || !house["page:enlaces"] || house["page:incidentes"] {
		t.Fatalf("«de la casa» mal marcado: %v", house)
	}
}

func TestEffectiveDeLaCasa(t *testing.T) {
	m, _ := ParseManifest([]byte(fullManifest), true)
	approved := []string{"topbar", "page:enlaces", "page:incidentes", "data:tickets:read", "page:ya-no-existe"}
	eff := m.Effective(approved, false)
	if eff["topbar"] || eff["page:enlaces"] || !eff["page:incidentes"] || eff["page:ya-no-existe"] {
		t.Fatalf("sin «de la casa»: %v", eff)
	}
	eff = m.Effective(approved, true)
	if !eff["topbar"] || !eff["page:enlaces"] {
		t.Fatalf("con «de la casa»: %v", eff)
	}
	if got := m.ApprovedData(eff); !slices.Equal(got, []string{"tickets:read"}) {
		t.Fatalf("ApprovedData = %v", got)
	}
}

func TestParseManifestRechazos(t *testing.T) {
	cases := map[string]struct {
		raw    string
		server bool
		want   string
	}{
		"campo desconocido":   {`{"paginas": []}`, false, "no se puede leer"},
		"módulo inválido":     {`{"pages": [{"id": "a", "module": "bitacora", "title": "A"}]}`, false, "reports, shifts"},
		"id repetido":         {`{"panels": [{"id": "a", "target": "ticket", "title": "A"}, {"id": "a", "target": "entry", "title": "B"}]}`, false, "id propio"},
		"ruta que sale":       {`{"pages": [{"id": "a", "module": "reports", "title": "A", "path": "../x.html"}]}`, false, "no puede salir"},
		"ruta absoluta":       {`{"topbar": {"path": "/barra.html"}}`, false, "relativa"},
		"acción en cliente":   {`{"actions": [{"id": "a", "target": "client", "title": "A"}]}`, false, "entry o ticket"},
		"eventos en ZIP":      {`{"events": ["entry.created"]}`, false, "necesita un servicio"},
		"evento desconocido":  {`{"events": ["user.login"]}`, true, "evento desconocido"},
		"permiso desconocido": {`{"data": ["users:read"]}`, false, "permiso de datos desconocido"},
		"cada muy seguido":    {`{"schedules": [{"name": "a", "every": "1m"}]}`, true, "5 minutos"},
		"hora inválida":       {`{"schedules": [{"name": "a", "at": "25:00"}]}`, true, "HH:MM"},
		"las dos formas":      {`{"schedules": [{"name": "a", "every": "1h", "at": "08:00"}]}`, true, "no los dos"},
		"secreto con defecto": {`{"settings": [{"key": "k", "label": "K", "type": "secret", "default": "x"}]}`, false, "valor por defecto"},
		"select sin opciones": {`{"settings": [{"key": "k", "label": "K", "type": "select"}]}`, false, "opciones"},
	}
	for name, c := range cases {
		_, err := ParseManifest([]byte(c.raw), c.server)
		if err == nil || !IsInvalid(err) || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, quería que dijera %q", name, err, c.want)
		}
	}
}

func TestNextRun(t *testing.T) {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin zona horaria America/Santiago")
	}
	// Miércoles 28 de octubre de 2026, 10:00 en Chile.
	from := time.Date(2026, 10, 28, 10, 0, 0, 0, loc)
	next, err := NextRun(Schedule{Name: "a", Every: "6h"}, from, loc)
	if err != nil || !next.Equal(from.Add(6*time.Hour)) {
		t.Fatalf("every: %v %v", next, err)
	}
	next, err = NextRun(Schedule{Name: "a", Every: "1d"}, from, loc)
	if err != nil || !next.Equal(from.Add(24*time.Hour)) {
		t.Fatalf("1d: %v %v", next, err)
	}
	next, _ = NextRun(Schedule{Name: "a", At: "08:00", Days: []string{"mon"}}, from, loc)
	if want := time.Date(2026, 11, 2, 8, 0, 0, 0, loc); !next.Equal(want) {
		t.Fatalf("lunes 08:00 = %v, quería %v", next, want)
	}
	next, _ = NextRun(Schedule{Name: "a", At: "11:30"}, from, loc)
	if want := time.Date(2026, 10, 28, 11, 30, 0, 0, loc); !next.Equal(want) {
		t.Fatalf("hoy 11:30 = %v, quería %v", next, want)
	}
	next, _ = NextRun(Schedule{Name: "a", At: "09:00"}, from, loc)
	if want := time.Date(2026, 10, 29, 9, 0, 0, 0, loc); !next.Equal(want) {
		t.Fatalf("mañana 09:00 = %v, quería %v", next, want)
	}
}

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAnalyzeConManifest(t *testing.T) {
	ok := zipOf(t, map[string]string{
		"informe/index.html":      "<title>Informe</title>",
		"informe/complement.json": `{"version": "1.0.0", "pages": [{"id": "inc", "module": "reports", "title": "Incidentes", "path": "index.html"}], "data": ["entries:read"]}`,
	})
	a, _, err := Analyze("informe.zip", ok)
	if err != nil || !a.Publishable || a.Manifest == nil || a.Manifest.Version != "1.0.0" {
		t.Fatalf("Analyze: %+v %v", a, err)
	}

	missing := zipOf(t, map[string]string{
		"index.html":      "<title>x</title>",
		"complement.json": `{"panels": [{"id": "p", "target": "ticket", "title": "P", "path": "panel.html"}]}`,
	})
	a, _, err = Analyze("x.zip", missing)
	if err != nil || a.Publishable || !strings.Contains(a.Reason, "panel.html") {
		t.Fatalf("debía rechazar la ruta que no viene: %+v %v", a, err)
	}

	events := zipOf(t, map[string]string{
		"index.html":      "<title>x</title>",
		"complement.json": `{"events": ["entry.created"]}`,
	})
	a, _, _ = Analyze("x.zip", events)
	if a.Publishable || !strings.Contains(a.Reason, "servicio") {
		t.Fatalf("un ZIP no recibe eventos: %+v", a)
	}
}
