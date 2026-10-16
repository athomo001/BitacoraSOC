package handler

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"
)

// setModuleFlags enciende o apaga los módulos SOC y NOC (000036). No toca
// las áreas: el área es la gente, el módulo son las funciones.
func setModuleFlags(ctx context.Context, q *db.Queries, soc, noc bool) error {
	if err := q.EnsureAppConfigRow(ctx); err != nil {
		return err
	}
	return q.SetModuleFlags(ctx, db.SetModuleFlagsParams{Soc: soc, Noc: noc})
}

// AreasHandler es Administración → Áreas y niveles (spec/16 §3, 9b,
// diseño aprobado por el dueño 2026-10-13): crear, renombrar y apagar
// áreas, y crear, renombrar y ordenar niveles. Un área es gente (personal,
// jefaturas, permisos); apagarla no apaga funciones: los módulos SOC y NOC
// se encienden en Módulos (000036, dueño 2026-10-14).
type AreasHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
}

type areaDTO struct {
	ID     uuid.UUID `json:"id"`
	Code   string    `json:"code"`
	Name   string    `json:"name"`
	Active bool      `json:"active"`
	System bool      `json:"system"`
	// Profile: el perfil de los grupos que se arman solos al ubicar a una
	// persona en esta área (SOC/NOC Operativo; las demás, Resolutor).
	Profile    string `json:"profile"`
	GroupCount int32  `json:"groupCount"`
	// TicketSeries: cómo numera los tickets que pide (solo vista; se
	// configura en Administración → Ticketera).
	TicketSeries *areaTicketSeriesDTO `json:"ticketSeries,omitempty"`
}

type areaTicketSeriesDTO struct {
	Name    string `json:"name"`
	Preview string `json:"preview"`
	General bool   `json:"general"`
}

type levelDTO struct {
	ID         uuid.UUID `json:"id"`
	Code       string    `json:"code"`
	Name       string    `json:"name"`
	Rank       int32     `json:"rank"`
	GroupCount int32     `json:"groupCount"`
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slugCode: "Mesa de ayuda" → "mesa_de_ayuda" (el código de un área o nivel).
func slugCode(name string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(strings.TrimSpace(name))) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return strings.Trim(nonSlug.ReplaceAllString(b.String(), "_"), "_")
}

const maxAreaName = 60

func cleanAreaName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	return name, name != "" && len([]rune(name)) <= maxAreaName && slugCode(name) != ""
}

// List es GET /api/areas.
func (h *AreasHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListAreasWithUsage(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer las áreas")
		return
	}
	series, general := areaSeriesExamples(r.Context(), h.Queries, time.Now())
	out := make([]areaDTO, 0, len(rows))
	for _, a := range rows {
		dto := areaDTO{ID: a.ID, Code: a.Code, Name: a.Name, Active: a.Active, System: a.IsSystem, Profile: a.DefaultProfile, GroupCount: a.GroupCount}
		if s, ok := series[a.TicketSeriesID.Bytes]; ok && a.TicketSeriesID.Valid {
			dto.TicketSeries = &areaTicketSeriesDTO{Name: s.Name, Preview: s.Preview, General: s.IsDefault}
		} else if general != nil {
			dto.TicketSeries = &areaTicketSeriesDTO{Name: general.Name, Preview: general.Preview, General: true}
		}
		out = append(out, dto)
	}
	writeData(w, http.StatusOK, out)
}

// Create es POST /api/areas {name}: el código sale del nombre.
func (h *AreasHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name, ok := cleanAreaName(req.Name)
	if !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre es obligatorio (hasta 60 caracteres)")
		return
	}
	a, err := h.Queries.CreateArea(r.Context(), db.CreateAreaParams{Code: slugCode(name), Name: name})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe un área con ese nombre")
		return
	}
	h.AuditLog.Log(r.Context(), "area.create", audit.LevelInfo, audit.Success(), map[string]any{"code": a.Code})
	writeData(w, http.StatusCreated, areaDTO{ID: a.ID, Code: a.Code, Name: a.Name, Active: a.Active, System: a.IsSystem, Profile: a.DefaultProfile})
}

// Patch es PATCH /api/areas/{code} {name?, active?}. El código no cambia.
func (h *AreasHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.PathValue("code")
	var req struct {
		Name    *string `json:"name"`
		Active  *bool   `json:"active"`
		Profile *string `json:"profile"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	p := db.UpdateAreaParams{Code: code}
	if req.Name != nil {
		name, ok := cleanAreaName(*req.Name)
		if !ok {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre es obligatorio (hasta 60 caracteres)")
			return
		}
		p.Name = pgtype.Text{String: name, Valid: true}
	}
	if req.Profile != nil {
		if !validProfile(*req.Profile) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "perfil inválido")
			return
		}
		p.DefaultProfile = pgtype.Text{String: *req.Profile, Valid: true}
	}
	if req.Active != nil {
		p.Active = pgtype.Bool{Bool: *req.Active, Valid: true}
	}
	a, err := h.Queries.UpdateArea(ctx, p)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "área no encontrada")
		return
	}
	h.AuditLog.Log(ctx, "area.update", audit.LevelInfo, audit.Success(), map[string]any{"code": a.Code, "active": a.Active, "renamed": req.Name != nil, "profile": a.DefaultProfile})
	writeData(w, http.StatusOK, areaDTO{ID: a.ID, Code: a.Code, Name: a.Name, Active: a.Active, System: a.IsSystem, Profile: a.DefaultProfile})
}

// ListLevels es GET /api/levels.
func (h *AreasHandler) ListLevels(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListLevelsWithUsage(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los niveles")
		return
	}
	out := make([]levelDTO, 0, len(rows))
	for _, l := range rows {
		out = append(out, levelDTO{ID: l.ID, Code: l.Code, Name: l.Name, Rank: l.Rank, GroupCount: l.GroupCount})
	}
	writeData(w, http.StatusOK, out)
}

// CreateLevel es POST /api/levels {name}: queda al final del orden.
func (h *AreasHandler) CreateLevel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name, ok := cleanAreaName(req.Name)
	if !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre es obligatorio (hasta 60 caracteres)")
		return
	}
	l, err := h.Queries.CreateLevel(r.Context(), db.CreateLevelParams{Code: slugCode(name), Name: name})
	if err != nil {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe un nivel con ese nombre")
		return
	}
	h.AuditLog.Log(r.Context(), "level.create", audit.LevelInfo, audit.Success(), map[string]any{"code": l.Code})
	writeData(w, http.StatusCreated, levelDTO{ID: l.ID, Code: l.Code, Name: l.Name, Rank: l.Rank})
}

// RenameLevel es PATCH /api/levels/{id} {name}.
func (h *AreasHandler) RenameLevel(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "nivel no encontrado")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name, ok := cleanAreaName(req.Name)
	if !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre es obligatorio (hasta 60 caracteres)")
		return
	}
	l, err := h.Queries.RenameLevel(r.Context(), db.RenameLevelParams{ID: id, Name: name})
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "nivel no encontrado")
		return
	}
	h.AuditLog.Log(r.Context(), "level.update", audit.LevelInfo, audit.Success(), map[string]any{"code": l.Code})
	writeData(w, http.StatusOK, levelDTO{ID: l.ID, Code: l.Code, Name: l.Name, Rank: l.Rank})
}

// OrderLevels es PUT /api/levels/order {ids}: el orden decide quién asigna
// a quién (un nivel asigna a los de abajo de su misma área).
func (h *AreasHandler) OrderLevels(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if err := decodeJSON(w, r, &req); err != nil || len(req.IDs) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "indica el orden de los niveles")
		return
	}
	for i, id := range req.IDs {
		if n, err := h.Queries.SetLevelRank(r.Context(), db.SetLevelRankParams{ID: id, Rank: int32(i + 1)}); err != nil || n == 0 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "algún nivel no existe")
			return
		}
	}
	h.AuditLog.Log(r.Context(), "level.order", audit.LevelInfo, audit.Success(), map[string]any{"count": len(req.IDs)})
	w.WriteHeader(http.StatusNoContent)
}
