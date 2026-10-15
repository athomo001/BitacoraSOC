package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// CapNoticesSend: enviar avisos con acuse de lectura (spec/16 §4.5.1). La
// jefatura de área lo tiene por defecto (decisión del dueño 2026-10-15).
const CapNoticesSend = "notices:send"

// NotificationsHandler cubre la campana, las preferencias de cada persona,
// la configuración del admin y los avisos con acuse (spec/16 §4.5, 9.5,
// 000042, diseño aprobado 2026-10-15).
type NotificationsHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Notify   *Notifier
}

func notifFail(w http.ResponseWriter, r *http.Request) {
	problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer o guardar las notificaciones")
}

// ===== Campana =====

type notificationDTO struct {
	ID        uuid.UUID  `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Link      string     `json:"link"`
	Count     int32      `json:"count"`
	Toast     bool       `json:"toast"`
	Browser   bool       `json:"browser"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
}

// List: las notificaciones del usuario (?filter=unread|all) y cuántas no leyó.
func (h *NotificationsHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	rows, err := h.Queries.ListNotifications(ctx, db.ListNotificationsParams{UserID: user.ID, OnlyUnread: r.URL.Query().Get("filter") == "unread", Lim: 200})
	if err != nil {
		notifFail(w, r)
		return
	}
	unread, err := h.Queries.CountUnreadNotifications(ctx, user.ID)
	if err != nil {
		notifFail(w, r)
		return
	}
	out := make([]notificationDTO, 0, len(rows))
	for _, n := range rows {
		out = append(out, notificationDTO{ID: n.ID, Kind: n.Kind, Title: n.Title, Body: n.Body, Link: n.Link, Count: n.Count, Toast: n.Toast,
			Browser: n.Browser, CreatedAt: n.CreatedAt.Time, UpdatedAt: n.UpdatedAt.Time, ReadAt: timestamptzPtr(n.ReadAt)})
	}
	writeData(w, http.StatusOK, map[string]any{"items": out, "unread": unread})
}

// Read marca leídas las indicadas (o todas si no vienen ids).
func (h *NotificationsHandler) Read(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	if req.IDs == nil {
		req.IDs = []uuid.UUID{}
	}
	n, err := h.Queries.MarkNotificationsRead(ctx, db.MarkNotificationsReadParams{UserID: user.ID, Ids: req.IDs})
	if err != nil {
		notifFail(w, r)
		return
	}
	// Marcar leído no se audita uno por uno: es la bandeja propia. Se deja
	// solo «todas», que es una acción explícita.
	if len(req.IDs) == 0 && n > 0 {
		h.AuditLog.Log(ctx, "notification.read_all", audit.LevelInfo, audit.Success(), map[string]any{"count": n})
	}
	unread, _ := h.Queries.CountUnreadNotifications(ctx, user.ID)
	writeData(w, http.StatusOK, map[string]any{"unread": unread})
}

// ===== Preferencias =====

type prefKindDTO struct {
	notifKind
	Locked  bool  `json:"locked"`
	MyToast *bool `json:"myToast,omitempty"`
	MyEmail *bool `json:"myEmail,omitempty"`
}

func (h *NotificationsHandler) prefsPayload(ctx context.Context, user uuid.UUID) (map[string]any, error) {
	settings, err := h.Queries.GetNotificationSettings(ctx)
	if err != nil {
		return nil, err
	}
	locked := map[string]bool{}
	for _, k := range settings.LockedKinds {
		locked[k] = true
	}
	p := userNotifPrefs{Kinds: map[string]notifPref{}, Digest: true}
	if row, err := h.Queries.GetNotificationPrefs(ctx, user); err == nil {
		p = decodeNotifPrefs(row.Prefs, row.Digest, row.Browser)
	}
	kinds := make([]prefKindDTO, 0, len(notifKinds))
	for _, k := range notifKinds {
		toast, email, _ := p.channels(k.Kind, locked)
		kinds = append(kinds, prefKindDTO{notifKind: k, Locked: locked[k.Kind], MyToast: &toast, MyEmail: &email})
	}
	return map[string]any{"kinds": kinds, "digest": p.Digest, "browser": p.Browser, "digestTime": settings.DigestTime}, nil
}

func (h *NotificationsHandler) GetPrefs(w http.ResponseWriter, r *http.Request) {
	user, _ := middleware.UserFromContext(r.Context())
	out, err := h.prefsPayload(r.Context(), user.ID)
	if err != nil {
		notifFail(w, r)
		return
	}
	writeData(w, http.StatusOK, out)
}

func (h *NotificationsHandler) PutPrefs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kinds   map[string]notifPref `json:"kinds"`
		Digest  bool                 `json:"digest"`
		Browser bool                 `json:"browser"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	clean := map[string]notifPref{}
	for k, v := range req.Kinds {
		if def := notifKindOf(k); def.Kind == k && (def.ToastAllowed || def.EmailAllowed) {
			clean[k] = v
		}
	}
	raw, _ := json.Marshal(clean)
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	if err := h.Queries.UpsertNotificationPrefs(ctx, db.UpsertNotificationPrefsParams{UserID: user.ID, Prefs: raw, Digest: req.Digest, Browser: req.Browser}); err != nil {
		notifFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "notification.prefs.updated", audit.LevelInfo, audit.Success(), map[string]any{"digest": req.Digest, "browser": req.Browser})
	h.GetPrefs(w, r)
}

// ===== Configuración (admin) =====

func (h *NotificationsHandler) Settings(w http.ResponseWriter, r *http.Request) {
	s, err := h.Queries.GetNotificationSettings(r.Context())
	if err != nil {
		notifFail(w, r)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"digestTime": s.DigestTime, "lockedKinds": s.LockedKinds, "groupMinutes": s.GroupMinutes,
		"retentionDays": s.RetentionDays, "kinds": notifKinds})
}

func (h *NotificationsHandler) PutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DigestTime    string   `json:"digestTime"`
		LockedKinds   []string `json:"lockedKinds"`
		GroupMinutes  int32    `json:"groupMinutes"`
		RetentionDays int32    `json:"retentionDays"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	clock, err := agenda.ParseClock(req.DigestTime)
	if err != nil || req.GroupMinutes < 0 || req.GroupMinutes > 240 || req.RetentionDays < 7 || req.RetentionDays > 730 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "hora HH:MM, agrupar de 0 a 240 minutos y guardar de 7 a 730 días")
		return
	}
	locked := []string{}
	for _, k := range req.LockedKinds {
		if notifKindOf(k).Kind == k && !contains(locked, k) {
			locked = append(locked, k)
		}
	}
	if !contains(locked, NotifNotice) {
		locked = append(locked, NotifNotice) // el aviso con acuse no se apaga nunca
	}
	ctx := r.Context()
	if err := h.Queries.UpdateNotificationSettings(ctx, db.UpdateNotificationSettingsParams{DigestTime: clock.String(), LockedKinds: locked,
		GroupMinutes: req.GroupMinutes, RetentionDays: req.RetentionDays}); err != nil {
		notifFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "notification.settings.updated", audit.LevelInfo, audit.Success(), map[string]any{
		"digestTime": clock.String(), "lockedKinds": locked, "groupMinutes": req.GroupMinutes, "retentionDays": req.RetentionDays})
	h.Settings(w, r)
}

// ===== Avisos con acuse =====

// canSendNotices: el admin, la jefatura de área y quien tiene el permiso.
func (h *NotificationsHandler) canSendNotices(ctx context.Context) (bool, bool) {
	user, _ := middleware.UserFromContext(ctx)
	if user.Role == "admin" {
		return true, true
	}
	caps, err := h.Queries.ListUserCapabilities(ctx, user.ID)
	if err != nil {
		return false, false
	}
	for _, c := range caps {
		if c == CapNoticesSend || c == CapAreaLead {
			return true, false
		}
	}
	return false, false
}

type noticeAudience struct {
	// Kind: people | level | area | all.
	Kind     string      `json:"kind"`
	UserIDs  []uuid.UUID `json:"userIds,omitempty"`
	AreaIDs  []uuid.UUID `json:"areaIds,omitempty"`
	LevelIDs []uuid.UUID `json:"levelIds,omitempty"`
}

// recipients resuelve a quiénes llega: personas, un nivel de un área, áreas enteras o todos.
func (h *NotificationsHandler) recipients(ctx context.Context, a noticeAudience) ([]uuid.UUID, error) {
	switch a.Kind {
	case "all":
		return h.Queries.ListActiveUserIDs(ctx)
	case "people":
		return a.UserIDs, nil
	}
	people, err := h.Queries.ListAreaPeopleLevels(ctx)
	if err != nil {
		return nil, err
	}
	area := map[uuid.UUID]bool{}
	for _, id := range a.AreaIDs {
		area[id] = true
	}
	level := map[uuid.UUID]bool{}
	for _, id := range a.LevelIDs {
		level[id] = true
	}
	var out []uuid.UUID
	for _, p := range people {
		if !area[p.AreaID] {
			continue
		}
		if a.Kind == "level" && !(p.LevelID.Valid && level[uuid.UUID(p.LevelID.Bytes)]) {
			continue
		}
		out = append(out, p.UserID)
	}
	return out, nil
}

// NoticesMeta: si el usuario puede enviar avisos.
func (h *NotificationsHandler) NoticesMeta(w http.ResponseWriter, r *http.Request) {
	can, all := h.canSendNotices(r.Context())
	writeData(w, http.StatusOK, map[string]any{"canSend": can, "seesAll": all})
}

func (h *NotificationsHandler) CreateNotice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if can, _ := h.canSendNotices(ctx); !can {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "necesitas el permiso «Enviar avisos con acuse»")
		return
	}
	var req struct {
		Title     string         `json:"title"`
		Body      string         `json:"body"`
		Audience  noticeAudience `json:"audience"`
		PublishAt *time.Time     `json:"publishAt"`
		ExpiresAt *time.Time     `json:"expiresAt"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	req.Title, req.Body = strings.TrimSpace(req.Title), strings.TrimSpace(req.Body)
	a := req.Audience
	okAudience := (a.Kind == "all") || (a.Kind == "people" && len(a.UserIDs) > 0) || (a.Kind == "area" && len(a.AreaIDs) > 0) ||
		(a.Kind == "level" && len(a.AreaIDs) > 0 && len(a.LevelIDs) > 0)
	if req.Title == "" || len([]rune(req.Title)) > 200 || req.Body == "" || len([]rune(req.Body)) > 10000 || !okAudience {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "título, texto y a quién (personas, un nivel, un área o todos)")
		return
	}
	publish, publishAt := time.Now(), pgtype.Timestamptz{} // sin hora = ahora (la de la base)
	if req.PublishAt != nil && req.PublishAt.After(publish) {
		publish, publishAt = *req.PublishAt, pgTime(*req.PublishAt)
	}
	expires := pgtype.Timestamptz{}
	if req.ExpiresAt != nil {
		if !req.ExpiresAt.After(publish) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la fecha en que deja de aparecer debe ser posterior a la publicación")
			return
		}
		expires = pgTime(*req.ExpiresAt)
	}
	audience, _ := json.Marshal(a)
	user, _ := middleware.UserFromContext(ctx)
	id, err := h.Queries.CreateNotice(ctx, db.CreateNoticeParams{Title: req.Title, Body: req.Body, Audience: audience, PublishAt: publishAt,
		ExpiresAt: expires, CreatedBy: pgUUIDOf(user.ID)})
	if err != nil {
		notifFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "notice.created", audit.LevelInfo, audit.Success(), map[string]any{"noticeId": id.String(), "title": req.Title, "audience": a.Kind})
	if err := h.PublishDue(ctx); err != nil {
		notifFail(w, r)
		return
	}
	h.writeSent(w, r, http.StatusCreated)
}

// PublishDue publica los avisos cuya hora llegó: arma la lista de quienes
// lo reciben y les deja el aviso en la campana. Corre en el scheduler.
func (h *NotificationsHandler) PublishDue(ctx context.Context) error {
	due, err := h.Queries.ListDueNotices(ctx)
	if err != nil {
		return err
	}
	for _, n := range due {
		var a noticeAudience
		_ = json.Unmarshal(n.Audience, &a)
		users, err := h.recipients(ctx, a)
		if err != nil {
			return err
		}
		active, err := h.Queries.ListNotifyUsers(ctx, users)
		if err != nil {
			return err
		}
		var ids []uuid.UUID
		for _, u := range active {
			if u.Active {
				if _, err := h.Queries.InsertNoticeRecipient(ctx, db.InsertNoticeRecipientParams{NoticeID: n.ID, UserID: u.ID}); err != nil {
					return err
				}
				ids = append(ids, u.ID)
			}
		}
		if err := h.Queries.MarkNoticePublished(ctx, n.ID); err != nil {
			return err
		}
		h.Notify.Send(ctx, ids, NotifMsg{Kind: NotifNotice, Title: "Aviso: " + n.Title, Body: n.Body})
		publishSync(ctx, h.Notify.Hub, "notices.published", map[string]any{"users": ids})
	}
	return nil
}

type pendingNoticeDTO struct {
	ID            uuid.UUID `json:"id"`
	Title         string    `json:"title"`
	Body          string    `json:"body"`
	PublishAt     time.Time `json:"publishAt"`
	CreatedByName string    `json:"createdByName"`
}

// Pending: los avisos que el usuario todavía no leyó, el más antiguo primero.
func (h *NotificationsHandler) Pending(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	rows, err := h.Queries.ListPendingNotices(ctx, user.ID)
	if err != nil {
		notifFail(w, r)
		return
	}
	out := make([]pendingNoticeDTO, 0, len(rows))
	for _, n := range rows {
		out = append(out, pendingNoticeDTO{ID: n.ID, Title: n.Title, Body: n.Body, PublishAt: n.PublishAt.Time, CreatedByName: n.CreatedByName})
	}
	writeData(w, http.StatusOK, out)
}

// ReadNotice: «Leído». Queda quién y cuándo, también en Auditoría.
func (h *NotificationsHandler) ReadNotice(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-id", "id inválido")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	n, err := h.Queries.MarkNoticeRead(ctx, db.MarkNoticeReadParams{NoticeID: id, UserID: user.ID})
	if err != nil {
		notifFail(w, r)
		return
	}
	if n > 0 {
		h.AuditLog.Log(ctx, "notice.read", audit.LevelInfo, audit.Success(), map[string]any{"noticeId": id.String()})
		publishSync(ctx, h.Notify.Hub, "notices.read", map[string]string{"noticeId": id.String()})
	}
	writeNoContent(w)
}

type sentNoticeDTO struct {
	ID            uuid.UUID      `json:"id"`
	Title         string         `json:"title"`
	Body          string         `json:"body"`
	Audience      noticeAudience `json:"audience"`
	PublishAt     time.Time      `json:"publishAt"`
	ExpiresAt     *time.Time     `json:"expiresAt,omitempty"`
	Published     bool           `json:"published"`
	CreatedByName string         `json:"createdByName"`
	Total         int32          `json:"total"`
	Read          int32          `json:"read"`
}

func (h *NotificationsHandler) writeSent(w http.ResponseWriter, r *http.Request, status int) {
	ctx := r.Context()
	can, all := h.canSendNotices(ctx)
	if !can {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "necesitas el permiso «Enviar avisos con acuse»")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	rows, err := h.Queries.ListSentNotices(ctx, db.ListSentNoticesParams{All: all, UserID: user.ID})
	if err != nil {
		notifFail(w, r)
		return
	}
	out := make([]sentNoticeDTO, 0, len(rows))
	for _, n := range rows {
		d := sentNoticeDTO{ID: n.ID, Title: n.Title, Body: n.Body, PublishAt: n.PublishAt.Time, ExpiresAt: timestamptzPtr(n.ExpiresAt), Published: n.Published,
			CreatedByName: n.CreatedByName, Total: n.Total, Read: n.Read}
		_ = json.Unmarshal(n.Audience, &d.Audience)
		out = append(out, d)
	}
	writeData(w, status, out)
}

// Sent: los avisos que envió el usuario (el admin ve todos) con su avance.
func (h *NotificationsHandler) Sent(w http.ResponseWriter, r *http.Request) {
	h.writeSent(w, r, http.StatusOK)
}

// noticeFor: el aviso del path, si el usuario lo envió (o es admin).
func (h *NotificationsHandler) noticeFor(w http.ResponseWriter, r *http.Request) (db.GetNoticeRow, bool) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-id", "id inválido")
		return db.GetNoticeRow{}, false
	}
	n, err := h.Queries.GetNotice(ctx, id)
	user, _ := middleware.UserFromContext(ctx)
	if err != nil || !(user.Role == "admin" || uuidEq(n.CreatedBy, user.ID)) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "aviso no encontrado")
		return n, false
	}
	return n, true
}

type noticeRecipientDTO struct {
	UserID     uuid.UUID  `json:"userId"`
	Name       string     `json:"name"`
	ReadAt     *time.Time `json:"readAt,omitempty"`
	RemindedAt *time.Time `json:"remindedAt,omitempty"`
}

// Recipients: quién lo leyó y quién falta.
func (h *NotificationsHandler) Recipients(w http.ResponseWriter, r *http.Request) {
	n, ok := h.noticeFor(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListNoticeRecipients(r.Context(), n.ID)
	if err != nil {
		notifFail(w, r)
		return
	}
	out := make([]noticeRecipientDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, noticeRecipientDTO{UserID: x.UserID, Name: x.Name, ReadAt: timestamptzPtr(x.ReadAt), RemindedAt: timestamptzPtr(x.RemindedAt)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReadAt == nil && out[j].ReadAt != nil })
	writeData(w, http.StatusOK, out)
}

// Remind: recuerda por correo a quienes no lo leyeron.
func (h *NotificationsHandler) Remind(w http.ResponseWriter, r *http.Request) {
	n, ok := h.noticeFor(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	rows, err := h.Queries.ListNoticeRecipients(ctx, n.ID)
	if err != nil {
		notifFail(w, r)
		return
	}
	var to []string
	for _, x := range rows {
		if !x.ReadAt.Valid && x.Email != "" {
			to = append(to, x.Email)
		}
	}
	if len(to) == 0 {
		problemdetails.Write(w, r, http.StatusConflict, "nothing-to-remind", "todos lo leyeron")
		return
	}
	brandName, _ := h.Notify.brand(ctx)
	m := noticeReminderMail(brandName, n.Title)
	// Un correo por persona, para no exponer las direcciones de los demás.
	for _, addr := range to {
		h.Notify.mail(ctx, []string{addr}, m.Subject, m.HTML)
	}
	if err := h.Queries.MarkNoticeReminded(ctx, n.ID); err != nil {
		notifFail(w, r)
		return
	}
	h.AuditLog.Log(ctx, "notice.reminded", audit.LevelInfo, audit.Success(), map[string]any{"noticeId": n.ID.String(), "count": len(to)})
	writeData(w, http.StatusOK, map[string]any{"reminded": len(to)})
}

func noticeReminderMail(brand, title string) mailtpl.Mail {
	return mailtpl.NoticeReminder(brand, title)
}
