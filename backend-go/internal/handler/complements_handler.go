package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/complements"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Scopes de la Runtime API (spec/11 §5.4, mismos nombres que el legacy).
var complementScopes = []string{"READ_CONTEXT", "READ_LOGS", "WRITE_ENTRIES", "READ_STORAGE", "WRITE_STORAGE", "WRITE_LOGS"}

// Colecciones que un complemento puede leer o escribir por la Runtime API.
var complementCollections = []string{"entries", "audit_log", "shared_storage"}

// applicationTokenTTL: el token de un servicio dura un año; se revoca
// regenerándolo (se guarda su hash). El legacy lo limitaba a 24 h y había
// que reemitirlo a diario.
const applicationTokenTTL = 365 * 24 * time.Hour

// ComplementsHandler es la administración y el uso de complementos
// (spec/11-complementos.md, Fase 13b), en el origen de la app. Lo que se
// sirve en el origen aislado vive en complements_origin.go y la Runtime API
// en complements_runtime.go.
type ComplementsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	JWT      *auth.JWTIssuer
	Signer   *complements.Signer
	Breaker  *complements.Breaker
	// AppOrigin es el origen de la app (PUBLIC_BASE_URL): el único que puede
	// embeber un complemento (CSP frame-ancestors).
	AppOrigin string
	// OriginURL es la dirección pública del origen aislado
	// (COMPLEMENTS_PUBLIC_URL, por defecto un segundo puerto).
	OriginURL string
	// HTTP sondea la salud de los servicios y llama su hook de limpieza.
	HTTP *http.Client
	// DeleteLimiter: 3 eliminaciones por hora por admin (regla del legacy).
	DeleteLimiter *ratelimit.APILimiter

	previews *previewCache
}

// Enabled dice si la funcionalidad "complements" está encendida.
func (h *ComplementsHandler) Enabled(ctx context.Context) (bool, error) {
	f, err := h.Queries.GetSystemFeature(ctx, "complements")
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return f.IsEnabled, nil
}

// RequireEnabled responde 403 module-disabled con la funcionalidad apagada
// (se evalúa por request: apagarla corta todo al instante).
func (h *ComplementsHandler) RequireEnabled(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	on, err := h.Enabled(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el estado de los complementos")
		return
	}
	if !on {
		problemdetails.Write(w, r, http.StatusForbidden, "module-disabled", "los complementos están desactivados")
		return
	}
	next(w, r)
}

type complementDTO struct {
	Slug                      string      `json:"slug"`
	Name                      string      `json:"name"`
	Description               string      `json:"description,omitempty"`
	Icon                      string      `json:"icon"`
	SourceType                string      `json:"sourceType"`
	Status                    string      `json:"status"`
	EntryPath                 string      `json:"entryPath"`
	BaseURL                   string      `json:"baseUrl,omitempty"`
	InternalBaseURL           string      `json:"internalBaseUrl,omitempty"`
	HealthPath                string      `json:"healthPath,omitempty"`
	Scopes                    []string    `json:"scopes"`
	AllowedCollections        []string    `json:"allowedCollections"`
	ConnectHosts              []string    `json:"connectHosts"`
	VisibleRoles              []string    `json:"visibleRoles"`
	VisiblePermissionGroupIDs []uuid.UUID `json:"visiblePermissionGroupIds"`
	HasToken                  bool        `json:"hasToken"`
	TokenIssuedAt             *time.Time  `json:"tokenIssuedAt,omitempty"`
	ArtifactSHA256            string      `json:"artifactSha256,omitempty"`
	ArtifactBytes             int64       `json:"artifactBytes,omitempty"`
	ArtifactFiles             int32       `json:"artifactFiles,omitempty"`
	PublishedAt               *time.Time  `json:"publishedAt,omitempty"`
	Circuit                   string      `json:"circuit"`
	CircuitDetail             string      `json:"circuitDetail,omitempty"`
	EntriesCount              *int32      `json:"entriesCount,omitempty"`
}

func (h *ComplementsHandler) toDTO(c db.Complement) complementDTO {
	dto := complementDTO{
		Slug: c.Slug, Name: c.Name, Description: c.Description.String, Icon: c.Icon, SourceType: string(c.SourceType),
		Status: string(c.Status), EntryPath: c.EntryPath, BaseURL: c.BaseUrl.String, InternalBaseURL: c.InternalBaseUrl.String,
		HealthPath: c.HealthPath.String, Scopes: nonNilStrings(c.Scopes), AllowedCollections: nonNilStrings(c.AllowedCollections),
		ConnectHosts: nonNilStrings(c.ConnectHosts), VisibleRoles: nonNilStrings(c.VisibleRoles), VisiblePermissionGroupIDs: c.VisiblePermissionGroupIds,
		HasToken: c.TokenHash.Valid, ArtifactSHA256: c.ArtifactSha256.String, ArtifactBytes: c.ArtifactBytes.Int64,
		ArtifactFiles: c.ArtifactFiles.Int32, Circuit: complements.CircuitClosed,
	}
	if dto.VisiblePermissionGroupIDs == nil {
		dto.VisiblePermissionGroupIDs = []uuid.UUID{}
	}
	if c.TokenIssuedAt.Valid {
		dto.TokenIssuedAt = &c.TokenIssuedAt.Time
	}
	if c.PublishedAt.Valid {
		dto.PublishedAt = &c.PublishedAt.Time
	}
	if c.SourceType == db.ComplementSourceManual && h.Breaker != nil {
		dto.Circuit, dto.CircuitDetail = h.Breaker.State(c.Slug)
	}
	return dto
}

func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// ===== Administración =====

func (h *ComplementsHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Queries.ListComplements(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los complementos")
		return
	}
	out := make([]complementDTO, 0, len(rows))
	for _, c := range rows {
		out = append(out, h.toDTO(c))
	}
	writeData(w, http.StatusOK, out)
}

func (h *ComplementsHandler) Get(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	dto := h.toDTO(c)
	if n, err := h.Queries.CountComplementEntries(r.Context(), pgtype.UUID{Bytes: c.ID, Valid: true}); err == nil {
		dto.EntriesCount = &n
	}
	writeData(w, http.StatusOK, dto)
}

func (h *ComplementsHandler) bySlug(w http.ResponseWriter, r *http.Request) (db.Complement, bool) {
	c, err := h.Queries.GetComplementBySlug(r.Context(), r.PathValue("slug"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "complemento no encontrado")
		} else {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el complemento")
		}
		return db.Complement{}, false
	}
	return c, true
}

// Upload recibe el ZIP, lo analiza y lo guarda 24 h para revisarlo y
// previsualizarlo antes de publicar. Nada toca el disco.
func (h *ComplementsHandler) Upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, complements.MaxZipBytes+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "falta el archivo .zip (o pesa más de 25 MB)")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, complements.MaxZipBytes+1))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "no se pudo leer el archivo")
		return
	}
	analysis, _, err := complements.Analyze(header.Filename, data)
	if err != nil {
		if complements.IsInvalid(err) {
			h.AuditLog.Log(r.Context(), "complement.upload", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"filename": header.Filename})
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-zip", err.Error())
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo analizar el ZIP")
		return
	}
	raw, _ := json.Marshal(analysis)
	user, _ := middleware.UserFromContext(r.Context())
	up, err := h.Queries.CreateComplementUpload(r.Context(), db.CreateComplementUploadParams{
		Filename: header.Filename, Analysis: raw, Content: data, UploadedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el ZIP")
		return
	}
	h.AuditLog.Log(r.Context(), "complement.upload", audit.LevelInfo, audit.Success(), map[string]any{
		"uploadId": up.ID.String(), "filename": header.Filename, "stack": analysis.Stack, "publishable": analysis.Publishable,
		"files": analysis.Files, "bytes": analysis.Bytes, "sha256": analysis.SHA256,
	})
	status := http.StatusCreated
	if !analysis.Publishable {
		status = http.StatusUnprocessableEntity
	}
	writeData(w, status, map[string]any{"uploadId": up.ID, "analysis": analysis, "expiresAt": up.ExpiresAt.Time})
}

// Preview entrega un enlace de un solo uso a la vista previa del ZIP.
func (h *ComplementsHandler) Preview(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	if _, err := h.Queries.GetComplementUpload(r.Context(), id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la subida no existe o ya venció")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	ticket, _ := h.Signer.Issue(complements.KindPreview, "preview:"+id.String(), user.ID, user.Role, complements.EmbedTTL)
	writeData(w, http.StatusOK, map[string]string{
		"previewUrl": strings.TrimRight(h.OriginURL, "/") + "/p/" + id.String() + "/index.html?embed=" + url.QueryEscape(ticket),
		"origin":     complements.Origin(h.OriginURL),
	})
}

type publishRequest struct {
	Slug                      string      `json:"slug"`
	Name                      string      `json:"name"`
	Description               string      `json:"description"`
	Icon                      string      `json:"icon"`
	ConnectHosts              []string    `json:"connectHosts"`
	VisibleRoles              []string    `json:"visibleRoles"`
	VisiblePermissionGroupIDs []uuid.UUID `json:"visiblePermissionGroupIds"`
}

// Publish publica (o actualiza) un complemento estático a partir de una
// subida: reemplaza sus archivos en la base, en una transacción.
func (h *ComplementsHandler) Publish(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	var req publishRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Slug, req.Name = strings.TrimSpace(req.Slug), strings.TrimSpace(req.Name)
	hosts, reason := cleanHosts(req.ConnectHosts)
	roles, roleReason := cleanRoles(req.VisibleRoles)
	switch {
	case !complements.ValidSlug(req.Slug):
		reason = "el identificador usa minúsculas, números y guiones (2 a 41 caracteres)"
	case req.Name == "" || len([]rune(req.Name)) > 80:
		reason = "el nombre es obligatorio (máximo 80 caracteres)"
	case roleReason != "":
		reason = roleReason
	}
	if reason != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
		return
	}
	up, err := h.Queries.GetComplementUpload(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "la subida no existe o ya venció")
		return
	}
	analysis, files, err := complements.Analyze(up.Filename, up.Content)
	if err != nil || !analysis.Publishable {
		problemdetails.Write(w, r, http.StatusUnprocessableEntity, "not-publishable", "este ZIP no se puede publicar como complemento estático")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	ctx := r.Context()
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo publicar")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := h.Queries.WithTx(tx)

	status := http.StatusCreated
	existing, err := q.GetComplementBySlug(ctx, req.Slug)
	var saved db.Complement
	switch {
	case err == nil && existing.SourceType == db.ComplementSourceManual:
		problemdetails.Write(w, r, http.StatusConflict, "slug-in-use", "ese identificador ya lo usa un complemento servicio")
		return
	case err == nil:
		status = http.StatusOK
		saved, err = q.UpdateComplement(ctx, db.UpdateComplementParams{
			Slug: existing.Slug, Name: req.Name, Description: optText(req.Description), Icon: iconOr(req.Icon, existing.Icon),
			Status: existing.Status, EntryPath: "index.html", BaseUrl: existing.BaseUrl, InternalBaseUrl: existing.InternalBaseUrl,
			HealthPath: existing.HealthPath, Scopes: existing.Scopes, AllowedCollections: existing.AllowedCollections,
			ConnectHosts: hosts, VisibleRoles: roles, VisiblePermissionGroupIds: nonNilUUIDs(req.VisiblePermissionGroupIDs),
		})
	case errors.Is(err, pgx.ErrNoRows):
		saved, err = q.CreateComplement(ctx, db.CreateComplementParams{
			Slug: req.Slug, Name: req.Name, Description: optText(req.Description), Icon: iconOr(req.Icon, "extension"),
			SourceType: db.ComplementSourceZipStatic, Status: db.ComplementStatusActive, EntryPath: "index.html",
			Scopes: []string{}, AllowedCollections: []string{}, ConnectHosts: hosts, VisibleRoles: roles,
			VisiblePermissionGroupIds: nonNilUUIDs(req.VisiblePermissionGroupIDs), CreatedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
		})
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo publicar")
		return
	}
	if err := q.DeleteComplementFiles(ctx, saved.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo publicar")
		return
	}
	for _, f := range files {
		if err := q.InsertComplementFile(ctx, db.InsertComplementFileParams{
			ComplementID: saved.ID, Path: f.Path, ContentType: f.ContentType, Sha256: f.SHA256, Content: f.Content,
		}); err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar "+f.Path)
			return
		}
	}
	if err := q.SetComplementArtifact(ctx, db.SetComplementArtifactParams{
		ID: saved.ID, ArtifactSha256: pgtype.Text{String: analysis.SHA256, Valid: true},
		ArtifactBytes: pgtype.Int8{Int64: analysis.Bytes, Valid: true}, ArtifactFiles: pgtype.Int4{Int32: int32(analysis.Files), Valid: true},
	}); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo publicar")
		return
	}
	_ = q.DeleteComplementUpload(ctx, id)
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo publicar")
		return
	}
	h.previews.forget(id.String())
	h.AuditLog.Log(ctx, "complement.published", audit.LevelWarn, audit.Success(), map[string]any{
		"slug": saved.Slug, "files": analysis.Files, "bytes": analysis.Bytes, "sha256": analysis.SHA256, "update": status == http.StatusOK,
	})
	fresh, err := h.Queries.GetComplementBySlug(ctx, saved.Slug)
	if err != nil {
		fresh = saved
	}
	writeData(w, status, h.toDTO(fresh))
}

type manualRequest struct {
	Slug                      string      `json:"slug"`
	Name                      string      `json:"name"`
	Description               string      `json:"description"`
	Icon                      string      `json:"icon"`
	BaseURL                   string      `json:"baseUrl"`
	InternalBaseURL           string      `json:"internalBaseUrl"`
	HealthPath                string      `json:"healthPath"`
	EntryPath                 string      `json:"entryPath"`
	Scopes                    []string    `json:"scopes"`
	AllowedCollections        []string    `json:"allowedCollections"`
	VisibleRoles              []string    `json:"visibleRoles"`
	VisiblePermissionGroupIDs []uuid.UUID `json:"visiblePermissionGroupIds"`
}

// CreateManual registra un complemento servicio (corre aparte, en cualquier
// lenguaje) y devuelve su token de aplicación una sola vez.
func (h *ComplementsHandler) CreateManual(w http.ResponseWriter, r *http.Request) {
	var req manualRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Slug, req.Name = strings.TrimSpace(req.Slug), strings.TrimSpace(req.Name)
	roles, reason := cleanRoles(req.VisibleRoles)
	scopes, scopeReason := cleanList(req.Scopes, complementScopes, "permiso")
	collections, colReason := cleanList(req.AllowedCollections, complementCollections, "colección")
	entry := strings.TrimSpace(req.EntryPath)
	if entry == "" {
		entry = "/"
	}
	health := strings.TrimSpace(req.HealthPath)
	if health == "" {
		health = "/health"
	}
	switch {
	case !complements.ValidSlug(req.Slug):
		reason = "el identificador usa minúsculas, números y guiones (2 a 41 caracteres)"
	case req.Name == "" || len([]rune(req.Name)) > 80:
		reason = "el nombre es obligatorio (máximo 80 caracteres)"
	case !validServiceURL(req.BaseURL):
		reason = "la dirección del servicio debe ser http:// o https://"
	case req.InternalBaseURL != "" && !validServiceURL(req.InternalBaseURL):
		reason = "la dirección interna debe ser http:// o https://"
	case !strings.HasPrefix(health, "/") || !strings.HasPrefix(entry, "/"):
		reason = "la ruta de salud y la de entrada empiezan con /"
	case scopeReason != "":
		reason = scopeReason
	case colReason != "":
		reason = colReason
	}
	if reason != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	c, err := h.Queries.CreateComplement(r.Context(), db.CreateComplementParams{
		Slug: req.Slug, Name: req.Name, Description: optText(req.Description), Icon: iconOr(req.Icon, "extension"),
		SourceType: db.ComplementSourceManual, Status: db.ComplementStatusActive, EntryPath: entry,
		BaseUrl: optText(strings.TrimRight(req.BaseURL, "/")), InternalBaseUrl: optText(strings.TrimRight(req.InternalBaseURL, "/")),
		HealthPath: optText(health), Scopes: scopes, AllowedCollections: collections, ConnectHosts: []string{},
		VisibleRoles: roles, VisiblePermissionGroupIds: nonNilUUIDs(req.VisiblePermissionGroupIDs),
		CreatedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
	})
	if err != nil {
		if isUniqueViolation(err) {
			problemdetails.Write(w, r, http.StatusConflict, "slug-in-use", "ese identificador ya está en uso")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo registrar el complemento")
		return
	}
	token, err := h.issueToken(r.Context(), c.Slug)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "se registró pero no se pudo emitir su token: regenéralo desde su ficha")
		return
	}
	h.AuditLog.Log(r.Context(), "complement.registered", audit.LevelWarn, audit.Success(), map[string]any{"slug": c.Slug, "baseUrl": req.BaseURL, "scopes": scopes})
	c, _ = h.Queries.GetComplementBySlug(r.Context(), c.Slug)
	writeData(w, http.StatusCreated, map[string]any{"complement": h.toDTO(c), "applicationToken": token})
}

func (h *ComplementsHandler) issueToken(ctx context.Context, slug string) (string, error) {
	token, err := h.JWT.IssueComplement(slug, applicationTokenTTL)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(token))
	if err := h.Queries.SetComplementToken(ctx, db.SetComplementTokenParams{Slug: slug, TokenHash: pgtype.Text{String: hex.EncodeToString(sum[:]), Valid: true}}); err != nil {
		return "", err
	}
	return token, nil
}

// RegenerateToken emite un token nuevo; el anterior deja de servir.
func (h *ComplementsHandler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	if c.SourceType != db.ComplementSourceManual {
		problemdetails.Write(w, r, http.StatusBadRequest, "not-a-service", "solo los complementos servicio tienen token")
		return
	}
	token, err := h.issueToken(r.Context(), c.Slug)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo emitir el token")
		return
	}
	h.AuditLog.Log(r.Context(), "complement.token.regenerated", audit.LevelWarn, audit.Success(), map[string]any{"slug": c.Slug})
	writeData(w, http.StatusOK, map[string]string{"applicationToken": token})
}

type patchComplementRequest struct {
	Name                      *string      `json:"name"`
	Description               *string      `json:"description"`
	Icon                      *string      `json:"icon"`
	Status                    *string      `json:"status"`
	BaseURL                   *string      `json:"baseUrl"`
	InternalBaseURL           *string      `json:"internalBaseUrl"`
	HealthPath                *string      `json:"healthPath"`
	EntryPath                 *string      `json:"entryPath"`
	Scopes                    *[]string    `json:"scopes"`
	AllowedCollections        *[]string    `json:"allowedCollections"`
	ConnectHosts              *[]string    `json:"connectHosts"`
	VisibleRoles              *[]string    `json:"visibleRoles"`
	VisiblePermissionGroupIDs *[]uuid.UUID `json:"visiblePermissionGroupIds"`
}

// Patch cambia la ficha: estado, permisos, hosts, visibilidad, direcciones.
// Lo que no se manda queda como estaba.
func (h *ComplementsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	var req patchComplementRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	p := db.UpdateComplementParams{
		Slug: c.Slug, Name: c.Name, Description: c.Description, Icon: c.Icon, Status: c.Status, EntryPath: c.EntryPath,
		BaseUrl: c.BaseUrl, InternalBaseUrl: c.InternalBaseUrl, HealthPath: c.HealthPath, Scopes: nonNilStrings(c.Scopes),
		AllowedCollections: nonNilStrings(c.AllowedCollections), ConnectHosts: nonNilStrings(c.ConnectHosts),
		VisibleRoles: nonNilStrings(c.VisibleRoles), VisiblePermissionGroupIds: nonNilUUIDs(c.VisiblePermissionGroupIds),
	}
	var reason string
	manual := c.SourceType == db.ComplementSourceManual
	if req.Name != nil {
		if n := strings.TrimSpace(*req.Name); n == "" || len([]rune(n)) > 80 {
			reason = "el nombre es obligatorio (máximo 80 caracteres)"
		} else {
			p.Name = n
		}
	}
	if req.Description != nil {
		p.Description = optText(*req.Description)
	}
	if req.Icon != nil {
		p.Icon = iconOr(*req.Icon, c.Icon)
	}
	if req.Status != nil {
		switch db.ComplementStatus(*req.Status) {
		case db.ComplementStatusActive, db.ComplementStatusMaintenance, db.ComplementStatusDisabled:
			p.Status = db.ComplementStatus(*req.Status)
		default:
			reason = "el estado debe ser active, maintenance o disabled"
		}
	}
	if req.ConnectHosts != nil {
		hosts, hostReason := cleanHosts(*req.ConnectHosts)
		p.ConnectHosts, reason = hosts, firstNonEmpty(reason, hostReason)
	}
	if req.VisibleRoles != nil {
		roles, roleReason := cleanRoles(*req.VisibleRoles)
		p.VisibleRoles, reason = roles, firstNonEmpty(reason, roleReason)
	}
	if req.VisiblePermissionGroupIDs != nil {
		p.VisiblePermissionGroupIds = nonNilUUIDs(*req.VisiblePermissionGroupIDs)
	}
	if manual {
		if req.BaseURL != nil {
			if !validServiceURL(*req.BaseURL) {
				reason = "la dirección del servicio debe ser http:// o https://"
			}
			p.BaseUrl = optText(strings.TrimRight(*req.BaseURL, "/"))
		}
		if req.InternalBaseURL != nil {
			if *req.InternalBaseURL != "" && !validServiceURL(*req.InternalBaseURL) {
				reason = "la dirección interna debe ser http:// o https://"
			}
			p.InternalBaseUrl = optText(strings.TrimRight(*req.InternalBaseURL, "/"))
		}
		if req.HealthPath != nil {
			if !strings.HasPrefix(*req.HealthPath, "/") {
				reason = "la ruta de salud empieza con /"
			}
			p.HealthPath = optText(*req.HealthPath)
		}
		if req.EntryPath != nil {
			if !strings.HasPrefix(*req.EntryPath, "/") {
				reason = "la ruta de entrada empieza con /"
			}
			p.EntryPath = *req.EntryPath
		}
		if req.Scopes != nil {
			scopes, scopeReason := cleanList(*req.Scopes, complementScopes, "permiso")
			p.Scopes, reason = scopes, firstNonEmpty(reason, scopeReason)
		}
		if req.AllowedCollections != nil {
			cols, colReason := cleanList(*req.AllowedCollections, complementCollections, "colección")
			p.AllowedCollections, reason = cols, firstNonEmpty(reason, colReason)
		}
	}
	if reason != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
		return
	}
	saved, err := h.Queries.UpdateComplement(r.Context(), p)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el complemento")
		return
	}
	meta := map[string]any{"slug": c.Slug}
	if saved.Status != c.Status {
		meta["status"] = string(saved.Status)
	}
	h.AuditLog.Log(r.Context(), "complement.updated", audit.LevelInfo, audit.Success(), meta)
	writeData(w, http.StatusOK, h.toDTO(saved))
}

// Test comprueba ahora mismo el complemento: los archivos de un estático o
// la salud de un servicio (y anota el resultado en el circuit breaker).
func (h *ComplementsHandler) Test(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	if c.SourceType == db.ComplementSourceZipStatic {
		n, _ := h.Queries.CountComplementFiles(r.Context(), c.ID)
		_, entryErr := h.Queries.GetComplementFile(r.Context(), db.GetComplementFileParams{Slug: c.Slug, Path: c.EntryPath})
		ok := n > 0 && entryErr == nil
		circuit := complements.CircuitClosed
		if !ok {
			circuit = complements.CircuitOpen
		}
		h.AuditLog.Log(r.Context(), "complement.tested", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug, "files": n, "ok": ok})
		writeData(w, http.StatusOK, map[string]any{"circuit": circuit, "files": n, "ok": ok})
		return
	}
	latency, probeErr := h.probe(r.Context(), c)
	h.Breaker.Record(c.Slug, probeErr == nil, errText(probeErr))
	state, detail := h.Breaker.State(c.Slug)
	h.AuditLog.Log(r.Context(), "complement.tested", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug, "ok": probeErr == nil, "latencyMs": latency.Milliseconds()})
	writeData(w, http.StatusOK, map[string]any{"circuit": state, "ok": probeErr == nil, "latencyMs": latency.Milliseconds(), "detail": detail})
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// serviceBase es la dirección que usa el backend: la interna si hay.
func serviceBase(c db.Complement) string {
	if c.InternalBaseUrl.Valid && c.InternalBaseUrl.String != "" {
		return c.InternalBaseUrl.String
	}
	return c.BaseUrl.String
}

// probe llama la ruta de salud de un servicio (5 s máximo).
func (h *ComplementsHandler) probe(ctx context.Context, c db.Complement) (time.Duration, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serviceBase(c)+c.HealthPath.String, nil)
	if err != nil {
		return 0, err
	}
	start := time.Now()
	resp, err := h.httpClient().Do(req)
	latency := time.Since(start)
	if err != nil {
		return latency, errors.New("no responde")
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	_ = resp.Body.Close()
	if resp.StatusCode >= 400 {
		return latency, errors.New("responde " + resp.Status)
	}
	return latency, nil
}

func (h *ComplementsHandler) httpClient() *http.Client {
	if h.HTTP != nil {
		return h.HTTP
	}
	return &http.Client{Timeout: 5 * time.Second}
}

// ProbeAll sondea cada 30 s la salud de los servicios activos y limpia las
// subidas vencidas (planificador).
func (h *ComplementsHandler) ProbeAll(ctx context.Context) error {
	if _, err := h.Queries.DeleteExpiredComplementUploads(ctx); err != nil {
		return err
	}
	if on, err := h.Enabled(ctx); err != nil || !on {
		return err
	}
	list, err := h.Queries.ListVisibleComplementCandidates(ctx)
	if err != nil {
		return err
	}
	for _, c := range list {
		if c.SourceType != db.ComplementSourceManual || c.Status != db.ComplementStatusActive {
			continue
		}
		_, probeErr := h.probe(ctx, c)
		h.Breaker.Record(c.Slug, probeErr == nil, errText(probeErr))
	}
	return nil
}

type deleteComplementRequest struct {
	Confirmation string `json:"confirmation"`
}

// Delete elimina un complemento: archivos y datos guardados se borran; sus
// entradas de bitácora se conservan desvinculadas (decisión del dueño
// 2026-09-30). A un servicio se le avisa por su hook de limpieza.
func (h *ComplementsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	c, ok := h.bySlug(w, r)
	if !ok {
		return
	}
	var req deleteComplementRequest
	if err := decodeJSON(w, r, &req); err != nil || strings.TrimSpace(req.Confirmation) != c.Slug {
		problemdetails.Write(w, r, http.StatusBadRequest, "confirmation-mismatch", "escribe el identificador del complemento para confirmar")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	if h.DeleteLimiter != nil && !h.DeleteLimiter.Allow("complement-delete:"+user.ID.String()) {
		problemdetails.WriteRateLimited(w, r, 3600, "máximo 3 eliminaciones de complementos por hora")
		return
	}
	entries, _ := h.Queries.CountComplementEntries(r.Context(), pgtype.UUID{Bytes: c.ID, Valid: true})
	files, _ := h.Queries.CountComplementFiles(r.Context(), c.ID)
	cleanup := ""
	if c.SourceType == db.ComplementSourceManual {
		cleanup = h.callCleanup(r.Context(), c)
	}
	if _, err := h.Queries.DeleteComplement(r.Context(), c.ID); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el complemento")
		return
	}
	h.Breaker.Forget(c.Slug)
	h.AuditLog.Log(r.Context(), "complement.deleted", audit.LevelWarn, audit.Success(), map[string]any{
		"slug": c.Slug, "name": c.Name, "unlinkedEntries": entries, "deletedFiles": files, "cleanupHook": cleanup,
	})
	writeData(w, http.StatusOK, map[string]any{"unlinkedEntries": entries, "deletedFiles": files, "cleanupHook": cleanup})
}

// callCleanup avisa al servicio que se va (POST /hook/cleanup del legacy).
// No bloquea la eliminación: devuelve cómo le fue, para la auditoría.
func (h *ComplementsHandler) callCleanup(ctx context.Context, c db.Complement) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceBase(c)+"/hook/cleanup", nil)
	if err != nil {
		return "error"
	}
	resp, err := h.httpClient().Do(req)
	if err != nil {
		return "sin respuesta"
	}
	_ = resp.Body.Close()
	return resp.Status
}

// ===== Usuarios =====

// visibleTo aplica la visibilidad: sin roles ni grupos marcados lo ven
// todos; si no, basta un rol o un grupo. El admin ve todos.
func visibleTo(c db.Complement, role string, groups map[uuid.UUID]bool) bool {
	if role == "admin" || (len(c.VisibleRoles) == 0 && len(c.VisiblePermissionGroupIds) == 0) {
		return true
	}
	if slices.Contains(c.VisibleRoles, role) {
		return true
	}
	for _, g := range c.VisiblePermissionGroupIds {
		if groups[g] {
			return true
		}
	}
	return false
}

func (h *ComplementsHandler) userGroups(ctx context.Context, userID uuid.UUID) map[uuid.UUID]bool {
	out := map[uuid.UUID]bool{}
	groups, err := h.Queries.ListUserPermissionGroups(ctx, userID)
	if err != nil {
		return out
	}
	for _, g := range groups {
		out[g.ID] = true
	}
	return out
}

type activeComplementDTO struct {
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	Icon       string `json:"icon"`
	Status     string `json:"status"`
	SourceType string `json:"sourceType"`
	Circuit    string `json:"circuit"`
}

// Active alimenta el menú: los complementos que este usuario ve.
func (h *ComplementsHandler) Active(w http.ResponseWriter, r *http.Request) {
	user, _ := middleware.UserFromContext(r.Context())
	list, err := h.Queries.ListVisibleComplementCandidates(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los complementos")
		return
	}
	groups := h.userGroups(r.Context(), user.ID)
	out := []activeComplementDTO{}
	for _, c := range list {
		if !visibleTo(c, user.Role, groups) {
			continue
		}
		dto := activeComplementDTO{Slug: c.Slug, Name: c.Name, Icon: c.Icon, Status: string(c.Status), SourceType: string(c.SourceType), Circuit: complements.CircuitClosed}
		if c.SourceType == db.ComplementSourceManual {
			dto.Circuit, _ = h.Breaker.State(c.Slug)
		}
		out = append(out, dto)
	}
	writeData(w, http.StatusOK, out)
}

// visibleComplement lee el complemento de la ruta y exige que el usuario
// lo vea y que esté activo.
func (h *ComplementsHandler) visibleComplement(w http.ResponseWriter, r *http.Request) (db.Complement, middleware.AuthenticatedUser, bool) {
	user, _ := middleware.UserFromContext(r.Context())
	c, ok := h.bySlug(w, r)
	if !ok {
		return db.Complement{}, user, false
	}
	if c.Status == db.ComplementStatusDisabled || !visibleTo(c, user.Role, h.userGroups(r.Context(), user.ID)) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "complemento no encontrado")
		return db.Complement{}, user, false
	}
	if c.Status == db.ComplementStatusMaintenance {
		problemdetails.Write(w, r, http.StatusConflict, "maintenance", "el complemento está en mantenimiento")
		return db.Complement{}, user, false
	}
	return c, user, true
}

// Embed entrega la dirección del iframe: para un estático, un enlace de un
// solo uso al origen aislado; para un servicio, su propia dirección.
func (h *ComplementsHandler) Embed(w http.ResponseWriter, r *http.Request) {
	c, user, ok := h.visibleComplement(w, r)
	if !ok {
		return
	}
	if c.SourceType == db.ComplementSourceManual {
		if state, _ := h.Breaker.State(c.Slug); state == complements.CircuitOpen {
			problemdetails.Write(w, r, http.StatusServiceUnavailable, "circuit-open", "el servicio del complemento no responde")
			return
		}
		target := c.BaseUrl.String + c.EntryPath
		h.AuditLog.Log(r.Context(), "complement.opened", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug})
		writeData(w, http.StatusOK, map[string]string{"url": target, "origin": complements.Origin(target)})
		return
	}
	ticket, _ := h.Signer.Issue(complements.KindEmbed, c.Slug, user.ID, user.Role, complements.EmbedTTL)
	h.AuditLog.Log(r.Context(), "complement.opened", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug})
	writeData(w, http.StatusOK, map[string]string{
		// Con el archivo de entrada explícito: hay complementos del legacy que
		// sacan su slug de la dirección (/c/<slug>/index.html).
		"url":    strings.TrimRight(h.OriginURL, "/") + "/c/" + c.Slug + "/" + c.EntryPath + "?embed=" + url.QueryEscape(ticket),
		"origin": complements.Origin(h.OriginURL),
	})
}

type complementEntryRequest struct {
	Content   string   `json:"content"`
	EntryType string   `json:"entryType"`
	Tags      []string `json:"tags"`
}

// CreateEntry atiende el mensaje CREATE_ENTRY del iframe: la app crea la
// entrada con la sesión del usuario y la marca como del complemento.
func (h *ComplementsHandler) CreateEntry(w http.ResponseWriter, r *http.Request) {
	c, user, ok := h.visibleComplement(w, r)
	if !ok {
		return
	}
	var req complementEntryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	entry, reason, err := createComplementEntry(r.Context(), h.Queries, c, user.ID, req)
	if reason != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", reason)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear la entrada")
		return
	}
	h.AuditLog.Log(r.Context(), "complement.entry.created", audit.LevelInfo, audit.Success(), map[string]any{"slug": c.Slug, "entryId": entry.ID.String(), "via": "iframe"})
	writeData(w, http.StatusCreated, map[string]any{"id": entry.ID, "createdAt": entry.CreatedAt.Time})
}

// createComplementEntry valida y crea una entrada marcada con el complemento.
func createComplementEntry(ctx context.Context, q *db.Queries, c db.Complement, userID uuid.UUID, req complementEntryRequest) (db.Entry, string, error) {
	content := strings.TrimSpace(req.Content)
	if content == "" || len([]rune(content)) > 20000 {
		return db.Entry{}, "el contenido es obligatorio (máximo 20000 caracteres)", nil
	}
	entryType := db.EntryTypeOperativa
	switch strings.TrimSpace(req.EntryType) {
	case "", "operativa":
	case "incidente":
		entryType = db.EntryTypeIncidente
	default:
		return db.Entry{}, "entryType debe ser operativa o incidente", nil
	}
	tags := make([]string, 0, len(req.Tags))
	for _, t := range req.Tags {
		if t = strings.TrimSpace(t); t != "" && len(tags) < 20 && len(t) <= 60 {
			tags = append(tags, t)
		}
	}
	entry, err := q.CreateComplementEntry(ctx, db.CreateComplementEntryParams{
		UserID: userID, EntryType: entryType, Scope: db.EntryScopeGeneral, Content: content, Tags: tags,
		OwnerComplementID: pgtype.UUID{Bytes: c.ID, Valid: true}, OwnerComplementName: pgtype.Text{String: c.Name, Valid: true},
	})
	return entry, "", err
}

// ===== Validaciones =====

func cleanHosts(in []string) ([]string, string) {
	out := []string{}
	for _, raw := range in {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		o, ok := complements.NormalizeHost(raw)
		if !ok {
			return nil, "sitio externo inválido: " + raw + " (usa https://dominio, sin comodines)"
		}
		if !slices.Contains(out, o) {
			out = append(out, o)
		}
	}
	if len(out) > 20 {
		return nil, "máximo 20 sitios externos"
	}
	return out, ""
}

func cleanRoles(in []string) ([]string, string) {
	out := []string{}
	for _, r := range in {
		switch db.UserRole(r) {
		case db.UserRoleAdmin, db.UserRoleUser, db.UserRoleAuditor, db.UserRoleGuest:
			if !slices.Contains(out, r) {
				out = append(out, r)
			}
		default:
			return nil, "rol inválido: " + r
		}
	}
	return out, ""
}

func cleanList(in, allowed []string, what string) ([]string, string) {
	out := []string{}
	for _, v := range in {
		if v == "auditlogs" {
			v = "audit_log" // nombre del legacy
		}
		if !slices.Contains(allowed, v) {
			return nil, what + " inválido: " + v
		}
		if !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out, ""
}

func validServiceURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func optText(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	return pgtype.Text{String: s, Valid: s != ""}
}

func iconOr(icon, fallback string) string {
	icon = strings.TrimSpace(icon)
	if icon == "" || len(icon) > 40 || strings.ContainsAny(icon, " <>\"'") {
		return fallback
	}
	return icon
}

func nonNilUUIDs(in []uuid.UUID) []uuid.UUID {
	if in == nil {
		return []uuid.UUID{}
	}
	return in
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
