package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelsphere/console/internal/config"
)

func TestPluginImageService(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("frontend image received session credentials")
		}
		if r.URL.Path != "/frontend/index.umd.js" {
			t.Errorf("upstream path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/javascript")
		w.Header().Set("Set-Cookie", "untrusted=value")
		_, _ = w.Write([]byte("SDK bundle"))
	}))
	defer upstream.Close()
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{ID: "example", Source: "remote", URL: upstream.URL + "/frontend", Entry: "index.umd.js", Menu: config.PluginMenu{Title: "Example", Label: "Example", Path: "/example", Component: "Example"}}}
	index := do(srv.Handler(), "GET", "/plugins/index.json", "", "")
	var descriptors []pluginManifest
	if err := json.Unmarshal(index.Body.Bytes(), &descriptors); err != nil {
		t.Fatal(err)
	}
	if len(descriptors) != 1 || descriptors[0].Entry != "/plugins/example/index.umd.js" || descriptors[0].Menu.Component != "Example" || strings.Contains(index.Body.String(), upstream.URL) {
		t.Fatalf("discovery: %s", index.Body.String())
	}
	request := httptest.NewRequest("GET", "/plugins/example/index.umd.js", nil)
	request.Header.Set("Authorization", "Bearer test-session")
	request.Header.Set("Cookie", "token=test-session")
	response := httptest.NewRecorder()
	srv.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "SDK bundle" {
		t.Fatalf("asset: %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Set-Cookie") != "" {
		t.Fatal("frontend image set a Console cookie")
	}
}

func TestPluginImageUnavailableAndInvalidPaths(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Errorf("frontend received write method %s", request.Method)
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	srv := pluginServer(t)
	srv.cfg.Plugins = []config.Plugin{{ID: "example", URL: upstream.URL, Entry: "index.umd.js"}}
	for _, path := range []string{"/plugins/example/../private", "/plugins/example/%2e%2e/private", "/plugins/example/missing.js"} {
		if response := do(srv.Handler(), "GET", path, "", ""); response.Code != http.StatusNotFound {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	if response := do(srv.Handler(), "POST", "/plugins/example/index.umd.js", "", ""); response.Code != http.StatusNotFound {
		t.Fatalf("write method: %d", response.Code)
	}
	upstream.Close()
	if response := do(srv.Handler(), "GET", "/plugins/example/index.umd.js", "", ""); response.Code != http.StatusBadGateway {
		t.Fatalf("unavailable frontend: %d", response.Code)
	}
}
