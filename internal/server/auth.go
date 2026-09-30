package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/modelsphere/console/internal/iam"
)

type ctxKey int

const identityKey ctxKey = iota

func withIdentity(ctx context.Context, id *iam.Identity) context.Context {
	return context.WithValue(ctx, identityKey, id)
}

// identityFrom returns the authenticated caller, or nil for anonymous requests.
func identityFrom(ctx context.Context) *iam.Identity {
	id, _ := ctx.Value(identityKey).(*iam.Identity)
	return id
}

// anonymousAdmin is the caller every request carries when auth.disabled is set.
// It is a synthetic identity, deliberately not a User CRD: nothing is looked up,
// so the mode works on a cluster where the iam CRDs were never installed.
// system:masters is what the authorizer short-circuits on, so the whole RBAC
// path stays wired up and simply always answers yes.
var anonymousAdmin = &iam.Identity{Name: "admin", Groups: []string{"system:masters"}}

// authenticate verifies the token on every request and stashes the caller in
// context. Public paths pass through anonymously; a guarded /api/* path with no
// valid token is rejected with a JSON 401 so the SPA's fetch layer sees an
// error envelope rather than the login HTML.
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.Server.Auth.Disabled {
			next.ServeHTTP(w, r.WithContext(withIdentity(r.Context(), anonymousAdmin)))
			return
		}
		if s.signer != nil {
			if tok := bearerToken(r); tok != "" {
				if id, err := s.signer.Verify(tok); err == nil {
					next.ServeHTTP(w, r.WithContext(withIdentity(r.Context(), id)))
					return
				}
			}
		}
		if isPublic(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusUnauthorized, "unauthenticated")
	})
}

func (s *Server) requirePasswordReset(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// There is no seeded password to rotate when nobody logs in.
		if s.cfg.Server.Auth.Disabled || !strings.HasPrefix(r.URL.Path, "/api/") || isPasswordResetPath(r) {
			next.ServeHTTP(w, r)
			return
		}
		id := identityFrom(r.Context())
		if id == nil || s.store == nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated")
			return
		}
		u, err := s.store.GetUser(r.Context(), id.Name)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated")
			return
		}
		if u.RequiresPasswordReset() {
			writeError(w, http.StatusForbidden, "请先修改初始密码")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isPasswordResetPath(r *http.Request) bool {
	return r.Method == http.MethodGet && r.URL.Path == "/api/me" ||
		r.Method == http.MethodPost && r.URL.Path == "/api/me/password"
}

// bearerToken reads the token from the Authorization header, falling back to a
// `token` cookie (browser requests) -- the same two sources Global accepts.
func bearerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		if parts := strings.SplitN(h, " ", 2); len(parts) == 2 && parts[0] == "Bearer" {
			return parts[1]
		}
	}
	if c, err := r.Cookie("token"); err == nil {
		return c.Value
	}
	return ""
}

func isPublic(path string) bool {
	switch {
	case path == "/healthz", path == "/readyz", path == "/login":
		return true
	case path == "/oauth/token", strings.HasPrefix(path, "/.well-known/"):
		return true
	case !strings.HasPrefix(path, "/api/") && !strings.HasPrefix(path, "/oauth/"):
		// SPA routes and static assets.
		return true
	}
	return false
}
