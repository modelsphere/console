package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
)

// PluginPhase represents the lifecycle phase of a plugin.
type PluginPhase string

const (
	PluginPhasePending      PluginPhase = "Pending"
	PluginPhaseInstalling   PluginPhase = "Installing"
	PluginPhaseInstalled    PluginPhase = "Installed"
	PluginPhaseDegraded     PluginPhase = "Degraded"
	PluginPhaseUpgrading    PluginPhase = "Upgrading"
	PluginPhaseFailed       PluginPhase = "Failed"
	PluginPhaseUninstalling PluginPhase = "Uninstalling"
)

// PluginType represents how a plugin is deployed and managed.
type PluginType string

const (
	// PluginTypeHelm is a plugin managed via Helm chart installation.
	PluginTypeHelm PluginType = "helm"
	// PluginTypeInProcess is a built-in module compiled into the console.
	// No Helm operations; the CR only tracks enabled/disabled state.
	PluginTypeInProcess PluginType = "in-process"
)

// PluginSpec defines the desired state of a Plugin.
type PluginSpec struct {
	// Type is the plugin deployment type: "helm" or "in-process".
	// +kubebuilder:default=helm
	// +kubebuilder:validation:Enum=helm;in-process
	Type PluginType `json:"type,omitempty"`

	// Scope controls plugin visibility: "platform" (global, visible in Boss)
	// or "workspace" (per-tenant authorization required, visible in Console).
	// +kubebuilder:default=platform
	// +kubebuilder:validation:Enum=platform;workspace
	Scope string `json:"scope,omitempty"`

	// Enabled controls whether the plugin is active.
	// For helm plugins, false hides entry points and preserves the release and IAM.
	// For in-process plugins, false hides the module from the sidebar.
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`

	// Version is the desired Helm chart version. The Plugin HTTP CRUD API
	// requires it; the CRD remains optional for declarative writer compatibility.
	// +optional
	Version string `json:"version,omitempty"`

	// Chart holds the Helm chart location and release configuration.
	// Only used when type=helm.
	// +optional
	Chart ChartConfig `json:"chart,omitempty"`

	// Values are Helm values overrides passed to the chart.
	// Only used when type=helm.
	// +optional
	// +kubebuilder:pruning:PreserveUnknownFields
	Values *runtime.RawExtension `json:"values,omitempty"`
}

// ChartConfig defines how to locate and install a Helm chart.
type ChartConfig struct {
	// Name is the chart name in the repository.
	Name string `json:"name,omitempty"`

	// Namespace is the target namespace for the Helm release.
	Namespace string `json:"namespace,omitempty"`

	// ReleaseName overrides the Helm release name (defaults to the Plugin CR
	// metadata.name, which encodes the plugin identity as group--name).
	ReleaseName string `json:"releaseName,omitempty"`

	// Repository is the chart repository URL.
	Repository string `json:"repository,omitempty"`

	// Timeout bounds each Helm install, upgrade and uninstall of this chart,
	// hooks included, as a Go duration ("15m"). Omitted or non-positive means
	// 5 minutes.
	//
	// It is a string rather than metav1.Duration on purpose: the controller
	// writes the spec back when it adds its finalizer, and metav1.Duration
	// would normalize "15m" to "15m0s" — a permanent diff for the GitOps
	// writer of the Plugin CR.
	// +optional
	// +kubebuilder:validation:Pattern="^([0-9]+(\\.[0-9]+)?(ms|s|m|h))+$"
	Timeout string `json:"timeout,omitempty"`
}

// PluginStatus defines the observed state of a Plugin.
type PluginStatus struct {
	// Phase is the current lifecycle phase.
	Phase PluginPhase `json:"phase,omitempty"`

	// Conditions represent the latest available observations.
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// ReleaseName is the Helm release name after installation.
	ReleaseName string `json:"releaseName,omitempty"`

	// ReleaseVersion is the Helm release revision number.
	ReleaseVersion int `json:"releaseVersion,omitempty"`

	// ObservedHash is the hash of the last reconciled spec.
	// Used for idempotent reconciliation (skip if unchanged).
	ObservedHash string `json:"observedHash,omitempty"`

	// ObservedGeneration is the metadata.generation this status was written
	// for. Phase describes that generation only.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`

	// ObservedDelivery identifies the Karmada delivery of the object at
	// ObservedGeneration. Nil on a Plugin not delivered by Karmada.
	// +optional
	ObservedDelivery *PluginObservedDelivery `json:"observedDelivery,omitempty"`

	// PluginMeta holds metadata extracted from plugin.yaml inside the chart.
	// +optional
	PluginMeta *PluginMeta `json:"pluginMeta,omitempty"`

	// FrontendStatus tracks frontend resource distribution state.
	// +optional
	FrontendStatus *FrontendStatus `json:"frontendStatus,omitempty"`

	// Message is a human-readable description of the current state.
	Message string `json:"message,omitempty"`

	// LastTransitionTime is the last time the phase transitioned.
	// +optional
	LastTransitionTime *metav1.Time `json:"lastTransitionTime,omitempty"`
}

// PluginObservedDelivery is copied from the delivered object's annotations.
// The member's own generation differs from the template's, so these two
// values, not ObservedGeneration, tell the delivering side which template and
// per-cluster overrides the member has processed.
type PluginObservedDelivery struct {
	// TemplateGeneration is the resourcetemplate.karmada.io/generation
	// annotation: the Global-plane Plugin generation Karmada rendered.
	// +optional
	TemplateGeneration int64 `json:"templateGeneration,omitempty"`

	// Revision is the plugin.rise.io/delivery-revision annotation: the digest
	// of the per-cluster overrides applied by the PluginClusterInstall.
	// +optional
	Revision string `json:"revision,omitempty"`
}

// PluginMeta holds metadata extracted from plugin.yaml embedded in the Helm chart.
// Navigation, slots, and console sections are registered at runtime by the JS bundle.
type PluginMeta struct {
	// ImageContract identifies the image values convention used by the Chart.
	// +optional
	// +kubebuilder:validation:Enum=v1
	ImageContract string `json:"imageContract,omitempty"`

	// Depends declares plugin names and version constraints from plugin.yaml.
	// Disable checks match names only; they do not solve version constraints.
	// +optional
	Depends []PluginDependency `json:"depends,omitempty"`
	// Name is the plugin identifier.
	Name string `json:"name"`

	// Group is the API group (e.g., "rise.io").
	Group string `json:"group"`

	// APIVersion is the plugin API version (e.g., "v1").
	APIVersion string `json:"apiVersion"`

	// Version is the plugin product version declared by plugin.yaml.
	// It is independent from the Helm chart version.
	Version string `json:"version"`

	// DisplayName is the human-readable plugin name.
	DisplayName string `json:"displayName"`

	// Description is a short description of the plugin.
	Description string `json:"description"`

	// Frontend holds frontend integration configuration.
	Frontend FrontendConfig `json:"frontend"`

	// Provides declares capabilities this package makes available to other
	// packages. Consumers bind to a declaration by name and version.
	// +optional
	Provides []PluginCapability `json:"provides,omitempty"`

	// Consumes declares capabilities another provider must supply at install
	// time. The installer resolves each binding against installed providers.
	// +optional
	Consumes []PluginCapabilityBinding `json:"consumes,omitempty"`

	// APIAccess lists API paths the plugin needs access to.
	// +optional
	APIAccess []string `json:"apiAccess,omitempty"`

	// RoleTemplates are permission templates declared by the plugin.
	// +optional
	RoleTemplates []PluginRoleTemplate `json:"roleTemplates,omitempty"`

	// Activation holds activation policy configuration.
	// +optional
	Activation ActivationConfig `json:"activation,omitempty"`

	// UninstallPrecheck declares the endpoint the platform asks before a
	// Plugin CR may be deleted. Omitted means deletion is never prechecked.
	// +optional
	UninstallPrecheck *UninstallPrecheck `json:"uninstallPrecheck,omitempty"`
}

// PluginDependency identifies a prerequisite declared by plugin.yaml.
type PluginDependency struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

// PluginCapability is a capability a package publishes to other packages.
type PluginCapability struct {
	// Capability is the reverse-DNS identity, e.g. swiss.modelsphere.dev/gateway.
	Capability string `json:"capability" yaml:"capability"`

	// Version is the capability schema version, e.g. v1.
	Version string `json:"version" yaml:"version"`

	// Values publishes consumer-visible keys as paths into the provider's own
	// values, so consumers never learn the provider's values layout.
	// +optional
	Values map[string]string `json:"values,omitempty" yaml:"values,omitempty"`

	// SameNamespace restricts consumers to the provider's namespace. Data such
	// as imagePullSecrets only resolves inside the namespace that owns it.
	// +optional
	SameNamespace bool `json:"sameNamespace,omitempty" yaml:"sameNamespace,omitempty"`
}

// PluginCapabilityBinding binds a package to a capability it consumes.
type PluginCapabilityBinding struct {
	// Capability is the reverse-DNS identity declared by the provider.
	Capability string `json:"capability" yaml:"capability"`

	// Version is the capability schema version the consumer understands.
	// +optional
	Version string `json:"version,omitempty" yaml:"version,omitempty"`

	// From pins the provider when several offer the same capability.
	// +optional
	From *PluginCapabilitySource `json:"from,omitempty" yaml:"from,omitempty"`
}

// PluginCapabilitySource identifies the provider a binding accepts.
type PluginCapabilitySource struct {
	// Kind is "Plugin" or "Platform". Platform also covers capabilities the
	// platform supplies itself, before a dedicated plugin provides them.
	// +optional
	Kind string `json:"kind,omitempty" yaml:"kind,omitempty"`

	// Group is the provider's plugin API group.
	// +optional
	Group string `json:"group,omitempty" yaml:"group,omitempty"`

	// Name is the provider's plugin name.
	// +optional
	Name string `json:"name,omitempty" yaml:"name,omitempty"`

	// Version is a SemVer constraint on the provider's version.
	// +optional
	Version string `json:"version,omitempty" yaml:"version,omitempty"`
}

// UninstallPrecheck declares a plugin backend endpoint that decides whether the
// plugin may be uninstalled right now. The platform calls it from the Plugin
// DELETE admission check; a refusal or any failure to get an answer rejects
// the deletion.
type UninstallPrecheck struct {
	// Path is an /oapis/... path served through one of the plugin's
	// ReverseProxy routes. The platform sends GET and expects 200 with
	// {"allowed": bool, "reason": string}.
	Path string `json:"path"`

	// TimeoutSeconds bounds one precheck call. Omitted means 10; at most 25.
	// +optional
	TimeoutSeconds int32 `json:"timeoutSeconds,omitempty"`
}

// FrontendConfig defines how the plugin integrates with the Console frontend.
type FrontendConfig struct {
	// Type is the frontend integration type: "component" or "iframe".
	Type string `json:"type"`

	// Runtime specifies the loading mechanism: "built-in" or "remote".
	// +optional
	Runtime string `json:"runtime,omitempty"`

	// Entry is the entry filename for remote plugins.
	// +optional
	Entry string `json:"entry,omitempty"`
}

// PluginRoleTemplate defines a permission template declared in plugin.yaml.
type PluginRoleTemplate struct {
	// Name is the role template identifier.
	Name string `json:"name"`

	// DisplayName is the human-readable name.
	DisplayName string `json:"displayName,omitempty"`

	// Scope is the RBAC scope: "platform", "cluster", "workspace", "namespace".
	Scope string `json:"scope,omitempty"`

	// Rules are Kubernetes-style RBAC policy rules.
	// +optional
	Rules []PolicyRule `json:"rules,omitempty"`

	// UIPermissions are frontend permission keys.
	// +optional
	UIPermissions []string `json:"uiPermissions,omitempty"`
}

// PolicyRule defines a Kubernetes-style RBAC rule within plugin.yaml.
type PolicyRule struct {
	APIGroups []string `json:"apiGroups"`
	Resources []string `json:"resources"`
	Verbs     []string `json:"verbs"`
}

// ActivationConfig controls how the plugin is activated for tenants.
type ActivationConfig struct {
	// Policy: "auto" (all tenants), "manual" (admin enables per tenant), "required" (cannot disable).
	Policy string `json:"policy,omitempty"`
}

// FrontendStatus tracks whether frontend resources have been distributed.
type FrontendStatus struct {
	// Distributed indicates resources have been copied to the serving location.
	Distributed bool `json:"distributed"`

	// EntryURL is the serving path for the frontend bundle.
	// Example: /plugins/rise.io/v1/compute/index.umd.js
	EntryURL string `json:"entryURL,omitempty"`

	// DistributedAt is the timestamp of the last distribution.
	// +optional
	DistributedAt *metav1.Time `json:"distributedAt,omitempty"`
}

//+kubebuilder:object:root=true
//+kubebuilder:subresource:status
//+kubebuilder:resource:categories=rise,scope=Cluster
//+kubebuilder:printcolumn:name="Type",type="string",JSONPath=".spec.type"
//+kubebuilder:printcolumn:name="Scope",type="string",JSONPath=".spec.scope"
//+kubebuilder:printcolumn:name="Phase",type="string",JSONPath=".status.phase"
//+kubebuilder:printcolumn:name="Version",type="string",JSONPath=".spec.version"
//+kubebuilder:printcolumn:name="Enabled",type="boolean",JSONPath=".spec.enabled"
//+kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"

// Plugin is the Schema for the plugins API.
// It represents an installable extension managed via Helm.
type Plugin struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   PluginSpec   `json:"spec,omitempty"`
	Status PluginStatus `json:"status,omitempty"`
}

//+kubebuilder:object:root=true

// PluginList contains a list of Plugin.
type PluginList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Plugin `json:"items"`
}

func init() {
	SchemeBuilder.Register(func(s *runtime.Scheme) error {
		s.AddKnownTypes(GroupVersion, &Plugin{}, &PluginList{})
		metav1.AddToGroupVersion(s, GroupVersion)
		return nil
	})
}
