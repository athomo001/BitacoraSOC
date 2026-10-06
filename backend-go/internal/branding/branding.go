// Package branding lee la Marca de la instalación (comentario del dueño #8):
// el nombre que llevan la app y sus correos, el logo y los colores de los
// correos del legacy. Un solo lugar para que ningún correo invente el suyo.
package branding

import (
	"context"
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// Brand es lo que usan los correos.
type Brand struct {
	AppTitle        string
	IncidentPalette string
	BulletinColor   string
	Logo            []byte
	LogoType        string
	FaviconURL      string
}

// Load devuelve la marca; ante cualquier error, la de fábrica ("Bitácora
// Ops", paleta cdc-verde, boletín #EF5350), para que un correo nunca falle
// por la marca.
func Load(ctx context.Context, q *db.Queries, withLogo bool) Brand {
	b := Brand{AppTitle: mailtpl.DefaultAppTitle, IncidentPalette: "cdc-verde", BulletinColor: "#EF5350"}
	row, err := q.GetBranding(ctx)
	if err != nil {
		return b
	}
	if t := strings.TrimSpace(row.AppTitle); t != "" {
		b.AppTitle = t
	}
	if row.IncidentPalette != "" {
		b.IncidentPalette = row.IncidentPalette
	}
	if row.BulletinColor != "" {
		b.BulletinColor = row.BulletinColor
	}
	b.FaviconURL = row.FaviconUrl.String
	if withLogo && row.HasLogo {
		if logo, err := q.GetBrandingLogo(ctx); err == nil {
			b.Logo, b.LogoType = logo.Logo, logo.LogoType.String
		}
	}
	return b
}

// Title es el nombre visible de la app para asuntos y textos de correo.
func Title(ctx context.Context, q *db.Queries) string {
	return Load(ctx, q, false).AppTitle
}
