package mailtpl

import (
	"bytes"
	"image/jpeg"
	"path/filepath"
	"testing"
)

// TestBirthdayMatchesLegacy: mismo correo que buildBirthdayEmail del legacy
// (testdata/birthday, hecho con su código).
func TestBirthdayMatchesLegacy(t *testing.T) {
	cases := map[string]struct{ title, user, logo string }{
		"conlogo.json": {"Bitácora CDC", "Ana Pérez", "cid:" + BirthdayLogoCID},
		"sinlogo.json": {"", "jrojas", ""},
	}
	for file, c := range cases {
		t.Run(file, func(t *testing.T) {
			var ignored map[string]any
			want := readGolden(t, filepath.Join("testdata/birthday", file), &ignored)
			m := Birthday(c.title, c.user, c.logo, "cid:"+BirthdayImageCID)
			sameAsLegacy(t, m.HTML, want)
			if m.Subject != "¡Feliz Cumpleaños "+c.user+"! 🎂" {
				t.Fatalf("asunto %q", m.Subject)
			}
		})
	}
}

func TestBirthdayImageIsSmallJPEG(t *testing.T) {
	img, err := jpeg.Decode(bytes.NewReader(BirthdayImage))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 760 || len(BirthdayImage) > 200<<10 {
		t.Fatalf("la ilustración debe ser liviana para correo: %dpx, %d bytes", img.Bounds().Dx(), len(BirthdayImage))
	}
}
