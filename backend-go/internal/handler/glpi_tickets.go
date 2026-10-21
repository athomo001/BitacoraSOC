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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// GLPI en la Ticketera, fase 1 (10d.1, spec/18; diseño aprobado por el dueño
// 2026-10-20). Los tickets de GLPI se traen a la Ticketera solo para mirar:
//   - Solo lo elegido: los de las entidades marcadas (con sus hijas) asignados
//     a un grupo técnico con área; el área del grupo decide la cola.
//   - Lo enlazado a mano (un número de GLPI en una entrada de la Bitácora o en
//     un incidente de Escalamiento) se trae siempre, en el área de quien lo
//     enlazó si su grupo no tiene área.
//   - Primera vez: abiertos y cambiados en los últimos N días (90). Después,
//     solo lo que cambió en GLPI desde la última corrida que terminó bien;
//     una corrida con errores no mueve el cursor y la próxima repite la ventana.
//   - GLPI manda: el SLA es el de GLPI; la app no los edita ni manda correos.
//   - Borrado o en la papelera de GLPI: «Eliminado en GLPI», nunca se borra.

// glpiCursorOverlap: cada corrida vuelve a mirar este rato antes del cursor,
// por si GLPI guardó algo en el mismo segundo de la corrida anterior.
const glpiCursorOverlap = 2 * time.Minute

// glpiTicketsEvery: cada cuánto corre la automática.
var glpiTicketsEvery = map[string]time.Duration{"5m": 5 * time.Minute, "15m": 15 * time.Minute}

// ===== Configuración =====

type glpiTicketsConfigDTO struct {
	Enabled   bool   `json:"enabled"`
	Every     string `json:"every"`
	SinceDays int32  `json:"sinceDays"`
	// Entities: las entidades marcadas («Traer»).
	Entities []int `json:"entities"`
	// Clients: entidad → cliente, el mismo mapeo del inventario.
	Clients map[string]uuid.UUID `json:"clients"`
	// GroupAreas: grupo técnico de GLPI → área de la app.
	GroupAreas       map[string]uuid.UUID `json:"groupAreas"`
	FirstLoadPending bool                 `json:"firstLoadPending"`
	NextAutoAt       *time.Time           `json:"nextAutoAt,omitempty"`
	Connected        bool                 `json:"connected"`
}

func decodeTicketEntities(raw []byte) []int {
	out := []int{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func decodeGroupAreas(raw []byte) map[string]uuid.UUID {
	out := map[string]uuid.UUID{}
	_ = json.Unmarshal(raw, &out)
	return out
}

// nextTicketsAuto: cuándo toca la próxima corrida automática (nil si no hay).
func (h *GlpiHandler) nextTicketsAuto(cfg db.GlpiConfig) *time.Time {
	every, ok := glpiTicketsEvery[cfg.TicketsEvery]
	if !cfg.TicketsEnabled || !ok {
		return nil
	}
	at := h.now()
	if cfg.TicketsLastAutoAt.Valid && cfg.TicketsLastAutoAt.Time.Add(every).After(at) {
		at = cfg.TicketsLastAutoAt.Time.Add(every)
	}
	return &at
}

func (h *GlpiHandler) ticketsConfigDTO(cfg db.GlpiConfig) glpiTicketsConfigDTO {
	d := glpiTicketsConfigDTO{Enabled: cfg.TicketsEnabled, Every: cfg.TicketsEvery, SinceDays: cfg.TicketsSinceDays,
		Entities: decodeTicketEntities(cfg.TicketEntities), Clients: map[string]uuid.UUID{}, GroupAreas: decodeGroupAreas(cfg.GroupAreas),
		FirstLoadPending: !cfg.TicketsCursor.Valid, NextAutoAt: h.nextTicketsAuto(cfg),
		Connected: cfg.ApiUrl != "" && cfg.UserTokenEncrypted.Valid && cfg.UserTokenEncrypted.String != ""}
	for id, rule := range decodeEntityRules(cfg.Entities) {
		if rule.OrganizationID != nil {
			d.Clients[id] = *rule.OrganizationID
		}
	}
	return d
}

// GetTicketsConfig es GET /api/glpi/tickets/config.
func (h *GlpiHandler) GetTicketsConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Queries.GetGlpiConfig(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	writeData(w, http.StatusOK, h.ticketsConfigDTO(cfg))
}

type putGlpiTicketsConfigRequest struct {
	Enabled   bool   `json:"enabled"`
	Every     string `json:"every"`
	SinceDays int32  `json:"sinceDays"`
	Entities  []int  `json:"entities"`
	// Clients: solo las entidades que se cambian; null quita el cliente.
	Clients    map[string]*uuid.UUID `json:"clients"`
	GroupAreas map[string]*uuid.UUID `json:"groupAreas"`
}

// PutTicketsConfig es PUT /api/glpi/tickets/config. Si cambian las entidades
// o los grupos, la próxima corrida vuelve a hacer la primera carga.
func (h *GlpiHandler) PutTicketsConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req putGlpiTicketsConfigRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.Every == "" {
		req.Every = "5m"
	}
	if _, ok := glpiTicketsEvery[req.Every]; !ok && req.Every != "off" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cada cuánto: off, 5m o 15m")
		return
	}
	if req.SinceDays == 0 {
		req.SinceDays = 90
	}
	if req.SinceDays < 1 || req.SinceDays > 365 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la primera carga va de 1 a 365 días hacia atrás")
		return
	}
	cur, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	entities := []int{}
	seen := map[int]bool{}
	for _, id := range req.Entities {
		if id < 0 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "entidad de GLPI inválida")
			return
		}
		if !seen[id] {
			seen[id] = true
			entities = append(entities, id)
		}
	}
	sort.Ints(entities)
	areas, err := h.Queries.ListTicketAreas(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	resolves := map[uuid.UUID]bool{}
	for _, a := range areas {
		resolves[a.ID] = a.DefaultProfile != "gestion"
	}
	groups := map[string]uuid.UUID{}
	for gid, area := range req.GroupAreas {
		if n, err := strconv.Atoi(gid); err != nil || n <= 0 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "grupo de GLPI inválido: "+gid)
			return
		}
		if area == nil {
			continue // «No traer»
		}
		if !resolves[*area] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-area", "el área elegida para un grupo no existe, está inactiva o no recibe tickets")
			return
		}
		groups[gid] = *area
	}
	rules := decodeEntityRules(cur.Entities)
	for id, org := range req.Clients {
		if _, err := strconv.Atoi(id); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "entidad de GLPI inválida: "+id)
			return
		}
		rule := rules[id]
		if org == nil {
			rule.OrganizationID = nil
		} else {
			if _, err := h.Queries.GetOrganization(ctx, *org); err != nil {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-client", "el cliente elegido no existe")
				return
			}
			rule.OrganizationID, rule.Skip = org, false
		}
		if rule.OrganizationID == nil && !rule.Skip {
			delete(rules, id)
		} else {
			rules[id] = rule
		}
	}
	entitiesRaw, _ := json.Marshal(entities)
	groupsRaw, _ := json.Marshal(groups)
	rulesRaw, _ := json.Marshal(rules)
	reset := string(entitiesRaw) != string(mustCompact(cur.TicketEntities, "[]")) || !sameGroupAreas(groups, decodeGroupAreas(cur.GroupAreas))
	if err := h.Queries.UpdateGlpiTicketsConfig(ctx, db.UpdateGlpiTicketsConfigParams{TicketsEnabled: req.Enabled, TicketsEvery: req.Every,
		TicketsSinceDays: req.SinceDays, TicketEntities: entitiesRaw, GroupAreas: groupsRaw, Entities: rulesRaw, ResetCursor: reset}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración de GLPI")
		return
	}
	h.AuditLog.Log(ctx, "config.glpi.tickets.update", audit.LevelWarn, audit.Success(), map[string]any{
		"enabled": req.Enabled, "every": req.Every, "sinceDays": req.SinceDays, "entities": entities, "groups": len(groups), "firstLoadAgain": reset,
	})
	h.GetTicketsConfig(w, r)
}

// mustCompact deja un JSON guardado en su forma compacta (o def si viene vacío).
func mustCompact(raw []byte, def string) []byte {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return []byte(def)
	}
	out, _ := json.Marshal(v)
	return out
}

func sameGroupAreas(a, b map[string]uuid.UUID) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

type glpiTicketGroupDTO struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	OpenCount int32  `json:"openCount"`
}

// TicketsCatalog es GET /api/glpi/tickets/catalog: las entidades y los grupos
// técnicos de GLPI, con los tickets abiertos que ya hay en la app por grupo.
func (h *GlpiHandler) TicketsCatalog(w http.ResponseWriter, r *http.Request) {
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
	groups, err := glpi.Groups(ctx, s)
	if err != nil {
		writeGlpiError(w, r, err)
		return
	}
	open := map[int]int32{}
	if rows, err := h.Queries.CountOpenGlpiTicketsByGroup(ctx); err == nil {
		for _, x := range rows {
			open[int(x.GroupID)] = x.OpenCount
		}
	}
	out := make([]glpiTicketGroupDTO, 0, len(groups))
	for _, g := range groups {
		out = append(out, glpiTicketGroupDTO{ID: g.ID, Name: g.Name, OpenCount: open[g.ID]})
	}
	writeData(w, http.StatusOK, map[string]any{"entities": entities, "groups": out})
}

// ===== Corridas =====

type glpiTicketRunDTO struct {
	ID         uuid.UUID  `json:"id"`
	Trigger    string     `json:"trigger"`
	UserName   string     `json:"userName,omitempty"`
	FirstLoad  bool       `json:"firstLoad"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
	Running    bool       `json:"running"`
	OK         bool       `json:"ok"`
	Created    int32      `json:"created"`
	Updated    int32      `json:"updated"`
	Skipped    int32      `json:"skipped"`
	Deleted    int32      `json:"deleted"`
	Message    string     `json:"message"`
}

// glpiRunStale: una corrida sin terminar más vieja que esto se cortó (el
// servidor se reinició a la mitad); no se muestra «en curso».
const glpiRunStale = time.Hour

// TicketRuns es GET /api/glpi/tickets/runs: las últimas corridas.
func (h *GlpiHandler) TicketRuns(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListGlpiTicketRuns(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las corridas")
		return
	}
	out := make([]glpiTicketRunDTO, 0, len(rows))
	for _, x := range rows {
		d := glpiTicketRunDTO{ID: x.ID, Trigger: x.Trigger, UserName: x.UserName, FirstLoad: x.FirstLoad, StartedAt: x.StartedAt.Time, OK: x.Ok,
			Created: x.Created, Updated: x.Updated, Skipped: x.Skipped, Deleted: x.Deleted, Message: x.Message}
		if x.FinishedAt.Valid {
			t := x.FinishedAt.Time
			d.FinishedAt = &t
		} else if h.now().Sub(x.StartedAt.Time) < glpiRunStale {
			d.Running = true
		} else {
			d.Message = "La corrida se cortó (el servidor se reinició a la mitad)."
		}
		out = append(out, d)
	}
	writeData(w, http.StatusOK, out)
}

// SyncTickets es POST /api/glpi/tickets/sync («Sincronizar ahora»). La
// corrida sigue en segundo plano (la primera carga puede tardar minutos);
// la pantalla mira las corridas hasta que termina.
func (h *GlpiHandler) SyncTickets(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de GLPI")
		return
	}
	if !cfg.TicketsEnabled {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-tickets-off", "enciende «Tickets de GLPI» y guarda antes de sincronizar")
		return
	}
	if !h.ticketsRunning.TryLock() {
		problemdetails.Write(w, r, http.StatusConflict, "glpi-busy", "ya hay una sincronización en curso: espera a que termine")
		return
	}
	user := userUUID(ctx)
	runCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Minute)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cancel()
		defer h.ticketsRunning.Unlock()
		_, _ = h.ticketRunLocked(runCtx, cfg, "manual", user)
	}()
	if h.SyncWait {
		<-done
	}
	writeData(w, http.StatusAccepted, map[string]any{"started": true})
}

// runTickets corre una sincronización si no hay otra en curso.
func (h *GlpiHandler) runTickets(ctx context.Context, cfg db.GlpiConfig, trigger string, user pgtype.UUID) (*glpiTicketRunDTO, error) {
	if !h.ticketsRunning.TryLock() {
		return nil, errGlpiBusy
	}
	defer h.ticketsRunning.Unlock()
	return h.ticketRunLocked(ctx, cfg, trigger, user)
}

// TicketsAutoTick corre cada minuto: si toca, sincroniza. Si fallan tres
// corridas automáticas seguidas, avisa en la campana a los administradores
// (una vez al día).
func (h *GlpiHandler) TicketsAutoTick(ctx context.Context) error {
	if !featureEnabled(ctx, h.Queries, glpiFeature) {
		return nil
	}
	cfg, err := h.Queries.GetGlpiConfig(ctx)
	if err != nil {
		return err
	}
	next := h.nextTicketsAuto(cfg)
	if next == nil || h.now().Before(*next) {
		return nil
	}
	if err := h.Queries.MarkGlpiTicketsAutoRun(ctx, pgtype.Timestamptz{Time: h.now(), Valid: true}); err != nil {
		return err
	}
	run, err := h.runTickets(ctx, cfg, "auto", pgtype.UUID{})
	if errors.Is(err, errGlpiBusy) || run == nil || run.OK {
		return nil
	}
	recent, err := h.Queries.RecentGlpiTicketAutoRuns(ctx)
	if err != nil || len(recent) < 3 {
		return nil
	}
	for _, ok := range recent {
		if ok {
			return nil
		}
	}
	local := h.now().In(h.location(ctx))
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	if cfg.TicketsFailureNotifiedOn.Valid && cfg.TicketsFailureNotifiedOn.Time.Equal(today) {
		return nil
	}
	if admins, err := h.Queries.ListAdminUserIDs(ctx); err == nil && len(admins) > 0 {
		h.Notify.Send(ctx, admins, NotifMsg{Kind: NotifGlpiImport, Title: "Los tickets de GLPI no se están trayendo", Body: run.Message,
			Link: "/admin?section=glpi", GroupKey: "glpi.tickets"})
		_ = h.Queries.MarkGlpiTicketsFailureNotified(ctx, pgtype.Date{Time: today, Valid: true})
	}
	return nil
}

// ===== La sincronización =====

// glpiTicketSync es el estado de una corrida.
type glpiTicketSync struct {
	h    *GlpiHandler
	s    *glpi.Session
	cfg  db.GlpiConfig
	loc  *time.Location
	run  *glpiTicketRunDTO
	errs []string
	// warns: avisos que no hacen fallar la corrida (uno por tipo).
	warns       []string
	noClient    []string
	noArea      int
	maxDateMod  string
	parents     map[int]int
	entityNames map[int]string
	marked      map[int]bool
	rules       map[string]glpiEntityRule
	groupAreas  map[int]uuid.UUID
	groupNames  map[int]string
	areas       []db.ListTicketAreasRow
	areaCodes   map[uuid.UUID]string
	people      map[int]glpiPerson
	linkerArea  map[uuid.UUID]uuid.UUID
	done        map[int]bool
}

type glpiPerson struct {
	name   string
	userID pgtype.UUID
}

// ticketRunLocked hace la corrida (el llamador tiene el candado) y la deja
// registrada.
func (h *GlpiHandler) ticketRunLocked(ctx context.Context, cfg db.GlpiConfig, trigger string, user pgtype.UUID) (*glpiTicketRunDTO, error) {
	firstLoad := !cfg.TicketsCursor.Valid
	runID, err := h.Queries.CreateGlpiTicketRun(ctx, db.CreateGlpiTicketRunParams{Trigger: trigger, UserID: user, FirstLoad: firstLoad})
	if err != nil {
		return nil, err
	}
	sy := &glpiTicketSync{h: h, cfg: cfg, loc: h.location(ctx), run: &glpiTicketRunDTO{ID: runID, Trigger: trigger, FirstLoad: firstLoad, StartedAt: h.now()},
		people: map[int]glpiPerson{}, linkerArea: map[uuid.UUID]uuid.UUID{}, done: map[int]bool{}}
	err = sy.sync(ctx)
	if err != nil {
		ex := explain(err)
		sy.errs = append([]string{ex.Error + " " + ex.Next}, sy.errs...)
	}
	sy.finish(ctx)
	return sy.run, err
}

func (sy *glpiTicketSync) sync(ctx context.Context) error {
	h := sy.h
	s, err := h.open(ctx, sy.cfg)
	if err != nil {
		return err
	}
	defer s.Close()
	sy.s = s
	if err := sy.prepare(ctx); err != nil {
		return err
	}
	q := glpi.TicketQuery{Entities: decodeTicketEntities(sy.cfg.TicketEntities)}
	if sy.cfg.TicketsCursor.Valid {
		q.ModifiedAfter = sy.cfg.TicketsCursor.String
		if at, ok := glpi.ParseDate(q.ModifiedAfter, sy.loc); ok {
			q.ModifiedAfter = at.Add(-glpiCursorOverlap).Format(glpi.DateLayout)
		}
	} else {
		q.Since = h.now().In(sy.loc).AddDate(0, 0, -int(sy.cfg.TicketsSinceDays)).Format(glpi.DateLayout)
	}
	changed, err := glpi.SearchTicketIDs(ctx, s, q)
	if err != nil {
		return fmt.Errorf("búsqueda de tickets: %w", err)
	}
	q.Trashed = true
	trashed, err := glpi.SearchTicketIDs(ctx, s, q)
	if err != nil {
		return fmt.Errorf("papelera de tickets: %w", err)
	}
	copies, err := h.Queries.ListGlpiCopies(ctx)
	if err != nil {
		return err
	}
	for _, c := range copies {
		sy.done[int(c.GlpiCopyID)] = true // una copia no es un GLPI-…: es el mismo ticket de la app
	}
	links := map[int]uuid.UUID{}
	if rows, err := h.Queries.ListGlpiHandLinks(ctx); err == nil {
		for _, x := range rows {
			links[int(x.GlpiID)] = x.UserID
		}
	} else {
		return err
	}
	for _, id := range changed {
		sy.process(ctx, id, links, true)
	}
	for _, id := range trashed {
		if n, err := h.Queries.MarkGlpiTicketDeleted(ctx, pgtype.Int4{Int32: int32(id), Valid: true}); err == nil && n > 0 {
			sy.run.Deleted++
		}
		sy.done[id] = true
	}
	// Lo enlazado a mano: lo nuevo y lo que llegó solo por un enlace y sigue
	// abierto (la búsqueda por entidad no lo ve).
	refresh, err := h.Queries.ListOpenGlpiLinkedOnly(ctx)
	if err != nil {
		return err
	}
	pending := map[int]bool{}
	for _, id := range refresh {
		pending[int(id)] = true
	}
	for id := range links {
		if _, err := h.Queries.GetGlpiTicketState(ctx, pgtype.Int4{Int32: int32(id), Valid: true}); errors.Is(err, pgx.ErrNoRows) {
			pending[id] = true
		}
	}
	ids := make([]int, 0, len(pending))
	for id := range pending {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		sy.process(ctx, id, links, false)
	}
	for _, c := range copies {
		sy.copy(ctx, c)
	}
	return nil
}

// copy trae a un ticket de la app lo que alguien escribió en GLPI sobre su
// copia (10d.2, «van y vuelven»). Solo si la copia cambió en GLPI; lo que
// escribió la app (con SyncMarker) no se trae de vuelta.
func (sy *glpiTicketSync) copy(ctx context.Context, c db.ListGlpiCopiesRow) {
	h := sy.h
	var head map[string]any
	if err := sy.s.Get(ctx, fmt.Sprintf("%s/%d", glpi.Ticket, c.GlpiCopyID), nil, &head); err != nil {
		if !errors.Is(err, glpi.ErrNotFound) {
			sy.warn(fmt.Sprintf("No se pudieron leer copias en GLPI: %s", glpi.Explain(err).Error))
		}
		return
	}
	dateMod := glpi.Str(head["date_mod"])
	if c.GlpiCopyDateMod.Valid && c.GlpiCopyDateMod.String == dateMod {
		return
	}
	td, err := glpi.FetchTicket(ctx, sy.s, int(c.GlpiCopyID))
	if err != nil {
		sy.errs = append(sy.errs, fmt.Sprintf("copia GLPI-%d: %s", c.GlpiCopyID, glpi.Explain(err).Error))
		return
	}
	keep := []string{}
	for _, n := range td.Notes {
		keep = append(keep, fmt.Sprintf("%s:%d", n.Kind, n.ID))
		if n.Ours {
			continue
		}
		person := sy.person(ctx, n.UserID)
		when := pgtype.Timestamptz{Time: h.now(), Valid: true}
		if t, ok := glpi.ParseDate(n.Date, sy.loc); ok {
			when = pgtype.Timestamptz{Time: t, Valid: true}
		}
		cp := db.UpsertGlpiCopyCommentParams{TicketID: c.ID, UserID: person.userID, AuthorName: person.name, Content: n.Content,
			IsPublic: !n.Private, GlpiID: int32(n.ID), GlpiKind: n.Kind, CreatedAt: when}
		if n.Kind == "task" && n.Seconds > 0 {
			cp.GlpiTimeSeconds = pgtype.Int4{Int32: int32(n.Seconds), Valid: true}
		}
		if err := h.Queries.UpsertGlpiCopyComment(ctx, cp); err != nil {
			sy.errs = append(sy.errs, fmt.Sprintf("copia GLPI-%d: %v", c.GlpiCopyID, err))
			return
		}
	}
	if err := h.Queries.DeleteGlpiCopyCommentsExcept(ctx, db.DeleteGlpiCopyCommentsExceptParams{TicketID: c.ID, Keep: keep}); err != nil {
		sy.errs = append(sy.errs, fmt.Sprintf("copia GLPI-%d: %v", c.GlpiCopyID, err))
		return
	}
	_ = h.Queries.SetGlpiCopyDateMod(ctx, db.SetGlpiCopyDateModParams{ID: c.ID, GlpiCopyDateMod: pgtype.Text{String: dateMod, Valid: dateMod != ""}})
	sy.run.Updated++
	publishSync(ctx, h.Hub, "ticket.updated", map[string]string{"id": c.ID.String()})
}

// prepare lee de GLPI las entidades y los grupos, y de la app las áreas.
func (sy *glpiTicketSync) prepare(ctx context.Context) error {
	entities, err := glpi.Entities(ctx, sy.s)
	if err != nil {
		return fmt.Errorf("entidades: %w", err)
	}
	sy.parents, sy.entityNames = map[int]int{}, map[int]string{}
	for _, e := range entities {
		sy.parents[e.ID], sy.entityNames[e.ID] = e.ParentID, e.Name
	}
	sy.marked = map[int]bool{}
	for _, id := range decodeTicketEntities(sy.cfg.TicketEntities) {
		sy.marked[id] = true
	}
	sy.rules = decodeEntityRules(sy.cfg.Entities)
	sy.groupNames = map[int]string{}
	if groups, err := glpi.Groups(ctx, sy.s); err == nil {
		for _, g := range groups {
			sy.groupNames[g.ID] = g.Name
		}
	} else {
		sy.warn(fmt.Sprintf("No se pudieron leer los nombres de los grupos: %s", glpi.Explain(err).Error))
	}
	areas, err := sy.h.Queries.ListTicketAreas(ctx)
	if err != nil {
		return err
	}
	sy.areas, sy.areaCodes = areas, map[uuid.UUID]string{}
	for _, a := range areas {
		if a.DefaultProfile != "gestion" {
			sy.areaCodes[a.ID] = a.Code
		}
	}
	sy.groupAreas = map[int]uuid.UUID{}
	for gid, area := range decodeGroupAreas(sy.cfg.GroupAreas) {
		if n, err := strconv.Atoi(gid); err == nil {
			if _, ok := sy.areaCodes[area]; ok {
				sy.groupAreas[n] = area
			}
		}
	}
	return nil
}

func (sy *glpiTicketSync) warn(msg string) {
	for _, w := range sy.warns {
		if w == msg {
			return
		}
	}
	sy.warns = append(sy.warns, msg)
}

// underMarked: la entidad o alguna de sus madres está marcada.
func (sy *glpiTicketSync) underMarked(id int) bool {
	for i := 0; i < 64; i++ {
		if sy.marked[id] {
			return true
		}
		parent, ok := sy.parents[id]
		if !ok || parent < 0 || parent == id {
			return false
		}
		id = parent
	}
	return false
}

// clientOf: el cliente de la entidad o de la madre más cercana que tenga uno.
func (sy *glpiTicketSync) clientOf(id int) (uuid.UUID, bool) {
	for i := 0; i < 64; i++ {
		if rule, ok := sy.rules[strconv.Itoa(id)]; ok && rule.OrganizationID != nil {
			return *rule.OrganizationID, true
		}
		parent, ok := sy.parents[id]
		if !ok || parent < 0 || parent == id {
			return uuid.Nil, false
		}
		id = parent
	}
	return uuid.Nil, false
}

// areaOfLinker: la primera área que resuelve de quien enlazó el ticket.
func (sy *glpiTicketSync) areaOfLinker(ctx context.Context, user uuid.UUID) uuid.UUID {
	if a, ok := sy.linkerArea[user]; ok {
		return a
	}
	scope := ticketScope{areas: map[uuid.UUID]bool{}}
	if rows, err := sy.h.Queries.ListUserTicketGroups(ctx, user); err == nil {
		for _, r := range rows {
			if r.AreaID.Valid {
				scope.areas[uuid.UUID(r.AreaID.Bytes)] = true
			}
		}
	}
	a := defaultTicketArea(sy.areas, scope, "").ID
	sy.linkerArea[user] = a
	return a
}

// person: el nombre de un usuario de GLPI y la persona de la app con su correo.
func (sy *glpiTicketSync) person(ctx context.Context, id int) glpiPerson {
	if id <= 0 {
		return glpiPerson{name: "GLPI"}
	}
	if p, ok := sy.people[id]; ok {
		return p
	}
	p := glpiPerson{name: fmt.Sprintf("Usuario de GLPI #%d", id)}
	if u, err := glpi.FetchUser(ctx, sy.s, id); err != nil {
		sy.warn(fmt.Sprintf("No se pudieron leer los usuarios de GLPI (se muestran por su número): %s", glpi.Explain(err).Error))
	} else {
		if u.Name != "" {
			p.name = u.Name
		}
		if u.Email != "" {
			if rows, err := sy.h.Queries.ListUsersByEmails(ctx, []string{strings.ToLower(u.Email)}); err == nil && len(rows) > 0 {
				p.userID = pgtype.UUID{Bytes: rows[0].ID, Valid: true}
			}
		}
	}
	sy.people[id] = p
	return p
}

// process trae un ticket. fromSearch: lo encontró la búsqueda por entidad.
func (sy *glpiTicketSync) process(ctx context.Context, id int, links map[int]uuid.UUID, fromSearch bool) {
	if sy.done[id] {
		return
	}
	sy.done[id] = true
	h := sy.h
	td, err := glpi.FetchTicket(ctx, sy.s, id)
	if errors.Is(err, glpi.ErrNotFound) {
		if n, err := h.Queries.MarkGlpiTicketDeleted(ctx, pgtype.Int4{Int32: int32(id), Valid: true}); err == nil && n > 0 {
			sy.run.Deleted++
		}
		return
	}
	if err != nil {
		sy.errs = append(sy.errs, fmt.Sprintf("GLPI-%d: %s", id, glpi.Explain(err).Error))
		return
	}
	if fromSearch && td.DateMod > sy.maxDateMod {
		sy.maxDateMod = td.DateMod
	}
	state, err := h.Queries.GetGlpiTicketState(ctx, pgtype.Int4{Int32: int32(id), Valid: true})
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		sy.errs = append(sy.errs, fmt.Sprintf("GLPI-%d: %v", id, err))
		return
	}
	linker, linked := links[id]
	inEntity := sy.underMarked(td.EntityID)
	var area uuid.UUID
	group := 0
	for _, g := range td.Groups {
		if a, ok := sy.groupAreas[g]; ok {
			area, group = a, g
			break
		}
	}
	passes := inEntity && group != 0
	if group == 0 && len(td.Groups) > 0 {
		group = td.Groups[0]
	}
	switch {
	case passes:
	case linked && (!exists || state.GlpiLinkedOnly):
		area = sy.areaOfLinker(ctx, linker)
		if exists {
			area = state.AreaID
		}
	case exists:
		area = state.AreaID // ya estaba en la app: sigue al día en su cola
	default:
		sy.noArea++
		sy.run.Skipped++
		return
	}
	client, ok := sy.clientOf(td.EntityID)
	if !ok {
		sy.run.Skipped++
		name := sy.entityNames[td.EntityID]
		if name == "" {
			name = fmt.Sprintf("#%d", td.EntityID)
		}
		sy.noClient = append(sy.noClient, fmt.Sprintf("GLPI-%d («%s»)", id, name))
		return
	}
	linkedOnly := !passes && (linked || (exists && state.GlpiLinkedOnly))
	if exists && state.GlpiDateMod.Valid && state.GlpiDateMod.String == td.DateMod && state.AreaID == area &&
		state.GlpiLinkedOnly == linkedOnly && state.GlpiDeleted == td.Deleted {
		return // no cambió nada
	}
	if err := sy.save(ctx, td, client, area, group, linkedOnly); err != nil {
		sy.errs = append(sy.errs, fmt.Sprintf("GLPI-%d: no se pudo guardar: %v", id, err))
		return
	}
}

// save guarda el ticket con sus seguimientos en una transacción.
func (sy *glpiTicketSync) save(ctx context.Context, td glpi.TicketData, client, area uuid.UUID, group int, linkedOnly bool) error {
	h := sy.h
	at := func(raw string) pgtype.Timestamptz {
		if t, ok := glpi.ParseDate(raw, sy.loc); ok {
			return pgtype.Timestamptz{Time: t, Valid: true}
		}
		return pgtype.Timestamptz{}
	}
	created, updated := at(td.Date), at(td.DateMod)
	if !created.Valid {
		created = pgtype.Timestamptz{Time: h.now(), Valid: true}
	}
	if !updated.Valid {
		updated = created
	}
	status := glpiTicketStatus(td.Status)
	p := db.UpsertGlpiTicketParams{GlpiID: int32(td.ID), TicketType: db.TicketTypeIncident, Scope: db.EntryScopeGeneral, ClientID: client,
		Status: status, Impact: db.ItilImpact(glpiLevel(td.Impact)), Urgency: db.ItilUrgency(glpiLevel(td.Urgency)), Priority: glpiPriority(td.Priority),
		Title: strings.TrimSpace(td.Name), Description: td.Content, SlaResponseDueAt: at(td.TimeToOwn), SlaResolutionDueAt: at(td.TimeToResolve),
		FirstRespondedAt: at(td.TakeIntoAccount), CreatedAt: created, UpdatedAt: updated, AreaID: area,
		GlpiDateMod: pgtype.Text{String: td.DateMod, Valid: td.DateMod != ""}, GlpiDeleted: td.Deleted, GlpiLinkedOnly: linkedOnly}
	if td.Type == 2 {
		p.TicketType = db.TicketTypeServiceRequest
	}
	switch sy.areaCodes[area] {
	case "soc":
		p.Scope = db.EntryScopeSoc
	case "noc":
		p.Scope = db.EntryScopeNoc
	}
	if p.Title == "" {
		p.Title = fmt.Sprintf("Ticket de GLPI %d", td.ID)
	}
	if status == db.TicketStatusPendingVendor {
		p.SlaOnHoldSince = at(td.BeginWaiting)
		if !p.SlaOnHoldSince.Valid {
			p.SlaOnHoldSince = updated
		}
	}
	if status == db.TicketStatusResolved || status == db.TicketStatusClosed {
		p.ResolvedAt = at(td.SolveDate)
		if !p.ResolvedAt.Valid {
			p.ResolvedAt = updated
		}
	}
	if status == db.TicketStatusClosed {
		p.ClosedAt = at(td.CloseDate)
		if !p.ClosedAt.Valid {
			p.ClosedAt = updated
		}
	}
	if group != 0 {
		p.GlpiGroupID = pgtype.Int4{Int32: int32(group), Valid: true}
		name := sy.groupNames[group]
		if name == "" {
			name = fmt.Sprintf("Grupo de GLPI #%d", group)
		}
		p.GlpiGroupName = pgtype.Text{String: name, Valid: true}
	}
	if len(td.Techs) > 0 {
		tech := sy.person(ctx, td.Techs[0])
		p.AssignedUserID, p.GlpiTechnician = tech.userID, pgtype.Text{String: tech.name, Valid: true}
	}
	type note struct {
		glpi.Note
		person glpiPerson
	}
	notes := make([]note, 0, len(td.Notes))
	for _, n := range td.Notes {
		notes = append(notes, note{Note: n, person: sy.person(ctx, n.UserID)})
	}
	tx, err := h.Inventory.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	row, err := q.UpsertGlpiTicket(ctx, p)
	if err != nil {
		return err
	}
	keep := make([]string, 0, len(notes))
	for _, n := range notes {
		if n.Ours {
			// Lo escribió la app (10d.2): su comentario ya está, con su autor.
			keep = append(keep, fmt.Sprintf("%s:%d", n.Kind, n.ID))
			continue
		}
		when := at(n.Date)
		if !when.Valid {
			when = created
		}
		cp := db.UpsertGlpiTicketCommentParams{TicketID: row.ID, UserID: n.person.userID, AuthorName: n.person.name, Content: n.Content,
			IsPublic: !n.Private, GlpiID: int32(n.ID), GlpiKind: n.Kind, CreatedAt: when}
		if n.Kind == "task" && n.Seconds > 0 {
			cp.GlpiTimeSeconds = pgtype.Int4{Int32: int32(n.Seconds), Valid: true}
		}
		if err := q.UpsertGlpiTicketComment(ctx, cp); err != nil {
			return err
		}
		keep = append(keep, fmt.Sprintf("%s:%d", n.Kind, n.ID))
	}
	if err := q.DeleteGlpiTicketCommentsExcept(ctx, db.DeleteGlpiTicketCommentsExceptParams{TicketID: row.ID, Keep: keep}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if row.Inserted {
		sy.run.Created++
	} else {
		sy.run.Updated++
	}
	publishSync(ctx, h.Hub, "ticket.updated", map[string]string{"id": row.ID.String()})
	h.Forward.FromAudit(ctx, audit.Entry{Event: "ticket.glpi_synced", Level: audit.LevelInfo, Success: true, ActorUsername: "GLPI",
		Metadata: map[string]any{"ticketId": row.ID.String(), "created": row.Inserted}})
	return nil
}

// finish mueve el cursor (solo si no hubo errores) y registra la corrida.
func (sy *glpiTicketSync) finish(ctx context.Context) {
	h := sy.h
	sy.run.OK = len(sy.errs) == 0
	if sy.run.OK {
		next := sy.cfg.TicketsCursor.String
		if sy.maxDateMod > next {
			next = sy.maxDateMod
		}
		if next == "" {
			next = h.now().In(sy.loc).Format(glpi.DateLayout)
		}
		_ = h.Queries.SetGlpiTicketsCursor(ctx, pgtype.Text{String: next, Valid: true})
	}
	msgs := append([]string{}, sy.errs...)
	if len(sy.errs) > 0 {
		msgs = append(msgs, "La próxima corrida vuelve a mirar la misma ventana.")
	}
	if sy.noArea > 0 {
		msgs = append(msgs, fmt.Sprintf("%d sin un grupo técnico con área: no se traen.", sy.noArea))
	}
	if n := len(sy.noClient); n > 0 {
		list := sy.noClient
		if n > 5 {
			list = append(list[:5:5], fmt.Sprintf("y %d más", n-5))
		}
		msgs = append(msgs, fmt.Sprintf("Sin cliente para su entidad (elige el cliente en «Tus entidades»): %s.", strings.Join(list, ", ")))
	}
	msgs = append(msgs, sy.warns...)
	if sy.run.FirstLoad && sy.run.OK {
		msgs = append([]string{fmt.Sprintf("Primera carga: %d días.", sy.cfg.TicketsSinceDays)}, msgs...)
	}
	sy.run.Message = strings.Join(msgs, " ")
	_ = h.Queries.FinishGlpiTicketRun(ctx, db.FinishGlpiTicketRunParams{ID: sy.run.ID, Ok: sy.run.OK, Created: sy.run.Created, Updated: sy.run.Updated,
		Skipped: sy.run.Skipped, Deleted: sy.run.Deleted, Message: sy.run.Message})
	now := h.now()
	sy.run.FinishedAt = &now
	outcome := audit.Success()
	if !sy.run.OK {
		outcome = audit.Failure(sy.run.Message)
	}
	h.AuditLog.Log(ctx, "glpi.tickets.sync", audit.LevelInfo, outcome, map[string]any{"trigger": sy.run.Trigger, "firstLoad": sy.run.FirstLoad,
		"created": sy.run.Created, "updated": sy.run.Updated, "skipped": sy.run.Skipped, "deleted": sy.run.Deleted})
}

// ===== Cómo se traduce cada campo (spec/18 §3.3) =====

func glpiTicketStatus(s int) db.TicketStatus {
	switch s {
	case 2:
		return db.TicketStatusAssigned
	case 3:
		return db.TicketStatusInProgress
	case 4:
		return db.TicketStatusPendingVendor
	case 5:
		return db.TicketStatusResolved
	case 6:
		return db.TicketStatusClosed
	}
	return db.TicketStatusNew
}

// glpiLevel: urgencia o impacto de GLPI (1–5) → baja, media o alta.
func glpiLevel(n int) string {
	switch {
	case n >= 4:
		return "high"
	case n == 3:
		return "medium"
	}
	return "low"
}

// glpiPriority: 5–6 → P1, 4 → P2, 3 → P3, 1–2 → P4.
func glpiPriority(n int) db.ItilPriority {
	switch {
	case n >= 5:
		return db.ItilPriorityP1Critical
	case n == 4:
		return db.ItilPriorityP2High
	case n == 3:
		return db.ItilPriorityP3Medium
	}
	return db.ItilPriorityP4Low
}
