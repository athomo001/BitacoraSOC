package backup

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// ScheduleOf traduce la configuración guardada a una Schedule.
func ScheduleOf(cfg db.BackupConfig) Schedule {
	loc, err := time.LoadLocation(cfg.Timezone)
	if err != nil {
		loc = time.UTC
	}
	minutes := cfg.RunAt.Microseconds / 60_000_000
	return Schedule{IntervalDays: int(cfg.IntervalDays), Hour: int(minutes / 60), Minute: int(minutes % 60), Location: loc}
}

// DestinationDir es la carpeta donde se escriben las copias automáticas.
func (s *Service) DestinationDir(cfg db.BackupConfig) string {
	if cfg.DestinationType != "local" && cfg.DestinationPath.Valid && cfg.DestinationPath.String != "" {
		return cfg.DestinationPath.String
	}
	return s.localDir()
}

// CheckWritable confirma que se puede escribir en el destino (una carpeta de
// red desmontada falla acá, al guardar, y no a las 3 de la mañana).
func CheckWritable(dir string) error {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("la carpeta %s no existe en el servidor (¿está montada?)", dir)
	}
	probe := filepath.Join(dir, ".bitacora-write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("no se puede escribir en %s: %w", dir, err)
	}
	return os.Remove(probe)
}

// RunScheduled es el paso del planificador (cada minuto): si toca, crea la
// copia automática en el destino, deja registro del resultado y borra las
// copias automáticas vencidas. `force` ejecuta ahora ("Ejecutar prueba ahora").
func (s *Service) RunScheduled(ctx context.Context, force bool) error {
	cfg, err := s.Queries.GetBackupConfig(ctx)
	if err != nil {
		return err
	}
	now := s.now()
	due := cfg.Enabled && cfg.NextRunAt.Valid && !cfg.NextRunAt.Time.After(now)
	if !force && !due {
		return nil
	}
	schedule := ScheduleOf(cfg)
	next := pgtype.Timestamptz{Time: NextRunAfterBackup(now, schedule), Valid: cfg.Enabled}
	record := func(status, message string) error {
		return s.Queries.MarkBackupConfigRun(ctx, db.MarkBackupConfigRunParams{
			LastRunAt: pgtype.Timestamptz{Time: now, Valid: true}, LastStatus: status,
			LastMessage: pgtype.Text{String: message, Valid: message != ""}, NextRunAt: next,
		})
	}
	passphrase := ""
	if cfg.PassphraseEncrypted.Valid && s.Crypto != nil {
		p, err := s.Crypto.Decrypt(cfg.PassphraseEncrypted.String)
		if err != nil {
			return record("failed", "no se pudo leer la frase de cifrado guardada")
		}
		passphrase = p
	}
	dir := s.DestinationDir(cfg)
	if err := CheckWritable(dir); err != nil {
		return record("failed", err.Error())
	}
	run, err := s.CreateFull(ctx, passphrase, "auto", dir, pgtype.UUID{})
	if errors.Is(err, ErrBusy) {
		return nil // otro respaldo en curso: se reintenta en el próximo minuto
	}
	if err != nil {
		return record("failed", err.Error())
	}
	pruned := s.pruneExpired(ctx, int(cfg.RetentionDays))
	message := fmt.Sprintf("Copia de %d registros (%s)", run.RecordsCount, humanSize(run.FileSizeBytes.Int64))
	if pruned > 0 {
		message += fmt.Sprintf(" · %d copias vencidas borradas", pruned)
	}
	return record("success", message)
}

// pruneExpired borra (archivo y registro) las copias automáticas fuera de la retención.
func (s *Service) pruneExpired(ctx context.Context, retentionDays int) int {
	expired, err := s.Queries.ListExpiredAutoBackups(ctx, pgtype.Timestamptz{Time: RetentionCutoff(s.now(), retentionDays), Valid: true})
	if err != nil {
		return 0
	}
	for _, run := range expired {
		if run.FilePath.Valid {
			_ = os.Remove(run.FilePath.String)
		}
		_, _ = s.Queries.DeleteBackupRun(ctx, run.ID)
	}
	return len(expired)
}

func humanSize(bytes int64) string {
	switch {
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%d KB", bytes>>10)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
