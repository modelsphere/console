package server

import (
	"net/http"
	"sort"
	"strings"

	"github.com/modelsphere/console/internal/config"
)

// pluginManifest is the descriptor the SPA reads from /plugins/index.json.
// Navigation and pages come from the plugin's own SDK registration; the
// descriptor only points at the files and API prefix the release provides.
type pluginManifest struct {
	ID      string                 `json:"id"`
	Group   string                 `json:"group,omitempty"`
	Version string                 `json:"version,omitempty"`
	Entry   string                 `json:"entry"`
	Styles  []string               `json:"styles,omitempty"`
	Backend *pluginBackendManifest `json:"backend,omitempty"`
}

type pluginBackendManifest struct {
	Name            string `json:"name"`
	Prefix          string `json:"prefix"`
	WritePermission string `json:"writePermission,omitempty"`
}

func (s *Server) handlePluginIndex(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, s.pluginIndex())
}

// pluginIndex lists the installed releases the registry currently serves.
// Everything comes from Plugin CR snapshots; Console holds no plugin
// registration of its own.
func (s *Server) pluginIndex() []pluginManifest {
	plugins := []pluginManifest{}
	if s.plugins == nil {
		return plugins
	}
	for _, entry := range s.plugins.Entries() {
		meta := entry.Plugin.Status.PluginMeta
		manifest := pluginManifest{ID: meta.Name, Group: meta.Group, Version: meta.Version, Entry: entry.Plugin.Status.FrontendStatus.EntryURL}
		for asset := range entry.Files {
			if strings.HasSuffix(asset, ".css") {
				manifest.Styles = append(manifest.Styles, "/plugins/"+entry.Plugin.Name+"/"+asset)
			}
		}
		sort.Strings(manifest.Styles)
		if len(entry.Routes) > 0 {
			manifest.Backend = &pluginBackendManifest{Name: meta.Name, Prefix: strings.TrimSuffix(entry.Routes[0].Spec.Matcher.Path, "/*"), WritePermission: meta.Name + ".write"}
		}
		plugins = append(plugins, manifest)
	}
	return plugins
}

func (s *Server) handlePluginAsset(writer http.ResponseWriter, request *http.Request) {
	id, asset := request.PathValue("id"), request.PathValue("asset")
	if !s.serveRegisteredPluginAsset(writer, request, id, asset) {
		http.NotFound(writer, request)
	}
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
