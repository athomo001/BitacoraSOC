// Package glpi habla con GLPI por su API clásica (apirest.php, App-Token +
// User-Token), igual que el legacy (utils/glpi-dispatch.js): abre sesión,
// trabaja y la cierra siempre. Lee equipos y tickets con el usuario de solo
// lectura; escribe (comentarios y copias de tickets, 10d.2) solo con el
// User-Token de escritura, que el admin enciende aparte (spec/18 §4). La API v2 de GLPI 11 (api.php/v2, OAuth2) pide guardar
// usuario y contraseña de GLPI; si algún día GLPI retira la clásica, se
// cambia este paquete y nada más.
package glpi

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config es la conexión guardada en Administración → GLPI.
type Config struct {
	URL       string
	AppToken  string
	UserToken string
	VerifyTLS bool
	Timeout   time.Duration
}

// NormalizeURL deja la dirección terminada en /apirest.php (como el legacy):
// se acepta la raíz de GLPI o la dirección completa de la API.
func NormalizeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("la URL de GLPI debe empezar con http:// o https://")
	}
	u.RawQuery, u.Fragment = "", ""
	path := strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(path, "/apirest.php") {
		path += "/apirest.php"
	}
	u.Path = path
	return u.String(), nil
}

// WebURL es la dirección para abrir un equipo en GLPI desde la ficha.
func WebURL(apiURL, itemtype string, id int) string {
	base := strings.TrimSuffix(strings.TrimRight(apiURL, "/"), "/apirest.php")
	if base == "" {
		return ""
	}
	return fmt.Sprintf("%s/front/%s.form.php?id=%d", base, strings.ToLower(itemtype), id)
}

// APIError es una respuesta de error de GLPI: ["ERROR_CODE", "mensaje"].
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("GLPI respondió %d %s: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("GLPI respondió %d: %s", e.Status, e.Message)
}

// Session es una sesión abierta en GLPI. Se cierra con Close.
type Session struct {
	cfg   Config
	http  *http.Client
	token string
}

func newHTTPClient(cfg Config) *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if !cfg.VerifyTLS {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // lo apaga el admin para un GLPI con certificado propio
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	return &http.Client{Transport: tr, Timeout: timeout}
}

// Open abre la sesión (initSession) y le da acceso a todas las entidades que
// ve el usuario del token, con sus hijas.
func Open(ctx context.Context, cfg Config) (*Session, error) {
	s := &Session{cfg: cfg, http: newHTTPClient(cfg)}
	var out struct {
		SessionToken string `json:"session_token"`
	}
	if _, err := s.do(ctx, http.MethodGet, "initSession", nil, nil, &out, map[string]string{"Authorization": "user_token " + cfg.UserToken}); err != nil {
		return nil, err
	}
	if out.SessionToken == "" {
		return nil, errors.New("GLPI no devolvió session_token en initSession")
	}
	s.token = out.SessionToken
	if _, err := s.do(ctx, http.MethodPost, "changeActiveEntities", nil, map[string]any{"entities_id": "all", "is_recursive": true}, nil, nil); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

// Close cierra la sesión (killSession). Si falla, la sesión vence sola en GLPI.
func (s *Session) Close() {
	if s == nil || s.token == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = s.do(ctx, http.MethodGet, "killSession", nil, nil, nil, nil)
	s.token = ""
}

// do hace una llamada y decodifica el JSON en out (si no es nil).
func (s *Session) do(ctx context.Context, method, path string, query url.Values, body, out any, extra map[string]string) (http.Header, error) {
	u := strings.TrimRight(s.cfg.URL, "/") + "/" + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.cfg.AppToken != "" {
		req.Header.Set("App-Token", s.cfg.AppToken)
	}
	if s.token != "" {
		req.Header.Set("Session-Token", s.token)
	}
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	res, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 400 {
		return res.Header, parseError(res.StatusCode, raw)
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.Header, fmt.Errorf("GLPI devolvió algo que no es JSON (¿la URL apunta a apirest.php?): %w", err)
		}
	}
	return res.Header, nil
}

func parseError(status int, raw []byte) error {
	e := &APIError{Status: status}
	var parts []any
	if json.Unmarshal(raw, &parts) == nil && len(parts) > 0 {
		e.Code, _ = parts[0].(string)
		if len(parts) > 1 {
			e.Message = fmt.Sprint(parts[1])
		}
		return e
	}
	msg := strings.TrimSpace(string(raw))
	if len(msg) > 200 {
		msg = msg[:200] + "…"
	}
	e.Message = msg
	return e
}

// Get lee un recurso que no se pagina (getFullSession, getMyEntities…).
func (s *Session) Get(ctx context.Context, path string, query url.Values, out any) error {
	_, err := s.do(ctx, http.MethodGet, path, query, nil, out, nil)
	return err
}

// pageSize: GLPI acepta rangos de hasta ~1000 (Accept-Range); 200 deja margen.
const pageSize = 200

// List lee todas las filas de un itemtype, página por página.
func (s *Session) List(ctx context.Context, itemtype string, query url.Values) ([]map[string]any, error) {
	var all []map[string]any
	for start := 0; ; start += pageSize {
		q := url.Values{}
		for k, v := range query {
			q[k] = v
		}
		q.Set("range", fmt.Sprintf("%d-%d", start, start+pageSize-1))
		var page []map[string]any
		h, err := s.do(ctx, http.MethodGet, itemtype, q, nil, &page, nil)
		var api *APIError
		if errors.As(err, &api) && api.Code == "ERROR_RANGE_EXCEED_TOTAL" {
			break // se pidió más allá del total: no hay más
		}
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		total := totalOf(h.Get("Content-Range"))
		if len(page) < pageSize || (total >= 0 && start+len(page) >= total) {
			break
		}
	}
	return all, nil
}

// Count lee cuántos hay de un itemtype sin traerlos (Content-Range).
func (s *Session) Count(ctx context.Context, itemtype string) (int, error) {
	q := url.Values{"range": {"0-0"}, "only_id": {"true"}}
	var page []map[string]any
	h, err := s.do(ctx, http.MethodGet, itemtype, q, nil, &page, nil)
	var api *APIError
	if errors.As(err, &api) && api.Code == "ERROR_RANGE_EXCEED_TOTAL" {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if t := totalOf(h.Get("Content-Range")); t >= 0 {
		return t, nil
	}
	return len(page), nil
}

// totalOf: «0-199/217» → 217; -1 si no viene.
func totalOf(contentRange string) int {
	i := strings.LastIndex(contentRange, "/")
	if i < 0 {
		return -1
	}
	n, err := strconv.Atoi(strings.TrimSpace(contentRange[i+1:]))
	if err != nil {
		return -1
	}
	return n
}

// ===== Lectura de valores =====
// GLPI devuelve números como número o como texto según la versión, y los
// nombres con entidades HTML («Netics &#62; Casinos»).

// Str es el texto de un campo; "" si viene vacío o 0 (desplegable sin valor).
func Str(v any) string {
	var s string
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		s = x
	case float64:
		if x == 0 {
			return ""
		}
		s = strconv.FormatFloat(x, 'f', -1, 64)
	default:
		s = fmt.Sprint(x)
	}
	s = strings.TrimSpace(html.UnescapeString(s))
	if s == "0" || s == " " {
		return ""
	}
	return s
}

// Int es el número de un campo; 0 si no es número.
func Int(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(x))
		return n
	case bool:
		if x {
			return 1
		}
	}
	return 0
}

// ===== Errores explicados =====

// Explanation dice qué pasó, la causa probable y qué hacer (como el legacy).
type Explanation struct {
	Error string `json:"error"`
	Cause string `json:"cause"`
	Next  string `json:"next"`
	Raw   string `json:"raw"`
}

// Explain traduce un error de conexión o de GLPI a algo que el admin entienda.
func Explain(err error) Explanation {
	ex := Explanation{Raw: err.Error()}
	var api *APIError
	var nerr net.Error
	var dns *net.DNSError
	var cert *tls.CertificateVerificationError
	switch {
	case errors.As(err, &api):
		switch api.Code {
		case "ERROR_GLPI_LOGIN_USER_TOKEN", "ERROR_LOGIN_PARAMETERS_MISSING":
			ex.Error, ex.Cause, ex.Next = "GLPI rechazó el User-Token.", "El token se regeneró en GLPI, está mal copiado o el usuario está desactivado.",
				"En GLPI abre el usuario de la Bitácora → Preferencias → Claves de acceso remoto, copia el token de API y pégalo aquí."
		case "ERROR_WRONG_APP_TOKEN_PARAMETER", "ERROR_APP_TOKEN_PARAMETERS_MISSING":
			ex.Error, ex.Cause, ex.Next = "GLPI rechazó el App-Token.", "El App-Token no corresponde a ningún cliente de API de GLPI.",
				"En GLPI: Configuración → General → API → Clientes de API. Abre el cliente de la Bitácora y copia su App-Token."
		case "ERROR_NOT_ALLOWED_IP":
			ex.Error, ex.Cause, ex.Next = "GLPI no acepta conexiones desde el servidor de la Bitácora.", "El cliente de API de GLPI tiene un rango de IP que no incluye a la Bitácora.",
				"En GLPI: Configuración → General → API → Clientes de API: agrega la IP del servidor de la Bitácora al cliente."
		case "ERROR_RIGHT_MISSING", "ERROR_NOT_ALLOWED":
			ex.Error, ex.Cause, ex.Next = "El usuario de GLPI no tiene permiso para leer equipos.", "Su perfil no puede ver computadores o equipos de red.",
				"Dale al usuario de la Bitácora un perfil con lectura de Computadores y Equipos de red en todas las entidades (recursivo)."
		case "ERROR_SESSION_TOKEN_INVALID", "ERROR_SESSION_TOKEN_MISSING":
			ex.Error, ex.Cause, ex.Next = "GLPI cerró la sesión a mitad de la lectura.", "La sesión venció o GLPI se reinició.", "Vuelve a intentarlo."
		default:
			switch {
			case api.Status == http.StatusNotFound:
				ex.Error, ex.Cause, ex.Next = "No se encontró la API de GLPI en esa dirección.", "La URL no apunta a apirest.php o la API está apagada.",
					"Revisa la URL y, en GLPI, Configuración → General → API: prende «API REST» e «Inicio de sesión con token externo»."
			case strings.Contains(strings.ToLower(api.Message), "disabled") || strings.Contains(strings.ToLower(api.Message), "desactivad"):
				ex.Error, ex.Cause, ex.Next = "La API de GLPI está apagada.", "GLPI no tiene activa la API REST o el inicio de sesión con token.",
					"En GLPI: Configuración → General → API: prende «API REST» e «Inicio de sesión con token externo»."
			default:
				ex.Error, ex.Cause, ex.Next = "GLPI respondió con un error.", "Mira el detalle técnico.", "Si no se entiende, revisa el registro de errores de GLPI."
			}
		}
	case errors.As(err, &cert) || strings.Contains(err.Error(), "x509:") || strings.Contains(err.Error(), "certificate"):
		ex.Error, ex.Cause, ex.Next = "No se pudo validar el certificado de GLPI.", "GLPI usa un certificado propio o vencido.",
			"Instala un certificado válido en GLPI o apaga «Validar el certificado TLS» (solo en una red interna)."
	case errors.As(err, &dns):
		ex.Error, ex.Cause, ex.Next = "No se encontró el servidor de GLPI.", "El nombre de la URL no existe o el servidor de la Bitácora no lo resuelve.",
			"Revisa la URL. Si es un nombre interno, que el servidor de la Bitácora lo pueda resolver."
	case errors.As(err, &nerr) && nerr.Timeout():
		ex.Error, ex.Cause, ex.Next = "GLPI no respondió a tiempo.", "GLPI está caído, lento o un firewall bloquea la conexión.",
			"Revisa que GLPI esté arriba y que el servidor de la Bitácora llegue a él. Puedes subir el tiempo de espera."
	case strings.Contains(err.Error(), "connection refused"):
		ex.Error, ex.Cause, ex.Next = "GLPI rechazó la conexión.", "El puerto está cerrado o GLPI no está escuchando en esa dirección.",
			"Revisa la URL (http o https, puerto) y que GLPI esté arriba."
	default:
		ex.Error, ex.Cause, ex.Next = "No se pudo conectar con GLPI.", "Mira el detalle técnico.", "Revisa la URL y la red entre la Bitácora y GLPI."
	}
	return ex
}
