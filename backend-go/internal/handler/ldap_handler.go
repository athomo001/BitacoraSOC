package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ldapauth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Entrar con la cuenta del dominio (pendiente 10k, spec/20; decisiones del
// dueño 2026-10-26). Va detrás de system_features.ldap y la configura solo
// el admin (Administración → LDAP). El directorio solo valida la
// contraseña: rol, áreas, nivel y grupos son de la Bitácora (auth_ldap.go).
const ldapFeature = "ldap"

// LdapHandler atiende /api/ldap/*: la conexión con el directorio y «Probar».
type LdapHandler struct {
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
	// Dial abre la conexión (en las pruebas, un directorio falso).
	Dial func(ldapauth.Config) (ldapauth.Conn, error)
}

// RequireEnabled corta con 403 si la funcionalidad está apagada: la sección
// desaparece del menú y la API no responde.
func (h *LdapHandler) RequireEnabled(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !featureEnabled(r.Context(), h.Queries, ldapFeature) {
			problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "entrar con la cuenta del dominio está apagado (Administración → Funcionalidades)")
			return
		}
		next(w, r)
	}
}

// ldapConfigOf arma la conexión guardada, sin la contraseña de servicio.
func ldapConfigOf(c db.LdapConfig) ldapauth.Config {
	return ldapauth.Config{URL: c.Url, StartTLS: c.StartTls, VerifyTLS: c.VerifyTls, CAPEM: c.CaPem, BindDN: c.BindDn,
		BaseDN: c.BaseDn, UserFilter: c.UserFilter, UsernameAttr: c.UsernameAttr, NameAttr: c.NameAttr, EmailAttr: c.EmailAttr,
		GroupDN: c.GroupDn, Timeout: time.Duration(c.TimeoutSeconds) * time.Second}
}

// ldapDirectory arma el directorio con la contraseña de servicio descifrada.
// Error si falta configurarlo.
func ldapDirectory(ctx context.Context, q *db.Queries, box *crypto.Box, dial func(ldapauth.Config) (ldapauth.Conn, error)) (ldapauth.Directory, error) {
	c, err := q.GetLdapConfig(ctx)
	if err != nil {
		return ldapauth.Directory{}, errors.New("no se pudo leer la configuración de LDAP")
	}
	cfg := ldapConfigOf(c)
	if cfg.URL == "" || !c.BindPasswordEncrypted.Valid || c.BindPasswordEncrypted.String == "" {
		return ldapauth.Directory{}, errors.New("falta configurar el servidor y la cuenta de servicio de LDAP")
	}
	if cfg.BindPassword, err = box.Decrypt(c.BindPasswordEncrypted.String); err != nil {
		return ldapauth.Directory{}, errors.New("no se pudo descifrar la contraseña de la cuenta de servicio: vuelve a escribirla")
	}
	return ldapauth.Directory{Config: cfg, Dial: dial}, nil
}

type ldapConfigDTO struct {
	URL             string       `json:"url"`
	StartTLS        bool         `json:"startTls"`
	VerifyTLS       bool         `json:"verifyTls"`
	CAPEM           string       `json:"caPem"`
	BindDN          string       `json:"bindDn"`
	HasBindPassword bool         `json:"hasBindPassword"`
	BaseDN          string       `json:"baseDn"`
	UserFilter      string       `json:"userFilter"`
	UsernameAttr    string       `json:"usernameAttr"`
	NameAttr        string       `json:"nameAttr"`
	EmailAttr       string       `json:"emailAttr"`
	GroupDN         string       `json:"groupDn"`
	TimeoutSeconds  int32        `json:"timeoutSeconds"`
	LocalAdmins     int64        `json:"localAdmins"`
	LastTest        *ldapTestDTO `json:"lastTest,omitempty"`
}

type ldapTestDTO struct {
	At       time.Time       `json:"at"`
	OK       bool            `json:"ok"`
	Error    string          `json:"error,omitempty"`
	Username string          `json:"username,omitempty"`
	Entry    *ldapauth.Entry `json:"entry,omitempty"`
}

// GetConfig es GET /api/ldap/config. La contraseña de servicio nunca sale.
func (h *LdapHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	c, err := h.Queries.GetLdapConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de LDAP")
		return
	}
	locals, _ := h.Queries.CountLocalAdmins(ctx)
	d := ldapConfigDTO{URL: c.Url, StartTLS: c.StartTls, VerifyTLS: c.VerifyTls, CAPEM: c.CaPem, BindDN: c.BindDn,
		HasBindPassword: c.BindPasswordEncrypted.Valid && c.BindPasswordEncrypted.String != "", BaseDN: c.BaseDn,
		UserFilter: c.UserFilter, UsernameAttr: c.UsernameAttr, NameAttr: c.NameAttr, EmailAttr: c.EmailAttr,
		GroupDN: c.GroupDn, TimeoutSeconds: c.TimeoutSeconds, LocalAdmins: locals}
	if c.LastTestAt.Valid {
		t := ldapTestDTO{}
		_ = json.Unmarshal(c.LastTest, &t)
		t.At, t.OK = c.LastTestAt.Time, c.LastTestOk.Bool
		d.LastTest = &t
	}
	writeData(w, http.StatusOK, d)
}

type putLdapConfigRequest struct {
	URL            string  `json:"url"`
	StartTLS       bool    `json:"startTls"`
	VerifyTLS      bool    `json:"verifyTls"`
	CAPEM          string  `json:"caPem"`
	BindDN         string  `json:"bindDn"`
	BindPassword   *string `json:"bindPassword"`
	BaseDN         string  `json:"baseDn"`
	UserFilter     string  `json:"userFilter"`
	UsernameAttr   string  `json:"usernameAttr"`
	NameAttr       string  `json:"nameAttr"`
	EmailAttr      string  `json:"emailAttr"`
	GroupDN        string  `json:"groupDn"`
	TimeoutSeconds int32   `json:"timeoutSeconds"`
}

// PutConfig es PUT /api/ldap/config. Una contraseña de servicio sin enviar
// (o vacía) se conserva. Sin TLS no se guarda.
func (h *LdapHandler) PutConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req putLdapConfigRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	cur, err := h.Queries.GetLdapConfig(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer la configuración de LDAP")
		return
	}
	if req.TimeoutSeconds == 0 {
		req.TimeoutSeconds = 8
	}
	if req.TimeoutSeconds < 2 || req.TimeoutSeconds > 60 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el tiempo de espera va de 2 a 60 segundos")
		return
	}
	trim := strings.TrimSpace
	cfg := ldapauth.Config{URL: trim(req.URL), StartTLS: req.StartTLS, VerifyTLS: req.VerifyTLS, CAPEM: trim(req.CAPEM),
		BindDN: trim(req.BindDN), BaseDN: trim(req.BaseDN), UserFilter: trim(req.UserFilter), UsernameAttr: trim(req.UsernameAttr),
		NameAttr: trim(req.NameAttr), EmailAttr: trim(req.EmailAttr), GroupDN: trim(req.GroupDN)}
	if strings.HasPrefix(strings.ToLower(cfg.URL), "ldaps://") {
		cfg.StartTLS = false
	}
	if err := ldapauth.Validate(cfg); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-ldap-config", err.Error())
		return
	}
	pass, passChanged := cur.BindPasswordEncrypted, false
	if req.BindPassword != nil && *req.BindPassword != "" {
		enc, err := h.Crypto.Encrypt(*req.BindPassword)
		if err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cifrar la contraseña de la cuenta de servicio")
			return
		}
		pass, passChanged = pgtype.Text{String: enc, Valid: true}, true
	}
	if err := h.Queries.UpdateLdapConfig(ctx, db.UpdateLdapConfigParams{Url: cfg.URL, StartTls: cfg.StartTLS, VerifyTls: cfg.VerifyTLS,
		CaPem: cfg.CAPEM, BindDn: cfg.BindDN, BindPasswordEncrypted: pass, BaseDn: cfg.BaseDN, UserFilter: cfg.UserFilter,
		UsernameAttr: cfg.UsernameAttr, NameAttr: cfg.NameAttr, EmailAttr: cfg.EmailAttr, GroupDn: cfg.GroupDN,
		TimeoutSeconds: req.TimeoutSeconds}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la configuración de LDAP")
		return
	}
	h.AuditLog.Log(ctx, "config.ldap.update", audit.LevelWarn, audit.Success(), map[string]any{
		"url": cfg.URL, "startTls": cfg.StartTLS, "verifyTls": cfg.VerifyTLS, "baseDn": cfg.BaseDN, "groupDn": cfg.GroupDN,
		"bindDn": cfg.BindDN, "bindPasswordChanged": passChanged,
	})
	h.GetConfig(w, r)
}

type ldapTestRequest struct {
	Username string `json:"username"`
}

// Test es POST /api/ldap/test: conecta y entra con la cuenta de servicio; con
// un usuario, además muestra a quién encontraría. No valida contraseñas de
// personas ni crea nada.
func (h *LdapHandler) Test(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req ldapTestRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	res := ldapTestDTO{At: time.Now(), Username: strings.TrimSpace(req.Username)}
	dir, err := ldapDirectory(ctx, h.Queries, h.Crypto, h.Dial)
	if err == nil {
		if res.Username == "" {
			err = dir.Check()
		} else {
			var e ldapauth.Entry
			if e, err = dir.Lookup(res.Username); err == nil {
				res.Entry = &e
			}
		}
	}
	res.OK = err == nil
	if err != nil {
		res.Error = err.Error()
	}
	raw, _ := json.Marshal(res)
	_ = h.Queries.RecordLdapTest(ctx, db.RecordLdapTestParams{Ok: pgtype.Bool{Bool: res.OK, Valid: true}, Result: raw})
	outcome := audit.Success()
	if !res.OK {
		outcome = audit.Failure(res.Error)
	}
	h.AuditLog.Log(ctx, "config.ldap.test", audit.LevelInfo, outcome, map[string]any{"username": res.Username})
	writeData(w, http.StatusOK, res)
}
