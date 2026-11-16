package pluginpackage

import (
	"strings"
	"testing"
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
