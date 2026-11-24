package pluginregistry

import (
	"testing"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
)

func TestReadRoutesRejectsUnsupportedSecretExtension(t *testing.T) {
	meta := &pluginapi.PluginMeta{Group: "rise.io", APIVersion: "v1", Name: "example"}
	manifest := reverseProxyManifest("/api/example/*")
	if _, err := readRoutes(manifest, meta); err != nil {
		t.Fatalf("existing authProxy contract: %v", err)
	}
	manifest += "    authProxySecretRef:\n      name: example-proxy\n      key: proxyKey\n"
	if _, err := readRoutes(manifest, meta); err == nil {
		t.Fatal("accepted unsupported Secret extension")
	}
}
