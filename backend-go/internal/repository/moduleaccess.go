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

// InstanceFlags: si las áreas SOC y NOC están activas (000033).
func (s *ModuleAccess) InstanceFlags(ctx context.Context) (modules.Flags, error) {
	return AreaFlags(ctx, s.Queries)
}

// AreaFlags lee las áreas y devuelve el estado de SOC y NOC.
func AreaFlags(ctx context.Context, q *db.Queries) (modules.Flags, error) {
	areas, err := q.ListAreas(ctx)
	if err != nil {
		return modules.Flags{}, err
	}
	active := map[string]bool{}
	for _, a := range areas {
		active[a.Code] = a.Active
	}
	return modules.FlagsFromAreas(active), nil
}

// UserModuleAreaCodes: las áreas de los grupos Operativos del usuario, las
// únicas que abren SOC/NOC (spec/16 §3.2).
func (s *ModuleAccess) UserModuleAreaCodes(ctx context.Context, userID uuid.UUID) ([]string, error) {
	return s.Queries.ListUserModuleAreaCodes(ctx, userID)
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
