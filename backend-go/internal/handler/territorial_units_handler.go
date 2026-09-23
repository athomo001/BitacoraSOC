package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/territory"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TerritorialUnitsHandler cubre /api/territorial-units/* (módulo NOC — el
// gate 403 lo pone middleware.RequireModule en main.go, no este handler).
// spec/04-contratos-api.md, HU-TERR-2/3, spec/03b-guia-import-territorial.md.
type TerritorialUnitsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
}

type territorialUnitDTO struct {
	ID         uuid.UUID  `json:"id"`
	ParentID   *uuid.UUID `json:"parentId"`
	Kind       string     `json:"kind"`
	Name       string     `json:"name"`
	Code       string     `json:"code"`
	Path       string     `json:"path"`
	Depth      int        `json:"depth"`
	Address    *string    `json:"address,omitempty"`
	Latitude   *float64   `json:"latitude,omitempty"`
	Longitude  *float64   `json:"longitude,omitempty"`
	Active     bool       `json:"active"`
	ChildCount *int32     `json:"childCount,omitempty"`
}

func toTerritorialUnitDTO(u db.TerritorialUnit) territorialUnitDTO {
	dto := territorialUnitDTO{
		ID: u.ID, Kind: string(u.Kind), Name: u.Name, Code: u.Code, Path: u.Path,
		Depth: strings.Count(u.Path, "."), Latitude: u.Latitude, Longitude: u.Longitude, Active: u.Active,
	}
	if u.ParentID.Valid {
		id := uuid.UUID(u.ParentID.Bytes)
		dto.ParentID = &id
	}
	if u.Address.Valid {
		dto.Address = &u.Address.String
	}
	return dto
}

const (
	defaultTerritoryPageSize = 500
	maxTerritoryPageSize     = 5000
	// Un país grande del dataset dr5hn (ej. EE.UU., ~20k ciudades) pesa
	// varios MB — el tope general de 1MB de decodeJSON no alcanza.
	maxTerritoryImportBytes = 25 << 20
)

func (h *TerritorialUnitsHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	var parentFilter pgtype.UUID
	if raw := q.Get("parentId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "parentId inválido")
			return
		}
		parentFilter = pgtype.UUID{Bytes: id, Valid: true}
	}
	var activeFilter pgtype.Bool
	if active := q.Get("active"); active != "" {
		activeFilter = pgtype.Bool{Bool: active == "true", Valid: true}
	}
	page := parsePositiveInt(q.Get("page"), 1)
	pageSize := parsePositiveInt(q.Get("pageSize"), defaultTerritoryPageSize)
	if pageSize > maxTerritoryPageSize {
		pageSize = maxTerritoryPageSize
	}

	rows, err := h.Queries.ListTerritorialUnits(ctx, db.ListTerritorialUnitsParams{
		ParentID: parentFilter, Active: activeFilter,
		PageSize: int32(pageSize), PageOffset: int32((page - 1) * pageSize),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar el territorio")
		return
	}
	total, err := h.Queries.CountTerritorialUnits(ctx, db.CountTerritorialUnitsParams{ParentID: parentFilter, Active: activeFilter})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo contar el territorio")
		return
	}

	dtos := make([]territorialUnitDTO, 0, len(rows))
	for _, row := range rows {
		dto := toTerritorialUnitDTO(db.TerritorialUnit{
			ID: row.ID, ParentID: row.ParentID, Kind: row.Kind, Name: row.Name, Code: row.Code, Path: row.Path,
			Address: row.Address, Latitude: row.Latitude, Longitude: row.Longitude, Active: row.Active,
		})
		childCount := row.ChildCount
		dto.ChildCount = &childCount
		dtos = append(dtos, dto)
	}
	writeDataMeta(w, http.StatusOK, dtos, map[string]any{"page": page, "pageSize": pageSize, "total": total})
}

type createTerritorialUnitRequest struct {
	ParentID  *uuid.UUID `json:"parentId"`
	Kind      string     `json:"kind"`
	Name      string     `json:"name"`
	Code      string     `json:"code"`
	Address   *string    `json:"address"`
	Latitude  *float64   `json:"latitude"`
	Longitude *float64   `json:"longitude"`
}

// Create agrega una unidad a mano — la vía normal para completar lo que el
// dataset no trae (ej. un sitio/nodo dentro de una zona importada, HU-TERR-3).
func (h *TerritorialUnitsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req createTerritorialUnitRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	kind := territory.Kind(req.Kind)
	code, name := strings.TrimSpace(req.Code), strings.TrimSpace(req.Name)
	if !kind.Valid() || code == "" || name == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "kind (country|region|zone|site), code y name son obligatorios")
		return
	}
	if !validCoordinates(req.Latitude, req.Longitude) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-coordinates", "latitud/longitud fuera de rango")
		return
	}

	path := territory.PathLabel(code)
	var parent pgtype.UUID
	if req.ParentID != nil {
		p, err := h.Queries.GetTerritorialUnit(ctx, *req.ParentID)
		if err != nil {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "parentId inexistente")
			return
		}
		if !territory.Kind(p.Kind).CanContain(kind) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-kind-order", "un "+req.Kind+" no puede ir dentro de un "+string(p.Kind))
			return
		}
		parent = pgtype.UUID{Bytes: p.ID, Valid: true}
		path = p.Path + "." + path
	}

	unit, err := h.Queries.CreateTerritorialUnit(ctx, db.CreateTerritorialUnitParams{
		ParentID: parent, Kind: db.TerritorialKind(kind), Name: name, Code: code, Path: path,
		Address: optionalText(req.Address), Latitude: req.Latitude, Longitude: req.Longitude,
	})
	if isUniqueViolation(err) {
		problemdetails.Write(w, r, http.StatusConflict, "duplicate-code", "ya existe una unidad con code "+code)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la unidad")
		return
	}
	h.AuditLog.Log(ctx, "territorial_unit.create", audit.LevelInfo, audit.Success(), map[string]any{"code": code, "kind": req.Kind})
	writeData(w, http.StatusCreated, toTerritorialUnitDTO(unit))
}

type patchTerritorialUnitRequest struct {
	Name      *string  `json:"name"`
	Address   *string  `json:"address"`
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Active    *bool    `json:"active"`
}

// Patch corrige nombre/dirección/coordenadas o desactiva (active=false, sin
// borrar historial) — HU-TERR-3.
func (h *TerritorialUnitsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req patchTerritorialUnitRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "name no puede quedar vacío")
		return
	}
	if !validCoordinates(req.Latitude, req.Longitude) {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-coordinates", "latitud/longitud fuera de rango")
		return
	}
	params := db.UpdateTerritorialUnitParams{ID: id, Address: optionalText(req.Address), Latitude: req.Latitude, Longitude: req.Longitude}
	if req.Name != nil {
		params.Name = pgtype.Text{String: strings.TrimSpace(*req.Name), Valid: true}
	}
	if req.Active != nil {
		params.Active = pgtype.Bool{Bool: *req.Active, Valid: true}
	}
	unit, err := h.Queries.UpdateTerritorialUnit(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "unidad territorial no encontrada")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la unidad")
		return
	}
	h.AuditLog.Log(ctx, "territorial_unit.update", audit.LevelInfo, audit.Success(), map[string]any{"id": id.String(), "code": unit.Code})
	writeData(w, http.StatusOK, toTerritorialUnitDTO(unit))
}

// Import es POST /api/territorial-units/import: JSON anidado, upsert por
// code, parcial. Todo en una sola transacción con un savepoint por nodo
// (ver repository.TerritoryStore).
func (h *TerritorialUnitsHandler) Import(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	defer r.Body.Close()
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxTerritoryImportBytes))
	if err != nil {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "payload-too-large", "el archivo supera el máximo de 25MB")
		return
	}
	roots, err := territory.ParseImport(raw)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "JSON malformado: "+err.Error())
		return
	}
	if structural := territory.ValidateStructure(roots); len(structural) > 0 {
		detail := "estructura inválida: "
		for i, e := range structural {
			if i == 5 {
				detail += "…"
				break
			}
			detail += "[" + e.Code + "] " + e.Reason + "; "
		}
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-kind-order", detail)
		return
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo abrir la transacción")
		return
	}
	defer tx.Rollback(ctx) // no-op tras Commit

	result, err := territory.Import(ctx, &repository.TerritoryStore{Tx: tx}, roots)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "el import se interrumpió: "+err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo confirmar el import")
		return
	}

	level := audit.LevelInfo
	if len(result.Errors) > 0 {
		level = audit.LevelWarn
	}
	h.AuditLog.Log(ctx, "territorial_unit.import", level, audit.Success(), map[string]any{
		"importedCount": result.ImportedCount, "updatedCount": result.UpdatedCount, "errorCount": len(result.Errors),
	})
	writeData(w, http.StatusOK, result)
}

// ImportTemplate es el ejemplo descargable (1 país, 1 región y 1 sitio
// anidados) para copiar la estructura — HU-TERR-2.
func (h *TerritorialUnitsHandler) ImportTemplate(w http.ResponseWriter, _ *http.Request) {
	lat, lng := -22.4561, -68.9237
	template := territory.Node{
		Code: "CL", Kind: territory.KindCountry, Name: "Chile",
		Children: []territory.Node{{
			Code: "CL-AN", Kind: territory.KindRegion, Name: "Antofagasta",
			Children: []territory.Node{{
				Code: "CL-AN-NODO-CALAMA", Kind: territory.KindSite, Name: "Nodo Central Calama",
				Latitude: &lat, Longitude: &lng,
			}},
		}},
	}
	w.Header().Set("Content-Disposition", `attachment; filename="territorial_units_template.json"`)
	// Sin envoltorio {data}: es un archivo para descargar y volver a subir
	// tal cual a /import, no un recurso de la API.
	writeJSON(w, http.StatusOK, template)
}

func validCoordinates(lat, lng *float64) bool {
	return (lat == nil || (*lat >= -90 && *lat <= 90)) && (lng == nil || (*lng >= -180 && *lng <= 180))
}

func optionalText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: strings.TrimSpace(*s), Valid: true}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func parsePositiveInt(raw string, fallback int) int {
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}
