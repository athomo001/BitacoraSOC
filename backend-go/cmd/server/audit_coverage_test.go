package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Rutas de escritura que no auditan a propósito. Agregar una acá exige
// explicar por qué; lo normal es llamar a AuditLog.Log (spec/07 §6.1).
var auditExempt = map[string]string{
	"POST /api/drafts/sync":   "autoguardado de borradores cada pocos segundos; la entrada que resulta sí se audita al crearse",
	"DELETE /api/drafts/{id}": "descarta un borrador propio del autoguardado; nunca fue un dato de negocio",
	"PUT /api/notes/personal": "libreta privada con autoguardado cada 3 s (el legacy tampoco la auditaba)",
}

// TestEveryWriteRouteAudits recorre las rutas POST/PUT/PATCH/DELETE que
// registra main.go y comprueba que su handler llegue, directa o
// indirectamente dentro del paquete handler, a AuditLog.Log.
func TestEveryWriteRouteAudits(t *testing.T) {
	fset := token.NewFileSet()
	mainFile, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	g := loadHandlerCallGraph(t, fset, filepath.Join("..", "..", "internal", "handler"))

	// variable local → tipo del paquete handler (authHandler := &handler.AuthHandler{...})
	handlerVars := map[string]string{}
	ast.Inspect(mainFile, func(n ast.Node) bool {
		as, ok := n.(*ast.AssignStmt)
		if !ok || len(as.Lhs) != 1 || len(as.Rhs) != 1 {
			return true
		}
		if typ := handlerTypeOf(as.Rhs[0]); typ != "" {
			if id, ok := as.Lhs[0].(*ast.Ident); ok {
				handlerVars[id.Name] = typ
			}
		}
		return true
	})

	seen := 0
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
		if !ok {
			return true
		}
		pattern, _ := strconv.Unquote(lit.Value)
		method, _, _ := strings.Cut(pattern, " ")
		if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
			return true
		}
		seen++
		if _, ok := auditExempt[pattern]; ok {
			return true
		}
		if !routeAudits(call.Args[1], handlerVars, g) {
			t.Errorf("%s no llama a AuditLog.Log: audítala o agrégala a auditExempt con su motivo", pattern)
		}
		return true
	})
	if seen < 100 {
		t.Fatalf("solo se encontraron %d rutas de escritura: ¿cambió la forma de registrar rutas en main.go?", seen)
	}
	for pattern := range auditExempt {
		if !strings.Contains(string(mustRead(t, "main.go")), strconv.Quote(pattern)) {
			t.Errorf("auditExempt tiene %q, que ya no existe en main.go", pattern)
		}
	}
}

// routeAudits: una función en línea que llama a *.Log de un auditor, o un
// método de handler (el último argumento del envoltorio: admin(h.X)) que
// llega a AuditLog.Log.
func routeAudits(expr ast.Expr, handlerVars map[string]string, g *callGraph) bool {
	found := false
	ast.Inspect(expr, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.FuncLit:
			if callsAuditLog(x.Body) {
				found = true
			}
			return false
		case *ast.SelectorExpr:
			if id, ok := x.X.(*ast.Ident); ok {
				if typ, ok := handlerVars[id.Name]; ok && g.audits(typ+"."+x.Sel.Name) {
					found = true
				}
			}
		}
		return !found
	})
	return found
}

type callGraph struct {
	direct map[string]bool
	calls  map[string][]string
	memo   map[string]bool
	busy   map[string]bool
}

func (g *callGraph) audits(key string) bool {
	if v, ok := g.memo[key]; ok {
		return v
	}
	if g.busy[key] {
		return false
	}
	g.busy[key] = true
	res := g.direct[key]
	for _, callee := range g.calls[key] {
		if res {
			break
		}
		res = g.audits(callee)
	}
	g.memo[key] = res
	return res
}

// loadHandlerCallGraph arma, para cada función del paquete handler, si llama
// a AuditLog.Log y a qué otros métodos del mismo receptor o funciones del
// paquete llama (también las que pasa como argumento: RequireEnabled(w, r, h.X)).
func loadHandlerCallGraph(t *testing.T, fset *token.FileSet, dir string) *callGraph {
	t.Helper()
	g := &callGraph{direct: map[string]bool{}, calls: map[string][]string{}, memo: map[string]bool{}, busy: map[string]bool{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, e.Name()), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			key, recv := fd.Name.Name, ""
			if fd.Recv != nil {
				typ := fd.Recv.List[0].Type
				if star, ok := typ.(*ast.StarExpr); ok {
					typ = star.X
				}
				if id, ok := typ.(*ast.Ident); ok {
					recv = id.Name
					key = recv + "." + fd.Name.Name
				}
			}
			g.direct[key] = callsAuditLog(fd.Body)
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				targets := append([]ast.Expr{call.Fun}, call.Args...)
				for _, target := range targets {
					switch fn := target.(type) {
					case *ast.Ident:
						g.calls[key] = append(g.calls[key], fn.Name)
					case *ast.SelectorExpr:
						if _, ok := fn.X.(*ast.Ident); ok && recv != "" {
							g.calls[key] = append(g.calls[key], recv+"."+fn.Sel.Name)
						}
					}
				}
				return true
			})
		}
	}
	return g
}

// callsAuditLog: h.AuditLog.Log(...) o auditLog.Log(...).
func callsAuditLog(body ast.Node) bool {
	found := false
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return !found
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Log" {
			return true
		}
		switch x := sel.X.(type) {
		case *ast.SelectorExpr:
			found = found || x.Sel.Name == "AuditLog"
		case *ast.Ident:
			found = found || x.Name == "auditLog"
		}
		return !found
	})
	return found
}

// handlerTypeOf reconoce &handler.Tipo{...}.
func handlerTypeOf(expr ast.Expr) string {
	unary, ok := expr.(*ast.UnaryExpr)
	if !ok || unary.Op != token.AND {
		return ""
	}
	lit, ok := unary.X.(*ast.CompositeLit)
	if !ok {
		return ""
	}
	sel, ok := lit.Type.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "handler" {
		return sel.Sel.Name
	}
	return ""
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
