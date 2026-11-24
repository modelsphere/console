/*
Copyright 2025.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package iam

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ReverseProxyMatcher defines request matching rules
type ReverseProxyMatcher struct {
	// HTTP method to match (* for all methods)
	// +optional
	Method string `json:"method,omitempty"`

	// Path pattern to match (supports wildcards)
	Path string `json:"path"`
}

// ReverseProxyUpstream defines upstream service configuration
type ReverseProxyUpstream struct {
	// Protocol scheme (http/https)
	Scheme string `json:"scheme"`

	// Upstream host
	Host string `json:"host"`

	// Upstream port
	Port int32 `json:"port"`

	// Skip TLS certificate verification
	// +optional
	InsecureSkipVerify bool `json:"insecureSkipVerify,omitempty"`

	// CA certificate bundle (Base64 encoded)
	// +optional
	CABundle string `json:"caBundle,omitempty"`
}

// RawURL returns the full upstream URL
func (u *ReverseProxyUpstream) RawURL() string {
	return fmt.Sprintf("%s://%s:%d", u.Scheme, u.Host, u.Port)
}

// ReverseProxyDirectives defines proxy behavior and transformation rules
type ReverseProxyDirectives struct {
	// Enable authentication proxy
	// +optional
	AuthProxy bool `json:"authProxy,omitempty"`

	// Skip host authentication and authorization for matching requests; upstream must authenticate.
	// Mutually exclusive with authProxy.
	// +optional
	SkipAuthentication bool `json:"skipAuthentication,omitempty"`

	// Wrap transport for additional processing
	// +optional
	WrapTransport bool `json:"wrapTransport,omitempty"`

	// Override HTTP method
	// +optional
	Method string `json:"method,omitempty"`

	// Remove path prefix
	// +optional
	StripPathPrefix string `json:"stripPathPrefix,omitempty"`

	// Remove path suffix
	// +optional
	StripPathSuffix string `json:"stripPathSuffix,omitempty"`

	// Request header modifications
	// +optional
	HeaderUp []string `json:"headerUp,omitempty"`

	// Response header modifications
	// +optional
	HeaderDown []string `json:"headerDown,omitempty"`

	// Path rewrite rules
	// +optional
	Rewrite []ReverseProxyRewriteRule `json:"rewrite,omitempty"`

	// Content replacement rules
	// +optional
	Replace []ReverseProxyReplaceRule `json:"replace,omitempty"`
}

// ReverseProxyRewriteRule defines path rewriting rules
type ReverseProxyRewriteRule struct {
	// Source pattern (regex)
	From string `json:"from"`

	// Target replacement
	To string `json:"to"`
}

// ReverseProxyReplaceRule defines content replacement rules
type ReverseProxyReplaceRule struct {
	// Source pattern (regex)
	From string `json:"from"`

	// Target replacement
	To string `json:"to"`
}

// ReverseProxySpec defines the desired state of ReverseProxy
type ReverseProxySpec struct {
	// Request matching rules
	Matcher ReverseProxyMatcher `json:"matcher"`

	// Upstream service configuration
	Upstream ReverseProxyUpstream `json:"upstream"`

	// Proxy directives and transformation rules
	// +optional
	Directives ReverseProxyDirectives `json:"directives,omitempty"`
}

// ReverseProxyState represents the state of the proxy
type ReverseProxyState string

const (
	// ReverseProxyStateAvailable indicates the proxy is healthy and available
	ReverseProxyStateAvailable ReverseProxyState = "Available"

	// ReverseProxyStateUnavailable indicates the upstream is not reachable
	ReverseProxyStateUnavailable ReverseProxyState = "Unavailable"

	// ReverseProxyStateError indicates a configuration or runtime error
	ReverseProxyStateError ReverseProxyState = "Error"
)

// ReverseProxyStatus defines the observed state of ReverseProxy
type ReverseProxyStatus struct {
	// Current state of the proxy
	// +optional
	State ReverseProxyState `json:"state,omitempty"`

	// Human-readable message describing the current state
	// +optional
	Message string `json:"message,omitempty"`

	// Last time the status was updated
	// +optional
	LastUpdateTime *metav1.Time `json:"lastUpdateTime,omitempty"`
}

//+kubebuilder:object:root=true
//+kubebuilder:subresource:status
//+kubebuilder:printcolumn:name="Host",type="string",JSONPath=".spec.upstream.host"
//+kubebuilder:printcolumn:name="Port",type="integer",JSONPath=".spec.upstream.port"
//+kubebuilder:printcolumn:name="Path",type="string",JSONPath=".spec.matcher.path"
//+kubebuilder:printcolumn:name="State",type="string",JSONPath=".status.state"
//+kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"

// ReverseProxy general reverse proxy resource definition
type ReverseProxy struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ReverseProxySpec   `json:"spec,omitempty"`
	Status ReverseProxyStatus `json:"status,omitempty"`
}

//+kubebuilder:object:root=true

// ReverseProxyList contains a list of ReverseProxy
type ReverseProxyList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ReverseProxy `json:"items"`
}
