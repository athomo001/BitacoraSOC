package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ReportsHandler es Reportes (comentario del dueño #10, canvas v18–v20):
// informe de incidente y boletín de seguridad por correo, con los formatos
// del legacy (estándar del área), el aviso del cliente antes de enviar y el
// historial de envíos. Portado de routes/reports.js del legacy.
type ReportsHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
	Sender   func(context.Context) (*mail.Sender, error)
	Now      func() time.Time
}

func (h *ReportsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

const (
	maxEvidence      = 10
	maxEvidenceBytes = 6 << 20
	logoCID          = "bitacora-logo@bitacora"
)

type reportImage struct {
	Name        string `json:"name"`
	ContentType string `json:"contentType"`
	Base64      string `json:"base64"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	data        []byte
}

type reportRequest struct {
	OrganizationID *uuid.UUID      `json:"organizationId"`
	ServiceID      *uuid.UUID      `json:"serviceId"`
	Incident       json.RawMessage `json:"incident"`
	Bulletin       json.RawMessage `json:"bulletin"`
	Images         []reportImage   `json:"images"`
	To             []string        `json:"to"`
	Cc             []string        `json:"cc"`
	Subject        string          `json:"subject"`
	// Greeting: "Mensaje para el destinatario", va arriba del reporte.
	Greeting string `json:"greeting"`
	// GroupByDomain: el boletín sale en un correo por dominio (por defecto sí).
	GroupByDomain *bool `json:"groupByDomain"`
}

// Campos del formulario de incidente del legacy (reportForm).
type incidentForm struct {
	CodigoTicket         string `json:"codigoTicket"`
	Ofensa               string `json:"ofensa"`
	TipoOperacion        string `json:"tipoOperacion"`
	NombreEvento         string `json:"nombreEvento"`
	Fecha                string `json:"fecha"`
	Criticidad           string `json:"criticidad"`
	MotivoEvento         string `json:"motivoEvento"`
	Observaciones        string `json:"observaciones"`
	Recomendacion        string `json:"recomendacion"`
	InformacionAdicional string `json:"informacionAdicional"`
	OrigenConexion       string `json:"origenConexion"`
	Destino              string `json:"destino"`
	ReputacionOrigen     string `json:"reputacionOrigen"`
	EvidenciaTexto       string `json:"evidenciaTexto"`
	LogSource            string `json:"logSource"`
}

// Campos del boletín del legacy (newsletterForm).
type bulletinForm struct {
	TituloBoletin      string `json:"tituloBoletin"`
	MarcaFabricante    string `json:"marcaFabricante"`
	CveIdentificadores string `json:"cveIdentificadores"`
	Criticidad         string `json:"criticidad"`
	ProductosAfectados string `json:"productosAfectados"`
	Impacto            string `json:"impacto"`
	Recomendacion      string `json:"recomendacion"`
	Referencias        string `json:"referencias"`
}

func (h *ReportsHandler) decode(w http.ResponseWriter, r *http.Request) (reportRequest, bool) {
	var req reportRequest
	r.Body = http.MaxBytesReader(w, r.Body, 80<<20)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido (o demasiado grande)")
		return req, false
	}
	if len(req.Images) > maxEvidence {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "hasta 10 evidencias por reporte")
		return req, false
	}
	for i := range req.Images {
		raw, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(req.Images[i].Base64), ""))
		if err != nil || len(raw) == 0 || len(raw) > maxEvidenceBytes {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "una evidencia no es una imagen válida (máximo 6 MB)")
			return req, false
		}
		mime := http.DetectContentType(raw)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" && mime != "image/webp" {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "las evidencias van en png, jpg, gif o webp")
			return req, false
		}
		req.Images[i].data, req.Images[i].ContentType = raw, mime
		if strings.TrimSpace(req.Images[i].Name) == "" {
			req.Images[i].Name = fmt.Sprintf("evidencia-%d", i+1)
		}
	}
	return req, true
}

func dataURI(mime string, data []byte) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// insertGreeting pone el "Mensaje para el destinatario" arriba del reporte
// (el bloque del reporte no cambia: formato estándar del área).
func insertGreeting(report, greeting string) string {
	greeting = strings.TrimSpace(greeting)
	if greeting == "" {
		return report
	}
	block := `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #222222; margin: 0; padding: 16px 20px;">` +
		strings.ReplaceAll(html.EscapeString(greeting), "\n", "<br>") + `</div>`
	if i := strings.Index(strings.ToLower(report), "<body"); i >= 0 {
		if j := strings.Index(report[i:], ">"); j >= 0 {
			at := i + j + 1
			return report[:at] + block + report[at:]
		}
	}
	return block + report
}

// renderedReport es un reporte listo: para enviar (cid:) y para ver (data:).
type renderedReport struct {
	title, sendHTML, viewHTML string
	inline                    []mail.Inline
	payload                   []byte
}

func (h *ReportsHandler) author(ctx context.Context, appTitle string) string {
	user, _ := middleware.UserFromContext(ctx)
	if u, err := h.Queries.GetUserByID(ctx, user.ID); err == nil && strings.TrimSpace(u.FullName.String) != "" {
		return strings.TrimSpace(u.FullName.String)
	}
	if user.Username != "" {
		return user.Username
	}
	return appTitle
}

func (h *ReportsHandler) renderIncident(ctx context.Context, req reportRequest) (renderedReport, error) {
	var f incidentForm
	if len(req.Incident) == 0 || json.Unmarshal(req.Incident, &f) != nil {
		return renderedReport{}, errReport{"faltan los campos del informe de incidente"}
	}
	brand := branding.Load(ctx, h.Queries, true)
	data := mailtpl.IncidentData{
		CodigoTicket: f.CodigoTicket, Ofensa: f.Ofensa, TipoOperacion: f.TipoOperacion, NombreEvento: f.NombreEvento, Fecha: f.Fecha,
		Criticidad: f.Criticidad, MotivoEvento: f.MotivoEvento, Observaciones: f.Observaciones, Recomendacion: f.Recomendacion,
		InformacionAdicional: f.InformacionAdicional, OrigenConexion: f.OrigenConexion, Destino: f.Destino,
		ReputacionOrigen: f.ReputacionOrigen, EvidenciaTexto: f.EvidenciaTexto, LogSource: f.LogSource,
	}
	loc, _ := time.LoadLocation("America/Santiago")
	base := mailtpl.IncidentOptions{Data: data, Autor: h.author(ctx, brand.AppTitle), BrandName: brand.AppTitle, PaletteKey: brand.IncidentPalette, Location: loc}
	var inline []mail.Inline
	send, view := base, base
	if len(brand.Logo) > 0 {
		logo, mime := branding.OutlinedLogo(brand.Logo, brand.LogoType)
		send.LogoSrc, view.LogoSrc = "cid:"+logoCID, dataURI(mime, logo)
		inline = append(inline, mail.Inline{CID: logoCID, Name: "logo-email.png", ContentType: mime, Data: logo})
	}
	for i, img := range req.Images {
		cid := fmt.Sprintf("evidence-%d@bitacora-incident", i+1)
		send.Images = append(send.Images, mailtpl.IncidentImage{Name: img.Name, Src: "cid:" + cid})
		view.Images = append(view.Images, mailtpl.IncidentImage{Name: img.Name, Src: dataURI(img.ContentType, img.data)})
		inline = append(inline, mail.Inline{CID: cid, Name: img.Name, ContentType: img.ContentType, Data: img.data})
	}
	sendHTML, err := mailtpl.RenderIncident(send)
	if err != nil {
		return renderedReport{}, err
	}
	viewHTML, err := mailtpl.RenderIncident(view)
	if err != nil {
		return renderedReport{}, err
	}
	title := strings.TrimSpace(f.NombreEvento)
	if title == "" {
		title = strings.TrimSpace(f.Ofensa)
	}
	if title == "" {
		title = "Informe de incidente"
	}
	payload, _ := json.Marshal(map[string]any{"incident": f})
	return renderedReport{title: title, sendHTML: insertGreeting(sendHTML, req.Greeting), viewHTML: insertGreeting(viewHTML, req.Greeting), inline: inline, payload: payload}, nil
}

func (h *ReportsHandler) renderBulletin(ctx context.Context, req reportRequest) (renderedReport, error) {
	var f bulletinForm
	if len(req.Bulletin) == 0 || json.Unmarshal(req.Bulletin, &f) != nil {
		return renderedReport{}, errReport{"faltan los campos del boletín"}
	}
	brand := branding.Load(ctx, h.Queries, true)
	base := mailtpl.BulletinOptions{
		Data: mailtpl.BulletinData{TituloBoletin: f.TituloBoletin, MarcaFabricante: f.MarcaFabricante, CveIdentificadores: f.CveIdentificadores,
			Criticidad: f.Criticidad, ProductosAfectados: f.ProductosAfectados, Impacto: f.Impacto, Recomendacion: f.Recomendacion, Referencias: f.Referencias},
		Autor: h.author(ctx, brand.AppTitle), HeaderColor: brand.BulletinColor,
	}
	var inline []mail.Inline
	send, view := base, base
	if len(brand.Logo) > 0 {
		send.LogoSrc, view.LogoSrc = "cid:"+logoCID, dataURI(brand.LogoType, brand.Logo)
		inline = append(inline, mail.Inline{CID: logoCID, Name: "logo.png", ContentType: brand.LogoType, Data: brand.Logo})
	}
	for i, img := range req.Images {
		cid := fmt.Sprintf("bulletin-%d@bitacora", i+1)
		send.Images = append(send.Images, mailtpl.BulletinImage{Src: "cid:" + cid, Name: img.Name, Width: img.Width, Height: img.Height})
		view.Images = append(view.Images, mailtpl.BulletinImage{Src: dataURI(img.ContentType, img.data), Name: img.Name, Width: img.Width, Height: img.Height})
		inline = append(inline, mail.Inline{CID: cid, Name: img.Name, ContentType: img.ContentType, Data: img.data})
	}
	title := strings.TrimSpace(f.TituloBoletin)
	if title == "" {
		title = "Boletín de Seguridad"
	}
	payload, _ := json.Marshal(map[string]any{"bulletin": f})
	return renderedReport{title: title, sendHTML: insertGreeting(mailtpl.RenderBulletin(send), req.Greeting), viewHTML: insertGreeting(mailtpl.RenderBulletin(view), req.Greeting), inline: inline, payload: payload}, nil
}

type errReport struct{ msg string }

func (e errReport) Error() string { return e.msg }

func (h *ReportsHandler) render(ctx context.Context, kind string, req reportRequest) (renderedReport, error) {
	if kind == "bulletin" {
		return h.renderBulletin(ctx, req)
	}
	return h.renderIncident(ctx, req)
}

// Preview es POST /api/reports/{kind}/preview: el correo tal como lo verá el
// cliente (formato legacy), con las imágenes embebidas.
func (h *ReportsHandler) Preview(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != "incident" && kind != "bulletin" {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo de reporte desconocido")
		return
	}
	req, ok := h.decode(w, r)
	if !ok {
		return
	}
	rep, err := h.render(r.Context(), kind, req)
	var userErr errReport
	if errors.As(err, &userErr) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", userErr.msg)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo armar el reporte")
		return
	}
	writeData(w, http.StatusOK, map[string]string{"html": rep.viewHTML, "title": rep.title})
}

// allowedDomains es getValidSOCDomains del legacy: el dominio del remitente
// SMTP y los de los correos de usuarios y contactos. Un dominio ajeno
// bloquea el envío (evita usar el SOC de relay).
func (h *ReportsHandler) allowedDomains(ctx context.Context) map[string]bool {
	out := map[string]bool{}
	add := func(email string) {
		if at := strings.LastIndex(email, "@"); at > 0 && at < len(email)-1 {
			out[strings.ToLower(strings.TrimSpace(email[at+1:]))] = true
		}
	}
	if cfg, err := h.Queries.GetSMTPConfig(ctx); err == nil {
		add(cfg.FromAddress)
		add(cfg.Username.String)
	}
	if rows, err := h.Queries.ListEmailDomainSources(ctx); err == nil {
		for _, row := range rows {
			value := row.Value
			if row.Encrypted {
				plain, err := h.Crypto.Decrypt(value)
				if err != nil {
					continue
				}
				value = plain
			}
			add(value)
		}
	}
	return out
}

func domainOf(email string) string {
	if at := strings.LastIndex(email, "@"); at > 0 {
		return strings.ToLower(email[at+1:])
	}
	return ""
}

// cleanRecipientList deja los correos válidos sin repetir; devuelve el primero inválido.
func cleanRecipientList(in []string) ([]string, string) {
	seen := map[string]bool{}
	var out []string
	for _, raw := range in {
		e := strings.TrimSpace(raw)
		if e == "" {
			continue
		}
		if !directory.ValidEmail(e) {
			return nil, e
		}
		if seen[strings.ToLower(e)] {
			continue
		}
		seen[strings.ToLower(e)] = true
		out = append(out, e)
	}
	return out, ""
}

// pendingAlerts devuelve los avisos del cliente que piden "Leí el aviso" y
// la persona aún no confirmó hoy (o en su vigencia).
func (h *ReportsHandler) pendingAlerts(ctx context.Context, org uuid.UUID, userID uuid.UUID, context string) ([]string, error) {
	rules, err := h.Queries.ListActiveClientAlertRules(ctx, org)
	if err != nil {
		return nil, err
	}
	var pending []string
	for _, rule := range rules {
		matched, key := evaluateRule(clientAlertFromActive(rule), h.now())
		if !matched || !rule.RequiresAck || !containsString(rule.Contexts, context) {
			continue
		}
		acked, err := h.Queries.HasClientAlertAck(ctx, db.HasClientAlertAckParams{RuleID: rule.ID, UserID: userID, OccurrenceKey: key, Context: context})
		if err != nil {
			return nil, err
		}
		if !acked {
			name := rule.Name
			if name == "" {
				name = "Aviso de " + rule.OrganizationName
			}
			pending = append(pending, name)
		}
	}
	return pending, nil
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// Send es POST /api/reports/{kind}/send.
func (h *ReportsHandler) Send(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kind := r.PathValue("kind")
	if kind != "incident" && kind != "bulletin" {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "tipo de reporte desconocido")
		return
	}
	req, ok := h.decode(w, r)
	if !ok {
		return
	}
	to, bad := cleanRecipientList(req.To)
	if bad == "" && len(to) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "se requiere al menos un destinatario válido en Para")
		return
	}
	cc, bad2 := cleanRecipientList(req.Cc)
	if bad != "" || bad2 != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "correo inválido: "+bad+bad2)
		return
	}
	toSet := map[string]bool{}
	for _, e := range to {
		toSet[strings.ToLower(e)] = true
	}
	for _, e := range cc {
		if toSet[strings.ToLower(e)] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se permite repetir correos entre Para y CC: "+e)
			return
		}
	}
	if kind == "incident" && req.OrganizationID == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "elige el cliente del informe (trazabilidad)")
		return
	}
	allowed := h.allowedDomains(ctx)
	for _, e := range append(append([]string{}, to...), cc...) {
		if !allowed[domainOf(e)] {
			problemdetails.Write(w, r, http.StatusBadRequest, "recipient-not-allowed", "el dominio de "+e+" no pertenece a los destinatarios válidos del SOC")
			return
		}
	}
	user, _ := middleware.UserFromContext(ctx)
	if req.OrganizationID != nil {
		pending, err := h.pendingAlerts(ctx, *req.OrganizationID, user.ID, "report")
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron revisar los avisos del cliente")
			return
		}
		if len(pending) > 0 {
			problemdetails.Write(w, r, http.StatusConflict, "client-alert-pending", "confirma que leíste el aviso del cliente antes de enviar: "+strings.Join(pending, ", "))
			return
		}
	}
	rep, err := h.render(ctx, kind, req)
	var userErr errReport
	if errors.As(err, &userErr) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", userErr.msg)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo armar el reporte")
		return
	}
	subject := strings.TrimSpace(req.Subject)
	if subject == "" {
		subject = map[string]string{"incident": "Reporte de Incidente de Seguridad", "bulletin": "Boletín de Seguridad"}[kind]
	}
	sender, err := h.Sender(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configura el correo en Administración → Correo antes de enviar")
		return
	}
	text := htmlToText(rep.sendHTML)
	// Incidente: un correo. Boletín: uno por dominio (como el legacy), con
	// los CC que no estén en ese lote.
	batches := [][]string{to}
	if kind == "bulletin" && (req.GroupByDomain == nil || *req.GroupByDomain) {
		batches = groupByDomain(to)
	}
	var failures []string
	for _, batch := range batches {
		inBatch := map[string]bool{}
		for _, e := range batch {
			inBatch[strings.ToLower(e)] = true
		}
		var ccBatch []string
		for _, e := range cc {
			if !inBatch[strings.ToLower(e)] {
				ccBatch = append(ccBatch, e)
			}
		}
		if err := sender.SendRich(batch, ccBatch, subject, text, rep.sendHTML, rep.inline); err != nil {
			failures = append(failures, strings.Join(batch, ", ")+": "+err.Error())
		}
	}
	status := "sent"
	switch {
	case len(failures) == len(batches):
		status = "failed"
	case len(failures) > 0:
		status = "partial"
	}
	var orgID, svcID pgtype.UUID
	if req.OrganizationID != nil {
		orgID = pgtype.UUID{Bytes: *req.OrganizationID, Valid: true}
	}
	if req.ServiceID != nil {
		svcID = pgtype.UUID{Bytes: *req.ServiceID, Valid: true}
	}
	errText := strings.Join(failures, " | ")
	saved, histErr := h.Queries.InsertReportHistory(ctx, db.InsertReportHistoryParams{
		Kind: kind, Title: rep.title, Subject: subject, OrganizationID: orgID, ServiceID: svcID, Recipients: to, CcRecipients: nonNilStrings(cc),
		Html: rep.viewHTML, Payload: rep.payload, Status: status, Error: pgtype.Text{String: errText, Valid: errText != ""},
		SentBy: pgtype.UUID{Bytes: user.ID, Valid: true}, SentByUsername: user.Username,
	})
	level, result := audit.LevelInfo, audit.Success()
	if status != "sent" {
		level, result = audit.LevelWarn, audit.Failure(errText)
	}
	h.AuditLog.Log(ctx, "report."+kind+".sent", level, result, map[string]any{
		"title": rep.title, "toCount": len(to), "ccCount": len(cc), "batches": len(batches), "status": status, "images": len(req.Images),
		"organizationId": uuidString(req.OrganizationID),
	})
	if status == "failed" {
		problemdetails.Write(w, r, http.StatusBadGateway, "mail-failed", "no se pudo enviar: "+errText)
		return
	}
	resp := map[string]any{"status": status, "batches": len(batches), "failures": failures}
	if histErr == nil {
		resp["historyId"] = saved.ID
	}
	writeData(w, http.StatusOK, resp)
}

func groupByDomain(emails []string) [][]string {
	byDomain := map[string][]string{}
	var order []string
	for _, e := range emails {
		d := domainOf(e)
		if _, ok := byDomain[d]; !ok {
			order = append(order, d)
		}
		byDomain[d] = append(byDomain[d], e)
	}
	out := make([][]string, 0, len(order))
	for _, d := range order {
		out = append(out, byDomain[d])
	}
	return out
}

var (
	tagPattern   = regexp.MustCompile(`(?s)<(style|script|head)[^>]*>.*?</(style|script|head)>|<[^>]+>`)
	blankPattern = regexp.MustCompile(`[ \t]+\n|\n{3,}`)
)

// htmlToText es htmlToBasicPlainText del legacy: la versión en texto plano.
func htmlToText(s string) string {
	s = regexp.MustCompile(`(?i)<br\s*/?>|</(p|div|tr|h[1-6]|li)>`).ReplaceAllString(s, "\n")
	s = tagPattern.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	s = blankPattern.ReplaceAllStringFunc(s, func(m string) string {
		if strings.Count(m, "\n") >= 3 {
			return "\n\n"
		}
		return "\n"
	})
	return strings.TrimSpace(s)
}

// Recipients es GET /api/reports/recipients?organizationId=&serviceId=: los
// Para/CC propuestos desde el escalamiento del cliente.
func (h *ReportsHandler) Recipients(w http.ResponseWriter, r *http.Request) {
	org, err := uuid.Parse(r.URL.Query().Get("organizationId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
		return
	}
	svc, err := queryUUID(r.URL.Query().Get("serviceId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "serviceId inválido")
		return
	}
	rows, err := h.Queries.ListEscalationEmailsForOrganization(r.Context(), db.ListEscalationEmailsForOrganizationParams{OrganizationID: org, ServiceID: svc})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los destinatarios")
		return
	}
	to, cc := []string{}, []string{}
	seen := map[string]bool{}
	for _, row := range rows {
		email, err := h.Crypto.Decrypt(row.ValueEncrypted)
		if err != nil || seen[strings.ToLower(email)] {
			continue
		}
		seen[strings.ToLower(email)] = true
		if row.RecipientType == "cc" {
			cc = append(cc, email)
		} else {
			to = append(to, email)
		}
	}
	sort.Strings(to)
	sort.Strings(cc)
	writeData(w, http.StatusOK, map[string]any{"to": to, "cc": cc})
}

type reportHistoryDTO struct {
	ID               uuid.UUID  `json:"id"`
	Kind             string     `json:"kind"`
	Title            string     `json:"title"`
	Subject          string     `json:"subject"`
	OrganizationID   *uuid.UUID `json:"organizationId,omitempty"`
	OrganizationName string     `json:"organizationName,omitempty"`
	Recipients       []string   `json:"recipients"`
	Cc               []string   `json:"cc"`
	Status           string     `json:"status"`
	Error            string     `json:"error,omitempty"`
	SentBy           string     `json:"sentBy"`
	CreatedAt        time.Time  `json:"createdAt"`
	Reusable         bool       `json:"reusable"`
	HTML             string     `json:"html,omitempty"`
	Payload          any        `json:"payload,omitempty"`
}

// History es GET /api/reports/history?kind=&page=.
func (h *ReportsHandler) History(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var kind pgtype.Text
	if k := q.Get("kind"); k == "incident" || k == "bulletin" {
		kind = pgtype.Text{String: k, Valid: true}
	}
	page, _ := strconv.Atoi(q.Get("page"))
	page = max(page, 1)
	const size = 50
	rows, err := h.Queries.ListReportHistory(r.Context(), db.ListReportHistoryParams{Kind: kind, MaxRows: size, SkipRows: int32((page - 1) * size)})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el historial")
		return
	}
	total, _ := h.Queries.CountReportHistory(r.Context(), kind)
	out := make([]reportHistoryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, reportHistoryDTO{ID: row.ID, Kind: row.Kind, Title: row.Title, Subject: row.Subject, OrganizationID: uuidPtr(row.OrganizationID),
			OrganizationName: row.OrganizationName.String, Recipients: nonNilStrings(row.Recipients), Cc: nonNilStrings(row.CcRecipients), Status: row.Status,
			Error: row.Error.String, SentBy: row.SentByUsername, CreatedAt: row.CreatedAt.Time, Reusable: row.Reusable})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out, "meta": map[string]any{"page": page, "pageSize": size, "total": total}})
}

// HistoryItem es GET /api/reports/history/{id}: el correo tal como salió.
func (h *ReportsHandler) HistoryItem(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no encontrado")
		return
	}
	row, err := h.Queries.GetReportHistory(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el historial")
		return
	}
	dto := reportHistoryDTO{ID: row.ID, Kind: row.Kind, Title: row.Title, Subject: row.Subject, OrganizationID: uuidPtr(row.OrganizationID),
		OrganizationName: row.OrganizationName.String, Recipients: nonNilStrings(row.Recipients), Cc: nonNilStrings(row.CcRecipients), Status: row.Status,
		Error: row.Error.String, SentBy: row.SentByUsername, CreatedAt: row.CreatedAt.Time, Reusable: row.Payload != nil, HTML: row.Html}
	if row.Payload != nil {
		var p any
		if json.Unmarshal(row.Payload, &p) == nil {
			dto.Payload = p
		}
	}
	writeData(w, http.StatusOK, dto)
}

// DeleteHistory es DELETE /api/reports/history/{id} (admin).
func (h *ReportsHandler) DeleteHistory(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no encontrado")
		return
	}
	n, err := h.Queries.DeleteReportHistory(r.Context(), id)
	if err != nil || n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no encontrado")
		return
	}
	h.AuditLog.Log(r.Context(), "report.history.deleted", audit.LevelWarn, audit.Success(), map[string]any{"historyId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}
