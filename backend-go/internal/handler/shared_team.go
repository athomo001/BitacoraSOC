package handler

import (
	"context"
	"slices"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Áreas que comparten equipo (spec/16 §3.5.1, decisión del dueño
// 2026-10-22): en un departamento se marcan las áreas con la misma gente.
// Quien entra a una entra a todas, con el mismo nivel; quien sale de una sale
// de todas. Todo cambio de áreas de una persona (Usuarios y grupos, la ficha
// del área, Mi equipo, la carga por CSV) pasa por propagateShared.

// applyPlacement deja a la persona como dice want: quita los grupos que no
// están de acuerdo y agrega los automáticos que faltan.
func applyPlacement(ctx context.Context, q *db.Queries, userID uuid.UUID, want placementDTO, areas map[string]db.Area, levels map[string]db.Level, actor uuid.UUID) (added, removed int, err error) {
	shapes, err := q.ListUserGroupShapes(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	remove, add := planPlacement(shapesOf(shapes), want, activeSet(areas))
	for _, g := range remove {
		if err := q.RemoveUserPermissionGroup(ctx, db.RemoveUserPermissionGroupParams{UserID: userID, PermissionGroupID: g}); err != nil {
			return 0, 0, err
		}
	}
	for _, spec := range add {
		groupID, err := ensureShapedGroup(ctx, q, spec, areas, levels)
		if err != nil {
			return 0, 0, err
		}
		if err := q.AddUserPermissionGroup(ctx, db.AddUserPermissionGroupParams{
			UserID: userID, PermissionGroupID: groupID, AssignedBy: pgtype.UUID{Bytes: actor, Valid: actor != uuid.Nil},
		}); err != nil {
			return 0, 0, err
		}
	}
	return len(add), len(remove), nil
}

// sharedSets: los grupos de áreas que comparten equipo (dos o más del mismo
// departamento).
func sharedSets(ctx context.Context, q *db.Queries) ([][]string, error) {
	rows, err := q.ListSharedSets(ctx)
	if err != nil {
		return nil, err
	}
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Codes)
	}
	return out, nil
}

// shareTeam lleva a las áreas hermanas el cambio hecho en una de ellas: si
// entró a una (o cambió de nivel), queda en todas con ese nivel; si salió de
// una, sale de todas. La jefatura de cada área no se copia.
func shareTeam(before, want placementDTO, sets [][]string) placementDTO {
	index := func(p placementDTO) map[string]placementArea {
		m := make(map[string]placementArea, len(p.Areas))
		for _, a := range p.Areas {
			m[a.Code] = a
		}
		return m
	}
	b, w := index(before), index(want)
	order := make([]string, 0, len(want.Areas))
	for _, a := range want.Areas {
		order = append(order, a.Code)
	}
	for _, set := range sets {
		src, changed := "", false
		for _, c := range set {
			old, wasIn := b[c]
			cur, isIn := w[c]
			if wasIn != isIn || (isIn && old.LevelID != cur.LevelID) {
				src, changed = c, true
				break
			}
		}
		if !changed {
			continue
		}
		model, in := w[src]
		for _, c := range set {
			if c == src {
				continue
			}
			if !in {
				delete(w, c)
				continue
			}
			cur, had := w[c]
			cur.Code, cur.LevelID = c, model.LevelID
			w[c] = cur
			if !had {
				order = append(order, c)
			}
		}
	}
	out := placementDTO{Areas: make([]placementArea, 0, len(w)), Extras: want.Extras}
	for _, c := range order {
		if a, ok := w[c]; ok {
			out.Areas = append(out.Areas, a)
		}
	}
	return out
}

// samePlacement: las mismas áreas con el mismo nivel y jefatura.
func samePlacement(a, b placementDTO) bool {
	if len(a.Areas) != len(b.Areas) {
		return false
	}
	for _, x := range a.Areas {
		if !slices.Contains(b.Areas, x) {
			return false
		}
	}
	return true
}

// propagateShared: después de cambiar las áreas de una persona (before es
// cómo estaba), deja igual las áreas que comparten equipo.
func propagateShared(ctx context.Context, q *db.Queries, userID uuid.UUID, before placementDTO, actor uuid.UUID) error {
	sets, err := sharedSets(ctx, q)
	if err != nil || len(sets) == 0 {
		return err
	}
	areas, levels, err := placementCatalog(ctx, q)
	if err != nil {
		return err
	}
	shapes, err := q.ListUserGroupShapes(ctx, userID)
	if err != nil {
		return err
	}
	current := derivePlacement(shapesOf(shapes), activeSet(areas))
	want := shareTeam(before, current, sets)
	if samePlacement(want, current) {
		return nil
	}
	_, _, err = applyPlacement(ctx, q, userID, want, areas, levels, actor)
	return err
}

// placementOf: cómo está ubicada hoy la persona.
func placementOf(ctx context.Context, q *db.Queries, userID uuid.UUID) (placementDTO, error) {
	areas, _, err := placementCatalog(ctx, q)
	if err != nil {
		return placementDTO{}, err
	}
	shapes, err := q.ListUserGroupShapes(ctx, userID)
	if err != nil {
		return placementDTO{}, err
	}
	return derivePlacement(shapesOf(shapes), activeSet(areas)), nil
}

// equalizeShared iguala la gente de las áreas recién marcadas: quien está en
// una queda en todas, con su nivel de más rango entre ellas. Devuelve a
// cuántas personas tocó.
func equalizeShared(ctx context.Context, q *db.Queries, set []string, actor uuid.UUID) (int, error) {
	if len(set) < 2 {
		return 0, nil
	}
	areas, levels, err := placementCatalog(ctx, q)
	if err != nil {
		return 0, err
	}
	ids, err := q.ListSharedAreaMembers(ctx, set)
	if err != nil {
		return 0, err
	}
	rank := func(levelID string) int32 {
		if l, ok := levels[levelID]; ok {
			return l.Rank
		}
		return -1
	}
	touched := 0
	for _, id := range ids {
		shapes, err := q.ListUserGroupShapes(ctx, id)
		if err != nil {
			return touched, err
		}
		current := derivePlacement(shapesOf(shapes), activeSet(areas))
		best, in := "", map[string]placementArea{}
		for _, a := range current.Areas {
			if slices.Contains(set, a.Code) {
				in[a.Code] = a
				if rank(a.LevelID) > rank(best) {
					best = a.LevelID
				}
			}
		}
		want := placementDTO{Extras: current.Extras}
		for _, a := range current.Areas {
			if slices.Contains(set, a.Code) {
				a.LevelID = best
			}
			want.Areas = append(want.Areas, a)
		}
		for _, c := range set {
			if _, ok := in[c]; !ok {
				want.Areas = append(want.Areas, placementArea{Code: c, LevelID: best})
			}
		}
		if samePlacement(want, current) {
			continue
		}
		if _, _, err := applyPlacement(ctx, q, id, want, areas, levels, actor); err != nil {
			return touched, err
		}
		touched++
	}
	return touched, nil
}
