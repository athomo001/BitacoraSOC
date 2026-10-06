package branding

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestOutlinedLogoAddsWhiteBorderAroundOpaquePixels(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	src.SetNRGBA(5, 5, color.NRGBA{R: 200, A: 255})
	var buf bytes.Buffer
	_ = png.Encode(&buf, src)
	out, mime := OutlinedLogo(buf.Bytes(), "image/png")
	if mime != "image/png" {
		t.Fatalf("tipo %q", mime)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 14 {
		t.Fatalf("debe crecer 2 px por lado: %v", img.Bounds())
	}
	if r, g, b, a := img.At(7+2, 7).RGBA(); a == 0 || r != g || g != b {
		t.Fatalf("el borde es blanco: %v %v %v %v", r, g, b, a)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatal("lejos del logo sigue transparente")
	}
	if r, _, _, _ := img.At(7, 7).RGBA(); r>>8 != 200 {
		t.Fatal("el logo va encima del borde")
	}
	if data, mime := OutlinedLogo([]byte("<svg/>"), "image/svg+xml"); mime != "image/svg+xml" || string(data) != "<svg/>" {
		t.Fatal("un SVG pasa tal cual")
	}
}

// Un logo ancho y grande (escudo + nombre, 3722×1152 en producción) se achica
// entero, sin recortar: antes quedaba solo el escudo.
func TestOutlinedLogoScalesWideLogoWithoutCropping(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3600, 1200))
	for y := 500; y < 700; y++ {
		for x := 3400; x < 3590; x++ {
			src.SetNRGBA(x, y, color.NRGBA{B: 255, A: 255}) // algo opaco a la derecha del todo
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, src)
	out, _ := OutlinedLogo(buf.Bytes(), "image/png")
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 1004 || img.Bounds().Dy() != 337 {
		t.Fatalf("debe quedar en 1000×333 más el contorno, quedó %v", img.Bounds())
	}
	found := false
	for x := 960; x < 1004 && !found; x++ {
		if _, _, b, a := img.At(x, 168).RGBA(); a > 0 && b > 0x8000 {
			found = true
		}
	}
	if !found {
		t.Fatal("lo que estaba a la derecha del logo tiene que seguir ahí")
	}
}
