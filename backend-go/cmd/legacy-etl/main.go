// legacy-etl carga un respaldo del legacy en una base 2.0 vacía
// (spec/13-etl.md). Se corre en cada ensayo, nunca contra producción:
//
//	scripts/etl-reset.sh
//	go run ./cmd/legacy-etl -backup <backup-….zip> -database-url postgres://…/bitacora_etl
//
// El respaldo es el ZIP tal como lo genera el legacy (automático o manual)
// o su data.json suelto. Si se hizo con contraseña, va en
// LEGACY_BACKUP_PASSPHRASE (no como parámetro: no queda en el historial).
// Las llaves del legacy salen del keyring que trae el ZIP y, si se indica,
// del .env del legacy. La llave 2.0 sale de APP_ENCRYPTION_KEY.
//
// Con -output-dir, al terminar deja un respaldo en formato 2.0 (el mismo
// que genera Administración → Respaldos). Sin ETL_OUTPUT_PASSPHRASE queda
// cifrado con la llave de la instalación (misma APP_ENCRYPTION_KEY) y la 2.0
// lo sube y restaura sin pedir frase; con ella, se pide una vez al subirlo)
// para subirlo y restaurarlo en la 2.0: es una herramienta de implementación,
// no toca el código de respaldos.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/backup"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/legacyetl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	backupPath := flag.String("backup", "", "respaldo del legacy: el ZIP (automático o manual) o su data.json")
	legacyEnv := flag.String("legacy-env", "", ".env del legacy (ENCRYPTION_KEY); opcional si el ZIP trae su keyring")
	keyring := flag.String("legacy-keyring", "", "keyring del legacy (por defecto backend/secrets/encryption-keyring.json junto al .env)")
	dbURL := flag.String("database-url", os.Getenv("ETL_DATABASE_URL"), "base destino (bitacora_etl), vacía y migrada")
	dryRun := flag.Bool("dry-run", false, "hace toda la carga y la deshace: solo el reporte")
	reportPath := flag.String("report", "", "dónde guardar el reporte JSON (por defecto junto a la exportación)")
	outputDir := flag.String("output-dir", "", "si se indica, deja ahí un respaldo en formato 2.0 (frase opcional en ETL_OUTPUT_PASSPHRASE)")
	flag.Parse()

	switch {
	case *backupPath == "":
		return errors.New("falta -backup (el ZIP o el data.json del respaldo del legacy)")
	case *dbURL == "":
		return errors.New("falta -database-url (o ETL_DATABASE_URL)")
	case !strings.Contains(*dbURL, "etl"):
		// Freno de mano: el ETL no borra nada, pero carga datos reales; solo en
		// una base de ensayo con "etl" en el nombre.
		return errors.New("por seguridad el destino debe ser una base de ensayo con \"etl\" en el nombre (ej. bitacora_etl)")
	}
	if *keyring == "" && *legacyEnv != "" {
		*keyring = filepath.Join(filepath.Dir(*legacyEnv), "backend", "secrets", "encryption-keyring.json")
	}
	key, err := crypto.LoadKeyFromEnv(os.Getenv("APP_ENCRYPTION_KEY"))
	if err != nil {
		return fmt.Errorf("APP_ENCRYPTION_KEY de la 2.0: %w", err)
	}
	box, err := crypto.New(key)
	if err != nil {
		return err
	}
	legacyBackup, err := legacyetl.OpenBackup(*backupPath, os.Getenv("LEGACY_BACKUP_PASSPHRASE"))
	if err != nil {
		return err
	}
	defer legacyBackup.Close()
	legacyKeys := legacyBackup.Keys
	if *legacyEnv != "" {
		fromEnv, err := legacyetl.LoadLegacyKeys(*legacyEnv, *keyring)
		if err != nil {
			return err
		}
		legacyKeys = legacyetl.MergeKeys(legacyKeys, fromEnv)
	}
	if len(legacyKeys) == 0 {
		return errors.New("no hay llaves del legacy: el respaldo no trae keyring; indica -legacy-env")
	}
	fmt.Printf("Llaves del legacy disponibles: %d (del respaldo: %d)\n", len(legacyKeys), len(legacyBackup.Keys))
	fmt.Printf("Archivos subidos en el respaldo: %d\n", len(legacyBackup.Uploads))
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, *dbURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	rep, runErr := legacyetl.Run(ctx, pool, legacyBackup, legacyKeys, box, legacyetl.Options{DryRun: *dryRun})
	rep.Print(os.Stdout)
	if *reportPath == "" {
		*reportPath = strings.TrimSuffix(*backupPath, filepath.Ext(*backupPath)) + ".etl-report.json"
	}
	if raw, err := json.MarshalIndent(rep, "", "  "); err == nil {
		if werr := os.WriteFile(*reportPath, raw, 0o600); werr == nil {
			fmt.Println("Reporte:", *reportPath)
		}
	}
	if runErr != nil || !rep.Committed || *outputDir == "" {
		return runErr
	}
	svc := &backup.Service{Pool: pool, Queries: db.New(pool), Crypto: box}
	run, err := svc.CreateFull(ctx, os.Getenv("ETL_OUTPUT_PASSPHRASE"), "manual", *outputDir, pgtype.UUID{})
	if err != nil {
		return fmt.Errorf("se cargó, pero no se pudo generar el respaldo 2.0: %w", err)
	}
	fmt.Printf("\nRespaldo 2.0 listo (%d registros): %s\n", run.RecordsCount, run.FilePath.String)
	fmt.Println("Súbelo en Administración → Respaldos (arrástralo a la zona de subida) y restáuralo.")
	return nil
}
