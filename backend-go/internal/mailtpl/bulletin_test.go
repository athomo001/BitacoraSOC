package mailtpl

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type bulletinCase struct {
	Form   map[string]string `json:"form"`
	Logo   string            `json:"logo"`
	Images []struct {
		DataURL string `json:"dataUrl"`
		Width   int    `json:"width"`
		Height  int    `json:"height"`
		Name    string `json:"name"`
	} `json:"images"`
	User *struct {
		FullName string `json:"fullName"`
		Username string `json:"username"`
	} `json:"user"`
	Color string `json:"color"`
}

// TestBulletinMatchesLegacy: el Boletín de Seguridad es el mismo HTML que
// arma el generador del legacy (testdata/bulletin, hecho con su código).
func TestBulletinMatchesLegacy(t *testing.T) {
	files, _ := filepath.Glob("testdata/bulletin/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		t.Run(name, func(t *testing.T) {
			raw, _ := os.ReadFile(f)
			var c bulletinCase
			if err := json.Unmarshal(raw, &c); err != nil {
				t.Fatal(err)
			}
			// Autor como en el legacy: nombre completo, o usuario, o el título de la app.
			autor := "Bitácora CDC"
			if c.User != nil {
				if strings.TrimSpace(c.User.FullName) != "" {
					autor = strings.TrimSpace(c.User.FullName)
				} else if c.User.Username != "" {
					autor = c.User.Username
				}
			}
			opts := BulletinOptions{
				Data: BulletinData{
					TituloBoletin: c.Form["tituloBoletin"], MarcaFabricante: c.Form["marcaFabricante"], CveIdentificadores: c.Form["cveIdentificadores"],
					Criticidad: c.Form["criticidad"], ProductosAfectados: c.Form["productosAfectados"], Impacto: c.Form["impacto"],
					Recomendacion: c.Form["recomendacion"], Referencias: c.Form["referencias"],
				},
				LogoSrc: c.Logo, Autor: autor, HeaderColor: c.Color,
			}
			for _, img := range c.Images {
				opts.Images = append(opts.Images, BulletinImage{Src: img.DataURL, Name: img.Name, Width: img.Width, Height: img.Height})
			}
			got := RenderBulletin(opts)
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

// En Referencias el texto que no es URL se escapa (el legacy lo dejaba pasar).
func TestBulletinReferencesEscapeText(t *testing.T) {
	got := formatNewsletterReferences(`<img src=x onerror=alert(1)> ver https://a.cl/x`)
	if strings.Contains(got, "<img") || !strings.Contains(got, `<a href="https://a.cl/x"`) {
		t.Fatalf("referencias sin escapar o sin enlace: %s", got)
	}
}
