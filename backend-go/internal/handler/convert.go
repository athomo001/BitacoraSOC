package handler

import (
	"errors"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"
)

// Conversiones entre los tipos nullables de pgx y los punteros de los DTO
// JSON — un solo lugar para no repetir el mismo if Valid en cada handler.

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func uuidPtr(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	id := uuid.UUID(u.Bytes)
	return &id
}

func optionalUUID(u *uuid.UUID) pgtype.UUID {
	if u == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *u, Valid: true}
}

// nonEmptyText convierte un string opcional a pgtype.Text, tratando "" como
// "no se envió" (útil en PATCH con COALESCE).
func nonEmptyText(s *string) pgtype.Text {
	if s == nil || strings.TrimSpace(*s) == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: strings.TrimSpace(*s), Valid: true}
}

func optionalBool(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}

func queryUUID(raw string) (pgtype.UUID, error) {
	if raw == "" {
		return pgtype.UUID{}, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

func queryBool(raw string) pgtype.Bool {
	if raw == "" {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: raw == "true", Valid: true}
}

func queryText(raw string) pgtype.Text {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: raw, Valid: true}
}

// escapeLike neutraliza % y _ de una búsqueda libre antes de meterla en un
// ILIKE '%...%' (el escape por defecto de Postgres es la barra invertida).
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// slugify genera un slug estable (minúsculas ASCII y guiones) cuando el
// cliente no manda uno: "Cuadrilla Calama Norte" → "cuadrilla-calama-norte".
func slugify(s string) string {
	var b strings.Builder
	dash := true
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		switch {
		case unicode.Is(unicode.Mn, r):
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			dash = false
		case !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}
