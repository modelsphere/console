package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/modelsphere/console/internal/config"
)

func (s *Server) pluginIndex() ([]pluginManifest, error) {
	plugins, err := s.installedPlugins()
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(plugins))
	for _, plugin := range plugins {
		ids[plugin.ID] = true
	}
	for _, plugin := range s.cfg.Plugins {
		if ids[plugin.ID] {
			return nil, fmt.Errorf("plugin %q is configured more than once", plugin.ID)
		}
		ids[plugin.ID] = true
		prefix := "/plugins/" + plugin.ID + "/"
		manifest := pluginManifest{ID: plugin.ID, Entry: prefix + plugin.Entry, Menu: &plugin.Menu}
		for _, style := range plugin.Styles {
			manifest.Styles = append(manifest.Styles, prefix+style)
		}
		plugins = append(plugins, manifest)
	}
	return plugins, nil
}

func (s *Server) servePluginService(w http.ResponseWriter, r *http.Request, plugin config.Plugin, asset string) {
	if !config.ValidPluginAsset(asset) || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	upstream, err := url.Parse(plugin.URL)
	if err != nil {
		s.log.Error("parse frontend service URL", "plugin", plugin.ID, "error", err)
		writeError(w, http.StatusBadGateway, "invalid frontend service")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	proxy := httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.Out.URL.Path, request.Out.URL.RawPath = "/"+asset, ""
			request.SetURL(upstream)
			request.Out.Header = make(http.Header)
			for _, header := range []string{"Accept", "Accept-Encoding", "Range", "If-None-Match", "If-Modified-Since"} {
				if value := request.In.Header.Get(header); value != "" {
					request.Out.Header.Set(header, value)
				}
			}
		},
		ModifyResponse: func(response *http.Response) error {
			response.Header.Del("Set-Cookie")
			response.Header.Set("Cache-Control", "no-store")
			return nil
		},
		ErrorHandler: func(writer http.ResponseWriter, _ *http.Request, cause error) {
			s.log.Error("frontend service unavailable", "plugin", plugin.ID, "error", cause)
			writeError(writer, http.StatusBadGateway, "frontend service unavailable")
		},
	}
	proxy.ServeHTTP(w, r.WithContext(ctx))
}
