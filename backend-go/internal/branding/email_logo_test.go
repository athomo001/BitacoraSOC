package branding

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// Ruido para que no se comprima solo: como una foto o un logo con degradados.
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 7), G: uint8(y * 13), B: uint8(x * y), A: uint8(128 + (x+y)%128)})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestEmailLogo_AchicaSinRecortarYConTransparencia(t *testing.T) {
	big := pngOf(t, 2400, 800)
	out, mediaType := EmailLogo(big, "image/png")
	if mediaType != "image/png" || len(out) >= len(big) {
		t.Fatalf("no se achicó: %d → %d (%s)", len(big), len(out), mediaType)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 480 || b.Dy() != 160 {
		t.Fatalf("tamaño %dx%d, quería 480x160 (misma proporción)", b.Dx(), b.Dy())
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a == 0xffff {
		t.Fatal("perdió la transparencia")
	}
	// El mismo logo sale de la memoria.
	again, _ := EmailLogo(big, "image/png")
	if &again[0] != &out[0] {
		t.Fatal("se volvió a procesar")
	}
}

func TestEmailLogo_ChicoOIlegibleQuedaIgual(t *testing.T) {
	small := pngOf(t, 300, 100)
	if out, mt := EmailLogo(small, "image/png"); !bytes.Equal(out, small) || mt != "image/png" {
		t.Fatal("un logo chico no se toca")
	}
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="500"></svg>`)
	if out, mt := EmailLogo(svg, "image/svg+xml"); !bytes.Equal(out, svg) || mt != "image/svg+xml" {
		t.Fatal("un SVG se deja como está")
	}
}
