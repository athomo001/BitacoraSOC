// Package mailtpl tiene los correos con el formato del legacy, que es el
// estándar del área (decisión del dueño 2026-10-03: "así no lo cambiamos").
// Cada plantilla se compiló desde el MJML del legacy con directivas de Go en
// lugar de los datos; las pruebas comparan la salida contra el HTML que
// genera el propio legacy (testdata/), byte a byte.
package mailtpl

import (
	"bytes"
	_ "embed"
	"fmt"
	"regexp"
	"strings"
	"text/template"
	"time"
)

// Palette es una paleta del correo de incidente (PALETTES en
// backend/src/templates/email/incidentReport.js del legacy).
type Palette struct {
	PageBg, HeaderBg, CardBg, CardAccent, EvidenceLabelBg, SoftLine, HeaderText, BodyText, MutedText, InfoDanger, White string
}

// DefaultPalette es la de producción y la que usa el legacy si la clave no existe.
const DefaultPalette = "cdc-verde"

// Palettes en el mismo orden que el legacy.
var PaletteKeys = []string{"cdc-verde", "noche-azul", "slate-pro", "carbon", "indigo", "bosque"}

var Palettes = map[string]Palette{
	"cdc-verde":  {PageBg: "#173831", HeaderBg: "#155F50", CardBg: "#F8FAE1", CardAccent: "#EEF3C8", EvidenceLabelBg: "#9BCB93", SoftLine: "#D7DEC0", HeaderText: "#F8FAE1", BodyText: "#173831", MutedText: "#5B695D", InfoDanger: "#C3382B", White: "#FFFFFF"},
	"noche-azul": {PageBg: "#0D1B2A", HeaderBg: "#1B3A5C", CardBg: "#EFF4FB", CardAccent: "#D6E4F5", EvidenceLabelBg: "#7EB2E0", SoftLine: "#BDD2EC", HeaderText: "#EFF4FB", BodyText: "#0D1B2A", MutedText: "#4A6580", InfoDanger: "#C3382B", White: "#FFFFFF"},
	"slate-pro":  {PageBg: "#1C2333", HeaderBg: "#2E3D56", CardBg: "#F5F6FA", CardAccent: "#E2E6F0", EvidenceLabelBg: "#8DA5C4", SoftLine: "#CBD3E2", HeaderText: "#F5F6FA", BodyText: "#1C2333", MutedText: "#5A6A82", InfoDanger: "#C3382B", White: "#FFFFFF"},
	"carbon":     {PageBg: "#1A1A1A", HeaderBg: "#2D2D2D", CardBg: "#F7F7F7", CardAccent: "#EBEBEB", EvidenceLabelBg: "#AAAAAA", SoftLine: "#D5D5D5", HeaderText: "#F7F7F7", BodyText: "#1A1A1A", MutedText: "#666666", InfoDanger: "#C3382B", White: "#FFFFFF"},
	"indigo":     {PageBg: "#1A1240", HeaderBg: "#2D2080", CardBg: "#F4F3FF", CardAccent: "#E2DFF8", EvidenceLabelBg: "#9B93E0", SoftLine: "#CCC9EF", HeaderText: "#F4F3FF", BodyText: "#1A1240", MutedText: "#5C5590", InfoDanger: "#C3382B", White: "#FFFFFF"},
	"bosque":     {PageBg: "#1B2A1E", HeaderBg: "#2D4A33", CardBg: "#F2F8F3", CardAccent: "#D8EDD9", EvidenceLabelBg: "#7DBD85", SoftLine: "#B9D9BC", HeaderText: "#F2F8F3", BodyText: "#1B2A1E", MutedText: "#4A6550", InfoDanger: "#C3382B", White: "#FFFFFF"},
}

var critColors = map[string]string{"critica": "#C0392B", "alta": "#E85D04", "media": "#E67E22", "baja": "#27AE60", "informativa": "#2980B9"}

// IncidentData son los campos del "Reporte de Detección" (reportData del legacy).
type IncidentData struct {
	CodigoTicket, Ofensa, TipoOperacion, NombreEvento, Fecha, Criticidad, MotivoEvento string
	Observaciones, Recomendacion, InformacionAdicional, OrigenConexion, Destino        string
	ReputacionOrigen, EvidenciaTexto, LogSource                                        string
}

// IncidentImage es una evidencia: Src es el cid: del adjunto al enviar, o
// un data: URI en la vista previa.
type IncidentImage struct {
	Name, Src string
}

// IncidentOptions es todo lo que necesita el correo, como buildIncidentEmail del legacy.
type IncidentOptions struct {
	Data       IncidentData
	Images     []IncidentImage
	LogoSrc    string // cid: del logo, o vacío para escribir el nombre de la marca
	Autor      string
	BrandName  string
	PaletteKey string
	// Location para la fecha (el legacy usa la zona del servidor, America/Santiago).
	Location *time.Location
}

//go:embed templates/incident.html
var incidentSource string

var incidentTemplate = template.Must(template.New("incident").Parse(incidentSource))

type incidentField struct {
	Label, Value, Border string
	Last                 bool
}

type incidentImageView struct {
	Src, Alt string
	Last     bool
}

// RenderIncident arma el HTML del "Reporte de Detección" igual que el legacy.
func RenderIncident(o IncidentOptions) (string, error) {
	p, ok := Palettes[o.PaletteKey]
	if !ok {
		p = Palettes[DefaultPalette]
	}
	d := o.Data
	crit := strings.ToLower(orDefault(d.Criticidad, "media"))
	critColor, ok := critColors[crit]
	if !ok {
		critColor = "#E67E22"
	}
	type def struct {
		label, value string
		show         bool
	}
	defs := []def{
		{"Ofensa", d.Ofensa, true},
		{"Tipo de operación", d.TipoOperacion, true},
		{"Nombre de Ofensa/Evento", d.NombreEvento, true},
		{"Motivo", d.MotivoEvento, d.MotivoEvento != ""},
		{"MRSC (Criticidad)", d.Criticidad, d.Criticidad != ""},
		{"Origen de conexión", d.OrigenConexion, d.OrigenConexion != ""},
		{"Destino", d.Destino, d.Destino != ""},
		{"Fuente / Log Source", d.LogSource, d.LogSource != ""},
		{"Reputación de origen", d.ReputacionOrigen, d.ReputacionOrigen != ""},
	}
	var fields []incidentField
	for _, f := range defs {
		if f.show {
			fields = append(fields, incidentField{Label: Escape(f.label), Value: Escape(f.value)})
		}
	}
	for i := range fields {
		fields[i].Border = "1px solid " + p.SoftLine
		if i == len(fields)-1 {
			fields[i].Border, fields[i].Last = "none", true
		}
	}
	images := make([]incidentImageView, 0, len(o.Images))
	for i, img := range o.Images {
		alt := img.Name
		if alt == "" {
			alt = fmt.Sprintf("evidencia-%d", i+1)
		}
		images = append(images, incidentImageView{Src: img.Src, Alt: Escape(alt), Last: i == len(o.Images)-1})
	}
	evidenceText := strings.TrimSpace(d.EvidenciaTexto) != ""
	data := map[string]any{
		"P":                    p,
		"LogoSrc":              o.LogoSrc,
		"BrandName":            Escape(o.BrandName),
		"Autor":                Escape(o.Autor),
		"CritColor":            critColor,
		"CritLabel":            Escape(strings.ToUpper(orDefault(d.Criticidad, "MEDIA"))),
		"NombreEvento":         Escape(orDefault(d.NombreEvento, "-")),
		"CodigoTicket":         Escape(orDefault(d.CodigoTicket, "-")),
		"Ofensa":               Escape(orDefault(d.Ofensa, "-")),
		"Fecha":                legacyDate(d.Fecha, o.Location),
		"Fields":               fields,
		"Observaciones":        multiline(d.Observaciones, d.Observaciones != ""),
		"Recomendacion":        multiline(d.Recomendacion, strings.TrimSpace(d.Recomendacion) != ""),
		"EvidenciaTexto":       multiline(d.EvidenciaTexto, evidenceText),
		"Images":               images,
		"HasEvidence":          evidenceText || len(o.Images) > 0,
		"InformacionAdicional": multiline(d.InformacionAdicional, strings.TrimSpace(d.InformacionAdicional) != ""),
	}
	var out bytes.Buffer
	if err := incidentTemplate.Execute(&out, data); err != nil {
		return "", err
	}
	return outlookConditionals.ReplaceAllString(out.String(), ""), nil
}

// Escape es e() del legacy: escapa & < > " (no el apóstrofo). Las plantillas
// usan text/template y reciben todo ya escapado así, para que el HTML sea
// idéntico al del legacy.
func Escape(v string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(v)
}

// multiline: e(v).replace(/\n/g, '<br/>') si show, si no vacío (bloque oculto).
// panelBr es el <br/> del legacy después de que MJML pasa los estilos a
// línea: la regla ".inter-panel *" alcanza también a los saltos de línea.
const panelBr = `<br style="font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif;">`

// outlookConditionals es mergeOutlookConditionnals de mjml-core: une los
// comentarios condicionales de Outlook que quedan pegados. Con bloques
// opcionales quedan separados al compilar; se unen después de armar el
// correo, igual que hace MJML al final.
var outlookConditionals = regexp.MustCompile(`<!\[endif]-->\s*?<!--\[if mso \| IE]>`)

func multiline(v string, show bool) string {
	if !show {
		return ""
	}
	return strings.ReplaceAll(Escape(v), "\n", panelBr)
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// legacyDate es formatDate del legacy: dd-mm-aaaa (toLocaleDateString
// es-CL); vacío → "-"; algo que no es fecha → tal cual.
func legacyDate(v string, loc *time.Location) string {
	if v == "" {
		return "-"
	}
	if loc == nil {
		loc = time.Local
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"} {
		var t time.Time
		var err error
		if strings.HasSuffix(layout, "07:00") {
			t, err = time.Parse(layout, v)
		} else {
			t, err = time.ParseInLocation(layout, v, loc)
		}
		if err == nil {
			return t.In(loc).Format("02-01-2006")
		}
	}
	return v
}
