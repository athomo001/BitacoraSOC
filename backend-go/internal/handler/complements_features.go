package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/complements"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/forward"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Complementos que agregan funciones a la app (10i, spec/11 §12): lo que
// declara complement.json, su aprobación cosa por cosa, la configuración,
// las ranuras de pantalla, API_REQUEST y ADD_NOTE del bridge y, para los
// servicios, la llave de integraciones, los ganchos a eventos y las tareas
// programadas.

// manifestOf lee el complement.json guardado (ya validado al guardarlo).
func manifestOf(c db.Complement) complements.Manifest {
	var m complements.Manifest
	if len(c.Manifest) > 0 {
		_ = json.Unmarshal(c.Manifest, &m)
	}
	return m
}

func effectiveOf(c db.Complement) (complements.Manifest, map[string]bool) {
	m := manifestOf(c)
	return m, m.Effective(c.Approved, c.IsHouse)
}

// ===== complement.json =====

// applyManifest guarda un complement.json nuevo (o ninguno), olvida lo
// aprobado que ya no declara y deja todo al día.
func (h *ComplementsHandler) applyManifest(ctx context.Context, c db.Complement, m *complements.Manifest, actor uuid.UUID) (db.Complement, error) {
	raw := []byte("{}")
	keys := map[string]bool{}
	if m != nil {
		var err error
		if raw, err = json.Marshal(m); err != nil {
			return c, err
		}
		for _, it := range m.Items() {
			keys[it.Key] = true
		}
	}
	approved := []string{}
	for _, k := range c.Approved {
		if keys[k] {
			approved = append(approved, k)
		}
	}
	saved, err := h.Queries.SetComplementManifest(ctx, db.SetComplementManifestParams{ID: c.ID, Manifest: raw, Approved: approved})
	if err != nil {
		return c, err
	}
	return saved, h.syncFeatures(ctx, saved, actor)
}

// fetchManifest pide <servicio>/complement.json. Sin el archivo (404) el
// servicio no declara nada.
func (h *ComplementsHandler) fetchManifest(ctx context.Context, c db.Complement) (*complements.Manifest, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serviceBase(c)+"/"+complements.ManifestFile, nil)
	if err != nil {
		return nil, err
	}
	resp, err := h.httpClient().Do(req)
	if err != nil {
		return nil, errors.New("el servicio no responde")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("el servicio responde %s a /%s", resp.Status, complements.ManifestFile)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10+1))
	if err != nil {
		return nil, errors.New("no se pudo leer " + complements.ManifestFile)
	}
	m, err := complements.ParseManifest(body, true)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// RefreshManifest es POST /api/complements/{slug}/manifest: vuelve a leer
// el complement.json de un servicio (después de actualizarlo).
func (h *ComplementsHandler) RefreshManifest(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	if c.SourceType != db.ComplementSourceManual {
		problemdetails.Write(w, r, http.StatusBadRequest, "not-a-service", "un complemento en ZIP trae su complement.json en el ZIP: sube la versión nueva")
		return
	}
	ctx := r.Context()
	m, err := h.fetchManifest(ctx, c)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadGateway, "manifest-unavailable", err.Error())
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	saved, err := h.applyManifest(ctx, c, m, user.ID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar "+complements.ManifestFile)
		return
	}
	meta := map[string]any{"slug": c.Slug, "declares": len(manifestOf(saved).Items())}
	if m != nil {
		meta["version"] = m.Version
	}
	h.AuditLog.Log(ctx, "complement.manifest", audit.LevelInfo, audit.Success(), meta)
	writeData(w, http.StatusOK, h.detailDTO(ctx, saved))
}

// ===== Aprobación =====

type approvalsRequest struct {
	Approved []string `json:"approved"`
	House    *bool    `json:"house"`
}

// SetApprovals es PUT /api/complements/{slug}/approvals: lo que el admin
// aprueba de lo que declara el complemento, y si es «de la casa».
func (h *ComplementsHandler) SetApprovals(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	var req approvalsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	house := c.IsHouse
	if req.House != nil {
		house = *req.House
	}
	items := map[string]complements.Item{}
	for _, it := range manifestOf(c).Items() {
		items[it.Key] = it
	}
	approved := []string{}
	for _, k := range req.Approved {
		it, ok := items[k]
		switch {
		case !ok:
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el complemento no declara "+k)
			return
		case it.House && !house && !slices.Contains(c.Approved, k):
			problemdetails.Write(w, r, http.StatusBadRequest, "house-only", "la barra superior y las páginas en Administración son solo para complementos de la casa")
			return
		}
		if !slices.Contains(approved, k) {
			approved = append(approved, k)
		}
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	saved, err := h.Queries.SetComplementApprovals(ctx, db.SetComplementApprovalsParams{ID: c.ID, Approved: approved, IsHouse: house})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la aprobación")
		return
	}
	syncErr := h.syncFeatures(ctx, saved, user.ID)
	var added, removed []string
	for _, k := range approved {
		if !slices.Contains(c.Approved, k) {
			added = append(added, k)
		}
	}
	for _, k := range c.Approved {
		if !slices.Contains(approved, k) {
			removed = append(removed, k)
		}
	}
	meta := map[string]any{"slug": c.Slug, "added": added, "removed": removed, "house": house}
	if syncErr != nil {
		meta["syncError"] = syncErr.Error()
	}
	h.AuditLog.Log(ctx, "complement.approvals", audit.LevelWarn, audit.Success(), meta)
	if syncErr != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "sync-failed", "se guardó la aprobación, pero no se pudo preparar todo: "+syncErr.Error())
		return
	}
	writeData(w, http.StatusOK, h.detailDTO(ctx, saved))
}

// syncFeatures deja la llave de integraciones, el destino de eventos y las
// tareas programadas de un servicio como dice lo aprobado. Un complemento
// en ZIP no tiene nada de esto: sus datos van por API_REQUEST.
func (h *ComplementsHandler) syncFeatures(ctx context.Context, c db.Complement, actor uuid.UUID) error {
	if c.SourceType != db.ComplementSourceManual {
		return nil
	}
	m, eff := effectiveOf(c)
	keyEnc, hookEnc := c.IntegrationKeyEncrypted, c.HookSecretEncrypted

	// Llave de la API de integraciones con los permisos de datos aprobados.
	data := m.ApprovedData(eff)
	existing, err := h.Queries.GetComplementAPIKey(ctx, pgtype.UUID{Bytes: c.ID, Valid: true})
	hasKey := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	switch {
	case len(data) == 0 && hasKey:
		if err := h.Queries.RevokeComplementAPIKeys(ctx, db.RevokeComplementAPIKeysParams{ComplementID: pgtype.UUID{Bytes: c.ID, Valid: true},
			RevokedBy: pgtype.UUID{Bytes: actor, Valid: true}, Reason: pgtype.Text{String: "Se quitaron sus permisos de datos", Valid: true}}); err != nil {
			return err
		}
		keyEnc = pgtype.Text{}
	case len(data) > 0 && hasKey && keyEnc.Valid:
		if err := h.Queries.SetAPIKeyScopes(ctx, db.SetAPIKeyScopesParams{ID: existing.ID, Scopes: data}); err != nil {
			return err
		}
	case len(data) > 0:
		if hasKey { // sin la llave guardada no hay cómo dársela: se cambia por una nueva
			_ = h.Queries.RevokeComplementAPIKeys(ctx, db.RevokeComplementAPIKeysParams{ComplementID: pgtype.UUID{Bytes: c.ID, Valid: true},
				RevokedBy: pgtype.UUID{Bytes: actor, Valid: true}, Reason: pgtype.Text{String: "Reemplazada", Valid: true}})
		}
		secret, err := newAPIKeySecret()
		if err != nil {
			return err
		}
		if _, err := h.Queries.CreateComplementAPIKey(ctx, db.CreateComplementAPIKeyParams{Name: c.Name, Description: "Llave del complemento " + c.Slug,
			KeyPrefix: secret[:apiKeyLookupLen], KeyHash: hashAPIKey(secret), Scopes: data, CreatedBy: pgtype.UUID{Bytes: actor, Valid: true},
			ComplementID: pgtype.UUID{Bytes: c.ID, Valid: true}}); err != nil {
			return err
		}
		if keyEnc, err = h.encrypt(secret); err != nil {
			return err
		}
	}

	// Secreto con que se firman los ganchos (eventos y tareas).
	events := m.ApprovedEvents(eff)
	var schedules []complements.Schedule
	for _, s := range m.Schedules {
		if eff["schedule:"+s.Name] {
			schedules = append(schedules, s)
		}
	}
	if (len(events) > 0 || len(schedules) > 0) && !hookEnc.Valid {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		if hookEnc, err = h.encrypt(hex.EncodeToString(b)); err != nil {
			return err
		}
	}
	if keyEnc != c.IntegrationKeyEncrypted || hookEnc != c.HookSecretEncrypted {
		if err := h.Queries.SetComplementCredentials(ctx, db.SetComplementCredentialsParams{ID: c.ID, IntegrationKeyEncrypted: keyEnc, HookSecretEncrypted: hookEnc}); err != nil {
			return err
		}
	}

	// Ganchos a eventos: un destino HTTP interno en la cola de la 10b.
	if len(events) == 0 {
		if err := h.Queries.DeleteComplementDestination(ctx, pgtype.UUID{Bytes: c.ID, Valid: true}); err != nil {
			return err
		}
	} else {
		p := db.UpsertComplementDestinationParams{Name: "Complemento " + c.Name, Url: pgtype.Text{String: serviceBase(c) + "/hooks/events", Valid: true},
			ComplementID: pgtype.UUID{Bytes: c.ID, Valid: true}, Events: events, HmacSecretEncrypted: hookEnc, CreatedBy: pgtype.UUID{Bytes: actor, Valid: true}}
		for _, e := range events {
			switch forward.Classify(e) {
			case forward.GroupEntries:
				p.SendEntries = true
			case forward.GroupEscalation:
				p.SendEscalation = true
			case forward.GroupTickets:
				p.SendTickets = true
			}
		}
		if _, err := h.Queries.UpsertComplementDestination(ctx, p); err != nil {
			return err
		}
	}
	h.Forward.Invalidate()

	// Tareas programadas.
	keep := []string{}
	now := time.Now()
	for _, s := range schedules {
		next, err := complements.NextRun(s, now, h.loc())
		if err != nil {
			return err
		}
		if err := h.Queries.UpsertComplementSchedule(ctx, db.UpsertComplementScheduleParams{ComplementID: c.ID, Name: s.Name,
			NextRunAt: pgtype.Timestamptz{Time: next, Valid: true}}); err != nil {
			return err
		}
		keep = append(keep, s.Name)
	}
	return h.Queries.DeleteComplementSchedulesExcept(ctx, db.DeleteComplementSchedulesExceptParams{ComplementID: c.ID, Keep: keep})
}

func (h *ComplementsHandler) encrypt(plain string) (pgtype.Text, error) {
	if h.Crypto == nil {
		return pgtype.Text{}, errors.New("no hay llave de cifrado configurada")
	}
	enc, err := h.Crypto.Encrypt(plain)
	if err != nil {
		return pgtype.Text{}, err
	}
	return pgtype.Text{String: enc, Valid: true}, nil
}

func (h *ComplementsHandler) decrypt(t pgtype.Text) string {
	if !t.Valid || t.String == "" || h.Crypto == nil {
		return ""
	}
	plain, err := h.Crypto.Decrypt(t.String)
	if err != nil {
		return ""
	}
	return plain
}

func (h *ComplementsHandler) loc() *time.Location {
	if h.Location != nil {
		return h.Location
	}
	return time.Local
}

// ===== Ficha con lo que agrega =====

type featuresDTO struct {
	IntegrationKey *featureKeyDTO       `json:"integrationKey,omitempty"`
	Events         *featureEventsDTO    `json:"events,omitempty"`
	Schedules      []featureScheduleDTO `json:"schedules"`
}

type featureKeyDTO struct {
	Prefix     string     `json:"prefix"`
	Scopes     []string   `json:"scopes"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
}

type featureEventsDTO struct {
	URL        string     `json:"url"`
	LastSentAt *time.Time `json:"lastSentAt"`
	LastError  *string    `json:"lastError"`
}

type featureScheduleDTO struct {
	Name       string     `json:"name"`
	NextRunAt  time.Time  `json:"nextRunAt"`
	LastRunAt  *time.Time `json:"lastRunAt"`
	LastStatus *string    `json:"lastStatus"`
}

// detailDTO es la ficha con el estado de lo que prepara la app.
func (h *ComplementsHandler) detailDTO(ctx context.Context, c db.Complement) complementDTO {
	dto := h.toDTO(c)
	if n, err := h.Queries.CountComplementEntries(ctx, pgtype.UUID{Bytes: c.ID, Valid: true}); err == nil {
		dto.EntriesCount = &n
	}
	if c.SourceType != db.ComplementSourceManual {
		return dto
	}
	f := &featuresDTO{Schedules: []featureScheduleDTO{}}
	id := pgtype.UUID{Bytes: c.ID, Valid: true}
	if k, err := h.Queries.GetComplementAPIKey(ctx, id); err == nil {
		f.IntegrationKey = &featureKeyDTO{Prefix: k.KeyPrefix, Scopes: k.Scopes, LastUsedAt: timestamptzPtr(k.LastUsedAt)}
	}
	if d, err := h.Queries.GetComplementDestination(ctx, id); err == nil {
		f.Events = &featureEventsDTO{URL: d.Url.String, LastSentAt: timestamptzPtr(d.LastSentAt), LastError: textPtr(d.LastError)}
	}
	if rows, err := h.Queries.ListComplementSchedules(ctx, c.ID); err == nil {
		for _, s := range rows {
			f.Schedules = append(f.Schedules, featureScheduleDTO{Name: s.Name, NextRunAt: s.NextRunAt.Time, LastRunAt: timestamptzPtr(s.LastRunAt), LastStatus: textPtr(s.LastStatus)})
		}
	}
	dto.Features = f
	return dto
}

// ===== Configuración =====

// storedSettings es complements.settings: los valores comunes y, de los
// secretos (que van cifrados aparte), solo cuándo se guardaron y cómo
// terminan.
type storedSettings struct {
	Values     map[string]any        `json:"values"`
	SecretMeta map[string]secretMeta `json:"secretMeta"`
}

type secretMeta struct {
	Last4   string    `json:"last4"`
	SavedAt time.Time `json:"savedAt"`
}

func settingsOf(c db.Complement) storedSettings {
	s := storedSettings{}
	_ = json.Unmarshal(c.Settings, &s)
	if s.Values == nil {
		s.Values = map[string]any{}
	}
	if s.SecretMeta == nil {
		s.SecretMeta = map[string]secretMeta{}
	}
	return s
}

func (h *ComplementsHandler) secretsOf(c db.Complement) map[string]string {
	out := map[string]string{}
	if raw := h.decrypt(c.SecretsEncrypted); raw != "" {
		_ = json.Unmarshal([]byte(raw), &out)
	}
	return out
}

// publicSettings son los valores que puede ver el complemento en el
// navegador: todo menos los secretos, con los valores por defecto.
func publicSettings(m complements.Manifest, eff map[string]bool, s storedSettings) map[string]any {
	out := map[string]any{}
	if !eff["settings"] {
		return out
	}
	for _, f := range m.Settings {
		if f.Type == "secret" {
			continue
		}
		if v, ok := s.Values[f.Key]; ok {
			out[f.Key] = v
		} else if f.Default != nil {
			out[f.Key] = f.Default
		}
	}
	return out
}

// GetSettings es GET /api/complements/{slug}/settings.
func (h *ComplementsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	m := manifestOf(c)
	s := settingsOf(c)
	values := map[string]any{}
	secrets := map[string]any{}
	for _, f := range m.Settings {
		if f.Type == "secret" {
			meta, set := s.SecretMeta[f.Key]
			if set {
				secrets[f.Key] = map[string]any{"set": true, "last4": meta.Last4, "savedAt": meta.SavedAt}
			} else {
				secrets[f.Key] = map[string]any{"set": false}
			}
			continue
		}
		if v, ok := s.Values[f.Key]; ok {
			values[f.Key] = v
		} else if f.Default != nil {
			values[f.Key] = f.Default
		}
	}
	fields := m.Settings
	if fields == nil {
		fields = []complements.SettingField{}
	}
	writeData(w, http.StatusOK, map[string]any{"fields": fields, "values": values, "secrets": secrets})
}

type settingsRequest struct {
	Values  map[string]any    `json:"values"`
	Secrets map[string]string `json:"secrets"`
	Clear   []string          `json:"clear"`
}

// PutSettings es PUT /api/complements/{slug}/settings. Un secreto vacío
// queda como estaba; para borrarlo va en clear.
func (h *ComplementsHandler) PutSettings(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	m := manifestOf(c)
	if len(m.Settings) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "no-settings", "este complemento no tiene configuración")
		return
	}
	var req settingsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	s := settingsOf(c)
	secrets := h.secretsOf(c)
	now := time.Now().UTC()
	values := map[string]any{}
	changed := []string{}
	for _, f := range m.Settings {
		if f.Type == "secret" {
			if slices.Contains(req.Clear, f.Key) {
				delete(secrets, f.Key)
				delete(s.SecretMeta, f.Key)
				changed = append(changed, f.Key)
			}
			if v := strings.TrimSpace(req.Secrets[f.Key]); v != "" {
				if len(v) > 2000 {
					problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", f.Label+": hasta 2000 caracteres")
					return
				}
				secrets[f.Key] = v
				last4 := v
				if len(last4) > 4 {
					last4 = last4[len(last4)-4:]
				}
				s.SecretMeta[f.Key] = secretMeta{Last4: last4, SavedAt: now}
				changed = append(changed, f.Key)
			}
			if f.Required && secrets[f.Key] == "" {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", f.Label+" es obligatorio")
				return
			}
			continue
		}
		v, reason := settingValue(f, req.Values[f.Key])
		if reason != "" {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
			return
		}
		if v != nil {
			values[f.Key] = v
		}
		if prev, had := s.Values[f.Key]; !had || fmt.Sprint(prev) != fmt.Sprint(v) {
			changed = append(changed, f.Key)
		}
	}
	s.Values = values
	raw, _ := json.Marshal(s)
	enc := pgtype.Text{}
	if len(secrets) > 0 {
		plain, _ := json.Marshal(secrets)
		var err error
		if enc, err = h.encrypt(string(plain)); err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron cifrar los secretos")
			return
		}
	}
	ctx := r.Context()
	if err := h.Queries.SetComplementSettings(ctx, db.SetComplementSettingsParams{ID: c.ID, Settings: raw, SecretsEncrypted: enc}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración")
		return
	}
	// Los nombres de lo que cambió, nunca los valores.
	h.AuditLog.Log(ctx, "complement.settings", audit.LevelWarn, audit.Success(), map[string]any{"slug": c.Slug, "changed": changed})
	fresh, err := h.Queries.GetComplementByID(ctx, c.ID)
	if err != nil {
		fresh = c
	}
	r.SetPathValue("slug", fresh.Slug)
	h.GetSettings(w, r)
}

// settingValue valida un valor según su tipo. nil = vacío.
func settingValue(f complements.SettingField, v any) (any, string) {
	empty := v == nil || v == ""
	if empty {
		if f.Required {
			return nil, f.Label + " es obligatorio"
		}
		return nil, ""
	}
	switch f.Type {
	case "text":
		s, ok := v.(string)
		if !ok || len([]rune(s)) > 500 {
			return nil, f.Label + ": texto de hasta 500 caracteres"
		}
		return strings.TrimSpace(s), ""
	case "number":
		switch n := v.(type) {
		case float64:
			return n, ""
		case string:
			if x, err := strconv.ParseFloat(strings.TrimSpace(n), 64); err == nil {
				return x, ""
			}
		}
		return nil, f.Label + " es un número"
	case "boolean":
		if b, ok := v.(bool); ok {
			return b, ""
		}
		return nil, f.Label + " es sí o no"
	case "select":
		if s, ok := v.(string); ok && slices.Contains(f.Options, s) {
			return s, ""
		}
		return nil, f.Label + ": elige una de las opciones"
	}
	return nil, ""
}

// ===== Ranuras de pantalla =====

type slotDTO struct {
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	Icon   string `json:"icon"`
	Key    string `json:"key"`
	Module string `json:"module,omitempty"`
	Target string `json:"target,omitempty"`
	Title  string `json:"title"`
}

type slotsDTO struct {
	Pages   []slotDTO `json:"pages"`
	Panels  []slotDTO `json:"panels"`
	Actions []slotDTO `json:"actions"`
	Topbar  *slotDTO  `json:"topbar"`
}

// Slots es GET /api/complements/slots: lo aprobado que esta persona ve en
// los módulos, las fichas, las acciones y la barra superior. Un complemento
// en mantenimiento, apagado o que no responde desaparece (regla del dueño).
func (h *ComplementsHandler) Slots(w http.ResponseWriter, r *http.Request) {
	user, _ := middleware.UserFromContext(r.Context())
	list, err := h.Queries.ListVisibleComplementCandidates(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los complementos")
		return
	}
	groups := h.userGroups(r.Context(), user.ID)
	out := slotsDTO{Pages: []slotDTO{}, Panels: []slotDTO{}, Actions: []slotDTO{}}
	for _, c := range list {
		if c.Status != db.ComplementStatusActive || !visibleTo(c, user.Role, groups) {
			continue
		}
		if c.SourceType == db.ComplementSourceManual {
			if state, _ := h.Breaker.State(c.Slug); state == complements.CircuitOpen {
				continue
			}
		}
		m, eff := effectiveOf(c)
		base := slotDTO{Slug: c.Slug, Name: c.Name, Icon: c.Icon}
		for _, p := range m.Pages {
			if eff["page:"+p.ID] {
				s := base
				s.Key, s.Module, s.Title = "page:"+p.ID, p.Module, p.Title
				out.Pages = append(out.Pages, s)
			}
		}
		for _, p := range m.Panels {
			if eff["panel:"+p.ID] {
				s := base
				s.Key, s.Target, s.Title = "panel:"+p.ID, p.Target, p.Title
				out.Panels = append(out.Panels, s)
			}
		}
		for _, a := range m.Actions {
			if eff["action:"+a.ID] {
				s := base
				s.Key, s.Target, s.Title = "action:"+a.ID, a.Target, a.Title
				out.Actions = append(out.Actions, s)
			}
		}
		// Una barra por instalación: la del primero por nombre.
		if m.Topbar != nil && eff["topbar"] && out.Topbar == nil {
			s := base
			s.Key, s.Title = "topbar", c.Name
			out.Topbar = &s
		}
	}
	writeData(w, http.StatusOK, out)
}

// slotPath es la ruta de una ranura aprobada; ok=false si no lo está.
func slotPath(m complements.Manifest, eff map[string]bool, key string) (path, target string, ok bool) {
	if !eff[key] {
		return "", "", false
	}
	kind, id, _ := strings.Cut(key, ":")
	find := func(list []complements.Slot) (string, string, bool) {
		for _, s := range list {
			if s.ID == id {
				return s.Path, s.Target, true
			}
		}
		return "", "", false
	}
	switch kind {
	case "page":
		return find(m.Pages)
	case "panel":
		return find(m.Panels)
	case "action":
		return find(m.Actions)
	case "topbar":
		if m.Topbar != nil {
			return m.Topbar.Path, "", true
		}
	}
	return "", "", false
}

type embedRequest struct {
	Slot       string `json:"slot"`
	ObjectType string `json:"objectType"`
	ObjectID   string `json:"objectId"`
}

// embedTarget arma la dirección del iframe de una ranura: el archivo que
// declara (o el de entrada) y el objeto abierto en ?object=tipo:id.
func embedTarget(base, entry, slotPathRaw string, object string) string {
	p := strings.TrimLeft(slotPathRaw, "/")
	if p == "" {
		p = strings.TrimLeft(entry, "/")
	}
	u, err := url.Parse(strings.TrimRight(base, "/") + "/" + p)
	if err != nil {
		return strings.TrimRight(base, "/") + "/" + p
	}
	if object != "" {
		q := u.Query()
		q.Set("object", object)
		u.RawQuery = q.Encode()
	}
	return u.String()
}

// readEmbedRequest: el cuerpo es opcional (la pestaña de «Complementos»
// manda nada).
func readEmbedRequest(r *http.Request) (embedRequest, bool) {
	var req embedRequest
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<10))
	if err != nil {
		return req, false
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return req, true
	}
	return req, json.Unmarshal(body, &req) == nil
}

// ===== API_REQUEST y ADD_NOTE (bridge) =====

type apiBridgeRequest struct {
	Method string `json:"method"`
	Path   string `json:"path"`
}

// bridgeRoute: lo que un complemento en el navegador puede leer por
// API_REQUEST. Solo lectura: escribir va por CREATE_ENTRY y ADD_NOTE, a
// nombre de la persona.
func (h *ComplementsHandler) bridgeRoute(path string) (scope string, param string, value string, run func(http.ResponseWriter, *http.Request, apiKeyCaller)) {
	a := h.API
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) == 1 && parts[0] == "entries":
		return "entries:read", "", "", a.ListEntries
	case len(parts) == 2 && parts[0] == "entries":
		return "entries:read", "id", parts[1], a.GetEntry
	case len(parts) == 1 && parts[0] == "tickets":
		return "tickets:read", "", "", a.ListTickets
	case len(parts) == 2 && parts[0] == "tickets":
		return "tickets:read", "ref", parts[1], a.GetTicket
	case len(parts) == 1 && parts[0] == "clients":
		return "clients:read", "", "", a.ListClients
	}
	return "", "", "", nil
}

// APIRequest es POST /api/complements/{slug}/api: el mensaje API_REQUEST
// del bridge. La app pide a la API de integraciones como la persona que
// tiene abierto el complemento y con los permisos de datos aprobados: un
// informe nunca muestra más de lo que esa persona ve.
func (h *ComplementsHandler) APIRequest(w http.ResponseWriter, r *http.Request) {
	c, user, ok := h.visibleComplement(w, r)
	if !ok {
		return
	}
	if h.API == nil {
		problemdetails.Write(w, r, http.StatusServiceUnavailable, "unavailable", "la API de integraciones no está disponible")
		return
	}
	var req apiBridgeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.Method != "" && !strings.EqualFold(req.Method, http.MethodGet) {
		problemdetails.Write(w, r, http.StatusMethodNotAllowed, "read-only", "API_REQUEST solo lee (GET); para escribir usa CREATE_ENTRY o ADD_NOTE")
		return
	}
	u, err := url.Parse(strings.TrimSpace(req.Path))
	if err != nil || !strings.HasPrefix(u.Path, "/") || u.Host != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "path es una ruta de /api/v1, por ejemplo /tickets?status=new")
		return
	}
	p := strings.TrimPrefix(u.Path, "/api/v1")
	scope, param, value, run := h.bridgeRoute(p)
	if run == nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "API_REQUEST no conoce "+p)
		return
	}
	m, eff := effectiveOf(c)
	if !eff["data:"+scope] {
		problemdetails.Write(w, r, http.StatusForbidden, "insufficient-scope", "el complemento no tiene aprobado "+scope)
		return
	}
	ctx := r.Context()
	scopeOfUser, err := loadTicketScope(ctx, h.Queries)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return
	}
	caller := apiKeyCaller{Name: c.Name, Scopes: m.ApprovedData(eff), Creator: user.ID, CreatorName: user.Username, Areas: scopeOfUser.visible()}
	inner := r.Clone(ctx)
	inner.Method = http.MethodGet
	inner.URL = &url.URL{Path: "/api/v1" + p, RawQuery: u.RawQuery}
	inner.Body = http.NoBody
	inner.ContentLength = 0
	if param != "" {
		inner.SetPathValue(param, value)
	}
	run(w, inner, caller)
}

type noteRequest struct {
	Target  string `json:"target"`
	ID      string `json:"id"`
	Content string `json:"content"`
}

// AddNote es POST /api/complements/{slug}/note: el mensaje ADD_NOTE. Deja un
// seguimiento en la entrada o un comentario interno en el ticket, a nombre
// de la persona y firmado con el complemento. Solo donde el complemento se
// muestra (una pestaña o una acción aprobada para ese tipo de ficha).
func (h *ComplementsHandler) AddNote(w http.ResponseWriter, r *http.Request) {
	c, user, ok := h.visibleComplement(w, r)
	if !ok {
		return
	}
	var req noteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	content := strings.TrimSpace(req.Content)
	id, idErr := uuid.Parse(req.ID)
	if content == "" || len([]rune(content)) > 20000 || idErr != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "content (hasta 20000 caracteres) e id son obligatorios")
		return
	}
	m, eff := effectiveOf(c)
	shown := false
	for _, list := range []struct {
		kind  string
		slots []complements.Slot
	}{{"panel", m.Panels}, {"action", m.Actions}} {
		for _, s := range list.slots {
			if s.Target == req.Target && eff[list.kind+":"+s.ID] {
				shown = true
			}
		}
	}
	if !shown || (req.Target != "entry" && req.Target != "ticket") {
		problemdetails.Write(w, r, http.StatusForbidden, "not-approved", "el complemento no tiene una pestaña ni una acción aprobada en esa ficha")
		return
	}
	ctx := r.Context()
	if req.Target == "entry" {
		if _, err := h.Queries.GetEntry(ctx, id); err != nil {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
			return
		}
		comment, err := h.Queries.CreateEntryComment(ctx, db.CreateEntryCommentParams{EntryID: id, UserID: user.ID, Comment: content,
			Via: pgtype.Text{String: c.Name, Valid: true}})
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar el seguimiento")
			return
		}
		h.AuditLog.Log(ctx, "entry.comment_added", audit.LevelInfo, audit.Success(), map[string]any{"entryId": id.String(), "commentId": comment.ID.String(), "complement": c.Slug})
		writeData(w, http.StatusCreated, map[string]any{"id": comment.ID})
		return
	}
	if h.Tickets == nil {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la Ticketera está desactivada")
		return
	}
	if on, err := h.Tickets.Enabled(ctx); err != nil || !on {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la Ticketera está desactivada")
		return
	}
	t, err := h.Queries.GetTicket(ctx, id)
	scope, scopeErr := loadTicketScope(ctx, h.Queries)
	if err != nil || scopeErr != nil || !scope.canView(t.AreaID, t.RequestedAreaID) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "ticket no encontrado")
		return
	}
	if isGlpiTicket(t) || t.MergedIntoID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "ticket-readonly", "este ticket no recibe comentarios aquí")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar el comentario")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	comment, err := h.Tickets.addTicketCommentFrom(ctx, h.Queries.WithTx(tx), t, user, content, false, "complement:"+c.Name)
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar el comentario")
		return
	}
	h.Tickets.afterComment(ctx, t, user.ID, content, false)
	h.AuditLog.Log(ctx, "ticket.comment_added", audit.LevelInfo, audit.Success(), map[string]any{"ticketId": t.ID.String(), "public": false, "complement": c.Slug})
	h.Tickets.notifyChanged(ctx, t.ID)
	writeData(w, http.StatusCreated, map[string]any{"id": comment.ID})
}

// ===== Tareas programadas =====

// RunSchedules dispara las tareas que tocan (planificador, cada 30 s). Un
// solo nodo las toma; el resultado queda en la ficha y en la auditoría si
// falla.
func (h *ComplementsHandler) RunSchedules(ctx context.Context) error {
	if on, err := h.Enabled(ctx); err != nil || !on {
		return err
	}
	due, err := h.Queries.ListDueComplementSchedules(ctx)
	if err != nil {
		return err
	}
	for _, d := range due {
		s, err := h.Queries.AcquireComplementSchedule(ctx, db.AcquireComplementScheduleParams{ComplementID: d.ComplementID, Name: d.Name,
			Owner: pgtype.Text{String: h.Owner, Valid: true}})
		if err != nil {
			continue // la tomó otro nodo
		}
		c, err := h.Queries.GetComplementByID(ctx, s.ComplementID)
		if err != nil {
			continue
		}
		m, eff := effectiveOf(c)
		var def *complements.Schedule
		for i := range m.Schedules {
			if m.Schedules[i].Name == s.Name && eff["schedule:"+s.Name] {
				def = &m.Schedules[i]
			}
		}
		now := time.Now()
		next := now.Add(time.Hour)
		status := "sin aprobar"
		if def != nil {
			if n, err := complements.NextRun(*def, now, h.loc()); err == nil {
				next = n
			}
			body, _ := json.Marshal(map[string]any{"name": s.Name, "scheduledAt": s.NextRunAt.Time.UTC(), "firedAt": now.UTC()})
			status = h.callHook(ctx, c, "/hooks/schedule/"+url.PathEscape(s.Name), body)
			if status != "ok" {
				h.AuditLog.Log(ctx, "complement.schedule.failed", audit.LevelWarn, audit.Failure(status), map[string]any{"slug": c.Slug, "schedule": s.Name})
			}
		}
		_ = h.Queries.FinishComplementSchedule(ctx, db.FinishComplementScheduleParams{ComplementID: s.ComplementID, Name: s.Name,
			NextRunAt: pgtype.Timestamptz{Time: next, Valid: true}, Status: pgtype.Text{String: status, Valid: true}})
	}
	return nil
}

// callHook hace un POST firmado al servicio (como los eventos, ver
// forward.Sign) y devuelve «ok» o el motivo.
func (h *ComplementsHandler) callHook(ctx context.Context, c db.Complement, path string, body []byte) string {
	secret := h.decrypt(c.HookSecretEncrypted)
	if secret == "" {
		return "sin secreto de firma: vuelve a aprobar la tarea"
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceBase(c)+path, bytes.NewReader(body))
	if err != nil {
		return "dirección inválida"
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "BitacoraOps-Complements/1")
	req.Header.Set("X-Bitacora-Timestamp", ts)
	req.Header.Set("X-Bitacora-Signature", forward.Sign(secret, ts, body))
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return "no responde"
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	_ = resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "responde " + resp.Status
	}
	return "ok"
}
