package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelsphere/console/internal/config"
)

func TestNavigationFoldersAndNestedAssets(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/index.js" {
			t.Errorf("upstream path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte("nested SDK bundle"))
	}))
	defer upstream.Close()
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{Folder: "models", Title: "Models", Children: []config.Plugin{
		{ID: "inferences", Source: "builtin"},
		{Folder: "experiments", Title: "Experiments", Children: []config.Plugin{{ID: "canary", Source: "remote", URL: upstream.URL, Entry: "index.js", Menu: config.PluginMenu{Title: "Canary", Label: "Canary", Path: "/canary", Component: "Canary"}}}},
	}}}
	index := do(srv.Handler(), "GET", "/plugins/index.json", "", "")
	var nodes []pluginManifest
	if err := json.Unmarshal(index.Body.Bytes(), &nodes); err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Folder != "models" || nodes[0].Children[0].Source != "builtin" || nodes[0].Children[1].Children[0].Entry != "/plugins/canary/index.js" || strings.Contains(index.Body.String(), upstream.URL) {
		t.Fatalf("navigation tree: %s", index.Body.String())
	}
	if response := do(srv.Handler(), "GET", "/plugins/canary/index.js", "", ""); response.Code != 200 || response.Body.String() != "nested SDK bundle" {
		t.Fatalf("nested asset: %d %s", response.Code, response.Body.String())
	}
	for _, path := range []string{"/plugins/models/index.js", "/plugins/inferences/index.js"} {
		if response := do(srv.Handler(), "GET", path, "", ""); response.Code != 404 {
			t.Errorf("nonremote node %s: %d", path, response.Code)
		}
	}
}
