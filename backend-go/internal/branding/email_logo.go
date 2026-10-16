package branding

import (
	"bytes"
	"crypto/sha256"
	"image"
	"image/png"
	"sync"

	"golang.org/x/image/draw"
)

// emailLogoMaxSide: los correos muestran el logo a unos 160 px de ancho; 480
// (el triple) se ve nítido en pantallas de alta densidad y pesa poco. Un logo
// subido tal cual (hay de 2 MB) viajaba completo en cada correo.
const emailLogoMaxSide = 480

var emailLogoCache struct {
	sync.Mutex
	key       [32]byte
	data      []byte
	mediaType string
}

// EmailLogo achica el logo de la marca para los correos, sin recortarlo y
// con su transparencia (PNG). Si ya es chico o no se puede leer (SVG, formato
// raro), lo deja igual. El resultado se guarda en memoria: el mismo logo no
// se procesa en cada envío, y uno nuevo se procesa al primer correo.
func EmailLogo(data []byte, contentType string) ([]byte, string) {
	if len(data) == 0 {
		return data, contentType
	}
	key := sha256.Sum256(data)
	emailLogoCache.Lock()
	defer emailLogoCache.Unlock()
	if emailLogoCache.data != nil && emailLogoCache.key == key {
		return emailLogoCache.data, emailLogoCache.mediaType
	}
	out, mediaType := shrinkLogo(data, contentType)
	emailLogoCache.key, emailLogoCache.data, emailLogoCache.mediaType = key, out, mediaType
	return out, mediaType
}

func shrinkLogo(data []byte, contentType string) ([]byte, string) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, contentType
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= emailLogoMaxSide && h <= emailLogoMaxSide {
		return data, contentType
	}
	if w >= h {
		h, w = max(1, h*emailLogoMaxSide/w), emailLogoMaxSide
	} else {
		w, h = max(1, w*emailLogoMaxSide/h), emailLogoMaxSide
	}
	scaled := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, b, draw.Src, nil)
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&buf, scaled); err != nil || buf.Len() >= len(data) {
		return data, contentType
	}
	return buf.Bytes(), "image/png"
}
