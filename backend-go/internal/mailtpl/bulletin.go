package mailtpl

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

// BulletinData son los campos del "Boletín de Seguridad" (newsletterForm del legacy).
type BulletinData struct {
	TituloBoletin, MarcaFabricante, CveIdentificadores, Criticidad string
	ProductosAfectados, Impacto, Recomendacion, Referencias        string
}

// BulletinImage es una evidencia con su tamaño real (el legacy ajusta el
// ancho según la proporción).
type BulletinImage struct {
	Src           string
	Name          string
	Width, Height int
}

// BulletinOptions es todo lo que usaba buildNewsletterHtml del legacy.
type BulletinOptions struct {
	Data        BulletinData
	Images      []BulletinImage
	LogoSrc     string
	Autor       string // nombre completo, o usuario, o el título de la app
	HeaderColor string // color del encabezado del boletín (producción: #EF5350)
}

// RenderBulletin arma el boletín igual que buildNewsletterHtml del legacy
// (report-generator.component.ts): solo tablas, para Outlook/Gmail.
// Diferencia a propósito: en "Referencias" el legacy no escapaba el texto que
// no es URL (se podía colar HTML en el correo); acá se escapa.
func RenderBulletin(o BulletinOptions) string {
	f := o.Data
	e := escapeBulletin
	header := o.HeaderColor
	const width = 800

	badgeColor, badgeText := "#FFA500", "MEDIO (CVSS 4.0 - 6.9)"
	switch strings.ToLower(e(f.Criticidad)) {
	case "baja":
		badgeColor, badgeText = "#4CAF50", "BAJO (CVSS 0.1 - 3.9)"
	case "alta":
		badgeColor, badgeText = "#f44336", "ALTO (CVSS 7.0 - 8.9)"
	case "crítica", "critica":
		badgeColor, badgeText = "#b71c1c", "CRÍTICO (CVSS 9.0 - 10.0)"
	}
	logo := ""
	if o.LogoSrc != "" {
		logo = fmt.Sprintf(`<img src="%s" height="48" width="auto" style="height: 48px; width: auto; border: 0;" alt="Logo" border="0">`, o.LogoSrc)
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<table cellpadding="0" cellspacing="0" width="%d" border="0" style="border-collapse: collapse; width: %dpx; max-width: 100%%; font-family: Arial, Helvetica, sans-serif; border: 1px solid #dddddd; background-color: #ffffff; margin: 0 auto; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
  <tr>
    <td style="padding: 20px; background-color: %s; border-bottom: 3px solid #2b2b2b;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%%" style="border-collapse: collapse;">
        <tr>
          <td width="120" valign="middle" align="left" style="padding: 0;">
            %s
          </td>
          <td valign="middle" align="center" style="padding: 0;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                <td style="padding: 0; margin: 0; font-size: 24px; font-weight: bold; color: #ffffff; font-family: Arial, Helvetica, sans-serif; text-align: center;">
                  Boletín de Seguridad
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0 0 0; font-size: 14px; color: #ffffff; font-family: Arial, Helvetica, sans-serif; text-align: center;">
                  Aviso importante preventivo
                </td>
              </tr>
            </table>
          </td>
          <td width="120" style="padding: 0;"></td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 30px 30px 20px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 15px 0; font-size: 20px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            %s
          </td>
        </tr>
        <tr>
          <td style="padding: 0 0 10px 0;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 12px; background-color: %s; color: #ffffff; font-size: 12px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                  CRITICIDAD: %s
                </td>
                <td style="padding: 0 8px 0 0;"></td>
                <td style="padding: 6px 12px; background-color: #eeeeee; color: #333333; font-size: 12px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                  MARCA: %s
                </td>
              </tr>
            </table>
          </td>
        </tr>`, width, width, header, logo, e(f.TituloBoletin), badgeColor, badgeText, e(f.MarcaFabricante))

	if strings.TrimSpace(f.CveIdentificadores) != "" {
		fmt.Fprintf(&b, `
        <tr>
          <td style="padding: 8px 0 0 0; font-size: 12px; color: #666666; font-family: Arial, Helvetica, sans-serif;">
            <strong style="font-weight: bold;">CVE/IDs:</strong><br>
            %s
          </td>
        </tr>`, formatCveList(f.CveIdentificadores))
	}

	section := func(padding, title, body string) {
		fmt.Fprintf(&b, `
  <tr>
    <td style="padding: %s; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid %s;">
            %s
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-size: 14px; line-height: 1.6; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            %s
          </td>
        </tr>
      </table>
    </td>
  </tr>`, padding, header, title, body)
	}

	b.WriteString(`
      </table>
    </td>
  </tr>`)
	section("20px 30px 10px 30px", "Producto(s) Afectado(s)", formatNewsletterText(f.ProductosAfectados))
	section("10px 30px", "Impacto", formatNewsletterText(f.Impacto))
	section("10px 30px", "Acciones Recomendadas / Mitigación", formatNewsletterText(f.Recomendacion))
	if strings.TrimSpace(f.Referencias) != "" {
		section("10px 30px", "Referencias", formatNewsletterReferences(f.Referencias))
	}

	if len(o.Images) > 0 {
		fmt.Fprintf(&b, `
  <tr>
    <td style="padding: 10px 30px 20px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid %s;">
            Evidencias
          </td>
        </tr>`, header)
		for _, img := range o.Images {
			// Panorámicas (tablas) hasta 900 px; cuadradas o verticales hasta 700.
			maxWidth := 700
			if img.Height > 0 && float64(img.Width)/float64(img.Height) > 1.4 {
				maxWidth = 900
			}
			renderWidth := min(img.Width, maxWidth)
			heightAttr := ""
			if img.Height > 0 {
				h := int(math.Max(1, math.Round(float64(img.Height)*float64(renderWidth)/float64(img.Width))))
				heightAttr = fmt.Sprintf(` height="%d"`, h)
			}
			name := img.Name
			if name == "" {
				name = "Evidencia"
			}
			fmt.Fprintf(&b, `
        <tr>
          <td align="center" style="padding: 15px 0;">
            <img src="%s" width="%d"%s style="width: %dpx; max-width: 100%%; height: auto; display: block; margin: 0 auto;" alt="%s" border="0">
          </td>
        </tr>`, img.Src, renderWidth, heightAttr, renderWidth, e(name))
		}
		b.WriteString(`
      </table>
    </td>
  </tr>`)
	}

	fmt.Fprintf(&b, `
  <tr>
    <td style="padding: 15px; text-align: center; background-color: #f1f1f1; color: #111111; font-size: 12px; font-family: Arial, Helvetica, sans-serif; border-top: 1px solid #dddddd;">
      Generado por <strong style="font-weight: bold;">%s</strong>
    </td>
  </tr>
</table>`, e(o.Autor))
	return b.String()
}

// escapeBulletin es escapeHtml del generador del legacy (este sí escapa el apóstrofo).
func escapeBulletin(v string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(v)
}

var (
	bulletLine = regexp.MustCompile(`^( {0,4})([-•*·])[ \t]+(.*)$`)
	indentLine = regexp.MustCompile(`^( {2,}|\t+)(.*)`)
	cveSplit   = regexp.MustCompile(`[,;\n\r]+`)
	urlPattern = regexp.MustCompile(`(?i)(https?://[^\s]+)`)
)

// formatNewsletterText: viñetas (- * • ·) con sangría, líneas indentadas y
// líneas vacías como <br>, igual que el legacy.
func formatNewsletterText(v string) string {
	var b strings.Builder
	for _, line := range strings.Split(v, "\n") {
		if strings.TrimSpace(line) == "" {
			b.WriteString("<br>")
			continue
		}
		if m := bulletLine.FindStringSubmatch(line); m != nil {
			fmt.Fprintf(&b, `<div style="padding-left:%dpx; text-indent:-12px; margin:1px 0;">&#8226;&nbsp;%s</div>`, 16+len(m[1])*8, escapeBulletin(m[3]))
			continue
		}
		if m := indentLine.FindStringSubmatch(line); m != nil {
			depth := min(len(strings.ReplaceAll(m[1], "\t", "    ")), 8)
			fmt.Fprintf(&b, `<div style="padding-left:%dpx; margin:1px 0;">%s</div>`, depth*6, escapeBulletin(m[2]))
			continue
		}
		fmt.Fprintf(&b, `<div style="margin:1px 0;">%s</div>`, escapeBulletin(line))
	}
	return b.String()
}

func formatCveList(v string) string {
	var parts []string
	for _, s := range cveSplit.Split(strings.TrimSpace(v), -1) {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, `<span style="font-family:monospace;">`+escapeBulletin(s)+`</span>`)
		}
	}
	return strings.Join(parts, "<br>")
}

// formatNewsletterReferences: una línea por referencia, URLs como enlaces.
func formatNewsletterReferences(v string) string {
	var b strings.Builder
	for _, line := range strings.Split(v, "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			continue
		}
		var out strings.Builder
		last := 0
		for _, loc := range urlPattern.FindAllStringIndex(t, -1) {
			out.WriteString(escapeBulletin(t[last:loc[0]]))
			url := escapeBulletin(t[loc[0]:loc[1]])
			fmt.Fprintf(&out, `<a href="%s" style="color: #1a73e8; text-decoration: underline; word-break: break-all;">%s</a>`, url, url)
			last = loc[1]
		}
		out.WriteString(escapeBulletin(t[last:]))
		fmt.Fprintf(&b, `<div style="margin: 4px 0;">%s</div>`, out.String())
	}
	return b.String()
}
