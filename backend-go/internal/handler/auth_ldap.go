package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ldapauth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Ingreso con la cuenta del dominio (spec/20, decisiones del dueño
// 2026-10-26). Reglas:
//   - El directorio solo dice si la contraseña es la de esa persona. Rol,
//     áreas, nivel y grupos nunca se leen ni se escriben desde acá.
//   - Una cuenta que el admin creó antes se reconoce sola (por el DN ya
//     vinculado, por lo que se tipeó, por el usuario o por el correo del
//     directorio) y desde ahí vale la contraseña del dominio, no la local.
//   - Quien entra por primera vez sin cuenta la recibe: rol user, sin áreas,
//     nombre y correo del directorio; a los admins les llega un aviso.
//   - Una cuenta «solo local» nunca se vincula (el admin de emergencia).
//   - Si el directorio no responde, una cuenta que todavía no se vinculó
//     entra con su contraseña local; una ya vinculada, no.

const (
	authSourceAuto  = "auto"
	authSourceLDAP  = "ldap"
	authSourceLocal = "local"
)

// loginFailure: el ingreso se corta con este problema. count: suma un
// intento fallido a la cuenta (y la bloquea al quinto).
type loginFailure struct {
	status       int
	code, detail string
	reason       string
	count        bool
}

func credentialsFailure(reason string, count bool) *loginFailure {
	return &loginFailure{http.StatusUnauthorized, "invalid-credentials", "credenciales inválidas", reason, count}
}

var directoryDown = &loginFailure{http.StatusServiceUnavailable, "directory-unavailable",
	"no se pudo consultar el directorio del dominio; prueba de nuevo en un momento o avisa a un administrador", "directorio no disponible", false}

// directoryLogin decide el ingreso de quien no es «solo local» con LDAP
// encendido. ok=false y fail=nil: no está en el directorio (o no responde y
// la cuenta no está vinculada), sigue con la contraseña local.
func (h *AuthHandler) directoryLogin(ctx context.Context, login, password string, found bool, user db.User) (db.User, bool, *loginFailure) {
	linked := found && user.AuthSource == authSourceLDAP
	dir, err := ldapDirectory(ctx, h.Queries, h.Crypto, h.LdapDial)
	if err != nil {
		if linked {
			return db.User{}, false, directoryDown
		}
		return db.User{}, false, nil
	}
	entry, err := dir.Authenticate(login, password)
	var down *ldapauth.UnavailableError
	switch {
	case err == nil:
	case errors.Is(err, ldapauth.ErrNotFound):
		if linked {
			return db.User{}, false, credentialsFailure("ya no está en el directorio o salió del grupo permitido", true)
		}
		return db.User{}, false, nil
	case errors.Is(err, ldapauth.ErrInvalidCredentials):
		return db.User{}, false, credentialsFailure("contraseña del dominio incorrecta", found)
	case errors.Is(err, ldapauth.ErrAmbiguous):
		return db.User{}, false, credentialsFailure("el filtro de LDAP encuentra a más de una persona", false)
	case errors.As(err, &down):
		h.AuditLog.Log(ctx, "auth.ldap.unavailable", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"username": login})
		if found && !linked {
			return db.User{}, false, nil
		}
		return db.User{}, false, directoryDown
	default:
		return db.User{}, false, directoryDown
	}

	target, ok := h.matchDirectoryAccount(ctx, entry, found, user)
	if !ok {
		return h.createDirectoryAccount(ctx, entry, login)
	}
	if target.AuthSource == authSourceLocal {
		return db.User{}, false, credentialsFailure("la cuenta que coincide con el directorio es solo local", false)
	}
	if target.LdapDn.Valid && !strings.EqualFold(target.LdapDn.String, entry.DN) {
		return db.User{}, false, credentialsFailure("la cuenta está vinculada a otra persona del directorio", false)
	}
	if target.AuthSource != authSourceLDAP {
		linkedUser, err := h.Queries.LinkUserToLdap(ctx, db.LinkUserToLdapParams{ID: target.ID, Dn: pgtype.Text{String: entry.DN, Valid: true}})
		if err != nil {
			return db.User{}, false, &loginFailure{http.StatusInternalServerError, "internal-error", "no se pudo vincular la cuenta con el dominio", "error al vincular", false}
		}
		h.AuditLog.Log(ctx, "auth.ldap.link", audit.LevelInfo, audit.Success(), map[string]any{"username": linkedUser.Username, "dn": entry.DN})
		target = linkedUser
	}
	return target, true, nil
}

// matchDirectoryAccount busca la cuenta de la Bitácora de esa persona: la
// ya vinculada a su DN, la que coincide con lo tipeado, y si no, la que
// tiene su usuario o su correo del directorio.
func (h *AuthHandler) matchDirectoryAccount(ctx context.Context, e ldapauth.Entry, found bool, user db.User) (db.User, bool) {
	if u, err := h.Queries.GetUserByLdapDN(ctx, e.DN); err == nil {
		return u, true
	}
	if found {
		return user, true
	}
	for _, key := range []string{e.Username, e.Email} {
		if key == "" {
			continue
		}
		if u, err := h.Queries.GetUserForLogin(ctx, key); err == nil {
			return u, true
		}
	}
	return db.User{}, false
}

// createDirectoryAccount crea la cuenta de quien entra por primera vez:
// rol user, sin áreas, con nombre y correo del directorio (solo esta vez).
func (h *AuthHandler) createDirectoryAccount(ctx context.Context, e ldapauth.Entry, login string) (db.User, bool, *loginFailure) {
	if e.Email == "" {
		return db.User{}, false, &loginFailure{http.StatusUnauthorized, "directory-no-email",
			"tu cuenta del dominio no tiene correo; pide a un administrador que te cree la cuenta en la Bitácora", "sin correo en el directorio", false}
	}
	username := e.Username
	if username == "" {
		username = login
	}
	// Nadie conoce esta contraseña: la cuenta entra con la del dominio.
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return db.User{}, false, &loginFailure{http.StatusInternalServerError, "internal-error", "no se pudo crear la cuenta", "error al crear", false}
	}
	hash, err := auth.HashPassword(hex.EncodeToString(raw))
	if err != nil {
		return db.User{}, false, &loginFailure{http.StatusInternalServerError, "internal-error", "no se pudo crear la cuenta", "error al crear", false}
	}
	u, err := h.Queries.CreateLdapUser(ctx, db.CreateLdapUserParams{Username: username, Email: e.Email,
		FullName: pgtype.Text{String: e.Name, Valid: e.Name != ""}, PasswordHash: hash, Dn: pgtype.Text{String: e.DN, Valid: true}})
	if err != nil {
		return db.User{}, false, &loginFailure{http.StatusConflict, "duplicate-user",
			"ya existe una cuenta con ese usuario o correo; pide a un administrador que la revise", "usuario o correo ya usado por otra cuenta", false}
	}
	h.AuditLog.Log(ctx, "users.create", audit.LevelInfo, audit.Success(), map[string]any{"username": u.Username, "role": string(u.Role), "source": authSourceLDAP})
	if admins, err := h.Queries.ListAdminUserIDs(ctx); err == nil {
		name := e.Name
		if name == "" {
			name = u.Username
		}
		h.Notify.Send(ctx, admins, NotifMsg{Kind: NotifLdapUser, Title: "Cuenta nueva del dominio sin áreas: " + name,
			Body: "Entró por primera vez con su cuenta del dominio. Asígnale áreas en Usuarios y grupos.", Link: "/admin?section=access"})
	}
	return u, true, nil
}

// domainManaged: la contraseña de esta cuenta es la del dominio. Con LDAP
// apagado, una cuenta vinculada vuelve a usar (y recuperar) la local.
func domainManaged(ctx context.Context, q *db.Queries, u db.User) bool {
	return u.AuthSource == authSourceLDAP && featureEnabled(ctx, q, ldapFeature)
}

// passwordMatches valida la contraseña de alguien con sesión: la del dominio
// si su cuenta está vinculada, si no la local.
func (h *AuthHandler) passwordMatches(ctx context.Context, u db.User, password string) bool {
	if !domainManaged(ctx, h.Queries, u) {
		return auth.CheckPassword(u.PasswordHash, password) == nil
	}
	dir, err := ldapDirectory(ctx, h.Queries, h.Crypto, h.LdapDial)
	return err == nil && dir.VerifyDN(u.LdapDn.String, password) == nil
}
