package directory

import (
	"reflect"
	"strings"
	"testing"
)

func TestSanitize_DropsLegacyNullTokens(t *testing.T) {
	// Mismos tokens "vacíos" que sanitizeText() del legacy.
	for _, in := range []string{"n/a", " NA ", "null", "undefined", "Sin dato", "sin datos", "---", "—"} {
		if got := Sanitize(in, 50); got != "" {
			t.Errorf("Sanitize(%q) = %q, want vacío", in, got)
		}
	}
	if got := Sanitize("  Juan Pérez  ", 50); got != "Juan Pérez" {
		t.Errorf("trim: %q", got)
	}
	if got := Sanitize("ñandúñandú", 4); got != "ñand" {
		t.Errorf("el recorte debe ser por rune, no por byte: %q", got)
	}
}

func TestNormalizePhone(t *testing.T) {
	cases := map[string]string{
		"+56 9 1234 5678":  "+56912345678",
		"+56-9-1234-5678":  "+56912345678",
		"(9) 1234-5678":    "912345678",
		"":                 "",
		"sin fono":         "",
		"+56 (2) 2345 678": "+5622345678",
	}
	for in, want := range cases {
		if got := NormalizePhone(in); got != want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLooksLikePhone(t *testing.T) {
	// Regla del legacy: dígitos/+/guiones/espacios y al menos 6 caracteres.
	if !LooksLikePhone("+56 9 1234") || LooksLikePhone("12345") || LooksLikePhone("juan 123456") {
		t.Fatal("LooksLikePhone no respeta la regla del legacy")
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got := NormalizeEmail("  Juan.Perez@Empresa.CL "); got != "juan.perez@empresa.cl" {
		t.Fatalf("got %q", got)
	}
	if ValidEmail("no-es-correo") || !ValidEmail("a@b.cl") || ValidEmail("a@b.c") {
		t.Fatal("ValidEmail no respeta la regla del legacy (TLD de 2+ letras)")
	}
}

func TestNormalizeName(t *testing.T) {
	if NormalizeName("  José   PÉREZ ") != NormalizeName("jose perez") {
		t.Fatal("el nombre normalizado debe ignorar tildes, mayúsculas y espacios repetidos")
	}
}

func TestParseCSV_LegacyTemplate(t *testing.T) {
	// Plantilla oficial del legacy (con BOM de Excel) + la columna nueva Especialidad.
	csv := "\xef\xbb\xbfNombre,Correo,Teléfono,Empresa,Cargo,Tipo,Ámbito,Favorito,Especialidad\n" +
		"Juan Pérez,juan.perez@empresa.cl,+56912345678,Empresa Ejemplo,Analista SOC,External,External,false,Fibra Óptica\n" +
		"\"Soto, Ana\",ANA@X.CL,,\"Contrata \"\"Norte\"\"\",Supervisora,,Interno,sí,\n"
	rows, errs := ParseCSV(csv)
	if len(errs) != 0 {
		t.Fatalf("errores inesperados: %+v", errs)
	}
	want := []Row{
		{Line: 2, Name: "Juan Pérez", Email: "juan.perez@empresa.cl", Phone: "+56912345678", Organization: "Empresa Ejemplo", Position: "Analista SOC", Specialty: "Fibra Óptica", Scope: ScopeExternal},
		{Line: 3, Name: "Soto, Ana", Email: "ana@x.cl", Organization: `Contrata "Norte"`, Position: "Supervisora", Scope: ScopeInternal, IsFavorite: true},
	}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("rows =\n%+v\nwant\n%+v", rows, want)
	}
}

func TestParseCSV_EnglishHeadersAndErrors(t *testing.T) {
	csv := "name,email,phone,company\n" +
		",sin@nombre.cl,,\n" +
		"Pedro,correo-malo,,Acme\n" +
		"María,maria@acme.cl,,Acme\n"
	rows, errs := ParseCSV(csv)
	if len(rows) != 1 || rows[0].Name != "María" {
		t.Fatalf("rows = %+v", rows)
	}
	if len(errs) != 2 || errs[0].Line != 2 || errs[1].Line != 3 {
		t.Fatalf("errs = %+v", errs)
	}
	if !strings.Contains(errs[0].Reason, "nombre") || !strings.Contains(errs[1].Reason, "correo") {
		t.Fatalf("motivos poco claros: %+v", errs)
	}
}

func TestParseCSV_Empty(t *testing.T) {
	if _, errs := ParseCSV("\xef\xbb\xbf  \n"); len(errs) != 1 {
		t.Fatalf("un CSV vacío debe reportar 1 error, got %+v", errs)
	}
}

func TestGroupDuplicates(t *testing.T) {
	records := []Record{
		{ID: "a", EmailHash: "E1", NormName: "juan perez", OrganizationID: "org1"},
		{ID: "b", PhoneHash: "P1", NormName: "juan perez", OrganizationID: "org1"}, // mismo nombre+org que a
		{ID: "c", PhoneHash: "P1", NormName: "j. perez", OrganizationID: "org2"},   // mismo teléfono que b
		{ID: "d", NormName: "juan perez", OrganizationID: "org9"},                  // mismo nombre, OTRA org, sin dato común
		{ID: "e", EmailHash: "E2", NormName: "ana"},
	}
	groups := GroupDuplicates(records)
	if len(groups) != 1 {
		t.Fatalf("grupos = %v, want 1 (a+b+c)", groups)
	}
	if got := strings.Join(groups[0], ","); got != "a,b,c" {
		t.Fatalf("grupo = %s, want a,b,c (d NO: solo coincide el nombre, puede ser otra persona)", got)
	}
}
