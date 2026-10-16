//go:build integration

// Imagen propia del correo de cumpleaños (pedido del dueño 2026-10-16)
// contra Postgres, dentro de una transacción que se deshace.
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBirthdayCustomImage(t *testing.T) {
	dsn := os.Getenv("BITACORA_TEST_DSN")
	if dsn == "" {
		t.Skip("BITACORA_TEST_DSN no definido")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // la transacción se deshace siempre
	if _, err := tx.Exec(ctx, `UPDATE app_config SET birthday_image = NULL, birthday_image_type = NULL`); err != nil {
		t.Fatal(err)
	}
	h := &BirthdaysHandler{Queries: db.New(tx), AuditLog: audit.NewLogger(&recordedAudit{}, slog.Default())}
	userCtx := middleware.WithUser(ctx, middleware.AuthenticatedUser{Role: "admin"})
	upload := func(name string, data []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("file", name)
		_, _ = fw.Write(data)
		_ = mw.Close()
		r := httptest.NewRequest("PUT", "/api/config/birthday-emails/image", &body).WithContext(userCtx)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		w := httptest.NewRecorder()
		h.PutImage(w, r)
		return w
	}
	config := func(w *httptest.ResponseRecorder) birthdayConfigDTO {
		var out struct {
			Data birthdayConfigDTO `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data
	}

	if w := upload("x.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)); w.Code != 400 {
		t.Fatalf("SVG no se ve en los correos: %d", w.Code)
	}
	big := image.NewNRGBA(image.Rect(0, 0, 1600, 800))
	big.Set(10, 10, color.NRGBA{G: 255, A: 255})
	var buf bytes.Buffer
	_ = png.Encode(&buf, big)
	w := upload("torta.png", buf.Bytes())
	if w.Code != 200 || !config(w).CustomImage || config(w).ImageVersion == "" {
		t.Fatalf("subir: %d %s", w.Code, w.Body)
	}
	pic, mime := h.birthdayPicture(ctx)
	cfg, _, err := image.DecodeConfig(bytes.NewReader(pic))
	if err != nil || mime != "image/png" || cfg.Width != 760 {
		t.Errorf("se guarda achicada: %s %d %v", mime, cfg.Width, err)
	}
	// El correo lleva la propia.
	_, inline := h.birthdayMail(ctx, "Ana")
	if !bytes.Equal(inline[0].Data, pic) || inline[0].ContentType != "image/png" {
		t.Error("el correo no usa la imagen propia")
	}

	r := httptest.NewRequest("DELETE", "/api/config/birthday-emails/image", nil).WithContext(userCtx)
	w = httptest.NewRecorder()
	h.DeleteImage(w, r)
	if w.Code != 200 || config(w).CustomImage {
		t.Fatalf("quitar: %d %s", w.Code, w.Body)
	}
	if pic, mime := h.birthdayPicture(ctx); !bytes.Equal(pic, mailtpl.BirthdayImage) || mime != "image/jpeg" {
		t.Error("sin imagen propia vuelve la incluida")
	}
}
