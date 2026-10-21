package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/forward"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Administración → Integraciones (spec/19 §5): destinos del reenvío de
// eventos a un SIEM y llaves de la API de integraciones. Solo admin.

// APIScopes: la única lista de permisos de una llave; la pantalla la lee de
// GET /api/integrations/meta (nunca se copia a mano).
var APIScopes = []string{"entries:read", "entries:write", "oncall:read", "tickets:read", "tickets:write", "reports:render", "reports:send"}

// apiKeyPrefix: las llaves son bop_ + 43 caracteres base62.
const (
	apiKeyPrefix    = "bop_"
	apiKeyRandLen   = 43
	apiKeyLookupLen = len(apiKeyPrefix) + 8
	maxDestHeaders  = 10
)

type IntegrationsHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Crypto   *crypto.Box
	Forward  *forward.Emitter
	// Hostname va en el HOSTNAME de RFC 5424 de «Probar».
	Hostname string
	Now      func() time.Time
}

func (h *IntegrationsHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// ===== Catálogo =====

type integrationsMetaDTO struct {
	Scopes  []string        `json:"scopes"`
	Areas   []idNameCodeDTO `json:"areas"`
	Clients []idNameCodeDTO `json:"clients"`
	Crypto  bool            `json:"crypto"`
}

type idNameCodeDTO struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Code string    `json:"code,omitempty"`
}

// Meta es GET /api/integrations/meta: permisos, áreas que reciben tickets y
// clientes, para los formularios.
func (h *IntegrationsHandler) Meta(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las áreas")
		return
	}
	out := integrationsMetaDTO{Scopes: APIScopes, Areas: []idNameCodeDTO{}, Clients: []idNameCodeDTO{}, Crypto: h.Crypto != nil}
	for _, a := range areas {
		if a.DefaultProfile != "gestion" {
			out.Areas = append(out.Areas, idNameCodeDTO{ID: a.ID, Name: a.Name, Code: a.Code})
		}
	}
	clients, err := h.Queries.ListActiveClientNames(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los clientes")
		return
	}
	for _, c := range clients {
		out.Clients = append(out.Clients, idNameCodeDTO{ID: c.ID, Name: c.Name})
	}
	writeData(w, http.StatusOK, out)
}

// ===== Destinos =====

type forwardDestinationDTO struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	Enabled        bool       `json:"enabled"`
	Transport      string     `json:"transport"`
	Host           *string    `json:"host"`
	Port           *int32     `json:"port"`
	URL            *string    `json:"url"`
	Format         string     `json:"format"`
	Batch          bool       `json:"batch"`
	SendAudit      bool       `json:"sendAudit"`
	AuditLevel     string     `json:"auditLevel"`
	SendEntries    bool       `json:"sendEntries"`
	SendEscalation bool       `json:"sendEscalation"`
	SendTickets    bool       `json:"sendTickets"`
	HasCACert      bool       `json:"hasCaCert"`
	HasClientCert  bool       `json:"hasClientCert"`
	Headers        []string   `json:"headers"`
	State          string     `json:"state"` // off | ok | failing | idle
	FailingSince   *time.Time `json:"failingSince"`
	LastSentAt     *time.Time `json:"lastSentAt"`
	LastError      *string    `json:"lastError"`
	LastErrorAt    *time.Time `json:"lastErrorAt"`
	SentToday      int32      `json:"sentToday"`
	LostWeek       int32      `json:"lostWeek"`
	Pending        int32      `json:"pending"`
}

func toForwardDestinationDTO(d db.ForwardDestination, sent, lost, pending int32) forwardDestinationDTO {
	dto := forwardDestinationDTO{
		ID: d.ID, Name: d.Name, Enabled: d.Enabled, Transport: d.Transport, Host: textPtr(d.Host), URL: textPtr(d.Url),
		Format: d.Format, Batch: d.Batch, SendAudit: d.SendAudit, AuditLevel: d.AuditLevel, SendEntries: d.SendEntries,
		SendEscalation: d.SendEscalation, SendTickets: d.SendTickets, HasCACert: d.CaCert.Valid && d.CaCert.String != "",
		HasClientCert: d.ClientCert.Valid && d.ClientCert.String != "", Headers: d.HeaderNames,
		FailingSince: timestamptzPtr(d.FailingSince), LastSentAt: timestamptzPtr(d.LastSentAt), LastError: textPtr(d.LastError),
		LastErrorAt: timestamptzPtr(d.LastErrorAt), SentToday: sent, LostWeek: lost, Pending: pending,
	}
	if d.Port.Valid {
		p := d.Port.Int32
		dto.Port = &p
	}
	if dto.Headers == nil {
		dto.Headers = []string{}
	}
	switch {
	case !d.Enabled:
		dto.State = "off"
	case d.FailingSince.Valid:
		dto.State = "failing"
	case d.LastSentAt.Valid:
		dto.State = "ok"
	default:
		dto.State = "idle"
	}
	return dto
}

func destFromListRow(r db.ListForwardDestinationsRow) db.ForwardDestination {
	return db.ForwardDestination{ID: r.ID, Name: r.Name, Enabled: r.Enabled, Transport: r.Transport, Host: r.Host, Port: r.Port, Url: r.Url,
		Format: r.Format, Batch: r.Batch, SendAudit: r.SendAudit, AuditLevel: r.AuditLevel, SendEntries: r.SendEntries,
		SendEscalation: r.SendEscalation, SendTickets: r.SendTickets, CaCert: r.CaCert, ClientCert: r.ClientCert,
		ClientKeyEncrypted: r.ClientKeyEncrypted, HeaderNames: r.HeaderNames, HeadersEncrypted: r.HeadersEncrypted, CursorID: r.CursorID,
		FailingSince: r.FailingSince, DownAlerted: r.DownAlerted, LastSentAt: r.LastSentAt, LastError: r.LastError, LastErrorAt: r.LastErrorAt,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func (h *IntegrationsHandler) today() pgtype.Date {
	n := h.now()
	return pgtype.Date{Time: time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
}

// ListDestinations es GET /api/integrations/destinations.
func (h *IntegrationsHandler) ListDestinations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListForwardDestinations(r.Context(), h.today())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los destinos")
		return
	}
	out := make([]forwardDestinationDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toForwardDestinationDTO(destFromListRow(row), row.SentToday, row.LostWeek, row.Pending))
	}
	writeData(w, http.StatusOK, out)
}

// destHeader: una cabecera HTTP. Value nil = la guardada se mantiene.
type destHeader struct {
	Name  string  `json:"name"`
	Value *string `json:"value"`
}

// destinationRequest: los certificados y la llave se mandan solo para
// cambiarlos (nil = se mantiene, "" = se quita).
type destinationRequest struct {
	Name           string       `json:"name"`
	Enabled        bool         `json:"enabled"`
	Transport      string       `json:"transport"`
	Host           string       `json:"host"`
	Port           int32        `json:"port"`
	URL            string       `json:"url"`
	Format         string       `json:"format"`
	Batch          bool         `json:"batch"`
	SendAudit      bool         `json:"sendAudit"`
	AuditLevel     string       `json:"auditLevel"`
	SendEntries    bool         `json:"sendEntries"`
	SendEscalation bool         `json:"sendEscalation"`
	SendTickets    bool         `json:"sendTickets"`
	CACert         *string      `json:"caCert"`
	ClientCert     *string      `json:"clientCert"`
	ClientKey      *string      `json:"clientKey"`
	Headers        []destHeader `json:"headers"`
}

var (
	hostnameRe   = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$`)
	headerNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,63}$`)
)

var reservedHeaders = []string{"content-type", "content-length", "host", "user-agent", "transfer-encoding", "connection"}

// destinationInput es lo validado y listo para guardar.
type destinationInput struct {
	req                        destinationRequest
	host, url                  pgtype.Text
	port                       pgtype.Int4
	caCert, clientCert, keyEnc pgtype.Text
	headerNames                []string
	headersEnc                 pgtype.Text
}

func validDestHost(h string) bool {
	return net.ParseIP(h) != nil || hostnameRe.MatchString(h)
}

// prepareDestination valida y arma lo que se guarda; prev es el destino
// actual al editar (nil al crear) para mantener los secretos.
func (h *IntegrationsHandler) prepareDestination(req destinationRequest, prev *db.ForwardDestination) (destinationInput, string) {
	in := destinationInput{req: req}
	req.Name = strings.TrimSpace(req.Name)
	in.req.Name = req.Name
	if req.Name == "" || len([]rune(req.Name)) > 100 {
		return in, "el nombre es obligatorio (hasta 100 caracteres)"
	}
	if !slices.Contains([]string{"udp", "tcp", "tls", "http"}, req.Transport) {
		return in, "elige cómo se envía: Syslog UDP, TCP, TLS o HTTP"
	}
	if req.Format != "json" && req.Format != "rfc5424" {
		return in, "el formato es JSON o RFC 5424"
	}
	if req.AuditLevel == "" {
		in.req.AuditLevel = "info"
	} else if req.AuditLevel != "info" && req.AuditLevel != "warn" && req.AuditLevel != "error" {
		return in, "el nivel de la auditoría es informativo, advertencia o error"
	}
	if req.Enabled && !req.SendAudit && !req.SendEntries && !req.SendEscalation && !req.SendTickets {
		return in, "elige qué se manda: auditoría, Bitácora, Escalamiento o Ticketera"
	}
	if req.Transport == "http" {
		u, err := url.Parse(strings.TrimSpace(req.URL))
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return in, "la URL tiene que empezar con https:// y no llevar usuario ni contraseña"
		}
		in.url = pgtype.Text{String: u.String(), Valid: true}
	} else {
		host := strings.TrimSpace(req.Host)
		if !validDestHost(host) {
			return in, "el host tiene que ser un nombre o una IP válida"
		}
		if req.Port < 1 || req.Port > 65535 {
			return in, "el puerto va de 1 a 65535"
		}
		in.host, in.port = pgtype.Text{String: host, Valid: true}, pgtype.Int4{Int32: req.Port, Valid: true}
	}
	// Certificados: se mantienen si no vienen.
	keep := func(v *string, old pgtype.Text) pgtype.Text {
		if v == nil {
			return old
		}
		s := strings.TrimSpace(*v)
		return pgtype.Text{String: s, Valid: s != ""}
	}
	var prevCA, prevCert, prevKey, prevHeaders pgtype.Text
	if prev != nil {
		prevCA, prevCert, prevKey, prevHeaders = prev.CaCert, prev.ClientCert, prev.ClientKeyEncrypted, prev.HeadersEncrypted
	}
	in.caCert, in.clientCert = keep(req.CACert, prevCA), keep(req.ClientCert, prevCert)
	if in.caCert.Valid && !x509.NewCertPool().AppendCertsFromPEM([]byte(in.caCert.String)) {
		return in, "la CA propia no es un certificado PEM válido"
	}
	key := ""
	if req.ClientKey != nil {
		key = strings.TrimSpace(*req.ClientKey)
		if key != "" {
			if h.Crypto == nil {
				return in, "falta la llave de cifrado del servidor: no se pueden guardar secretos"
			}
			enc, err := h.Crypto.Encrypt(key)
			if err != nil {
				return in, "no se pudo cifrar la llave de cliente"
			}
			in.keyEnc = pgtype.Text{String: enc, Valid: true}
		}
	} else {
		in.keyEnc = prevKey
		if prevKey.Valid && h.Crypto != nil {
			key, _ = h.Crypto.Decrypt(prevKey.String)
		}
	}
	if in.clientCert.Valid != in.keyEnc.Valid {
		return in, "para mTLS van juntos el certificado y la llave de cliente"
	}
	if in.clientCert.Valid {
		if _, err := tls.X509KeyPair([]byte(in.clientCert.String), []byte(key)); err != nil {
			return in, "el certificado y la llave de cliente no son válidos o no son pareja"
		}
	}
	// Cabeceras: los valores van cifrados juntos; uno sin valor mantiene el guardado.
	old := map[string]string{}
	if prevHeaders.Valid && prevHeaders.String != "" && h.Crypto != nil {
		if raw, err := h.Crypto.Decrypt(prevHeaders.String); err == nil {
			_ = json.Unmarshal([]byte(raw), &old)
		}
	}
	if len(req.Headers) > maxDestHeaders {
		return in, "hasta 10 cabeceras"
	}
	values := map[string]string{}
	in.headerNames = []string{}
	for _, hd := range req.Headers {
		name := strings.TrimSpace(hd.Name)
		if !headerNameRe.MatchString(name) || slices.Contains(reservedHeaders, strings.ToLower(name)) {
			return in, "la cabecera «" + name + "» no es válida o la pone la app"
		}
		if _, dup := values[http.CanonicalHeaderKey(name)]; dup {
			return in, "la cabecera «" + name + "» está repetida"
		}
		v, ok := "", false
		if hd.Value != nil {
			v, ok = strings.TrimSpace(*hd.Value), true
		} else {
			v, ok = old[http.CanonicalHeaderKey(name)]
		}
		if !ok || v == "" || strings.ContainsAny(v, "\r\n") {
			return in, "falta el valor de la cabecera «" + name + "»"
		}
		values[http.CanonicalHeaderKey(name)] = v
		in.headerNames = append(in.headerNames, http.CanonicalHeaderKey(name))
	}
	if len(values) > 0 {
		if h.Crypto == nil {
			return in, "falta la llave de cifrado del servidor: no se pueden guardar secretos"
		}
		raw, _ := json.Marshal(values)
		enc, err := h.Crypto.Encrypt(string(raw))
		if err != nil {
			return in, "no se pudieron cifrar las cabeceras"
		}
		in.headersEnc = pgtype.Text{String: enc, Valid: true}
	}
	return in, ""
}

// destinationAudit: lo que queda en Auditoría de un destino (sin secretos).
func destinationAudit(d db.ForwardDestination) map[string]any {
	return map[string]any{"destinationId": d.ID.String(), "name": d.Name, "enabled": d.Enabled, "transport": d.Transport,
		"format": d.Format, "audit": d.SendAudit, "auditLevel": d.AuditLevel, "entries": d.SendEntries, "escalation": d.SendEscalation,
		"tickets": d.SendTickets, "headers": d.HeaderNames, "mtls": d.ClientCert.Valid}
}

// CreateDestination es POST /api/integrations/destinations.
func (h *IntegrationsHandler) CreateDestination(w http.ResponseWriter, r *http.Request) {
	var req destinationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	in, msg := h.prepareDestination(req, nil)
	if msg != "" {
		problemdetails.Write(w, r, 400, "invalid-payload", msg)
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	d, err := h.Queries.CreateForwardDestination(ctx, db.CreateForwardDestinationParams{
		Name: in.req.Name, Enabled: in.req.Enabled, Transport: in.req.Transport, Host: in.host, Port: in.port, Url: in.url, Format: in.req.Format,
		Batch: in.req.Batch, SendAudit: in.req.SendAudit, AuditLevel: in.req.AuditLevel, SendEntries: in.req.SendEntries,
		SendEscalation: in.req.SendEscalation, SendTickets: in.req.SendTickets, CaCert: in.caCert, ClientCert: in.clientCert,
		ClientKeyEncrypted: in.keyEnc, HeaderNames: in.headerNames, HeadersEncrypted: in.headersEnc,
		CreatedBy: pgtype.UUID{Bytes: user.ID, Valid: user.ID != uuid.Nil},
	})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el destino")
		return
	}
	h.Forward.Invalidate()
	h.AuditLog.Log(ctx, "config.forward.create", audit.LevelWarn, audit.Success(), destinationAudit(d))
	writeData(w, http.StatusCreated, toForwardDestinationDTO(d, 0, 0, 0))
}

func (h *IntegrationsHandler) loadDestination(w http.ResponseWriter, r *http.Request) (db.ForwardDestination, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "destino no encontrado")
		return db.ForwardDestination{}, false
	}
	d, err := h.Queries.GetForwardDestination(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 404, "not-found", "destino no encontrado")
		return d, false
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer el destino")
		return d, false
	}
	return d, true
}

// UpdateDestination es PUT /api/integrations/destinations/{id}.
func (h *IntegrationsHandler) UpdateDestination(w http.ResponseWriter, r *http.Request) {
	prev, ok := h.loadDestination(w, r)
	if !ok {
		return
	}
	var req destinationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	in, msg := h.prepareDestination(req, &prev)
	if msg != "" {
		problemdetails.Write(w, r, 400, "invalid-payload", msg)
		return
	}
	ctx := r.Context()
	d, err := h.Queries.UpdateForwardDestination(ctx, db.UpdateForwardDestinationParams{
		ID: prev.ID, Name: in.req.Name, Enabled: in.req.Enabled, Transport: in.req.Transport, Host: in.host, Port: in.port, Url: in.url,
		Format: in.req.Format, Batch: in.req.Batch, SendAudit: in.req.SendAudit, AuditLevel: in.req.AuditLevel, SendEntries: in.req.SendEntries,
		SendEscalation: in.req.SendEscalation, SendTickets: in.req.SendTickets, CaCert: in.caCert, ClientCert: in.clientCert,
		ClientKeyEncrypted: in.keyEnc, HeaderNames: in.headerNames, HeadersEncrypted: in.headersEnc,
	})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar el destino")
		return
	}
	h.Forward.Invalidate()
	h.AuditLog.Log(ctx, "config.forward.update", audit.LevelWarn, audit.Success(), destinationAudit(d))
	h.writeDestination(w, r, d.ID, http.StatusOK)
}

func (h *IntegrationsHandler) writeDestination(w http.ResponseWriter, r *http.Request, id uuid.UUID, status int) {
	rows, err := h.Queries.ListForwardDestinations(r.Context(), h.today())
	if err == nil {
		for _, row := range rows {
			if row.ID == id {
				writeData(w, status, toForwardDestinationDTO(destFromListRow(row), row.SentToday, row.LostWeek, row.Pending))
				return
			}
		}
	}
	problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer el destino")
}

// DeleteDestination es DELETE /api/integrations/destinations/{id}.
func (h *IntegrationsHandler) DeleteDestination(w http.ResponseWriter, r *http.Request) {
	d, ok := h.loadDestination(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if _, err := h.Queries.DeleteForwardDestination(ctx, d.ID); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo eliminar el destino")
		return
	}
	h.Forward.Invalidate()
	h.AuditLog.Log(ctx, "config.forward.delete", audit.LevelWarn, audit.Success(), destinationAudit(d))
	w.WriteHeader(http.StatusNoContent)
}

// TestDestination es POST /api/integrations/destinations/{id}/test: manda
// bitacora.test directo, sin pasar por la cola.
func (h *IntegrationsHandler) TestDestination(w http.ResponseWriter, r *http.Request) {
	d, ok := h.loadDestination(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	ev := forward.TestEvent(h.Hostname, user.Username)
	payload, _ := json.Marshal(ev)
	target, err := forward.TargetOf(d, h.Crypto, h.Hostname)
	if err == nil {
		tctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_, err = forward.Send(tctx, target, []forward.Message{{Payload: payload, Event: ev.Event, Level: ev.Level, TS: ev.TS}})
		cancel()
	}
	result := map[string]any{"ok": err == nil, "transport": d.Transport}
	level, outcome := audit.LevelInfo, audit.Success()
	if err != nil {
		result["error"] = err.Error()
		level, outcome = audit.LevelWarn, audit.Failure(err.Error())
	}
	h.AuditLog.Log(ctx, "config.forward.test", level, outcome, map[string]any{"destinationId": d.ID.String(), "name": d.Name})
	writeData(w, http.StatusOK, result)
}

// ===== Llaves =====

type apiKeyDTO struct {
	ID            uuid.UUID   `json:"id"`
	Name          string      `json:"name"`
	Description   string      `json:"description"`
	Prefix        string      `json:"prefix"`
	Scopes        []string    `json:"scopes"`
	ClientIDs     []uuid.UUID `json:"clientIds"`
	AreaID        *uuid.UUID  `json:"areaId"`
	AreaName      string      `json:"areaName,omitempty"`
	State         string      `json:"state"` // active | expired | revoked
	ExpiresAt     *time.Time  `json:"expiresAt"`
	LastUsedAt    *time.Time  `json:"lastUsedAt"`
	CreatedAt     time.Time   `json:"createdAt"`
	CreatedByName string      `json:"createdByName"`
	RevokedAt     *time.Time  `json:"revokedAt"`
	RevokedByName string      `json:"revokedByName,omitempty"`
	RevokeReason  *string     `json:"revokeReason"`
	CallsWeek     int32       `json:"callsWeek"`
}

func apiKeyState(active bool, expires pgtype.Timestamptz, now time.Time) string {
	switch {
	case !active:
		return "revoked"
	case expires.Valid && !now.Before(expires.Time):
		return "expired"
	}
	return "active"
}

func toAPIKeyDTO(k db.ListAPIKeysRow, now time.Time) apiKeyDTO {
	dto := apiKeyDTO{ID: k.ID, Name: k.Name, Description: k.Description, Prefix: k.KeyPrefix, Scopes: k.Scopes, ClientIDs: k.ClientIds,
		AreaID: uuidPtr(k.AreaID), AreaName: k.AreaName, State: apiKeyState(k.Active, k.ExpiresAt, now), ExpiresAt: timestamptzPtr(k.ExpiresAt),
		LastUsedAt: timestamptzPtr(k.LastUsedAt), CreatedByName: k.CreatedByName, RevokedAt: timestamptzPtr(k.RevokedAt),
		RevokedByName: k.RevokedByName, RevokeReason: textPtr(k.RevokeReason), CallsWeek: k.CallsWeek}
	if k.CreatedAt.Valid {
		dto.CreatedAt = k.CreatedAt.Time
	}
	if dto.Scopes == nil {
		dto.Scopes = []string{}
	}
	return dto
}

// ListKeys es GET /api/integrations/keys.
func (h *IntegrationsHandler) ListKeys(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListAPIKeys(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las llaves")
		return
	}
	now := h.now()
	out := make([]apiKeyDTO, 0, len(rows))
	for _, k := range rows {
		out = append(out, toAPIKeyDTO(k, now))
	}
	writeData(w, http.StatusOK, out)
}

type createKeyRequest struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Scopes      []string    `json:"scopes"`
	ClientIDs   []uuid.UUID `json:"clientIds"` // vacío o nil = todos
	AreaID      *uuid.UUID  `json:"areaId"`
	// ExpiresInDays: 90, 365 o 0 (sin vencimiento).
	ExpiresInDays int `json:"expiresInDays"`
}

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// newAPIKeySecret: bop_ + 43 caracteres base62 (~256 bits).
func newAPIKeySecret() (string, error) {
	var b strings.Builder
	b.WriteString(apiKeyPrefix)
	limit := big.NewInt(int64(len(base62)))
	for range apiKeyRandLen {
		n, err := rand.Int(rand.Reader, limit)
		if err != nil {
			return "", err
		}
		b.WriteByte(base62[n.Int64()])
	}
	return b.String(), nil
}

func hashAPIKey(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// CreateKey es POST /api/integrations/keys. La llave se devuelve una sola
// vez; se guarda su hash.
func (h *IntegrationsHandler) CreateKey(w http.ResponseWriter, r *http.Request) {
	var req createKeyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Name, req.Description = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	if req.Name == "" || len([]rune(req.Name)) > 100 || len([]rune(req.Description)) > 500 {
		problemdetails.Write(w, r, 400, "invalid-payload", "el nombre es obligatorio (hasta 100 caracteres) y «para qué sirve» hasta 500")
		return
	}
	scopes := []string{}
	for _, s := range req.Scopes {
		if !slices.Contains(APIScopes, s) {
			problemdetails.Write(w, r, 400, "invalid-payload", "permiso desconocido: "+s)
			return
		}
		if !slices.Contains(scopes, s) {
			scopes = append(scopes, s)
		}
	}
	if len(scopes) == 0 {
		problemdetails.Write(w, r, 400, "invalid-payload", "elige al menos un permiso")
		return
	}
	ctx := r.Context()
	var area pgtype.UUID
	if req.AreaID != nil {
		area = pgtype.UUID{Bytes: *req.AreaID, Valid: true}
	}
	if slices.Contains(scopes, "tickets:write") {
		areas, err := h.Queries.ListTicketAreas(ctx)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las áreas")
			return
		}
		if !area.Valid || !slices.ContainsFunc(areas, func(a db.ListTicketAreasRow) bool { return a.ID == *req.AreaID && a.DefaultProfile != "gestion" }) {
			problemdetails.Write(w, r, 400, "invalid-payload", "con «Crear y comentar tickets» elige el área que recibe sus tickets")
			return
		}
	} else {
		area = pgtype.UUID{}
	}
	var clients []uuid.UUID
	if len(req.ClientIDs) > 0 {
		all, err := h.Queries.ListActiveClientNames(ctx)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los clientes")
			return
		}
		for _, id := range req.ClientIDs {
			if !slices.ContainsFunc(all, func(c db.ListActiveClientNamesRow) bool { return c.ID == id }) {
				problemdetails.Write(w, r, 400, "invalid-payload", "algún cliente no existe o está inactivo")
				return
			}
			if !slices.Contains(clients, id) {
				clients = append(clients, id)
			}
		}
	}
	var expires pgtype.Timestamptz
	switch req.ExpiresInDays {
	case 0:
	case 90, 365:
		expires = pgtype.Timestamptz{Time: h.now().AddDate(0, 0, req.ExpiresInDays), Valid: true}
	default:
		problemdetails.Write(w, r, 400, "invalid-payload", "vence en 90 días, en 1 año o nunca")
		return
	}
	secret, err := newAPIKeySecret()
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo generar la llave")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	k, err := h.Queries.CreateAPIKey(ctx, db.CreateAPIKeyParams{Name: req.Name, Description: req.Description, KeyPrefix: secret[:apiKeyLookupLen],
		KeyHash: hashAPIKey(secret), Scopes: scopes, ClientIds: clients, AreaID: area, ExpiresAt: expires,
		CreatedBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear la llave")
		return
	}
	h.AuditLog.Log(ctx, "apikey.create", audit.LevelWarn, audit.Success(), map[string]any{"apiKeyId": k.ID.String(), "name": k.Name,
		"prefix": k.KeyPrefix, "scopes": scopes, "clients": len(clients), "expiresInDays": req.ExpiresInDays})
	dto := apiKeyDTO{ID: k.ID, Name: k.Name, Description: k.Description, Prefix: k.KeyPrefix, Scopes: k.Scopes, ClientIDs: k.ClientIds,
		AreaID: uuidPtr(k.AreaID), State: "active", ExpiresAt: timestamptzPtr(k.ExpiresAt), CreatedAt: k.CreatedAt.Time, CreatedByName: user.Username}
	writeData(w, http.StatusCreated, map[string]any{"key": dto, "secret": secret})
}

// RevokeKey es POST /api/integrations/keys/{id}/revoke.
func (h *IntegrationsHandler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "llave no encontrada")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	k, err := h.Queries.RevokeAPIKey(ctx, db.RevokeAPIKeyParams{ID: id, RevokedBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, 404, "not-found", "la llave no existe o ya está revocada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo revocar la llave")
		return
	}
	h.AuditLog.Log(ctx, "apikey.revoke", audit.LevelWarn, audit.Success(), map[string]any{"apiKeyId": k.ID.String(), "name": k.Name, "prefix": k.KeyPrefix})
	w.WriteHeader(http.StatusNoContent)
}

type apiKeyRequestDTO struct {
	At        time.Time `json:"at"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Scope     *string   `json:"scope"`
	Status    int32     `json:"status"`
	LatencyMs int32     `json:"latencyMs"`
	IP        *string   `json:"ip"`
	Note      *string   `json:"note"`
}

// KeyRequests es GET /api/integrations/keys/{id}/requests: las últimas 50.
func (h *IntegrationsHandler) KeyRequests(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "llave no encontrada")
		return
	}
	rows, err := h.Queries.ListAPIKeyRequests(r.Context(), pgtype.UUID{Bytes: id, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer el registro")
		return
	}
	out := make([]apiKeyRequestDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, apiKeyRequestDTO{At: x.CreatedAt.Time, Method: x.Method, Path: x.Path, Scope: textPtr(x.Scope), Status: x.Status,
			LatencyMs: x.LatencyMs, IP: textPtr(x.Ip), Note: textPtr(x.Note)})
	}
	writeData(w, http.StatusOK, out)
}
