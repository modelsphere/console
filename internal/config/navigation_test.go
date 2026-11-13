package config

import (
	"strings"
	"testing"
)

func TestFrontendDefaultsAndLegacySources(t *testing.T) {
	remote := Plugin{ID: "example", URL: "http://frontend:8080", Entry: "index.umd.js", Menu: PluginMenu{Title: "Example", Label: "Example", Path: "/example", Component: "Example"}}
	cfg := Config{Plugins: []Plugin{remote}}
	resolved := cfg.FrontendPlugins()
	if len(resolved) != 6 || resolved[0].Source != "builtin" || resolved[5].ID != "example" {
		t.Fatalf("legacy frontend tree: %+v", resolved)
	}
	cfg.Plugins[0].Source = "remote"
	if len(cfg.FrontendPlugins()) != 1 {
		t.Fatal("explicit remote configuration included defaults")
	}
}

func TestNestedFrontendTree(t *testing.T) {
	cfg := Config{Server: Server{Auth: Auth{Disabled: true}}, Plugins: []Plugin{
		{Folder: "models", Title: "模型", Children: []Plugin{
			{ID: "inferences", Source: "builtin"},
			{Folder: "experiments", Title: "实验", Children: []Plugin{{ID: "canary", Source: "remote", URL: "http://frontend:8080", Entry: "index.umd.js", Menu: PluginMenu{Title: "Canary", Label: "实验", Path: "/canary", Component: "Canary"}}}},
		}},
	}}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if len(cfg.FrontendPlugins()) != 1 || len(cfg.RemotePlugins()) != 1 || cfg.RemotePlugins()[0].ID != "canary" {
		t.Fatal("tree did not retain folder structure or remote leaves")
	}
}

func TestFrontendTreeValidation(t *testing.T) {
	cases := []struct {
		name  string
		nodes []Plugin
		want  string
	}{
		{"unknown builtin", []Plugin{{ID: "unknown", Source: "builtin"}}, "unknown built-in"},
		{"unknown source", []Plugin{{ID: "example", Source: "other"}}, "unknown source"},
		{"empty folder", []Plugin{{Folder: "empty", Title: "Empty"}}, "nonempty"},
		{"untitled folder", []Plugin{{Folder: "empty", Children: []Plugin{{ID: "docs", Source: "builtin"}}}}, "title"},
		{"mixed folder", []Plugin{{Folder: "mixed", Title: "Mixed", URL: "http://example.com", Children: []Plugin{{ID: "docs", Source: "builtin"}}}}, "folder cannot"},
		{"children on leaf", []Plugin{{ID: "docs", Source: "builtin", Children: []Plugin{}}}, "require a folder"},
		{"builtin resources", []Plugin{{ID: "docs", Source: "builtin", URL: "http://example.com"}}, "built-in modules cannot"},
		{"duplicate nested module", []Plugin{{ID: "docs", Source: "builtin"}, {Folder: "nested", Title: "Nested", Children: []Plugin{{ID: "docs", Source: "builtin"}}}}, "duplicate plugin"},
		{"duplicate folders", []Plugin{{Folder: "same", Title: "First", Children: []Plugin{{ID: "docs", Source: "builtin"}}}, {Folder: "same", Title: "Second", Children: []Plugin{{ID: "iam", Source: "builtin"}}}}, "duplicate folder"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			cfg := Config{Server: Server{Auth: Auth{Disabled: true}}, Plugins: test.nodes}
			if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("Validate() = %v, want %q", err, test.want)
			}
		})
	}
}

func TestExplicitEmptyFrontendTree(t *testing.T) {
	cfg := Config{Plugins: []Plugin{}}
	if got := cfg.FrontendPlugins(); got == nil || len(got) != 0 {
		t.Fatalf("explicit empty tree: %+v", got)
	}
}
