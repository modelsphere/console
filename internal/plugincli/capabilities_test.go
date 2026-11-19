package plugincli

import (
	"strings"
	"testing"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
)

func TestResolveCapabilitiesMapsProviderValuePaths(t *testing.T) {
	consumed, err := resolveCapabilities(
		[]pluginapi.PluginCapabilityBinding{{Capability: capabilitySwissGateway, Version: "v1"}},
		[]capabilityProvider{testSwissProvider()},
		"console-system",
	)
	if err != nil {
		t.Fatalf("resolveCapabilities() error = %v", err)
	}
	published := consumed["modelsphere.dev/swiss"]
	if published["endpoint"] != "http://swiss-gateway.inference:8080" || published["apiKeyRef"] != "swiss-proxy" {
		t.Fatalf("published = %+v", published)
	}
}

func TestResolveCapabilitiesHonoursFromFilters(t *testing.T) {
	providers := []capabilityProvider{testSwissProvider()}
	for _, test := range []struct {
		name    string
		binding pluginapi.PluginCapabilityBinding
		want    string
	}{
		{
			name:    "pinned to another provider kind",
			binding: pluginapi.PluginCapabilityBinding{Capability: capabilitySwissGateway, From: &pluginapi.PluginCapabilitySource{Kind: platformProviderKind}},
			want:    "is not available",
		},
		{
			name:    "pinned to the providing plugin",
			binding: pluginapi.PluginCapabilityBinding{Capability: capabilitySwissGateway, From: &pluginapi.PluginCapabilitySource{Name: "swiss"}},
			want:    "",
		},
		{
			name:    "provider version outside the constraint",
			binding: pluginapi.PluginCapabilityBinding{Capability: capabilitySwissGateway, From: &pluginapi.PluginCapabilitySource{Version: ">=0.5.0"}},
			want:    "is not available",
		},
		{
			name:    "capability schema version mismatch",
			binding: pluginapi.PluginCapabilityBinding{Capability: capabilitySwissGateway, Version: "v2"},
			want:    "is not available",
		},
		{
			name:    "capability nobody provides",
			binding: pluginapi.PluginCapabilityBinding{Capability: "other.modelsphere.dev/thing"},
			want:    "no installed provider offers",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := resolveCapabilities([]pluginapi.PluginCapabilityBinding{test.binding}, providers, "console-system")
			if test.want == "" {
				if err != nil {
					t.Fatalf("resolveCapabilities() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("resolveCapabilities() error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestResolveCapabilitiesRejectsAmbiguousProviders(t *testing.T) {
	second := testSwissProvider()
	second.Version = "0.6.0"
	_, err := resolveCapabilities(
		[]pluginapi.PluginCapabilityBinding{{Capability: capabilitySwissGateway}},
		[]capabilityProvider{testSwissProvider(), second},
		"console-system",
	)
	if err == nil || !strings.Contains(err.Error(), "multiple providers") {
		t.Fatalf("resolveCapabilities() error = %v", err)
	}
}

func TestPreferPluginProvidersShadowsMatchingBuiltins(t *testing.T) {
	plugin := capabilityProvider{
		Kind:  pluginProviderKind,
		Group: "modelsphere.dev",
		Name:  "registry",
		Declarations: []pluginapi.PluginCapability{{
			Capability: capabilityImagePullSecrets,
			Version:    capabilityVersion,
		}},
	}
	platform := platformCapabilityProvider(consoleValues{}, "console-system")
	providers := preferPluginProviders([]capabilityProvider{platform, plugin})
	if len(providers) != 2 {
		t.Fatalf("providers = %+v", providers)
	}
	declarations := providers[0].Declarations
	if len(declarations) != 1 || declarations[0].Capability != capabilityInferenceNamespaces {
		t.Fatalf("builtin declarations = %+v", declarations)
	}
}

func TestLookupValuePathReportsMissingValues(t *testing.T) {
	values := map[string]any{"gateway": map[string]any{"auth": map[string]any{"secretRef": ""}}}
	if value, found := lookupValuePath(values, ".gateway.auth.secretRef"); !found || value != "" {
		t.Fatalf("lookupValuePath() = %v, %v", value, found)
	}
	for _, path := range []string{".gateway.missing", ".gateway.auth.secretRef.deeper"} {
		if _, found := lookupValuePath(values, path); found {
			t.Fatalf("lookupValuePath(%q) found a missing value", path)
		}
	}
}

func testSwissProvider() capabilityProvider {
	return capabilityProvider{
		Kind:      pluginProviderKind,
		Group:     "modelsphere.dev",
		Name:      "swiss",
		Version:   "0.4.1",
		Namespace: "console-system",
		Values: map[string]any{
			"gateway": map[string]any{
				"url":  "http://swiss-gateway.inference:8080",
				"auth": map[string]any{"secretRef": "swiss-proxy"},
			},
		},
		Declarations: []pluginapi.PluginCapability{{
			Capability: capabilitySwissGateway,
			Version:    capabilityVersion,
			Values: map[string]string{
				"endpoint":  ".gateway.url",
				"apiKeyRef": ".gateway.auth.secretRef",
			},
		}},
	}
}

func TestNeedsSwissBuiltinSkipsAConfiguredPlugin(t *testing.T) {
	plugin := testSwissProvider()
	plugin.Kind = pluginProviderKind
	platform := platformCapabilityProvider(consoleValues{}, "console-system")
	swiss := func(from *pluginapi.PluginCapabilitySource, version string) []pluginapi.PluginCapabilityBinding {
		return []pluginapi.PluginCapabilityBinding{{Capability: capabilitySwissGateway, Version: version, From: from}}
	}
	for _, test := range []struct {
		name      string
		bindings  []pluginapi.PluginCapabilityBinding
		providers []capabilityProvider
		want      bool
	}{
		{
			name:      "an installed plugin answers the unpinned binding",
			bindings:  swiss(nil, ""),
			providers: []capabilityProvider{platform, plugin},
			want:      false,
		},
		{
			name:      "no plugin declares the capability",
			bindings:  swiss(nil, ""),
			providers: []capabilityProvider{platform},
			want:      true,
		},
		{
			name:      "the binding pins the platform",
			bindings:  swiss(&pluginapi.PluginCapabilitySource{Kind: platformProviderKind}, ""),
			providers: []capabilityProvider{platform, plugin},
			want:      true,
		},
		{
			name:      "the plugin declares another capability version",
			bindings:  swiss(nil, "v2"),
			providers: []capabilityProvider{platform, plugin},
			want:      true,
		},
		{
			name:      "no binding asks for the swiss gateway",
			bindings:  []pluginapi.PluginCapabilityBinding{{Capability: capabilityImagePullSecrets}},
			providers: []capabilityProvider{platform},
			want:      false,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := needsSwissBuiltin(test.bindings, test.providers); got != test.want {
				t.Fatalf("needsSwissBuiltin() = %v, want %v", got, test.want)
			}
		})
	}
}
