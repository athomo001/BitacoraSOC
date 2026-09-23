package repository

import (
	"context"
	"errors"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
)

// LoginRateLimitStore adapta db.Queries a ratelimit.Store sobre
// login_rate_limits (Postgres, no memoria — spec/07-backend-arquitectura-go.md
// sección 6.3).
type LoginRateLimitStore struct {
	Queries *db.Queries
}

func (s *LoginRateLimitStore) Get(ctx context.Context, ip string) (ratelimit.Window, bool, error) {
	row, err := s.Queries.GetLoginRateLimit(ctx, ip)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ratelimit.Window{}, false, nil
		}
		return ratelimit.Window{}, false, err
	}
	return ratelimit.Window{
		AttemptCount:    int(row.AttemptCount),
		WindowStartedAt: row.WindowStartedAt.Time,
	}, true, nil
}

func (s *LoginRateLimitStore) Reset(ctx context.Context, ip string) error {
	return s.Queries.ResetLoginRateLimit(ctx, ip)
}

func (s *LoginRateLimitStore) Increment(ctx context.Context, ip string, _ time.Time) (int, error) {
	row, err := s.Queries.UpsertLoginAttempt(ctx, ip)
	if err != nil {
		return 0, err
	}
	return int(row.AttemptCount), nil
}
