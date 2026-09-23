package repository

import (
	"context"
	"errors"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/territory"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// TerritoryStore implementa territory.Store sobre una transacción ya
// abierta: todo el import es una sola transacción (se ve completo o no se
// ve), y cada nodo corre en su propio savepoint (tx.Begin anidado de pgx)
// para que un nodo que viola un constraint se deshaga solo, sin abortar la
// transacción externa ni el resto del árbol — el "import parcial" de
// spec/04-contratos-api.md.
type TerritoryStore struct {
	Tx pgx.Tx
}

func (s *TerritoryStore) Upsert(ctx context.Context, p territory.UpsertParams) (territory.UpsertResult, error) {
	sp, err := s.Tx.Begin(ctx)
	if err != nil {
		return territory.UpsertResult{}, err
	}
	defer sp.Rollback(ctx) // no-op si ya se hizo Commit

	q := db.New(sp)
	oldPath, err := q.GetTerritorialUnitPathByCodeForUpdate(ctx, p.Code)
	existed := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return territory.UpsertResult{}, err
	}

	var parent pgtype.UUID
	if p.ParentID != nil {
		parent = pgtype.UUID{Bytes: *p.ParentID, Valid: true}
	}
	row, err := q.UpsertTerritorialUnit(ctx, db.UpsertTerritorialUnitParams{
		ParentID: parent, Kind: db.TerritorialKind(p.Kind), Name: p.Name, Code: p.Code,
		Path: p.Path, Latitude: p.Latitude, Longitude: p.Longitude,
	})
	if err != nil {
		return territory.UpsertResult{}, err
	}
	if existed && oldPath != row.Path {
		if err := q.RebaseTerritorialSubtree(ctx, db.RebaseTerritorialSubtreeParams{NewPath: row.Path, OldPath: oldPath}); err != nil {
			return territory.UpsertResult{}, err
		}
	}
	if err := sp.Commit(ctx); err != nil {
		return territory.UpsertResult{}, err
	}
	return territory.UpsertResult{ID: uuid.UUID(row.ID), Path: row.Path, Inserted: row.Inserted}, nil
}
