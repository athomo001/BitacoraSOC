package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBusy: ya hay un respaldo, restauración o purga en curso (nunca dos a la vez).
var ErrBusy = errors.New("ya hay una operación de respaldos en curso")

// ErrChecksum: el archivo en disco no es el que se registró al crearlo.
var ErrChecksum = errors.New("el archivo no coincide con su checksum: está dañado o fue reemplazado")

// Tablas que ni se respaldan ni se restauran: el historial de migraciones es
// del esquema, y backup_runs/backup_config describen los archivos y la
// programación de ESTE servidor (restaurarlas apuntaría a archivos ajenos y
// borraría el respaldo de seguridad recién tomado).
var notRestored = map[string]bool{"schema_migrations": true, "backup_runs": true, "backup_config": true}

// Service agrupa las operaciones de respaldos que usan la API y el planificador.
type Service struct {
	Pool    *pgxpool.Pool
	Queries *db.Queries
	Crypto  *crypto.Box
	// LocalDir es la carpeta local de copias (BACKUP_DIR, por defecto "backups").
	LocalDir string
	Now      func() time.Time
	mu       sync.Mutex
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) localDir() string {
	if s.LocalDir != "" {
		return s.LocalDir
	}
	return "backups"
}

func (s *Service) lock() error {
	if !s.mu.TryLock() {
		return ErrBusy
	}
	return nil
}

func quote(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }

func (s *Service) publicTables(ctx context.Context, q pgx.Tx) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Snapshot lee todas las tablas dentro de UNA transacción REPEATABLE READ
// (HU-BKP-2): una foto de un solo instante, aunque el sistema siga operando.
func (s *Service) Snapshot(ctx context.Context) (map[string]json.RawMessage, int, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx)
	names, err := s.publicTables(ctx, tx)
	if err != nil {
		return nil, 0, err
	}
	tables := map[string]json.RawMessage{}
	records := 0
	for _, name := range names {
		if name == "schema_migrations" {
			continue
		}
		var payload string
		if err := tx.QueryRow(ctx, `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM `+quote(name)+` t`).Scan(&payload); err != nil {
			return nil, 0, fmt.Errorf("tabla %s: %w", name, err)
		}
		var rows []json.RawMessage
		if err := json.Unmarshal([]byte(payload), &rows); err != nil {
			return nil, 0, fmt.Errorf("tabla %s devolvió JSON inválido: %w", name, err)
		}
		tables[name] = json.RawMessage(payload)
		records += len(rows)
	}
	return tables, records, tx.Commit(ctx)
}

// CreateFull genera una copia completa cifrada en `dir` (vacío = carpeta local).
func (s *Service) CreateFull(ctx context.Context, passphrase, source, dir string, triggeredBy pgtype.UUID) (db.BackupRun, error) {
	if err := s.lock(); err != nil {
		return db.BackupRun{}, err
	}
	defer s.mu.Unlock()
	return s.createFullLocked(ctx, passphrase, source, dir, triggeredBy)
}

func (s *Service) createFullLocked(ctx context.Context, passphrase, source, dir string, triggeredBy pgtype.UUID) (db.BackupRun, error) {
	if dir == "" {
		dir = s.localDir()
	}
	run, err := s.Queries.CreateBackupRunWithSource(ctx, db.CreateBackupRunWithSourceParams{Kind: db.BackupKindFull, TriggerSource: source, TriggeredBy: triggeredBy})
	if err != nil {
		return db.BackupRun{}, err
	}
	fail := func(cause error) (db.BackupRun, error) {
		_, _ = s.Queries.MarkBackupRun(ctx, db.MarkBackupRunParams{ID: run.ID, Status: "failed", ErrorMessage: pgtype.Text{String: cause.Error(), Valid: true}})
		return db.BackupRun{}, cause
	}
	tables, records, err := s.Snapshot(ctx)
	if err != nil {
		return fail(err)
	}
	data, err := s.Seal(Envelope{Version: 1, Kind: "full", Tables: tables}, passphrase)
	if err != nil {
		return fail(err)
	}
	path, checksum, err := writeBackupFile(dir, run.ID.String()+".full.zst.enc", data)
	if err != nil {
		return fail(err)
	}
	return s.Queries.MarkBackupRun(ctx, db.MarkBackupRunParams{
		ID: run.ID, RecordsCount: int32(records), Status: "success",
		FilePath: pgtype.Text{String: path, Valid: true}, FileSizeBytes: pgtype.Int8{Int64: int64(len(data)), Valid: true},
		ChecksumSha256: pgtype.Text{String: checksum, Valid: true},
	})
}

// Seal cifra un respaldo: con la frase si vino; sin frase, con la llave de
// la instalación (pedido del dueño: la frase es opcional).
func (s *Service) Seal(envelope Envelope, passphrase string) ([]byte, error) {
	if passphrase != "" {
		return Encode(envelope, passphrase)
	}
	if s.Crypto == nil {
		return nil, errors.New("sin frase hace falta la llave de la instalación")
	}
	return EncodeWithKey(envelope, s.Crypto.BackupKey())
}

// OpenData abre un respaldo de cualquiera de los dos tipos.
func (s *Service) OpenData(data []byte, passphrase string) (Envelope, error) {
	var key [32]byte
	if s.Crypto != nil {
		key = s.Crypto.BackupKey()
	}
	return Open(data, passphrase, key)
}

func writeBackupFile(dir, name string, data []byte) (string, string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", fmt.Errorf("no se pudo crear la carpeta de respaldos %s: %w", dir, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", "", fmt.Errorf("no se pudo escribir %s: %w", path, err)
	}
	sum := sha256.Sum256(data)
	return path, hex.EncodeToString(sum[:]), nil
}

// ReadVerified lee el archivo de una copia y confirma su checksum.
func ReadVerified(run db.BackupRun) ([]byte, error) {
	if !run.FilePath.Valid {
		return nil, errors.New("la copia no tiene archivo")
	}
	data, err := os.ReadFile(run.FilePath.String)
	if err != nil {
		return nil, fmt.Errorf("no se encontró el archivo de la copia: %w", err)
	}
	sum := sha256.Sum256(data)
	if run.ChecksumSha256.Valid && run.ChecksumSha256.String != hex.EncodeToString(sum[:]) {
		return nil, ErrChecksum
	}
	return data, nil
}

// RestoreMode: unir sin duplicar o reemplazar todo.
type RestoreMode string

const (
	Merge   RestoreMode = "merge"
	Replace RestoreMode = "replace"
)

type RestoreResult struct {
	Mode         RestoreMode `json:"mode"`
	Inserted     int64       `json:"inserted"`
	AlreadyThere int64       `json:"alreadyThere"`
	// Skipped: filas de la copia que apuntaban a algo que no existe ni en la
	// copia ni en la base, y no se podían dejar sin esa referencia.
	Skipped       int64     `json:"skipped"`
	Tables        int       `json:"tables"`
	SafetyBackup  string    `json:"safetyBackupId,omitempty"`
	RestoredFrom  string    `json:"restoredFrom"`
	FinishedAtUTC time.Time `json:"finishedAt"`
}

// Restore aplica una copia completa. En "replace" primero toma un respaldo
// de seguridad del estado actual (con la misma frase) y después vacía y
// recarga todo en una sola transacción: si algo falla, no cambia nada.
func (s *Service) Restore(ctx context.Context, run db.BackupRun, passphrase string, mode RestoreMode, actor pgtype.UUID) (RestoreResult, error) {
	if err := s.lock(); err != nil {
		return RestoreResult{}, err
	}
	defer s.mu.Unlock()
	data, err := ReadVerified(run)
	if err != nil {
		return RestoreResult{}, err
	}
	envelope, err := s.OpenData(data, passphrase)
	if err != nil {
		return RestoreResult{}, errors.New("la frase de cifrado no corresponde a esta copia")
	}
	if envelope.Kind != "full" {
		return RestoreResult{}, errors.New("esta copia es un delta: se aplica con Importar delta")
	}
	result := RestoreResult{Mode: mode, RestoredFrom: run.ID.String()}
	if mode == Replace {
		safety, err := s.createFullLocked(ctx, passphrase, "pre_restore", "", actor)
		if err != nil {
			return RestoreResult{}, fmt.Errorf("no se pudo tomar el respaldo de seguridad previo: %w", err)
		}
		result.SafetyBackup = safety.ID.String()
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return RestoreResult{}, err
	}
	defer tx.Rollback(ctx)
	order, err := s.restorePlan(ctx, tx, envelope.Tables)
	if err != nil {
		return RestoreResult{}, err
	}
	// Lo que describe a ESTE servidor (historial de copias, programación) se
	// conserva: incluye el respaldo de seguridad recién tomado.
	keep := []string{"backup_runs", "backup_config"}
	if mode == Replace {
		all, err := s.publicTables(ctx, tx)
		if err != nil {
			return RestoreResult{}, err
		}
		if err := wipeKeeping(ctx, tx, all, keep); err != nil {
			return RestoreResult{}, err
		}
	}
	for _, table := range order {
		inserted, total, skipped, err := insertTableSafe(ctx, tx, table, envelope.Tables[table])
		if err != nil {
			return RestoreResult{}, fmt.Errorf("tabla %s: %w", table, err)
		}
		result.Inserted += inserted
		result.Skipped += skipped
		result.AlreadyThere += total - inserted - skipped
		result.Tables++
	}
	if mode == Replace {
		if err := restoreKept(ctx, tx, keep); err != nil {
			return RestoreResult{}, err
		}
	}
	if err := resetSequences(ctx, tx); err != nil {
		return RestoreResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RestoreResult{}, err
	}
	result.FinishedAtUTC = s.now().UTC()
	return result, nil
}

// restorePlan: tablas de la copia que existen hoy en el esquema, ordenadas por FK.
func (s *Service) restorePlan(ctx context.Context, tx pgx.Tx, tables map[string]json.RawMessage) ([]string, error) {
	existing, err := s.publicTables(ctx, tx)
	if err != nil {
		return nil, err
	}
	var candidates []string
	for _, t := range existing {
		if _, inBackup := tables[t]; inBackup && !notRestored[t] {
			candidates = append(candidates, t)
		}
	}
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT child.relname, parent.relname
		FROM pg_constraint c
		JOIN pg_class child ON child.oid = c.conrelid
		JOIN pg_class parent ON parent.oid = c.confrelid
		JOIN pg_namespace n ON n.oid = child.relnamespace
		WHERE c.contype = 'f' AND n.nspname = 'public'`)
	if err != nil {
		return nil, err
	}
	var fks []FK
	for rows.Next() {
		var fk FK
		if err := rows.Scan(&fk.Child, &fk.Parent); err != nil {
			rows.Close()
			return nil, err
		}
		fks = append(fks, fk)
	}
	rows.Close()
	return RestoreOrder(candidates, fks)
}

// resetSequences deja cada secuencia por encima del máximo restaurado
// (system_events.id): si no, el próximo evento chocaría con uno restaurado.
func resetSequences(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `
		SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`)
	if err != nil {
		return err
	}
	type seqCol struct{ table, column string }
	var cols []seqCol
	for rows.Next() {
		var c seqCol
		if err := rows.Scan(&c.table, &c.column); err != nil {
			rows.Close()
			return err
		}
		cols = append(cols, c)
	}
	rows.Close()
	for _, c := range cols {
		q := fmt.Sprintf(`SELECT setval(pg_get_serial_sequence('%s', '%s'), COALESCE((SELECT max(%s) FROM %s), 0) + 1, false)`,
			strings.ReplaceAll(c.table, "'", "''"), strings.ReplaceAll(c.column, "'", "''"), quote(c.column), quote(c.table))
		if _, err := tx.Exec(ctx, q); err != nil {
			return fmt.Errorf("secuencia de %s.%s: %w", c.table, c.column, err)
		}
	}
	return nil
}

// Purge vacía todas las tablas salvo los catálogos (PreservedOnPurge) y borra
// las copias guardadas en la carpeta local: el sistema queda como recién
// instalado. Quien llama decide si se recrea el admin del .env.
func (s *Service) Purge(ctx context.Context) (int, error) {
	if err := s.lock(); err != nil {
		return 0, err
	}
	defer s.mu.Unlock()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	all, err := s.publicTables(ctx, tx)
	if err != nil {
		return 0, err
	}
	// El catálogo de funcionalidades lo siembran las migraciones: se conserva
	// (con sus interruptores). La programación de respaldos vuelve a fábrica.
	keep := []string{"system_features"}
	if err := wipeKeeping(ctx, tx, all, keep); err != nil {
		return 0, fmt.Errorf("no se pudo purgar: %w", err)
	}
	if err := restoreKept(ctx, tx, keep); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO backup_config (id) VALUES (true)`); err != nil {
		return 0, err
	}
	targets := 0
	for _, t := range all {
		if !PreservedOnPurge[t] {
			targets++
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	_ = removeBackupFiles(s.localDir())
	return targets, nil
}

func removeBackupFiles(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".enc") {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	return nil
}
