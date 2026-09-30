package legacyetl

import (
	"context"
	"fmt"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
)

// verify revisa, dentro de la misma transacción y antes de confirmar, que
// lo migrado se lea con la llave 2.0 como lo leerá la app: cada canal de
// contacto se descifra y los índices ciegos de correo y teléfono coinciden
// (si no, la búsqueda del Directorio no los encontraría). Un error aborta
// la carga completa.
func (m *Migrator) verify(ctx context.Context) error {
	step := newStep("verificación", 0)
	m.rep.Steps = append(m.rep.Steps, step)

	rows, err := m.tx.Query(ctx, `SELECT value_encrypted FROM contact_channels`)
	if err != nil {
		return err
	}
	var values []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		values = append(values, v)
	}
	rows.Close()
	for _, v := range values {
		step.Read++
		if _, err := m.box.Decrypt(v); err != nil {
			return fmt.Errorf("un canal de contacto no se descifra con la llave 2.0")
		}
		step.Loaded++
	}

	type hashRow struct{ enc, hash *string }
	check := func(query string, normalize func(string) string, what string) error {
		rows, err := m.tx.Query(ctx, query)
		if err != nil {
			return err
		}
		var list []hashRow
		for rows.Next() {
			var r hashRow
			if err := rows.Scan(&r.enc, &r.hash); err != nil {
				rows.Close()
				return err
			}
			list = append(list, r)
		}
		rows.Close()
		for _, r := range list {
			if r.enc == nil || r.hash == nil {
				continue
			}
			plain, err := m.box.Decrypt(*r.enc)
			if err != nil || m.box.BlindIndex(normalize(plain)) != *r.hash {
				return fmt.Errorf("el índice de búsqueda de un %s no coincide", what)
			}
		}
		step.note("%d índices de %s correctos", len(list), what)
		return nil
	}
	if err := check(`SELECT email_encrypted, email_hash FROM contacts WHERE email_hash IS NOT NULL`, directory.NormalizeEmail, "correo"); err != nil {
		return err
	}
	if err := check(`SELECT phone_encrypted, phone_hash FROM contacts WHERE phone_hash IS NOT NULL`, directory.NormalizePhone, "teléfono"); err != nil {
		return err
	}

	var badUsers int
	if err := m.tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE password_hash NOT LIKE '$2%'`).Scan(&badUsers); err != nil {
		return err
	}
	if badUsers > 0 {
		return fmt.Errorf("%d usuarios sin contraseña bcrypt", badUsers)
	}
	step.note("%d canales de contacto se descifran con la llave 2.0; todas las contraseñas son bcrypt", step.Loaded)
	return nil
}
