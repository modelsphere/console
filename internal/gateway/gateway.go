// Package gateway resolves an inference entrypoint from the cluster.
//
// A backend declared as a Gateway names no URL, because none of what makes one up
// is stable: the entrypoint Service moves with its install, the routes come and go
// with every model deployed, and the key is rotated by whoever runs the gateway. A
// URL copied into a values file goes stale silently. Resolution reads what is
// already the source of truth -- the site profile swissd deploys from, the
// openresty route list beside it, and the Secret holding the gateway's keys -- and
// caches the answer briefly, so a model deployed after the console started begins
// working without a redeploy.
package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/modelsphere/console/internal/config"
)

// reader is the slice of cluster access this package needs, so a test can hand it
// a fake without a cluster.
type reader interface {
	ConfigMap(ctx context.Context, namespace, name string) (map[string]string, error)
	Secret(ctx context.Context, namespace, name string) (map[string][]byte, error)
}

// Entry is a resolved entrypoint: where inference goes, and with which credential.
type Entry struct {
	// URL is the preferred route's; Base plus a route of Routes reaches any.
	URL   string
	Route string
	Base  string
	// Routes are every route the gateway serves, aggregate ones first. Which
	// route serves which model is answered by asking each its /v1/models.
	Routes []string
	Header string
	Key    string
	// Source is what answered, for the log line and for anyone reading a 502:
	// "profile llm/site-profile" or "routes llm/openresty-conf".
	Source string
	// KeySource is where the credential came from, or why there is none. Never a
	// key.
	KeySource string
}

var ErrNoRoutes = fmt.Errorf("no session_route_<route>.conf entry")

// refresh is how long a resolved entrypoint is reused. Long enough that a busy
// Playground does not read the same two ConfigMaps per request, short enough that
// a deploy shows up without touching the console.
const refresh = 30 * time.Second

// Resolver resolves one Gateway backend and caches the result.
type Resolver struct {
	backend config.Backend
	r       reader
	log     *slog.Logger
	ttl     time.Duration

	mu    sync.Mutex
	entry *Entry
	at    time.Time
	err   error
}

// NewResolver resolves the backend's gateway. apiKeyEnv, when set, is the
// backend's own credential and wins over the Secret.
func NewResolver(backend config.Backend, r reader, log *slog.Logger) *Resolver {
	return &Resolver{backend: backend, r: r, log: log, ttl: refresh}
}

// Resolve returns the entrypoint, from cache while the cached answer is fresh. A
// refresh that fails keeps the last good answer rather than taking inference down
// over a transient API error; only a gateway that has never resolved reports it.
func (r *Resolver) Resolve(ctx context.Context) (*Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.entry != nil && time.Since(r.at) < r.ttl {
		return r.entry, nil
	}
	if r.entry == nil && r.err != nil && time.Since(r.at) < r.ttl {
		return nil, r.err
	}

	entry, err := r.resolve(ctx, false)
	r.at = time.Now()
	switch {
	case err != nil && r.entry != nil:
		r.log.Warn("gateway not re-resolved, keeping the last known one", "err", err, "url", r.entry.URL)
		return r.entry, nil
	case err != nil:
		// A new or changed reason is logged once, not once per request: the
		// failure is cached for the TTL, and requests keep arriving meanwhile.
		if r.err == nil || r.err.Error() != err.Error() {
			r.log.Warn("gateway unresolved", "backend", r.backend.Name, "err", err)
		}
		r.err = err
		return nil, err
	}
	if r.entry == nil || !r.entry.equal(entry) {
		r.log.Info("gateway resolved", "url", entry.Base, "routes", strings.Join(entry.Routes, ","), "key", entry.KeySource, "from", entry.Source)
	}
	r.entry, r.err = entry, nil
	return entry, nil
}

// ResolveCatalog discovers existing routes without inference pinning or credentials.
func (r *Resolver) ResolveCatalog(ctx context.Context) (*Entry, error) {
	return r.resolve(ctx, true)
}

func (r *Resolver) resolve(ctx context.Context, catalog bool) (*Entry, error) {
	gw := r.backend.Gateway
	if gw == nil {
		return nil, fmt.Errorf("backend %s is not a gateway", r.backend.Name)
	}
	profile, profileRef, err := r.siteProfile(ctx)
	if err != nil {
		return nil, err
	}

	serviceRef := gw.Service
	if serviceRef == "" {
		serviceRef = profile.Route.NginxService
	}
	if serviceRef == "" {
		return nil, fmt.Errorf("%s names no route.nginxService, so there is no entrypoint to send inference to", profileRef)
	}
	svcNS, svcName, err := splitRef(serviceRef, "")
	if err != nil {
		return nil, fmt.Errorf("entrypoint service: %w", err)
	}

	port := gw.Port
	if port == 0 {
		port = profile.Route.NginxPort
	}
	if port == 0 {
		port = config.DefaultGatewayPort
	}

	routes, source, err := r.routes(ctx, profile, profileRef, catalog)
	if err != nil {
		return nil, err
	}

	base := fmt.Sprintf("http://%s.%s.svc:%d", svcName, svcNS, port)
	entry := &Entry{
		URL:    base + "/" + routes[0],
		Route:  routes[0],
		Base:   base,
		Routes: routes,
		Header: profile.Route.Auth.HeaderName(),
		Source: source,
	}
	if !catalog {
		if err := r.credential(ctx, profile, svcNS, entry); err != nil {
			return nil, err
		}
	}
	return entry, nil
}

// routes lists inference routes, or all configured routes for catalog discovery.
func (r *Resolver) routes(ctx context.Context, p profile, profileRef string, catalog bool) (routes []string, source string, err error) {
	gw := r.backend.Gateway
	ref := gw.ConfigMap
	if ref == "" {
		ref = p.Route.NginxConfigMap
	}
	if gw.Route != "" && (!catalog || ref == "") {
		source = ref
		if source == "" {
			source = profileRef
		}
		return []string{gw.Route}, source, nil
	}
	if ref == "" {
		if catalog {
			return nil, "", ErrNoRoutes
		}
		return nil, "", fmt.Errorf("no gateway.route and no route configmap to choose one from: set gateway.route")
	}
	ns, name, err := splitRef(ref, "")
	if err != nil {
		return nil, "", err
	}
	data, err := r.r.ConfigMap(ctx, ns, name)
	if err != nil {
		return nil, "", fmt.Errorf("route configmap %s: %w", ref, err)
	}

	var aggregates, plain []string
	for key, content := range data {
		route, ok := routeOfKey(key)
		if !ok {
			continue
		}
		if strings.Contains(content, "peers_by_model") {
			aggregates = append(aggregates, route)
		} else {
			plain = append(plain, route)
		}
	}
	if len(aggregates)+len(plain) == 0 {
		return nil, "", fmt.Errorf("route configmap %s has %w; is this the entrypoint's shared configmap?", ref, ErrNoRoutes)
	}
	sort.Strings(aggregates)
	sort.Strings(plain)
	return append(aggregates, plain...), ref, nil
}

// credential fills in the key console sends. An explicit apiKeyEnv wins so an
// install that copies the key into its own namespace keeps working; otherwise the
// key is read from the Secret the profile names. No Secret named means the
// gateway runs without keys -- llm-openresty then lets everything through, and
// says so on its own health endpoint.
func (r *Resolver) credential(ctx context.Context, p profile, entryNS string, entry *Entry) error {
	gw := r.backend.Gateway
	auth := p.Route.Auth
	if r.backend.APIKeyEnv != "" {
		key := os.Getenv(r.backend.APIKeyEnv)
		if key == "" {
			entry.KeySource = "env " + r.backend.APIKeyEnv + " is empty"
			return nil
		}
		entry.Key, entry.KeySource = auth.KeyPrefix()+key, "env "+r.backend.APIKeyEnv
		return nil
	}

	ref := gw.SecretRef
	if ref == "" {
		ref = auth.SecretRef
	}
	if ref == "" {
		entry.KeySource = "no secret named; the gateway must run without keys"
		return nil
	}
	ns, name, err := splitRef(ref, entryNS)
	if err != nil {
		return fmt.Errorf("gateway key: %w", err)
	}
	entryName := gw.SecretKey
	if entryName == "" {
		entryName = auth.SecretKey
	}
	if entryName == "" {
		entryName = config.DefaultGatewaySecretKey
	}

	data, err := r.r.Secret(ctx, ns, name)
	if err != nil {
		return fmt.Errorf("gateway key secret %s/%s: %w", ns, name, err)
	}
	raw, ok := data[entryName]
	if !ok {
		return fmt.Errorf("gateway key secret %s/%s has no %q entry (it has: %s)", ns, name, entryName, strings.Join(keys(data), ", "))
	}
	key, owner := firstKey(string(raw))
	if key == "" {
		entry.KeySource = fmt.Sprintf("secret %s/%s entry %s is empty; the gateway must run without keys", ns, name, entryName)
		return nil
	}
	entry.Key = auth.KeyPrefix() + key
	entry.KeySource = fmt.Sprintf("secret %s/%s entry %s (key of %s)", ns, name, entryName, owner)
	return nil
}

func (r *Resolver) siteProfile(ctx context.Context) (profile, string, error) {
	gw := r.backend.Gateway
	if gw == nil || gw.Profile == "" {
		return profile{}, "", nil
	}
	ns, name, err := splitRef(gw.Profile, "")
	if err != nil {
		return profile{}, gw.Profile, err
	}
	raw, err := r.r.ConfigMap(ctx, ns, name)
	if err != nil {
		return profile{}, gw.Profile, fmt.Errorf("site profile %s: %w", gw.Profile, err)
	}
	// swissd reads the profile from this one key of the ConfigMap.
	text, ok := raw[profileKey]
	if !ok {
		return profile{}, gw.Profile, fmt.Errorf("site profile %s has no %s entry (it has: %s)", gw.Profile, profileKey, strings.Join(keys(raw), ", "))
	}
	var p profile
	if err := yaml.Unmarshal([]byte(text), &p); err != nil {
		return profile{}, gw.Profile, fmt.Errorf("site profile %s: %w", gw.Profile, err)
	}
	return p, gw.Profile, nil
}

// profileKey is the entry swissd reads a site profile from (swiss's
// site.DefaultProfileKey).
const profileKey = "profile.yaml"

// profile is the part of swiss's site profile the console needs. Kept as a
// separate type rather than imported from swiss: the console reads the document,
// it does not depend on the program that writes it.
type profile struct {
	Route struct {
		NginxConfigMap string    `yaml:"nginxConfigMap"`
		NginxService   string    `yaml:"nginxService"`
		NginxPort      int       `yaml:"nginxPort"`
		Auth           routeAuth `yaml:"auth"`
	} `yaml:"route"`
}

// routeAuth names where the gateway's key lives, rather than holding it: the
// profile is a ConfigMap, readable by anyone who can read the profile.
type routeAuth struct {
	Header    string `yaml:"header"`
	Prefix    string `yaml:"prefix"`
	SecretRef string `yaml:"secretRef"`
	SecretKey string `yaml:"secretKey"`
}

// HeaderName is where the key goes; the OpenAI convention by default, which is
// also the only form llm-openresty accepts.
func (a routeAuth) HeaderName() string {
	if a.Header != "" {
		return a.Header
	}
	return "Authorization"
}

func (a routeAuth) KeyPrefix() string {
	if a.Prefix != "" {
		return a.Prefix
	}
	return "Bearer "
}

func routeOfKey(key string) (string, bool) {
	const prefix, suffix = "session_route_", ".conf"
	if !strings.HasPrefix(key, prefix) || !strings.HasSuffix(key, suffix) {
		return "", false
	}
	route := strings.TrimSuffix(strings.TrimPrefix(key, prefix), suffix)
	return route, route != ""
}

// firstKey reads the gateway's key file format, "key1:owner1,key2:owner2", and
// returns the first key with its owner label.
func firstKey(entry string) (key, owner string) {
	for _, pair := range strings.Split(entry, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		key, owner, _ = strings.Cut(pair, ":")
		return strings.TrimSpace(key), strings.TrimSpace(owner)
	}
	return "", ""
}

// splitRef reads "namespace/name", qualifying a bare name with def.
func splitRef(ref, def string) (namespace, name string, err error) {
	if ns, n, ok := strings.Cut(ref, "/"); ok {
		if ns == "" || n == "" {
			return "", "", fmt.Errorf("%q must be namespace/name", ref)
		}
		return ns, n, nil
	}
	if def == "" {
		return "", "", fmt.Errorf("%q must be namespace/name", ref)
	}
	return def, ref, nil
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (e *Entry) equal(o *Entry) bool {
	return e.URL == o.URL && e.Route == o.Route && e.Base == o.Base && slices.Equal(e.Routes, o.Routes) &&
		e.Header == o.Header && e.Key == o.Key && e.Source == o.Source && e.KeySource == o.KeySource
}
