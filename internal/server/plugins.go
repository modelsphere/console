package server

import (
	"github.com/modelsphere/console/internal/config"
	"net/http"
	"strings"
)

type pluginManifest struct {
	Source      string             `json:"source,omitempty"`
	Folder      string             `json:"folder,omitempty"`
	Title       string             `json:"title,omitempty"`
	Children    []pluginManifest   `json:"children,omitempty"`
	ID          string             `json:"id,omitempty"`
	Entry       string             `json:"entry,omitempty"`
	Styles      []string           `json:"styles,omitempty"`
	Menu        *config.PluginMenu `json:"menu,omitempty"`
	Development bool               `json:"development,omitempty"`
}

func (s *Server) handlePluginIndex(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	plugins := s.pluginIndex()
	writeJSON(writer, http.StatusOK, plugins)
}

func (s *Server) handlePluginAsset(writer http.ResponseWriter, request *http.Request) {
	id, asset := request.PathValue("id"), request.PathValue("asset")
	for _, plugin := range s.cfg.RemotePlugins() {
		if plugin.ID == id {
			s.servePluginService(writer, request, plugin, asset)
			return
		}
	}
	http.NotFound(writer, request)
}

func pluginPaths(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/plugins/") && !config.ValidPluginAsset(strings.TrimPrefix(request.URL.Path, "/plugins/")) {
			http.NotFound(writer, request)
			return
		}
		next.ServeHTTP(writer, request)
	})
}
