package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/backup"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var deltaSpecs = map[string]string{
	"tickets":                `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM tickets t WHERE t.updated_at >= $1 AND t.updated_at < $2`,
	"entries":                `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM entries t WHERE t.updated_at >= $1 AND t.updated_at < $2`,
	"entry_comments":         `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM entry_comments t WHERE t.updated_at >= $1 AND t.updated_at < $2`,
	"entry_attachments":      `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM entry_attachments t WHERE t.created_at >= $1 AND t.created_at < $2`,
	"ticket_comments":        `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM ticket_comments t WHERE t.created_at >= $1 AND t.created_at < $2`,
	"ticket_tasks":           `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM ticket_tasks t WHERE t.created_at >= $1 AND t.created_at < $2`,
	"escalation_action_logs": `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM escalation_action_logs t WHERE t.created_at >= $1 AND t.created_at < $2`,
	"shift_checks":           `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM shift_checks t WHERE t.check_date >= $1 AND t.check_date < $2`,
}

func deltaWindow(rawPreset, fromRaw, toRaw string, now time.Time) (time.Time, time.Time, error) {
	if fromRaw != "" || toRaw != "" {
		from, err := time.Parse(time.RFC3339, fromRaw)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		to, err := time.Parse(time.RFC3339, toRaw)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		return from, to, nil
	}
	var duration time.Duration
	switch rawPreset {
	case "6h":
		duration = 6 * time.Hour
	case "12h":
		duration = 12 * time.Hour
	case "24h":
		duration = 24 * time.Hour
	case "3d":
		duration = 72 * time.Hour
	case "7d":
		duration = 7 * 24 * time.Hour
	default:
		return time.Time{}, time.Time{}, os.ErrInvalid
	}
	return now.Add(-duration), now, nil
}

func (h *BackupsHandler) ExportDelta(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TimeWindowPreset string `json:"timeWindowPreset"`
		From             string `json:"from"`
		To               string `json:"to"`
		Passphrase       string `json:"passphrase"`
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
	from, to, err := deltaWindow(req.TimeWindowPreset, req.From, req.To, time.Now().UTC())
	if err != nil || !to.After(from) || to.Sub(from) > 7*24*time.Hour {
		problemdetails.Write(w, r, 400, "invalid-query", "ventana delta inválida")
		return
	}
	user, _ := middleware.UserFromContext(r.Context())
	run, err := h.Queries.CreateBackupRun(r.Context(), db.CreateBackupRunParams{Kind: db.BackupKindDelta, WindowFrom: pgtype.Timestamptz{Time: from, Valid: true}, WindowTo: pgtype.Timestamptz{Time: to, Valid: true}, TriggeredBy: pgtype.UUID{Bytes: user.ID, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo registrar el delta")
		return
	}
	tx, err := h.Pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo abrir snapshot")
		return
	}
	defer tx.Rollback(r.Context())
	tables := map[string]json.RawMessage{}
	records := 0
	for name, query := range deltaSpecs {
		var payload []byte
		if err = tx.QueryRow(r.Context(), query, from, to).Scan(&payload); err != nil {
			_ = h.fail(r, run.ID, err)
			problemdetails.Write(w, r, 500, "internal-error", "no se pudo exportar el delta")
			return
		}
		tables[name] = payload
		var rows []json.RawMessage
		_ = json.Unmarshal(payload, &rows)
		records += len(rows)
	}
	if err = tx.Commit(r.Context()); err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar el delta")
		return
	}
	data, err := backup.Encode(backup.Envelope{Version: 1, Kind: "delta", From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), Tables: tables}, req.Passphrase)
	if err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo cifrar el delta")
		return
	}
	sum := sha256.Sum256(data)
	dir := os.Getenv("BACKUP_DIR")
	if dir == "" {
		dir = "backups"
	}
	_ = os.MkdirAll(dir, 0700)
	path := filepath.Join(dir, run.ID.String()+".delta.zst.enc")
	if err = os.WriteFile(path, data, 0600); err != nil {
		_ = h.fail(r, run.ID, err)
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo guardar el delta")
		return
	}
	info, _ := os.Stat(path)
	marked, err := h.Queries.MarkBackupRun(r.Context(), db.MarkBackupRunParams{ID: run.ID, RecordsCount: int32(records), Status: "success", FilePath: pgtype.Text{String: path, Valid: true}, FileSizeBytes: pgtype.Int8{Int64: info.Size(), Valid: true}, ChecksumSha256: pgtype.Text{String: hex.EncodeToString(sum[:]), Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo finalizar delta")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "backup.delta_exported", audit.LevelInfo, audit.Success(), map[string]any{"backupId": marked.ID.String(), "records": records})
	}
	writeData(w, 201, map[string]any{"backupRunId": marked.ID, "windowFrom": from, "windowTo": to, "recordsCount": records, "checksumSha256": hex.EncodeToString(sum[:]), "downloadUrl": "/api/backups/" + marked.ID.String() + "/download"})
}

func (h *BackupsHandler) ImportDelta(w http.ResponseWriter, r *http.Request) {
	passphrase := r.FormValue("passphrase")
	if passphrase == "" {
		passphrase = os.Getenv("BACKUP_PASSPHRASE")
	}
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "archivo delta inválido")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "falta archivo delta")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 100<<20))
	if err != nil {
		problemdetails.Write(w, r, 400, "invalid-payload", "no se pudo leer delta")
		return
	}
	envelope, err := backup.Decode(data, passphrase)
	if err != nil || envelope.Kind != "delta" {
		problemdetails.Write(w, r, 400, "invalid-payload", "delta corrupto o passphrase incorrecta")
		return
	}
	tx, err := h.Pool.Begin(r.Context())
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo iniciar importación")
		return
	}
	defer tx.Rollback(r.Context())
	order := []string{"tickets", "entries", "entry_comments", "entry_attachments", "ticket_comments", "ticket_tasks", "escalation_action_logs", "shift_checks"}
	imported := 0
	for _, name := range order {
		payload, ok := envelope.Tables[name]
		if !ok {
			continue
		}
		identifier := `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
		command := `INSERT INTO ` + identifier + ` SELECT * FROM json_populate_recordset(NULL::` + identifier + `, $1) ON CONFLICT DO NOTHING`
		tag, execErr := tx.Exec(r.Context(), command, []byte(payload))
		if execErr != nil {
			problemdetails.Write(w, r, 400, "invalid-payload", "delta no compatible con el esquema actual")
			return
		}
		imported += int(tag.RowsAffected())
	}
	if err = tx.Commit(r.Context()); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo confirmar importación")
		return
	}
	if h.AuditLog != nil {
		h.AuditLog.Log(r.Context(), "backup.delta_imported", audit.LevelInfo, audit.Success(), map[string]any{"importedRecords": imported, "windowFrom": envelope.From, "windowTo": envelope.To})
	}
	writeData(w, 200, map[string]any{"status": "merged", "windowFrom": envelope.From, "windowTo": envelope.To, "importedRecords": imported})
}
