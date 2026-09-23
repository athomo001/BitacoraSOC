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
func (f fakeModuleAccess) UserGroupScopes(context.Context, uuid.UUID) ([]string, error) {
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
	rec := runRequireModule(t, fakeModuleAccess{flags: modules.Flags{NOC: true}, scopes: []string{"both"}}, AuthenticatedUser{ID: uuid.New(), Role: "user"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
