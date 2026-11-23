package v1alpha1

import (
	"encoding/base32"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/util/validation"
)

const (
	pluginResourceNameSeparator = "--"
	pluginResourceNameEscape    = "x-"
)

// PluginIdentity is the stable identity of a plugin. APIVersion describes the
// plugin metadata contract and is intentionally not part of this value.
type PluginIdentity struct {
	Group string
	Name  string
}

func (m PluginMeta) Identity() PluginIdentity {
	return PluginIdentity{Group: m.Group, Name: m.Name}
}

func (i PluginIdentity) String() string {
	return i.Group + "/" + i.Name
}

func (i PluginIdentity) Validate() error {
	if i.Group == "" {
		return fmt.Errorf("group is required")
	}
	if errs := validation.IsDNS1123Subdomain(i.Group); len(errs) != 0 {
		return fmt.Errorf("group %q is not a valid DNS-1123 subdomain: %s", i.Group, strings.Join(errs, "; "))
	}
	if i.Name == "" {
		return fmt.Errorf("name is required")
	}
	if errs := validation.IsDNS1123Subdomain(i.Name); len(errs) != 0 {
		return fmt.Errorf("name %q is not a valid DNS-1123 subdomain: %s", i.Name, strings.Join(errs, "; "))
	}
	return nil
}

// ResourceName reversibly encodes the identity for Plugin CR metadata.name.
// Components containing the separator are Base32-escaped, leaving "--" as an
// unambiguous separator while keeping ordinary group--name values unchanged.
func (i PluginIdentity) ResourceName() (string, error) {
	if err := i.Validate(); err != nil {
		return "", err
	}
	encoded := encodePluginIdentityComponent(i.Group) + pluginResourceNameSeparator + encodePluginIdentityComponent(i.Name)
	if errs := validation.IsDNS1123Subdomain(encoded); len(errs) != 0 {
		return "", fmt.Errorf("encoded Plugin resource name %q is invalid: %s", encoded, strings.Join(errs, "; "))
	}
	return encoded, nil
}

// ParsePluginResourceName decodes and validates a Plugin CR metadata.name.
func ParsePluginResourceName(resourceName string) (PluginIdentity, bool) {
	parts := strings.Split(resourceName, pluginResourceNameSeparator)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return PluginIdentity{}, false
	}
	identity := PluginIdentity{
		Group: decodePluginIdentityComponent(parts[0]),
		Name:  decodePluginIdentityComponent(parts[1]),
	}
	encoded, err := identity.ResourceName()
	if err != nil || encoded != resourceName {
		return PluginIdentity{}, false
	}
	return identity, true
}

func encodePluginIdentityComponent(value string) string {
	if !strings.Contains(value, pluginResourceNameSeparator) && !strings.HasPrefix(value, pluginResourceNameEscape) {
		return value
	}
	return pluginResourceNameEscape + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(value)))
}

func decodePluginIdentityComponent(value string) string {
	if !strings.HasPrefix(value, pluginResourceNameEscape) {
		return value
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimPrefix(value, pluginResourceNameEscape)))
	if err != nil {
		return ""
	}
	return string(decoded)
}
