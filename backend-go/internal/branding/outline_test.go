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
