package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/google/uuid"
)

type fakeModuleAccess struct {
	flags  modules.Flags
	scopes []string
}

func (f fakeModuleAccess) InstanceFlags(context.Context) (modules.Flags, error) { return f.flags, nil }
func (f fakeModuleAccess) UserModuleAreaCodes(context.Context, uuid.UUID) ([]string, error) {
	return f.scopes, nil
}

func runRequireModule(t *testing.T, access fakeModuleAccess, user AuthenticatedUser) *httptest.ResponseRecorder {
	t.Helper()
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := RequireModule(access, modules.NOC)(ok)
	req := httptest.NewRequest(http.MethodGet, "/api/territorial-units", nil)
	req = req.WithContext(WithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRequireModule_InstanceDisabledBlocksEvenAdmin(t *testing.T) {
	rec := runRequireModule(t, fakeModuleAccess{flags: modules.Flags{SOC: true}}, AuthenticatedUser{ID: uuid.New(), Role: "admin"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "module-disabled") {
		t.Fatalf("body sin type module-disabled: %s", rec.Body.String())
	}
}

func TestRequireModule_AdminPassesWhenEnabled(t *testing.T) {
	rec := runRequireModule(t, fakeModuleAccess{flags: modules.Flags{NOC: true}}, AuthenticatedUser{ID: uuid.New(), Role: "admin"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestRequireModule_UserOutsideScopeBlocked(t *testing.T) {
	rec := runRequireModule(t, fakeModuleAccess{flags: modules.Flags{SOC: true, NOC: true}, scopes: []string{"soc"}}, AuthenticatedUser{ID: uuid.New(), Role: "user"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "module-not-in-scope") {
		t.Fatalf("body sin type module-not-in-scope: %s", rec.Body.String())
	}
}

func TestRequireModule_UserInScopePasses(t *testing.T) {
	rec := runRequireModule(t, fakeModuleAccess{flags: modules.Flags{NOC: true}, scopes: []string{"soc", "noc"}}, AuthenticatedUser{ID: uuid.New(), Role: "user"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

type fakeAreas []string

func (f fakeAreas) UserAreaCodes(context.Context, uuid.UUID) ([]string, error) { return f, nil }

func TestRequireModuleOrOwnArea(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	user := AuthenticatedUser{ID: uuid.New(), Role: "user"}
	cases := []struct {
		name  string
		flags modules.Flags
		areas fakeAreas
		want  int
	}{
		{"gente de Infra pasa", modules.Flags{NOC: true}, fakeAreas{"infraestructura"}, http.StatusOK},
		{"solo SOC sin alcance NOC no pasa", modules.Flags{NOC: true}, fakeAreas{"soc"}, http.StatusForbidden},
		{"módulo apagado no pasa ni con área propia", modules.Flags{SOC: true}, fakeAreas{"infraestructura"}, http.StatusForbidden},
	}
	for _, c := range cases {
		h := RequireModuleOrOwnArea(fakeModuleAccess{flags: c.flags}, c.areas, modules.NOC)(ok)
		req := httptest.NewRequest(http.MethodGet, "/api/assets", nil)
		req = req.WithContext(WithUser(req.Context(), user))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", c.name, rec.Code, c.want)
		}
	}
}
