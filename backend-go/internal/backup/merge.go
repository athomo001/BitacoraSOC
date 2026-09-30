package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Restaurar sin "peros" (pedido del dueño): una copia de otra instalación se
// une aunque choque con lo actual.
//
//   - Si una fila de la copia choca con una existente por otra clave única
//     (mismo nombre de usuario, mismo código de organización…), se usa la
//     existente y todo lo que la referencia en la copia se reapunta a ella.
//   - Si una referencia queda sin destino (el padre no está en la copia ni en
//     la base), queda en NULL si la columna lo permite; si no, esa fila se salta.
//
// Todo pasa por una tabla temporal por tabla: se corrige ahí y recién después
// se inserta, así Postgres nunca ve una referencia rota.

type fkRef struct {
	column, colType, parent, parentColumn string
	nullable                              bool
}

// insertTableSafe inserta las filas de una tabla solo con las columnas que
// existen en ambos lados (una copia vieja deja que Postgres aplique el DEFAULT)
// y ON CONFLICT DO NOTHING (lo que ya existe no se toca), con las correcciones de
// arriba. Devuelve insertadas, total de la copia y saltadas.
func insertTableSafe(ctx context.Context, tx pgx.Tx, table string, payload json.RawMessage) (inserted, total, skipped int64, err error) {
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(payload, &rows); err != nil {
		return 0, 0, 0, err
	}
	if len(rows) == 0 {
		return 0, 0, 0, nil
	}
	total = int64(len(rows))
	colRows, err := tx.Query(ctx, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'`, table)
	if err != nil {
		return 0, 0, 0, err
	}
	current, err := pgx.CollectRows(colRows, pgx.RowTo[string])
	if err != nil {
		return 0, 0, 0, err
	}
	present := map[string]bool{}
	var cols []string
	for _, c := range current {
		if _, ok := rows[0][c]; ok {
			cols = append(cols, quote(c))
			present[c] = true
		}
	}
	sort.Strings(cols)
	list := strings.Join(cols, ", ")

	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE IF NOT EXISTS restore_idmap (tbl text, old_id text, new_id text) ON COMMIT DROP`); err != nil {
		return 0, 0, 0, err
	}
	if _, err := tx.Exec(ctx, `DROP TABLE IF EXISTS restore_rows`); err != nil {
		return 0, 0, 0, err
	}
	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE restore_rows ON COMMIT DROP AS SELECT `+list+` FROM json_populate_recordset(NULL::`+quote(table)+`, $1)`, []byte(payload)); err != nil {
		return 0, 0, 0, err
	}

	refs, err := foreignKeys(ctx, tx, table)
	if err != nil {
		return 0, 0, 0, err
	}
	for _, ref := range refs {
		if !present[ref.column] {
			continue
		}
		col := quote(ref.column)
		// Reapuntar a la fila existente que reemplazó al padre de la copia.
		if _, err := tx.Exec(ctx, `UPDATE restore_rows r SET `+col+` = CAST(m.new_id AS `+ref.colType+`)
			FROM restore_idmap m WHERE m.tbl = $1 AND m.old_id = r.`+col+`::text`, ref.parent); err != nil {
			return 0, 0, 0, fmt.Errorf("reapuntar %s.%s: %w", table, ref.column, err)
		}
		// Referencias sin destino. Un auto-referencia puede apuntar a otra
		// fila de la misma copia, que todavía no está insertada.
		orphan := col + ` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ` + quote(ref.parent) + ` p WHERE p.` + quote(ref.parentColumn) + ` = r.` + col + `)`
		if ref.parent == table && present[ref.parentColumn] {
			orphan += ` AND NOT EXISTS (SELECT 1 FROM restore_rows s WHERE s.` + quote(ref.parentColumn) + ` = r.` + col + `)`
		}
		if ref.nullable {
			_, err = tx.Exec(ctx, `UPDATE restore_rows r SET `+col+` = NULL WHERE `+orphan)
		} else {
			tag, e := tx.Exec(ctx, `DELETE FROM restore_rows r WHERE `+orphan)
			if err = e; err == nil {
				skipped += tag.RowsAffected()
			}
		}
		if err != nil {
			return 0, 0, 0, fmt.Errorf("referencias sin destino en %s.%s: %w", table, ref.column, err)
		}
	}

	tag, err := tx.Exec(ctx, `INSERT INTO `+quote(table)+` (`+list+`) OVERRIDING SYSTEM VALUE SELECT `+list+` FROM restore_rows ON CONFLICT DO NOTHING`)
	if err != nil {
		return 0, 0, 0, err
	}
	if err := recordReplacements(ctx, tx, table, present); err != nil {
		return 0, 0, 0, err
	}
	return tag.RowsAffected(), total, skipped, nil
}

// recordReplacements anota, para las filas de la copia que no entraron por
// chocar con otra clave única, cuál fila existente las reemplaza.
func recordReplacements(ctx context.Context, tx pgx.Tx, table string, present map[string]bool) error {
	var pk []string
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(array_agg(a.attname ORDER BY a.attnum), '{}')
		FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		WHERE i.indrelid = ('public.' || quote_ident($1))::regclass AND i.indisprimary`, table).Scan(&pk)
	if err != nil {
		return err
	}
	if len(pk) != 1 || !present[pk[0]] {
		return nil
	}
	// Índices únicos simples (sin expresión ni condición).
	rows, err := tx.Query(ctx, `
		SELECT array_agg(a.attname ORDER BY k.ord)
		FROM pg_index i
		CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
		JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
		WHERE i.indrelid = ('public.' || quote_ident($1))::regclass
		  AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL AND i.indexprs IS NULL
		GROUP BY i.indexrelid`, table)
	if err != nil {
		return err
	}
	uniques, err := pgx.CollectRows(rows, pgx.RowTo[[]string])
	if err != nil {
		return err
	}
	id := quote(pk[0])
	for _, cols := range uniques {
		var match []string
		usable := true
		for _, c := range cols {
			if !present[c] {
				usable = false
				break
			}
			match = append(match, `e.`+quote(c)+` = r.`+quote(c))
		}
		if !usable {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO restore_idmap (tbl, old_id, new_id)
			SELECT $1, r.`+id+`::text, e.`+id+`::text
			FROM restore_rows r JOIN `+quote(table)+` e ON `+strings.Join(match, " AND ")+`
			WHERE e.`+id+` <> r.`+id+`
			  AND NOT EXISTS (SELECT 1 FROM `+quote(table)+` x WHERE x.`+id+` = r.`+id+`)
			  AND NOT EXISTS (SELECT 1 FROM restore_idmap m WHERE m.tbl = $1 AND m.old_id = r.`+id+`::text)`, table); err != nil {
			return fmt.Errorf("equivalencias de %s: %w", table, err)
		}
	}
	return nil
}

// foreignKeys: referencias de una sola columna que salen de la tabla.
func foreignKeys(ctx context.Context, tx pgx.Tx, table string) ([]fkRef, error) {
	rows, err := tx.Query(ctx, `
		SELECT a.attname, format_type(a.atttypid, a.atttypmod), pc.relname, pa.attname, NOT a.attnotnull
		FROM pg_constraint c
		JOIN pg_class child ON child.oid = c.conrelid
		JOIN pg_class pc ON pc.oid = c.confrelid
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
		JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
		JOIN pg_namespace n ON n.oid = child.relnamespace
		WHERE c.contype = 'f' AND n.nspname = 'public' AND child.relname = $1 AND array_length(c.conkey, 1) = 1`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var refs []fkRef
	for rows.Next() {
		var r fkRef
		if err := rows.Scan(&r.column, &r.colType, &r.parent, &r.parentColumn, &r.nullable); err != nil {
			return nil, err
		}
		refs = append(refs, r)
	}
	return refs, rows.Err()
}
