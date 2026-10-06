package branding

import (
	"bytes"
	"image"
	"image/color"
	_ "image/gif"  // decodificador gif
	_ "image/jpeg" // decodificador jpeg
	"image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // decodificador webp
)

// OutlinedLogo es buildIncidentEmailLogoVariant del legacy: el logo con un
// contorno blanco de 2 px alrededor de lo que no es transparente, para que se
// lea sobre el encabezado de color del "Reporte de Detección". Devuelve PNG;
// si no se puede (SVG, formato raro), el original con su tipo.
func OutlinedLogo(data []byte, contentType string) ([]byte, string) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, contentType
	}
	const radius = 2
	// Un logo grande se achica (sin recortar: antes se cortaba a 1600 px y de
	// un logo ancho "escudo + nombre" quedaba solo el escudo). El correo lo
	// muestra a 160 px; 1000 px de lado sobra y mantiene rápido el contorno.
	const maxSide = 1000
	if b := src.Bounds(); b.Dx() > maxSide || b.Dy() > maxSide {
		w, h := b.Dx(), b.Dy()
		if w >= h {
			h, w = max(1, h*maxSide/w), maxSide
		} else {
			w, h = max(1, w*maxSide/h), maxSide
		}
		scaled := image.NewNRGBA(image.Rect(0, 0, w, h))
		draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, b, draw.Src, nil)
		src = scaled
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	out := image.NewNRGBA(image.Rect(0, 0, w+2*radius, h+2*radius))
	alpha := func(x, y int) uint32 {
		if x < 0 || y < 0 || x >= w || y >= h {
			return 0
		}
		_, _, _, a := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
		return a
	}
	// Dilatación del canal alfa (feMorphology radius=2) pintada en blanco.
	for y := -radius; y < h+radius; y++ {
		for x := -radius; x < w+radius; x++ {
			var maxA uint32
			for dy := -radius; dy <= radius && maxA < 0xffff; dy++ {
				for dx := -radius; dx <= radius; dx++ {
					if dx*dx+dy*dy > radius*radius+1 {
						continue
					}
					if a := alpha(x+dx, y+dy); a > maxA {
						maxA = a
					}
				}
			}
			if maxA > 0 {
				out.SetNRGBA(x+radius, y+radius, color.NRGBA{R: 255, G: 255, B: 255, A: uint8(maxA >> 8)})
			}
		}
	}
	// El logo encima del contorno.
	draw.Draw(out, image.Rect(radius, radius, radius+w, radius+h), src, b.Min, draw.Over)
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return data, contentType
	}
	return buf.Bytes(), "image/png"
}
