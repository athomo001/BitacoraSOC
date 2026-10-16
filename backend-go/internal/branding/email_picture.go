package branding

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
)

// EmailPicture deja una imagen subida para un correo (la del cumpleaños) en
// un tamaño razonable: si algún lado pasa de maxSide la achica sin recortar.
// Una foto sale en JPEG; un PNG sigue en PNG (puede tener transparencia). Un
// GIF queda igual para no perder la animación, y lo que no se puede leer
// también.
func EmailPicture(data []byte, contentType string, maxSide int) ([]byte, string) {
	if contentType == "image/gif" {
		return data, contentType
	}
	src, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, contentType
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxSide && h <= maxSide && contentType != "image/webp" {
		return data, contentType
	}
	if w > maxSide || h > maxSide {
		if w >= h {
			h, w = max(1, h*maxSide/w), maxSide
		} else {
			w, h = max(1, w*maxSide/h), maxSide
		}
	}
	scaled := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, b, draw.Src, nil)
	var buf bytes.Buffer
	if format == "png" {
		if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, scaled); err != nil {
			return data, contentType
		}
		return buf.Bytes(), "image/png"
	}
	// WebP no se ve en todos los clientes de correo: sale como JPEG.
	if err := jpeg.Encode(&buf, scaled, &jpeg.Options{Quality: 85}); err != nil {
		return data, contentType
	}
	return buf.Bytes(), "image/jpeg"
}
