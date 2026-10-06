package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/clientalerts"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Avisos por cliente (clientEscalationRules de tipo special_alert del legacy,
// canvas v19/v20): Administración → Avisos por cliente los configura y
// Reportes los muestra antes de enviar; si lo piden, hay que confirmar "Leí el
// aviso" (queda auditado), una vez por día o por vigencia.

func clientAlertFromActive(r db.ListActiveClientAlertRulesRow) db.ClientAlertRule {
	return db.ClientAlertRule{ID: r.ID, OrganizationID: r.OrganizationID, Name: r.Name, Enabled: r.Enabled, Contexts: r.Contexts, Timezone: r.Timezone,
		Priority: r.Priority, ValidFrom: r.ValidFrom, ValidTo: r.ValidTo, HolidayDates: r.HolidayDates, TimeWindows: r.TimeWindows, Channels: r.Channels,
		Message: r.Message, RequiresAck: r.RequiresAck, UpdatedBy: r.UpdatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func ruleWindows(raw []byte) []clientalerts.Window {
	var w []clientalerts.Window
	_ = json.Unmarshal(raw, &w)
	return w
}

func evaluateRule(r db.ClientAlertRule, now time.Time) (bool, string) {
	rule := clientalerts.Rule{ID: r.ID.String(), Timezone: r.Timezone, Windows: ruleWindows(r.TimeWindows)}
	if r.ValidFrom.Valid {
		rule.ValidFrom = &r.ValidFrom.Time
	}
	if r.ValidTo.Valid {
		rule.ValidTo = &r.ValidTo.Time
	}
	for _, d := range r.HolidayDates {
		if d.Valid {
			rule.HolidayDates = append(rule.HolidayDates, d.Time.Format("2006-01-02"))
		}
	}
	return clientalerts.Evaluate(rule, now)
}

type clientAlertDTO struct {
	ID               uuid.UUID             `json:"id"`
	OrganizationID   uuid.UUID             `json:"organizationId"`
	OrganizationName string                `json:"organizationName,omitempty"`
	Name             string                `json:"name"`
	Enabled          bool                  `json:"enabled"`
	Contexts         []string              `json:"contexts"`
	Timezone         string                `json:"timezone"`
	Priority         int32                 `json:"priority"`
	ValidFrom        *time.Time            `json:"validFrom,omitempty"`
	ValidTo          *time.Time            `json:"validTo,omitempty"`
	HolidayDates     []string              `json:"holidayDates"`
	Windows          []clientalerts.Window `json:"windows"`
	Channels         []string              `json:"channels"`
	Message          string                `json:"message"`
	RequiresAck      bool                  `json:"requiresAck"`
	// Solo en /active: si aplica ahora y si esta persona ya lo confirmó.
	Acked bool `json:"acked,omitempty"`
}

func toClientAlertDTO(r db.ClientAlertRule, orgName string) clientAlertDTO {
	dto := clientAlertDTO{ID: r.ID, OrganizationID: r.OrganizationID, OrganizationName: orgName, Name: r.Name, Enabled: r.Enabled,
		Contexts: nonNilStrings(r.Contexts), Timezone: r.Timezone, Priority: r.Priority, HolidayDates: []string{}, Windows: ruleWindows(r.TimeWindows),
		Channels: nonNilStrings(r.Channels), Message: r.Message, RequiresAck: r.RequiresAck}
	if r.ValidFrom.Valid {
		dto.ValidFrom = &r.ValidFrom.Time
	}
	if r.ValidTo.Valid {
		dto.ValidTo = &r.ValidTo.Time
	}
	for _, d := range r.HolidayDates {
		if d.Valid {
			dto.HolidayDates = append(dto.HolidayDates, d.Time.Format("2006-01-02"))
		}
	}
	if dto.Windows == nil {
		dto.Windows = []clientalerts.Window{}
	}
	return dto
}

// ListClientAlerts es GET /api/client-alerts?organizationId= (admin).
func (h *ReportsHandler) ListClientAlerts(w http.ResponseWriter, r *http.Request) {
	org, err := queryUUID(r.URL.Query().Get("organizationId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
		return
	}
	rows, err := h.Queries.ListClientAlertRules(r.Context(), org)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los avisos")
		return
	}
	out := make([]clientAlertDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toClientAlertDTO(db.ClientAlertRule{ID: row.ID, OrganizationID: row.OrganizationID, Name: row.Name, Enabled: row.Enabled,
			Contexts: row.Contexts, Timezone: row.Timezone, Priority: row.Priority, ValidFrom: row.ValidFrom, ValidTo: row.ValidTo, HolidayDates: row.HolidayDates,
			TimeWindows: row.TimeWindows, Channels: row.Channels, Message: row.Message, RequiresAck: row.RequiresAck}, row.OrganizationName))
	}
	writeData(w, http.StatusOK, out)
}

// ActiveClientAlerts es GET /api/client-alerts/active?organizationId=&context=report:
// los avisos que aplican ahora, para mostrarlos antes de enviar o copiar.
func (h *ReportsHandler) ActiveClientAlerts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	org, err := uuid.Parse(r.URL.Query().Get("organizationId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
		return
	}
	context := r.URL.Query().Get("context")
	if context != "copy-report" {
		context = "report"
	}
	rows, err := h.Queries.ListActiveClientAlertRules(ctx, org)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los avisos")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	out := []clientAlertDTO{}
	for _, row := range rows {
		rule := clientAlertFromActive(row)
		matched, key := evaluateRule(rule, h.now())
		if !matched || !containsString(rule.Contexts, context) {
			continue
		}
		dto := toClientAlertDTO(rule, row.OrganizationName)
		if rule.RequiresAck {
			dto.Acked, _ = h.Queries.HasClientAlertAck(ctx, db.HasClientAlertAckParams{RuleID: rule.ID, UserID: user.ID, OccurrenceKey: key, Context: context})
		}
		out = append(out, dto)
	}
	writeData(w, http.StatusOK, out)
}

// AckClientAlert es POST /api/client-alerts/{id}/ack {context}: "Leí el aviso".
func (h *ReportsHandler) AckClientAlert(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return
	}
	var req struct {
		Context string `json:"context"`
	}
	_ = decodeJSON(w, r, &req)
	if req.Context != "copy-report" {
		req.Context = "report"
	}
	rule, err := h.Queries.GetClientAlertRule(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return
	}
	matched, key := evaluateRule(rule, h.now())
	if !matched {
		problemdetails.Write(w, r, http.StatusConflict, "alert-not-active", "este aviso no aplica en este momento")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	if err := h.Queries.AckClientAlert(ctx, db.AckClientAlertParams{RuleID: id, UserID: user.ID, OccurrenceKey: key, Context: req.Context}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo registrar la confirmación")
		return
	}
	h.AuditLog.Log(ctx, "client_alert.acknowledged", audit.LevelInfo, audit.Success(), map[string]any{
		"ruleId": id.String(), "organizationId": rule.OrganizationID.String(), "context": req.Context, "occurrence": key,
	})
	w.WriteHeader(http.StatusNoContent)
}

type clientAlertRequest struct {
	OrganizationID uuid.UUID             `json:"organizationId"`
	Name           string                `json:"name"`
	Enabled        *bool                 `json:"enabled"`
	Contexts       []string              `json:"contexts"`
	Timezone       string                `json:"timezone"`
	Priority       *int32                `json:"priority"`
	ValidFrom      *time.Time            `json:"validFrom"`
	ValidTo        *time.Time            `json:"validTo"`
	HolidayDates   []string              `json:"holidayDates"`
	Windows        []clientalerts.Window `json:"windows"`
	Channels       []string              `json:"channels"`
	Message        string                `json:"message"`
	RequiresAck    *bool                 `json:"requiresAck"`
}

// validate normaliza la regla como parseRulePayload del legacy.
func (req *clientAlertRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	req.Message = strings.TrimSpace(req.Message)
	if req.OrganizationID == uuid.Nil {
		return "elige el cliente"
	}
	if req.Message == "" || len([]rune(req.Message)) > 8000 {
		return "el mensaje no puede quedar vacío (hasta 8000 caracteres)"
	}
	var ctxs []string
	for _, c := range req.Contexts {
		if (c == "report" || c == "copy-report") && !containsString(ctxs, c) {
			ctxs = append(ctxs, c)
		}
	}
	if len(ctxs) == 0 {
		ctxs = []string{"report", "copy-report"}
	}
	req.Contexts = ctxs
	if req.Timezone == "" {
		req.Timezone = "America/Santiago"
	}
	if _, err := time.LoadLocation(req.Timezone); err != nil {
		return "zona horaria desconocida"
	}
	if len(req.Windows) == 0 {
		req.Windows = []clientalerts.Window{{Mode: clientalerts.ModeAlways, StartTime: "09:00", EndTime: "17:00", DaysOfWeek: []int{}}}
	}
	for i, w := range req.Windows {
		if !clientalerts.ValidModes[w.Mode] {
			return "modo de ventana desconocido: " + w.Mode
		}
		if w.StartTime == "" {
			req.Windows[i].StartTime = "09:00"
		}
		if w.EndTime == "" {
			req.Windows[i].EndTime = "17:00"
		}
		if !clientalerts.ValidTime(req.Windows[i].StartTime) || !clientalerts.ValidTime(req.Windows[i].EndTime) {
			return "las horas van como HH:MM"
		}
		if w.DaysOfWeek == nil {
			req.Windows[i].DaysOfWeek = []int{}
		}
		for _, d := range req.Windows[i].DaysOfWeek {
			if d < 0 || d > 6 {
				return "los días van de 0 (domingo) a 6 (sábado)"
			}
		}
	}
	if req.ValidFrom != nil && req.ValidTo != nil && req.ValidTo.Before(*req.ValidFrom) {
		return "la vigencia termina antes de empezar"
	}
	return ""
}

func (req clientAlertRequest) params() (db.CreateClientAlertRuleParams, string) {
	windows, _ := json.Marshal(req.Windows)
	var holidays []pgtype.Date
	for _, d := range req.HolidayDates {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(d))
		if err != nil {
			return db.CreateClientAlertRuleParams{}, "los feriados van como AAAA-MM-DD"
		}
		holidays = append(holidays, pgtype.Date{Time: t, Valid: true})
	}
	if holidays == nil {
		holidays = []pgtype.Date{}
	}
	enabled, ack, priority := true, true, int32(100)
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.RequiresAck != nil {
		ack = *req.RequiresAck
	}
	if req.Priority != nil {
		priority = *req.Priority
	}
	p := db.CreateClientAlertRuleParams{OrganizationID: req.OrganizationID, Name: req.Name, Enabled: enabled, Contexts: req.Contexts, Timezone: req.Timezone,
		Priority: priority, HolidayDates: holidays, TimeWindows: windows, Channels: nonNilStrings(req.Channels), Message: req.Message, RequiresAck: ack}
	if req.ValidFrom != nil {
		p.ValidFrom = pgtype.Timestamptz{Time: *req.ValidFrom, Valid: true}
	}
	if req.ValidTo != nil {
		p.ValidTo = pgtype.Timestamptz{Time: *req.ValidTo, Valid: true}
	}
	return p, ""
}

// CreateClientAlert es POST /api/client-alerts (admin).
func (h *ReportsHandler) CreateClientAlert(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req clientAlertRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	p, msg := req.params()
	if msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	p.UpdatedBy = pgtype.UUID{Bytes: user.ID, Valid: true}
	rule, err := h.Queries.CreateClientAlertRule(ctx, p)
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el cliente no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el aviso")
		return
	}
	h.AuditLog.Log(ctx, "client_alert.created", audit.LevelInfo, audit.Success(), map[string]any{"ruleId": rule.ID.String(), "organizationId": rule.OrganizationID.String()})
	writeData(w, http.StatusCreated, toClientAlertDTO(rule, ""))
}

// UpdateClientAlert es PUT /api/client-alerts/{id} (admin): la regla completa.
func (h *ReportsHandler) UpdateClientAlert(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return
	}
	var req clientAlertRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.validate(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	p, msg := req.params()
	if msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	rule, err := h.Queries.UpdateClientAlertRule(ctx, db.UpdateClientAlertRuleParams{ID: id, OrganizationID: p.OrganizationID, Name: p.Name, Enabled: p.Enabled,
		Contexts: p.Contexts, Timezone: p.Timezone, Priority: p.Priority, ValidFrom: p.ValidFrom, ValidTo: p.ValidTo, HolidayDates: p.HolidayDates,
		TimeWindows: p.TimeWindows, Channels: p.Channels, Message: p.Message, RequiresAck: p.RequiresAck, UpdatedBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el aviso")
		return
	}
	h.AuditLog.Log(ctx, "client_alert.updated", audit.LevelInfo, audit.Success(), map[string]any{"ruleId": id.String(), "enabled": rule.Enabled})
	writeData(w, http.StatusOK, toClientAlertDTO(rule, ""))
}

// DeleteClientAlert es DELETE /api/client-alerts/{id} (admin).
func (h *ReportsHandler) DeleteClientAlert(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return
	}
	n, err := h.Queries.DeleteClientAlertRule(r.Context(), id)
	if err != nil || n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return
	}
	h.AuditLog.Log(r.Context(), "client_alert.deleted", audit.LevelWarn, audit.Success(), map[string]any{"ruleId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}
