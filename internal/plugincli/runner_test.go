package plugincli

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/modelsphere/console/internal/config"
)

func TestPluginIndexDistinguishesMissingPlugin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/console/plugins/index.json" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`[{"id":"other"}]`))
	}))
	defer server.Close()

	runner := Runner{CommandTimeout: time.Second}
	found, err := runner.PluginIndex(context.Background(), server.URL+"/console", "canary")
	if err != nil {
		t.Fatalf("PluginIndex() error = %v", err)
	}
	if found {
		t.Fatal("PluginIndex() reported a missing plugin as present")
	}
}

func TestMergeAndRemovePlugin(t *testing.T) {
	first := testConsolePlugin("first")
	second := testConsolePlugin("second")
	merged, err := mergePlugin([]config.Plugin{first}, second)
	if err != nil {
		t.Fatalf("mergePlugin() error = %v", err)
	}
	if len(merged) != 2 {
		t.Fatalf("mergePlugin() returned %d plugins, want 2", len(merged))
	}
	filtered, err := removePlugin(merged, "first")
	if err != nil {
		t.Fatalf("removePlugin() error = %v", err)
	}
	if len(filtered) != 1 || filtered[0].ID != "second" {
		t.Fatalf("removePlugin() returned %+v", filtered)
	}
}

func testConsolePlugin(id string) config.Plugin {
	return config.Plugin{
		ID:    id,
		URL:   "http://plugin.example/",
		Entry: "index.js",
		Menu: config.PluginMenu{
			Title:     id,
			Label:     id,
			Path:      "/" + id,
			Component: "Root",
		},
	}
}
