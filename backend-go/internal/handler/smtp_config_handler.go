package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// SMTPConfigHandler cubre GET/PUT /api/config/smtp y POST
// /api/config/smtp/test-send (spec/04-contratos-api.md "Configuración de
// correo"). Gap real: el contrato los ubicaba en la Fase 4 pero nunca se
// expusieron por HTTP; la Fase 7 los necesita para que notify despache.
type SMTPConfigHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
}

type smtpConfigDTO struct {
	Host        string `json:"host"`
	Port        int32  `json:"port"`
	Username    string `json:"username"`
	FromAddress string `json:"fromAddress"`
	FromName    string `json:"fromName"`
	RequireTLS  bool   `json:"requireTls"`
	HasPassword bool   `json:"hasPassword"` // nunca se devuelve la contraseña, ni cifrada
	// LastTest es la última prueba de envío (nil si nunca se probó).
	LastTest *smtpLastTestDTO `json:"lastTest"`
}

type smtpLastTestDTO struct {
	At    time.Time `json:"at"`
	OK    bool      `json:"ok"`
	Error string    `json:"error,omitempty"`
}

// validSenderName: hasta 100 caracteres y sin caracteres de control (un salto
// de línea en el nombre no debe poder llegar a una cabecera del correo).
func validSenderName(name string) bool {
	if len([]rune(name)) > 100 {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func (h *SMTPConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Queries.GetSMTPConfig(r.Context())
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "smtp-not-configured", "todavía no se configuró el servidor de correo")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración SMTP")
		return
	}
	dto := smtpConfigDTO{
		Host: cfg.Host, Port: cfg.Port, Username: cfg.Username.String, FromAddress: cfg.FromAddress, FromName: cfg.FromName.String,
		RequireTLS: cfg.RequireTls, HasPassword: cfg.PasswordEncrypted.Valid && cfg.PasswordEncrypted.String != "",
	}
	if cfg.LastTestAt.Valid {
		dto.LastTest = &smtpLastTestDTO{At: cfg.LastTestAt.Time, OK: cfg.LastTestOk.Bool, Error: cfg.LastTestError.String}
	}
	writeData(w, http.StatusOK, dto)
}

type putSMTPConfigRequest struct {
	Host        string  `json:"host"`
	Port        int32   `json:"port"`
	Username    *string `json:"username"`
	Password    *string `json:"password"`
	FromAddress string  `json:"fromAddress"`
	FromName    *string `json:"fromName"`
	RequireTLS  bool    `json:"requireTls"`
}

// Put guarda la configuración. La contraseña se cifra antes de persistir; si
// no se envía, se conserva la ya guardada (no se puede "vaciar" sin querer).
func (h *SMTPConfigHandler) Put(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req putSMTPConfigRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Host, req.FromAddress = strings.TrimSpace(req.Host), strings.TrimSpace(req.FromAddress)
	if req.Host == "" || req.Port <= 0 || req.Port > 65535 || !directory.ValidEmail(req.FromAddress) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "host, port (1-65535) y fromAddress (correo válido) son obligatorios")
		return
	}
	if req.FromName != nil {
		trimmed := strings.TrimSpace(*req.FromName)
		req.FromName = &trimmed
		if !validSenderName(trimmed) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre del remitente admite hasta 100 caracteres, sin saltos de línea")
			return
		}
	}
	var password pgtype.Text
	if req.Password != nil && *req.Password != "" {
		enc, err := h.Crypto.Encrypt(*req.Password)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cifrar la contraseña")
			return
		}
		password = pgtype.Text{String: enc, Valid: true}
	} else if current, err := h.Queries.GetSMTPConfig(ctx); err == nil {
		password = current.PasswordEncrypted
	}
	// Igual que la contraseña: sin fromName en el body se conserva el actual;
	// con fromName vacío se quita.
	fromName := nonEmptyText(req.FromName)
	if req.FromName == nil {
		if current, err := h.Queries.GetSMTPConfig(ctx); err == nil {
			fromName = current.FromName
		}
	}
	if err := h.Queries.UpsertSMTPConfig(ctx, db.UpsertSMTPConfigParams{
		Host: req.Host, Port: req.Port, Username: nonEmptyText(req.Username), PasswordEncrypted: password,
		FromAddress: req.FromAddress, FromName: fromName, RequireTls: req.RequireTLS,
	}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración SMTP")
		return
	}
	h.AuditLog.Log(ctx, "config.smtp.update", audit.LevelWarn, audit.Success(), map[string]any{
		"host": req.Host, "port": req.Port, "passwordChanged": req.Password != nil && *req.Password != "",
	})
	h.Get(w, r)
}

type testSendRequest struct {
	To string `json:"to"`
}

// TestSend usa la configuración guardada (descifra la contraseña en el
// momento); nunca recibe credenciales en el body.
func (h *SMTPConfigHandler) TestSend(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req testSendRequest
	if err := decodeJSON(w, r, &req); err != nil || !directory.ValidEmail(strings.TrimSpace(req.To)) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "to debe ser un correo válido")
		return
	}
	sender, _, err := buildMailSender(ctx, h.Queries, h.Crypto)
	if err != nil {
		writeData(w, http.StatusBadGateway, map[string]any{"sent": false, "error": "SMTP no configurado"})
		return
	}
	body := "Este es un correo de prueba de Bitácora Ops.\r\n\r\nSi lo recibiste, la configuración SMTP funciona."
	if err := sender.Send(strings.TrimSpace(req.To), "Prueba de correo - Bitácora Ops", body); err != nil {
		_ = h.Queries.RecordSMTPTest(ctx, db.RecordSMTPTestParams{LastTestOk: pgtype.Bool{Bool: false, Valid: true}, LastTestError: pgtype.Text{String: err.Error(), Valid: true}})
		h.AuditLog.Log(ctx, "config.smtp.test_send", audit.LevelWarn, audit.Failure(err.Error()), nil)
		writeData(w, http.StatusBadGateway, map[string]any{"sent": false, "error": err.Error()})
		return
	}
	_ = h.Queries.RecordSMTPTest(ctx, db.RecordSMTPTestParams{LastTestOk: pgtype.Bool{Bool: true, Valid: true}})
	h.AuditLog.Log(ctx, "config.smtp.test_send", audit.LevelInfo, audit.Success(), nil)
	writeData(w, http.StatusAccepted, map[string]any{"sent": true})
}
