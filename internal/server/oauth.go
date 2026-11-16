package server

import (
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/modelsphere/console/internal/iam"
)

// handleToken is the OAuth2 token endpoint. Only the password grant is served
// -- the community portal has no need for the RSA/OIDC-provider machinery, and
// the token it mints is HS256, wire-compatible with Global.
func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	username := ""
	success := false
	reason := "invalid request"
	defer func() {
		_, err := s.store.CreateLoginRecord(r.Context(), username, iam.LoginRecordSpec{
			Type:      "password",
			Provider:  "local",
			SourceIP:  requestSourceIP(r),
			Success:   success,
			Reason:    reason,
			UserAgent: r.UserAgent(),
		})
		if err != nil {
			s.log.Warn("create login record", "user", username, "err", err)
		}
	}()

	parseErr := r.ParseForm()
	username = r.Form.Get("username")
	if parseErr != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if r.Form.Get("grant_type") != "password" {
		reason = "unsupported grant type"
		writeOAuthError(w, http.StatusBadRequest, "unsupported_grant_type")
		return
	}
	tok, err := s.authn.Login(r.Context(), username, r.Form.Get("password"))
	if err != nil {
		if errors.Is(err, iam.ErrAuth) {
			reason = iam.AuthFailureReason(err)
			writeOAuthError(w, http.StatusUnauthorized, "invalid_grant")
			return
		}
		reason = "login service failed"
		s.log.Error("login", "err", err)
		writeOAuthError(w, http.StatusInternalServerError, "server_error")
		return
	}
	success = true
	reason = ""
	writeJSON(w, http.StatusOK, tok)
}

func requestSourceIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		if first := strings.TrimSpace(strings.SplitN(forwarded, ",", 2)[0]); first != "" {
			return first
		}
	}
	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		return realIP
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return strings.Trim(r.RemoteAddr, "[]")
}

func writeOAuthError(w http.ResponseWriter, code int, oauthErr string) {
	writeJSON(w, code, map[string]string{"error": oauthErr})
}
