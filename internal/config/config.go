// Package config is console's one configuration document.
//
// console is the community portal's BFF: it owns identity (users, roles,
// login) and federates every other capability to backends like swissd. The
// config therefore has three sections -- how to reach Kubernetes (where users
// and roles live as CRDs), how to sign and verify tokens, and which backends
// to proxy.
package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Cluster  Cluster   `yaml:"cluster,omitempty"`
	Server   Server    `yaml:"server,omitempty"`
	Backends []Backend `yaml:"backends,omitempty"`
	Router   Router    `yaml:"router,omitempty"`

	Origin string `yaml:"-"`
}

// Router is /v1, the endpoint programs call models through with API keys admins
// issue. Empty Secret leaves it, and key management, off.
type Router struct {
	// Secret holding the issued keys, "namespace/name"; console creates it.
	Secret string `yaml:"secret,omitempty"`
	// Backend is the backend /v1 forwards to, by name. Default "llm".
	Backend string `yaml:"backend,omitempty"`
	// MaxBodyBytes caps a /v1 request body, which is read whole to check its
	// model. Default 16 MiB.
	MaxBodyBytes int64 `yaml:"maxBodyBytes,omitempty"`
}

const (
	DefaultRouterBackend = "llm"
	DefaultMaxBodyBytes  = 16 << 20
	DefaultMetricsAddr   = ":9090"
)

func (r Router) Enabled() bool { return r.Secret != "" }

// Cluster is where the iam CRDs (User/Role/RoleBinding) are read and written.
// Empty kubeconfig means in-cluster, which is the normal deployment.
type Cluster struct {
	Kubeconfig string `yaml:"kubeconfig,omitempty"`
	Context    string `yaml:"context,omitempty"`
}

type Server struct {
	Addr string `yaml:"addr,omitempty"`
	// MetricsAddr serves Prometheus metrics, apart from Addr so they are not
	// reachable wherever the UI is. Default ":9090"; "off" disables it.
	MetricsAddr string `yaml:"metricsAddr,omitempty"`
	Auth        Auth   `yaml:"auth,omitempty"`
}

// Auth signs and verifies the HS256 tokens. The claim set and algorithm are
// kept identical to Rise Global so a later cutover is just sharing this secret
// and pointing at Global's apiserver.
type Auth struct {
	// Disabled runs console with no login: every request carries the local
	// administrator, and the authorizer's system:masters short-circuit allows
	// it everything. For a laptop or a single-tenant cluster; it is logged at
	// startup. swissd behind console already runs with its own auth off and
	// trusts console's RBAC, so with this set nothing in the stack authorises
	// anything.
	Disabled bool `yaml:"disabled,omitempty"`
	// JWTSecret is the HS256 signing key, shared with Global on upgrade.
	JWTSecret string `yaml:"jwtSecret,omitempty"`
	// Issuer is the token `iss` claim; also the OIDC issuer URL.
	Issuer string `yaml:"issuer,omitempty"`
	// TokenTTL bounds an access token's life.
	TokenTTL time.Duration `yaml:"tokenTTL,omitempty"`
}

// Backend is one federated service console reverse-proxies to. Prefix is
// replaced by URL's path: with prefix /api/deploy and url http://swissd/api,
// /api/deploy/catalog reaches http://swissd/api/catalog. Name is the RBAC
// resourceName under resource "backends".
type Backend struct {
	Name   string `yaml:"name"`
	Prefix string `yaml:"prefix"`
	URL    string `yaml:"url"`
	// Gateway makes this backend an inference entrypoint whose address is read
	// from the cluster rather than written here. Exactly one of URL and Gateway
	// is set.
	Gateway *Gateway `yaml:"gateway,omitempty"`
	// APIKeyEnv is the environment variable holding a credential console sends
	// to this backend on every request, as `Authorization: Bearer <value>`,
	// replacing the caller's token. It is how a backend authenticates the portal
	// instead of the browser: an inference gateway's key stays server-side and
	// never becomes part of what the SPA can read. llm-openresty accepts only
	// this form (lua/api_keys.parse_bearer).
	//
	// Empty means the caller's token is forwarded unchanged, which is what a
	// backend that verifies the JWT itself (swissd) wants. On a Gateway backend
	// it is an override: the key otherwise comes from the Secret the profile
	// names, so a cluster that keeps the console and the gateway in one
	// namespace can still take a copied key through a Secret volume.
	APIKeyEnv string `yaml:"apiKeyEnv,omitempty"`
}

// Gateway is an inference entrypoint resolved from the cluster at startup and
// refreshed as the cluster changes. Nothing here names a URL, because none of it
// is stable: the entrypoint Service moves with the install, the routes come and
// go with every deploy, and the key is rotated by whoever runs the gateway. A
// URL copied into a values file goes stale silently; a route set copied there
// makes the Playground lie about what is deployed.
//
// Two ways to say where the truth is: the swiss site profile (what swissd
// deploys from, so the two cannot disagree), or the openresty route ConfigMap
// and its Service directly for an install that has no swissd.
type Gateway struct {
	// Profile is the site profile ConfigMap, "namespace/name". Everything below
	// that it does not name comes from there: route.nginxService, nginxPort,
	// nginxConfigMap and auth (header, prefix, secretRef, secretKey).
	Profile string `yaml:"profile,omitempty"`
	// ConfigMap is the openresty route ConfigMap, "namespace/name", when there
	// is no profile. Its session_route_<route>.conf keys are the routes, and
	// the aggregate one -- the route that serves several models, which is what
	// lets one picker list everything deployed -- is chosen from them.
	ConfigMap string `yaml:"configMap,omitempty"`
	// Service is the entrypoint Service, "namespace/name".
	Service string `yaml:"service,omitempty"`
	// Port of the entrypoint. Default 8080 (the openresty chart's one port).
	Port int `yaml:"port,omitempty"`
	// Route pins the route to talk to. Empty picks the aggregate route.
	Route string `yaml:"route,omitempty"`
	// SecretRef is the Secret holding the gateway's keys, "namespace/name" or a
	// bare name meaning the entrypoint's namespace. SecretKey is the entry
	// inside it, default "keys", whose value is "key1:owner1,key2:owner2"; the
	// first key is the one console sends.
	SecretRef string `yaml:"secretRef,omitempty"`
	SecretKey string `yaml:"secretKey,omitempty"`
}

// GatewayDefaults are the values a Gateway falls back to when neither it nor the
// profile names one.
const (
	DefaultGatewayPort      = 8080
	DefaultGatewaySecretKey = "keys"
)

// APIKey is the backend's own credential, read from the environment. Empty when
// the backend names none, or when the variable is unset.
func (b Backend) APIKey() string {
	if b.APIKeyEnv == "" {
		return ""
	}
	return os.Getenv(b.APIKeyEnv)
}

func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	dec.KnownFields(true) // an unknown key is a typo, not a setting that does nothing
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	c.Origin = path
	c.applyDefaults()
	return &c, nil
}

// Find locates a config without requiring one: an explicit path, then
// CONSOLE_CONFIG, then ./console.yaml, then ~/.config/console/console.yaml.
func Find(explicit string) string {
	if explicit != "" {
		return explicit
	}
	if v := os.Getenv("CONSOLE_CONFIG"); v != "" {
		return v
	}
	candidates := []string{"console.yaml"}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".config", "console", "console.yaml"))
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func (c *Config) applyDefaults() {
	if c.Server.Addr == "" {
		c.Server.Addr = ":8080"
	}
	if c.Server.Auth.TokenTTL == 0 {
		c.Server.Auth.TokenTTL = 24 * time.Hour
	}
	if c.Server.Auth.Issuer == "" {
		c.Server.Auth.Issuer = "https://console.modelsphere.local"
	}
	if c.Server.MetricsAddr == "" {
		c.Server.MetricsAddr = DefaultMetricsAddr
	}
	if c.Router.Backend == "" {
		c.Router.Backend = DefaultRouterBackend
	}
	if c.Router.MaxBodyBytes == 0 {
		c.Router.MaxBodyBytes = DefaultMaxBodyBytes
	}
}

func (c *Config) origin() string {
	if c.Origin == "" {
		return "config"
	}
	return c.Origin
}

// Validate covers what console needs to serve.
func (c *Config) Validate() error {
	if c.Server.Auth.JWTSecret == "" && !c.Server.Auth.Disabled {
		return fmt.Errorf("%s: server.auth.jwtSecret is required -- it signs every token, or set server.auth.disabled to run without a login", c.origin())
	}
	names, prefixes := map[string]bool{}, map[string]bool{}
	for i, b := range c.Backends {
		if b.Name == "" || b.Prefix == "" {
			return fmt.Errorf("%s: backends[%d] needs name and prefix", c.origin(), i)
		}
		if err := validateBackend(b); err != nil {
			return fmt.Errorf("%s: backends[%d] (%s): %w", c.origin(), i, b.Name, err)
		}
		if names[b.Name] || prefixes[b.Prefix] {
			return fmt.Errorf("%s: backends[%d] (%s): duplicate name or prefix", c.origin(), i, b.Name)
		}
		names[b.Name], prefixes[b.Prefix] = true, true
	}
	if a := c.Router; a.Enabled() {
		switch {
		case !refRE.MatchString(a.Secret):
			return fmt.Errorf("%s: router.secret %q must be namespace/name", c.origin(), a.Secret)
		case !names[a.Backend]:
			return fmt.Errorf("%s: router.backend %q is not a configured backend; /v1 would have nowhere to go", c.origin(), a.Backend)
		case a.MaxBodyBytes < 0:
			return fmt.Errorf("%s: router.maxBodyBytes must not be negative", c.origin())
		}
	}
	return nil
}

// reservedPrefixes are console's own API; a backend there would shadow them.
var reservedPrefixes = []string{"/api/iam", "/api/me", "/api/router"}

func validateBackend(b Backend) error {
	// Only /api/* passes the auth middleware's guard; anything else is served
	// to anonymous callers as an SPA route.
	if !strings.HasPrefix(b.Prefix, "/api/") || len(b.Prefix) == len("/api/") {
		return fmt.Errorf("prefix %q must be a path under /api/", b.Prefix)
	}
	if strings.HasSuffix(b.Prefix, "/") {
		return fmt.Errorf("prefix %q must not have a trailing slash", b.Prefix)
	}
	for _, r := range reservedPrefixes {
		if b.Prefix == r || strings.HasPrefix(b.Prefix, r+"/") {
			return fmt.Errorf("prefix %q is reserved by console", b.Prefix)
		}
	}
	switch {
	case b.URL == "" && b.Gateway == nil:
		return fmt.Errorf("needs url, or a gateway to resolve one from")
	case b.URL != "" && b.Gateway != nil:
		return fmt.Errorf("has both url and gateway; exactly one says where the backend is")
	case b.Gateway != nil:
		if err := validateGateway(*b.Gateway); err != nil {
			return err
		}
	default:
		u, err := url.Parse(b.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("url %q must be an absolute http(s) URL", b.URL)
		}
	}
	// A mistyped env name would silently send no credential, and the backend
	// would answer 401 for reasons nobody can see in the config.
	if b.APIKeyEnv != "" && !envNameRE.MatchString(b.APIKeyEnv) {
		return fmt.Errorf("apiKeyEnv %q is not an environment variable name", b.APIKeyEnv)
	}
	return nil
}

// validateGateway checks only what can be known without the cluster. Whether the
// profile names a Service, whether the route ConfigMap has an aggregate route --
// those are answered at startup where the answer can be logged with the reason.
func validateGateway(g Gateway) error {
	switch {
	case g.Profile == "" && g.ConfigMap == "":
		return fmt.Errorf("gateway needs profile or configMap to say where the entrypoint is")
	case g.Profile != "" && g.ConfigMap != "":
		return fmt.Errorf("gateway has both profile and configMap; the profile already names one")
	}
	for _, ref := range []struct{ field, value string }{
		{"profile", g.Profile}, {"configMap", g.ConfigMap}, {"service", g.Service},
	} {
		if ref.value != "" && !refRE.MatchString(ref.value) {
			return fmt.Errorf("gateway.%s %q must be namespace/name", ref.field, ref.value)
		}
	}
	// A profile carries the Service; without one, nothing else does.
	if g.Profile == "" && g.Service == "" {
		return fmt.Errorf("gateway.service is required when there is no profile to read it from")
	}
	if g.SecretRef != "" && !refRE.MatchString(g.SecretRef) && !nameRE.MatchString(g.SecretRef) {
		return fmt.Errorf("gateway.secretRef %q must be name or namespace/name", g.SecretRef)
	}
	if g.Port < 0 || g.Port > 65535 {
		return fmt.Errorf("gateway.port %d is not a port", g.Port)
	}
	if strings.ContainsAny(g.SecretKey+g.Route, " \t") {
		return fmt.Errorf("gateway.secretKey and gateway.route must not contain spaces")
	}
	return nil
}

var (
	envNameRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	refRE     = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?/[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`)
	nameRE    = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`)
)
