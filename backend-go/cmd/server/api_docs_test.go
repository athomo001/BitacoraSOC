package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// TestEveryRouteIsDocumented compara las rutas que registra main.go con las
// tablas de docs/api.md, en los dos sentidos: una ruta nueva sin documentar
// (o una documentada que ya no existe) hace fallar el CI. Así la referencia
// de la API no se queda atrás (revisión del dueño 2026-10-16: faltaban 8).
func TestEveryRouteIsDocumented(t *testing.T) {
	fset := token.NewFileSet()
	mainFile, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	code := map[string]bool{}
	ast.Inspect(mainFile, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok || len(call.Args) != 2 {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "Handle" && sel.Sel.Name != "HandleFunc") {
			return true
		}
		lit, ok := call.Args[0].(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		pattern, err := strconv.Unquote(lit.Value)
		if err != nil {
			return true
		}
		if method, path, ok := strings.Cut(pattern, " "); ok && isHTTPMethod(method) {
			code[method+" "+path] = true
		}
		return true
	})
	if len(code) < 100 {
		t.Fatalf("solo se encontraron %d rutas en main.go: ¿cambió la forma de registrarlas?", len(code))
	}

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "api.md"))
	if err != nil {
		t.Fatal(err)
	}
	row := regexp.MustCompile("(?m)^\\| `(GET|POST|PUT|PATCH|DELETE)` \\| `([^`]+)`")
	docs := map[string]bool{}
	for _, m := range row.FindAllStringSubmatch(string(raw), -1) {
		path, _, _ := strings.Cut(m[2], "?") // la consulta (?area=…) es parte de la explicación
		docs[m[1]+" "+path] = true
	}

	var missing, stale []string
	for r := range code {
		if !docs[r] {
			missing = append(missing, r)
		}
	}
	for r := range docs {
		if !code[r] {
			stale = append(stale, r)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 {
		t.Errorf("rutas sin documentar en docs/api.md (agrega una fila `| MÉTODO | ruta | acceso |`):\n  %s", strings.Join(missing, "\n  "))
	}
	if len(stale) > 0 {
		t.Errorf("docs/api.md documenta rutas que ya no existen en main.go:\n  %s", strings.Join(stale, "\n  "))
	}
}

func isHTTPMethod(m string) bool {
	switch m {
	case "GET", "POST", "PUT", "PATCH", "DELETE":
		return true
	}
	return false
}
