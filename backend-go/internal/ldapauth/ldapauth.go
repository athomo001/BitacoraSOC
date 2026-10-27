// Package ldapauth valida contraseñas contra un LDAP / Active Directory
// (pendiente 10k, spec/20). Solo autentica y lee nombre y correo: rol,
// áreas, nivel y grupos son de la Bitácora y de acá nunca salen. Sin DB ni
// HTTP; la conexión se reemplaza en las pruebas (Directory.Dial).
package ldapauth

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
)

// Placeholder es lo que el filtro de usuario reemplaza por lo que se tipeó.
const Placeholder = "{usuario}"

// maxLogin: más largo que esto no es un usuario ni un correo.
const maxLogin = 256

// Config es la conexión guardada en ldap_config, con la contraseña de la
// cuenta de servicio ya descifrada.
type Config struct {
	URL          string
	StartTLS     bool
	VerifyTLS    bool
	CAPEM        string
	BindDN       string
	BindPassword string
	BaseDN       string
	UserFilter   string
	UsernameAttr string
	NameAttr     string
	EmailAttr    string
	GroupDN      string
	Timeout      time.Duration
}

// Entry es la persona que encontró el directorio.
type Entry struct {
	DN       string `json:"dn"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Email    string `json:"email"`
}

var (
	// ErrNotFound: nadie con ese usuario o correo (o no está en el grupo permitido).
	ErrNotFound = errors.New("la persona no está en el directorio o no está en el grupo permitido")
	// ErrAmbiguous: el filtro encuentra a más de una persona.
	ErrAmbiguous = errors.New("el filtro de usuario encuentra a más de una persona")
	// ErrInvalidCredentials: el directorio rechazó la contraseña.
	ErrInvalidCredentials = errors.New("el directorio rechazó la contraseña")
)

// UnavailableError: no se pudo consultar el directorio (red, TLS o la
// cuenta de servicio). No dice nada de la contraseña de la persona.
type UnavailableError struct{ Err error }

func (e *UnavailableError) Error() string {
	return "no se pudo consultar el directorio: " + e.Err.Error()
}
func (e *UnavailableError) Unwrap() error { return e.Err }

func unavailable(err error) error { return &UnavailableError{Err: err} }

// Conn es lo que se usa de una conexión (*ldap.Conn lo cumple).
type Conn interface {
	Bind(username, password string) error
	Search(*ldap.SearchRequest) (*ldap.SearchResult, error)
	Close() error
}

// Directory consulta el directorio configurado.
type Directory struct {
	Config Config
	// Dial abre la conexión (nil = la real, con TLS). En las pruebas, una falsa.
	Dial func(Config) (Conn, error)
}

var attrName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)

// Validate revisa la configuración antes de guardarla: siempre con TLS
// (ldaps:// o StartTLS), filtro con {usuario} y atributos válidos.
func Validate(c Config) error {
	u, err := url.Parse(strings.TrimSpace(c.URL))
	if err != nil || u.Hostname() == "" {
		return errors.New("la dirección del servidor no es válida (por ejemplo ldaps://dc01.empresa.local:636)")
	}
	switch strings.ToLower(u.Scheme) {
	case "ldaps":
	case "ldap":
		if !c.StartTLS {
			return errors.New("con ldap:// hay que activar StartTLS: sin TLS las contraseñas viajan a la vista")
		}
	default:
		return errors.New("la dirección empieza con ldaps:// o ldap://")
	}
	if strings.TrimSpace(c.BaseDN) == "" {
		return errors.New("falta la base de búsqueda (Base DN)")
	}
	if _, err := ldap.ParseDN(c.BaseDN); err != nil {
		return errors.New("la base de búsqueda no es un DN válido")
	}
	if strings.TrimSpace(c.BindDN) == "" {
		return errors.New("falta la cuenta de servicio (DN o usuario@dominio)")
	}
	if !strings.Contains(c.UserFilter, Placeholder) {
		return errors.New("el filtro de usuario debe incluir " + Placeholder)
	}
	if _, err := ldap.CompileFilter(strings.ReplaceAll(c.UserFilter, Placeholder, "x")); err != nil {
		return errors.New("el filtro de usuario no es un filtro LDAP válido")
	}
	for _, a := range []string{c.UsernameAttr, c.NameAttr, c.EmailAttr} {
		if !attrName.MatchString(a) {
			return errors.New("los atributos de usuario, nombre y correo son nombres LDAP (por ejemplo sAMAccountName, displayName, mail)")
		}
	}
	if strings.TrimSpace(c.GroupDN) != "" {
		if _, err := ldap.ParseDN(c.GroupDN); err != nil {
			return errors.New("el grupo permitido no es un DN válido")
		}
	}
	if strings.TrimSpace(c.CAPEM) != "" && !x509.NewCertPool().AppendCertsFromPEM([]byte(c.CAPEM)) {
		return errors.New("la CA no es un certificado PEM válido")
	}
	return nil
}

// Filter arma la búsqueda de lo que se tipeó: por el filtro de usuario o
// por correo, y solo dentro del grupo permitido si hay uno. Lo tipeado va
// escapado (RFC 4515): «*)(cn=*» no amplía la búsqueda.
func Filter(c Config, login string) string {
	v := ldap.EscapeFilter(login)
	f := "(|" + strings.ReplaceAll(c.UserFilter, Placeholder, v) + "(" + c.EmailAttr + "=" + v + "))"
	if g := strings.TrimSpace(c.GroupDN); g != "" {
		f = "(&" + f + "(memberOf=" + ldap.EscapeFilter(g) + "))"
	}
	return f
}

// Check abre la conexión y entra con la cuenta de servicio («Probar»).
func (d Directory) Check() error {
	conn, err := d.open()
	if err != nil {
		return err
	}
	defer conn.Close()
	return d.serviceBind(conn)
}

// Lookup busca a una persona sin validar su contraseña («Probar» con un usuario).
func (d Directory) Lookup(login string) (Entry, error) {
	conn, err := d.open()
	if err != nil {
		return Entry{}, err
	}
	defer conn.Close()
	return d.find(conn, login)
}

// Authenticate busca a la persona y valida su contraseña con un bind con su DN.
func (d Directory) Authenticate(login, password string) (Entry, error) {
	// Muchos servidores toman un bind sin contraseña como anónimo y lo dan
	// por bueno: se corta antes de llegar al directorio.
	if password == "" {
		return Entry{}, ErrInvalidCredentials
	}
	conn, err := d.open()
	if err != nil {
		return Entry{}, err
	}
	defer conn.Close()
	e, err := d.find(conn, login)
	if err != nil {
		return Entry{}, err
	}
	if err := bindPerson(conn, e.DN, password); err != nil {
		return Entry{}, err
	}
	return e, nil
}

// VerifyDN valida la contraseña de alguien ya vinculado, directo con su DN
// (por ejemplo, para desactivar su verificación en dos pasos).
func (d Directory) VerifyDN(dn, password string) error {
	if password == "" {
		return ErrInvalidCredentials
	}
	conn, err := d.open()
	if err != nil {
		return err
	}
	defer conn.Close()
	return bindPerson(conn, dn, password)
}

// bindPerson: el bind con el DN de la persona. Un rechazo del servidor es
// contraseña incorrecta (o cuenta deshabilitada); un corte de red, no.
func bindPerson(conn Conn, dn, password string) error {
	if err := conn.Bind(dn, password); err != nil {
		var le *ldap.Error
		if errors.As(err, &le) && le.ResultCode != ldap.ErrorNetwork {
			return ErrInvalidCredentials
		}
		return unavailable(err)
	}
	return nil
}

func (d Directory) open() (Conn, error) {
	dial := d.Dial
	if dial == nil {
		dial = dialTLS
	}
	conn, err := dial(d.Config)
	if err != nil {
		return nil, unavailable(err)
	}
	return conn, nil
}

func (d Directory) serviceBind(conn Conn) error {
	if d.Config.BindPassword == "" {
		return unavailable(errors.New("falta la contraseña de la cuenta de servicio"))
	}
	if err := conn.Bind(d.Config.BindDN, d.Config.BindPassword); err != nil {
		return unavailable(errors.New("el directorio rechazó la cuenta de servicio: " + err.Error()))
	}
	return nil
}

func (d Directory) find(conn Conn, login string) (Entry, error) {
	login = strings.TrimSpace(login)
	if login == "" || len(login) > maxLogin {
		return Entry{}, ErrNotFound
	}
	if err := d.serviceBind(conn); err != nil {
		return Entry{}, err
	}
	c := d.Config
	req := ldap.NewSearchRequest(c.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, int(c.Timeout.Seconds()), false,
		Filter(c, login), []string{c.UsernameAttr, c.NameAttr, c.EmailAttr}, nil)
	res, err := conn.Search(req)
	if err != nil {
		if ldap.IsErrorWithCode(err, ldap.LDAPResultSizeLimitExceeded) {
			return Entry{}, ErrAmbiguous
		}
		if ldap.IsErrorWithCode(err, ldap.LDAPResultNoSuchObject) {
			return Entry{}, unavailable(errors.New("la base de búsqueda no existe en el directorio"))
		}
		return Entry{}, unavailable(err)
	}
	switch len(res.Entries) {
	case 0:
		return Entry{}, ErrNotFound
	case 1:
	default:
		return Entry{}, ErrAmbiguous
	}
	e := res.Entries[0]
	return Entry{
		DN:       e.DN,
		Username: strings.TrimSpace(e.GetAttributeValue(c.UsernameAttr)),
		Name:     strings.TrimSpace(e.GetAttributeValue(c.NameAttr)),
		Email:    strings.ToLower(strings.TrimSpace(e.GetAttributeValue(c.EmailAttr))),
	}, nil
}

// tlsConfig: verifica el certificado salvo que se apague a propósito; la CA
// propia se suma a las del sistema.
func tlsConfig(c Config) (*tls.Config, error) {
	u, err := url.Parse(c.URL)
	if err != nil {
		return nil, err
	}
	cfg := &tls.Config{ServerName: u.Hostname(), MinVersion: tls.VersionTLS12, InsecureSkipVerify: !c.VerifyTLS} //nolint:gosec // apagar la verificación es una opción explícita del admin, como en GLPI
	if pem := strings.TrimSpace(c.CAPEM); pem != "" {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM([]byte(pem)) {
			return nil, errors.New("la CA no es un certificado PEM válido")
		}
		cfg.RootCAs = pool
	}
	return cfg, nil
}

func dialTLS(c Config) (Conn, error) {
	tc, err := tlsConfig(c)
	if err != nil {
		return nil, err
	}
	conn, err := ldap.DialURL(c.URL, ldap.DialWithDialer(&net.Dialer{Timeout: c.Timeout}), ldap.DialWithTLSConfig(tc))
	if err != nil {
		return nil, err
	}
	conn.SetTimeout(c.Timeout)
	if strings.HasPrefix(strings.ToLower(c.URL), "ldap://") {
		if err := conn.StartTLS(tc); err != nil {
			conn.Close()
			return nil, errors.New("StartTLS falló: " + err.Error())
		}
	}
	return conn, nil
}
