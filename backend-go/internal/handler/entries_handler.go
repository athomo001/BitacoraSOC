package handler

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultEntriesPageSize = 50
	maxEntriesPageSize     = 200
	maxImageBytes          = 5 * 1024 * 1024 // mismo límite que chk_attachment_size en el esquema
	attachmentURLPrefix    = "/api/attachments/"
)

// EntriesHandler es la Bitácora — registro operativo central (Fase 9,
// spec/04-contratos-api.md sección "Bitácora y Trazabilidad Operativa",
// HU-7 y siguientes). Alcance recortado a lo que pide la Fase 9 en
// spec/02-alcance-y-roadmap.md: sin sinergia de ticketing (createTicket/
// ticketNumber/assignedTeamId, Fase 10) ni GLPI (Backlog Post-Corte). Núcleo
// siempre activo, sin gate SOC/NOC — `scope` es un dato, no un permiso.
type EntriesHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	Tickets  *TicketsHandler
	AuditLog *audit.Logger
	Now      func() time.Time
}

func (h *EntriesHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func attachmentURL(id uuid.UUID) string {
	return attachmentURLPrefix + id.String()
}

func attachmentIDFromURL(raw string) (uuid.UUID, bool) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, attachmentURLPrefix) {
		return uuid.UUID{}, false
	}
	id, err := uuid.Parse(strings.TrimPrefix(raw, attachmentURLPrefix))
	if err != nil {
		return uuid.UUID{}, false
	}
	return id, true
}

// ===== DTOs =====

type entryDTO struct {
	ID             uuid.UUID  `json:"id"`
	AuthorUsername string     `json:"authorUsername"`
	EntryType      string     `json:"entryType"`
	Scope          string     `json:"scope"`
	Content        string     `json:"content"`
	Tags           []string   `json:"tags"`
	ServiceID      *uuid.UUID `json:"serviceId,omitempty"`
	AssetID        *uuid.UUID `json:"assetId,omitempty"`
	ImageURL       *string    `json:"imageUrl,omitempty"`
	ImageHash      *string    `json:"imageHash,omitempty"`
	ImageSizeBytes *int32     `json:"imageSizeBytes,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

func int4Ptr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	return &v.Int32
}

func toEntryDTO(e db.Entry, authorUsername string) entryDTO {
	dto := entryDTO{
		ID: e.ID, AuthorUsername: authorUsername, EntryType: string(e.EntryType), Scope: string(e.Scope),
		Content: e.Content, Tags: e.Tags, ServiceID: uuidPtr(e.ServiceID), AssetID: uuidPtr(e.AssetID),
		ImageURL: textPtr(e.ImageUrl), ImageHash: textPtr(e.ImageHash), ImageSizeBytes: int4Ptr(e.ImageSizeBytes),
	}
	if e.CreatedAt.Valid {
		dto.CreatedAt = e.CreatedAt.Time
	}
	if e.UpdatedAt.Valid {
		dto.UpdatedAt = e.UpdatedAt.Time
	}
	return dto
}

func entryFromRow(row db.GetEntryRow) db.Entry {
	return db.Entry{ID: row.ID, UserID: row.UserID, EntryType: row.EntryType, Scope: row.Scope, Content: row.Content, Tags: row.Tags, ServiceID: row.ServiceID, AssetID: row.AssetID, WorkShiftID: row.WorkShiftID, GlpiTicketID: row.GlpiTicketID, GlpiLinkedAt: row.GlpiLinkedAt, TicketID: row.TicketID, ImageUrl: row.ImageUrl, ImageHash: row.ImageHash, ImageSizeBytes: row.ImageSizeBytes, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

type entryCommentDTO struct {
	ID                uuid.UUID `json:"id"`
	EntryID           uuid.UUID `json:"entryId"`
	AuthorUsername    string    `json:"authorUsername"`
	Comment           string    `json:"comment"`
	IsSystemGenerated bool      `json:"isSystemGenerated"`
	CreatedAt         time.Time `json:"createdAt"`
}

type entryDetailDTO struct {
	entryDTO
	Comments []entryCommentDTO `json:"comments"`
}

// ===== Listar =====

type entryFilters struct {
	Scope     db.NullEntryScope
	EntryType db.NullEntryType
	Tag       pgtype.Text
	FromDate  pgtype.Timestamptz
	ToDate    pgtype.Timestamptz
	Q         pgtype.Text
}

func parseEntryFilters(r *http.Request) (entryFilters, error) {
	q := r.URL.Query()
	var f entryFilters
	if v := q.Get("scope"); v != "" {
		f.Scope = db.NullEntryScope{EntryScope: db.EntryScope(v), Valid: true}
	}
	if v := q.Get("type"); v != "" {
		f.EntryType = db.NullEntryType{EntryType: db.EntryType(v), Valid: true}
	}
	f.Tag = queryText(q.Get("tag"))
	f.Q = queryText(q.Get("q"))
	if v := q.Get("from"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return f, err
		}
		f.FromDate = pgtype.Timestamptz{Time: t, Valid: true}
	}
	if v := q.Get("to"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return f, err
		}
		f.ToDate = pgtype.Timestamptz{Time: t.AddDate(0, 0, 1), Valid: true} // "hasta" inclusivo del día completo
	}
	return f, nil
}

func (h *EntriesHandler) List(w http.ResponseWriter, r *http.Request) {
	f, err := parseEntryFilters(r)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "from/to deben tener formato YYYY-MM-DD")
		return
	}
	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	pageSize := parsePositiveInt(r.URL.Query().Get("pageSize"), defaultEntriesPageSize)
	if pageSize > maxEntriesPageSize {
		pageSize = maxEntriesPageSize
	}
	ctx := r.Context()
	rows, err := h.Queries.ListEntries(ctx, db.ListEntriesParams{
		Scope: f.Scope, EntryType: f.EntryType, Tag: f.Tag, FromDate: f.FromDate, ToDate: f.ToDate, Q: f.Q,
		PageSize: int32(pageSize), PageOffset: int32((page - 1) * pageSize),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar las entradas")
		return
	}
	total, err := h.Queries.CountEntries(ctx, db.CountEntriesParams{
		Scope: f.Scope, EntryType: f.EntryType, Tag: f.Tag, FromDate: f.FromDate, ToDate: f.ToDate, Q: f.Q,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron contar las entradas")
		return
	}
	items := make([]entryDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, toEntryDTO(db.Entry{
			ID: row.ID, UserID: row.UserID, EntryType: row.EntryType, Scope: row.Scope, Content: row.Content, Tags: row.Tags,
			ServiceID: row.ServiceID, AssetID: row.AssetID, ImageUrl: row.ImageUrl, ImageHash: row.ImageHash,
			ImageSizeBytes: row.ImageSizeBytes, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		}, row.AuthorUsername))
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// ===== Crear =====

type createEntryRequest struct {
	EntryType      string     `json:"entryType"`
	Scope          string     `json:"scope"`
	Content        string     `json:"content"`
	Tags           []string   `json:"tags"`
	ServiceID      *uuid.UUID `json:"serviceId,omitempty"`
	AssetID        *uuid.UUID `json:"assetId,omitempty"`
	ImageURL       *string    `json:"imageUrl,omitempty"`
	CreateTicket   bool       `json:"createTicket,omitempty"`
	TicketType     string     `json:"ticketType,omitempty"`
	AssignedTeamID *uuid.UUID `json:"assignedTeamId,omitempty"`
	ClientID       *uuid.UUID `json:"clientId,omitempty"`
	TicketNumber   string     `json:"ticketNumber,omitempty"`
	// Impacto/urgencia del ticket nuevo; si faltan, medium/medium.
	Impact  string `json:"impact,omitempty"`
	Urgency string `json:"urgency,omitempty"`
}

func validEntryType(t string) bool {
	switch db.EntryType(t) {
	case db.EntryTypeOperativa, db.EntryTypeIncidente, db.EntryTypeOfensa:
		return true
	}
	return false
}

// ===== Leer =====

func (h *EntriesHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	ctx := r.Context()
	row, err := h.Queries.GetEntry(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	commentRows, err := h.Queries.ListEntryComments(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron cargar los comentarios")
		return
	}
	comments := make([]entryCommentDTO, 0, len(commentRows))
	for _, c := range commentRows {
		comment := entryCommentDTO{ID: c.ID, EntryID: c.EntryID, AuthorUsername: c.AuthorUsername, Comment: c.Comment, IsSystemGenerated: c.IsSystemGenerated}
		if c.CreatedAt.Valid {
			comment.CreatedAt = c.CreatedAt.Time
		}
		comments = append(comments, comment)
	}
	entry := db.Entry{
		ID: row.ID, UserID: row.UserID, EntryType: row.EntryType, Scope: row.Scope, Content: row.Content, Tags: row.Tags,
		ServiceID: row.ServiceID, AssetID: row.AssetID, ImageUrl: row.ImageUrl, ImageHash: row.ImageHash,
		ImageSizeBytes: row.ImageSizeBytes, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	writeData(w, http.StatusOK, entryDetailDTO{entryDTO: toEntryDTO(entry, row.AuthorUsername), Comments: comments})
}

// ===== Editar =====

type patchEntryRequest struct {
	Scope     *string    `json:"scope,omitempty"`
	Content   *string    `json:"content,omitempty"`
	Tags      []string   `json:"tags,omitempty"`
	ServiceID *uuid.UUID `json:"serviceId,omitempty"`
	AssetID   *uuid.UUID `json:"assetId,omitempty"`
}

func (h *EntriesHandler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	ctx := r.Context()
	existing, err := h.Queries.GetEntry(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	if existing.UserID != user.ID && user.Role != "admin" {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "solo el autor o un admin pueden editar esta entrada")
		return
	}
	var req patchEntryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	var scope db.NullEntryScope
	if req.Scope != nil {
		scope = db.NullEntryScope{EntryScope: db.EntryScope(*req.Scope), Valid: true}
	}
	entry, err := h.Queries.PatchEntry(ctx, db.PatchEntryParams{
		ID: id, Scope: scope, Content: nonEmptyText(req.Content), Tags: req.Tags,
		ServiceID: optionalUUID(req.ServiceID), AssetID: optionalUUID(req.AssetID),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar la entrada")
		return
	}
	h.AuditLog.Log(ctx, "entry.updated", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entry.ID.String()})
	author := existing.AuthorUsername
	if user.ID == existing.UserID {
		author = user.Username
	}
	writeData(w, http.StatusOK, toEntryDTO(entry, author))
}

// ===== Borrar =====

func (h *EntriesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	ctx := r.Context()
	existing, err := h.Queries.GetEntry(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	if existing.UserID != user.ID && user.Role != "admin" {
		problemdetails.Write(w, r, http.StatusForbidden, "forbidden", "solo el autor o un admin pueden borrar esta entrada")
		return
	}
	deleted, err := h.Queries.DeleteEntry(ctx, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar la entrada")
		return
	}
	// Borrado real (HU-7g): no queda soft-delete, pero la auditoría sí es
	// inmutable — el snapshot del contenido queda en metadata como evidencia
	// de qué se borró y quién lo hizo.
	h.AuditLog.Log(ctx, "entry.deleted", audit.LevelWarn, audit.Success(), map[string]any{
		"entryId": deleted.ID.String(), "entryType": string(deleted.EntryType), "scope": string(deleted.Scope),
		"contentSnapshot": deleted.Content, "tags": deleted.Tags,
	})
	writeNoContent(w)
}

// ===== Reclasificación masiva (admin) =====

type bulkPatchEntriesRequest struct {
	EntryIDs []uuid.UUID `json:"entryIds"`
	Scope    *string     `json:"scope,omitempty"`
	Tags     []string    `json:"tags,omitempty"`
}

func (h *EntriesHandler) BulkPatch(w http.ResponseWriter, r *http.Request) {
	var req bulkPatchEntriesRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if len(req.EntryIDs) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "entryIds vacío")
		return
	}
	var scope db.NullEntryScope
	if req.Scope != nil {
		scope = db.NullEntryScope{EntryScope: db.EntryScope(*req.Scope), Valid: true}
	}
	ctx := r.Context()
	updated, err := h.Queries.BulkPatchEntries(ctx, db.BulkPatchEntriesParams{Ids: req.EntryIDs, Scope: scope, Tags: req.Tags})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo reclasificar el lote")
		return
	}
	ids := make([]string, 0, len(req.EntryIDs))
	for _, id := range req.EntryIDs {
		ids = append(ids, id.String())
	}
	h.AuditLog.Log(ctx, "entry.bulk_patched", audit.LevelInfo, audit.Success(), map[string]any{"entryIds": ids, "updatedCount": updated})
	writeData(w, http.StatusOK, map[string]any{"updatedCount": updated})
}

// ===== Exportar a CSV =====

func (h *EntriesHandler) Export(w http.ResponseWriter, r *http.Request) {
	f, err := parseEntryFilters(r)
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-query", "from/to deben tener formato YYYY-MM-DD")
		return
	}
	ctx := r.Context()
	rows, err := h.Queries.ListEntriesForExport(ctx, db.ListEntriesForExportParams{
		Scope: f.Scope, EntryType: f.EntryType, Tag: f.Tag, FromDate: f.FromDate, ToDate: f.ToDate, Q: f.Q,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo exportar")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="entries.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"fecha", "autor", "tipo", "ambito", "tags", "contenido"})
	for _, row := range rows {
		createdAt := ""
		if row.CreatedAt.Valid {
			createdAt = row.CreatedAt.Time.Format(time.RFC3339)
		}
		_ = writer.Write([]string{createdAt, row.AuthorUsername, string(row.EntryType), string(row.Scope), strings.Join(row.Tags, "|"), row.Content})
	}
	writer.Flush()
	h.AuditLog.Log(ctx, "entry.export", audit.LevelInfo, audit.Success(), map[string]any{"rows": len(rows)})
}

// ===== Comentarios (HU-7c) =====

type createCommentRequest struct {
	Comment      string `json:"comment"`
	SyncToTicket bool   `json:"syncToTicket"`
}

func (h *EntriesHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	entryID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	var req createCommentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.Comment = strings.TrimSpace(req.Comment)
	if req.Comment == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "comment vacío")
		return
	}
	ctx := r.Context()
	entry, err := h.Queries.GetEntry(ctx, entryID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "entrada no encontrada")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	comment, err := h.Queries.CreateEntryComment(ctx, db.CreateEntryCommentParams{EntryID: entryID, UserID: user.ID, Comment: req.Comment, IsSystemGenerated: false})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo agregar el comentario")
		return
	}
	if req.SyncToTicket && entry.TicketID.Valid && h.Tickets != nil {
		if err := h.Tickets.AddEntryCommentToTicket(ctx, uuid.UUID(entry.TicketID.Bytes), user, req.Comment, false); err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo sincronizar el comentario con el ticket")
			return
		}
	}
	h.AuditLog.Log(ctx, "entry.comment_added", audit.LevelInfo, audit.Success(), map[string]any{"entryId": entryID.String(), "commentId": comment.ID.String()})
	dto := entryCommentDTO{ID: comment.ID, EntryID: comment.EntryID, AuthorUsername: user.Username, Comment: comment.Comment, IsSystemGenerated: comment.IsSystemGenerated}
	if comment.CreatedAt.Valid {
		dto.CreatedAt = comment.CreatedAt.Time
	}
	writeData(w, http.StatusCreated, dto)
}

// ===== Imagen simple (versión sin WebP/EXIF, ver spec/00-mapa-mental.md) =====

var allowedImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true}

type uploadImageResponse struct {
	ImageURL  string `json:"imageUrl"`
	ImageHash string `json:"imageHash"`
	SizeBytes int32  `json:"sizeBytes"`
}

// UploadImage guarda la imagen tal cual se subió (sin conversión a WebP ni
// limpieza de metadatos EXIF — decisión de esta fase, ver
// spec/00-mapa-mental.md) directamente en Postgres (entry_attachments,
// migración 000005: entry_id NULL hasta que POST /api/entries la reclama) —
// nunca en el sistema de archivos local (spec/09-alta-disponibilidad-2-
// nodos.md).
func (h *EntriesHandler) UploadImage(w http.ResponseWriter, r *http.Request) {
	img, ok := readImageUpload(w, r)
	if !ok {
		return
	}
	raw, mimeType, hash, fileName := img.data, img.mime, img.hash, img.name

	ctx := r.Context()
	attachment, err := h.Queries.CreateOrphanAttachment(ctx, db.CreateOrphanAttachmentParams{
		FileName: fileName, MimeType: mimeType, SizeBytes: int32(len(raw)), FileData: raw, HashSha256: hash,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la imagen")
		return
	}
	h.AuditLog.Log(ctx, "entry.image_uploaded", audit.LevelInfo, audit.Success(), map[string]any{"attachmentId": attachment.ID.String(), "sizeBytes": attachment.SizeBytes})
	writeData(w, http.StatusCreated, uploadImageResponse{ImageURL: attachmentURL(attachment.ID), ImageHash: attachment.HashSha256, SizeBytes: attachment.SizeBytes})
}

// ServeAttachment es GET /api/attachments/{id} — sirve la imagen esté o no
// todavía reclamada por una entrada (variante mínima de la ruta general
// /api/entries/:id/attachments/:attachmentId del contrato, que es para el
// sistema de evidencias múltiples — fuera de alcance de esta fase).
func (h *EntriesHandler) ServeAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "adjunto no encontrado")
		return
	}
	attachment, err := h.Queries.GetAttachment(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problemdetails.Write(w, r, http.StatusNotFound, "not-found", "adjunto no encontrado")
			return
		}
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el adjunto")
		return
	}
	w.Header().Set("Content-Type", attachment.MimeType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(attachment.FileData)
}

// uploadedImage es una imagen ya validada (tipo real, tamaño, hash).
type uploadedImage struct {
	data []byte
	mime string
	hash string
	name string
}

// readImageUpload lee el campo multipart "image" con los límites de la app
// (5 MB, png/jpg/webp por el contenido, no por la extensión). Si algo falla
// ya respondió el error y devuelve false. Lo usan la bitácora y los tickets.
func readImageUpload(w http.ResponseWriter, r *http.Request) (uploadedImage, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+64<<10)
	if err := r.ParseMultipartForm(maxImageBytes); err != nil {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "payload-too-large", "la imagen supera el límite permitido (5MB)")
		return uploadedImage{}, false
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "falta la imagen en el campo 'image'")
		return uploadedImage{}, false
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxImageBytes+1))
	if err != nil || len(raw) > maxImageBytes {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "payload-too-large", "la imagen supera el límite permitido (5MB)")
		return uploadedImage{}, false
	}
	mimeType := http.DetectContentType(raw)
	if !allowedImageTypes[mimeType] {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "formato no soportado (solo png/jpg/webp)")
		return uploadedImage{}, false
	}
	sum := sha256.Sum256(raw)
	name := header.Filename
	if name == "" {
		name = "imagen"
	}
	return uploadedImage{data: raw, mime: mimeType, hash: hex.EncodeToString(sum[:]), name: name}, true
}
