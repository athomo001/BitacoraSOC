// Package problemdetails escribe respuestas de error en formato RFC 7807
// (spec/04-contratos-api.md: "Convención global de respuesta", decisión
// cerrada para toda la API).
package problemdetails

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Problem es el cuerpo de una respuesta de error RFC 7807.
type Problem struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

const baseURL = "https://bitacorasoc.local/errors/"

// Write responde status con un Problem cuyo type es baseURL+slug (ej.
// "invalid-payload" -> "https://bitacorasoc.local/errors/invalid-payload").
func Write(w http.ResponseWriter, r *http.Request, status int, slug, detail string) {
	p := Problem{
		Type:     baseURL + slug,
		Title:    http.StatusText(status),
		Status:   status,
		Detail:   detail,
		Instance: r.URL.Path,
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}

// WriteRateLimited es Write especializado para 429, con el header
// Retry-After que exige spec/04-contratos-api.md.
func WriteRateLimited(w http.ResponseWriter, r *http.Request, retryAfterSeconds int, detail string) {
	if retryAfterSeconds < 0 {
		retryAfterSeconds = 0
	}
	w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
	Write(w, r, http.StatusTooManyRequests, "rate-limited", detail)
}
