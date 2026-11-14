package pluginpackage

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/modelsphere/console/internal/config"
)

const manifestVersion = "modelsphere.io/v1alpha1"

var (
	identifierPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
	semverPattern     = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	menuPathPattern   = regexp.MustCompile(`^/[a-z][a-z0-9-]*$`)
	dnsLabelPattern   = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)
)

// Manifest is the product metadata embedded in a ModelSphere plugin Chart.
type Manifest struct {
	APIVersion  string   `yaml:"apiVersion"`
	Kind        string   `yaml:"kind"`
	Name        string   `yaml:"name"`
	Version     string   `yaml:"version"`
	DisplayName string   `yaml:"displayName"`
	Type        string   `yaml:"type"`
	Frontend    Frontend `yaml:"frontend"`
	Backend     *Backend `yaml:"backend,omitempty"`
	Menus       []Menu   `yaml:"menus"`
}

// Frontend describes the static resource service consumed by Console.
type Frontend struct {
	Entry   string     `yaml:"entry"`
	Styles  []string   `yaml:"styles,omitempty"`
	Service ServiceRef `yaml:"service"`
}

// Backend describes the authenticated API service proxied by Console.
type Backend struct {
	Name            string     `yaml:"name"`
	Prefix          string     `yaml:"prefix"`
	Path            string     `yaml:"path,omitempty"`
	Service         ServiceRef `yaml:"service"`
	APIKeyEnv       string     `yaml:"apiKeyEnv,omitempty"`
	WritePermission string     `yaml:"writePermission,omitempty"`
}

// ServiceRef identifies a Service in the plugin release namespace.
type ServiceRef struct {
	Name string `yaml:"name"`
	Port int32  `yaml:"port"`
}

// Menu describes one Console navigation entry. The current host supports one
// menu per plugin; this restriction is validated instead of silently dropping entries.
type Menu struct {
	Name          string `yaml:"name"`
	Title         string `yaml:"title"`
	Label         string `yaml:"label"`
	Path          string `yaml:"path"`
	Component     string `yaml:"component"`
	Icon          string `yaml:"icon,omitempty"`
	Capability    string `yaml:"capability,omitempty"`
	RequiresWrite bool   `yaml:"requiresWrite,omitempty"`
}

// Validate checks the package metadata before Helm or Kubernetes are invoked.
func (m Manifest) Validate() error {
	if m.APIVersion != manifestVersion {
		return fmt.Errorf("apiVersion must be %q", manifestVersion)
	}
	if m.Kind != "Plugin" {
		return fmt.Errorf("kind must be Plugin")
	}
	if !identifierPattern.MatchString(m.Name) {
		return fmt.Errorf("name %q must be lowercase kebab-case", m.Name)
	}
	if !semverPattern.MatchString(m.Version) {
		return fmt.Errorf("version %q must be strict SemVer", m.Version)
	}
	if m.Type != "native" {
		return fmt.Errorf("type %q is unsupported; only native plugins are supported", m.Type)
	}
	if err := validateFrontend(m.Frontend); err != nil {
		return fmt.Errorf("frontend: %w", err)
	}
	if m.Backend != nil {
		if err := validateBackend(*m.Backend, m.Name); err != nil {
			return fmt.Errorf("backend: %w", err)
		}
	}
	if len(m.Menus) != 1 {
		return fmt.Errorf("menus must contain exactly one entry")
	}
	if err := validateMenu(m.Menus[0]); err != nil {
		return fmt.Errorf("menu: %w", err)
	}
	return nil
}

func validateFrontend(frontend Frontend) error {
	if !config.ValidPluginAsset(frontend.Entry) {
		return fmt.Errorf("entry %q must be a relative asset path", frontend.Entry)
	}
	for _, style := range frontend.Styles {
		if !config.ValidPluginAsset(style) {
			return fmt.Errorf("style %q must be a relative asset path", style)
		}
	}
	return validateService(frontend.Service)
}

func validateBackend(backend Backend, pluginName string) error {
	if backend.Name == "" {
		backend.Name = pluginName
	}
	if backend.Name != pluginName {
		return fmt.Errorf("name %q must match plugin name %q", backend.Name, pluginName)
	}
	if !strings.HasPrefix(backend.Prefix, "/api/") || strings.HasSuffix(backend.Prefix, "/") {
		return fmt.Errorf("prefix %q must be a non-trailing path under /api/", backend.Prefix)
	}
	if backend.Path == "" {
		backend.Path = "/"
	}
	parsed, err := url.Parse(backend.Path)
	if err != nil || parsed.Path != backend.Path || !strings.HasPrefix(backend.Path, "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("path %q must be an absolute path without query or fragment", backend.Path)
	}
	if err := validateService(backend.Service); err != nil {
		return err
	}
	return nil
}

func validateService(service ServiceRef) error {
	if service.Name == "" {
		return fmt.Errorf("service name is required")
	}
	template := strings.NewReplacer("${RELEASE}", "release", "${NAMESPACE}", "namespace").Replace(service.Name)
	if strings.Contains(template, "${") || !dnsLabelPattern.MatchString(template) {
		return fmt.Errorf("service name %q must be a lowercase DNS label or use ${RELEASE}/${NAMESPACE}", service.Name)
	}
	if service.Port < 1 || service.Port > 65535 {
		return fmt.Errorf("service port %d is invalid", service.Port)
	}
	return nil
}

func validateMenu(menu Menu) error {
	if menu.Title == "" || menu.Label == "" || menu.Component == "" {
		return fmt.Errorf("title, label and component are required")
	}
	if !menuPathPattern.MatchString(menu.Path) {
		return fmt.Errorf("path %q must look like /example", menu.Path)
	}
	for _, reserved := range []string{"/login", "/change-password", "/api", "/oauth", "/plugins", "/assets"} {
		if menu.Path == reserved {
			return fmt.Errorf("path %q is reserved", menu.Path)
		}
	}
	return nil
}

// Resolve returns the Service name after resolving release and namespace placeholders.
func (service ServiceRef) Resolve(release, namespace string) (string, error) {
	if err := validateDNSLabel(release, "release"); err != nil {
		return "", err
	}
	if err := validateDNSLabel(namespace, "namespace"); err != nil {
		return "", err
	}
	name := strings.NewReplacer("${RELEASE}", release, "${NAMESPACE}", namespace).Replace(service.Name)
	if strings.Contains(name, "${") {
		return "", fmt.Errorf("service name %q contains an unknown placeholder", service.Name)
	}
	if err := validateDNSLabel(name, "service name"); err != nil {
		return "", err
	}
	if err := validateService(ServiceRef{Name: name, Port: service.Port}); err != nil {
		return "", err
	}
	return name, nil
}

// ConsolePlugin converts the package manifest to the current Console values contract.
func (m Manifest) ConsolePlugin(release, namespace string) (config.Plugin, error) {
	if err := m.Validate(); err != nil {
		return config.Plugin{}, err
	}
	frontendName, err := m.Frontend.Service.Resolve(release, namespace)
	if err != nil {
		return config.Plugin{}, fmt.Errorf("resolve frontend service: %w", err)
	}
	frontendURL := serviceURL(frontendName, namespace, m.Frontend.Service.Port, "/")
	menu := m.Menus[0]
	plugin := config.Plugin{
		ID:     m.Name,
		URL:    frontendURL,
		Entry:  m.Frontend.Entry,
		Styles: append([]string(nil), m.Frontend.Styles...),
		Menu: config.PluginMenu{
			Title:         menu.Title,
			Label:         menu.Label,
			Path:          menu.Path,
			Component:     menu.Component,
			Icon:          menu.Icon,
			Capability:    menu.Capability,
			RequiresWrite: menu.RequiresWrite,
		},
	}
	if m.Backend == nil {
		return plugin, nil
	}
	backendName, err := m.Backend.Service.Resolve(release, namespace)
	if err != nil {
		return config.Plugin{}, fmt.Errorf("resolve backend service: %w", err)
	}
	plugin.Backend = &config.PluginBackend{
		Name:            m.Backend.Name,
		Prefix:          m.Backend.Prefix,
		URL:             serviceURL(backendName, namespace, m.Backend.Service.Port, m.Backend.Path),
		APIKeyEnv:       m.Backend.APIKeyEnv,
		WritePermission: m.Backend.WritePermission,
	}
	return plugin, nil
}

func serviceURL(name, namespace string, port int32, path string) string {
	return fmt.Sprintf("http://%s.%s.svc:%d%s", name, namespace, port, path)
}

func validateDNSLabel(value, field string) error {
	if len(value) > 63 || !dnsLabelPattern.MatchString(value) {
		return fmt.Errorf("%s %q must be a lowercase DNS label", field, value)
	}
	return nil
}
