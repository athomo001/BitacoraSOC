package territory

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// fakeStore simula territorial_units en memoria con upsert por code.
type fakeStore struct {
	byCode  map[string]UpsertResult
	failFor map[string]bool
	calls   []UpsertParams
}

func newFakeStore() *fakeStore {
	return &fakeStore{byCode: map[string]UpsertResult{}, failFor: map[string]bool{}}
}

func (s *fakeStore) Upsert(_ context.Context, p UpsertParams) (UpsertResult, error) {
	s.calls = append(s.calls, p)
	if s.failFor[p.Code] {
		return UpsertResult{}, errors.New("violación de constraint simulada")
	}
	if existing, ok := s.byCode[p.Code]; ok {
		existing.Path = p.Path
		existing.Inserted = false
		s.byCode[p.Code] = existing
		return existing, nil
	}
	res := UpsertResult{ID: uuid.New(), Path: p.Path, Inserted: true}
	s.byCode[p.Code] = res
	return res, nil
}

func ptr(f float64) *float64 { return &f }

func chileSample() []Node {
	return []Node{{
		Code: "CL", Kind: KindCountry, Name: "Chile",
		Children: []Node{{
			Code: "CL-AN", Kind: KindRegion, Name: "Antofagasta",
			Children: []Node{{Code: "CL-AN-CALAMA", Kind: KindZone, Name: "Calama", Latitude: ptr(-22.4667), Longitude: ptr(-68.9333)}},
		}},
	}}
}

func TestParseImport_AcceptsObjectOrArray(t *testing.T) {
	single, err := ParseImport([]byte(`{"code":"CL","kind":"country","name":"Chile"}`))
	if err != nil || len(single) != 1 {
		t.Fatalf("objeto: %v, %d nodos", err, len(single))
	}
	many, err := ParseImport([]byte(` [{"code":"CL","kind":"country","name":"Chile"},{"code":"AR","kind":"country","name":"Argentina"}]`))
	if err != nil || len(many) != 2 {
		t.Fatalf("array: %v, %d nodos", err, len(many))
	}
	if _, err := ParseImport([]byte(`{"code":`)); err == nil {
		t.Fatal("JSON malformado debe fallar")
	}
	if _, err := ParseImport([]byte(`[]`)); err == nil {
		t.Fatal("import vacío debe fallar")
	}
}

func TestValidateStructure_RejectsKindOutOfOrder(t *testing.T) {
	roots := []Node{{Code: "X", Kind: KindZone, Name: "Zona", Children: []Node{{Code: "Y", Kind: KindRegion, Name: "Región dentro de zona"}}}}
	errs := ValidateStructure(roots)
	if len(errs) != 1 || errs[0].Code != "Y" {
		t.Fatalf("errores = %+v, want 1 error sobre Y", errs)
	}
}

func TestValidateStructure_RejectsUnknownKind(t *testing.T) {
	errs := ValidateStructure([]Node{{Code: "X", Kind: "comuna", Name: "X"}})
	if len(errs) != 1 {
		t.Fatalf("errores = %+v, want 1", errs)
	}
}

func TestValidateStructure_AllowsSkippingLevels(t *testing.T) {
	// La plantilla oficial es país → región → sitio (sin zona): saltarse un
	// nivel es válido, lo que no se permite es subir.
	roots := []Node{{Code: "CL", Kind: KindCountry, Name: "Chile", Children: []Node{{Code: "CL-RM", Kind: KindRegion, Name: "RM", Children: []Node{{Code: "CL-RM-NODO1", Kind: KindSite, Name: "Nodo"}}}}}}
	if errs := ValidateStructure(roots); len(errs) != 0 {
		t.Fatalf("errores inesperados: %+v", errs)
	}
}

func TestImport_InsertsTreeWithLtreePaths(t *testing.T) {
	store := newFakeStore()
	res, err := Import(context.Background(), store, chileSample())
	if err != nil {
		t.Fatal(err)
	}
	if res.ImportedCount != 3 || res.UpdatedCount != 0 || len(res.Errors) != 0 {
		t.Fatalf("resultado = %+v", res)
	}
	if got := store.byCode["CL-AN-CALAMA"].Path; got != "CL.CL-AN.CL-AN-CALAMA" {
		t.Fatalf("path = %q", got)
	}
	// El hijo recibe el id real del padre, no un code.
	last := store.calls[2]
	if last.ParentID == nil || *last.ParentID != store.byCode["CL-AN"].ID {
		t.Fatalf("parentId de Calama no apunta a CL-AN: %+v", last.ParentID)
	}
	if store.calls[0].ParentID != nil {
		t.Fatal("un nodo raíz no debe tener parentId")
	}
}

func TestImport_IsIdempotent(t *testing.T) {
	store := newFakeStore()
	if _, err := Import(context.Background(), store, chileSample()); err != nil {
		t.Fatal(err)
	}
	res, err := Import(context.Background(), store, chileSample())
	if err != nil {
		t.Fatal(err)
	}
	if res.ImportedCount != 0 || res.UpdatedCount != 3 {
		t.Fatalf("reimport = %+v, want 0 importados / 3 actualizados", res)
	}
	if len(store.byCode) != 3 {
		t.Fatalf("reimport duplicó filas: %d", len(store.byCode))
	}
}

func TestImport_PartialSkipsOnlyTheBrokenBranch(t *testing.T) {
	roots := []Node{{
		Code: "CL", Kind: KindCountry, Name: "Chile",
		Children: []Node{
			{Code: "CL-VS", Kind: KindRegion, Name: "", Children: []Node{{Code: "CL-VS-RAPANUI", Kind: KindZone, Name: "Isla de Pascua"}}},
			{Code: "CL-AN", Kind: KindRegion, Name: "Antofagasta", Children: []Node{{Code: "CL-AN-CALAMA", Kind: KindZone, Name: "Calama"}}},
		},
	}}
	store := newFakeStore()
	res, err := Import(context.Background(), store, roots)
	if err != nil {
		t.Fatal(err)
	}
	if res.ImportedCount != 3 {
		t.Fatalf("importados = %d, want 3 (CL, CL-AN, CL-AN-CALAMA)", res.ImportedCount)
	}
	if len(res.Errors) != 1 || res.Errors[0].Code != "CL-VS" {
		t.Fatalf("errores = %+v, want 1 sobre CL-VS", res.Errors)
	}
	if !strings.Contains(res.Errors[0].Reason, "1 descendiente") {
		t.Fatalf("el error debe avisar cuántos descendientes se omitieron: %q", res.Errors[0].Reason)
	}
	if _, ok := store.byCode["CL-VS-RAPANUI"]; ok {
		t.Fatal("el hijo de una rama con error no debe importarse (quedaría huérfano)")
	}
}

func TestImport_StoreErrorIsReportedNotFatal(t *testing.T) {
	store := newFakeStore()
	store.failFor["CL-AN"] = true
	res, err := Import(context.Background(), store, chileSample())
	if err != nil {
		t.Fatal(err)
	}
	if res.ImportedCount != 1 || len(res.Errors) != 1 || res.Errors[0].Code != "CL-AN" {
		t.Fatalf("resultado = %+v", res)
	}
}

func TestImport_DuplicateCodeInPayload(t *testing.T) {
	roots := []Node{
		{Code: "CL", Kind: KindCountry, Name: "Chile"},
		{Code: "CL", Kind: KindCountry, Name: "Chile otra vez"},
	}
	res, err := Import(context.Background(), newFakeStore(), roots)
	if err != nil {
		t.Fatal(err)
	}
	if res.ImportedCount != 1 || len(res.Errors) != 1 {
		t.Fatalf("resultado = %+v", res)
	}
}

func TestImport_RejectsOutOfRangeCoordinates(t *testing.T) {
	roots := []Node{{Code: "X", Kind: KindSite, Name: "X", Latitude: ptr(95), Longitude: ptr(0)}}
	res, err := Import(context.Background(), newFakeStore(), roots)
	if err != nil {
		t.Fatal(err)
	}
	if res.ImportedCount != 0 || len(res.Errors) != 1 {
		t.Fatalf("resultado = %+v", res)
	}
}

func TestPathLabel_SanitizesForLtree(t *testing.T) {
	cases := map[string]string{
		"CL-AN-CALAMA": "CL-AN-CALAMA",
		"CL.RM":        "CL_RM",
		"ñuñoa 1":      "_u_oa_1",
	}
	for in, want := range cases {
		if got := PathLabel(in); got != want {
			t.Errorf("PathLabel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestKind_CanContain(t *testing.T) {
	if !KindCountry.CanContain(KindSite) {
		t.Fatal("country debe poder contener site")
	}
	if KindZone.CanContain(KindRegion) || KindZone.CanContain(KindZone) {
		t.Fatal("zone no puede contener region ni otra zone")
	}
}
