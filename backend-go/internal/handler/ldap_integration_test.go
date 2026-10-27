//go:build integration

// Entrar con la cuenta del dominio (spec/20, pendiente 10k) contra la base
// real y un directorio falso, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestLdap
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ldapauth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/go-ldap/ldap/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fakeDirectory es un AD en memoria: la cuenta de servicio y personas con
// su contraseña del dominio. down simula el directorio caído.
type fakeDirectory struct {
	people map[string]fakePerson // DN → persona
	down   bool
	binds  int
}

type fakePerson struct{ user, name, mail, password string }

func (f *fakeDirectory) dial(ldapauth.Config) (ldapauth.Conn, error) {
	if f.down {
		return nil, errors.New("connection refused")
	}
	return f, nil
}

func (f *fakeDirectory) Bind(dn, password string) error {
	f.binds++
	if dn == "CN=svc,DC=empresa,DC=local" && password == "clave-servicio" {
		return nil
	}
	if p, ok := f.people[dn]; ok && p.password == password {
		return nil
	}
	return ldap.NewError(ldap.LDAPResultInvalidCredentials, errors.New("invalid credentials"))
}

func (f *fakeDirectory) Search(req *ldap.SearchRequest) (*ldap.SearchResult, error) {
	res := &ldap.SearchResult{}
	for dn, p := range f.people {
		for _, v := range []string{p.user, p.mail} {
			if strings.Contains(req.Filter, "="+ldap.EscapeFilter(v)+")") {
				res.Entries = append(res.Entries, ldap.NewEntry(dn, map[string][]string{"sAMAccountName": {p.user}, "displayName": {p.name}, "mail": {p.mail}}))
				break
			}
		}
	}
	return res, nil
}

func (f *fakeDirectory) Close() error { return nil }

func TestLdap_ElDirectorioValidaYLasAreasNoSeTocan(t *testing.T) {
	dsn := os.Getenv("BITACORA_TEST_DSN")
	if dsn == "" {
		t.Skip("BITACORA_TEST_DSN no definido")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // la transacción se deshace siempre
	q := db.New(tx)
	n := fmt.Sprintf("%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	count := func(sql string, args ...any) int {
		t.Helper()
		var c int
		if err := tx.QueryRow(ctx, sql, args...).Scan(&c); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return c
	}
	text := func(sql string, args ...any) string {
		t.Helper()
		var s string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&s); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return s
	}
	local := func(user, email, pass, source, role string) uuid.UUID {
		t.Helper()
		hash, err := auth.HashPassword(pass)
		if err != nil {
			t.Fatal(err)
		}
		return id(`INSERT INTO users (username, email, password_hash, role, auth_source) VALUES ($1, $2, $3, $4, $5) RETURNING id`, user, email, hash, role, source)
	}

	// La persona que el admin ya creó, con su área (un grupo de permisos).
	admin := local("adm"+n, "adm"+n+"@test.local", "Local-del-admin1", "local", "admin")
	ana := local("aperez"+n, "aperez"+n+"@test.local", "Local-de-ana-123", "auto", "user")
	grupo := id(`INSERT INTO permission_groups (code, name) VALUES ($1, 'SOC N1 '||$1) RETURNING id`, "g"+n)
	exec(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2)`, ana, grupo)
	// Diana existe con otro usuario; el directorio la reconoce por el correo.
	diana := local("diana"+n, "diana"+n+"@test.local", "Local-de-diana-1", "auto", "user")
	// Carla no está en el directorio: sigue con su contraseña local.
	local("cmora"+n, "cmora"+n+"@test.local", "Local-de-carla-1", "auto", "user")
	exec(`UPDATE system_features SET is_enabled = true WHERE code = 'ldap'`)

	dir := &fakeDirectory{people: map[string]fakePerson{
		"CN=Ana,DC=empresa,DC=local":   {"aperez" + n, "Ana Pérez", "aperez" + n + "@test.local", "Dominio-de-ana-1"},
		"CN=Benja,DC=empresa,DC=local": {"bsoto" + n, "Benjamín Soto", "Bsoto" + n + "@Test.local", "Dominio-de-benja"},
		"CN=Diana,DC=empresa,DC=local": {"dlopez" + n, "Diana López", "diana" + n + "@test.local", "Dominio-de-diana"},
		// Alguien del dominio con el mismo usuario que el admin «solo local».
		"CN=Otro,DC=empresa,DC=local": {"adm" + n, "Otro Admin", "otro" + n + "@test.local", "Dominio-del-otro"},
	}}

	box, err := crypto.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	auditLog := audit.NewLogger(&recordedAudit{}, slog.Default())
	cfgH := &LdapHandler{Queries: q, Crypto: box, AuditLog: auditLog, Dial: dir.dial}
	h := &AuthHandler{Queries: q, JWT: auth.NewJWTIssuer(bytes.Repeat([]byte{9}, 32)), Crypto: box, AuditLog: auditLog,
		Notify: &Notifier{Queries: q, AuditLog: auditLog}, LdapDial: dir.dial}
	asAdmin := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: admin, Username: "adm" + n, Role: "admin"})
	call := func(c context.Context, fn http.HandlerFunc, method string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		w := httptest.NewRecorder()
		fn(w, httptest.NewRequest(method, "/", &buf).WithContext(c))
		return w
	}
	login := func(user, pass string) int {
		t.Helper()
		return call(ctx, h.Login, http.MethodPost, map[string]string{"username": user, "password": pass}).Code
	}

	// Sin TLS no se guarda; con ldaps:// sí, y «Probar» encuentra a Ana.
	cfg := map[string]any{"url": "ldap://dc01.empresa.local", "bindDn": "CN=svc,DC=empresa,DC=local", "bindPassword": "clave-servicio",
		"baseDn": "DC=empresa,DC=local", "userFilter": "(sAMAccountName={usuario})", "usernameAttr": "sAMAccountName",
		"nameAttr": "displayName", "emailAttr": "mail", "verifyTls": true}
	if w := call(asAdmin, cfgH.PutConfig, http.MethodPut, cfg); w.Code != http.StatusBadRequest {
		t.Fatalf("ldap:// sin StartTLS: %d %s", w.Code, w.Body)
	}
	cfg["url"] = "ldaps://dc01.empresa.local:636"
	if w := call(asAdmin, cfgH.PutConfig, http.MethodPut, cfg); w.Code != http.StatusOK || strings.Contains(w.Body.String(), "clave-servicio") {
		t.Fatalf("guardar: %d %s", w.Code, w.Body)
	}
	if w := call(asAdmin, cfgH.Test, http.MethodPost, map[string]string{"username": "aperez" + n}); !strings.Contains(w.Body.String(), `"ok":true`) ||
		!strings.Contains(w.Body.String(), "CN=Ana,DC=empresa,DC=local") {
		t.Fatalf("probar: %s", w.Body)
	}

	// Ana: la contraseña local ya no sirve; la del dominio sí, y su cuenta
	// (con su grupo) queda vinculada sin perder nada.
	if c := login("aperez"+n, "Local-de-ana-123"); c != http.StatusUnauthorized {
		t.Fatalf("con la contraseña local: %d, quería 401 (vale la del dominio)", c)
	}
	if c := login("aperez"+n, "Dominio-de-ana-1"); c != http.StatusOK {
		t.Fatalf("con la del dominio: %d", c)
	}
	if s := text(`SELECT auth_source || ' ' || ldap_dn FROM users WHERE id = $1`, ana); s != "ldap CN=Ana,DC=empresa,DC=local" {
		t.Fatalf("vínculo: %q", s)
	}
	if c := count(`SELECT count(*) FROM user_permission_groups WHERE user_id = $1`, ana); c != 1 {
		t.Fatalf("Ana perdió su grupo: %d", c)
	}
	if c := login("aperez"+n+"@test.local", "Dominio-de-ana-1"); c != http.StatusOK {
		t.Fatalf("con el correo: %d", c)
	}
	// Su contraseña se cambia en el dominio.
	asAna := middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: ana, Username: "aperez" + n, Role: "user"})
	if w := call(asAna, h.ChangeMyPassword, http.MethodPut, map[string]string{"currentPassword": "x", "newPassword": "Nueva-clave-12345"}); w.Code != http.StatusConflict {
		t.Fatalf("cambiar contraseña de una cuenta del dominio: %d", w.Code)
	}

	// Benjamín no tenía cuenta: se crea sin áreas y los admins reciben aviso.
	if c := login("bsoto"+n, "Dominio-de-benja"); c != http.StatusOK {
		t.Fatalf("primera vez: %d", c)
	}
	if s := text(`SELECT role || ' ' || auth_source || ' ' || email || ' ' || full_name FROM users WHERE username = $1`, "bsoto"+n); s != "user ldap bsoto"+n+"@test.local Benjamín Soto" {
		t.Fatalf("cuenta nueva: %q", s)
	}
	if c := count(`SELECT count(*) FROM user_permission_groups g JOIN users u ON u.id = g.user_id WHERE u.username = $1`, "bsoto"+n); c != 0 {
		t.Fatalf("la cuenta nueva no debe traer áreas: %d", c)
	}
	if c := count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND kind = 'ldap.user'`, admin); c != 1 {
		t.Fatalf("aviso al admin: %d", c)
	}

	// Diana entra con su usuario del dominio y se reconoce por el correo.
	if c := login("dlopez"+n, "Dominio-de-diana"); c != http.StatusOK {
		t.Fatalf("Diana: %d", c)
	}
	if s := text(`SELECT auth_source FROM users WHERE id = $1`, diana); s != "ldap" {
		t.Fatalf("Diana no quedó vinculada: %q", s)
	}
	if c := count(`SELECT count(*) FROM users WHERE username = $1`, "dlopez"+n); c != 0 {
		t.Fatal("no debía crearse una cuenta aparte para Diana")
	}

	// El admin «solo local» no se toca: el directorio ni se consulta.
	before := dir.binds
	if c := login("adm"+n, "Dominio-del-otro"); c != http.StatusUnauthorized {
		t.Fatalf("el del dominio con el usuario del admin local: %d", c)
	}
	if c := login("adm"+n, "Local-del-admin1"); c != http.StatusOK {
		t.Fatalf("admin local: %d", c)
	}
	if dir.binds != before {
		t.Fatal("una cuenta solo local no debe pasar por el directorio")
	}

	// Carla no está en el directorio: entra con la suya.
	if c := login("cmora"+n, "Local-de-carla-1"); c != http.StatusOK {
		t.Fatalf("Carla: %d", c)
	}

	// Directorio caído: la cuenta vinculada no entra; la no vinculada, con la local.
	dir.down = true
	if c := login("aperez"+n, "Dominio-de-ana-1"); c != http.StatusServiceUnavailable {
		t.Fatalf("vinculada con el directorio caído: %d", c)
	}
	if c := login("cmora"+n, "Local-de-carla-1"); c != http.StatusOK {
		t.Fatalf("no vinculada con el directorio caído: %d", c)
	}

	// Pasar a Ana a «solo local» desde la ficha la desvincula.
	u := &UsersHandler{Queries: q, AuditLog: auditLog}
	r := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"authSource":"local"}`)).WithContext(asAdmin)
	r.SetPathValue("id", ana.String())
	w := httptest.NewRecorder()
	u.Patch(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"authSource":"local"`) {
		t.Fatalf("pasar a local: %d %s", w.Code, w.Body)
	}
	if c := count(`SELECT count(*) FROM users WHERE id = $1 AND ldap_dn IS NULL`, ana); c != 1 {
		t.Fatal("al pasar a local se borra el vínculo")
	}
}
