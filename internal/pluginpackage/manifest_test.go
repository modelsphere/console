package pluginpackage

import (
	"testing"

	"github.com/modelsphere/console/internal/config"
)

func TestManifestConsolePlugin(t *testing.T) {
	manifest := testManifest()
	plugin, err := manifest.ConsolePlugin("canary", "modelsphere")
	if err != nil {
		t.Fatalf("ConsolePlugin() error = %v", err)
	}
	if plugin.ID != "canary" || plugin.URL != "http://canary-frontend.modelsphere.svc:8080/" {
		t.Fatalf("unexpected frontend configuration: %+v", plugin)
	}
	if plugin.Backend == nil || plugin.Backend.URL != "http://canary-backend.modelsphere.svc:8080/api/canary" {
		t.Fatalf("unexpected backend configuration: %+v", plugin.Backend)
	}
	if err := (&config.Config{Server: config.Server{Auth: config.Auth{Disabled: true}}, Plugins: []config.Plugin{plugin}}).Validate(); err != nil {
		t.Fatalf("generated Console configuration is invalid: %v", err)
	}
}

func TestManifestRejectsUnsupportedMenuShape(t *testing.T) {
	manifest := testManifest()
	manifest.Menus = append(manifest.Menus, manifest.Menus[0])
	if err := manifest.Validate(); err == nil {
		t.Fatal("Validate() accepted multiple menus")
	}
}

func testManifest() Manifest {
	return Manifest{
		APIVersion:  manifestVersion,
		Kind:        "Plugin",
		Name:        "canary",
		Version:     "0.4.0",
		DisplayName: "Canary",
		Type:        "native",
		Frontend: Frontend{
			Entry:   "index.umd.js",
			Service: ServiceRef{Name: "${RELEASE}-frontend", Port: 8080},
		},
		Backend: &Backend{
			Name:    "canary",
			Prefix:  "/api/canary",
			Path:    "/api/canary",
			Service: ServiceRef{Name: "${RELEASE}-backend", Port: 8080},
		},
		Menus: []Menu{{
			Name:      "canary",
			Title:     "Canary",
			Label:     "Canary",
			Path:      "/canary",
			Component: "CanaryRoot",
		}},
	}
}
