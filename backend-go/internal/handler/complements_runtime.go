package handler

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/complements"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/reminders"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// RuntimeAPI es la "Complement Runtime API" (spec/11 §5.4): la ruta y el
// formato de la API interna v1 del legacy, para que complement-stub y los
// servicios existentes funcionen sin cambios. Se autentica con el token de
// aplicación del complemento, nunca con una sesión de usuario.
type RuntimeAPI struct {
	Complements *ComplementsHandler
	// Limiter: 200 llamadas cada 15 minutos por complemento (legacy).
	Limiter    *ratelimit.APILimiter
	AppVersion string
}

type runtimeCtxKey struct{}

// Versions es GET /api/internal/versions (descubrimiento, sin token).
func (a *RuntimeAPI) Versions(w http.ResponseWriter, _ *http.Request) {
	writeLegacyJSON(w, http.StatusOK, map[string]any{
		"versions": []map[string]any{{"version": "v1", "status": "current", "sunset": nil}},
		"latest":   "v1",
	})
}

// Auth valida el token de aplicación y, si pide scope, que lo tenga.
func (a *RuntimeAPI) Auth(scope string, next func(http.ResponseWriter, *http.Request, db.Complement)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-API-Version", "v1")
		w.Header().Set("X-API-Latest", "v1")
		h := a.Complements
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || strings.TrimSpace(raw) == "" {
			writeLegacyError(w, http.StatusUnauthorized, "Application token requerido")
			return
		}
		raw = strings.TrimSpace(raw)
		slug, err := h.JWT.VerifyComplement(raw)
		if err != nil {
			a.deny(r.Context(), "", "token inválido o vencido", http.StatusUnauthorized)
			writeLegacyError(w, http.StatusUnauthorized, "Application token inválido")
			return
		}
		if on, _ := h.Enabled(r.Context()); !on {
			writeLegacyError(w, http.StatusForbidden, "Los complementos están desactivados")
			return
		}
		c, err := h.Queries.GetComplementBySlug(r.Context(), slug)
		if err != nil || c.Status == db.ComplementStatusDisabled {
			a.deny(r.Context(), slug, "complemento inexistente o apagado", http.StatusUnauthorized)
			writeLegacyError(w, http.StatusUnauthorized, "Complemento inactivo o inexistente")
			return
		}
		sum := sha256.Sum256([]byte(raw))
		if !c.TokenHash.Valid || subtle.ConstantTimeCompare([]byte(c.TokenHash.String), []byte(hex.EncodeToString(sum[:]))) != 1 {
			a.deny(r.Context(), slug, "token revocado", http.StatusUnauthorized)
			writeLegacyError(w, http.StatusUnauthorized, "Token revocado")
			return
		}
		if state, _ := h.Breaker.State(slug); state == complements.CircuitOpen {
			writeLegacyError(w, http.StatusServiceUnavailable, "Complemento en mantenimiento")
			return
		}
		if a.Limiter != nil && !a.Limiter.Allow("complement:"+slug) {
			a.deny(r.Context(), slug, "límite de llamadas excedido", http.StatusTooManyRequests)
			writeLegacyError(w, http.StatusTooManyRequests, "Rate limit excedido para el complemento")
			return
		}
		if scope != "" && !slices.Contains(c.Scopes, scope) {
			a.deny(r.Context(), slug, "sin el permiso "+scope, http.StatusForbidden)
			writeLegacyError(w, http.StatusForbidden, "El complemento no tiene el permiso "+scope)
			return
		}
		next(w, r, c)
	})
}

func (a *RuntimeAPI) deny(ctx context.Context, slug, reason string, status int) {
	a.Complements.AuditLog.Log(ctx, "complement.api.denied", audit.LevelWarn, audit.Failure(reason), map[string]any{"slug": slug, "status": status})
}

func requireCollection(w http.ResponseWriter, c db.Complement, collection string) bool {
	if slices.Contains(c.AllowedCollections, collection) {
		return true
	}
	writeLegacyError(w, http.StatusForbidden, "Colección no autorizada: "+collection)
	return false
}

// Context es GET /api/internal/v1/context: turno en curso, módulos activos
// e instalación, sin datos personales.
func (a *RuntimeAPI) Context(w http.ResponseWriter, r *http.Request, c db.Complement) {
	q := a.Complements.Queries
	out := map[string]any{"version": "v1", "appVersion": a.AppVersion, "requestId": r.Header.Get("X-Request-Id"), "shift": nil}
	if cfg, err := q.GetAppConfig(r.Context()); err == nil {
		out["modules"] = map[string]bool{"soc": cfg.SocModuleEnabled, "noc": cfg.NocModuleEnabled}
	}
	shifts, _ := q.ListWorkShifts(r.Context(), pgtype.Bool{Bool: true, Valid: true})
	now := time.Now()
	for _, s := range shifts {
		sh := reminderShift(s)
		local := now.In(sh.Location)
		if reminders.InProgress(local.Hour()*60+local.Minute(), sh.StartMinute, sh.EndMinute) {
			out["shift"] = map[string]any{
				"shiftId": s.ID, "shiftName": s.Name, "timezone": s.Timezone,
				"startTime": timeOfDayToString(s.StartTime), "endTime": timeOfDayToString(s.EndTime),
				// En 2.0 los turnos no tienen usuarios asignados (legacy: assignedUsers).
				"assignedUsers": []any{},
			}
			break
		}
	}
	writeLegacyJSON(w, http.StatusOK, out)
}

// LogEntry es POST /api/internal/v1/log-entry: crea una entrada marcada con
// el complemento, a nombre del admin que lo registró.
func (a *RuntimeAPI) LogEntry(w http.ResponseWriter, r *http.Request, c db.Complement) {
	if !requireCollection(w, c, "entries") {
		return
	}
	if !c.CreatedBy.Valid {
		writeLegacyError(w, http.StatusConflict, "El complemento no tiene un administrador responsable: vuelve a registrarlo")
		return
	}
	var req complementEntryRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeLegacyError(w, http.StatusBadRequest, "Cuerpo inválido")
		return
	}
	entry, reason, err := createComplementEntry(r.Context(), a.Complements.Queries, c, c.CreatedBy.Bytes, req)
	if reason != "" {
		writeLegacyError(w, http.StatusBadRequest, reason)
		return
	}
	if err != nil {
		writeLegacyError(w, http.StatusInternalServerError, "No se pudo crear la entrada")
		return
	}
	a.Complements.AuditLog.Log(r.Context(), "complement.api.log_entry", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug, "entryId": entry.ID.String()})
	writeLegacyJSON(w, http.StatusCreated, map[string]any{
		"_id": entry.ID, "id": entry.ID, "content": entry.Content, "entryType": entry.EntryType, "tags": entry.Tags,
		"ownerComplementId": c.Slug, "createdByUsername": "complement:" + c.Slug, "createdAt": entry.CreatedAt.Time,
	})
}

// QueryGeneral es GET /api/internal/v1/query-general?collection=&limit=.
func (a *RuntimeAPI) QueryGeneral(w http.ResponseWriter, r *http.Request, c db.Complement) {
	collection := strings.TrimSpace(r.URL.Query().Get("collection"))
	if collection == "auditlogs" {
		collection = "audit_log"
	}
	if collection == "" || !slices.Contains(c.AllowedCollections, collection) {
		writeLegacyError(w, http.StatusBadRequest, "collection no autorizada o no especificada")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 20
	}
	limit = min(limit, 100)
	q := a.Complements.Queries
	var items any
	var err error
	switch collection {
	case "entries":
		items, err = q.ListRecentEntriesForComplement(r.Context(), int32(limit))
	case "audit_log":
		items, err = q.ListRecentAuditForComplement(r.Context(), int32(limit))
	case "shared_storage":
		var rows []db.ComplementStorage
		rows, err = q.ListComplementStorage(r.Context(), db.ListComplementStorageParams{ComplementID: c.ID})
		if len(rows) > limit {
			rows = rows[:limit]
		}
		items = storageItems(rows)
	}
	if err != nil {
		writeLegacyError(w, http.StatusInternalServerError, "No se pudo consultar")
		return
	}
	writeLegacyJSON(w, http.StatusOK, map[string]any{"collection": collection, "items": items})
}

func storageItems(rows []db.ComplementStorage) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, s := range rows {
		out = append(out, map[string]any{"key": s.Key, "value": json.RawMessage(s.Value), "updatedVia": s.UpdatedVia, "updatedAt": s.UpdatedAt.Time})
	}
	return out
}

var storageKeyRe = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,120}$`)

// StoragePut es POST /api/internal/v1/storage {key, value, metadata}.
func (a *RuntimeAPI) StoragePut(w http.ResponseWriter, r *http.Request, c db.Complement) {
	if !requireCollection(w, c, "shared_storage") {
		return
	}
	var req struct {
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBrowserState+1)).Decode(&req); err != nil {
		writeLegacyError(w, http.StatusBadRequest, "Cuerpo inválido (máximo 1 MB)")
		return
	}
	req.Key = strings.TrimSpace(req.Key)
	if !storageKeyRe.MatchString(req.Key) || req.Key == browserStateKey {
		writeLegacyError(w, http.StatusBadRequest, "key inválida")
		return
	}
	if len(req.Value) == 0 {
		req.Value = json.RawMessage("null")
	}
	rec, err := a.Complements.Queries.UpsertComplementStorage(r.Context(), db.UpsertComplementStorageParams{
		ComplementID: c.ID, Key: req.Key, Value: req.Value, UpdatedVia: "runtime_api",
	})
	if err != nil {
		writeLegacyError(w, http.StatusInternalServerError, "No se pudo guardar")
		return
	}
	a.Complements.AuditLog.Log(r.Context(), "complement.api.storage", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug, "key": req.Key, "bytes": len(req.Value)})
	writeLegacyJSON(w, http.StatusCreated, storageItems([]db.ComplementStorage{rec})[0])
}

// StorageGet es GET /api/internal/v1/storage[?key=].
func (a *RuntimeAPI) StorageGet(w http.ResponseWriter, r *http.Request, c db.Complement) {
	if !requireCollection(w, c, "shared_storage") {
		return
	}
	params := db.ListComplementStorageParams{ComplementID: c.ID}
	if key := strings.TrimSpace(r.URL.Query().Get("key")); key != "" {
		params.Key = pgtype.Text{String: key, Valid: true}
	}
	rows, err := a.Complements.Queries.ListComplementStorage(r.Context(), params)
	if err != nil {
		writeLegacyError(w, http.StatusInternalServerError, "No se pudo leer")
		return
	}
	writeLegacyJSON(w, http.StatusOK, map[string]any{"items": storageItems(rows)})
}

var eventNameClean = regexp.MustCompile(`[^a-z0-9._-]`)

// Log es POST /api/internal/v1/log {event, level, message, metadata}: un
// evento en la auditoría con el nombre del complemento.
func (a *RuntimeAPI) Log(w http.ResponseWriter, r *http.Request, c db.Complement) {
	var req struct {
		Event    string         `json:"event"`
		Level    string         `json:"level"`
		Message  string         `json:"message"`
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		writeLegacyError(w, http.StatusBadRequest, "Cuerpo inválido")
		return
	}
	event := eventNameClean.ReplaceAllString(strings.ToLower(strings.TrimSpace(req.Event)), "_")
	if event == "" {
		event = "event"
	}
	if len(event) > 60 {
		event = event[:60]
	}
	level := audit.LevelInfo
	switch req.Level {
	case "warn", "warning":
		level = audit.LevelWarn
	case "error":
		level = audit.LevelError
	}
	msg := req.Message
	if len([]rune(msg)) > 500 {
		msg = string([]rune(msg)[:500])
	}
	a.Complements.AuditLog.Log(r.Context(), "complement."+c.Slug+"."+event, level, audit.Success(), map[string]any{
		"slug": c.Slug, "message": msg, "metadata": req.Metadata,
	})
	writeLegacyJSON(w, http.StatusAccepted, map[string]string{"message": "Log recibido"})
}
