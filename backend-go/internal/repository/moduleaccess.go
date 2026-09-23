package repository

import (
	"context"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// ModuleAccess adapta db.Queries a middleware.ModuleAccess.
type ModuleAccess struct {
	Queries *db.Queries
}

func (s *ModuleAccess) InstanceFlags(ctx context.Context) (modules.Flags, error) {
	config, err := s.Queries.GetAppConfig(ctx)
	if err != nil {
		return modules.Flags{}, err
	}
	return modules.Flags{SOC: config.SocModuleEnabled, NOC: config.NocModuleEnabled}, nil
}

func (s *ModuleAccess) UserGroupScopes(ctx context.Context, userID uuid.UUID) ([]string, error) {
	groups, err := s.Queries.ListUserPermissionGroups(ctx, userID)
	if err != nil {
		return nil, err
	}
	scopes := make([]string, 0, len(groups))
	for _, g := range groups {
		scopes = append(scopes, string(g.ModuleScope))
	}
	return scopes, nil
}

func (s *ModuleAccess) UserCapabilities(ctx context.Context, userID uuid.UUID) ([]string, error) {
	groups, err := s.Queries.ListUserPermissionGroups(ctx, userID)
	if err != nil {
		return nil, err
	}
	var caps []string
	for _, g := range groups {
		caps = append(caps, g.Capabilities...)
	}
	return caps, nil
}
