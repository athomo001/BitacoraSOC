package main

import (
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
)

// rateLimitDisabled lee RATE_LIMIT_DISABLED (solo desarrollo): apaga el
// límite de login por IP, el de requests de la API y los de complementos
// (eliminaciones por hora, llamadas de la Runtime API) para no quedar
// bloqueado 15 minutos por probar contraseñas. Solo se respeta si
// PUBLIC_BASE_URL apunta a esta máquina (localhost / 127.0.0.1 / ::1): en
// un servidor real se ignora y lo avisa en el log, para que un .env
// copiado de desarrollo no deje producción sin límite.
func rateLimitDisabled(publicBaseURL string, logger *slog.Logger) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("RATE_LIMIT_DISABLED"))) {
	case "1", "true", "yes", "si", "sí":
	default:
		return false
	}
	if !isLoopbackURL(publicBaseURL) {
		logger.Error("RATE_LIMIT_DISABLED ignorado: solo vale con PUBLIC_BASE_URL local (localhost/127.0.0.1)", "publicBaseURL", publicBaseURL)
		return false
	}
	logger.Warn("rate limit DESACTIVADO por RATE_LIMIT_DISABLED (solo desarrollo)")
	return true
}

func isLoopbackURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
