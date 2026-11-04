package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/modelsphere/console/internal/config"
)

func pluginServer(t *testing.T, dir string) *Server {
	t.Helper()
	srv := New(&config.Config{}, nil, slog.New(slog.DiscardHandler), "test")
	if err := srv.SetPluginsDir(dir); err != nil {
		t.Fatal(err)
	}
	srv.SetWeb(fstest.MapFS{"index.html": {Data: []byte("SPA shell")}})
	return srv
}

func installPlugin(t *testing.T, root, folder, manifest string) string {
	t.Helper()
	dir := filepath.Join(root, folder)
	for name, contents := range map[string]string{
		"plugin.json":     manifest,
		"index.js":        "export const plugin = 'demo';\n",
		"style.css":       ".demo { color: red; }\n",
		"nested/extra.js": "export const extra = true;\n",
	} {
		filename := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestPluginsEmptyIndex(t *testing.T) {
	for _, tc := range []struct {
		name string
		dir  string
		web  bool
	}{
		{name: "disabled API only"},
		{name: "disabled with SPA", web: true},
		{name: "empty directory", dir: t.TempDir(), web: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := pluginServer(t, tc.dir)
			if !tc.web {
				srv.SetWeb(nil)
			}
			h := srv.Handler()
			rec := do(h, "GET", "/plugins/index.json", "", "")
			if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
				t.Fatalf("index: %d %s", rec.Code, rec.Body.String())
			}
			if !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("index headers: %v", rec.Header())
			}
			if rec := do(h, "GET", "/plugins/demo/index.js", "", ""); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "SPA shell") {
				t.Fatalf("uninstalled asset: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestPluginsDiscoverInstallRemoveLive(t *testing.T) {
	root := t.TempDir()
	h := pluginServer(t, root).Handler()
	check := func(want []pluginManifest) {
		t.Helper()
		rec := do(h, "GET", "/plugins/index.json", "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("index: %d %s", rec.Code, rec.Body.String())
		}
		var got []pluginManifest
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("plugins = %#v, want %#v", got, want)
		}
	}
	check([]pluginManifest{})
	demo := installPlugin(t, root, "demo", `{"id":"demo","entry":"index.js","styles":["style.css"]}`)
	check([]pluginManifest{{ID: "demo", Entry: "/plugins/demo/index.js", Styles: []string{"/plugins/demo/style.css"}}})
	other := installPlugin(t, root, "other-plugin", `{"id":"other-plugin","entry":"nested/extra.js"}`)
	check([]pluginManifest{
		{ID: "demo", Entry: "/plugins/demo/index.js", Styles: []string{"/plugins/demo/style.css"}},
		{ID: "other-plugin", Entry: "/plugins/other-plugin/nested/extra.js"},
	})
	if rec := do(h, "GET", "/plugins/index.json", "", ""); strings.Count(rec.Body.String(), `"styles"`) != 1 {
		t.Fatalf("optional styles were not omitted: %s", rec.Body.String())
	}
	if err := os.RemoveAll(demo); err != nil {
		t.Fatal(err)
	}
	check([]pluginManifest{{ID: "other-plugin", Entry: "/plugins/other-plugin/nested/extra.js"}})
	if rec := do(h, "GET", "/plugins/demo/index.js", "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("removed asset: %d %s", rec.Code, rec.Body.String())
	}
	if err := os.RemoveAll(other); err != nil {
		t.Fatal(err)
	}
	check([]pluginManifest{})
	installPlugin(t, root, "demo", `{"id":"demo","entry":"index.js"}`)
	check([]pluginManifest{{ID: "demo", Entry: "/plugins/demo/index.js"}})
}

func TestPluginAssets(t *testing.T) {
	root := t.TempDir()
	dir := installPlugin(t, root, "demo", `{"id":"demo","entry":"index.js","styles":["style.css"]}`)
	h := pluginServer(t, root).Handler()
	for _, tc := range []struct {
		path string
		body string
		mime string
	}{
		{path: "/plugins/demo/index.js", body: "export const plugin = 'demo';\n", mime: "javascript"},
		{path: "/plugins/demo/style.css", body: ".demo { color: red; }\n", mime: "text/css"},
		{path: "/plugins/demo/nested/extra.js", body: "export const extra = true;\n", mime: "javascript"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			rec := do(h, "GET", tc.path, "", "")
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("asset cache policy: %v", rec.Header())
			}
			if rec.Code != http.StatusOK || rec.Body.String() != tc.body || !strings.Contains(rec.Header().Get("Content-Type"), tc.mime) {
				t.Fatalf("asset: %d %v %q", rec.Code, rec.Header(), rec.Body.String())
			}
		})
	}
	if err := os.WriteFile(filepath.Join(dir, "theme #1?.css"), []byte(".escaped {}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(`{"id":"demo","entry":"index.js","styles":["theme #1?.css"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := do(h, "GET", "/plugins/index.json", "", "")
	var plugins []pluginManifest
	if err := json.Unmarshal(rec.Body.Bytes(), &plugins); err != nil || rec.Code != http.StatusOK || len(plugins) != 1 {
		t.Fatalf("updated manifest: %d %s (%v)", rec.Code, rec.Body.String(), err)
	}
	if got := plugins[0].Styles[0]; got != "/plugins/demo/theme%20%231%3F.css" {
		t.Fatalf("escaped URL = %q", got)
	}
	if rec := do(h, "GET", plugins[0].Styles[0], "", ""); rec.Code != http.StatusOK || rec.Body.String() != ".escaped {}" {
		t.Fatalf("escaped asset: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPluginsInvalidManifest(t *testing.T) {
	for _, tc := range []struct {
		name     string
		folder   string
		manifest string
		cause    string
	}{
		{name: "malformed JSON", manifest: `{`, cause: "plugin.json"},
		{name: "trailing JSON", manifest: `{"id":"demo","entry":"index.js"} {}`, cause: "plugin.json"},
		{name: "null", manifest: `null`, cause: "must match"},
		{name: "missing id", manifest: `{"entry":"index.js"}`, cause: "must match"},
		{name: "id mismatch", manifest: `{"id":"other","entry":"index.js"}`, cause: "must match"},
		{name: "uppercase directory", folder: "Demo", manifest: `{"id":"Demo","entry":"index.js"}`, cause: "lowercase kebab-case"},
		{name: "invalid kebab case", folder: "demo--bad", manifest: `{"id":"demo--bad","entry":"index.js"}`, cause: "lowercase kebab-case"},
		{name: "missing entry", manifest: `{"id":"demo"}`, cause: "relative file path"},
		{name: "dot entry", manifest: `{"id":"demo","entry":"."}`, cause: "relative file path"},
		{name: "absolute entry", manifest: `{"id":"demo","entry":"/index.js"}`, cause: "relative file path"},
		{name: "traversal entry", manifest: `{"id":"demo","entry":"../index.js"}`, cause: "relative file path"},
		{name: "backslash entry", manifest: `{"id":"demo","entry":"nested\\extra.js"}`, cause: "relative file path"},
		{name: "remote entry", manifest: `{"id":"demo","entry":"https://example.test/index.js"}`, cause: "relative file path"},
		{name: "missing entry file", manifest: `{"id":"demo","entry":"missing.js"}`, cause: "missing.js"},
		{name: "directory entry", manifest: `{"id":"demo","entry":"nested"}`, cause: "not a regular file"},
		{name: "invalid styles type", manifest: `{"id":"demo","entry":"index.js","styles":"style.css"}`, cause: "plugin.json"},
		{name: "empty style", manifest: `{"id":"demo","entry":"index.js","styles":[""]}`, cause: "relative file path"},
		{name: "absolute style", manifest: `{"id":"demo","entry":"index.js","styles":["/style.css"]}`, cause: "relative file path"},
		{name: "traversal style", manifest: `{"id":"demo","entry":"index.js","styles":["nested/../../style.css"]}`, cause: "relative file path"},
		{name: "missing style", manifest: `{"id":"demo","entry":"index.js","styles":["missing.css"]}`, cause: "missing.css"},
		{name: "directory style", manifest: `{"id":"demo","entry":"index.js","styles":["nested"]}`, cause: "not a regular file"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			installPlugin(t, root, "aaa-valid", `{"id":"aaa-valid","entry":"index.js"}`)
			folder := tc.folder
			if folder == "" {
				folder = "demo"
			}
			installPlugin(t, root, folder, tc.manifest)
			var logs bytes.Buffer
			srv := pluginServer(t, root)
			srv.log = slog.New(slog.NewTextHandler(&logs, nil))
			rec := do(srv.Handler(), "GET", "/plugins/index.json", "", "")
			if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "aaa-valid") || strings.Contains(rec.Body.String(), "SPA shell") {
				t.Fatalf("invalid manifest returned partial success: %d %s", rec.Code, rec.Body.String())
			}
			for _, want := range []string{"load installed plugins", folder, tc.cause} {
				if !strings.Contains(logs.String(), want) {
					t.Fatalf("log lacks %q: %s", want, logs.String())
				}
			}
		})
	}
}

func TestPluginsMissingManifest(t *testing.T) {
	root := t.TempDir()
	dir := installPlugin(t, root, "demo", `{"id":"demo","entry":"index.js"}`)
	h := pluginServer(t, root).Handler()
	if err := os.Remove(filepath.Join(dir, "plugin.json")); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/index.json", "", ""); rec.Code != http.StatusInternalServerError {
		t.Fatalf("missing manifest: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(h, "GET", "/plugins/demo/index.js", "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("uninstalled directory asset: %d %s", rec.Code, rec.Body.String())
	}
	if err := os.Mkdir(filepath.Join(dir, "plugin.json"), 0o755); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/index.json", "", ""); rec.Code != http.StatusInternalServerError {
		t.Fatalf("directory manifest: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPluginsRootValidation(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "not-a-directory")
	if err := os.WriteFile(file, []byte("file"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := pluginServer(t, "")
	for _, dir := range []string{filepath.Join(root, "missing"), file} {
		if err := srv.SetPluginsDir(dir); err == nil || !strings.Contains(err.Error(), dir) {
			t.Fatalf("SetPluginsDir(%q) = %v", dir, err)
		}
	}
	live := filepath.Join(root, "live")
	if err := os.Mkdir(live, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := srv.SetPluginsDir(live); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	srv.log = slog.New(slog.NewTextHandler(&logs, nil))
	h := srv.Handler()
	if err := os.Remove(live); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/index.json", "", ""); rec.Code != http.StatusInternalServerError {
		t.Fatalf("removed root: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(logs.String(), live) || !strings.Contains(logs.String(), "no such file") {
		t.Fatalf("missing root log: %s", logs.String())
	}
	if err := os.WriteFile(live, []byte("now a file"), 0o644); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/index.json", "", ""); rec.Code != http.StatusInternalServerError {
		t.Fatalf("non-directory root: %d %s", rec.Code, rec.Body.String())
	}
	if err := srv.SetPluginsDir(""); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/index.json", "", ""); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("disabled root: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPluginPathsNeverFallBackToSPA(t *testing.T) {
	root := t.TempDir()
	installPlugin(t, root, "demo", `{"id":"demo","entry":"index.js","styles":["style.css"]}`)
	h := pluginServer(t, root).Handler()
	for _, path := range []string{
		"/plugins", "/plugins/", "/plugins/demo", "/plugins/demo/",
		"/plugins/demo/nested", "/plugins/demo/nested/",
		"/plugins/demo/missing.js", "/plugins/demo/missing.css", "/plugins/missing/index.js",
		"/plugins/demo/index.html", "/plugins/demo/missing/index.html",
		"/plugins/demo/../other/index.js", "/plugins/demo/../../index.html",
		"/plugins/demo/%2e%2e/%2e%2e/index.html", "/plugins/demo/nested%2f..%2f..%2findex.html",
		"/plugins/demo/%5c..%5cindex.html", "/plugins/demo//index.js", "/plugins/demo/./index.js",
	} {
		t.Run(path, func(t *testing.T) {
			rec := do(h, "GET", path, "", "")
			if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "SPA shell") || rec.Header().Get("Location") != "" {
				t.Fatalf("expected direct 404: %d %v %s", rec.Code, rec.Header(), rec.Body.String())
			}
		})
	}
	if rec := do(h, "GET", "/client-side-route", "", ""); rec.Code != http.StatusOK || rec.Body.String() != "SPA shell" {
		t.Fatalf("SPA fixture is not active: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPluginSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.js"), []byte("private secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	dir := installPlugin(t, root, "demo", `{"id":"demo","entry":"index.js"}`)
	if err := os.Symlink(outside, filepath.Join(dir, "outside")); err != nil {
		t.Fatal(err)
	}
	h := pluginServer(t, root).Handler()
	rec := do(h, "GET", "/plugins/demo/outside/secret.js", "", "")
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "private secret") || strings.Contains(rec.Body.String(), "SPA shell") {
		t.Fatalf("symlink escaped plugin root: %d %s", rec.Code, rec.Body.String())
	}
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(`{"id":"demo","entry":"outside/secret.js"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/index.json", "", ""); rec.Code != http.StatusInternalServerError {
		t.Fatalf("escaping manifest asset: %d %s", rec.Code, rec.Body.String())
	}
	if err := os.Symlink(outside, filepath.Join(root, "escaped-plugin")); err != nil {
		t.Fatal(err)
	}
	if rec := do(h, "GET", "/plugins/escaped-plugin/secret.js", "", ""); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "private secret") {
		t.Fatalf("symlink escaped installation root: %d %s", rec.Code, rec.Body.String())
	}
}
