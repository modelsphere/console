package server

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httputil"
	"slices"
	"strings"
	"time"

	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/pluginregistry"
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
		request := localPluginRequest(r)
		if s.plugins != nil {
			for _, entry := range s.plugins.Entries() {
				for _, route := range entry.Routes {
					prefix := strings.TrimSuffix(route.Spec.Matcher.Path, "*")
					method := route.Spec.Matcher.Method
					if !strings.HasPrefix(request.URL.Path, prefix) || (method != "" && method != "*" && method != request.Method) {
						continue
					}
					name := entry.Plugin.Status.PluginMeta.Name
					if !route.Spec.Directives.SkipAuthentication && !s.allowPluginRequest(w, request, name) {
						return
					}
					s.servePluginRoute(w, request, name, entry.Plugin.Spec.Chart.Namespace, route)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) servePluginRoute(w http.ResponseWriter, r *http.Request, name, namespace string, route pluginregistry.Route) {
	upstream := route.Spec.Upstream
	backend := config.Backend{Name: name, Prefix: route.Spec.Directives.StripPathPrefix, URL: fmt.Sprintf("%s://%s:%d", upstream.Scheme, upstream.Host, upstream.Port)}
	if backend.Prefix == "" {
		backend.Prefix = "/"
	}
	resolve, err := s.targetFunc(backend)
	if err != nil {
		s.log.Error("invalid plugin upstream", "plugin", name, "error", err)
		writeError(w, http.StatusBadGateway, "invalid plugin upstream")
		return
	}
	target, err := resolve(r.Context())
	if err != nil {
		s.log.Warn("plugin upstream unavailable", "plugin", name, "error", err)
		writeError(w, http.StatusBadGateway, "plugin upstream unavailable")
		return
	}
	if err := s.setPluginCredential(r.Context(), namespace, route, target); err != nil {
		s.log.Warn("plugin proxy credential unavailable", "plugin", name, "error", err)
		writeError(w, http.StatusBadGateway, "plugin proxy credential unavailable")
		return
	}
	proxy := s.backendProxy(backend)
	if route.Spec.Directives.SkipAuthentication {
		rewrite := proxy.Rewrite
		proxy.Rewrite = func(request *httputil.ProxyRequest) {
			rewrite(request)
			request.Out.Header.Del("Authorization")
			for key := range request.Out.Header {
				if strings.HasPrefix(http.CanonicalHeaderKey(key), "X-Remote-") {
					request.Out.Header.Del(key)
				}
			}
		}
	}
	proxy.ServeHTTP(w, r.WithContext(withTarget(r.Context(), target)))
}

func (s *Server) registeredBackends() []config.Backend {
	backends := s.cfg.ConfiguredBackends()
	if s.plugins == nil {
		return backends
	}
	for _, entry := range s.plugins.Entries() {
		if !slices.ContainsFunc(entry.Routes, func(route pluginregistry.Route) bool { return !route.Spec.Directives.SkipAuthentication }) {
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
