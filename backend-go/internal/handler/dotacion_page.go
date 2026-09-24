package handler

import (
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/rotation"
)

// Puerto directo de ../BitacoraSOC-legacy/backend/src/utils/telework-matrix.js
// (renderTeleworkWeeklyPage/renderUnavailablePage) a Go — página HTML
// autónoma, sin JS ni fuentes externas, para el enlace público de solo
// lectura de la matriz de dotación/teletrabajo (HU-4b). Adaptada al nombre
// de producto "Bitácora Ops" (memoria del proyecto) y a los emoji/colores ya
// definidos en internal/rotation.Meta — no a la paleta legacy.

const teleworkRefreshSeconds = 600

var teleworkLegendOrder = []rotation.Condition{
	rotation.ConditionTelework,
	rotation.ConditionTraining,
	rotation.ConditionGuardia,
	rotation.ConditionVacation,
	rotation.ConditionMedicalLeave,
	rotation.ConditionMedicalAppointment,
}

func shortDate(iso string) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return iso
	}
	return t.Format("02/01")
}

func renderTeleworkPage(matrix matrixDTO, generatedAt time.Time) string {
	var head strings.Builder
	for _, col := range matrix.Columns {
		class := "d-col"
		if col.IsToday {
			class += " is-today"
		}
		fmt.Fprintf(&head, `<th class="%s"><span class="d-name">%s</span><span class="d-date">%s</span></th>`,
			class, html.EscapeString(col.DayShort), html.EscapeString(shortDate(col.Date)))
	}

	var body strings.Builder
	if len(matrix.Rows) == 0 {
		fmt.Fprintf(&body, `<tr><td class="empty" colspan="%d">Sin personal fuera de la oficina esta semana</td></tr>`, len(matrix.Columns)+1)
	} else {
		for _, row := range matrix.Rows {
			hasSpecial := false
			var cells strings.Builder
			for _, day := range row.Days {
				if day.Condition == string(rotation.ConditionOffice) || day.Condition == "" {
					cells.WriteString(`<td class="cell-office"></td>`)
					continue
				}
				hasSpecial = true
				meta := rotation.Meta(rotation.Condition(day.Condition))
				fmt.Fprintf(&cells, `<td class="cell-special" style="--c:%s"><span class="marker">%s</span><span class="label">%s</span></td>`,
					meta.Color, meta.Marker, html.EscapeString(meta.Label))
			}
			rowClass := ""
			if hasSpecial {
				rowClass = "has-special"
			}
			fmt.Fprintf(&body, `<tr class="%s"><td class="cell-name"><span class="r-name">%s</span><span class="r-role">%s</span></td>%s</tr>`,
				rowClass, html.EscapeString(row.Name), html.EscapeString(row.Role), cells.String())
		}
	}

	var legend strings.Builder
	for _, cond := range teleworkLegendOrder {
		meta := rotation.Meta(cond)
		fmt.Fprintf(&legend, `<span class="leg-item"><span class="leg-dot" style="background:%s"></span>%s %s</span>`,
			meta.Color, meta.Marker, html.EscapeString(meta.Label))
	}

	weekRangeText := ""
	if n := len(matrix.Columns); n > 0 {
		weekRangeText = fmt.Sprintf("Semana del %s al %s", shortDate(matrix.Columns[0].Date), shortDate(matrix.Columns[n-1].Date))
	}
	updatedLabel := generatedAt.Format("15:04")

	return fmt.Sprintf(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="%d">
<meta name="robots" content="noindex, nofollow">
<title>Bitácora Ops · Personal en Teletrabajo y Apoyo</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px clamp(16px, 4vw, 56px);
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f1f5f9; color: #0f172a;
  }
  .wrap { max-width: 1600px; margin: 0 auto; }
  header { margin-bottom: 20px; }
  h1 { margin: 0; font-size: clamp(24px, 3vw, 40px); letter-spacing: -0.02em; }
  .subtitle { margin: 6px 0 0; font-size: clamp(15px, 1.6vw, 22px); font-weight: 600; color: #475569; }
  .bar { height: 4px; margin-top: 14px; border-radius: 3px; background: linear-gradient(90deg, #059669, #0e7490); }
  table { width: 100%%; border-collapse: collapse; table-layout: fixed; background: #fff; border: 1px solid #cbd5e1; }
  th, td { border: 1px solid #cbd5e1; padding: 14px 10px; text-align: center; vertical-align: middle; }
  thead th { background: #f8fafc; font-size: clamp(13px, 1.4vw, 18px); }
  thead th.is-today { background: #eef2ff; box-shadow: inset 0 -3px 0 #059669; }
  th:first-child, td.cell-name { width: 24%%; text-align: left; }
  .d-name { display: block; font-weight: 800; }
  .d-date { display: block; font-size: 0.8em; font-weight: 500; color: #64748b; }
  .r-name { display: block; font-weight: 700; font-size: clamp(14px, 1.5vw, 20px); }
  .r-role { display: block; font-size: clamp(11px, 1vw, 14px); color: #64748b; margin-top: 2px; }
  tr.has-special { background: #fffdf5; }
  td.cell-special {
    background: #f8fafc;
    background: color-mix(in srgb, var(--c) 12%%, #fff);
    border-bottom: 3px solid var(--c);
  }
  td.cell-special .marker { font-size: clamp(20px, 2.4vw, 34px); display: block; line-height: 1.1; }
  td.cell-special .label {
    display: block; margin-top: 4px; font-size: clamp(10px, 1vw, 13px);
    font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; color: var(--c);
  }
  td.cell-office { background: #fff; }
  td.empty { padding: 40px; font-style: italic; color: #64748b; font-size: clamp(15px, 1.6vw, 20px); }
  .legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; font-size: clamp(12px, 1.2vw, 16px); color: #334155; }
  .leg-item { display: inline-flex; align-items: center; gap: 6px; }
  .leg-dot { width: 12px; height: 12px; border-radius: 50%%; display: inline-block; }
  footer { margin-top: 18px; font-size: clamp(11px, 1.1vw, 14px); color: #64748b; }
  footer .updated { font-weight: 700; color: #334155; }
  .disclaimer { margin-top: 8px; font-style: italic; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Personal en Teletrabajo y Apoyo</h1>
      <p class="subtitle">%s</p>
      <div class="bar"></div>
    </header>

    <table>
      <thead><tr><th>Nombre</th>%s</tr></thead>
      <tbody>%s</tbody>
    </table>

    <div class="legend">%s</div>

    <footer>
      <span class="updated">Actualizado %s</span> · la pantalla se actualiza sola cada %d min.
      <div class="disclaimer">Programación de control interno, de carácter representativo y sujeta a cambios operativos durante la semana.</div>
    </footer>
  </div>
</body>
</html>`, teleworkRefreshSeconds, html.EscapeString(weekRangeText), head.String(), body.String(), legend.String(), html.EscapeString(updatedLabel), teleworkRefreshSeconds/60)
}

// renderUnavailablePage no revela si el token existe, está mal formado o
// fue desactivado — misma respuesta para los tres casos.
func renderUnavailablePage() string {
	return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Bitácora Ops</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; color: #334155; }
  .box { text-align: center; padding: 40px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: #0f172a; }
  p { margin: 0; font-size: 15px; }
</style>
</head>
<body>
  <div class="box">
    <h1>Este enlace no está disponible</h1>
    <p>Solicita un enlace vigente al administrador.</p>
  </div>
</body>
</html>`
}
