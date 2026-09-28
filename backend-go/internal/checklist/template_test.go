package checklist

import (
	"strings"
	"testing"
)

func TestValidateTemplateAceptaArbolEnOrdenDePantalla(t *testing.T) {
	items, err := ValidateTemplate("NOC Diaria", []TemplateItem{
		{Key: "a", Title: " Internet Corporativo "},
		{Key: "b", ParentKey: "a", Title: "Enlace Troncal"},
		{Key: "c", ParentKey: "b", Title: "Puerto 1"},
		{Key: "d", Title: "DNS"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if items[0].Title != "Internet Corporativo" {
		t.Fatalf("no recortó el título: %q", items[0].Title)
	}
}

func TestValidateTemplateRechazos(t *testing.T) {
	cases := map[string]struct {
		name  string
		items []TemplateItem
		want  string
	}{
		"sin nombre":           {"  ", []TemplateItem{{Key: "a", Title: "x"}}, "nombre"},
		"sin ítems":            {"P", nil, "al menos un ítem"},
		"ítem sin nombre":      {"P", []TemplateItem{{Key: "a", Title: " "}}, "sin nombre"},
		"clave repetida":       {"P", []TemplateItem{{Key: "a", Title: "x"}, {Key: "a", Title: "y"}}, "repetido"},
		"padre inexistente":    {"P", []TemplateItem{{Key: "a", ParentKey: "z", Title: "x"}}, "no está antes"},
		"hijo antes que padre": {"P", []TemplateItem{{Key: "b", ParentKey: "a", Title: "x"}, {Key: "a", Title: "y"}}, "no está antes"},
		"autorreferencia":      {"P", []TemplateItem{{Key: "a", ParentKey: "a", Title: "x"}}, "no está antes"},
		"demasiado profundo": {"P", []TemplateItem{
			{Key: "a", Title: "1"}, {Key: "b", ParentKey: "a", Title: "2"}, {Key: "c", ParentKey: "b", Title: "3"}, {Key: "d", ParentKey: "c", Title: "4"},
		}, "niveles"},
		"hermanos con el mismo nombre": {"P", []TemplateItem{{Key: "a", Title: "VPN"}, {Key: "b", Title: "vpn"}}, "repetido en el mismo nivel"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := ValidateTemplate(tc.name, tc.items)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, se esperaba %q", err, tc.want)
			}
		})
	}
}

func TestValidateTemplateMismoNombreEnDistintoNivelEsValido(t *testing.T) {
	_, err := ValidateTemplate("P", []TemplateItem{
		{Key: "a", Title: "Sede Norte"}, {Key: "b", ParentKey: "a", Title: "Router"},
		{Key: "c", Title: "Sede Sur"}, {Key: "d", ParentKey: "c", Title: "Router"},
	})
	if err != nil {
		t.Fatal(err)
	}
}
