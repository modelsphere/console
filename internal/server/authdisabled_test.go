package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/modelsphere/console/internal/config"
)

func disabledAuthServer(t *testing.T) *Server {
	t.Helper()
	cfg := &config.Config{}
	cfg.Server.Auth.Disabled = true
	return testServerWithConfig(t, cfg)
}

func TestAuthDisabledServesGuardedPathsWithoutAToken(t *testing.T) {
	h := disabledAuthServer(t).Handler()
	for _, path := range []string{"/api/me", "/api/iam/users", "/api/iam/roles", "/api/iam/loginrecords"} {
		if rec := do(h, "GET", path, "", ""); rec.Code != http.StatusOK {
			t.Errorf("%s: got %d, want 200", path, rec.Code)
		}
	}
}

func TestAuthDisabledMeIsTheAnonymousAdministrator(t *testing.T) {
	h := disabledAuthServer(t).Handler()
	rec := do(h, "GET", "/api/me", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/me: %d", rec.Code)
	}
	var me struct {
		Name                 string   `json:"name"`
		Groups               []string `json:"groups"`
		IsAdmin              bool     `json:"isAdmin"`
		Permissions          []string `json:"permissions"`
		RequirePasswordReset bool     `json:"requirePasswordReset"`
		AuthDisabled         bool     `json:"authDisabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatal(err)
	}
	if !me.IsAdmin || !me.AuthDisabled || me.RequirePasswordReset {
		t.Fatalf("me = %+v", me)
	}
	if len(me.Permissions) != 1 || me.Permissions[0] != "*" {
		t.Fatalf("permissions = %v, want [*]", me.Permissions)
	}
}

// The seeded administrator may still carry the reset annotation -- it is
// rendered by the same chart. With nobody logging in there is no password to
// change, so the guard must not lock the whole API behind a screen that cannot
// be satisfied.
func TestAuthDisabledIgnoresTheSeededPasswordReset(t *testing.T) {
	srv := disabledAuthServer(t)
	setRequirePasswordReset(t, srv, true)
	if rec := do(srv.Handler(), "GET", "/api/iam/users", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("/api/iam/users: got %d, want 200", rec.Code)
	}
}

func TestAuthEnabledStillRejectsAnUnauthenticatedRequest(t *testing.T) {
	if rec := do(testServer(t).Handler(), "GET", "/api/me", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("/api/me: got %d, want 401", rec.Code)
	}
}
