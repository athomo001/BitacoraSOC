package main

import (
	"os"
	"strings"
	"testing"
)

// El documento publicado tiene que coincidir con el esquema actual: si alguien
// cambia el esquema y no regenera, el CI falla acá.
func TestDocumentoAlDia(t *testing.T) {
	raw, err := os.ReadFile("../../sql/schema/0001_init_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables, order, err := parse(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	want, err := render(tables, order)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("../../../docs/modelo-de-datos.md")
	if err != nil {
		t.Fatal(err)
	}
	if strings.ReplaceAll(string(got), "\r\n", "\n") != want {
		t.Fatal("docs/modelo-de-datos.md no coincide con el esquema: regenerar con `go run ./cmd/er-docs` desde backend-go/")
	}
}

func TestParseAlter(t *testing.T) {
	sql := `
CREATE TABLE a (id UUID PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'unique', "timestamp" TIMESTAMPTZ, UNIQUE(mode, id));
CREATE TABLE b (id UUID PRIMARY KEY, a_id UUID, old TEXT, gone TEXT);
ALTER TABLE b
  ADD CONSTRAINT fk_b_a FOREIGN KEY (a_id) REFERENCES a(id),
  ADD COLUMN n NUMERIC(9,6);
ALTER TABLE b DROP COLUMN gone;
ALTER TABLE b RENAME COLUMN old TO nuevo;
ALTER TABLE b ALTER COLUMN a_id SET NOT NULL;
`
	tables, _, err := parse(sql)
	if err != nil {
		t.Fatal(err)
	}
	a, b := tables["a"], tables["b"]
	if c := a.col("mode"); c.unique {
		t.Error("DEFAULT 'unique' no debe marcar la columna como única")
	}
	if a.col("timestamp") == nil {
		t.Error("una columna entre comillas debe leerse sin comillas")
	}
	if c := b.col("a_id"); c.refTable != "a" || !c.notNull {
		t.Errorf("a_id: ref=%q notNull=%v", c.refTable, c.notNull)
	}
	if b.col("gone") != nil || b.col("nuevo") == nil || b.col("n") == nil {
		t.Error("DROP, RENAME o ADD COLUMN no se aplicaron")
	}
	if got := mermaidType(b.col("n").typ); got != "numeric" {
		t.Errorf("tipo: %q", got)
	}
}
