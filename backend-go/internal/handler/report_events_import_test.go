package handler

import "testing"

func TestParseEventsFile(t *testing.T) {
	rows, bad := parseEventsFile("Nombre,Categoría,Motivo,Activo\nPhishing,Correo,Se detectó un correo,sí\n,,,\nMalware,Endpoint,,no\n")
	if bad != "" || len(rows) != 2 {
		t.Fatalf("CSV: %q %d filas", bad, len(rows))
	}
	if rows[0].req.Parent != "Correo" || rows[0].req.MotivoDefault != "Se detectó un correo" || !*rows[0].req.Enabled {
		t.Errorf("fila 1: %+v", rows[0].req)
	}
	if rows[1].line != 4 || *rows[1].req.Enabled {
		t.Errorf("fila 2: línea %d %+v", rows[1].line, rows[1].req)
	}
	// El cuerpo del legacy: {"events": [...]} y también un arreglo suelto.
	for _, in := range []string{`{"events":[{"name":"A","parent":"P","motivoDefault":"m"}]}`, `[{"name":"A","parent":"P"}]`} {
		rows, bad := parseEventsFile(in)
		if bad != "" || len(rows) != 1 || rows[0].req.Name != "A" {
			t.Errorf("%s: %q %+v", in, bad, rows)
		}
	}
	if _, bad := parseEventsFile("categoria\nX\n"); bad == "" {
		t.Error("sin columna nombre debía fallar")
	}
	if _, bad := parseEventsFile("  "); bad == "" {
		t.Error("vacío debía fallar")
	}
}
