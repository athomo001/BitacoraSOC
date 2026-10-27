package ldapauth

import (
	"errors"
	"strings"
	"testing"

	"github.com/go-ldap/ldap/v3"
)

// fakeConn es un directorio en memoria: una cuenta de servicio y personas
// con su contraseña.
type fakeConn struct {
	service, servicePass string
	people               map[string]string // DN → contraseña
	entries              []*ldap.Entry
	searchErr            error
	lastFilter           string
	binds                []string
}

func (f *fakeConn) Bind(dn, password string) error {
	f.binds = append(f.binds, dn)
	if dn == f.service && password == f.servicePass {
		return nil
	}
	if p, ok := f.people[dn]; ok && p == password {
		return nil
	}
	return ldap.NewError(ldap.LDAPResultInvalidCredentials, errors.New("invalid credentials"))
}

func (f *fakeConn) Search(req *ldap.SearchRequest) (*ldap.SearchResult, error) {
	f.lastFilter = req.Filter
	if f.searchErr != nil {
		return nil, f.searchErr
	}
	return &ldap.SearchResult{Entries: f.entries}, nil
}

func (f *fakeConn) Close() error { return nil }

func person(dn, user, name, mail string) *ldap.Entry {
	return ldap.NewEntry(dn, map[string][]string{"sAMAccountName": {user}, "displayName": {name}, "mail": {mail}})
}

func adConfig() Config {
	return Config{URL: "ldaps://dc01.empresa.local:636", VerifyTLS: true, BindDN: "CN=svc-bitacora,OU=Servicio,DC=empresa,DC=local",
		BindPassword: "secreto", BaseDN: "DC=empresa,DC=local", UserFilter: "(sAMAccountName={usuario})",
		UsernameAttr: "sAMAccountName", NameAttr: "displayName", EmailAttr: "mail"}
}

const anaDN = "CN=Ana Pérez,OU=SOC,DC=empresa,DC=local"

func directory(f *fakeConn) Directory {
	return Directory{Config: adConfig(), Dial: func(Config) (Conn, error) { return f, nil }}
}

func newFake() *fakeConn {
	return &fakeConn{service: adConfig().BindDN, servicePass: "secreto", people: map[string]string{anaDN: "Clave-del-dominio1"},
		entries: []*ldap.Entry{person(anaDN, "aperez", "Ana Pérez", "Ana.Perez@Empresa.cl")}}
}

func TestAuthenticateOK(t *testing.T) {
	f := newFake()
	e, err := directory(f).Authenticate("aperez", "Clave-del-dominio1")
	if err != nil {
		t.Fatal(err)
	}
	if e.DN != anaDN || e.Username != "aperez" || e.Name != "Ana Pérez" || e.Email != "ana.perez@empresa.cl" {
		t.Fatalf("entrada: %+v", e)
	}
	if len(f.binds) != 2 || f.binds[1] != anaDN {
		t.Fatalf("binds: %v (cuenta de servicio y después la persona)", f.binds)
	}
}

func TestAuthenticateRejects(t *testing.T) {
	cases := []struct {
		name     string
		password string
		setup    func(*fakeConn)
		want     error
	}{
		{"contraseña incorrecta", "otra", nil, ErrInvalidCredentials},
		{"no está", "Clave-del-dominio1", func(f *fakeConn) { f.entries = nil }, ErrNotFound},
		{"dos personas", "Clave-del-dominio1", func(f *fakeConn) {
			f.entries = append(f.entries, person("CN=Otra,DC=empresa,DC=local", "aperez", "Otra", "otra@empresa.cl"))
		}, ErrAmbiguous},
		{"límite de tamaño", "Clave-del-dominio1", func(f *fakeConn) {
			f.searchErr = ldap.NewError(ldap.LDAPResultSizeLimitExceeded, errors.New("size limit"))
		}, ErrAmbiguous},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFake()
			if c.setup != nil {
				c.setup(f)
			}
			if _, err := directory(f).Authenticate("aperez", c.password); !errors.Is(err, c.want) {
				t.Fatalf("err = %v, quería %v", err, c.want)
			}
		})
	}
}

// Un bind sin contraseña es «anónimo» en muchos servidores y devuelve éxito:
// ni se llega a conectar.
func TestEmptyPasswordNeverReachesDirectory(t *testing.T) {
	dialed := false
	d := Directory{Config: adConfig(), Dial: func(Config) (Conn, error) { dialed = true; return newFake(), nil }}
	if _, err := d.Authenticate("aperez", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v", err)
	}
	if dialed {
		t.Fatal("con contraseña vacía no debe conectarse al directorio")
	}
}

func TestUnavailable(t *testing.T) {
	var ue *UnavailableError
	f := newFake()
	f.servicePass = "cambiada"
	if _, err := directory(f).Authenticate("aperez", "Clave-del-dominio1"); !errors.As(err, &ue) {
		t.Fatalf("cuenta de servicio rechazada: err = %v", err)
	}
	down := Directory{Config: adConfig(), Dial: func(Config) (Conn, error) { return nil, errors.New("connection refused") }}
	if _, err := down.Authenticate("aperez", "x"); !errors.As(err, &ue) {
		t.Fatalf("directorio caído: err = %v", err)
	}
	f = newFake()
	f.searchErr = ldap.NewError(ldap.ErrorNetwork, errors.New("reset"))
	if _, err := directory(f).Lookup("aperez"); !errors.As(err, &ue) {
		t.Fatalf("búsqueda caída: err = %v", err)
	}
}

func TestFilterEscapesAndRestrictsToGroup(t *testing.T) {
	f := newFake()
	_, _ = directory(f).Lookup("*)(sAMAccountName=*")
	if strings.Contains(f.lastFilter, "(sAMAccountName=*)") || !strings.Contains(f.lastFilter, `\2a\29\28sAMAccountName=\2a`) {
		t.Fatalf("lo tipeado no quedó escapado: %s", f.lastFilter)
	}
	c := adConfig()
	c.GroupDN = "CN=Bitacora,OU=Grupos,DC=empresa,DC=local"
	got := Filter(c, "ana@empresa.cl")
	want := "(&(|(sAMAccountName=ana@empresa.cl)(mail=ana@empresa.cl))(memberOf=CN=Bitacora,OU=Grupos,DC=empresa,DC=local))"
	if got != want {
		t.Fatalf("filtro:\n got %s\nwant %s", got, want)
	}
	if _, err := ldap.CompileFilter(got); err != nil {
		t.Fatalf("el filtro no compila: %v", err)
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(adConfig()); err != nil {
		t.Fatalf("configuración de AD válida: %v", err)
	}
	bad := map[string]func(*Config){
		"sin TLS":            func(c *Config) { c.URL = "ldap://dc01.empresa.local" },
		"otro esquema":       func(c *Config) { c.URL = "https://dc01" },
		"sin servidor":       func(c *Config) { c.URL = "ldaps://" },
		"sin base":           func(c *Config) { c.BaseDN = "" },
		"sin cuenta":         func(c *Config) { c.BindDN = "" },
		"filtro sin usuario": func(c *Config) { c.UserFilter = "(sAMAccountName=ana)" },
		"filtro roto":        func(c *Config) { c.UserFilter = "(sAMAccountName={usuario}" },
		"atributo raro":      func(c *Config) { c.EmailAttr = "mail)(x" },
		"grupo no es DN":     func(c *Config) { c.GroupDN = "Bitacora" },
		"CA no es PEM":       func(c *Config) { c.CAPEM = "hola" },
	}
	for name, mutate := range bad {
		c := adConfig()
		mutate(&c)
		if Validate(c) == nil {
			t.Errorf("%s: debió rechazarse", name)
		}
	}
	c := adConfig()
	c.URL, c.StartTLS = "ldap://dc01.empresa.local:389", true
	if err := Validate(c); err != nil {
		t.Fatalf("ldap:// con StartTLS es válido: %v", err)
	}
}
