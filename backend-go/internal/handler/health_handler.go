// Package handler contiene los controladores HTTP (REST + SSE).
// Ver spec/07-backend-arquitectura-go.md sección 1.
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// HealthHandler agrupa los endpoints de salud del binario (Fase 2 del roadmap,
// spec/02-alcance-y-roadmap.md).
type HealthHandler struct {
	Queries *db.Queries
}

// Live responde 200 mientras el proceso Go esté vivo, sin tocar dependencias
// externas — es la sonda de liveness de Docker/orquestador.
func (h *HealthHandler) Live(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "live"})
}

// Ready confirma que el proceso puede atender tráfico real: ejecuta la query
// generada por sqlc (Ping, sql/queries/health.sql) contra Postgres — no solo
// abrir el socket — con un timeout corto para no colgar la sonda si la base
// está caída o saturada.
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if _, err := h.Queries.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "not_ready",
			"error":  "database unreachable",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
