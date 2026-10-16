package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Calendario en Outlook (spec/16 §6.1, 9.7, 000044, diseño aprobado por el
// dueño 2026-10-15): cada persona crea en su Perfil un enlace secreto propio
// (suscripción ICS, solo lectura) con sus vencimientos de la Agenda y, si
// quiere, las ventanas de mantenimiento de sus áreas. Solo lo que está a su
// nombre (decisión del dueño). Sin notas ni datos de tickets: título,
// cliente, área y el enlace a la Bitácora. Va detrás de calendar_feed.
type CalendarFeedHandler struct {
	Queries       *db.Queries
	Crypto        *crypto.Box
	AuditLog      *audit.Logger
	PublicBaseURL string
	Now           func() time.Time
}

const calendarFeature = "calendar_feed"

// Lo que trae el calendario: lo que pasó hace poco (para ver lo hecho) y lo
// que la Agenda ya generó hacia adelante.
const (
	feedPastDays   = 30
	feedFutureDays = agendaHorizon
)

func (h *CalendarFeedHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

type calendarFeedDTO struct {
	URL            string     `json:"url"`
	IncludeWindows bool       `json:"includeWindows"`
	CreatedAt      time.Time  `json:"createdAt"`
	LastReadAt     *time.Time `json:"lastReadAt,omitempty"`
}

func (h *CalendarFeedHandler) feedURL(token string) string {
	return strings.TrimRight(h.PublicBaseURL, "/") + "/cal/" + token + ".ics"
}

func (h *CalendarFeedHandler) enabled(w http.ResponseWriter, r *http.Request) bool {
	if !featureEnabled(r.Context(), h.Queries, calendarFeature) {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "el calendario en Outlook está apagado (Administración → Funcionalidades)")
		return false
	}
	return true
}

// writeMine responde el enlace de la persona (o null si no tiene).
func (h *CalendarFeedHandler) writeMine(w http.ResponseWriter, r *http.Request, user uuid.UUID) {
	f, err := h.Queries.GetCalendarFeed(r.Context(), user)
	if errors.Is(err, pgx.ErrNoRows) {
		writeData(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer tu calendario")
		return
	}
	token, err := h.Crypto.Decrypt(f.TokenEncrypted)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer tu enlace: genera uno nuevo")
		return
	}
	writeData(w, http.StatusOK, calendarFeedDTO{URL: h.feedURL(token), IncludeWindows: f.IncludeWindows, CreatedAt: f.CreatedAt.Time, LastReadAt: timestamptzPtr(f.LastReadAt)})
}

// Mine: GET /api/users/me/calendar.
func (h *CalendarFeedHandler) Mine(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w, r) {
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	h.writeMine(w, r, user.ID)
}

// Create: POST /api/users/me/calendar. Crea el enlace o genera uno nuevo (el
// anterior deja de funcionar).
func (h *CalendarFeedHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w, r) {
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	include := true
	if f, err := h.Queries.GetCalendarFeed(ctx, user.ID); err == nil {
		include = f.IncludeWindows
	}
	token, hash, err := newShareToken()
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el enlace")
		return
	}
	enc, err := h.Crypto.Encrypt(token)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el enlace")
		return
	}
	if err := h.Queries.UpsertCalendarFeed(ctx, db.UpsertCalendarFeedParams{UserID: user.ID, TokenHash: hash, TokenEncrypted: enc, IncludeWindows: include}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el enlace")
		return
	}
	h.AuditLog.Log(ctx, "calendar_feed.create", audit.LevelInfo, audit.Success(), map[string]any{"userId": user.ID.String()})
	h.writeMine(w, r, user.ID)
}

// Update: PUT /api/users/me/calendar {includeWindows}.
func (h *CalendarFeedHandler) Update(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w, r) {
		return
	}
	var req struct {
		IncludeWindows bool `json:"includeWindows"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON inválido")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	n, err := h.Queries.SetCalendarFeedWindows(r.Context(), db.SetCalendarFeedWindowsParams{UserID: user.ID, IncludeWindows: req.IncludeWindows})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "todavía no tienes un enlace")
		return
	}
	h.AuditLog.Log(r.Context(), "calendar_feed.update", audit.LevelInfo, audit.Success(), map[string]any{"userId": user.ID.String(), "includeWindows": req.IncludeWindows})
	h.writeMine(w, r, user.ID)
}

// Delete: DELETE /api/users/me/calendar. El enlace deja de responder.
func (h *CalendarFeedHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w, r) {
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	if _, err := h.Queries.DeleteCalendarFeed(ctx, user.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo desactivar")
		return
	}
	h.AuditLog.Log(ctx, "calendar_feed.delete", audit.LevelInfo, audit.Success(), map[string]any{"userId": user.ID.String()})
	writeNoContent(w)
}

// Feed: GET /cal/{file} (público, el token es la llave). No revela si el
// token existió: cualquier problema es un 404.
func (h *CalendarFeedHandler) Feed(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := strings.TrimSuffix(r.PathValue("file"), ".ics")
	if !teleworkTokenRe.MatchString(token) || !featureEnabled(ctx, h.Queries, calendarFeature) {
		http.NotFound(w, r)
		return
	}
	sum := sha256.Sum256([]byte(token))
	f, err := h.Queries.GetCalendarFeedByToken(ctx, hex.EncodeToString(sum[:]))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	body, err := h.render(ctx, f.UserID, f.IncludeWindows)
	if err != nil {
		http.Error(w, "no se pudo armar el calendario", http.StatusInternalServerError)
		return
	}
	_ = h.Queries.TouchCalendarFeed(ctx, f.UserID)
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Robots-Tag", "noindex")
	_, _ = w.Write([]byte(body))
}

func (h *CalendarFeedHandler) render(ctx context.Context, user uuid.UUID, withWindows bool) (string, error) {
	s, err := h.Queries.GetAgendaSettings(ctx)
	if err != nil {
		return "", err
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		loc = time.UTC
	}
	now := h.now()
	today := agenda.Day(now, loc)
	occs, err := h.Queries.ListFeedOccurrences(ctx, db.ListFeedOccurrencesParams{UserID: pgUUIDOf(user),
		FromDay: pgDate(today.AddDate(0, 0, -feedPastDays)), ToDay: pgDate(today.AddDate(0, 0, feedFutureDays))})
	if err != nil {
		return "", err
	}
	base := strings.TrimRight(h.PublicBaseURL, "/")
	cal := icsCalendar{Name: branding.Load(ctx, h.Queries, false).AppTitle, Stamp: now}
	for _, o := range occs {
		title := o.TaskName
		if o.OrganizationName != "" {
			title += " · " + o.OrganizationName
		}
		if o.Status == "done" {
			title = "Hecha: " + title
		}
		cal.Events = append(cal.Events, icsEvent{
			UID: "agenda-" + o.ID.String(), Summary: title, AllDay: o.DueDate.Time, Stamp: o.UpdatedAt.Time,
			Description: fmt.Sprintf("Área: %s\nVence a las %s\n%s/agenda", o.AreaName, s.DayEnd, base), URL: base + "/agenda",
		})
	}
	if withWindows {
		groups, err := h.Queries.ListUserAgendaGroups(ctx, user)
		if err != nil {
			return "", err
		}
		areas := map[uuid.UUID]bool{}
		for _, g := range groups {
			if g.AreaID.Valid {
				areas[uuid.UUID(g.AreaID.Bytes)] = true
			}
		}
		wins, err := h.Queries.ListWindowsBetween(ctx, db.ListWindowsBetweenParams{FromAt: pgTime(today.AddDate(0, 0, -feedPastDays)), ToAt: pgTime(today.AddDate(0, 0, feedFutureDays))})
		if err != nil {
			return "", err
		}
		for _, x := range wins {
			if !areas[x.AreaID] {
				continue
			}
			title := "Mantenimiento: " + x.Title
			if x.TargetName != "" && x.TargetName != x.Title {
				title += " · " + x.TargetName
			}
			cal.Events = append(cal.Events, icsEvent{
				UID: "ventana-" + x.ID.String(), Summary: title, Start: x.StartsAt.Time, End: x.EndsAt.Time, Stamp: now,
				Description: base + "/escalation", URL: base + "/escalation",
			})
		}
	}
	return cal.String(), nil
}

// ===== ICS (RFC 5545) =====

type icsEvent struct {
	UID, Summary, Description, URL string
	// AllDay: evento de todo el día (los vencimientos). Si es cero, Start/End.
	AllDay, Start, End, Stamp time.Time
}

type icsCalendar struct {
	Name   string
	Stamp  time.Time
	Events []icsEvent
}

func (c icsCalendar) String() string {
	var b strings.Builder
	line := func(s string) { b.WriteString(icsFold(s)) }
	line("BEGIN:VCALENDAR")
	line("VERSION:2.0")
	line("PRODID:-//Bitacora Ops//Agenda//ES")
	line("CALSCALE:GREGORIAN")
	line("METHOD:PUBLISH")
	line("X-WR-CALNAME:" + icsText(c.Name))
	line("X-PUBLISHED-TTL:PT1H")
	line("REFRESH-INTERVAL;VALUE=DURATION:PT1H")
	for _, e := range c.Events {
		stamp := e.Stamp
		if stamp.IsZero() {
			stamp = c.Stamp
		}
		line("BEGIN:VEVENT")
		line("UID:" + e.UID + "@bitacora")
		line("DTSTAMP:" + stamp.UTC().Format("20060102T150405Z"))
		if !e.AllDay.IsZero() {
			line("DTSTART;VALUE=DATE:" + e.AllDay.Format("20060102"))
			line("DTEND;VALUE=DATE:" + e.AllDay.AddDate(0, 0, 1).Format("20060102"))
		} else {
			line("DTSTART:" + e.Start.UTC().Format("20060102T150405Z"))
			line("DTEND:" + e.End.UTC().Format("20060102T150405Z"))
		}
		line("SUMMARY:" + icsText(e.Summary))
		if e.Description != "" {
			line("DESCRIPTION:" + icsText(e.Description))
		}
		if e.URL != "" {
			line("URL:" + e.URL)
		}
		// Disponible: un vencimiento no bloquea la agenda de la persona.
		line("TRANSP:TRANSPARENT")
		line("END:VEVENT")
	}
	line("END:VCALENDAR")
	return b.String()
}

// icsText escapa un texto (RFC 5545 §3.3.11).
func icsText(s string) string {
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`, "\r", `\n`)
	return r.Replace(s)
}

// icsFold corta las líneas en 75 octetos sin partir un carácter y termina en CRLF.
func icsFold(s string) string {
	var b strings.Builder
	limit := 75
	for len(s) > limit {
		cut := limit
		for cut > 0 && !utf8.RuneStart(s[cut]) {
			cut--
		}
		b.WriteString(s[:cut])
		b.WriteString("\r\n ")
		s = s[cut:]
		limit = 74 // la continuación ya ocupa un espacio
	}
	b.WriteString(s)
	b.WriteString("\r\n")
	return b.String()
}
