package pluginpackage

import (
	"strings"
	"testing"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
)

func TestManifestAcceptsV1RemoteComponent(t *testing.T) {
	if err := validManifest().Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestManifestRejectsUnsupportedShapes(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Manifest)
		want   string
	}{
		{"legacy apiVersion", func(m *Manifest) { m.APIVersion = "modelsphere.io/v1alpha1" }, "apiVersion"},
		{"invalid identity", func(m *Manifest) { m.Name = "Canary" }, "name"},
		{"non-semver version", func(m *Manifest) { m.Version = "0.4" }, "SemVer"},
		{"iframe frontend", func(m *Manifest) { m.Frontend.Type = "iframe" }, "remote component"},
		{"built-in runtime", func(m *Manifest) { m.Frontend.Runtime = "built-in" }, "remote component"},
		{"entry traversal", func(m *Manifest) { m.Frontend.Entry = "../index.js" }, "remote component"},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := validManifest()
			test.change(&manifest)
			if err := manifest.Validate(); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("Validate() = %v, want %q", err, test.want)
			}
		})
	}
}

func TestManifestAcceptsCapabilityDeclarations(t *testing.T) {
	manifest := validManifest()
	manifest.Provides = []Capability{{
		Capability: "swiss.modelsphere.dev/gateway",
		Version:    "v1",
		Values:     map[string]string{"endpoint": ".gateway.url"},
	}}
	manifest.Consumes = []CapabilityBinding{{
		Capability: "swiss.modelsphere.dev/gateway",
		Version:    "v1",
		From:       &pluginapi.PluginCapabilitySource{Kind: "Plugin", Name: "swiss", Version: ">=0.4.0 <0.6.0"},
	}}
	if err := manifest.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestManifestRejectsInvalidCapabilityDeclarations(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Manifest)
		want   string
	}{
		{"capability without a domain", func(m *Manifest) {
			m.Provides = []Capability{{Capability: "gateway", Version: "v1"}}
		}, "must be <domain>/<name>"},
		{"capability version", func(m *Manifest) {
			m.Provides = []Capability{{Capability: "swiss.modelsphere.dev/gateway", Version: "1"}}
		}, "must look like v1"},
		{"duplicate capability", func(m *Manifest) {
			m.Provides = []Capability{
				{Capability: "swiss.modelsphere.dev/gateway", Version: "v1"},
				{Capability: "swiss.modelsphere.dev/gateway", Version: "v1"},
			}
		}, "more than once"},
		{"value key", func(m *Manifest) {
			m.Provides = []Capability{{
				Capability: "swiss.modelsphere.dev/gateway",
				Version:    "v1",
				Values:     map[string]string{"api-key": ".endpoint"},
			}}
		}, "camelCase"},
		{"value path", func(m *Manifest) {
			m.Provides = []Capability{{
				Capability: "swiss.modelsphere.dev/gateway",
				Version:    "v1",
				Values:     map[string]string{"endpoint": "gateway.url"},
			}}
		}, "dotted path"},
		{"binding kind", func(m *Manifest) {
			m.Consumes = []CapabilityBinding{{
				Capability: "swiss.modelsphere.dev/gateway",
				From:       &pluginapi.PluginCapabilitySource{Kind: "Chart"},
			}}
		}, "must be Plugin or Platform"},
		{"binding version constraint", func(m *Manifest) {
			m.Consumes = []CapabilityBinding{{
				Capability: "swiss.modelsphere.dev/gateway",
				From:       &pluginapi.PluginCapabilitySource{Version: "not a constraint"},
			}}
		}, "from.version"},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := validManifest()
			test.change(&manifest)
			if err := manifest.Validate(); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("Validate() = %v, want %q", err, test.want)
			}
		})
	}
}

func validManifest() Manifest {
	return Manifest{
		APIVersion:  "v1",
		Group:       "modelsphere.dev",
		Name:        "canary",
		Version:     "0.4.0",
		DisplayName: "Canary",
		Frontend:    Frontend{Type: "component", Runtime: "remote", Entry: "index.umd.js"},
	}
}
