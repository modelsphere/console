package pluginregistry

import (
	"context"
	"strings"
	"testing"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"helm.sh/helm/v3/pkg/release"
)

func TestReadRoutesValidatesProxySecretReference(t *testing.T) {
	manifest := reverseProxyManifest("/api/example/*") + "    authProxySecretRef:\n      name: example-proxy\n      key: proxyKey\n"
	meta := &pluginapi.PluginMeta{Group: "rise.io", APIVersion: "v1", Name: "example"}
	routes, err := readRoutes(manifest, meta)
	if err != nil || len(routes) != 1 {
		t.Fatalf("valid reference: routes=%v err=%v", routes, err)
	}
	for _, invalid := range []string{
		strings.Replace(manifest, "name: example-proxy", "name: ''", 1),
		strings.Replace(manifest, "name: example-proxy", "name: ../other", 1),
		strings.Replace(manifest, "key: proxyKey", "key: ''", 1),
		strings.Replace(manifest, "key: proxyKey", "key: bad/key", 1),
		strings.Replace(manifest, "key: proxyKey", "key: proxyKey\n      namespace: other", 1),
		strings.Replace(manifest, "authProxy: true", "authProxy: false", 1),
		strings.Replace(strings.Replace(manifest, "authProxy: true", "skipAuthentication: true", 1), "path: /api/example/*", "method: GET\n    path: /oapis/rise.io/v1/example/*", 1),
	} {
		if _, err := readRoutes(invalid, meta); err == nil {
			t.Fatalf("accepted invalid credential reference: %s", invalid)
		}
	}
}

func TestCredentialRouteNamespaceMatchesRelease(t *testing.T) {
	for _, namespace := range []string{"", "console-system", "other"} {
		t.Run(namespace, func(t *testing.T) {
			registry, _, plugin := registryFixture(t)
			installed := installedRelease()
			installed.Manifest = reverseProxyManifest("/api/example/*") + "    authProxySecretRef:\n      name: example-proxy\n      key: proxyKey\n"
			if namespace != "" {
				installed.Manifest = strings.Replace(installed.Manifest, "  name: example\n", "  name: example\n  namespace: "+namespace+"\n", 1)
			}
			registry.read = func(context.Context, string, string) (*release.Release, error) { return installed, nil }
			_, err := registry.load(t.Context(), plugin)
			if (err != nil) != (namespace == "other") {
				t.Fatalf("namespace %q: %v", namespace, err)
			}
		})
	}
}
