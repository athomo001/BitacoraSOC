// Command mail-previews escribe un archivo .html por cada tipo de correo que
// envía la app, con datos de ejemplo, en docs/correos (más un README con la
// lista: qué correo es, su asunto y cuándo sale). Es para soporte: revisar
// cómo se ve cada correo sin buscarlo en el código. Usa el mismo catálogo que
// Administración → Correo → «Muestras de todos los correos», así que lo que
// se ve es lo que se envía. Las imágenes (logo, firma…) van una sola vez en
// docs/correos/img y los correos las enlazan.
//
// Lee la marca, la dotación y los ajustes de la Ticketera de la base:
//
//	go run ./cmd/mail-previews -database-url "postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable"
//
// Sin -database-url usa DATABASE_URL. Se corre de nuevo cada vez que cambia un correo.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/branding"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/handler"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/jackc/pgx/v5/pgxpool"
)

// generated: los archivos que escribe este comando (los demás de la carpeta no se tocan).
var generated = regexp.MustCompile(`^\d{2}-[a-z0-9-]+\.html$`)

func main() {
	dsn := flag.String("database-url", os.Getenv("DATABASE_URL"), "base de la app (marca, dotación y ajustes de la Ticketera)")
	out := flag.String("out", filepath.Join("..", "docs", "correos"), "carpeta de salida")
	base := flag.String("public-url", "https://bitacora.ejemplo.cl", "dirección pública que muestran los enlaces")
	flag.Parse()
	if *dsn == "" {
		log.Fatal("falta -database-url (o DATABASE_URL)")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	q := db.New(pool)
	h := &handler.MailSamplesHandler{Queries: q, PublicBaseURL: *base,
		Reports: &handler.ReportsHandler{Queries: q}, Dotacion: &handler.DotacionHandler{Queries: q}, Birthdays: &handler.BirthdaysHandler{Queries: q}}
	brand := branding.Load(ctx, q, true)
	previews, errs := h.Previews(ctx, time.Now())
	if len(errs) > 0 {
		log.Fatalf("no se pudieron armar: %s", strings.Join(errs, "; "))
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}
	old, err := os.ReadDir(*out)
	if err != nil {
		log.Fatal(err)
	}
	for _, e := range old {
		if generated.MatchString(e.Name()) {
			if err := os.Remove(filepath.Join(*out, e.Name())); err != nil {
				log.Fatal(err)
			}
		}
	}
	// img/ es solo de este comando: se rehace entera.
	imgDir := filepath.Join(*out, "img")
	if err := os.RemoveAll(imgDir); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(imgDir, 0o755); err != nil {
		log.Fatal(err)
	}
	var index strings.Builder
	index.WriteString(readmeHead)
	for i, p := range previews {
		name := fmt.Sprintf("%02d-%s.html", i+1, p.Slug)
		html := p.HTML
		for _, in := range p.Inline {
			file := imageName(in, brand.Logo)
			if err := os.WriteFile(filepath.Join(imgDir, file), in.Data, 0o644); err != nil {
				log.Fatal(err)
			}
			html = strings.ReplaceAll(html, "cid:"+in.CID, "img/"+file)
		}
		kind := "HTML"
		if p.PlainText {
			kind = "solo texto"
		}
		header := fmt.Sprintf("<!--\n  Correo: %s\n  Asunto: %s\n  Cuándo sale: %s\n  Formato: %s\n  Generado por backend-go/cmd/mail-previews con datos de ejemplo. No se edita a mano.\n-->\n",
			comment(p.Name), comment(p.Subject), comment(p.When), kind)
		if err := os.WriteFile(filepath.Join(*out, name), []byte(withHeader(html, header)), 0o644); err != nil {
			log.Fatal(err)
		}
		fmt.Fprintf(&index, "| %d | [%s](%s) | %s | %s | %s |\n", i+1, p.Name, name, cell(p.Subject), cell(p.When), kind)
	}
	if err := os.WriteFile(filepath.Join(*out, "README.md"), []byte(index.String()), 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%d correos → %s\n", len(previews), *out)
}

const readmeHead = `# Correos de la app

Un archivo por cada tipo de correo que envía Bitácora Ops, con datos de ejemplo. Se abren con doble clic en el navegador y se ven como le llegan a la persona. Las imágenes están en ` + "`img/`" + ` (en el correo real van adentro del mensaje).

**El logo sale de la marca** (Administración → Marca): ` + "`img/logo-marca`" + ` es el mismo en todos los correos que lo llevan, y ` + "`img/logo-marca-informe`" + ` es su versión con contorno para el informe de incidente. Los correos reales leen la marca al enviarse: si se cambia el logo o el nombre de la app, cambia en todos los correos desde el siguiente envío, sin tocar código. Esta carpeta, en cambio, es una foto: después de cambiar la marca, se vuelve a generar.

Los genera ` + "`backend-go/cmd/mail-previews`" + ` con el mismo código que arma los correos reales. **No se editan a mano:** si cambia un correo, se vuelven a generar desde ` + "`backend-go/`" + `:

` + "```" + `
go run ./cmd/mail-previews -database-url "postgres://…"
` + "```" + `

Las plantillas están en ` + "`backend-go/internal/mailtpl/`" + ` (las de la Ticketera, en ` + "`backend-go/internal/ticketmail/`" + `). Los correos con el formato del legacy usan sus plantillas tal cual.

| # | Correo | Asunto | Cuándo sale | Formato |
| --- | --- | --- | --- | --- |
`

func imageExt(contentType, name string) string {
	if ext := filepath.Ext(name); ext != "" {
		return strings.ToLower(ext)
	}
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	case "image/webp":
		return ".webp"
	}
	return ".png"
}

// imageName: el logo de la marca se llama siempre logo-marca (sale de
// Administración → Marca y es el mismo en todos los correos); lo que se
// arma a partir de él (el logo con contorno del informe de incidente) lleva
// el nombre del correo; el resto, el suyo. Mismo nombre, mismo archivo.
func imageName(in mail.Inline, brandLogo []byte) string {
	ext := imageExt(in.ContentType, in.Name)
	if len(brandLogo) > 0 && bytes.Equal(in.Data, brandLogo) {
		return "logo-marca" + ext
	}
	base := strings.TrimSuffix(strings.ToLower(in.Name), filepath.Ext(in.Name))
	if base == "logo-email" {
		return "logo-marca-informe" + ext
	}
	if base == "" {
		sum := sha256.Sum256(in.Data)
		base = hex.EncodeToString(sum[:6])
	}
	return base + ext
}

// withHeader pone el comentario después del doctype (antes, el navegador
// dibujaría el correo en modo antiguo).
func withHeader(html, header string) string {
	trimmed := strings.TrimLeft(html, " \t\r\n")
	if strings.HasPrefix(strings.ToLower(trimmed), "<!doctype") {
		if end := strings.Index(trimmed, ">"); end >= 0 {
			return trimmed[:end+1] + "\n" + header + trimmed[end+1:]
		}
	}
	return header + html
}

func comment(s string) string { return strings.ReplaceAll(s, "--", "–") }

func cell(s string) string { return strings.ReplaceAll(s, "|", "\\|") }
