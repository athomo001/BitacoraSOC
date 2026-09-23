package repository

import (
	"context"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// UserLookup adapta db.Queries a middleware.UserLookup.
type UserLookup struct {
	Queries *db.Queries
}

func (s *UserLookup) GetActiveUser(ctx context.Context, id uuid.UUID) (middleware.LookedUpUser, error) {
	user, err := s.Queries.GetUserByID(ctx, id)
	if err != nil {
		return middleware.LookedUpUser{}, err
	}
	return middleware.LookedUpUser{
		ID:                 user.ID,
		Username:           user.Username,
		Role:               string(user.Role),
		MustChangePassword: user.MustChangePassword,
		Active:             user.Active,
	}, nil
}

// TokenDenylist adapta db.Queries a middleware.TokenDenylistChecker.
type TokenDenylist struct {
	Queries *db.Queries
}

func (s *TokenDenylist) IsDenylisted(ctx context.Context, jti uuid.UUID) (bool, error) {
	return s.Queries.IsTokenDenylisted(ctx, jti)
}
