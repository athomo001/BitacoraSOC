package mailtpl

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// legacyCase es la entrada de testdata/incident/<caso>.json, tal como se la
// pasó gen-incident-golden.cjs a buildIncidentEmail del legacy.
type legacyCase struct {
	ReportData map[string]string `json:"reportData"`
	Images     []struct {
		Name string `json:"name"`
	} `json:"images"`
	LogoCid    *string `json:"logoCid"`
	Autor      string  `json:"autor"`
	BrandName  string  `json:"brandName"`
	PaletteKey string  `json:"paletteKey"`
}

// TestIncidentMatchesLegacy: el "Reporte de Detección" de la 2.0 es el mismo
// HTML, byte a byte, que genera el legacy (formato estándar del área).
func TestIncidentMatchesLegacy(t *testing.T) {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob("testdata/incident/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		t.Run(name, func(t *testing.T) {
			raw, _ := os.ReadFile(f)
			var c legacyCase
			if err := json.Unmarshal(raw, &c); err != nil {
				t.Fatal(err)
			}
			rd := c.ReportData
			opts := IncidentOptions{
				Data: IncidentData{
					CodigoTicket: rd["codigoTicket"], Ofensa: rd["ofensa"], TipoOperacion: rd["tipoOperacion"], NombreEvento: rd["nombreEvento"],
					Fecha: rd["fecha"], Criticidad: rd["criticidad"], MotivoEvento: rd["motivoEvento"], Observaciones: rd["observaciones"],
					Recomendacion: rd["recomendacion"], InformacionAdicional: rd["informacionAdicional"], OrigenConexion: rd["origenConexion"],
					Destino: rd["destino"], ReputacionOrigen: rd["reputacionOrigen"], EvidenciaTexto: rd["evidenciaTexto"], LogSource: rd["logSource"],
				},
				Autor: c.Autor, BrandName: c.BrandName, PaletteKey: c.PaletteKey, Location: loc,
			}
			if c.LogoCid != nil {
				opts.LogoSrc = *c.LogoCid
			}
			for i, img := range c.Images {
				opts.Images = append(opts.Images, IncidentImage{Name: img.Name, Src: fmt.Sprintf("cid:evidence-%d@bitacora-incident", i+1)})
			}
			got, err := RenderIncident(opts)
			if err != nil {
				t.Fatal(err)
			}
			want, _ := os.ReadFile(strings.TrimSuffix(f, ".json") + ".html")
			if got != string(want) {
				i := 0
				for i < len(got) && i < len(want) && got[i] == want[i] {
					i++
				}
				lo := max(0, i-120)
				t.Fatalf("difiere del legacy en el byte %d:\n2.0:    %q\nlegacy: %q", i, got[lo:min(len(got), i+120)], string(want[lo:min(len(want), i+120)]))
			}
		})
	}
}
