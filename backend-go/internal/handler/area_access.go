package handler

import (
	"context"
	"net/http"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// txBeginner abre transacciones: el pgxpool, o en las pruebas una
// transacción externa que se deshace al final.
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// areaAccess dice qué áreas ve y cuáles edita el usuario en guardias y
// escalamiento (9e, spec/16 §3.6): ve las áreas de sus grupos (cualquier
// perfil) y edita las de las que es jefatura; el administrador, todas.
type areaAccess struct {
	all    bool
	view   map[string]bool
	manage map[string]bool
	// codeOf: id → código de todas las áreas (para guardias y políticas, que
	// guardan el id).
	codeOf map[uuid.UUID]string
	nameOf map[string]string
}

func loadAreaAccess(ctx context.Context, q *db.Queries) (areaAccess, error) {
	user, _ := middleware.UserFromContext(ctx)
	acc := areaAccess{view: map[string]bool{}, manage: map[string]bool{}, codeOf: map[uuid.UUID]string{}, nameOf: map[string]string{}}
	areas, err := q.ListAreas(ctx)
	if err != nil {
		return acc, err
	}
	for _, a := range areas {
		acc.codeOf[a.ID] = a.Code
		acc.nameOf[a.Code] = a.Name
	}
	if user.Role == "admin" {
		acc.all = true
		return acc, nil
	}
	codes, err := q.ListUserAreaCodes(ctx, user.ID)
	if err != nil {
		return acc, err
	}
	for _, c := range codes {
		acc.view[c] = true
	}
	leads, err := q.ListLeadAreas(ctx, user.ID)
	if err != nil {
		return acc, err
	}
	for _, a := range leads {
		acc.manage[a.Code] = true
		acc.view[a.Code] = true
	}
	return acc, nil
}

// code: el código del área de una guardia o política (vacío si no tiene).
func (a areaAccess) code(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	return a.codeOf[uuid.UUID(id.Bytes)]
}

// idOf: el id de un área por su código.
func (a areaAccess) idOf(code string) (uuid.UUID, bool) {
	for id, c := range a.codeOf {
		if c == code {
			return id, true
		}
	}
	return uuid.Nil, false
}

func (a areaAccess) canView(code string) bool   { return a.all || a.view[code] }
func (a areaAccess) canManage(code string) bool { return a.all || a.manage[code] }

// manageable: las áreas que el usuario edita (para que la pantalla muestre
// o esconda los botones). El admin: todas.
func (a areaAccess) manageable() []string {
	out := []string{}
	for id := range a.codeOf {
		if code := a.codeOf[id]; a.canManage(code) {
			out = append(out, code)
		}
	}
	return out
}

// mustLoadAreaAccess escribe el 500 si no se puede leer.
func mustLoadAreaAccess(w http.ResponseWriter, r *http.Request, q *db.Queries) (areaAccess, bool) {
	acc, err := loadAreaAccess(r.Context(), q)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer tus áreas")
		return acc, false
	}
	return acc, true
}

// requireManage responde 403 si el usuario no edita esa área.
func requireManage(w http.ResponseWriter, r *http.Request, acc areaAccess, code string) bool {
	if acc.canManage(code) {
		return true
	}
	problemdetails.Write(w, r, http.StatusForbidden, "area-not-managed", "solo la jefatura de esa área o un administrador puede cambiarlo")
	return false
}
