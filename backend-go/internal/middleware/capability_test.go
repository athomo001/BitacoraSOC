package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type fakeCapabilities []string

func (f fakeCapabilities) UserCapabilities(context.Context, uuid.UUID) ([]string, error) {
	return f, nil
}

func runRequireCapability(caps fakeCapabilities, role string, required ...string) *httptest.ResponseRecorder {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	req := httptest.NewRequest(http.MethodDelete, "/api/directory/x", nil)
	req = req.WithContext(WithUser(req.Context(), AuthenticatedUser{ID: uuid.New(), Role: role}))
	rec := httptest.NewRecorder()
	RequireCapability(caps, required...)(ok).ServeHTTP(rec, req)
	return rec
}

func TestRequireCapability_AdminBypasses(t *testing.T) {
	if rec := runRequireCapability(nil, "admin", "directory:delete"); rec.Code != http.StatusNoContent {
		t.Fatalf("admin debe pasar sin grupos, got %d", rec.Code)
	}
}

func TestRequireCapability_UserWithoutCapability(t *testing.T) {
	rec := runRequireCapability(fakeCapabilities{"directory:write"}, "user", "directory:delete")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "missing-capability") {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestRequireCapability_UserWithCapability(t *testing.T) {
	if rec := runRequireCapability(fakeCapabilities{"directory:delete"}, "user", "directory:delete"); rec.Code != http.StatusNoContent {
		t.Fatalf("got %d", rec.Code)
	}
}
