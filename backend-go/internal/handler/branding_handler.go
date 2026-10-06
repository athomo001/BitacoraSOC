package handler

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// BrandingHandler es Administración → Marca (comentario del dueño #8, canvas
// v19/v20): nombre visible, logo, favicon, fuente del título, paleta del
// "Reporte de Detección", color del boletín y tema del login por defecto. La
// lectura es pública porque el login y la pestaña la necesitan sin sesión.
type BrandingHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	// Hub avisa a todas las pestañas abiertas que la marca cambió.
	Hub eventPublisher
}

// changed avisa por SSE y responde con la marca nueva.
func (h *BrandingHandler) changed(w http.ResponseWriter, r *http.Request) {
	if dto, err := h.current(r); err == nil {
		publishSync(r.Context(), h.Hub, "config.branding.updated", dto)
	}
	h.Get(w, r)
}

type brandingDTO struct {
	AppTitle        string    `json:"appTitle"`
	HasLogo         bool      `json:"hasLogo"`
	LogoName        string    `json:"logoName,omitempty"`
	HasFavicon      bool      `json:"hasFavicon"`
	FaviconURL      string    `json:"faviconUrl,omitempty"`
	TitleFont       string    `json:"titleFont"`
	FontName        string    `json:"fontName,omitempty"`
	IncidentPalette string    `json:"incidentPalette"`
	BulletinColor   string    `json:"bulletinColor"`
	LoginTheme      string    `json:"loginTheme,omitempty"`
	Version         int32     `json:"version"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// Paletas del correo de incidente del legacy (incidentReport.js).
var incidentPalettes = map[string]bool{"cdc-verde": true, "noche-azul": true, "slate-pro": true, "carbon": true, "indigo": true, "bosque": true}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Temas del login portados del legacy (frontend/login-themes.ts).
var loginThemes = map[string]bool{"crt": true, "infoflow": true, "modern": true, "surrealism": true, "win311": true, "unix89": true}

func (h *BrandingHandler) current(r *http.Request) (brandingDTO, error) {
	row, err := h.Queries.GetBranding(r.Context())
	if err != nil {
		return brandingDTO{}, err
	}
	return brandingDTO{
		AppTitle: row.AppTitle, HasLogo: row.HasLogo, LogoName: row.LogoName.String, HasFavicon: row.HasFavicon,
		FaviconURL: row.FaviconUrl.String, TitleFont: row.TitleFont, FontName: row.FontName.String,
		IncidentPalette: row.IncidentPalette, BulletinColor: row.BulletinColor, LoginTheme: row.LoginTheme.String,
		Version: row.Version, UpdatedAt: row.UpdatedAt.Time,
	}, nil
}

// Get es GET /api/branding (público).
func (h *BrandingHandler) Get(w http.ResponseWriter, r *http.Request) {
	dto, err := h.current(r)
	if err != nil {
		// Sin fila (base vieja): la marca de fábrica.
		dto = brandingDTO{AppTitle: mailtpl.DefaultAppTitle, TitleFont: "inter", IncidentPalette: "cdc-verde", BulletinColor: "#EF5350"}
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeData(w, http.StatusOK, dto)
}

func serveAsset(w http.ResponseWriter, r *http.Request, data []byte, mime string) {
	w.Header().Set("Content-Type", mime)
	// El ?v=<versión> de la URL cambia con cada cambio de marca.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if mime == "image/svg+xml" {
		// Un SVG abierto directo no puede ejecutar scripts.
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
}

// Logo es GET /api/branding/logo (público).
func (h *BrandingHandler) Logo(w http.ResponseWriter, r *http.Request) {
	row, err := h.Queries.GetBrandingLogo(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no hay logo configurado")
		return
	}
	serveAsset(w, r, row.Logo, row.LogoType.String)
}

// Favicon es GET /api/branding/favicon (público): el propio, o el logo.
func (h *BrandingHandler) Favicon(w http.ResponseWriter, r *http.Request) {
	if row, err := h.Queries.GetBrandingFavicon(r.Context()); err == nil {
		serveAsset(w, r, row.Favicon, row.FaviconType.String)
		return
	}
	h.Logo(w, r)
}

// Font es GET /api/branding/font (público): la fuente del título subida.
func (h *BrandingHandler) Font(w http.ResponseWriter, r *http.Request) {
	row, err := h.Queries.GetBrandingFont(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no hay fuente subida")
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	serveAsset(w, r, row.FontFile, row.FontType.String)
}

type patchBrandingRequest struct {
	AppTitle        *string `json:"appTitle"`
	TitleFont       *string `json:"titleFont"`
	IncidentPalette *string `json:"incidentPalette"`
	BulletinColor   *string `json:"bulletinColor"`
	LoginTheme      *string `json:"loginTheme"`
	FaviconURL      *string `json:"faviconUrl"`
}

// Patch es PATCH /api/branding (admin).
func (h *BrandingHandler) Patch(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req patchBrandingRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	user, _ := middleware.UserFromContext(ctx)
	params := db.UpdateBrandingParams{UpdatedBy: pgtype.UUID{Bytes: user.ID, Valid: true}}
	if req.AppTitle != nil {
		title := strings.TrimSpace(*req.AppTitle)
		if title == "" || len([]rune(title)) > 60 {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el nombre visible no puede quedar vacío (hasta 60 caracteres)")
			return
		}
		params.AppTitle = pgtype.Text{String: title, Valid: true}
	}
	if req.TitleFont != nil {
		if *req.TitleFont != "inter" && *req.TitleFont != "custom" {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "titleFont es inter o custom")
			return
		}
		params.TitleFont = pgtype.Text{String: *req.TitleFont, Valid: true}
	}
	if req.IncidentPalette != nil {
		if !incidentPalettes[*req.IncidentPalette] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "paleta desconocida")
			return
		}
		params.IncidentPalette = pgtype.Text{String: *req.IncidentPalette, Valid: true}
	}
	if req.BulletinColor != nil {
		if !hexColor.MatchString(*req.BulletinColor) {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el color va como #RRGGBB")
			return
		}
		params.BulletinColor = pgtype.Text{String: strings.ToUpper(*req.BulletinColor), Valid: true}
	}
	if req.LoginTheme != nil {
		theme := strings.TrimSpace(*req.LoginTheme)
		if theme != "" && !loginThemes[theme] {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "tema de login desconocido")
			return
		}
		params.SetLoginTheme, params.LoginTheme = true, pgtype.Text{String: theme, Valid: theme != ""}
	}
	if req.FaviconURL != nil {
		raw := strings.TrimSpace(*req.FaviconURL)
		if raw != "" {
			u, err := url.Parse(raw)
			if err != nil || u.Scheme != "https" || u.Host == "" {
				problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el favicon externo debe ser una URL https")
				return
			}
		}
		params.SetFaviconUrl, params.FaviconUrl = true, pgtype.Text{String: raw, Valid: raw != ""}
	}
	if err := h.Queries.UpdateBranding(ctx, params); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar la marca")
		return
	}
	h.AuditLog.Log(ctx, "branding.updated", audit.LevelInfo, audit.Success(), map[string]any{
		"appTitle": req.AppTitle != nil, "titleFont": req.TitleFont != nil, "incidentPalette": req.IncidentPalette != nil,
		"bulletinColor": req.BulletinColor != nil, "loginTheme": req.LoginTheme != nil, "faviconUrl": req.FaviconURL != nil,
	})
	h.changed(w, r)
}

const maxBrandFile = 2 << 20

// readBrandFile lee el campo "file" de un multipart y lo valida.
func readBrandFile(w http.ResponseWriter, r *http.Request, limit int, allowed func([]byte, string) (string, bool)) ([]byte, string, string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, int64(limit)+64<<10)
	if err := r.ParseMultipartForm(int64(limit)); err != nil {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "payload-too-large", "el archivo supera el límite de "+strconv.Itoa(limit>>10)+" KB")
		return nil, "", "", false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "falta el archivo en el campo 'file'")
		return nil, "", "", false
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if err != nil || len(raw) > limit {
		problemdetails.Write(w, r, http.StatusRequestEntityTooLarge, "payload-too-large", "el archivo supera el límite de "+strconv.Itoa(limit>>10)+" KB")
		return nil, "", "", false
	}
	mime, ok := allowed(raw, header.Filename)
	if !ok {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "formato no soportado")
		return nil, "", "", false
	}
	return raw, mime, header.Filename, true
}

// brandImage acepta png, jpg, webp, gif e ico, y SVG (servido aislado).
func brandImage(raw []byte, _ string) (string, bool) {
	mime := http.DetectContentType(raw)
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon":
		return mime, true
	}
	head := strings.ToLower(string(raw[:min(len(raw), 512)]))
	if strings.Contains(head, "<svg") {
		return "image/svg+xml", true
	}
	return "", false
}

// brandFont acepta woff2, woff, ttf y otf (por su firma).
func brandFont(raw []byte, _ string) (string, bool) {
	if len(raw) < 4 {
		return "", false
	}
	switch string(raw[:4]) {
	case "wOF2":
		return "font/woff2", true
	case "wOFF":
		return "font/woff", true
	case "OTTO":
		return "font/otf", true
	case "\x00\x01\x00\x00", "true":
		return "font/ttf", true
	}
	return "", false
}

func (h *BrandingHandler) setFile(w http.ResponseWriter, r *http.Request, kind string) {
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	by := pgtype.UUID{Bytes: user.ID, Valid: true}
	var err error
	switch kind {
	case "logo":
		raw, mime, name, ok := readBrandFile(w, r, maxBrandFile, brandImage)
		if !ok {
			return
		}
		err = h.Queries.SetBrandingLogo(ctx, db.SetBrandingLogoParams{Logo: raw, LogoType: pgtype.Text{String: mime, Valid: true}, LogoName: pgtype.Text{String: name, Valid: true}, UpdatedBy: by})
	case "favicon":
		raw, mime, _, ok := readBrandFile(w, r, 512<<10, brandImage)
		if !ok {
			return
		}
		err = h.Queries.SetBrandingFavicon(ctx, db.SetBrandingFaviconParams{Favicon: raw, FaviconType: pgtype.Text{String: mime, Valid: true}, UpdatedBy: by})
	case "font":
		raw, mime, name, ok := readBrandFile(w, r, maxBrandFile, brandFont)
		if !ok {
			return
		}
		family := strings.TrimSpace(strings.TrimSuffix(name, name[strings.LastIndex(name, ".")+1:]))
		family = strings.TrimSuffix(family, ".")
		if family == "" {
			family = "Fuente propia"
		}
		err = h.Queries.SetBrandingFont(ctx, db.SetBrandingFontParams{FontFile: raw, FontType: pgtype.Text{String: mime, Valid: true}, FontName: pgtype.Text{String: family, Valid: true}, UpdatedBy: by})
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el archivo")
		return
	}
	h.AuditLog.Log(ctx, "branding."+kind+".set", audit.LevelInfo, audit.Success(), nil)
	h.changed(w, r)
}

func (h *BrandingHandler) clearFile(w http.ResponseWriter, r *http.Request, kind string) {
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	by := pgtype.UUID{Bytes: user.ID, Valid: true}
	var err error
	switch kind {
	case "logo":
		err = h.Queries.SetBrandingLogo(ctx, db.SetBrandingLogoParams{UpdatedBy: by})
	case "favicon":
		err = h.Queries.SetBrandingFavicon(ctx, db.SetBrandingFaviconParams{UpdatedBy: by})
	case "font":
		err = h.Queries.SetBrandingFont(ctx, db.SetBrandingFontParams{UpdatedBy: by})
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo quitar el archivo")
		return
	}
	h.AuditLog.Log(ctx, "branding."+kind+".removed", audit.LevelInfo, audit.Success(), nil)
	h.changed(w, r)
}

func (h *BrandingHandler) PutLogo(w http.ResponseWriter, r *http.Request) { h.setFile(w, r, "logo") }
func (h *BrandingHandler) PutFavicon(w http.ResponseWriter, r *http.Request) {
	h.setFile(w, r, "favicon")
}
func (h *BrandingHandler) PutFont(w http.ResponseWriter, r *http.Request) { h.setFile(w, r, "font") }
func (h *BrandingHandler) DeleteLogo(w http.ResponseWriter, r *http.Request) {
	h.clearFile(w, r, "logo")
}
func (h *BrandingHandler) DeleteFavicon(w http.ResponseWriter, r *http.Request) {
	h.clearFile(w, r, "favicon")
}
func (h *BrandingHandler) DeleteFont(w http.ResponseWriter, r *http.Request) {
	h.clearFile(w, r, "font")
}
