package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/backup"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Respaldos (Fase 13) al nivel del legacy, con las mejoras del rewrite —
// pantalla aprobada "Administración: Respaldos": programación automática con
// retención y destino, historial con restaurar (unir o reemplazar), subir una
// copia, CSV y purga detrás del interruptor "Permitir purga".
type BackupsHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	AuditLog *audit.Logger
	Crypto   *crypto.Box
	Service  *backup.Service
	// AfterPurge recrea el admin del .env (si está configurado) tras purgar.
	AfterPurge func(ctx context.Context)
}

type backupRunDTO struct {
	ID             uuid.UUID  `json:"id"`
	Kind           string     `json:"kind"`
	TriggerSource  string     `json:"triggerSource"`
	Status         string     `json:"status"`
	StartedAt      time.Time  `json:"startedAt"`
	FinishedAt     *time.Time `json:"finishedAt"`
	RecordsCount   int32      `json:"recordsCount"`
	FileSizeBytes  *int64     `json:"fileSizeBytes"`
	ChecksumSha256 *string    `json:"checksumSha256"`
	WindowFrom     *time.Time `json:"windowFrom"`
	WindowTo       *time.Time `json:"windowTo"`
	ErrorMessage   *string    `json:"errorMessage"`
	// NeedsPassphrase: se hizo con frase (hay que escribirla para abrirlo);
	// false = sin frase, lo abre esta instalación sola.
	NeedsPassphrase bool `json:"needsPassphrase"`
}

// needsPassphrase mira la cabecera del archivo (unos bytes, sin leerlo entero).
func needsPassphrase(r db.BackupRun) bool {
	if !r.FilePath.Valid {
		return true
	}
	f, err := os.Open(r.FilePath.String)
	if err != nil {
		return true
	}
	defer f.Close()
	head := make([]byte, 32)
	n, _ := io.ReadFull(f, head)
	return backup.NeedsPassphrase(head[:n])
}

func toBackupRunDTO(r db.BackupRun) backupRunDTO {
	d := backupRunDTO{
		ID: r.ID, Kind: string(r.Kind), TriggerSource: r.TriggerSource, Status: r.Status, StartedAt: r.StartedAt.Time,
		FinishedAt: timestamptzPtr(r.FinishedAt), RecordsCount: r.RecordsCount, ChecksumSha256: textPtr(r.ChecksumSha256),
		WindowFrom: timestamptzPtr(r.WindowFrom), WindowTo: timestamptzPtr(r.WindowTo), ErrorMessage: textPtr(r.ErrorMessage),
	}
	if r.FileSizeBytes.Valid {
		v := r.FileSizeBytes.Int64
		d.FileSizeBytes = &v
	}
	d.NeedsPassphrase = needsPassphrase(r)
	return d
}

func actorUUID(r *http.Request) pgtype.UUID {
	user, _ := middleware.UserFromContext(r.Context())
	return pgtype.UUID{Bytes: user.ID, Valid: user.ID != uuid.Nil}
}

func (h *BackupsHandler) writeServiceError(w http.ResponseWriter, r *http.Request, err error, fallback string) {
	switch {
	case errors.Is(err, backup.ErrBusy):
		problemdetails.Write(w, r, http.StatusConflict, "backup-running", err.Error())
	case errors.Is(err, backup.ErrChecksum):
		problemdetails.Write(w, r, http.StatusConflict, "checksum-mismatch", err.Error())
	default:
		problemdetails.Write(w, r, http.StatusBadRequest, "backup-failed", fallback+": "+err.Error())
	}
}

// Create es POST /api/backups/create: copia completa manual.
func (h *BackupsHandler) Create(w http.ResponseWriter, r *http.Request) {
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
	if req.Passphrase != "" && len(req.Passphrase) < 8 {
		problemdetails.Write(w, r, 400, "invalid-payload", "la frase de cifrado debe tener al menos 8 caracteres (o déjala vacía)")
		return
	}
	run, err := h.Service.CreateFull(r.Context(), req.Passphrase, "manual", "", actorUUID(r))
	if err != nil {
		h.writeServiceError(w, r, err, "no se pudo crear el respaldo")
		return
	}
	h.AuditLog.Log(r.Context(), "backup.created", audit.LevelInfo, audit.Success(), map[string]any{"backupId": run.ID.String(), "kind": "full", "records": run.RecordsCount})
	writeData(w, 201, toBackupRunDTO(run))
}

func (h *BackupsHandler) History(w http.ResponseWriter, r *http.Request) {
	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	size := parsePositiveInt(r.URL.Query().Get("pageSize"), 50)
	kind := db.NullBackupKind{}
	if raw := r.URL.Query().Get("kind"); raw != "" {
		kind = db.NullBackupKind{BackupKind: db.BackupKind(raw), Valid: true}
	}
	runs, err := h.Queries.ListBackupRuns(r.Context(), db.ListBackupRunsParams{Kind: kind, Limit: int32(size), Offset: int32((page - 1) * size)})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo listar los respaldos")
		return
	}
	total, _ := h.Queries.CountBackupRuns(r.Context(), kind)
	items := make([]backupRunDTO, 0, len(runs))
	for _, run := range runs {
		items = append(items, toBackupRunDTO(run))
	}
	writeData(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": size})
}

func (h *BackupsHandler) runFromPath(w http.ResponseWriter, r *http.Request) (db.BackupRun, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err == nil {
		run, getErr := h.Queries.GetBackupRun(r.Context(), id)
		if getErr == nil {
			return run, true
		}
	}
	problemdetails.Write(w, r, 404, "not-found", "respaldo no encontrado")
	return db.BackupRun{}, false
}

func (h *BackupsHandler) Download(w http.ResponseWriter, r *http.Request) {
	run, ok := h.runFromPath(w, r)
	if !ok {
		return
	}
	if !run.FilePath.Valid {
		problemdetails.Write(w, r, 404, "not-found", "el respaldo no tiene archivo")
		return
	}
	file, err := os.Open(run.FilePath.String)
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "no se encontró el archivo del respaldo en el servidor")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(run.FilePath.String)+`"`)
	_, _ = io.Copy(w, file)
}

func (h *BackupsHandler) Validate(w http.ResponseWriter, r *http.Request) {
	run, ok := h.runFromPath(w, r)
	if !ok {
		return
	}
	var req struct {
		Passphrase string `json:"passphrase"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	data, err := backup.ReadVerified(run)
	if errors.Is(err, backup.ErrChecksum) {
		writeData(w, 200, map[string]any{"valid": false, "checksumMatches": false, "decryptable": false})
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", err.Error())
		return
	}
	envelope, decodeErr := h.Service.OpenData(data, req.Passphrase)
	if errors.Is(decodeErr, backup.ErrPassphraseRequired) {
		problemdetails.Write(w, r, 400, "passphrase-required", "este respaldo se hizo con frase: escríbela")
		return
	}
	if decodeErr != nil {
		writeData(w, 200, map[string]any{"valid": false, "checksumMatches": true, "decryptable": false})
		return
	}
	h.AuditLog.Log(r.Context(), "backup.validated", audit.LevelInfo, audit.Success(), map[string]any{"backupId": run.ID.String()})
	writeData(w, 200, map[string]any{"valid": true, "checksumMatches": true, "decryptable": true, "kind": envelope.Kind, "tables": len(envelope.Tables)})
}

func (h *BackupsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	run, ok := h.runFromPath(w, r)
	if !ok {
		return
	}
	if _, err := h.Queries.DeleteBackupRun(r.Context(), run.ID); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo borrar el respaldo")
		return
	}
	if run.FilePath.Valid {
		_ = os.Remove(run.FilePath.String)
	}
	h.AuditLog.Log(r.Context(), "backup.deleted", audit.LevelWarn, audit.Success(), map[string]any{"backupId": run.ID.String()})
	writeNoContent(w)
}

// fail marca una corrida como fallida (lo usan los deltas).
func (h *BackupsHandler) fail(r *http.Request, id uuid.UUID, err error) error {
	_, e := h.Queries.MarkBackupRun(r.Context(), db.MarkBackupRunParams{ID: id, Status: "failed", ErrorMessage: pgtype.Text{String: err.Error(), Valid: true}})
	return e
}

// ===== Restaurar y subir una copia =====

type restoreRequest struct {
	Passphrase   string `json:"passphrase"`
	Mode         string `json:"mode"`
	Confirmation string `json:"confirmation"`
}

// Restore es POST /api/backups/:id/restore. "replace" exige escribir
// RESTAURAR y toma antes un respaldo de seguridad del estado actual.
func (h *BackupsHandler) Restore(w http.ResponseWriter, r *http.Request) {
	run, ok := h.runFromPath(w, r)
	if !ok {
		return
	}
	var req restoreRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	mode := backup.RestoreMode(req.Mode)
	if mode != backup.Merge && mode != backup.Replace {
		problemdetails.Write(w, r, 400, "invalid-payload", "mode debe ser merge o replace")
		return
	}
	if mode == backup.Replace && req.Confirmation != backup.ReplaceConfirmation {
		problemdetails.Write(w, r, 400, "confirmation-required", "para reemplazar todo escribe "+backup.ReplaceConfirmation)
		return
	}
	result, err := h.Service.Restore(r.Context(), run, req.Passphrase, mode, actorUUID(r))
	if errors.Is(err, backup.ErrPassphraseRequired) {
		problemdetails.Write(w, r, 400, "passphrase-required", "este respaldo se hizo con frase: escríbela")
		return
	}
	if err != nil {
		h.AuditLog.Log(r.Context(), "backup.restore", audit.LevelWarn, audit.Failure(err.Error()), map[string]any{"backupId": run.ID.String(), "mode": req.Mode})
		h.writeServiceError(w, r, err, "no se pudo restaurar")
		return
	}
	h.AuditLog.Log(r.Context(), "backup.restore", audit.LevelWarn, audit.Success(), map[string]any{"backupId": run.ID.String(), "mode": req.Mode, "inserted": result.Inserted, "safetyBackupId": result.SafetyBackup})
	writeData(w, 200, result)
}

// Upload es POST /api/backups/upload: sube una copia (.enc) a este servidor.
// Se descifra con la frase para confirmar que sirve antes de aceptarla; queda
// en el historial como "Subido" y se restaura desde ahí.
func (h *BackupsHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "archivo inválido")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "falta el archivo")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 512<<20))
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo leer el archivo")
		return
	}
	envelope, err := h.Service.OpenData(data, r.FormValue("passphrase"))
	if errors.Is(err, backup.ErrPassphraseRequired) {
		problemdetails.Write(w, r, 400, "passphrase-required", "este respaldo se hizo con frase: escríbela")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "el archivo no es un respaldo válido, la frase no corresponde o es de otra instalación")
		return
	}
	kind := db.BackupKindFull
	if envelope.Kind == "delta" {
		kind = db.BackupKindDelta
	}
	run, err := h.Queries.CreateBackupRunWithSource(r.Context(), db.CreateBackupRunWithSourceParams{Kind: kind, TriggerSource: "upload", TriggeredBy: actorUUID(r)})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo registrar la copia")
		return
	}
	dir := h.Service.LocalDir
	if dir == "" {
		dir = "backups"
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo crear la carpeta de respaldos")
		return
	}
	// La frase se escribe una sola vez (pedido del dueño): lo subido se
	// guarda cifrado con la llave de esta instalación, así restaurarlo no la
	// vuelve a pedir.
	if backup.NeedsPassphrase(data) {
		resealed, err := h.Service.Seal(envelope, "")
		if err != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la copia")
			return
		}
		data = resealed
	}
	path := filepath.Join(dir, run.ID.String()+"."+envelope.Kind+".zst.enc")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la copia")
		return
	}
	records := 0
	for _, t := range envelope.Tables {
		records += countJSONRows(t)
	}
	sum := sha256.Sum256(data)
	marked, err := h.Queries.MarkBackupRun(r.Context(), db.MarkBackupRunParams{ID: run.ID, RecordsCount: int32(records), Status: "success", FilePath: pgtype.Text{String: path, Valid: true}, FileSizeBytes: pgtype.Int8{Int64: int64(len(data)), Valid: true}, ChecksumSha256: pgtype.Text{String: hex.EncodeToString(sum[:]), Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo registrar la copia")
		return
	}
	h.AuditLog.Log(r.Context(), "backup.uploaded", audit.LevelInfo, audit.Success(), map[string]any{"backupId": run.ID.String(), "kind": envelope.Kind})
	writeData(w, 201, toBackupRunDTO(marked))
}

func countJSONRows(raw []byte) int {
	depth, count := 0, 0
	inString, escaped := false, false
	for _, c := range raw {
		switch {
		case escaped:
			escaped = false
		case c == '\\' && inString:
			escaped = true
		case c == '"':
			inString = !inString
		case inString:
		case c == '{':
			if depth == 1 {
				count++
			}
			depth++
		case c == '[':
			depth++
		case c == '}' || c == ']':
			depth--
		}
	}
	return count
}

// ===== Programación automática =====

type backupConfigDTO struct {
	Enabled         bool       `json:"enabled"`
	IntervalDays    int32      `json:"intervalDays"`
	RunAt           string     `json:"runAt"`
	Timezone        string     `json:"timezone"`
	RetentionDays   int32      `json:"retentionDays"`
	DestinationType string     `json:"destinationType"`
	DestinationPath *string    `json:"destinationPath"`
	PassphraseSet   bool       `json:"passphraseSet"`
	NextRunAt       *time.Time `json:"nextRunAt"`
	LastRunAt       *time.Time `json:"lastRunAt"`
	LastStatus      string     `json:"lastStatus"`
	LastMessage     *string    `json:"lastMessage"`
}

func toBackupConfigDTO(c db.BackupConfig) backupConfigDTO {
	minutes := c.RunAt.Microseconds / 60_000_000
	return backupConfigDTO{
		Enabled: c.Enabled, IntervalDays: c.IntervalDays, RunAt: fmt.Sprintf("%02d:%02d", minutes/60, minutes%60), Timezone: c.Timezone,
		RetentionDays: c.RetentionDays, DestinationType: c.DestinationType, DestinationPath: textPtr(c.DestinationPath),
		PassphraseSet: c.PassphraseEncrypted.Valid, NextRunAt: timestamptzPtr(c.NextRunAt), LastRunAt: timestamptzPtr(c.LastRunAt),
		LastStatus: c.LastStatus, LastMessage: textPtr(c.LastMessage),
	}
}

func (h *BackupsHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Queries.GetBackupConfig(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la configuración de respaldos")
		return
	}
	writeData(w, 200, toBackupConfigDTO(cfg))
}

type updateBackupConfigRequest struct {
	Enabled         bool   `json:"enabled"`
	IntervalDays    int32  `json:"intervalDays"`
	RunAt           string `json:"runAt"`
	Timezone        string `json:"timezone"`
	RetentionDays   int32  `json:"retentionDays"`
	DestinationType string `json:"destinationType"`
	DestinationPath string `json:"destinationPath"`
	// Passphrase vacía conserva la guardada; nunca se devuelve.
	Passphrase string `json:"passphrase"`
}

// UpdateConfig es PUT /api/backups/config. Verifica que el destino exista y
// se pueda escribir al guardar, no la noche del respaldo.
func (h *BackupsHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req updateBackupConfigRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "cuerpo inválido")
		return
	}
	runAt, err := time.Parse("15:04", req.RunAt)
	if err != nil || req.IntervalDays < 1 || req.IntervalDays > 365 || req.RetentionDays < 1 || req.RetentionDays > 365 {
		problemdetails.Write(w, r, 400, "invalid-payload", "hora HH:MM, frecuencia y retención entre 1 y 365 días")
		return
	}
	if req.Timezone == "" {
		req.Timezone = "America/Santiago"
	}
	loc, err := time.LoadLocation(req.Timezone)
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "zona horaria desconocida")
		return
	}
	switch req.DestinationType {
	case "local":
		req.DestinationPath = ""
	case "smb", "nfs":
		if strings.TrimSpace(req.DestinationPath) == "" {
			problemdetails.Write(w, r, 400, "invalid-payload", "indica la carpeta de red montada en el servidor")
			return
		}
	default:
		problemdetails.Write(w, r, 400, "invalid-payload", "destino inválido (local, smb o nfs)")
		return
	}
	if _, err := h.Queries.GetBackupConfig(r.Context()); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer la configuración")
		return
	}
	var encrypted pgtype.Text
	if req.Passphrase != "" {
		if len(req.Passphrase) < 8 {
			problemdetails.Write(w, r, 400, "invalid-payload", "la frase de cifrado debe tener al menos 8 caracteres")
			return
		}
		value, encErr := h.Crypto.Encrypt(req.Passphrase)
		if encErr != nil {
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la frase")
			return
		}
		encrypted = pgtype.Text{String: value, Valid: true}
	}
	destination := h.Service.LocalDir
	if req.DestinationType != "local" {
		destination = strings.TrimSpace(req.DestinationPath)
	}
	if req.Enabled {
		if destination == "" {
			destination = "backups"
		}
		// Solo la carpeta local se crea. Una de red debe existir (estar montada):
		// crearla escribiría las copias en el disco local creyendo que van al NAS.
		if req.DestinationType == "local" {
			_ = os.MkdirAll(destination, 0o700)
		}
		if err := backup.CheckWritable(destination); err != nil {
			problemdetails.Write(w, r, 400, "destination-unavailable", err.Error())
			return
		}
	}
	var next pgtype.Timestamptz
	if req.Enabled {
		next = pgtype.Timestamptz{Time: backup.NextRun(time.Now(), backup.Schedule{IntervalDays: int(req.IntervalDays), Hour: runAt.Hour(), Minute: runAt.Minute(), Location: loc}), Valid: true}
	}
	updated, err := h.Queries.UpdateBackupConfig(r.Context(), db.UpdateBackupConfigParams{
		Enabled: req.Enabled, IntervalDays: req.IntervalDays, RunAt: pgtype.Time{Microseconds: int64(runAt.Hour()*3600+runAt.Minute()*60) * 1_000_000, Valid: true},
		Timezone: req.Timezone, RetentionDays: req.RetentionDays, DestinationType: req.DestinationType,
		DestinationPath:     pgtype.Text{String: strings.TrimSpace(req.DestinationPath), Valid: req.DestinationPath != ""},
		PassphraseEncrypted: encrypted, NextRunAt: next, UpdatedBy: actorUUID(r),
	})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar la configuración")
		return
	}
	h.AuditLog.Log(r.Context(), "backup.config.updated", audit.LevelInfo, audit.Success(), map[string]any{"enabled": req.Enabled, "intervalDays": req.IntervalDays, "retentionDays": req.RetentionDays, "destinationType": req.DestinationType, "passphraseChanged": encrypted.Valid})
	writeData(w, 200, toBackupConfigDTO(updated))
}

// RunNow es POST /api/backups/config/run ("Ejecutar prueba ahora"): corre la
// copia automática con la configuración guardada y devuelve cómo terminó.
func (h *BackupsHandler) RunNow(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.RunScheduled(r.Context(), true); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo ejecutar el respaldo automático: "+err.Error())
		return
	}
	cfg, err := h.Queries.GetBackupConfig(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo leer el resultado")
		return
	}
	h.AuditLog.Log(r.Context(), "backup.auto.run_now", audit.LevelInfo, audit.Success(), map[string]any{"status": cfg.LastStatus})
	writeData(w, 200, toBackupConfigDTO(cfg))
}

// ===== Exportar a CSV =====

var csvExports = map[string]struct {
	file   string
	header []string
	query  string
}{
	"entries": {"bitacora.csv", []string{"Fecha", "Autor", "Tipo", "Ámbito", "Contenido", "Tags", "Ticket"}, `
		SELECT to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), u.username, e.entry_type::text, e.scope::text,
		       e.content, array_to_string(e.tags, ', '), COALESCE(t.ticket_number, '')
		FROM entries e JOIN users u ON u.id = e.user_id LEFT JOIN tickets t ON t.id = e.ticket_id ORDER BY e.created_at`},
	"checklists": {"checklists.csv", []string{"Fecha", "Turno", "Momento", "Analista", "Ítem", "Estado", "Calculado", "Observación"}, `
		SELECT to_char(c.check_date AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), ws.name, c.check_type::text, u.username,
		       s.service_title, s.status::text, CASE WHEN s.is_computed THEN 'sí' ELSE 'no' END, COALESCE(s.observation, '')
		FROM shift_check_services s JOIN shift_checks c ON c.id = s.shift_check_id
		JOIN work_shifts ws ON ws.id = c.work_shift_id JOIN users u ON u.id = c.user_id ORDER BY c.check_date, s.service_title`},
	"tickets": {"tickets.csv", []string{"Número", "Tipo", "Prioridad", "Estado", "Cliente", "Equipo", "Título", "Creado", "Resuelto", "Reaperturas"}, `
		SELECT t.ticket_number, t.ticket_type::text, t.priority::text, t.status::text, o.name, COALESCE(tm.name, ''), t.title,
		       to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), COALESCE(to_char(t.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), ''), t.reopened_count::text
		FROM tickets t JOIN organizations o ON o.id = t.client_id LEFT JOIN teams tm ON tm.id = t.assigned_team_id ORDER BY t.created_at`},
}

func (h *BackupsHandler) buildCSV(ctx context.Context, kind string) ([]byte, error) {
	spec := csvExports[kind]
	rows, err := h.Pool.Query(ctx, spec.query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF") // BOM UTF-8: Excel abre bien tildes y ñ
	out := csv.NewWriter(&buf)
	_ = out.Write(spec.header)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		record := make([]string, len(values))
		for i, v := range values {
			if v != nil {
				record[i] = fmt.Sprint(v)
			}
		}
		_ = out.Write(record)
	}
	out.Flush()
	return buf.Bytes(), rows.Err()
}

// Export es GET /api/backups/export?kind=entries|checklists|tickets|all (ZIP).
// Va por query y no por ruta: "/api/backups/export/{kind}" choca con
// "/api/backups/{id}/download" en el ServeMux (pánico al arrancar).
func (h *BackupsHandler) Export(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	stamp := time.Now().Format("2006-01-02")
	if kind == "all" {
		var buf bytes.Buffer
		archive := zip.NewWriter(&buf)
		for _, k := range []string{"entries", "checklists", "tickets"} {
			data, err := h.buildCSV(r.Context(), k)
			if err != nil {
				problemdetails.Write(w, r, 500, "internal-error", "no se pudo exportar "+k)
				return
			}
			f, _ := archive.Create(csvExports[k].file)
			_, _ = f.Write(data)
		}
		_ = archive.Close()
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="bitacora-`+stamp+`.zip"`)
		_, _ = w.Write(buf.Bytes())
		h.AuditLog.Log(r.Context(), "backup.export_csv", audit.LevelInfo, audit.Success(), map[string]any{"kind": kind})
		return
	}
	if _, ok := csvExports[kind]; !ok {
		problemdetails.Write(w, r, 404, "not-found", "exportación desconocida (entries, checklists, tickets o all)")
		return
	}
	data, err := h.buildCSV(r.Context(), kind)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo exportar")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.TrimSuffix(csvExports[kind].file, ".csv")+"-"+stamp+`.csv"`)
	_, _ = w.Write(data)
	h.AuditLog.Log(r.Context(), "backup.export_csv", audit.LevelInfo, audit.Success(), map[string]any{"kind": kind})
}

// ===== Purga (zona de peligro) =====

// Purge es POST /api/backups/purge. Solo con "Permitir purga" activo en
// Funcionalidades y la frase exacta PURGAR TODO. Deja el sistema como recién
// instalado y recrea el admin del .env si está configurado.
func (h *BackupsHandler) Purge(w http.ResponseWriter, r *http.Request) {
	feature, err := h.Queries.GetSystemFeature(r.Context(), "allow_purge")
	if err != nil || !feature.IsEnabled {
		problemdetails.Write(w, r, http.StatusForbidden, "purge-disabled", "la purga está desactivada: actívala en Funcionalidades → Permitir purga (solo ambientes de prueba)")
		return
	}
	var req struct {
		Confirmation string `json:"confirmation"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.Confirmation != backup.PurgeConfirmation {
		problemdetails.Write(w, r, 400, "confirmation-required", "escribe exactamente "+backup.PurgeConfirmation)
		return
	}
	actor, _ := middleware.UserFromContext(r.Context())
	// Se audita ANTES: la purga vacía audit_log y este evento debe quedar en el log del servidor.
	h.AuditLog.Log(r.Context(), "backup.purge", audit.LevelWarn, audit.Success(), map[string]any{"requestedBy": actor.Username})
	tables, err := h.Service.Purge(r.Context())
	if err != nil {
		h.writeServiceError(w, r, err, "no se pudo purgar")
		return
	}
	adminRecreated := false
	if h.AfterPurge != nil {
		h.AfterPurge(r.Context())
		if status, statusErr := h.Queries.GetUserByUsername(r.Context(), os.Getenv("BOOTSTRAP_ADMIN_USERNAME")); statusErr == nil && status.ID != uuid.Nil {
			adminRecreated = true
		}
	}
	h.AuditLog.Log(r.Context(), "backup.purged", audit.LevelWarn, audit.Success(), map[string]any{"tables": tables, "adminRecreated": adminRecreated})
	writeData(w, 200, map[string]any{"purgedTables": tables, "adminRecreated": adminRecreated})
}
