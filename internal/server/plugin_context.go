package server

import (
	"net/http"
	"strings"
)

// Global cluster prefixes are aliases in Console, never remote target selectors.
func localPluginRequest(request *http.Request) *http.Request {
	if !strings.HasPrefix(request.URL.Path, "/clusters/") {
		return request
	}
	_, suffix, found := strings.Cut(strings.TrimPrefix(request.URL.Path, "/clusters/"), "/")
	if !found || !strings.HasPrefix(suffix, "oapis/") {
		return request
	}
	local := request.Clone(request.Context())
	local.URL.Path = "/" + suffix
	local.URL.RawPath = ""
	return local
}

func (s *Server) allowPluginRequest(writer http.ResponseWriter, request *http.Request, name string) bool {
	identity := identityFrom(request.Context())
	if identity == nil {
		writeError(writer, http.StatusUnauthorized, "unauthenticated")
		return false
	}
	if strings.HasPrefix(request.URL.Path, "/oapis/") && !s.cfg.Server.Auth.Disabled {
		user, err := s.store.GetUser(request.Context(), identity.Name)
		if err != nil {
			writeError(writer, http.StatusUnauthorized, "unauthenticated")
			return false
		}
		if user.RequiresPasswordReset() {
			writeError(writer, http.StatusForbidden, "请先修改初始密码")
			return false
		}
	}
	return s.authorize(writer, request, backendVerb(request.Method), backendResource, name)
}
