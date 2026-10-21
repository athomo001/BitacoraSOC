package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/forward"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Importación de equipos desde GLPI (spec/16 §5.1, 9.6; diseño aprobado por
// el dueño 2026-10-15). Va detrás de system_features.glpi_sync y la ve solo
// el admin (Administración → GLPI). Reglas del dueño:
//   - Se traen computadores y equipos de red; cada equipo guarda su ID de
//     GLPI y al reimportar se actualiza, nunca se duplica.
//   - GLPI manda en sus campos (nombre, serie, modelo, SO, CPU, RAM, disco,
//     IP, cliente por entidad, localidad por ubicación) cuando trae el dato;
//     lo propio de la Bitácora (área, responsables, rack, otros datos,
//     historial) no se toca. Lo creado en la app no se toca.
//   - Lo borrado o en la papelera de GLPI pasa a inactivo, nunca se borra;
//     si vuelve, se reactiva solo.
//   - Seguro: una corrida incompleta no da de baja nada, y la automática no
//     aplica bajas si «desaparece» más del 10 % de lo importado.

const glpiFeature = "glpi_sync"

// GlpiHandler atiende /api/glpi/*: la importación de equipos (aquí) y los
// tickets de GLPI en la Ticketera (glpi_tickets.go), con sus corridas automáticas.
type GlpiHandler struct {
	Queries   *db.Queries
	Crypto    *crypto.Box
	AuditLog  *audit.Logger
	Notify    *Notifier
	Inventory *InventoryHandler
	Now       func() time.Time
	// Open abre la sesión con GLPI (en las pruebas, un GLPI falso).
	Open func(context.Context, glpi.Config) (*glpi.Session, error)
	// Hub avisa por SSE que llegaron tickets de GLPI (la Ticketera se refresca).
	Hub eventPublisher
	// Forward manda al SIEM los tickets de GLPI que llegaron o cambiaron (spec/19).
	Forward *forward.Emitter
	// SyncWait: «Sincronizar ahora» espera a que termine (en las pruebas).
	SyncWait bool

	running        sync.Mutex
	ticketsRunning sync.Mutex
}

func (h *GlpiHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// RequireEnabled corta con 403 si la funcionalidad está apagada: la sección
// desaparece del menú y la API no responde (se evalúa por request).
func (h *GlpiHandler) RequireEnabled(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !featureEnabled(r.Context(), h.Queries, glpiFeature) {
			problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "la sincronización con GLPI está apagada (Administración → Funcionalidades)")
			return
		}
		next(w, r)
	}
}

// ===== Configuración =====

type glpiEntityRule struct {
	OrganizationID *uuid.UUID `json:"organizationId"`
	Skip           bool       `json:"skip"`
}

type glpiConfigDTO struct {
	URL             string                    `json:"url"`
	HasAppToken     bool                      `json:"hasAppToken"`
	HasUserToken    bool                      `json:"hasUserToken"`
	VerifyTLS       bool                      `json:"verifyTls"`
	TimeoutSeconds  int32                     `json:"timeoutSeconds"`
	ImportComputers bool                      `json:"importComputers"`
	ImportNetwork   bool                      `json:"importNetwork"`
	AreaID          *uuid.UUID                `json:"areaId"`
	ComputerTypes   map[string]string         `json:"computerTypes"`
	Entities        map[string]glpiEntityRule `json:"entities"`
	AutoMode        string                    `json:"autoMode"`
	NextAutoAt      *time.Time                `json:"nextAutoAt,omitempty"`
	LastTest        *glpiTestDTO              `json:"lastTest,omitempty"`
}

type glpiTestDTO struct {
	At          time.Time         `json:"at"`
	OK          bool              `json:"ok"`
	Version     string            `json:"version,omitempty"`
	User        string            `json:"user,omitempty"`
	Entities    int               `json:"entities"`
	Computers   int               `json:"computers"`
	Network     int               `json:"network"`
	Explanation *glpi.Explanation `json:"explanation,omitempty"`
}

func decodeComputerTypes(raw []byte) map[string]string {
	out := map[string]string{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func decodeEntityRules(raw []byte) map[string]glpiEntityRule {
	out := map[string]glpiEntityRule{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func (h *GlpiHandler) location(ctx context.Context) *time.Location {
	if s, err := h.Queries.GetAgendaSettings(ctx); err == nil {
		if loc, err := time.LoadLocation(s.Timezone); err == nil {
			return loc
		}
	}
	return time.Local
}

// nextAuto: cuándo toca la próxima importación automática (nil si está apagada).
func (h *GlpiHandler) nextAuto(ctx context.Context, cfg db.GlpiConfig) *time.Time {
	now := h.now()
	switch cfg.AutoMode {
	case "night":
		local := now.In(h.location(ctx))
		at := time.Date(local.Year(), local.Month(), local.Day(), 2, 0, 0, 0, local.Location())
		if !local.Before(at) && cfg.LastAutoAt.Valid && !cfg.LastAutoAt.Time.Before(at) {
			at = at.AddDate(0, 0, 1)
		}
		return &at
	case "6h":
		at := now
		if cfg.LastAutoAt.Valid && cfg.LastAutoAt.Time.Add(6*time.Hour).After(now) {
			at = cfg.LastAutoAt.Time.Add(6 * time.Hour)
		}
		return &at
	}
	return nil
}

func (h *GlpiHandler) configDTO(ctx context.Context, cfg db.GlpiConfig) glpiConfigDTO {
	d := glpiConfigDTO{URL: cfg.ApiUrl, HasAppToken: cfg.AppTokenEncrypted.Valid && cfg.AppTokenEncrypted.String != "",
		HasUserToken: cfg.UserTokenEncrypted.Valid && cfg.UserTokenEncrypted.String != "", VerifyTLS: cfg.VerifyTls,
		TimeoutSeconds: cfg.TimeoutSeconds, ImportComputers: cfg.ImportComputers, ImportNetwork: cfg.ImportNetwork,
		AreaID: uuidPtr(cfg.AreaID), ComputerTypes: decodeComputerTypes(cfg.ComputerTypes), Entities: decodeEntityRules(cfg.Entities),
		AutoMode: cfg.AutoMode, NextAutoAt: h.nextAuto(ctx, cfg)}
	if cfg.LastTestAt.Valid {
		t := glpiTestDTO{}
		_ = json.Unmarshal(cfg.LastTest, &t)
		t.At, t.OK = cfg.LastTestAt.Time, cfg.LastTestOk.Bool
		d.LastTest = &t
	}
	return d
}

// GetConfig es GET /api/glpi/config. Los tokens nunca se devuelven.
func (h *GlpiHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Queries.GetGlpiConfig(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	writeData(w, http.StatusOK, h.configDTO(r.Context(), cfg))
}

type putGlpiConfigRequest struct {
	URL             string                    `json:"url"`
	AppToken        *string                   `json:"appToken"`
	UserToken       *string                   `json:"userToken"`
	VerifyTLS       bool                      `json:"verifyTls"`
	TimeoutSeconds  int32                     `json:"timeoutSeconds"`
	ImportComputers bool                      `json:"importComputers"`
	ImportNetwork   bool                      `json:"importNetwork"`
	AreaID          *uuid.UUID                `json:"areaId"`
	ComputerTypes   map[string]string         `json:"computerTypes"`
	Entities        map[string]glpiEntityRule `json:"entities"`
	AutoMode        string                    `json:"autoMode"`
}

// PutConfig es PUT /api/glpi/config. Un token sin enviar (o vacío) se
// conserva: no se puede borrar sin querer.
func (h *GlpiHandler) PutConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req putGlpiConfigRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	cur, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	apiURL := ""
	if strings.TrimSpace(req.URL) != "" {
		if apiURL, err = glpi.NormalizeURL(req.URL); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-url", err.Error())
			return
		}
	}
	if req.TimeoutSeconds == 0 {
		req.TimeoutSeconds = 8
	}
	if req.TimeoutSeconds < 2 || req.TimeoutSeconds > 60 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el tiempo de espera va de 2 a 60 segundos")
		return
	}
	if req.AutoMode == "" {
		req.AutoMode = "off"
	}
	if req.AutoMode != "off" && req.AutoMode != "night" && req.AutoMode != "6h" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "importación automática: off, night o 6h")
		return
	}
	if req.AreaID != nil {
		ok := false
		if areas, err := h.Queries.ListTicketAreas(ctx); err == nil {
			for _, a := range areas {
				ok = ok || a.ID == *req.AreaID
			}
		}
		if !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-area", "el área dueña de lo importado no existe o está inactiva")
			return
		}
	}
	types := map[string]string{}
	for name, kind := range req.ComputerTypes {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, err := h.Queries.GetAssetKind(ctx, kind); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-kind", "tipo de equipo desconocido: "+kind)
			return
		}
		types[name] = kind
	}
	entities := map[string]glpiEntityRule{}
	for id, rule := range req.Entities {
		if _, err := strconv.Atoi(id); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "entidad de GLPI inválida: "+id)
			return
		}
		if rule.OrganizationID != nil || rule.Skip {
			entities[id] = rule
		}
	}
	token := func(in *string, current pgtype.Text) (pgtype.Text, bool, error) {
		if in == nil || strings.TrimSpace(*in) == "" {
			return current, false, nil
		}
		enc, err := h.Crypto.Encrypt(strings.TrimSpace(*in))
		return pgtype.Text{String: enc, Valid: true}, true, err
	}
	appTok, appChanged, err1 := token(req.AppToken, cur.AppTokenEncrypted)
	userTok, userChanged, err2 := token(req.UserToken, cur.UserTokenEncrypted)
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron cifrar los tokens")
		return
	}
	typesRaw, _ := json.Marshal(types)
	entitiesRaw, _ := json.Marshal(entities)
	if err := h.Queries.UpdateGlpiConfig(ctx, db.UpdateGlpiConfigParams{ApiUrl: apiURL, AppTokenEncrypted: appTok, UserTokenEncrypted: userTok,
		VerifyTls: req.VerifyTLS, TimeoutSeconds: req.TimeoutSeconds, ImportComputers: req.ImportComputers, ImportNetwork: req.ImportNetwork,
		AreaID: optionalUUID(req.AreaID), ComputerTypes: typesRaw, Entities: entitiesRaw, AutoMode: req.AutoMode}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración de GLPI")
		return
	}
	h.AuditLog.Log(ctx, "config.glpi.update", audit.LevelWarn, audit.Success(), map[string]any{
		"url": apiURL, "appTokenChanged": appChanged, "userTokenChanged": userChanged, "verifyTls": req.VerifyTLS, "autoMode": req.AutoMode,
		"importComputers": req.ImportComputers, "importNetwork": req.ImportNetwork,
	})
	h.GetConfig(w, r)
}

// connection arma la conexión con los tokens descifrados.
func (h *GlpiHandler) connection(cfg db.GlpiConfig) (glpi.Config, error) {
	if cfg.ApiUrl == "" || !cfg.UserTokenEncrypted.Valid || cfg.UserTokenEncrypted.String == "" {
		return glpi.Config{}, errors.New("falta configurar la URL y el User-Token de GLPI")
	}
	user, err := h.Crypto.Decrypt(cfg.UserTokenEncrypted.String)
	if err != nil {
		return glpi.Config{}, errors.New("no se pudo descifrar el User-Token: vuelve a escribirlo")
	}
	app := ""
	if cfg.AppTokenEncrypted.Valid && cfg.AppTokenEncrypted.String != "" {
		if app, err = h.Crypto.Decrypt(cfg.AppTokenEncrypted.String); err != nil {
			return glpi.Config{}, errors.New("no se pudo descifrar el App-Token: vuelve a escribirlo")
		}
	}
	return glpi.Config{URL: cfg.ApiUrl, AppToken: app, UserToken: user, VerifyTLS: cfg.VerifyTls, Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second}, nil
}

func (h *GlpiHandler) open(ctx context.Context, cfg db.GlpiConfig) (*glpi.Session, error) {
	conn, err := h.connection(cfg)
	if err != nil {
		return nil, err
	}
	if h.Open != nil {
		return h.Open(ctx, conn)
	}
	return glpi.Open(ctx, conn)
}

func explain(err error) *glpi.Explanation {
	if strings.HasPrefix(err.Error(), "falta configurar") || strings.HasPrefix(err.Error(), "no se pudo descifrar") {
		return &glpi.Explanation{Error: err.Error(), Cause: "La conexión no está completa.", Next: "Completa la URL y los tokens y guarda.", Raw: err.Error()}
	}
	ex := glpi.Explain(err)
	return &ex
}

// Test es POST /api/glpi/test: prueba la conexión guardada.
func (h *GlpiHandler) Test(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	res := glpiTestDTO{At: h.now()}
	s, err := h.open(ctx, cfg)
	if err == nil {
		res, err = h.probe(ctx, s, res)
		s.Close()
	}
	if err != nil {
		res.OK, res.Explanation = false, explain(err)
	} else {
		res.OK = true
	}
	raw, _ := json.Marshal(res)
	_ = h.Queries.RecordGlpiTest(ctx, db.RecordGlpiTestParams{Ok: pgtype.Bool{Bool: res.OK, Valid: true}, Result: raw})
	outcome := audit.Success()
	if !res.OK {
		outcome = audit.Failure(res.Explanation.Raw)
	}
	h.AuditLog.Log(ctx, "config.glpi.test", audit.LevelInfo, outcome, nil)
	writeData(w, http.StatusOK, res)
}

// probe lee quién es el usuario, cuántas entidades ve y cuántos equipos hay.
func (h *GlpiHandler) probe(ctx context.Context, s *glpi.Session, res glpiTestDTO) (glpiTestDTO, error) {
	var full struct {
		Session map[string]any `json:"session"`
	}
	if err := s.Get(ctx, "getFullSession", nil, &full); err != nil {
		return res, err
	}
	res.User = glpi.Str(full.Session["glpiname"])
	var my struct {
		MyEntities []any `json:"myentities"`
	}
	if err := s.Get(ctx, "getMyEntities", nil, &my); err == nil {
		res.Entities = len(my.MyEntities)
	}
	var cfg struct {
		CfgGlpi map[string]any `json:"cfg_glpi"`
	}
	if err := s.Get(ctx, "getGlpiConfig", nil, &cfg); err == nil {
		res.Version = glpi.Str(cfg.CfgGlpi["version"])
	}
	var err error
	if res.Computers, err = s.Count(ctx, glpi.Computer); err != nil {
		return res, err
	}
	if res.Network, err = s.Count(ctx, glpi.NetworkEquipment); err != nil {
		return res, err
	}
	return res, nil
}

// Catalog es GET /api/glpi/catalog: entidades y tipos de computador de GLPI,
// para armar las reglas de importación.
func (h *GlpiHandler) Catalog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	s, err := h.open(ctx, cfg)
	if err != nil {
		writeGlpiError(w, r, err)
		return
	}
	defer s.Close()
	entities, err := glpi.Entities(ctx, s)
	if err != nil {
		writeGlpiError(w, r, err)
		return
	}
	types, err := glpi.ComputerTypes(ctx, s)
	if err != nil {
		writeGlpiError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"entities": entities, "computerTypes": types})
}

func writeGlpiError(w http.ResponseWriter, r *http.Request, err error) {
	ex := explain(err)
	problemdetails.Write(w, r, http.StatusBadGateway, "glpi-unreachable", ex.Error+" "+ex.Next)
}

// ===== Revisión e importación =====

type glpiPlanRow struct {
	Action   string     `json:"action"` // create | update | reactivate | deactivate | skip | error
	Itemtype string     `json:"itemtype"`
	GlpiID   int        `json:"glpiId"`
	Name     string     `json:"name"`
	Kind     string     `json:"kind"`
	AssetID  *uuid.UUID `json:"assetId,omitempty"`
	Code     string     `json:"code,omitempty"`
	Changes  []string   `json:"changes,omitempty"`
	Detail   string     `json:"detail,omitempty"`
	// LinkAssetID: equipo de la app con la misma serie, que se puede vincular.
	LinkAssetID *uuid.UUID `json:"linkAssetId,omitempty"`

	ri resolvedInput
}

type glpiPlan struct {
	ReadAt     time.Time      `json:"readAt"`
	Computers  int            `json:"computers"`
	Network    int            `json:"network"`
	Counts     map[string]int `json:"counts"`
	Rows       []glpiPlanRow  `json:"rows"`
	Warnings   []string       `json:"warnings"`
	Linked     int            `json:"linked"`
	HoldBack   bool           `json:"holdBack"`
	HoldReason string         `json:"holdReason,omitempty"`
}

// glpiHoldShare: si en una corrida desaparece más de esta parte de lo
// importado (y al menos glpiHoldMin equipos), la automática no da de baja.
const (
	glpiHoldShare = 0.10
	glpiHoldMin   = 3
)

var glpiIPNote = "GLPI"

// glpiAttributes llena los campos del tipo con lo que trae GLPI.
func glpiAttributes(item glpi.Item, fields []kindField) map[string]string {
	out := map[string]string{}
	for _, f := range fields {
		v := ""
		switch f.Key {
		case "os":
			v = item.OS
		case "os_version":
			v = item.OSVersion
		case "cpu":
			v = item.CPU
		case "ram_gb":
			v = glpi.RAMGB(item.RAMMB)
		case "disk":
			v = item.Disk
		case "equipment":
			if f.Kind == "list" && item.Type != "" {
				for _, o := range f.Options {
					if strings.EqualFold(o, item.Type) || strings.Contains(strings.ToLower(item.Type), strings.ToLower(o)) {
						v = o
						break
					}
				}
				if v == "" && contains(f.Options, "Otro") {
					v = "Otro"
				}
			} else {
				v = item.Type
			}
		}
		if v != "" {
			out[f.Key] = v
		}
	}
	return out
}

func glpiModel(item glpi.Item) string {
	if item.Manufacturer != "" && !strings.HasPrefix(strings.ToLower(item.Model), strings.ToLower(item.Manufacturer)) {
		return strings.TrimSpace(item.Manufacturer + " " + item.Model)
	}
	return item.Model
}

// glpiPlace busca la localidad con el mismo nombre que la ubicación de GLPI
// (completa o su último tramo: «Santiago > Datahouse» → «Datahouse»).
func glpiPlace(location string, l csvLookups) *uuid.UUID {
	if location == "" {
		return nil
	}
	tries := []string{strings.ToLower(location)}
	if i := strings.LastIndex(location, ">"); i >= 0 {
		tries = append(tries, strings.ToLower(strings.TrimSpace(location[i+1:])))
	}
	for _, t := range tries {
		if id, ok := l.units[t]; ok && !l.ambiguous[t] {
			return &id
		}
	}
	return nil
}

// mergeIPs: las IP de GLPI pasan como «Red»; las demás (VIP, iLO…) quedan.
func mergeIPs(current []assetIPDTO, fromGLPI []string) []assetIPDTO {
	if len(fromGLPI) == 0 {
		return current
	}
	notes := map[string]string{}
	out := []assetIPDTO{}
	for _, ip := range current {
		if ip.Kind == "network" {
			notes[ip.Address] = ip.Note
			continue
		}
		out = append(out, ip)
	}
	glpiIPs := make([]assetIPDTO, 0, len(fromGLPI))
	for _, a := range fromGLPI {
		glpiIPs = append(glpiIPs, assetIPDTO{Kind: "network", Address: a, Note: notes[a]})
	}
	return append(glpiIPs, out...)
}

func (h *GlpiHandler) kindFor(item glpi.Item, types map[string]string) string {
	if item.Itemtype == glpi.NetworkEquipment {
		return "network"
	}
	for name, kind := range types {
		if strings.EqualFold(name, item.Type) {
			return kind
		}
	}
	return "computer"
}

// plan compara lo leído de GLPI con el inventario. No guarda nada.
func (h *GlpiHandler) plan(ctx context.Context, cfg db.GlpiConfig, snap glpi.Snapshot) (glpiPlan, error) {
	p := glpiPlan{ReadAt: h.now(), Counts: map[string]int{"create": 0, "update": 0, "unchanged": 0, "reactivate": 0, "deactivate": 0, "skip": 0, "error": 0},
		Rows: []glpiPlanRow{}, Warnings: append([]string{}, snap.Warnings...)}
	inv := h.Inventory
	l, err := inv.lookups(ctx)
	if err != nil {
		return p, err
	}
	names := inv.names(ctx)
	areaCode := ""
	if cfg.AreaID.Valid {
		if areas, err := h.Queries.ListTicketAreas(ctx); err == nil {
			for _, a := range areas {
				if a.ID == uuid.UUID(cfg.AreaID.Bytes) {
					areaCode = a.Code
				}
			}
		}
	}
	types, rules := decodeComputerTypes(cfg.ComputerTypes), decodeEntityRules(cfg.Entities)
	linkedRows, err := h.Queries.ListGlpiLinkedAssets(ctx)
	if err != nil {
		return p, err
	}
	linked := map[string]db.ListGlpiLinkedAssetsRow{}
	for _, a := range linkedRows {
		linked[glpi.Key(a.GlpiItemtype, int(a.GlpiID))] = a
		if a.Active {
			p.Linked++
		}
	}
	serials := []string{}
	for _, it := range snap.Items {
		if _, ok := linked[glpi.Key(it.Itemtype, it.ID)]; !ok && it.Serial != "" {
			serials = append(serials, strings.ToLower(it.Serial))
		}
	}
	bySerial := map[string]db.ListAssetsBySerialRow{}
	if len(serials) > 0 {
		rows, err := h.Queries.ListAssetsBySerial(ctx, serials)
		if err != nil {
			return p, err
		}
		for _, a := range rows {
			bySerial[strings.ToLower(a.Serial)] = a
		}
	}
	kinds := map[string][]kindField{}
	fieldsOf := func(code string) []kindField {
		if f, ok := kinds[code]; ok {
			return f
		}
		var f []kindField
		if k, err := h.Queries.GetAssetKind(ctx, code); err == nil {
			_ = json.Unmarshal(k.Fields, &f)
		}
		kinds[code] = f
		return f
	}
	usedCodes := map[string]bool{}
	admin := invAccess{admin: true, viewAll: true}
	add := func(row glpiPlanRow) {
		p.Counts[row.Action]++
		if row.Action != "unchanged" {
			p.Rows = append(p.Rows, row)
		}
	}
	seen := map[string]bool{}
	for _, item := range snap.Items {
		key := glpi.Key(item.Itemtype, item.ID)
		seen[key] = true
		if item.Itemtype == glpi.Computer {
			p.Computers++
		} else {
			p.Network++
		}
		kind := h.kindFor(item, types)
		row := glpiPlanRow{Itemtype: item.Itemtype, GlpiID: item.ID, Name: item.Name, Kind: kind}
		rule := rules[strconv.Itoa(item.EntityID)]
		if rule.Skip {
			row.Action, row.Detail = "skip", fmt.Sprintf("Entidad «%s» marcada «No importar».", item.Entity)
			add(row)
			continue
		}
		attrsGLPI := glpiAttributes(item, fieldsOf(kind))
		place := glpiPlace(item.Location, l)
		if a, ok := linked[key]; ok {
			asset, err := h.Queries.GetInventoryAsset(ctx, a.ID)
			if err != nil {
				return p, err
			}
			areas, _ := h.Queries.ListAssetResponsibleAreas(ctx, a.ID)
			before, err := inv.detail(ctx, asset, areas, admin)
			if err != nil {
				return p, err
			}
			in := inventoryInput{Kind: kind, Name: item.Name, Code: before.Code, Area: before.Area, TerritorialUnitID: before.TerritorialUnitID,
				ClientID: before.ClientID, Model: deref(before.Model), Serial: deref(before.Serial), Rack: deref(before.Rack), RackPosition: deref(before.RackPosition),
				Attributes: map[string]string{}, Extra: before.Extra, IPs: mergeIPs(before.IPs, item.IPs), Responsibles: before.Responsibles}
			for k, v := range before.Attributes {
				in.Attributes[k] = v
			}
			for k, v := range attrsGLPI {
				in.Attributes[k] = v
			}
			if m := glpiModel(item); m != "" {
				in.Model = m
			}
			if item.Serial != "" {
				in.Serial = item.Serial
			}
			if place != nil {
				in.TerritorialUnitID = place
			}
			if rule.OrganizationID != nil {
				in.ClientID = rule.OrganizationID
			}
			id := a.ID
			row.AssetID, row.Code = &id, a.Code
			ri, msg := inv.resolve(ctx, in)
			if msg != "" {
				row.Action, row.Detail = "error", msg
				add(row)
				continue
			}
			row.ri, row.Changes = ri, changes(before, ri.in, ri.fields, names)
			switch {
			case !a.Active && a.GlpiRemovedAt.Valid:
				row.Action, row.Detail = "reactivate", "Volvió a aparecer en GLPI."
			case len(row.Changes) == 0:
				row.Action = "unchanged"
			default:
				row.Action = "update"
			}
			add(row)
			continue
		}
		if match, ok := bySerial[strings.ToLower(item.Serial)]; ok && item.Serial != "" {
			id := match.ID
			row.Action, row.LinkAssetID, row.Code = "skip", &id, match.Code
			row.Detail = fmt.Sprintf("Ya existe en la app con la misma serie (%s, código %s). La app no se toca.", item.Serial, match.Code)
			add(row)
			continue
		}
		if areaCode == "" {
			row.Action, row.Detail = "error", "Elige el área dueña de lo importado."
			add(row)
			continue
		}
		code, err := h.freeCode(ctx, item, usedCodes)
		if err != nil {
			return p, err
		}
		usedCodes[code] = true
		ips := mergeIPs(nil, item.IPs)
		in := inventoryInput{Kind: kind, Name: item.Name, Code: code, Area: areaCode, TerritorialUnitID: place, ClientID: rule.OrganizationID,
			Model: glpiModel(item), Serial: item.Serial, Attributes: attrsGLPI, Extra: map[string]string{}, IPs: ips, Responsibles: []assetResponsibleDTO{}}
		ri, msg := inv.resolve(ctx, in)
		if msg != "" {
			row.Action, row.Detail = "error", msg
			add(row)
			continue
		}
		row.Action, row.Code, row.ri = "create", code, ri
		row.Detail = glpiSummary(item, names["kind:"+kind])
		add(row)
	}
	for key, a := range linked {
		if seen[key] || !a.Active {
			continue
		}
		id := a.ID
		row := glpiPlanRow{Action: "deactivate", Itemtype: a.GlpiItemtype, GlpiID: int(a.GlpiID), Name: a.Name, AssetID: &id, Code: a.Code,
			Detail: "Ya no está en GLPI (borrado o sin permiso para verlo)."}
		if _, trashed := snap.Trashed[key]; trashed {
			row.Detail = "En la papelera de GLPI."
		}
		add(row)
	}
	if n := p.Counts["deactivate"]; n >= glpiHoldMin && float64(n) > glpiHoldShare*float64(p.Linked) {
		p.HoldBack = true
		p.HoldReason = fmt.Sprintf("Desaparecen %d de %d equipos importados (más del 10 %%). La importación automática no los da de baja: revísalo aquí.", n, p.Linked)
	}
	sort.SliceStable(p.Rows, func(i, j int) bool { return p.Rows[i].Name < p.Rows[j].Name })
	return p, nil
}

func glpiSummary(item glpi.Item, kindName string) string {
	parts := []string{kindName}
	if item.OS != "" {
		parts = append(parts, strings.TrimSpace(item.OS+" "+item.OSVersion))
	}
	if ram := glpi.RAMGB(item.RAMMB); ram != "" {
		parts = append(parts, ram+" GB")
	}
	if item.Location != "" {
		parts = append(parts, item.Location)
	}
	if len(item.IPs) > 0 {
		parts = append(parts, item.IPs[0])
	}
	return strings.Join(parts, " · ")
}

// freeCode: el código del equipo nuevo, a partir de su nombre; si ya está
// usado, se le agrega el ID de GLPI.
func (h *GlpiHandler) freeCode(ctx context.Context, item glpi.Item, used map[string]bool) (string, error) {
	base := slugKey(item.Name)
	if base == "" {
		base = strings.ToLower(item.Itemtype)
	}
	for i, code := range []string{base, fmt.Sprintf("%s_glpi%d", base, item.ID)} {
		if used[code] {
			continue
		}
		taken, err := h.Queries.AssetCodeTaken(ctx, code)
		if err != nil {
			return "", err
		}
		if !taken || i == 1 {
			return code, nil
		}
	}
	return fmt.Sprintf("%s_glpi%d", base, item.ID), nil
}

// read abre la sesión, lee GLPI y arma el plan.
func (h *GlpiHandler) read(ctx context.Context, cfg db.GlpiConfig) (glpiPlan, error) {
	if !cfg.ImportComputers && !cfg.ImportNetwork {
		return glpiPlan{}, errors.New("no hay nada que traer: marca computadores o equipos de red")
	}
	s, err := h.open(ctx, cfg)
	if err != nil {
		return glpiPlan{}, err
	}
	defer s.Close()
	snap, err := glpi.Fetch(ctx, s, glpi.Options{Computers: cfg.ImportComputers, Network: cfg.ImportNetwork})
	if err != nil {
		return glpiPlan{}, err
	}
	return h.plan(ctx, cfg, snap)
}

// Preview es POST /api/glpi/preview: lee GLPI y muestra qué cambiaría.
func (h *GlpiHandler) Preview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	p, err := h.read(ctx, cfg)
	if err != nil {
		writeGlpiError(w, r, err)
		return
	}
	writeData(w, http.StatusOK, p)
}

type glpiRunDTO struct {
	ID          uuid.UUID  `json:"id"`
	Trigger     string     `json:"trigger"`
	UserName    string     `json:"userName,omitempty"`
	StartedAt   time.Time  `json:"startedAt"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	OK          bool       `json:"ok"`
	Created     int32      `json:"created"`
	Updated     int32      `json:"updated"`
	Deactivated int32      `json:"deactivated"`
	Reactivated int32      `json:"reactivated"`
	Skipped     int32      `json:"skipped"`
	Unchanged   int32      `json:"unchanged"`
	HeldBack    int32      `json:"heldBack"`
	Message     string     `json:"message"`
}

// Import es POST /api/glpi/import: vuelve a leer GLPI y aplica todo, también
// las bajas que el seguro retendría (el admin las vio en la revisión).
func (h *GlpiHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	run, err := h.run(ctx, cfg, "manual")
	if errors.Is(err, errGlpiBusy) {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-busy", "ya hay una importación en curso: espera a que termine")
		return
	}
	if err != nil && run == nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo registrar la importación")
		return
	}
	writeData(w, http.StatusOK, run)
}

var errGlpiBusy = errors.New("importación en curso")

// run lee GLPI, aplica el plan y deja la corrida registrada.
func (h *GlpiHandler) run(ctx context.Context, cfg db.GlpiConfig, trigger string) (*glpiRunDTO, error) {
	if !h.running.TryLock() {
		return nil, errGlpiBusy
	}
	defer h.running.Unlock()
	runID, err := h.Queries.CreateGlpiRun(ctx, db.CreateGlpiRunParams{Trigger: trigger, UserID: userUUID(ctx)})
	if err != nil {
		return nil, err
	}
	out := &glpiRunDTO{ID: runID, Trigger: trigger, StartedAt: h.now()}
	finish := func() {
		_ = h.Queries.FinishGlpiRun(ctx, db.FinishGlpiRunParams{ID: runID, Ok: out.OK, Created: out.Created, Updated: out.Updated,
			Deactivated: out.Deactivated, Reactivated: out.Reactivated, Skipped: out.Skipped, Unchanged: out.Unchanged, HeldBack: out.HeldBack, Message: out.Message})
		now := h.now()
		out.FinishedAt = &now
		outcome := audit.Success()
		if !out.OK {
			outcome = audit.Failure(out.Message)
		}
		h.AuditLog.Log(ctx, "inventory.glpi.import", audit.LevelInfo, outcome, map[string]any{"trigger": trigger, "created": out.Created,
			"updated": out.Updated, "deactivated": out.Deactivated, "reactivated": out.Reactivated, "skipped": out.Skipped, "heldBack": out.HeldBack})
	}
	p, err := h.read(ctx, cfg)
	if err != nil {
		out.Message = explain(err).Error + " " + explain(err).Next
		finish()
		return out, err
	}
	failed := []string{}
	for _, row := range p.Rows {
		if row.Action == "deactivate" && p.HoldBack && trigger == "auto" {
			out.HeldBack++
			continue
		}
		if err := h.applyRow(ctx, row); err != nil {
			failed = append(failed, fmt.Sprintf("%s: %v", row.Name, err))
			continue
		}
		switch row.Action {
		case "create":
			out.Created++
		case "update":
			out.Updated++
		case "reactivate":
			out.Reactivated++
		case "deactivate":
			out.Deactivated++
		case "skip", "error":
			out.Skipped++
		}
	}
	out.Unchanged = int32(p.Counts["unchanged"])
	msgs := append([]string{}, p.Warnings...)
	if out.HeldBack > 0 {
		msgs = append(msgs, p.HoldReason)
	}
	if len(failed) > 0 {
		msgs = append(msgs, fmt.Sprintf("No se pudieron guardar %d equipos: %s", len(failed), strings.Join(failed, "; ")))
	}
	out.OK, out.Message = len(failed) == 0, strings.Join(msgs, " ")
	finish()
	return out, nil
}

// applyRow guarda un equipo del plan en su propia transacción.
func (h *GlpiHandler) applyRow(ctx context.Context, row glpiPlanRow) error {
	if row.Action == "skip" || row.Action == "error" || row.Action == "unchanged" {
		return nil
	}
	tx, err := h.Inventory.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	now := pgtype.Timestamptz{Time: h.now(), Valid: true}
	event := func(id uuid.UUID, kind, text string) error {
		return q.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: id, Kind: kind, Description: text, HappenedAt: now, UserID: userUUID(ctx)})
	}
	switch row.Action {
	case "create":
		id, err := save(ctx, q, uuid.Nil, row.ri)
		if err == nil {
			err = q.SetAssetGlpiLink(ctx, db.SetAssetGlpiLinkParams{ID: id, GlpiItemtype: pgtype.Text{String: row.Itemtype, Valid: true}, GlpiID: pgtype.Int4{Int32: int32(row.GlpiID), Valid: true}})
		}
		if err == nil {
			err = event(id, "glpi", fmt.Sprintf("Equipo importado desde GLPI (#%d).", row.GlpiID))
		}
		if err != nil {
			return err
		}
	case "update", "reactivate":
		id := *row.AssetID
		if _, err := save(ctx, q, id, row.ri); err != nil {
			return err
		}
		if row.Action == "reactivate" {
			if err := q.SetAssetGlpiRemoved(ctx, db.SetAssetGlpiRemovedParams{ID: id, Removed: false}); err != nil {
				return err
			}
			if err := event(id, "reactivated", "Reactivado: volvió a aparecer en GLPI."); err != nil {
				return err
			}
		}
		for _, c := range row.Changes {
			if err := event(id, "glpi", c); err != nil {
				return err
			}
		}
	case "deactivate":
		id := *row.AssetID
		if err := q.SetAssetGlpiRemoved(ctx, db.SetAssetGlpiRemovedParams{ID: id, Removed: true}); err != nil {
			return err
		}
		if err := event(id, "deactivated", "Dado de baja: "+strings.TrimSuffix(strings.ToLower(row.Detail[:1])+row.Detail[1:], ".")+"."); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type glpiLinkRequest struct {
	AssetID  uuid.UUID `json:"assetId"`
	Itemtype string    `json:"itemtype"`
	GlpiID   int       `json:"glpiId"`
}

// Link es POST /api/glpi/link: un equipo creado en la app pasa a venir de
// GLPI (misma serie). Desde la próxima importación, GLPI lo actualiza.
func (h *GlpiHandler) Link(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req glpiLinkRequest
	if err := decodeJSON(w, r, &req); err != nil || req.GlpiID <= 0 || (req.Itemtype != glpi.Computer && req.Itemtype != glpi.NetworkEquipment) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica el equipo y el ítem de GLPI (Computer o NetworkEquipment)")
		return
	}
	a, err := h.Queries.GetInventoryAsset(ctx, req.AssetID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "asset-not-found", "el equipo no existe")
		return
	}
	if a.GlpiID.Valid {
		problemdetails.Write(w, r, http.StatusConflict, "already-linked", "ese equipo ya viene de GLPI")
		return
	}
	err = h.Queries.SetAssetGlpiLink(ctx, db.SetAssetGlpiLinkParams{ID: a.ID, GlpiItemtype: pgtype.Text{String: req.Itemtype, Valid: true}, GlpiID: pgtype.Int4{Int32: int32(req.GlpiID), Valid: true}})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-already-linked", "ese ítem de GLPI ya está vinculado a otro equipo")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo vincular el equipo")
		return
	}
	_ = h.Queries.AddAssetEvent(ctx, db.AddAssetEventParams{AssetID: a.ID, Kind: "glpi", Description: fmt.Sprintf("Vinculado a GLPI (#%d): desde ahora GLPI actualiza sus datos.", req.GlpiID),
		HappenedAt: pgtype.Timestamptz{Time: h.now(), Valid: true}, UserID: userUUID(ctx)})
	h.AuditLog.Log(ctx, "inventory.glpi.link", audit.LevelInfo, audit.Success(), map[string]any{"assetId": a.ID.String(), "itemtype": req.Itemtype, "glpiId": req.GlpiID})
	writeData(w, http.StatusOK, map[string]any{"linked": true})
}

// Runs es GET /api/glpi/runs: las últimas importaciones.
func (h *GlpiHandler) Runs(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListGlpiRuns(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las importaciones")
		return
	}
	out := make([]glpiRunDTO, 0, len(rows))
	for _, x := range rows {
		d := glpiRunDTO{ID: x.ID, Trigger: x.Trigger, UserName: x.UserName, StartedAt: x.StartedAt.Time, OK: x.Ok, Created: x.Created, Updated: x.Updated,
			Deactivated: x.Deactivated, Reactivated: x.Reactivated, Skipped: x.Skipped, Unchanged: x.Unchanged, HeldBack: x.HeldBack, Message: x.Message}
		if x.FinishedAt.Valid {
			t := x.FinishedAt.Time
			d.FinishedAt = &t
		}
		out = append(out, d)
	}
	writeData(w, http.StatusOK, out)
}

// ===== Importación automática =====

// AutoTick corre cada minuto: si toca, importa sin revisión. Si falla o el
// seguro retiene bajas, avisa en la campana a los administradores (una vez
// al día).
func (h *GlpiHandler) AutoTick(ctx context.Context) error {
	if !featureEnabled(ctx, h.Queries, glpiFeature) {
		return nil
	}
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil || cfg.AutoMode == "off" {
		return err
	}
	next := h.nextAuto(ctx, cfg)
	if next == nil || h.now().Before(*next) {
		return nil
	}
	// Se marca antes de correr: si falla, se reintenta en el próximo turno,
	// no cada minuto.
	if err := h.Queries.MarkGlpiAutoRun(ctx, pgtype.Timestamptz{Time: h.now(), Valid: true}); err != nil {
		return err
	}
	run, err := h.run(ctx, cfg, "auto")
	if errors.Is(err, errGlpiBusy) {
		return nil
	}
	if run != nil && (!run.OK || run.HeldBack > 0) {
		h.notifyAdmins(ctx, cfg, run)
	}
	return nil
}

func (h *GlpiHandler) notifyAdmins(ctx context.Context, cfg db.GlpiConfig, run *glpiRunDTO) {
	local := h.now().In(h.location(ctx))
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	if cfg.LastFailureNotifiedOn.Valid && cfg.LastFailureNotifiedOn.Time.Equal(today) {
		return
	}
	admins, err := h.Queries.ListAdminUserIDs(ctx)
	if err != nil || len(admins) == 0 {
		return
	}
	title := "La importación desde GLPI falló"
	if run.OK && run.HeldBack > 0 {
		title = "Importación desde GLPI: bajas retenidas"
	}
	h.Notify.Send(ctx, admins, NotifMsg{Kind: NotifGlpiImport, Title: title, Body: run.Message, Link: "/admin?section=glpi", GroupKey: "glpi.import"})
	_ = h.Queries.MarkGlpiFailureNotified(ctx, pgtype.Date{Time: today, Valid: true})
}
