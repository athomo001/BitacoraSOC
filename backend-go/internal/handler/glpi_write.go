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
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// GLPI en la Ticketera, fase 2 (10d.2, spec/18 §4; diseño aprobado por el
// dueño 2026-10-21): comentar los tickets de GLPI desde la app y «Crear en
// GLPI» desde un ticket de la app o una entrada de la Bitácora. Manda donde
// nació: los GLPI-… siguen de solo lectura salvo comentar; un ticket de la
// app con copia se trabaja en la app y GLPI recibe la copia y sus
// seguimientos (y lo que se escriba allá vuelve como «desde GLPI»).
//
// Crear es al momento (el usuario ve el número o el error). Los seguimientos
// y el estado de una copia van por la cola glpi_outbox: se intentan al
// instante y, si GLPI no responde, se reintentan hasta 24 horas.

// glpiWriteDeadline: después de esto sin poder enviar, queda «No se envió».
const glpiWriteDeadline = 24 * time.Hour

// glpiWriteBackoff: espera entre intentos (el último se repite).
var glpiWriteBackoff = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, 30 * time.Minute, time.Hour, 2 * time.Hour, 4 * time.Hour, 8 * time.Hour}

// ===== Encendido y sesión de escritura =====

// writeReady: la funcionalidad GLPI, «Escribir en GLPI» y el token están.
func (h *GlpiHandler) writeReady(ctx context.Context) (db.GlpiConfig, bool) {
	if h == nil || !featureEnabled(ctx, h.Queries, glpiFeature) {
		return db.GlpiConfig{}, false
	}
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		return cfg, false
	}
	return cfg, cfg.WriteEnabled && cfg.WriteTokenEncrypted.Valid && cfg.WriteTokenEncrypted.String != "" && cfg.ApiUrl != ""
}

// WriteReady es writeReady para las pantallas (¿se ofrece comentar y crear?).
func (h *GlpiHandler) WriteReady(ctx context.Context) bool {
	_, ok := h.writeReady(ctx)
	return ok
}

// openWrite abre sesión con el User-Token de escritura.
func (h *GlpiHandler) openWrite(ctx context.Context, cfg db.GlpiConfig) (*glpi.Session, error) {
	conn, err := h.connection(cfg)
	if err != nil {
		return nil, err
	}
	if !cfg.WriteTokenEncrypted.Valid || cfg.WriteTokenEncrypted.String == "" {
		return nil, errors.New("falta configurar el User-Token de escritura")
	}
	token, err := h.Crypto.Decrypt(cfg.WriteTokenEncrypted.String)
	if err != nil {
		return nil, errors.New("no se pudo descifrar el User-Token de escritura: vuelve a escribirlo")
	}
	conn.UserToken = token
	if h.Open != nil {
		return h.Open(ctx, conn)
	}
	return glpi.Open(ctx, conn)
}

// ===== Administración → GLPI → Escribir en GLPI =====

type glpiOptionDTO struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type glpiWriteClientDTO struct {
	ClientID   uuid.UUID       `json:"clientId"`
	ClientName string          `json:"clientName"`
	Entities   []glpiOptionDTO `json:"entities"`
	EntityID   *int            `json:"entityId"`
}

type glpiWriteAreaDTO struct {
	AreaID   uuid.UUID       `json:"areaId"`
	AreaName string          `json:"areaName"`
	Groups   []glpiOptionDTO `json:"groups"`
	GroupID  *int            `json:"groupId"`
}

type glpiWriteConfigDTO struct {
	Enabled     bool                 `json:"enabled"`
	HasToken    bool                 `json:"hasToken"`
	DefaultType int32                `json:"defaultType"`
	Clients     []glpiWriteClientDTO `json:"clients"`
	Areas       []glpiWriteAreaDTO   `json:"areas"`
	// Warning: no se pudieron leer los nombres de GLPI (se muestran por número).
	Warning string `json:"warning,omitempty"`
}

func decodeIntMap(raw []byte) map[string]int {
	out := map[string]int{}
	_ = json.Unmarshal(raw, &out)
	return out
}

// glpiNames lee de GLPI los nombres de entidades y grupos (mejor esfuerzo).
func (h *GlpiHandler) glpiNames(ctx context.Context, cfg db.GlpiConfig) (map[int]string, map[int]string, string) {
	entities, groups := map[int]string{}, map[int]string{}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	s, err := h.open(ctx, cfg)
	if err != nil {
		return entities, groups, "No se pudieron leer los nombres de GLPI: " + explain(err).Error
	}
	defer s.Close()
	if list, err := glpi.Entities(ctx, s); err == nil {
		for _, e := range list {
			entities[e.ID] = e.Name
		}
	}
	if list, err := glpi.Groups(ctx, s); err == nil {
		for _, g := range list {
			groups[g.ID] = g.Name
		}
	}
	return entities, groups, ""
}

func optionName(names map[int]string, id int, kind string) string {
	if n := names[id]; n != "" {
		return n
	}
	return fmt.Sprintf("%s #%d", kind, id)
}

// writeCandidates: para cada cliente, sus entidades (el mapeo entidad →
// cliente al revés); para cada área, sus grupos (grupo → área al revés).
func writeCandidates(cfg db.GlpiConfig) (map[uuid.UUID][]int, map[uuid.UUID][]int) {
	clients := map[uuid.UUID][]int{}
	for id, rule := range decodeEntityRules(cfg.Entities) {
		if rule.OrganizationID == nil || rule.Skip {
			continue
		}
		if n, err := strconv.Atoi(id); err == nil {
			clients[*rule.OrganizationID] = append(clients[*rule.OrganizationID], n)
		}
	}
	areas := map[uuid.UUID][]int{}
	for id, area := range decodeGroupAreas(cfg.GroupAreas) {
		if n, err := strconv.Atoi(id); err == nil {
			areas[area] = append(areas[area], n)
		}
	}
	for k := range clients {
		sort.Ints(clients[k])
	}
	for k := range areas {
		sort.Ints(areas[k])
	}
	return clients, areas
}

// pickDefault: lo elegido en Administración si es candidato; si hay uno solo, ese.
func pickDefault(candidates []int, chosen int) *int {
	for _, c := range candidates {
		if c == chosen {
			v := c
			return &v
		}
	}
	if len(candidates) == 1 {
		v := candidates[0]
		return &v
	}
	return nil
}

// WriteConfig es GET /api/glpi/write/config.
func (h *GlpiHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	out := glpiWriteConfigDTO{Enabled: cfg.WriteEnabled, HasToken: cfg.WriteTokenEncrypted.Valid && cfg.WriteTokenEncrypted.String != "",
		DefaultType: cfg.WriteDefaultType, Clients: []glpiWriteClientDTO{}, Areas: []glpiWriteAreaDTO{}}
	clients, areas := writeCandidates(cfg)
	var entityNames, groupNames map[int]string
	if len(clients) > 0 || len(areas) > 0 {
		entityNames, groupNames, out.Warning = h.glpiNames(ctx, cfg)
	}
	chosenEntity, chosenGroup := decodeIntMap(cfg.ClientEntities), decodeIntMap(cfg.AreaGroups)
	if orgs, err := h.Queries.ListActiveClientNames(ctx); err == nil {
		for _, o := range orgs {
			c := glpiWriteClientDTO{ClientID: o.ID, ClientName: o.Name, Entities: []glpiOptionDTO{}}
			for _, id := range clients[o.ID] {
				c.Entities = append(c.Entities, glpiOptionDTO{ID: id, Name: optionName(entityNames, id, "Entidad")})
			}
			c.EntityID = pickDefault(clients[o.ID], chosenEntity[o.ID.String()])
			out.Clients = append(out.Clients, c)
		}
	}
	if list, err := h.Queries.ListTicketAreas(ctx); err == nil {
		for _, a := range list {
			if a.DefaultProfile == "gestion" {
				continue
			}
			x := glpiWriteAreaDTO{AreaID: a.ID, AreaName: a.Name, Groups: []glpiOptionDTO{}}
			for _, id := range areas[a.ID] {
				x.Groups = append(x.Groups, glpiOptionDTO{ID: id, Name: optionName(groupNames, id, "Grupo")})
			}
			x.GroupID = pickDefault(areas[a.ID], chosenGroup[a.ID.String()])
			out.Areas = append(out.Areas, x)
		}
	}
	writeData(w, http.StatusOK, out)
}

type putGlpiWriteConfigRequest struct {
	Enabled bool `json:"enabled"`
	// Token: nil = se mantiene, "" = se quita.
	Token          *string        `json:"token"`
	DefaultType    int32          `json:"defaultType"`
	ClientEntities map[string]int `json:"clientEntities"`
	AreaGroups     map[string]int `json:"areaGroups"`
}

// PutWriteConfig es PUT /api/glpi/write/config.
func (h *GlpiHandler) PutWriteConfig(w http.ResponseWriter, r *http.Request) {
	var req putGlpiWriteConfigRequest
	if err := decodeJSON(w, r, &req); err != nil || (req.DefaultType != 1 && req.DefaultType != 2) {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido: el tipo por defecto es 1 (incidente) o 2 (requerimiento)")
		return
	}
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	token := cfg.WriteTokenEncrypted
	if req.Token != nil {
		t := strings.TrimSpace(*req.Token)
		token = pgtype.Text{}
		if t != "" {
			enc, err := h.Crypto.Encrypt(t)
			if err != nil {
				problemdetails.Write(w, r, 500, "internal-error", "no se pudo cifrar el token")
				return
			}
			token = pgtype.Text{String: enc, Valid: true}
		}
	}
	if req.Enabled && (!token.Valid || token.String == "") {
		problemdetails.Write(w, r, 400, "invalid-payload", "para escribir en GLPI falta el User-Token de escritura")
		return
	}
	clean := func(m map[string]int) []byte {
		out := map[string]int{}
		for k, v := range m {
			if _, err := uuid.Parse(k); err == nil && v >= 0 {
				out[k] = v
			}
		}
		raw, _ := json.Marshal(out)
		return raw
	}
	if err := h.Queries.UpdateGlpiWriteConfig(ctx, db.UpdateGlpiWriteConfigParams{WriteEnabled: req.Enabled, WriteTokenEncrypted: token,
		WriteDefaultType: req.DefaultType, ClientEntities: clean(req.ClientEntities), AreaGroups: clean(req.AreaGroups)}); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar")
		return
	}
	h.AuditLog.Log(ctx, "config.glpi.write.update", audit.LevelWarn, audit.Success(), map[string]any{"enabled": req.Enabled,
		"tokenChanged": req.Token != nil, "defaultType": req.DefaultType})
	h.WriteConfig(w, r)
}

type glpiWriteTestDTO struct {
	OK      bool              `json:"ok"`
	User    string            `json:"user,omitempty"`
	Profile string            `json:"profile,omitempty"`
	Problem *glpi.Explanation `json:"problem,omitempty"`
}

// TestWrite es POST /api/glpi/write/test: abre sesión con el token de
// escritura y lee con quién quedó, sin crear nada.
func (h *GlpiHandler) TestWrite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	out := glpiWriteTestDTO{}
	s, err := h.openWrite(ctx, cfg)
	if err == nil {
		var who glpi.Whoami
		who, err = glpi.WhoAmI(ctx, s)
		s.Close()
		out.User, out.Profile = who.User, who.Profile
	}
	out.OK = err == nil
	if err != nil {
		out.Problem = explain(err)
	}
	level, result := audit.LevelInfo, audit.Success()
	if err != nil {
		level, result = audit.LevelWarn, audit.Failure(out.Problem.Error)
	}
	h.AuditLog.Log(ctx, "glpi.write.test", level, result, map[string]any{"user": out.User})
	writeData(w, http.StatusOK, out)
}

type glpiOutboxDTO struct {
	ID            uuid.UUID  `json:"id"`
	Kind          string     `json:"kind"`
	GlpiTicketID  int32      `json:"glpiTicketId"`
	TicketNumber  string     `json:"ticketNumber,omitempty"`
	State         string     `json:"state"`
	Attempts      int32      `json:"attempts"`
	LastError     *string    `json:"lastError"`
	LastAttemptAt *time.Time `json:"lastAttemptAt"`
	NextAttemptAt time.Time  `json:"nextAttemptAt"`
	CreatedAt     time.Time  `json:"createdAt"`
}

// WriteQueue es GET /api/glpi/write/queue: lo último de la cola.
func (h *GlpiHandler) WriteQueue(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListGlpiOutbox(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la cola")
		return
	}
	out := make([]glpiOutboxDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, glpiOutboxDTO{ID: x.ID, Kind: x.Kind, GlpiTicketID: x.GlpiTicketID, TicketNumber: x.TicketNumber, State: x.State,
			Attempts: x.Attempts, LastError: textPtr(x.LastError), LastAttemptAt: timestamptzPtr(x.LastAttemptAt), NextAttemptAt: x.NextAttemptAt.Time,
			CreatedAt: x.CreatedAt.Time})
	}
	writeData(w, http.StatusOK, out)
}

// RetryWrite es POST /api/glpi/write/retry: lo que falló vuelve a la cola
// (uno con {id}, o todo).
func (h *GlpiHandler) RetryWrite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID *uuid.UUID `json:"id"`
	}
	_ = decodeJSON(w, r, &req)
	var id pgtype.UUID
	if req.ID != nil {
		id = pgtype.UUID{Bytes: *req.ID, Valid: true}
	}
	ctx := r.Context()
	n, err := h.Queries.RetryGlpiOutbox(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo reintentar")
		return
	}
	h.AuditLog.Log(ctx, "glpi.write.retry", audit.LevelInfo, audit.Success(), map[string]any{"count": n})
	h.background(ctx, func(ctx context.Context) { _ = h.WriteTick(ctx) })
	writeData(w, http.StatusOK, map[string]any{"queued": n})
}

// ===== Crear en GLPI =====

// glpiCreatePreviewDTO es la vista previa de «Crear en GLPI».
type glpiCreatePreviewDTO struct {
	Entities    []glpiOptionDTO `json:"entities"`
	EntityID    *int            `json:"entityId"`
	Groups      []glpiOptionDTO `json:"groups"`
	GroupID     *int            `json:"groupId"`
	Type        int32           `json:"type"`
	Urgency     int             `json:"urgency"`
	Impact      int             `json:"impact"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	// Problem: por qué no se puede crear (el cliente no tiene entidad…).
	Problem string `json:"problem,omitempty"`
	Warning string `json:"warning,omitempty"`
}

// glpiScale: urgencia o impacto de la app → la escala de GLPI (spec/18 §4.8).
func glpiScale(level string) int {
	switch level {
	case "low":
		return 2
	case "high":
		return 4
	case "critical":
		return 5
	}
	return 3
}

// createPreview arma la vista previa. client/area pueden ir vacíos (uuid.Nil):
// entonces se ofrecen todas las entidades o grupos con mapeo.
func (h *GlpiHandler) createPreview(ctx context.Context, cfg db.GlpiConfig, client, area uuid.UUID, urgency, impact, title, desc string) glpiCreatePreviewDTO {
	out := glpiCreatePreviewDTO{Entities: []glpiOptionDTO{}, Groups: []glpiOptionDTO{}, Type: cfg.WriteDefaultType,
		Urgency: glpiScale(urgency), Impact: glpiScale(impact), Title: title, Description: desc}
	clients, areas := writeCandidates(cfg)
	entityNames, groupNames, warning := h.glpiNames(ctx, cfg)
	out.Warning = warning
	ents := clients[client]
	for _, id := range ents {
		out.Entities = append(out.Entities, glpiOptionDTO{ID: id, Name: optionName(entityNames, id, "Entidad")})
	}
	out.EntityID = pickDefault(ents, decodeIntMap(cfg.ClientEntities)[client.String()])
	groups := areas[area]
	if area == uuid.Nil {
		for _, list := range areas {
			groups = append(groups, list...)
		}
		sort.Ints(groups)
	}
	for _, id := range groups {
		out.Groups = append(out.Groups, glpiOptionDTO{ID: id, Name: optionName(groupNames, id, "Grupo")})
	}
	out.GroupID = pickDefault(groups, decodeIntMap(cfg.AreaGroups)[area.String()])
	if len(ents) == 0 {
		out.Problem = "el cliente no tiene una entidad de GLPI: márcala en Administración → GLPI (Tus entidades)"
	}
	return out
}

type glpiCreateRequest struct {
	EntityID int    `json:"entityId"`
	GroupID  int    `json:"groupId"`
	Type     int    `json:"type"`
	Title    string `json:"title"`
}

// createInGlpi crea el ticket en GLPI con la entidad y el grupo elegidos
// (validados contra los candidatos) y el solicitante por correo.
func (h *GlpiHandler) createInGlpi(ctx context.Context, cfg db.GlpiConfig, preview glpiCreatePreviewDTO, req glpiCreateRequest, requesterEmail string) (int, error) {
	okEntity := false
	for _, e := range preview.Entities {
		okEntity = okEntity || e.ID == req.EntityID
	}
	if !okEntity {
		return 0, errUserFacing("elige una entidad de las del cliente")
	}
	if req.GroupID != 0 {
		okGroup := false
		for _, g := range preview.Groups {
			okGroup = okGroup || g.ID == req.GroupID
		}
		if !okGroup {
			return 0, errUserFacing("el grupo técnico no corresponde")
		}
	}
	if req.Type != 1 && req.Type != 2 {
		req.Type = int(preview.Type)
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = preview.Title
	}
	if len([]rune(title)) > 250 {
		title = string([]rune(title)[:250])
	}
	s, err := h.openWrite(ctx, cfg)
	if err != nil {
		return 0, err
	}
	defer s.Close()
	requester, _ := glpi.FindUserByEmail(ctx, s, requesterEmail)
	return glpi.CreateTicket(ctx, s, glpi.NewTicket{Name: title, Content: preview.Description, EntityID: req.EntityID, Type: req.Type,
		Urgency: preview.Urgency, Impact: preview.Impact, GroupID: req.GroupID, RequesterID: requester})
}

// errUserFacing es un error que se le muestra tal cual a quien crea.
type errUserFacing string

func (e errUserFacing) Error() string { return string(e) }

// writeCreateError responde el error de «Crear en GLPI».
func writeCreateError(w http.ResponseWriter, r *http.Request, err error) {
	var uf errUserFacing
	if errors.As(err, &uf) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", uf.Error())
		return
	}
	problemdetails.Write(w, r, http.StatusBadGateway, "glpi-error", "GLPI no creó el ticket: "+explain(err).Error)
}

// userEmail: el correo de quien crea (para el solicitante en GLPI).
func userEmail(ctx context.Context, q *db.Queries) string {
	user, _ := middleware.UserFromContext(ctx)
	if u, err := q.GetUserByID(ctx, user.ID); err == nil {
		return u.Email
	}
	return ""
}

// ===== Cola de envíos =====

// glpiSignature: la firma de lo que sale de la app.
func glpiSignature(text, author string) string {
	return strings.TrimSpace(text) + "\n\n— " + author + " (desde Bitácora Ops)"
}

// enqueue deja un envío en la cola (dentro de la transacción del llamador).
func (h *GlpiHandler) enqueue(ctx context.Context, q *db.Queries, p db.InsertGlpiOutboxParams) (uuid.UUID, error) {
	return q.InsertGlpiOutbox(ctx, p)
}

// SendNow intenta enviar ese envío al instante (después del commit). Si GLPI
// no responde, queda en la cola para el próximo intento.
func (h *GlpiHandler) SendNow(ctx context.Context, id uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	items, err := h.Queries.ClaimGlpiOutbox(ctx, pgtype.UUID{Bytes: id, Valid: true})
	if err != nil || len(items) == 0 {
		return
	}
	h.process(ctx, items)
}

// WriteTick corre cada 30 s: envía lo que toca.
func (h *GlpiHandler) WriteTick(ctx context.Context) error {
	if _, ok := h.writeReady(ctx); !ok {
		return nil
	}
	items, err := h.Queries.ClaimGlpiOutbox(ctx, pgtype.UUID{})
	if err != nil || len(items) == 0 {
		return err
	}
	h.process(ctx, items)
	return nil
}

func (h *GlpiHandler) process(ctx context.Context, items []db.GlpiOutbox) {
	cfg, ok := h.writeReady(ctx)
	var s *glpi.Session
	var openErr error
	if ok {
		s, openErr = h.openWrite(ctx, cfg)
		if s != nil {
			defer s.Close()
		}
	} else {
		openErr = errors.New("«Escribir en GLPI» está apagado")
	}
	for _, it := range items {
		var itemID int
		err := openErr
		if err == nil {
			switch it.Kind {
			case "followup":
				itemID, err = glpi.AddFollowup(ctx, s, int(it.GlpiTicketID), it.Content, it.IsPrivate)
			case "solve":
				itemID, err = glpi.Solve(ctx, s, int(it.GlpiTicketID), it.Content)
			case "close":
				err = glpi.SetStatus(ctx, s, int(it.GlpiTicketID), glpi.StatusClosed)
			case "reopen":
				err = glpi.SetStatus(ctx, s, int(it.GlpiTicketID), glpi.StatusAssigned)
			}
		}
		h.settle(ctx, it, itemID, err)
	}
}

// settle deja el resultado de un envío en la cola y en el comentario.
func (h *GlpiHandler) settle(ctx context.Context, it db.GlpiOutbox, itemID int, err error) {
	setComment := func(state string, msg string, glpiID int) {
		e := pgtype.Text{String: msg, Valid: msg != ""}
		id := pgtype.Int4{Int32: int32(glpiID), Valid: glpiID > 0}
		if it.TicketCommentID.Valid {
			_ = h.Queries.SetTicketCommentPush(ctx, db.SetTicketCommentPushParams{ID: it.TicketCommentID.Bytes, State: pgtype.Text{String: state, Valid: true}, Error: e, GlpiID: id})
		}
		if it.EntryCommentID.Valid {
			_ = h.Queries.SetEntryCommentPush(ctx, db.SetEntryCommentPushParams{ID: it.EntryCommentID.Bytes, State: pgtype.Text{String: state, Valid: true}, Error: e, GlpiID: id})
		}
	}
	defer func() {
		if it.TicketID.Valid {
			publishSync(ctx, h.Hub, "ticket.updated", map[string]string{"id": uuid.UUID(it.TicketID.Bytes).String()})
		}
	}()
	if err == nil {
		_ = h.Queries.MarkGlpiOutboxSent(ctx, db.MarkGlpiOutboxSentParams{ID: it.ID, GlpiItemID: pgtype.Int4{Int32: int32(itemID), Valid: itemID > 0}})
		setComment("sent", "", itemID)
		h.AuditLog.Log(ctx, "glpi.followup.sent", audit.LevelInfo, audit.Success(), map[string]any{"kind": it.Kind, "glpiTicket": it.GlpiTicketID, "glpiItem": itemID})
		return
	}
	msg := explain(err).Error
	if len(msg) > 500 {
		msg = msg[:500]
	}
	step := glpiWriteBackoff[min(int(it.Attempts), len(glpiWriteBackoff)-1)]
	next := h.now().Add(step)
	if !glpi.Permanent(err) && next.Before(it.CreatedAt.Time.Add(glpiWriteDeadline)) {
		_ = h.Queries.MarkGlpiOutboxRetry(ctx, db.MarkGlpiOutboxRetryParams{ID: it.ID, NextAttemptAt: pgtype.Timestamptz{Time: next, Valid: true},
			Error: pgtype.Text{String: msg, Valid: true}})
		setComment("queued", msg, 0)
		return
	}
	_ = h.Queries.MarkGlpiOutboxFailed(ctx, db.MarkGlpiOutboxFailedParams{ID: it.ID, Error: pgtype.Text{String: msg, Valid: true}})
	setComment("failed", msg, 0)
	h.AuditLog.Log(ctx, "glpi.followup.failed", audit.LevelWarn, audit.Failure(msg), map[string]any{"kind": it.Kind, "glpiTicket": it.GlpiTicketID})
	h.notifyWriteFailure(ctx, it, msg)
}

// notifyWriteFailure avisa en la campana a los administradores (una vez al día).
func (h *GlpiHandler) notifyWriteFailure(ctx context.Context, it db.GlpiOutbox, msg string) {
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		return
	}
	local := h.now().In(h.location(ctx))
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	if cfg.WriteFailureNotifiedOn.Valid && cfg.WriteFailureNotifiedOn.Time.Equal(today) {
		return
	}
	if admins, err := h.Queries.ListAdminUserIDs(ctx); err == nil && len(admins) > 0 {
		h.Notify.Send(ctx, admins, NotifMsg{Kind: NotifGlpiWrite, Title: fmt.Sprintf("No se pudo enviar a GLPI-%d", it.GlpiTicketID), Body: msg,
			Link: "/admin?section=glpi", GroupKey: "glpi.write"})
		_ = h.Queries.MarkGlpiWriteFailureNotified(ctx, pgtype.Date{Time: today, Valid: true})
	}
}

// ===== Estado de una copia =====

// AfterStatus: al resolver, cerrar o reabrir en la app un ticket con copia,
// lo mismo pasa en GLPI (spec/18 §4.8, propuesta 1 aprobada).
func (h *GlpiHandler) AfterStatus(ctx context.Context, ticketID uuid.UUID, from, to string, actor uuid.UUID) {
	if h == nil {
		return
	}
	t, err := h.Queries.GetTicket(ctx, ticketID)
	if err != nil || !t.GlpiCopyID.Valid || isGlpiTicket(t) {
		return
	}
	if _, ok := h.writeReady(ctx); !ok {
		return
	}
	kind, content := "", ""
	reopen := (from == "resolved" || from == "closed" || from == "cancelled") && to != "resolved" && to != "closed" && to != "cancelled"
	switch {
	case to == "resolved":
		kind, content = "solve", "Resuelto en Bitácora Ops ("+t.TicketNumber+")."
	case to == "closed" || to == "cancelled":
		kind = "close"
	case reopen:
		kind = "reopen"
	default:
		return
	}
	id, err := h.Queries.InsertGlpiOutbox(ctx, db.InsertGlpiOutboxParams{Kind: kind, GlpiTicketID: t.GlpiCopyID.Int32, TicketID: pgtype.UUID{Bytes: t.ID, Valid: true},
		Content: content, IsPrivate: false, CreatedBy: pgtype.UUID{Bytes: actor, Valid: actor != uuid.Nil}})
	if err == nil {
		h.background(ctx, func(ctx context.Context) { h.SendNow(ctx, id) })
	}
}

// background corre fn aparte (la respuesta no espera a GLPI); con SyncWait
// (las pruebas), en el mismo hilo.
func (h *GlpiHandler) background(ctx context.Context, fn func(context.Context)) {
	if h.SyncWait {
		fn(ctx)
		return
	}
	go fn(context.WithoutCancel(ctx))
}
