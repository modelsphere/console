package pluginregistry

import (
	"strings"
	"testing"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
)

func reverseProxyManifest(path string) string {
	return `apiVersion: iam.theriseunion.io/v1alpha1
kind: ReverseProxy
metadata:
  name: example
spec:
  matcher:
    path: ` + path + `
  upstream:
    scheme: http
    host: example.console-system.svc
    port: 8080
  directives:
    authProxy: true
`
}

func TestReadRoutesRejectsConsoleOwnedPrefixes(t *testing.T) {
	// pluginBackends matches before the native mux, so these would answer
	// Console's own API as a backend.
	for _, path := range []string{"/api/*", "/api/iam/*", "/api/me/*", "/api/router/*", "/api/capabilities/*"} {
		t.Run(path, func(t *testing.T) {
			_, err := readRoutes(reverseProxyManifest(path), &pluginapi.PluginMeta{})
			if err == nil || !strings.Contains(err.Error(), "reserved") {
				t.Fatalf("readRoutes(%q) error = %v, want a reserved-prefix error", path, err)
			}
		})
	}
}

func TestReadRoutesAcceptsAPluginOwnedPrefix(t *testing.T) {
	routes, err := readRoutes(reverseProxyManifest("/api/canary/*"), &pluginapi.PluginMeta{})
	if err != nil {
		t.Fatalf("readRoutes() error = %v", err)
	}
	if len(routes) != 1 || routes[0].Spec.Matcher.Path != "/api/canary/*" {
		t.Fatalf("routes = %+v", routes)
	}
}

func TestReadGlobalRoutes(t *testing.T) {
	meta := &pluginapi.PluginMeta{Group: "rise.io", APIVersion: "v1", Name: "dashboard"}
	for _, prefix := range []string{"/oapis/dashboard.rise.io/v1alpha1/*", "/oapis/dashboard-admin.rise.io/v1alpha1/*"} {
		if _, err := readRoutes(reverseProxyManifest(prefix), meta); err != nil {
			t.Fatalf("%s: %v", prefix, err)
		}
	}
	public := strings.Replace(reverseProxyManifest("/oapis/rise.io/v1/dashboard/*"), "path:", "method: GET\n    path:", 1)
	public = strings.Replace(public, "authProxy: true", "skipAuthentication: true", 1)
	if _, err := readRoutes(public, meta); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		strings.Replace(public, "method: GET", "method: POST", 1),
		strings.Replace(public, "/v1/dashboard/", "/v1/other/", 1),
		strings.Replace(public, "skipAuthentication: true", "skipAuthentication: true\n    authProxy: true", 1),
		strings.Replace(public, "/v1/dashboard/", "/v1/../", 1),
		strings.Replace(public, "skipAuthentication: true", "skipAuthentication: true\n    rewrite:\n      - from: foo\n        to: bar", 1),
	} {
		if _, err := readRoutes(invalid, meta); err == nil {
			t.Fatalf("accepted unsafe public route: %s", invalid)
		}
	}
}
