package complements

import (
	"net/url"
	"strings"
)

// CSP arma el encabezado de spec/11 §2 para un complemento servido desde el
// origen aislado. 'unsafe-inline' y 'unsafe-eval' se aceptan porque el
// origen no comparte nada con la app (DOOM/js-dos evalúa código y no corre
// sin 'unsafe-eval', comprobado en navegador). Los sitios externos que el
// admin autorizó se abren para llamadas, estilos, fuentes e imágenes, nunca
// para scripts; frame-ancestors deja embeberlo solo desde la app.
func CSP(appOrigin string, connectHosts []string) string {
	hosts := []string{}
	for _, h := range connectHosts {
		if o, ok := NormalizeHost(h); ok {
			hosts = append(hosts, o)
		}
	}
	with := func(base string) string {
		if len(hosts) == 0 {
			return base
		}
		return base + " " + strings.Join(hosts, " ")
	}
	ancestors := "'none'"
	if appOrigin != "" {
		ancestors = appOrigin
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
		"worker-src 'self' blob:",
		with("style-src 'self' 'unsafe-inline'"),
		with("img-src 'self' data: blob:"),
		"media-src 'self' data: blob:",
		with("font-src 'self' data:"),
		with("connect-src 'self'"),
		"frame-ancestors " + ancestors,
		"base-uri 'self'",
		"form-action 'self'",
	}, "; ")
}

// NormalizeHost deja un host externo como origen ("https://api.x.cl" o
// "wss://…"), sin ruta ni comodines. false si no sirve.
func NormalizeHost(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || strings.ContainsAny(u.Host, "*' ;") {
		return "", false
	}
	switch u.Scheme {
	case "https", "wss", "http", "ws":
	default:
		return "", false
	}
	return strings.ToLower(u.Scheme + "://" + u.Host), true
}

// Origin devuelve "esquema://host[:puerto]" de una URL base.
func Origin(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
