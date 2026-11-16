package pluginpackage

import (
	"fmt"
	"regexp"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/config"
)

var (
	identifierPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
	semverPattern     = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
)

// Manifest is the product metadata embedded in a ModelSphere plugin Chart.
// It describes what the package is; the runtime (Deployments, API routes,
// IAM) lives in the Chart templates, not here.
type Manifest struct {
	APIVersion  string       `yaml:"apiVersion"`
	Group       string       `yaml:"group"`
	Name        string       `yaml:"name"`
	Version     string       `yaml:"version"`
	DisplayName string       `yaml:"displayName"`
	Description string       `yaml:"description"`
	Requires    Requirements `yaml:"requires,omitempty"`
	Frontend    Frontend     `yaml:"frontend"`
}

// Requirements is the host capability declaration shared with the Plugin CR
// metadata, so the package and Console read the same field names.
type Requirements = pluginapi.PluginRequirements

// Frontend describes how Console loads the bundle from the release.
type Frontend struct {
	Type    string `yaml:"type"`
	Runtime string `yaml:"runtime"`
	Entry   string `yaml:"entry"`
}

// Validate checks the package metadata before Helm or Kubernetes are invoked.
func (m Manifest) Validate() error {
	if m.APIVersion != "v1" {
		return fmt.Errorf("apiVersion must be %q", "v1")
	}
	if err := (pluginapi.PluginIdentity{Group: m.Group, Name: m.Name}).Validate(); err != nil {
		return err
	}
	if !semverPattern.MatchString(m.Version) {
		return fmt.Errorf("version must be strict SemVer")
	}
	if m.Frontend.Type != "component" || m.Frontend.Runtime != "remote" || !config.ValidPluginAsset(m.Frontend.Entry) {
		return fmt.Errorf("frontend must describe a remote component entry")
	}
	return nil
}
