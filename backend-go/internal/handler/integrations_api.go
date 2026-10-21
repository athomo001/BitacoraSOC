package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// API de integraciones (/api/v1, spec/19 §4): para n8n, un SIEM o un SOAR,
// con llave de API. No es la Complement Runtime API (/api/internal/v1).

type IntegrationsAPI struct {
	Queries *db.Queries
	// Pool abre las transacciones (en las pruebas, una transacción externa).
	Pool       txBeginner
	AuditLog   *audit.Logger
	Crypto     *crypto.Box
	Limiter    *ratelimit.APILimiter
	Tickets    *TicketsHandler
	Reports    *ReportsHandler
	Hub        eventPublisher
	AppVersion string
	Now        func() time.Time
}

func (a *IntegrationsAPI) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}

// apiKeyCaller: la llave que llama.
type apiKeyCaller struct {
	ID          uuid.UUID
	Name        string
	Prefix      string
	Scopes      []string
	Clients     []uuid.UUID // nil = todos
	AreaID      pgtype.UUID
	ExpiresAt   pgtype.Timestamptz
	Creator     uuid.UUID
	CreatorName string
}

func (k apiKeyCaller) has(scope string) bool { return slices.Contains(k.Scopes, scope) }

func (k apiKeyCaller) allows(client uuid.UUID) bool {
	return k.Clients == nil || slices.Contains(k.Clients, client)
}

// display es cómo queda firmado lo que hace la llave: «quien la creó (API · nombre)».
func (k apiKeyCaller) display() string {
	return k.CreatorName + " (API · " + k.Name + ")"
}

// apiRecorder guarda el estado y, si hace falta para un reintento seguro,
// la respuesta.
type apiRecorder struct {
	http.ResponseWriter
	status  int
	capture bool
	body    bytes.Buffer
	note    string
}

func (r *apiRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *apiRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	if r.capture {
		r.body.Write(b)
	}
	return r.ResponseWriter.Write(b)
}

const maxAPIBody = 25 << 20 // el informe de incidente puede traer imágenes

func apiKeyFromRequest(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("X-API-Key")); v != "" {
		return v
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	for _, p := range []string{"Bearer ", "ApiKey "} {
		if v, ok := strings.CutPrefix(auth, p); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// Route protege una ruta: llave válida, permiso (scope vacío = cualquiera),
// límite por llave, registro de cada llamada y Idempotency-Key en los POST.
func (a *IntegrationsAPI) Route(scope string, next func(http.ResponseWriter, *http.Request, apiKeyCaller)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := a.now()
		w.Header().Set("X-API-Version", "v1")
		rec := &apiRecorder{ResponseWriter: w}
		var keyID pgtype.UUID
		var prefix pgtype.Text
		defer func() {
			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}
			ip := ""
			if meta, ok := audit.RequestMetaFromContext(r.Context()); ok {
				ip = meta.IP
			}
			// Contexto propio: el registro se guarda aunque el cliente corte.
			ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
			defer cancel()
			_ = a.Queries.InsertAPIKeyRequest(ctx, db.InsertAPIKeyRequestParams{ApiKeyID: keyID, KeyPrefix: prefix, Method: r.Method,
				Path: r.URL.Path, Scope: pgtype.Text{String: scope, Valid: scope != ""}, Status: int32(status),
				LatencyMs: int32(a.now().Sub(started).Milliseconds()), Ip: pgtype.Text{String: ip, Valid: ip != ""},
				Note: pgtype.Text{String: rec.note, Valid: rec.note != ""}})
		}()
		raw := apiKeyFromRequest(r)
		if raw == "" {
			rec.note = "Sin llave"
			problemdetails.Write(rec, r, http.StatusUnauthorized, "api-key-required", "falta la llave: X-API-Key o Authorization: Bearer")
			return
		}
		if !strings.HasPrefix(raw, apiKeyPrefix) || len(raw) != len(apiKeyPrefix)+apiKeyRandLen {
			rec.note = "Llave con formato inválido"
			problemdetails.Write(rec, r, http.StatusUnauthorized, "api-key-invalid", "la llave no es válida")
			return
		}
		prefix = pgtype.Text{String: raw[:apiKeyLookupLen], Valid: true}
		ctx := r.Context()
		k, err := a.Queries.GetAPIKeyForAuth(ctx, raw[:apiKeyLookupLen])
		if err != nil || subtle.ConstantTimeCompare([]byte(k.KeyHash), []byte(hashAPIKey(raw))) != 1 {
			rec.note = "Llave inválida"
			problemdetails.Write(rec, r, http.StatusUnauthorized, "api-key-invalid", "la llave no es válida")
			return
		}
		keyID = pgtype.UUID{Bytes: k.ID, Valid: true}
		switch {
		case !k.Active:
			rec.note = "Llave revocada"
			problemdetails.Write(rec, r, http.StatusUnauthorized, "api-key-revoked", "la llave fue revocada")
			return
		case k.ExpiresAt.Valid && !a.now().Before(k.ExpiresAt.Time):
			rec.note = "Llave vencida"
			problemdetails.Write(rec, r, http.StatusUnauthorized, "api-key-expired", "la llave venció")
			return
		case !k.CreatedBy.Valid || !k.CreatorActive:
			_, _ = a.Queries.RevokeAPIKey(ctx, db.RevokeAPIKeyParams{ID: k.ID, Reason: pgtype.Text{String: "La persona que la creó se dio de baja", Valid: true}})
			a.AuditLog.Log(ctx, "apikey.revoke", audit.LevelWarn, audit.Success(), map[string]any{"apiKeyId": k.ID.String(), "name": k.Name, "reason": "creator-inactive"})
			rec.note = "Se revocó: quien la creó se dio de baja"
			problemdetails.Write(rec, r, http.StatusUnauthorized, "api-key-revoked", "la llave fue revocada")
			return
		}
		if a.Limiter != nil && !a.Limiter.Allow("apikey:"+k.ID.String()) {
			rec.note = "Límite de llamadas"
			problemdetails.WriteRateLimited(rec, r, 60, "pasaste el límite de 600 llamadas cada 15 minutos de esta llave")
			return
		}
		caller := apiKeyCaller{ID: k.ID, Name: k.Name, Prefix: k.KeyPrefix, Scopes: k.Scopes, Clients: k.ClientIds, AreaID: k.AreaID,
			ExpiresAt: k.ExpiresAt, Creator: k.CreatedBy.Bytes, CreatorName: k.CreatorUsername}
		if scope != "" && !caller.has(scope) {
			rec.note = "Le falta el permiso " + scope
			problemdetails.Write(rec, r, http.StatusForbidden, "insufficient-scope", "esta llave no tiene el permiso "+scope)
			return
		}
		_ = a.Queries.TouchAPIKey(ctx, k.ID)
		ctx = middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: caller.Creator, Username: caller.display(), Role: k.CreatorRole})
		ctx = audit.WithActor(ctx, audit.Actor{UserID: caller.Creator, Username: caller.display(), Role: "api"})
		r = r.WithContext(ctx)

		idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if r.Method != http.MethodPost || idem == "" {
			next(rec, r, caller)
			return
		}
		a.idempotent(rec, r, caller, idem, next)
	})
}

// idempotent: la misma llave y la misma Idempotency-Key en 24 horas
// devuelven lo mismo sin repetir la acción (un SIEM que reintenta no abre
// dos tickets).
func (a *IntegrationsAPI) idempotent(rec *apiRecorder, r *http.Request, k apiKeyCaller, idem string, next func(http.ResponseWriter, *http.Request, apiKeyCaller)) {
	if len(idem) > 200 {
		problemdetails.Write(rec, r, http.StatusBadRequest, "invalid-idempotency-key", "Idempotency-Key admite hasta 200 caracteres")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(rec, r.Body, maxAPIBody))
	if err != nil {
		problemdetails.Write(rec, r, http.StatusRequestEntityTooLarge, "payload-too-large", "el cuerpo pasa de 25 MB")
		return
	}
	sum := sha256.Sum256(append([]byte(r.Method+" "+r.URL.Path+"\n"), body...))
	hash := hex.EncodeToString(sum[:])
	ctx := r.Context()
	n, err := a.Queries.ClaimIdempotency(ctx, db.ClaimIdempotencyParams{ApiKeyID: k.ID, IdemKey: idem, RequestHash: hash})
	if err != nil {
		problemdetails.Write(rec, r, 500, "internal-error", "no se pudo registrar la Idempotency-Key")
		return
	}
	if n == 0 {
		prev, err := a.Queries.GetIdempotency(ctx, db.GetIdempotencyParams{ApiKeyID: k.ID, IdemKey: idem})
		switch {
		case err != nil:
			problemdetails.Write(rec, r, 500, "internal-error", "no se pudo leer la Idempotency-Key")
		case prev.RequestHash != hash:
			problemdetails.Write(rec, r, http.StatusUnprocessableEntity, "idempotency-key-reused", "esa Idempotency-Key ya se usó con otra llamada")
		case prev.Status == 0:
			problemdetails.Write(rec, r, http.StatusConflict, "idempotency-in-progress", "la llamada con esa Idempotency-Key todavía está en curso")
		default:
			rec.note = "Reintento: mismo Idempotency-Key, no se duplicó"
			rec.Header().Set("Content-Type", "application/json")
			rec.Header().Set("Idempotent-Replayed", "true")
			rec.WriteHeader(int(prev.Status))
			_, _ = rec.Write(prev.Body)
		}
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	rec.capture = true
	next(rec, r, k)
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if rec.status >= 500 || rec.status == 0 {
		_ = a.Queries.DeleteIdempotency(finish, db.DeleteIdempotencyParams{ApiKeyID: k.ID, IdemKey: idem})
		return
	}
	_ = a.Queries.FinishIdempotency(finish, db.FinishIdempotencyParams{ApiKeyID: k.ID, IdemKey: idem, Status: int32(rec.status), Body: rec.body.Bytes()})
}

// Purge borra el registro de llamadas de más de 90 días y las
// Idempotency-Key de más de 24 horas (cada hora).
func (a *IntegrationsAPI) Purge(ctx context.Context) error {
	_, _ = a.Queries.PurgeAPIKeyRequests(ctx)
	_, err := a.Queries.PurgeIdempotency(ctx)
	return err
}

// ===== Descubrimiento =====

// Discovery es GET /api/v1: versión y lo que puede hacer la llave.
func (a *IntegrationsAPI) Discovery(w http.ResponseWriter, _ *http.Request, k apiKeyCaller) {
	key := map[string]any{"name": k.Name, "prefix": k.Prefix, "scopes": k.Scopes, "expiresAt": timestamptzPtr(k.ExpiresAt)}
	if k.Clients != nil {
		key["clientIds"] = k.Clients
	} else {
		key["clientIds"] = "all"
	}
	writeData(w, http.StatusOK, map[string]any{"api": "Bitácora Ops · API de integraciones", "version": "v1", "appVersion": a.AppVersion, "key": key})
}

// ===== Paginación =====

const (
	apiDefaultLimit = 50
	apiMaxLimit     = 100
)

func apiLimit(r *http.Request) (int32, bool) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return apiDefaultLimit, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > apiMaxLimit {
		return 0, false
	}
	return int32(n), true
}

func encodeCursor(at time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeCursor(s string) (pgtype.Timestamptz, pgtype.UUID, bool) {
	if s == "" {
		return pgtype.Timestamptz{}, pgtype.UUID{}, true
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	at, id, ok := strings.Cut(string(raw), "|")
	t, err1 := time.Parse(time.RFC3339Nano, at)
	u, err2 := uuid.Parse(id)
	if !ok || err1 != nil || err2 != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	return pgtype.Timestamptz{Time: t, Valid: true}, pgtype.UUID{Bytes: u, Valid: true}, true
}

func apiSince(r *http.Request) (pgtype.Timestamptz, bool) {
	raw := r.URL.Query().Get("since")
	if raw == "" {
		return pgtype.Timestamptz{}, true
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return pgtype.Timestamptz{}, false
	}
	return pgtype.Timestamptz{Time: t, Valid: true}, true
}

// clientFilter resuelve ?client= (id o nombre) contra los clientes de la llave.
func (a *IntegrationsAPI) clientFilter(ctx context.Context, k apiKeyCaller, ref string) (pgtype.UUID, string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return pgtype.UUID{}, ""
	}
	c, err := a.Queries.FindClientForAPI(ctx, ref)
	if err != nil || !k.allows(c.ID) {
		return pgtype.UUID{}, "cliente desconocido o fuera de los de esta llave: " + ref
	}
	return pgtype.UUID{Bytes: c.ID, Valid: true}, ""
}

// ===== Entradas de la Bitácora =====

type apiEntryDTO struct {
	ID        uuid.UUID `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	EntryType string    `json:"entryType"`
	Scope     string    `json:"scope"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	Author    string    `json:"author"`
	Client    *apiRef   `json:"client"`
	TicketID  *string   `json:"ticketId"`
	APIKey    *string   `json:"apiKey"`
}

type apiRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func toAPIEntryDTO(e db.ListEntriesForAPIRow) apiEntryDTO {
	dto := apiEntryDTO{ID: e.ID, CreatedAt: e.CreatedAt.Time, UpdatedAt: e.UpdatedAt.Time, EntryType: string(e.EntryType), Scope: string(e.Scope),
		Content: e.Content, Tags: e.Tags, Author: e.AuthorUsername, APIKey: textPtr(e.ApiKeyName)}
	if dto.Tags == nil {
		dto.Tags = []string{}
	}
	if e.ClientID != "" {
		dto.Client = &apiRef{ID: e.ClientID, Name: e.ClientName}
	}
	if e.TicketID.Valid {
		s := uuid.UUID(e.TicketID.Bytes).String()
		dto.TicketID = &s
	}
	return dto
}

// ListEntries es GET /api/v1/entries?limit=&cursor=&client=&since=.
func (a *IntegrationsAPI) ListEntries(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	limit, ok := apiLimit(r)
	beforeAt, beforeID, ok2 := decodeCursor(r.URL.Query().Get("cursor"))
	since, ok3 := apiSince(r)
	if !ok || !ok2 || !ok3 {
		problemdetails.Write(w, r, 400, "invalid-query", "revisa limit (1 a 100), cursor y since (RFC 3339)")
		return
	}
	ctx := r.Context()
	client, msg := a.clientFilter(ctx, k, r.URL.Query().Get("client"))
	if msg != "" {
		problemdetails.Write(w, r, 400, "invalid-client", msg)
		return
	}
	rows, err := a.Queries.ListEntriesForAPI(ctx, db.ListEntriesForAPIParams{ClientIds: k.Clients, ClientID: client, Since: since,
		BeforeAt: beforeAt, BeforeID: beforeID, MaxRows: limit + 1})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las entradas")
		return
	}
	var next *string
	if len(rows) > int(limit) {
		rows = rows[:limit]
		c := encodeCursor(rows[len(rows)-1].CreatedAt.Time, rows[len(rows)-1].ID)
		next = &c
	}
	out := make([]apiEntryDTO, 0, len(rows))
	for _, e := range rows {
		out = append(out, toAPIEntryDTO(e))
	}
	writeDataMeta(w, http.StatusOK, out, map[string]any{"nextCursor": next, "limit": limit})
}

// GetEntry es GET /api/v1/entries/{id}.
func (a *IntegrationsAPI) GetEntry(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	rows, err := a.Queries.ListEntriesForAPI(r.Context(), db.ListEntriesForAPIParams{ID: pgtype.UUID{Bytes: id, Valid: true}, ClientIds: k.Clients, MaxRows: 1})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la entrada")
		return
	}
	if len(rows) == 0 {
		problemdetails.Write(w, r, 404, "not-found", "entrada no encontrada")
		return
	}
	writeData(w, http.StatusOK, toAPIEntryDTO(rows[0]))
}

type apiEntryRequest struct {
	Content   string   `json:"content"`
	EntryType string   `json:"entryType"`
	Scope     string   `json:"scope"`
	Client    string   `json:"client"`
	Tags      []string `json:"tags"`
}

const maxAPITags = 20

func cleanAPITags(in []string) []string {
	out := []string{}
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" || len([]rune(t)) > 60 || slices.ContainsFunc(out, func(x string) bool { return strings.EqualFold(x, t) }) {
			continue
		}
		out = append(out, t)
		if len(out) == maxAPITags {
			break
		}
	}
	return out
}

// CreateEntry es POST /api/v1/entries. El cliente (id o nombre) se guarda
// en su servicio si tiene uno solo; si no, con la etiqueta cliente:Nombre,
// como hace la Bitácora con los clientes de varios servicios.
func (a *IntegrationsAPI) CreateEntry(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	var req apiEntryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.EntryType == "" {
		req.EntryType = string(db.EntryTypeOperativa)
	}
	if req.Content == "" || len([]rune(req.Content)) > 20000 || !validEntryType(req.EntryType) {
		problemdetails.Write(w, r, 400, "invalid-payload", "content (hasta 20000 caracteres) es obligatorio y entryType es operativa, incidente u ofensa")
		return
	}
	scope := db.EntryScopeGeneral
	switch req.Scope {
	case "", "general":
	case "soc", "noc":
		scope = db.EntryScope(req.Scope)
	default:
		problemdetails.Write(w, r, 400, "invalid-payload", "scope es soc, noc o general")
		return
	}
	ctx := r.Context()
	tags := cleanAPITags(req.Tags)
	var service pgtype.UUID
	if strings.TrimSpace(req.Client) == "" {
		if k.Clients != nil {
			problemdetails.Write(w, r, 400, "invalid-client", "esta llave solo escribe para algunos clientes: indica client")
			return
		}
	} else {
		c, err := a.Queries.FindClientForAPI(ctx, strings.TrimSpace(req.Client))
		if err != nil || !k.allows(c.ID) {
			problemdetails.Write(w, r, 400, "invalid-client", "cliente desconocido o fuera de los de esta llave: "+req.Client)
			return
		}
		services, err := a.Queries.ListClientServiceIDs(ctx, c.ID)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los servicios del cliente")
			return
		}
		if len(services) == 1 {
			service = pgtype.UUID{Bytes: services[0], Valid: true}
		} else {
			tag := "cliente:" + c.Name
			if !slices.ContainsFunc(tags, func(x string) bool { return strings.EqualFold(x, tag) }) {
				tags = append(tags, tag)
			}
		}
	}
	entry, err := a.Queries.CreateAPIEntry(ctx, db.CreateAPIEntryParams{UserID: k.Creator, EntryType: db.EntryType(req.EntryType), Scope: scope,
		Content: req.Content, Tags: tags, ServiceID: service, ApiKeyID: pgtype.UUID{Bytes: k.ID, Valid: true}, ApiKeyName: pgtype.Text{String: k.Name, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear la entrada")
		return
	}
	a.AuditLog.Log(ctx, "entry.created", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entry.ID.String(), "entryType": string(entry.EntryType), "apiKey": k.Name})
	publishSync(ctx, a.Hub, "entry.created", map[string]string{"id": entry.ID.String()})
	rows, err := a.Queries.ListEntriesForAPI(ctx, db.ListEntriesForAPIParams{ID: pgtype.UUID{Bytes: entry.ID, Valid: true}, MaxRows: 1})
	if err != nil || len(rows) == 0 {
		writeData(w, http.StatusCreated, map[string]any{"id": entry.ID})
		return
	}
	writeData(w, http.StatusCreated, toAPIEntryDTO(rows[0]))
}

// ===== Guardia vigente =====

type apiChannelDTO struct {
	Type      string  `json:"type"`
	Value     string  `json:"value"`
	Label     *string `json:"label,omitempty"`
	Preferred bool    `json:"preferred"`
}

type apiOnCallDTO struct {
	Name     string          `json:"name"`
	Since    *time.Time      `json:"since"`
	Until    *time.Time      `json:"until"`
	Channels []apiChannelDTO `json:"channels"`
}

type apiGuardDTO struct {
	ID     uuid.UUID      `json:"id"`
	Name   string         `json:"name"`
	Client *apiRef        `json:"client"`
	OnCall []apiOnCallDTO `json:"onCall"`
}

// OnCall es GET /api/v1/oncall: quién está de guardia ahora en cada guardia
// con rotación, con sus contactos descifrados (el legacy los entregaba
// cifrados). Leer contactos queda en Auditoría, como en la app.
func (a *IntegrationsAPI) OnCall(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	ctx := r.Context()
	teams, err := a.Queries.ListOnCallTeams(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer las guardias")
		return
	}
	now := a.now()
	out := []apiGuardDTO{}
	people := 0
	for _, t := range teams {
		if t.OrganizationID.Valid && !k.allows(t.OrganizationID.Bytes) {
			continue
		}
		g := apiGuardDTO{ID: t.ID, Name: t.Name, OnCall: []apiOnCallDTO{}}
		if t.OrganizationID.Valid {
			g.Client = &apiRef{ID: uuid.UUID(t.OrganizationID.Bytes).String(), Name: t.OrganizationName}
		}
		current, err := resolveCurrentTeamMembers(ctx, a.Queries, t.ID, now)
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo resolver la guardia vigente")
			return
		}
		for _, c := range current {
			m, err := a.Queries.GetTeamMemberDisplay(ctx, c.TeamMemberID)
			if err != nil {
				continue
			}
			p := apiOnCallDTO{Name: m.DisplayName, Channels: a.channels(ctx, m.ContactID, m.UserID)}
			if !c.Since.IsZero() {
				since := c.Since
				p.Since = &since
			}
			if !c.Until.IsZero() {
				until := c.Until
				p.Until = &until
			}
			g.OnCall = append(g.OnCall, p)
			people++
		}
		out = append(out, g)
	}
	a.AuditLog.Log(ctx, "escalation.view.contacts.read", audit.LevelInfo, audit.Success(), map[string]any{"via": "api", "apiKey": k.Name, "guards": len(out), "contacts": people})
	writeData(w, http.StatusOK, out)
}

func (a *IntegrationsAPI) channels(ctx context.Context, contact, user pgtype.UUID) []apiChannelDTO {
	var chans []db.ContactChannel
	var err error
	switch {
	case contact.Valid:
		chans, err = a.Queries.ListChannelsForContacts(ctx, []uuid.UUID{contact.Bytes})
	case user.Valid:
		chans, err = a.Queries.ListChannelsForUsers(ctx, []uuid.UUID{user.Bytes})
	}
	out := []apiChannelDTO{}
	if err != nil || a.Crypto == nil {
		return out
	}
	for _, c := range chans {
		v, err := a.Crypto.Decrypt(c.ValueEncrypted)
		if err != nil {
			continue
		}
		out = append(out, apiChannelDTO{Type: string(c.ChannelType), Value: v, Label: textPtr(c.Label), Preferred: c.Preferred})
	}
	return out
}

// ===== Tickets =====

type apiTicketDTO struct {
	ID               uuid.UUID    `json:"id"`
	Number           string       `json:"number"`
	Title            string       `json:"title"`
	Description      string       `json:"description,omitempty"`
	Type             string       `json:"type"`
	Status           string       `json:"status"`
	Priority         string       `json:"priority"`
	Client           apiRef       `json:"client"`
	Area             string       `json:"area"`
	Source           string       `json:"source"`
	CreatedAt        time.Time    `json:"createdAt"`
	UpdatedAt        time.Time    `json:"updatedAt"`
	SLAResponseDue   *time.Time   `json:"slaResponseDue"`
	SLAResolutionDue *time.Time   `json:"slaResolutionDue"`
	RespondedAt      *time.Time   `json:"respondedAt"`
	ResolvedAt       *time.Time   `json:"resolvedAt"`
	ClosedAt         *time.Time   `json:"closedAt"`
	APIKey           *string      `json:"apiKey"`
	Comments         []apiComment `json:"comments,omitempty"`
}

type apiComment struct {
	Author    string    `json:"author"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

func toAPITicketDTO(t db.Ticket, clientName, areaName string) apiTicketDTO {
	return apiTicketDTO{ID: t.ID, Number: t.TicketNumber, Title: t.Title, Type: string(t.TicketType), Status: string(t.Status),
		Priority: string(t.Priority), Client: apiRef{ID: t.ClientID.String(), Name: clientName}, Area: areaName, Source: t.Source,
		CreatedAt: t.CreatedAt.Time, UpdatedAt: t.UpdatedAt.Time, SLAResponseDue: timestamptzPtr(t.SlaResponseDueAt),
		SLAResolutionDue: timestamptzPtr(t.SlaResolutionDueAt), RespondedAt: timestamptzPtr(t.FirstRespondedAt),
		ResolvedAt: timestamptzPtr(t.ResolvedAt), ClosedAt: timestamptzPtr(t.ClosedAt), APIKey: textPtr(t.ApiKeyName)}
}

func ticketFromAPIRow(r db.ListTicketsForAPIRow) db.Ticket {
	return db.Ticket{ID: r.ID, TicketNumber: r.TicketNumber, TicketType: r.TicketType, ClientID: r.ClientID, Status: r.Status, Priority: r.Priority,
		Title: r.Title, Description: r.Description, SlaResponseDueAt: r.SlaResponseDueAt, SlaResolutionDueAt: r.SlaResolutionDueAt,
		FirstRespondedAt: r.FirstRespondedAt, ResolvedAt: r.ResolvedAt, ClosedAt: r.ClosedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		Source: r.Source, ApiKeyName: r.ApiKeyName}
}

func (a *IntegrationsAPI) ticketsOn(w http.ResponseWriter, r *http.Request) bool {
	if a.Tickets == nil {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la Ticketera está desactivada")
		return false
	}
	on, err := a.Tickets.Enabled(r.Context())
	if err != nil || !on {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la Ticketera está desactivada")
		return false
	}
	return true
}

var apiTicketStatuses = []string{"new", "assigned", "in_progress", "pending_vendor", "resolved", "closed", "cancelled"}

// ListTickets es GET /api/v1/tickets?limit=&cursor=&client=&status=&since=
// (since: actualizados desde).
func (a *IntegrationsAPI) ListTickets(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	if !a.ticketsOn(w, r) {
		return
	}
	limit, ok := apiLimit(r)
	beforeAt, beforeID, ok2 := decodeCursor(r.URL.Query().Get("cursor"))
	since, ok3 := apiSince(r)
	status := r.URL.Query().Get("status")
	if !ok || !ok2 || !ok3 || (status != "" && !slices.Contains(apiTicketStatuses, status)) {
		problemdetails.Write(w, r, 400, "invalid-query", "revisa limit (1 a 100), cursor, since (RFC 3339) y status")
		return
	}
	ctx := r.Context()
	client, msg := a.clientFilter(ctx, k, r.URL.Query().Get("client"))
	if msg != "" {
		problemdetails.Write(w, r, 400, "invalid-client", msg)
		return
	}
	rows, err := a.Queries.ListTicketsForAPI(ctx, db.ListTicketsForAPIParams{ClientIds: k.Clients, ClientID: client,
		Status: pgtype.Text{String: status, Valid: status != ""}, Since: since, BeforeAt: beforeAt, BeforeID: beforeID, MaxRows: limit + 1})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron leer los tickets")
		return
	}
	var next *string
	if len(rows) > int(limit) {
		rows = rows[:limit]
		c := encodeCursor(rows[len(rows)-1].CreatedAt.Time, rows[len(rows)-1].ID)
		next = &c
	}
	out := make([]apiTicketDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, toAPITicketDTO(ticketFromAPIRow(t), t.ClientName, t.AreaName))
	}
	writeDataMeta(w, http.StatusOK, out, map[string]any{"nextCursor": next, "limit": limit})
}

// findTicket busca por id, TKT-… o GLPI-… dentro de los clientes de la llave.
func (a *IntegrationsAPI) findTicket(ctx context.Context, k apiKeyCaller, ref string) (db.Ticket, error) {
	var t db.Ticket
	var err error
	if id, perr := uuid.Parse(ref); perr == nil {
		t, err = a.Queries.GetTicket(ctx, id)
	} else {
		t, err = a.Queries.GetTicketByNumber(ctx, strings.ToUpper(strings.TrimSpace(ref)))
	}
	if err != nil {
		return t, err
	}
	if !k.allows(t.ClientID) {
		return t, pgx.ErrNoRows
	}
	return t, nil
}

func (a *IntegrationsAPI) ticketView(ctx context.Context, t db.Ticket, withComments bool) apiTicketDTO {
	brief, err := a.Queries.GetTicketBrief(ctx, t.ID)
	dto := toAPITicketDTO(t, "", "")
	if err == nil {
		dto.Client.Name, dto.Area = brief.ClientName, brief.AreaName
	}
	if withComments {
		dto.Description = t.Description
		dto.Comments = []apiComment{}
		if comments, err := a.Queries.ListPublicTicketComments(ctx, t.ID); err == nil {
			for _, c := range comments {
				dto.Comments = append(dto.Comments, apiComment{Author: c.AuthorName, Content: c.Content, CreatedAt: c.CreatedAt.Time})
			}
		}
	}
	return dto
}

// GetTicket es GET /api/v1/tickets/{ref}: con su descripción y los
// comentarios visibles al cliente (las notas internas no salen).
func (a *IntegrationsAPI) GetTicket(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	if !a.ticketsOn(w, r) {
		return
	}
	t, err := a.findTicket(r.Context(), k, r.PathValue("ref"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	writeData(w, http.StatusOK, a.ticketView(r.Context(), t, true))
}

type apiTicketRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Client      string `json:"client"`
	Impact      string `json:"impact"`
	Urgency     string `json:"urgency"`
}

// CreateTicket es POST /api/v1/tickets: entra a la cola del área de la llave.
func (a *IntegrationsAPI) CreateTicket(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	if !a.ticketsOn(w, r) {
		return
	}
	var req apiTicketRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Title, req.Description = strings.TrimSpace(req.Title), strings.TrimSpace(req.Description)
	if req.Type == "" {
		req.Type = "incident"
	}
	if req.Impact == "" {
		req.Impact = "medium"
	}
	if req.Urgency == "" {
		req.Urgency = "medium"
	}
	if req.Title == "" || len([]rune(req.Title)) > ticketTitleMaxRunes || len([]rune(req.Description)) > 20000 {
		problemdetails.Write(w, r, 400, "invalid-payload", fmt.Sprintf("title es obligatorio (hasta %d caracteres) y description hasta 20000", ticketTitleMaxRunes))
		return
	}
	if !validTicketType(req.Type) || !validImpact(req.Impact) || !validUrgency(req.Urgency) {
		problemdetails.Write(w, r, 400, "invalid-payload", "type es incident o service_request; impact es low, medium o high y urgency además critical")
		return
	}
	ctx := r.Context()
	c, err := a.Queries.FindClientForAPI(ctx, strings.TrimSpace(req.Client))
	if err != nil || !k.allows(c.ID) {
		problemdetails.Write(w, r, 400, "invalid-client", "client es obligatorio y tiene que ser uno de los de esta llave")
		return
	}
	areaCode := ""
	if k.AreaID.Valid {
		if areas, err := a.Queries.ListTicketAreas(ctx); err == nil {
			for _, ar := range areas {
				if ar.ID == uuid.UUID(k.AreaID.Bytes) {
					areaCode = ar.Code
				}
			}
		}
	}
	if areaCode == "" {
		problemdetails.Write(w, r, http.StatusConflict, "invalid-area", "el área de esta llave ya no recibe tickets: edítala en Administración → Integraciones")
		return
	}
	area, requested, err := a.Tickets.newTicketAreas(ctx, areaCode, "")
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "invalid-area", "el área de esta llave ya no recibe tickets")
		return
	}
	description := req.Description
	if description == "" {
		description = req.Title
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo iniciar la creación")
		return
	}
	defer tx.Rollback(ctx)
	ticket, err := a.Tickets.createTicketTx(ctx, tx, newTicket{Type: req.Type, Scope: db.EntryScopeGeneral, ClientID: c.ID, Title: req.Title,
		Description: description, Impact: req.Impact, Urgency: req.Urgency, ActorID: k.Creator, AreaID: area, RequestedAreaID: requested}, a.now())
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo crear el ticket")
		return
	}
	if err = a.Queries.WithTx(tx).SetTicketAPIKey(ctx, db.SetTicketAPIKeyParams{ID: ticket.ID, ApiKeyID: pgtype.UUID{Bytes: k.ID, Valid: true},
		ApiKeyName: pgtype.Text{String: k.Name, Valid: true}}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el ticket")
		return
	}
	if err = tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el ticket")
		return
	}
	ticket.ApiKeyName = pgtype.Text{String: k.Name, Valid: true}
	a.AuditLog.Log(ctx, "ticket.created", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": ticket.ID.String(), "apiKey": k.Name})
	a.Tickets.afterCreate(ctx, ticket, k.Creator)
	a.Tickets.notifyChanged(ctx, ticket.ID)
	writeData(w, http.StatusCreated, a.ticketView(ctx, ticket, false))
}

type apiCommentRequest struct {
	Content string `json:"content"`
	Public  bool   `json:"public"`
}

// CommentTicket es POST /api/v1/tickets/{ref}/comments. Por defecto es una
// nota interna; con "public": true lo ve el cliente.
func (a *IntegrationsAPI) CommentTicket(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	if !a.ticketsOn(w, r) {
		return
	}
	ctx := r.Context()
	t, err := a.findTicket(ctx, k, r.PathValue("ref"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "ticket no encontrado")
		return
	}
	if isGlpiTicket(t) {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-readonly", "este ticket vive en GLPI y se comenta allá")
		return
	}
	if t.MergedIntoID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "ticket-merged", "este ticket se unió a otro: comenta en el principal")
		return
	}
	var req apiCommentRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Content) == "" || len([]rune(req.Content)) > 20000 {
		problemdetails.Write(w, r, 400, "invalid-payload", "content es obligatorio (hasta 20000 caracteres)")
		return
	}
	content := strings.TrimSpace(req.Content)
	user, _ := middleware.UserFromContext(ctx)
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	defer tx.Rollback(ctx)
	comment, err := a.Tickets.addTicketComment(ctx, a.Queries.WithTx(tx), t, user, content, req.Public)
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el comentario")
		return
	}
	a.Tickets.afterComment(ctx, t, k.Creator, content, req.Public)
	a.AuditLog.Log(ctx, "ticket.comment_added", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": t.ID.String(), "public": req.Public, "apiKey": k.Name})
	a.Tickets.notifyChanged(ctx, t.ID)
	writeData(w, http.StatusCreated, map[string]any{"id": comment.ID, "author": comment.AuthorName, "content": comment.Content,
		"public": comment.IsPublic, "createdAt": comment.CreatedAt.Time})
}

// ===== Informe de incidente =====

// IncidentReport es POST /api/v1/reports/incident: arma el informe con la
// plantilla del legacy (los mismos campos que Reportes) y, con "send": true,
// lo envía a los dominios válidos de Reportes. Pasa por las mismas reglas que
// la pantalla, incluidos los avisos del cliente sin leer.
func (a *IntegrationsAPI) IncidentReport(w http.ResponseWriter, r *http.Request, k apiKeyCaller) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAPIBody))
	if err != nil {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "payload-too-large", "el cuerpo pasa de 25 MB")
		return
	}
	var head struct {
		Send           bool       `json:"send"`
		OrganizationID *uuid.UUID `json:"organizationId"`
	}
	if err := json.Unmarshal(body, &head); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	switch {
	case head.Send && !k.has("reports:send"):
		problemdetails.Write(w, r, http.StatusForbidden, "insufficient-scope", "esta llave no tiene el permiso reports:send")
		return
	case !head.Send && !k.has("reports:render") && !k.has("reports:send"):
		problemdetails.Write(w, r, http.StatusForbidden, "insufficient-scope", "esta llave no tiene el permiso reports:render")
		return
	}
	if k.Clients != nil && (head.OrganizationID == nil || !k.allows(*head.OrganizationID)) {
		problemdetails.Write(w, r, 400, "invalid-client", "esta llave solo arma informes de sus clientes: indica organizationId")
		return
	}
	if a.Reports == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "unavailable", "Reportes no está disponible")
		return
	}
	inner := r.Clone(r.Context())
	inner.Body = io.NopCloser(bytes.NewReader(body))
	inner.ContentLength = int64(len(body))
	inner.SetPathValue("kind", "incident")
	if head.Send {
		a.Reports.Send(w, inner)
		return
	}
	a.Reports.Preview(w, inner)
}
