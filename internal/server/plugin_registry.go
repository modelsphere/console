package server

import (
	"bytes"
	"fmt"
	"github.com/modelsphere/console/internal/config"
	"net/http"
	"strings"
	"time"
)

func (s *Server) serveRegisteredPluginAsset(w http.ResponseWriter, r *http.Request, id, asset string) bool {
	if s.plugins == nil {
		return false
	}
	for _, entry := range s.plugins.Entries() {
		if entry.Plugin.Name != id {
			continue
		}
		data, ok := entry.Files[asset]
		if !ok || !config.ValidPluginAsset(asset) {
			http.NotFound(w, r)
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, asset, time.Time{}, bytes.NewReader(data))
		return true
	}
	return false
}

func (s *Server) pluginBackends(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.plugins != nil {
			for _, entry := range s.plugins.Entries() {
				for _, route := range entry.Routes {
					prefix := strings.TrimSuffix(route.Spec.Matcher.Path, "*")
					method := route.Spec.Matcher.Method
					if !strings.HasPrefix(r.URL.Path, prefix) || (method != "" && method != "*" && method != r.Method) {
						continue
					}
					name := entry.Plugin.Status.PluginMeta.Name
					if !s.authorize(w, r, backendVerb(r.Method), backendResource, name) {
						return
					}
					upstream := route.Spec.Upstream
					backend := config.Backend{Name: name, Prefix: route.Spec.Directives.StripPathPrefix, URL: fmt.Sprintf("%s://%s:%d", upstream.Scheme, upstream.Host, upstream.Port)}
					if backend.Prefix == "" {
						backend.Prefix = "/"
					}
					resolve, err := s.targetFunc(backend)
					if err != nil {
						writeError(w, http.StatusBadGateway, "invalid plugin upstream")
						return
					}
					target, err := resolve(r.Context())
					if err != nil {
						writeError(w, http.StatusBadGateway, "plugin upstream unavailable")
						return
					}
					s.backendProxy(backend).ServeHTTP(w, r.WithContext(withTarget(r.Context(), target)))
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) registeredBackends() []config.Backend {
	backends := s.cfg.ConfiguredBackends()
	if s.plugins == nil {
		return backends
	}
	for _, entry := range s.plugins.Entries() {
		if len(entry.Routes) == 0 {
			continue
		}
		name := entry.Plugin.Status.PluginMeta.Name
		found := false
		for _, backend := range backends {
			if backend.Name == name {
				found = true
			}
		}
		if !found {
			backends = append(backends, config.Backend{Name: name, URL: "registered", WritePermission: name + ".write"})
		}
	}
	return backends
}
