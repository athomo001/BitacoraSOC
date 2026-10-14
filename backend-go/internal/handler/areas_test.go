package handler

import "testing"

func TestSlugCode(t *testing.T) {
	cases := map[string]string{
		"Infraestructura":   "infraestructura",
		"Mesa de ayuda":     "mesa_de_ayuda",
		" Seguridad física": "seguridad_fisica",
		"TI / Redes":        "ti_redes",
		"N1":                "n1",
	}
	for in, want := range cases {
		if got := slugCode(in); got != want {
			t.Errorf("slugCode(%q) = %q, quería %q", in, got, want)
		}
	}
	if _, ok := cleanAreaName("  "); ok {
		t.Error("un nombre vacío no vale")
	}
	if _, ok := cleanAreaName("!!!"); ok {
		t.Error("un nombre sin letras ni números no da código")
	}
}
