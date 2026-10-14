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

// InstanceFlags: si los módulos SOC y NOC están encendidos (000036).
func (s *ModuleAccess) InstanceFlags(ctx context.Context) (modules.Flags, error) {
	return ModuleFlags(ctx, s.Queries)
}

// ModuleFlags lee los módulos SOC y NOC de la instalación (app_config). Son
// las funciones; las áreas SOC y NOC son la gente y no los encienden.
func ModuleFlags(ctx context.Context, q *db.Queries) (modules.Flags, error) {
	if err := q.EnsureAppConfigRow(ctx); err != nil {
		return modules.Flags{}, err
	}
	f, err := q.GetModuleFlags(ctx)
	if err != nil {
		return modules.Flags{}, err
	}
	return modules.Flags{SOC: f.SocModuleEnabled, NOC: f.NocModuleEnabled}, nil
}

// UserModuleAreaCodes: las áreas de los grupos Operativos del usuario, las
// únicas que abren SOC/NOC (spec/16 §3.2).
func (s *ModuleAccess) UserModuleAreaCodes(ctx context.Context, userID uuid.UUID) ([]string, error) {
	return s.Queries.ListUserModuleAreaCodes(ctx, userID)
}

// UserAreaCodes: todas las áreas del usuario (cualquier perfil), 9e.
func (s *ModuleAccess) UserAreaCodes(ctx context.Context, userID uuid.UUID) ([]string, error) {
	return s.Queries.ListUserAreaCodes(ctx, userID)
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
