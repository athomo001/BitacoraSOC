package handler

import (
	"strings"
	"testing"
)

func TestInsertGreetingGoesAboveTheReport(t *testing.T) {
	doc := insertGreeting(`<!doctype html><html><body style="x"><table>reporte</table></body></html>`, "Buenas noches Cristian,\n<b>Se informa</b>")
	if !strings.Contains(doc, `<body style="x"><div`) || !strings.Contains(doc, "Buenas noches Cristian,<br>&lt;b&gt;Se informa&lt;/b&gt;") {
		t.Fatalf("el saludo va escapado, después de <body>: %s", doc)
	}
	if frag := insertGreeting("<table>boletín</table>", "Hola"); !strings.HasPrefix(frag, "<div") {
		t.Fatalf("sin <body>, arriba del fragmento: %s", frag)
	}
	if insertGreeting("<table/>", "  ") != "<table/>" {
		t.Fatal("sin saludo no cambia nada")
	}
}

func TestGroupByDomainKeepsOrder(t *testing.T) {
	got := groupByDomain([]string{"a@dpp.cl", "b@junji.cl", "c@DPP.cl"})
	if len(got) != 2 || len(got[0]) != 2 || got[1][0] != "b@junji.cl" {
		t.Fatalf("un lote por dominio: %v", got)
	}
}

func TestHTMLToTextDropsStylesAndTags(t *testing.T) {
	text := htmlToText(`<html><head><style>.x{}</style></head><body><p>Hola&nbsp;mundo</p><br><td>CVE-1</td></body></html>`)
	if strings.Contains(text, ".x{}") || strings.Contains(text, "<") || !strings.Contains(text, "Hola") || !strings.Contains(text, "CVE-1") {
		t.Fatalf("texto: %q", text)
	}
}
