package branding

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, h/2, color.RGBA{R: 200, A: 255})
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestEmailPicture_AchicaSinRecortar(t *testing.T) {
	out, mt := EmailPicture(jpegOf(t, 2000, 1000), "image/jpeg", 760)
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil || mt != "image/jpeg" || cfg.Width != 760 || cfg.Height != 380 {
		t.Fatalf("%s %dx%d %v", mt, cfg.Width, cfg.Height, err)
	}
	png := pngOf(t, 500, 1500)
	out, mt = EmailPicture(png, "image/png", 760)
	cfg, _, _ = image.DecodeConfig(bytes.NewReader(out))
	if mt != "image/png" || cfg.Width != 253 || cfg.Height != 760 {
		t.Errorf("png alto: %s %dx%d", mt, cfg.Width, cfg.Height)
	}
}

func TestEmailPicture_ChicaGifOIlegibleQuedaIgual(t *testing.T) {
	small := jpegOf(t, 300, 300)
	if out, mt := EmailPicture(small, "image/jpeg", 760); !bytes.Equal(out, small) || mt != "image/jpeg" {
		t.Error("una imagen chica no se toca")
	}
	gif := []byte("GIF89a...")
	if out, mt := EmailPicture(gif, "image/gif", 760); !bytes.Equal(out, gif) || mt != "image/gif" {
		t.Error("un GIF queda igual (animación)")
	}
}
