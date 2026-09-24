package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/backup"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BackupsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	mu       sync.Mutex
}

func (h *BackupsHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.mu.TryLock() {
		problemdetails.Write(w, r, 409, "backup-running", "ya hay un backup en ejecución")
		return
	}
	defer h.mu.Unlock()
	var req struct {
		Passphrase string `json:"passphrase"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	if req.Passphrase == "" {
		req.Passphrase = os.Getenv("BACKUP_PASSPHRASE")
	}
	if req.Passphrase == "" {
		problemdetails.Write(w, r, 400, "invalid-payload", "passphrase no configurada")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	run, err := h.Queries.CreateBackupRun(r.Context(), db.CreateBackupRunParams{Kind: db.BackupKindFull, TriggeredBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo registrar el backup")
		return
	}
	tx, err := h.Pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo abrir el snapshot")
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name`)
	if err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudieron enumerar las tablas")
		return
	}
	var tableNames []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			_ = h.fail(r, run.ID, err)
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer el catálogo de tablas")
			return
		}
		tableNames = append(tableNames, name)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "falló el snapshot")
		return
	}
	tables := map[string]json.RawMessage{}
	records := 0
	for _, name := range tableNames {
		identifier := `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
		var rawPayload any
		if err = tx.QueryRow(r.Context(), `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM `+identifier+` t`).Scan(&rawPayload); err != nil {
			_ = h.fail(r, run.ID, err)
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo serializar la tabla "+name+": "+err.Error())
			return
		}
		var payload []byte
		switch value := rawPayload.(type) {
		case []byte:
			payload = value
		case json.RawMessage:
			payload = []byte(value)
		case string:
			payload = []byte(value)
		case nil:
			payload = []byte("[]")
		default:
			payload = []byte(fmt.Sprint(value))
		}
		if !json.Valid(payload) {
			_ = h.fail(r, run.ID, fmt.Errorf("tabla %s devolvió JSON inválido", name))
			problemdetails.Write(w, r, 500, "internal-error", "la tabla "+name+" devolvió JSON inválido")
			return
		}
		tables[name] = json.RawMessage(payload)
		var list []json.RawMessage
		_ = json.Unmarshal(payload, &list)
		records += len(list)
	}
	if err = tx.Commit(r.Context()); err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el snapshot")
		return
	}
	data, err := backup.Encode(backup.Envelope{Version: 1, Kind: "full", Tables: tables}, req.Passphrase)
	if err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo comprimir/cifrar el backup: "+err.Error())
		return
	}
	sum := sha256.Sum256(data)
	dir := os.Getenv("BACKUP_DIR")
	if dir == "" {
		dir = "backups"
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear el directorio de backups")
		return
	}
	path := filepath.Join(dir, run.ID.String()+".full.zst.enc")
	if err = os.WriteFile(path, data, 0600); err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar el backup")
		return
	}
	info, _ := os.Stat(path)
	marked, err := h.Queries.MarkBackupRun(r.Context(), db.MarkBackupRunParams{ID: run.ID, RecordsCount: int32(records), Status: "success", FilePath: pgtype.Text{String: path, Valid: true}, FileSizeBytes: pgtype.Int8{Int64: info.Size(), Valid: true}, ChecksumSha256: pgtype.Text{String: hex.EncodeToString(sum[:]), Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo finalizar metadata")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "backup.created", audit.LevelInfo, audit.Success(), map[string]any{"backupId": run.ID.String(), "kind": "full", "records": records})
	}
	writeData(w, 201, map[string]any{"backupRunId": marked.ID, "filename": filepath.Base(path), "fileSize": info.Size(), "recordsCount": records, "checksumSha256": hex.EncodeToString(sum[:])})
}

func (h *BackupsHandler) fail(r *http.Request, id uuid.UUID, err error) error {
	_, e := h.Queries.MarkBackupRun(r.Context(), db.MarkBackupRunParams{ID: id, Status: "failed", ErrorMessage: pgtype.Text{String: err.Error(), Valid: true}})
	return e
}

func (h *BackupsHandler) History(w http.ResponseWriter, r *http.Request) {
	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	size := parsePositiveInt(r.URL.Query().Get("pageSize"), 50)
	kind := db.NullBackupKind{}
	if raw := r.URL.Query().Get("kind"); raw != "" {
		kind = db.NullBackupKind{BackupKind: db.BackupKind(raw), Valid: true}
	}
	items, err := h.Queries.ListBackupRuns(r.Context(), db.ListBackupRunsParams{Kind: kind, Limit: int32(size), Offset: int32((page - 1) * size)})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo listar backups")
		return
	}
	total, _ := h.Queries.CountBackupRuns(r.Context(), kind)
	writeData(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": size})
}

func (h *BackupsHandler) Download(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "backup no encontrado")
		return
	}
	run, err := h.Queries.GetBackupRun(r.Context(), id)
	if err != nil || !run.FilePath.Valid {
		problemdetails.Write(w, r, 404, "not-found", "backup no encontrado")
		return
	}
	file, err := os.Open(run.FilePath.String)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "archivo de backup no encontrado")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(run.FilePath.String)+`"`)
	_, _ = io.Copy(w, file)
}

func (h *BackupsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "backup no encontrado")
		return
	}
	run, err := h.Queries.DeleteBackupRun(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "backup no encontrado")
		return
	}
	if run.FilePath.Valid {
		_ = os.Remove(run.FilePath.String)
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "backup.deleted", audit.LevelWarn, audit.Success(), map[string]any{"backupId": id.String()})
	}
	writeNoContent(w)
}
