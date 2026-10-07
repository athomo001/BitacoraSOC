package legacyetl

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Reportes y Avisos por cliente (comentario del dueño #10).

// insertClientAlert pasa un special_alert del legacy a client_alert_rules,
// con sus ventanas, contextos, feriados y "Leí el aviso" tal cual.
func (m *Migrator) insertClientAlert(ctx context.Context, org uuid.UUID, name string, r legacyClientRule, from time.Time, okFrom bool, to time.Time, okTo bool) error {
	contexts := []string{}
	for _, c := range r.Contexts {
		if (c == "report" || c == "copy-report") && !containsStr(contexts, c) {
			contexts = append(contexts, c)
		}
	}
	// En el legacy "copy-report" era copiar el reporte para mandarlo desde el
	// correo propio; en la 2.0 se envía desde Reportes, así que el aviso se
	// muestra también al enviar.
	if !containsStr(contexts, "report") {
		contexts = append(contexts, "report")
	}
	tz := r.Timezone
	if _, err := time.LoadLocation(tz); tz == "" || err != nil {
		tz = "America/Santiago"
	}
	windows := "[]"
	if len(r.TimeWindows) > 0 {
		raw, err := json.Marshal(r.TimeWindows)
		if err == nil {
			windows = string(raw)
		}
	}
	holidays := []string{}
	for _, d := range r.HolidayDates {
		if len(d) >= 10 {
			holidays = append(holidays, d[:10])
		}
	}
	priority := r.Priority
	if priority <= 0 {
		priority = 100
	}
	channels := r.Channels
	if channels == nil {
		channels = []string{}
	}
	ack := r.AcknowledgementRequired == nil || *r.AcknowledgementRequired
	var vf, vt *time.Time
	if okFrom {
		vf = &from
	}
	if okTo {
		vt = &to
	}
	_, err := m.tx.Exec(ctx, `INSERT INTO client_alert_rules (id, organization_id, name, enabled, contexts, timezone, priority, valid_from, valid_to, holiday_dates, time_windows, channels, message, requires_ack, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date[],$11::jsonb,$12,$13,$14,$15)`,
		ID("clientAlertRules", r.ID), org, name, r.Enabled, contexts, tz, priority, vf, vt, holidays, windows, channels, strings.TrimSpace(r.AlertMessage), ack, m.firstAdmin)
	return err
}

func containsStr(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// migrateReportHistory trae los informes y boletines enviados (reportHistories
// del legacy, los últimos 500): tipo, título, html y quién lo envió.
func (m *Migrator) migrateReportHistory(ctx context.Context) error {
	var rows []struct {
		ID                string `json:"_id"`
		Type              string `json:"type"`
		Title             string `json:"title"`
		HTML              string `json:"html"`
		Timestamp         string `json:"timestamp"`
		CreatedBy         string `json:"createdBy"`
		CreatedByUsername string `json:"createdByUsername"`
	}
	if err := m.ex.Decode("reportHistories", &rows); err != nil {
		return err
	}
	step := newStep("historial de reportes", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	for _, r := range rows {
		kind := map[string]string{"report": "incident", "newsletter": "bulletin"}[r.Type]
		if kind == "" || strings.TrimSpace(r.HTML) == "" {
			step.skip("sin tipo o sin contenido")
			continue
		}
		var by any
		if id, ok := m.users[r.CreatedBy]; ok {
			by = id
		}
		title := strings.TrimSpace(r.Title)
		if title == "" {
			title = "(sin título)"
		}
		if _, err := m.tx.Exec(ctx, `INSERT INTO report_history (id, kind, title, subject, html, status, sent_by, sent_by_username, created_at)
			VALUES ($1,$2,$3,'',$4,'legacy',$5,$6,$7)`,
			ID("reportHistories", r.ID), kind, truncate(title, 240), r.HTML, by, r.CreatedByUsername, timeOr(r.Timestamp, time.Now())); err != nil {
			return err
		}
		step.Loaded++
	}
	return nil
}

// migrateOperationTypes trae catalogOperationTypes: nombre, texto por defecto
// de "Información adicional" y si está habilitado.
func (m *Migrator) migrateOperationTypes(ctx context.Context) error {
	var rows []struct {
		ID                   string  `json:"_id"`
		Name                 string  `json:"name"`
		InfoAdicionalDefault *string `json:"infoAdicionalDefault"`
		Enabled              *bool   `json:"enabled"`
		CreatedAt            string  `json:"createdAt"`
	}
	if err := m.ex.Decode("catalogOperationTypes", &rows); err != nil {
		return err
	}
	step := newStep("tipos de operación", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	seen := map[string]bool{}
	for _, r := range rows {
		name := strings.TrimSpace(r.Name)
		if name == "" || seen[strings.ToLower(name)] {
			step.skip("sin nombre o repetido")
			continue
		}
		seen[strings.ToLower(name)] = true
		info := ""
		if r.InfoAdicionalDefault != nil {
			info = strings.TrimSpace(*r.InfoAdicionalDefault)
		}
		enabled := r.Enabled == nil || *r.Enabled
		created := timeOr(r.CreatedAt, time.Now())
		if _, err := m.tx.Exec(ctx, `INSERT INTO report_operation_types (id, name, info_default, enabled, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)`,
			ID("catalogOperationTypes", r.ID), truncate(name, 120), info, enabled, created); err != nil {
			return err
		}
		step.Loaded++
	}
	return nil
}

// migrateReportEvents trae catalogEvents (~1.900): nombre, categoría,
// descripción y el texto por defecto de "Motivo" del informe de incidente.
// Los repetidos (mismo nombre y categoría) se cargan una vez.
func (m *Migrator) migrateReportEvents(ctx context.Context) error {
	var rows []struct {
		ID            string  `json:"_id"`
		Name          string  `json:"name"`
		Parent        *string `json:"parent"`
		Description   *string `json:"description"`
		MotivoDefault *string `json:"motivoDefault"`
		Enabled       *bool   `json:"enabled"`
		CreatedAt     string  `json:"createdAt"`
	}
	if err := m.ex.Decode("catalogEvents", &rows); err != nil {
		return err
	}
	step := newStep("eventos de reporte", len(rows))
	m.rep.Steps = append(m.rep.Steps, step)
	text := func(p *string, max int) string {
		if p == nil {
			return ""
		}
		return truncate(strings.TrimSpace(*p), max)
	}
	seen := map[string]bool{}
	for _, r := range rows {
		name := truncate(strings.TrimSpace(r.Name), 200)
		parent := text(r.Parent, 200)
		key := strings.ToLower(name + "|" + parent)
		if name == "" || seen[key] {
			step.skip("sin nombre o repetido")
			continue
		}
		seen[key] = true
		created := timeOr(r.CreatedAt, time.Now())
		if _, err := m.tx.Exec(ctx, `INSERT INTO report_events (id, name, parent, description, motivo_default, enabled, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
			ID("catalogEvents", r.ID), name, parent, text(r.Description, 1000), text(r.MotivoDefault, 500), r.Enabled == nil || *r.Enabled, created); err != nil {
			return err
		}
		step.Loaded++
	}
	return nil
}
