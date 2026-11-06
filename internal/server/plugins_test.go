package server

import (
	"github.com/modelsphere/console/internal/config"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

func pluginServer(t *testing.T) *Server {
	t.Helper()
	server := New(&config.Config{}, nil, slog.New(slog.DiscardHandler), "test")
	server.SetWeb(fstest.MapFS{"index.html": {Data: []byte("SPA shell")}})
	return server
}

func TestPluginsEmptyConfiguration(t *testing.T) {
	handler := pluginServer(t).Handler()
	response := do(handler, "GET", "/plugins/index.json", "", "")
	if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "[]" {
		t.Fatalf("index: %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("discovery must not be cached")
	}
	if missing := do(handler, "GET", "/plugins/example/index.js", "", ""); missing.Code != http.StatusNotFound {
		t.Fatalf("unconfigured asset: %d", missing.Code)
	}
}
