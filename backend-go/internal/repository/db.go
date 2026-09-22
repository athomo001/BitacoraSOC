// Package repository contiene la capa de persistencia (PostgreSQL 18 + pgx/v5).
// Ver spec/07-backend-arquitectura-go.md sección 1.
package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool crea el pool de conexiones pgx contra PostgreSQL. dsn debe venir de
// configuración (variable de entorno DATABASE_URL), nunca hardcodeado.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("repository: parseando DSN de Postgres: %w", err)
	}

	// Timeouts conservadores para que un Postgres caído no cuelgue el arranque
	// del binario ni las requests de health-check indefinidamente.
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("repository: creando pool de Postgres: %w", err)
	}
	return pool, nil
}
