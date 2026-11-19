package pluginpackage

import (
	"fmt"
	"regexp"

	"github.com/Masterminds/semver/v3"
	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/config"
)

var (
	identifierPattern        = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
	semverPattern            = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	capabilityPattern        = regexp.MustCompile(`^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)+/[a-z][a-z0-9-]*$`)
	capabilityVersionPattern = regexp.MustCompile(`^v[0-9]+$`)
	valueKeyPattern          = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)
	valuePathPattern         = regexp.MustCompile(`^\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$`)
)

// Manifest is the product metadata embedded in a ModelSphere plugin Chart.
// It describes what the package is; the runtime (Deployments, API routes,
// IAM) lives in the Chart templates, not here.
type Manifest struct {
	APIVersion  string              `yaml:"apiVersion"`
	Group       string              `yaml:"group"`
	Name        string              `yaml:"name"`
	Version     string              `yaml:"version"`
	DisplayName string              `yaml:"displayName"`
	Description string              `yaml:"description"`
	Provides    []Capability        `yaml:"provides,omitempty"`
	Consumes    []CapabilityBinding `yaml:"consumes,omitempty"`
	Frontend    Frontend            `yaml:"frontend"`
}

// Capability declarations are shared with the Plugin CR metadata, so the
// package and Console read the same field names.
type Capability = pluginapi.PluginCapability

// CapabilityBinding is a consumer's declaration, shared with the Plugin CR.
type CapabilityBinding = pluginapi.PluginCapabilityBinding

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
	if err := validateProvides(m.Provides); err != nil {
		return err
	}
	return validateConsumes(m.Consumes)
}

// validateProvides keeps capability identities and their published value
// layout resolvable before an installer reads them.
func validateProvides(capabilities []Capability) error {
	seen := map[string]struct{}{}
	for _, capability := range capabilities {
		if !capabilityPattern.MatchString(capability.Capability) {
			return fmt.Errorf("provides capability %q must be <domain>/<name>", capability.Capability)
		}
		if !capabilityVersionPattern.MatchString(capability.Version) {
			return fmt.Errorf("provides %s version must look like v1", capability.Capability)
		}
		if _, duplicate := seen[capability.Capability]; duplicate {
			return fmt.Errorf("provides %s more than once", capability.Capability)
		}
		seen[capability.Capability] = struct{}{}
		for key, path := range capability.Values {
			if !valueKeyPattern.MatchString(key) {
				return fmt.Errorf("provides %s value key %q must be camelCase", capability.Capability, key)
			}
			if !valuePathPattern.MatchString(path) {
				return fmt.Errorf("provides %s value %q must be a dotted path starting with '.'", capability.Capability, path)
			}
		}
	}
	return nil
}

// validateConsumes rejects bindings an installer cannot resolve.
func validateConsumes(bindings []CapabilityBinding) error {
	for _, binding := range bindings {
		if !capabilityPattern.MatchString(binding.Capability) {
			return fmt.Errorf("consumes capability %q must be <domain>/<name>", binding.Capability)
		}
		if binding.Version != "" && !capabilityVersionPattern.MatchString(binding.Version) {
			return fmt.Errorf("consumes %s version must look like v1", binding.Capability)
		}
		if binding.From == nil {
			continue
		}
		if binding.From.Kind != "" && binding.From.Kind != "Plugin" && binding.From.Kind != "Platform" {
			return fmt.Errorf("consumes %s from.kind must be Plugin or Platform", binding.Capability)
		}
		if binding.From.Version != "" {
			if _, err := semver.NewConstraint(binding.From.Version); err != nil {
				return fmt.Errorf("consumes %s from.version: %w", binding.Capability, err)
			}
		}
	}
	return nil
}
