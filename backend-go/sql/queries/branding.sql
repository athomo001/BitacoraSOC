-- ===== Marca (comentario del dueño #8) =====

-- name: GetBranding :one
-- Sin los archivos: lo que necesitan la barra, el login y los correos.
SELECT app_title, title_font, font_name, incident_palette, bulletin_color, login_theme, favicon_url, version, updated_at,
  (logo IS NOT NULL)::boolean AS has_logo, (favicon IS NOT NULL)::boolean AS has_favicon, (font_file IS NOT NULL)::boolean AS has_font, logo_name
FROM app_branding WHERE id = true;

-- name: GetBrandingLogo :one
SELECT logo, logo_type FROM app_branding WHERE id = true AND logo IS NOT NULL;

-- name: GetBrandingFavicon :one
SELECT favicon, favicon_type FROM app_branding WHERE id = true AND favicon IS NOT NULL;

-- name: GetBrandingFont :one
SELECT font_file, font_type, font_name FROM app_branding WHERE id = true AND font_file IS NOT NULL;

-- name: UpdateBranding :exec
UPDATE app_branding SET
  app_title = COALESCE(sqlc.narg('app_title'), app_title),
  title_font = COALESCE(sqlc.narg('title_font'), title_font),
  incident_palette = COALESCE(sqlc.narg('incident_palette'), incident_palette),
  bulletin_color = COALESCE(sqlc.narg('bulletin_color'), bulletin_color),
  login_theme = CASE WHEN sqlc.arg('set_login_theme')::boolean THEN sqlc.narg('login_theme') ELSE login_theme END,
  favicon_url = CASE WHEN sqlc.arg('set_favicon_url')::boolean THEN sqlc.narg('favicon_url') ELSE favicon_url END,
  version = version + 1, updated_by = sqlc.narg('updated_by'), updated_at = now()
WHERE id = true;

-- name: SetBrandingLogo :exec
UPDATE app_branding SET logo = sqlc.narg('logo'), logo_type = sqlc.narg('logo_type'), logo_name = sqlc.narg('logo_name'),
  version = version + 1, updated_by = sqlc.narg('updated_by'), updated_at = now()
WHERE id = true;

-- name: SetBrandingFavicon :exec
UPDATE app_branding SET favicon = sqlc.narg('favicon'), favicon_type = sqlc.narg('favicon_type'),
  favicon_url = CASE WHEN sqlc.narg('favicon')::bytea IS NOT NULL THEN NULL ELSE favicon_url END,
  version = version + 1, updated_by = sqlc.narg('updated_by'), updated_at = now()
WHERE id = true;

-- name: SetBrandingFont :exec
UPDATE app_branding SET font_file = sqlc.narg('font_file'), font_type = sqlc.narg('font_type'), font_name = sqlc.narg('font_name'),
  title_font = CASE WHEN sqlc.narg('font_file')::bytea IS NULL THEN 'inter' ELSE 'custom' END,
  version = version + 1, updated_by = sqlc.narg('updated_by'), updated_at = now()
WHERE id = true;
