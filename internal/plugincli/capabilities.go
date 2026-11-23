package plugincli

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/pluginpackage"
	sigyaml "sigs.k8s.io/yaml"
)

// Built-in capabilities the platform supplies before a dedicated plugin
// provides them. A plugin that declares the same capability shadows it.
const (
	capabilityImagePullSecrets    = "platform.modelsphere.dev/image-pull-secrets"
	capabilityInferenceNamespaces = "platform.modelsphere.dev/inference-namespaces"
	capabilitySwissGateway        = "swiss.modelsphere.dev/gateway"

	capabilityVersion = "v1"

	platformProviderKind  = "Platform"
	pluginProviderKind    = "Plugin"
	platformProviderGroup = "modelsphere.dev"
	platformProviderName  = "platform"
	swissProviderName     = "swiss"
)

// capabilityProvider is one installable source of capabilities: a registered
// plugin, or a capability the platform supplies from its own configuration.
type capabilityProvider struct {
	Kind         string
	Group        string
	Name         string
	Version      string
	Namespace    string
	Values       map[string]any
	Declarations []pluginapi.PluginCapability
}

// label is the provider key consumers read under `consumed`.
func (p capabilityProvider) label() string {
	return p.Group + "/" + p.Name
}

// describe names the provider in errors so operators know which instance
// answered a binding.
func (p capabilityProvider) describe() string {
	if p.Kind == platformProviderKind {
		return "the platform built-in " + p.label()
	}
	return "plugin " + p.label() + " " + p.Version
}

// consumedValues is the `consumed` tree written into a consumer's Helm values:
// provider identity -> published key -> value.
type consumedValues map[string]map[string]any

// installConsumedCapabilities resolves the package's bindings against the
// installed providers and returns the values its Chart must receive.
func installConsumedCapabilities(ctx context.Context, runner Runner, manifest pluginpackage.Manifest, console consoleValues, consoleNamespace, pluginNamespace string) (consumedValues, error) {
	if len(manifest.Consumes) == 0 {
		return nil, nil
	}
	providers, err := capabilityProviders(ctx, runner, manifest.Consumes, console, consoleNamespace)
	if err != nil {
		return nil, err
	}
	return resolveCapabilities(manifest.Consumes, providers, pluginNamespace)
}

// capabilityProviders collects the platform built-ins plus every registered
// plugin that declares a capability this package binds to.
func capabilityProviders(ctx context.Context, runner Runner, bindings []pluginapi.PluginCapabilityBinding, console consoleValues, consoleNamespace string) ([]capabilityProvider, error) {
	providers := []capabilityProvider{platformCapabilityProvider(console, consoleNamespace)}
	registrations, err := runner.Registrations(ctx)
	if err != nil {
		return nil, err
	}
	for _, registration := range registrations {
		provider, found, err := pluginCapabilityProvider(ctx, runner, registration, bindings, consoleNamespace)
		if err != nil {
			return nil, err
		}
		if found {
			providers = append(providers, provider)
		}
	}
	// Built-in swiss is validated only when no installed plugin answers the
	// binding: externalSwiss.url may be unset on a Console whose gateway comes
	// from a plugin.
	if needsSwissBuiltin(bindings, providers) {
		provider, err := swissCapabilityProvider(console)
		if err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return preferPluginProviders(providers), nil
}

// needsSwissBuiltin reports whether some binding still needs the built-in
// swiss provider, and is written to be safe with no swiss binding at all.
func needsSwissBuiltin(bindings []pluginapi.PluginCapabilityBinding, providers []capabilityProvider) bool {
	builtin := capabilityProvider{Kind: platformProviderKind, Group: platformProviderGroup, Name: swissProviderName}
	for _, binding := range bindings {
		if binding.Capability != capabilitySwissGateway || !sourceAccepts(binding.From, builtin) {
			continue
		}
		if !answeredByPlugin(binding, providers) {
			return true
		}
	}
	return false
}

// answeredByPlugin reports whether an installed plugin satisfies the binding
// on capability and version, so the built-in does not have to be configured.
func answeredByPlugin(binding pluginapi.PluginCapabilityBinding, providers []capabilityProvider) bool {
	for _, provider := range providers {
		if provider.Kind != pluginProviderKind || !sourceAccepts(binding.From, provider) {
			continue
		}
		for _, declaration := range provider.Declarations {
			if declaration.Capability != binding.Capability {
				continue
			}
			if binding.Version == "" || declaration.Version == binding.Version {
				return true
			}
		}
	}
	return false
}

// platformCapabilityProvider publishes what the Console release itself owns:
// registry pull secrets and the inference namespaces it manages.
func platformCapabilityProvider(console consoleValues, namespace string) capabilityProvider {
	values := map[string]any{"imagePullSecrets": console.ImagePullSecrets}
	if namespaces := platformInferenceNamespaces(console); len(namespaces) > 0 {
		values["inferenceNamespaces"] = namespaces
	}
	return capabilityProvider{
		Kind:      platformProviderKind,
		Group:     platformProviderGroup,
		Name:      platformProviderName,
		Namespace: namespace,
		Values:    values,
		Declarations: []pluginapi.PluginCapability{
			{
				Capability:    capabilityImagePullSecrets,
				Version:       capabilityVersion,
				SameNamespace: true,
				Values:        map[string]string{"imagePullSecrets": ".imagePullSecrets"},
			},
			{
				Capability: capabilityInferenceNamespaces,
				Version:    capabilityVersion,
				Values:     map[string]string{"inferenceNamespaces": ".inferenceNamespaces"},
			},
		},
	}
}

// swissCapabilityProvider stands in for the swiss plugin until one is
// installed. It reads the Console's external swiss configuration, so the
// endpoint a consumer receives is already in the shape the gateway accepts.
func swissCapabilityProvider(console consoleValues) (capabilityProvider, error) {
	endpoint, err := baseSwissURL(console.ExternalSwiss.URL)
	if err != nil {
		return capabilityProvider{}, fmt.Errorf("capability %s needs Console externalSwiss.url: %w", capabilitySwissGateway, err)
	}
	apiKeyKey := console.ExternalSwiss.ProxyKey.Key
	if apiKeyKey == "" {
		apiKeyKey = "proxyKey"
	}
	return capabilityProvider{
		Kind:      platformProviderKind,
		Group:     platformProviderGroup,
		Name:      swissProviderName,
		Namespace: "",
		Values: map[string]any{
			"endpoint":  endpoint,
			"apiKeyRef": console.ExternalSwiss.ProxyKey.SecretName,
			"apiKeyKey": apiKeyKey,
		},
		Declarations: []pluginapi.PluginCapability{{
			Capability: capabilitySwissGateway,
			Version:    capabilityVersion,
			Values: map[string]string{
				"endpoint":  ".endpoint",
				"apiKeyRef": ".apiKeyRef",
				"apiKeyKey": ".apiKeyKey",
			},
		}},
	}, nil
}

// pluginCapabilityProvider reads one registration's declarations. Values are
// fetched only for plugins that declare a capability this package binds to.
func pluginCapabilityProvider(ctx context.Context, runner Runner, registration pluginapi.Plugin, bindings []pluginapi.PluginCapabilityBinding, defaultNamespace string) (capabilityProvider, bool, error) {
	meta := registration.Status.PluginMeta
	if meta == nil || len(meta.Provides) == 0 || !declaresAnyCapability(meta.Provides, bindings) {
		return capabilityProvider{}, false, nil
	}
	namespace := registration.Spec.Chart.Namespace
	if namespace == "" {
		namespace = defaultNamespace
	}
	release := registration.Spec.Chart.ReleaseName
	if release == "" {
		release = registration.Name
	}
	data, err := runner.GetValues(ctx, release, namespace)
	if err != nil {
		return capabilityProvider{}, false, fmt.Errorf("read values of plugin %s/%s: %w", meta.Group, meta.Name, err)
	}
	values := map[string]any{}
	if len(strings.TrimSpace(string(data))) > 0 {
		if err := sigyaml.Unmarshal(data, &values); err != nil {
			return capabilityProvider{}, false, fmt.Errorf("parse values of plugin %s/%s: %w", meta.Group, meta.Name, err)
		}
	}
	return capabilityProvider{
		Kind:         pluginProviderKind,
		Group:        meta.Group,
		Name:         meta.Name,
		Version:      meta.Version,
		Namespace:    namespace,
		Values:       values,
		Declarations: meta.Provides,
	}, true, nil
}

// preferPluginProviders drops a built-in declaration once an installed plugin
// declares the same capability: the plugin is the more specific provider.
func preferPluginProviders(providers []capabilityProvider) []capabilityProvider {
	declared := map[string]struct{}{}
	for _, provider := range providers {
		if provider.Kind != pluginProviderKind {
			continue
		}
		for _, declaration := range provider.Declarations {
			declared[declaration.Capability] = struct{}{}
		}
	}
	result := make([]capabilityProvider, 0, len(providers))
	for _, provider := range providers {
		if provider.Kind == pluginProviderKind {
			result = append(result, provider)
			continue
		}
		remaining := make([]pluginapi.PluginCapability, 0, len(provider.Declarations))
		for _, declaration := range provider.Declarations {
			if _, shadowed := declared[declaration.Capability]; !shadowed {
				remaining = append(remaining, declaration)
			}
		}
		if len(remaining) == 0 {
			continue
		}
		provider.Declarations = remaining
		result = append(result, provider)
	}
	return result
}

// declaresAnyCapability reports whether a provider could answer one binding;
// values are not read for providers that cannot.
func declaresAnyCapability(declarations []pluginapi.PluginCapability, bindings []pluginapi.PluginCapabilityBinding) bool {
	for _, declaration := range declarations {
		for _, binding := range bindings {
			if declaration.Capability == binding.Capability {
				return true
			}
		}
	}
	return false
}

// resolveCapabilities turns bindings into values, failing before Helm runs on
// a missing, ambiguous or out-of-namespace provider.
func resolveCapabilities(bindings []pluginapi.PluginCapabilityBinding, providers []capabilityProvider, consumerNamespace string) (consumedValues, error) {
	consumed := consumedValues{}
	for _, binding := range bindings {
		provider, declaration, err := chooseCapabilityProvider(binding, providers)
		if err != nil {
			return nil, err
		}
		if declaration.SameNamespace && provider.Namespace != consumerNamespace {
			return nil, fmt.Errorf("capability %s is namespace-scoped to %q; install this plugin in %q or stop binding it", declaration.Capability, provider.Namespace, provider.Namespace)
		}
		if len(declaration.Values) == 0 {
			continue
		}
		published := consumed[provider.label()]
		if published == nil {
			published = map[string]any{}
			consumed[provider.label()] = published
		}
		if err := publishCapabilityValues(binding, provider, declaration, published); err != nil {
			return nil, err
		}
	}
	if len(consumed) == 0 {
		return nil, nil
	}
	return consumed, nil
}

// chooseCapabilityProvider applies the binding's version and `from` filters.
func chooseCapabilityProvider(binding pluginapi.PluginCapabilityBinding, providers []capabilityProvider) (capabilityProvider, pluginapi.PluginCapability, error) {
	matches := []capabilityMatch{}
	for _, provider := range providers {
		if !sourceAccepts(binding.From, provider) {
			continue
		}
		for _, declaration := range provider.Declarations {
			if declaration.Capability != binding.Capability {
				continue
			}
			if binding.Version != "" && declaration.Version != binding.Version {
				continue
			}
			matches = append(matches, capabilityMatch{provider: provider, declaration: declaration})
		}
	}
	sort.Slice(matches, func(left, right int) bool {
		return matches[left].provider.describe() < matches[right].provider.describe()
	})
	switch len(matches) {
	case 0:
		return capabilityProvider{}, pluginapi.PluginCapability{}, capabilityUnavailable(binding, providers)
	case 1:
		return matches[0].provider, matches[0].declaration, nil
	default:
		labels := make([]string, 0, len(matches))
		for _, match := range matches {
			labels = append(labels, match.provider.describe())
		}
		return capabilityProvider{}, pluginapi.PluginCapability{}, fmt.Errorf("capability %s is offered by multiple providers (%s); pin one with from in the consumes binding", binding.Capability, strings.Join(labels, ", "))
	}
}

type capabilityMatch struct {
	provider    capabilityProvider
	declaration pluginapi.PluginCapability
}

// sourceAccepts reports whether a provider satisfies the binding's `from`
// filter. It is safe on a nil source: an absent filter accepts every provider.
func sourceAccepts(source *pluginapi.PluginCapabilitySource, provider capabilityProvider) bool {
	if source == nil {
		return true
	}
	if source.Kind != "" && !strings.EqualFold(source.Kind, provider.Kind) {
		return false
	}
	if source.Group != "" && source.Group != provider.Group {
		return false
	}
	if source.Name != "" && source.Name != provider.Name {
		return false
	}
	if source.Version == "" {
		return true
	}
	constraint, err := semver.NewConstraint(source.Version)
	if err != nil {
		return false
	}
	version, err := semver.NewVersion(provider.Version)
	if err != nil {
		return false
	}
	return constraint.Check(version)
}

// capabilityUnavailable explains whether a version or provider filter caused
// the miss, so the operator knows which side to change.
func capabilityUnavailable(binding pluginapi.PluginCapabilityBinding, providers []capabilityProvider) error {
	offered := []string{}
	for _, provider := range providers {
		for _, declaration := range provider.Declarations {
			if declaration.Capability == binding.Capability {
				offered = append(offered, provider.describe()+" at "+declaration.Version)
			}
		}
	}
	version := "at any version"
	if binding.Version != "" {
		version = "version " + binding.Version
	}
	if len(offered) > 0 {
		sort.Strings(offered)
		return fmt.Errorf("capability %s %s is not available: installed providers offer %s", binding.Capability, version, strings.Join(offered, ", "))
	}
	return fmt.Errorf("no installed provider offers capability %s %s; install a plugin that declares it", binding.Capability, version)
}

// publishCapabilityValues maps each published key through the provider's own
// path, rejecting paths the provider does not actually publish.
func publishCapabilityValues(binding pluginapi.PluginCapabilityBinding, provider capabilityProvider, declaration pluginapi.PluginCapability, published map[string]any) error {
	keys := make([]string, 0, len(declaration.Values))
	for key := range declaration.Values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		path := declaration.Values[key]
		value, found := lookupValuePath(provider.Values, path)
		if !found {
			return fmt.Errorf("capability %s: %s publishes no value at %s for %q", binding.Capability, provider.describe(), path, key)
		}
		if existing, duplicate := published[key]; duplicate && !reflect.DeepEqual(existing, value) {
			return fmt.Errorf("capability %s: %s publishes conflicting values for %q", binding.Capability, provider.describe(), key)
		}
		published[key] = value
	}
	return nil
}

// lookupValuePath walks a dotted path such as ".gateway.auth.secretName".
func lookupValuePath(values map[string]any, path string) (any, bool) {
	segments := strings.Split(strings.TrimPrefix(path, "."), ".")
	var current any = values
	for _, segment := range segments {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[segment]
		if !ok || current == nil {
			return nil, false
		}
	}
	return current, true
}
