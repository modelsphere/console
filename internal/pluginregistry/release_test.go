package pluginregistry

import (
	"strings"
	"testing"
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
			_, err := readRoutes(reverseProxyManifest(path))
			if err == nil || !strings.Contains(err.Error(), "reserved") {
				t.Fatalf("readRoutes(%q) error = %v, want a reserved-prefix error", path, err)
			}
		})
	}
}

func TestReadRoutesAcceptsAPluginOwnedPrefix(t *testing.T) {
	routes, err := readRoutes(reverseProxyManifest("/api/canary/*"))
	if err != nil {
		t.Fatalf("readRoutes() error = %v", err)
	}
	if len(routes) != 1 || routes[0].Spec.Matcher.Path != "/api/canary/*" {
		t.Fatalf("routes = %+v", routes)
	}
}
