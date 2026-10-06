package handler

import (
	"context"
	"net/http"
	"regexp"
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

	"github.com/jackc/pgx/v5/pgtype"
)

// BirthdaysHandler son los correos de cumpleaños (birthdayEmailScheduler del
// legacy; comentario del dueño #21): una vez al día, desde la hora
// configurada, a cada usuario activo que cumple años, con el correo del área
// en copia.
type BirthdaysHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
	Now      func() time.Time
}

var hhmm = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// birthdayZone es la zona del servidor legacy (TZ=America/Santiago).
func birthdayZone() *time.Location {
	if loc, err := time.LoadLocation("America/Santiago"); err == nil {
		return loc
	}
	return time.Local
}

func (h *BirthdaysHandler) now() time.Time {
	if h.Now != nil {
		return h.Now().In(birthdayZone())
	}
	return time.Now().In(birthdayZone())
}

type birthdayConfigDTO struct {
	Enabled      bool   `json:"enabled"`
	Time         string `json:"time"`
	Cc           string `json:"cc"`
	LastSentDate string `json:"lastSentDate,omitempty"`
}

func toBirthdayConfigDTO(enabled bool, at, cc string, last pgtype.Date) birthdayConfigDTO {
	dto := birthdayConfigDTO{Enabled: enabled, Time: at, Cc: cc}
	if last.Valid {
		dto.LastSentDate = last.Time.Format("2006-01-02")
	}
	return dto
}

// GetConfig es GET /api/config/birthday-emails (admin).
func (h *BirthdaysHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	c, err := h.Queries.GetBirthdayConfig(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración")
		return
	}
	writeData(w, http.StatusOK, toBirthdayConfigDTO(c.BirthdayEmailsEnabled, c.BirthdayEmailsTime, c.BirthdayEmailsCc, c.BirthdayEmailsLastDate))
}

// UpdateConfig es PUT /api/config/birthday-emails (admin).
func (h *BirthdaysHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req birthdayConfigDTO
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Time = strings.TrimSpace(req.Time)
	req.Cc = strings.TrimSpace(req.Cc)
	if !hhmm.MatchString(req.Time) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "la hora de envío va como HH:MM")
		return
	}
	if req.Cc != "" && !directory.ValidEmail(req.Cc) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el correo del área no es válido")
		return
	}
	c, err := h.Queries.UpdateBirthdayConfig(ctx, db.UpdateBirthdayConfigParams{Enabled: req.Enabled, Time: req.Time, Cc: req.Cc})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración")
		return
	}
	h.AuditLog.Log(ctx, "config.birthday_emails.update", audit.LevelInfo, audit.Success(), map[string]any{
		"enabled": c.BirthdayEmailsEnabled, "time": c.BirthdayEmailsTime, "hasCc": c.BirthdayEmailsCc != "",
	})
	writeData(w, http.StatusOK, toBirthdayConfigDTO(c.BirthdayEmailsEnabled, c.BirthdayEmailsTime, c.BirthdayEmailsCc, c.BirthdayEmailsLastDate))
}

// birthdayMail arma el correo con el logo de Marca y la ilustración en línea.
func (h *BirthdaysHandler) birthdayMail(ctx context.Context, userName string) (mailtpl.Mail, []mail.Inline) {
	brand := branding.Load(ctx, h.Queries, true)
	inline := []mail.Inline{{CID: mailtpl.BirthdayImageCID, Name: "birthday_kawaii.jpg", ContentType: "image/jpeg", Data: mailtpl.BirthdayImage}}
	logoSrc := ""
	if len(brand.Logo) > 0 {
		logoSrc = "cid:" + mailtpl.BirthdayLogoCID
		inline = append(inline, mail.Inline{CID: mailtpl.BirthdayLogoCID, Name: "logo-email" + logoExtension(brand.LogoType), ContentType: brand.LogoType, Data: brand.Logo})
	}
	return mailtpl.Birthday(brand.AppTitle, userName, logoSrc, "cid:"+mailtpl.BirthdayImageCID), inline
}

// SendTest es POST /api/config/birthday-emails/test (admin): el correo de
// cumpleaños al propio admin, sin copia, para verlo antes de encenderlo.
func (h *BirthdaysHandler) SendTest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	actor, _ := middleware.UserFromContext(ctx)
	user, err := h.Queries.GetUserByID(ctx, actor.ID)
	if err != nil || strings.TrimSpace(user.Email) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "tu usuario no tiene correo")
		return
	}
	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "smtp-not-configured", "configura el correo en Administración → Correo antes de probar")
		return
	}
	name := strings.TrimSpace(user.FullName.String)
	if name == "" {
		name = user.Username
	}
	m, inline := h.birthdayMail(ctx, name)
	if err := sender.SendRich([]string{user.Email}, nil, "[Prueba] "+m.Subject, htmlToText(m.HTML), m.HTML, inline); err != nil {
		h.AuditLog.Log(ctx, "birthday.email.test", audit.LevelWarn, audit.Failure(err.Error()), nil)
		problemdetails.Write(w, r, http.StatusBadGateway, "mail-failed", "no se pudo enviar la prueba: "+err.Error())
		return
	}
	h.AuditLog.Log(ctx, "birthday.email.test", audit.LevelInfo, audit.Success(), nil)
	writeData(w, http.StatusOK, map[string]string{"to": user.Email})
}

// DispatchDue es runBirthdayEmails del legacy: si está encendido, ya pasó la
// hora y hoy no se envió, felicita a quienes cumplen años hoy.
func (h *BirthdaysHandler) DispatchDue(ctx context.Context) error {
	c, err := h.Queries.GetBirthdayConfig(ctx)
	if err != nil || !c.BirthdayEmailsEnabled {
		return err
	}
	now := h.now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if c.BirthdayEmailsLastDate.Valid && c.BirthdayEmailsLastDate.Time.Equal(today) {
		return nil
	}
	if now.Format("15:04") < c.BirthdayEmailsTime {
		return nil
	}
	users, err := h.Queries.ListBirthdayUsers(ctx, db.ListBirthdayUsersParams{Month: int32(now.Month()), Day: int32(now.Day())})
	if err != nil {
		return err
	}
	if len(users) > 0 {
		sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
		if err != nil {
			return nil // sin correo configurado no se marca: se intenta en la próxima vuelta
		}
		var cc []string
		if c.BirthdayEmailsCc != "" {
			cc = []string{c.BirthdayEmailsCc}
		}
		for _, u := range users {
			m, inline := h.birthdayMail(ctx, u.DisplayName)
			meta := map[string]any{"recipientId": u.ID.String(), "recipientUsername": u.Username}
			if err := sender.SendRich([]string{u.Email}, cc, m.Subject, htmlToText(m.HTML), m.HTML, inline); err != nil {
				h.AuditLog.Log(ctx, "birthday.email.sent", audit.LevelWarn, audit.Failure(err.Error()), meta)
				continue
			}
			h.AuditLog.Log(ctx, "birthday.email.sent", audit.LevelInfo, audit.Success(), meta)
		}
	}
	return h.Queries.MarkBirthdayEmailsSent(ctx, pgtype.Date{Time: today, Valid: true})
}

// Image es GET /api/config/birthday-emails/image (pública): la ilustración
// del correo, para la miniatura de Administración (un <img> no manda el token).
func (h *BirthdaysHandler) Image(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(mailtpl.BirthdayImage)
}
