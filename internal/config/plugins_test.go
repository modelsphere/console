package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfiguredFrontendPlugin(t *testing.T) {
	valid := `server:
  auth:
    disabled: true
plugins:
  - id: example
    url: http://example-frontend:8080/assets
    entry: index.umd.js
    styles: [index.css]
    menu:
      title: Example
      label: Example
      path: /example
      component: Example
`
	file := filepath.Join(t.TempDir(), "console.yaml")
	if err := os.WriteFile(file, []byte(valid), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(file)
	if err != nil {
		t.Fatal(err)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestPluginConfigurationRejectsInvalidSources(t *testing.T) {
	valid := Plugin{ID: "example", URL: "http://frontend:8080", Entry: "index.umd.js", Menu: PluginMenu{Title: "Example", Label: "Example", Path: "/example", Component: "Example"}}
	for _, test := range []struct {
		name   string
		change func(*Plugin)
		want   string
	}{
		{"relative URL", func(plugin *Plugin) { plugin.URL = "/frontend" }, "absolute"},
		{"credential URL", func(plugin *Plugin) { plugin.URL = "http://user:password@frontend" }, "credentials"},
		{"entry traversal", func(plugin *Plugin) { plugin.Entry = "../private.js" }, "relative"},
		{"style URL", func(plugin *Plugin) { plugin.Styles = []string{"https://unconfigured/style.css"} }, "relative"},
		{"empty component", func(plugin *Plugin) { plugin.Menu.Component = "" }, "component"},
		{"reserved mount", func(plugin *Plugin) { plugin.Menu.Path = "/plugins" }, "reserved"},
	} {
		t.Run(test.name, func(t *testing.T) {
			plugin := valid
			test.change(&plugin)
			cfg := Config{Server: Server{Auth: Auth{Disabled: true}}, Plugins: []Plugin{plugin}}
			if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("Validate() = %v, want %q", err, test.want)
			}
		})
	}
	if err := (&Config{Plugins: []Plugin{valid, valid}}).Validate(); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate sources: %v", err)
	}
}
