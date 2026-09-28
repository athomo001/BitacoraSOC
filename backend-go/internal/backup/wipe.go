package backup

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// wipeKeeping vacía todas las tablas de la base salvo schema_migrations,
// conservando el contenido de `keep`.
//
// Por qué no un TRUNCATE que simplemente las excluya: TRUNCATE ... CASCADE
// también vacía toda tabla con FK hacia una truncada, sin mirar los datos.
// backup_runs, backup_config y system_features apuntan a users, así que
// "excluirlas" no alcanzaba: reemplazar borraba el historial de respaldos
// (incluida la copia de seguridad recién tomada) y purgar borraba el
// catálogo de funcionalidades. Y un DELETE fila a fila no sirve: hay tablas
// inmutables con triggers que rechazan DELETE (escalation_action_logs).
//
// Se copian a tablas temporales, se vacía todo y después restoreKept las
// vuelve a insertar.
func wipeKeeping(ctx context.Context, tx pgx.Tx, all, keep []string) error {
	for _, t := range keep {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE `+quote("keep_"+t)+` ON COMMIT DROP AS SELECT * FROM `+quote(t)); err != nil {
			return fmt.Errorf("no se pudo resguardar %s: %w", t, err)
		}
	}
	var targets []string
	for _, t := range all {
		if t != "schema_migrations" {
			targets = append(targets, quote(t))
		}
	}
	if len(targets) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, "TRUNCATE "+strings.Join(targets, ", ")+" RESTART IDENTITY CASCADE"); err != nil {
		return fmt.Errorf("no se pudieron vaciar las tablas: %w", err)
	}
	return nil
}

// restoreKept reinserta lo resguardado por wipeKeeping. Una referencia a una
// fila que ya no existe (el usuario que disparó un respaldo y no está en la
// copia restaurada) queda en NULL en vez de impedir la reinserción.
func restoreKept(ctx context.Context, tx pgx.Tx, keep []string) error {
	for _, t := range keep {
		rows, err := tx.Query(ctx, `
			SELECT a.attname, pc.relname, pa.attname
			FROM pg_constraint c
			JOIN pg_class child ON child.oid = c.conrelid
			JOIN pg_class pc ON pc.oid = c.confrelid
			JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
			JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
			JOIN pg_namespace n ON n.oid = child.relnamespace
			WHERE c.contype = 'f' AND n.nspname = 'public' AND child.relname = $1 AND array_length(c.conkey, 1) = 1`, t)
		if err != nil {
			return err
		}
		type ref struct{ column, parent, parentColumn string }
		var refs []ref
		for rows.Next() {
			var r ref
			if err := rows.Scan(&r.column, &r.parent, &r.parentColumn); err != nil {
				rows.Close()
				return err
			}
			refs = append(refs, r)
		}
		rows.Close()
		temp := quote("keep_" + t)
		for _, r := range refs {
			q := fmt.Sprintf(`UPDATE %s k SET %s = NULL WHERE k.%s IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%s = k.%s)`,
				temp, quote(r.column), quote(r.column), quote(r.parent), quote(r.parentColumn), quote(r.column))
			if _, err := tx.Exec(ctx, q); err != nil {
				return fmt.Errorf("no se pudo ajustar %s.%s: %w", t, r.column, err)
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO `+quote(t)+` SELECT * FROM `+temp); err != nil {
			return fmt.Errorf("no se pudo reinsertar %s: %w", t, err)
		}
	}
	return nil
}
