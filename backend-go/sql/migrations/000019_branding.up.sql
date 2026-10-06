-- 000019: Marca (comentario del dueño #8, canvas v19/v20 aprobado): cómo se
-- presenta la app y sus correos. Viene de appConfig del legacy (appTitle,
-- logoUrl, faviconUrl, titleFont, incidentEmailPaletteKey, loginTheme).
-- Los archivos van en Postgres, como las imágenes de la bitácora (sin disco
-- local: respaldos y HA los llevan solos).
CREATE TABLE app_branding (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  app_title TEXT NOT NULL DEFAULT 'Bitácora Ops',
  logo BYTEA,
  logo_type TEXT,
  logo_name TEXT,
  favicon BYTEA,
  favicon_type TEXT,
  -- Favicon externo (el legacy permitía una URL); sin favicon sale del logo.
  favicon_url TEXT,
  -- Fuente del título: 'inter' (la de la app) o 'custom' (subida, woff2/ttf).
  title_font TEXT NOT NULL DEFAULT 'inter',
  font_file BYTEA,
  font_type TEXT,
  font_name TEXT,
  -- Paleta del "Reporte de Detección" (las 6 del legacy) y color del boletín.
  incident_palette TEXT NOT NULL DEFAULT 'cdc-verde',
  bulletin_color TEXT NOT NULL DEFAULT '#EF5350',
  -- Tema del login por defecto (el usuario puede elegir otro en su navegador).
  login_theme TEXT,
  version INT NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_branding_logo_size CHECK (logo IS NULL OR octet_length(logo) <= 2097152),
  CONSTRAINT chk_branding_favicon_size CHECK (favicon IS NULL OR octet_length(favicon) <= 524288),
  CONSTRAINT chk_branding_font_size CHECK (font_file IS NULL OR octet_length(font_file) <= 2097152)
);
INSERT INTO app_branding (id) VALUES (true);
