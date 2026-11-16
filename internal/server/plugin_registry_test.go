package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	iamapi "github.com/modelsphere/console/api/iam/v1alpha1"
	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/pluginregistry"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// staticPluginRegistry is the read side of Registrations with no informer.
type staticPluginRegistry struct {
	entries []*pluginregistry.Entry
	ready   bool
}

func (r *staticPluginRegistry) Entries() []*pluginregistry.Entry { return r.entries }
func (r *staticPluginRegistry) Ready() bool                      { return r.ready }
func (r *staticPluginRegistry) Run(context.Context)              {}

// registeredEntry builds the snapshot the CR observer would publish for one
// installed release: frontend files and one authenticated API route.
func registeredEntry(t *testing.T, upstream *url.URL) *pluginregistry.Entry {
	t.Helper()
	host, portText, err := net.SplitHostPort(upstream.Host)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	return &pluginregistry.Entry{
		Plugin: pluginapi.Plugin{
			ObjectMeta: metav1.ObjectMeta{Name: "modelsphere.dev--example"},
			Status: pluginapi.PluginStatus{
				PluginMeta:     &pluginapi.PluginMeta{Name: "example", Group: "modelsphere.dev", APIVersion: "v1", Version: "1.0.0"},
				FrontendStatus: &pluginapi.FrontendStatus{Distributed: true, EntryURL: "/plugins/modelsphere.dev--example/index.js"},
			},
		},
		Files: map[string][]byte{"index.js": []byte("registered entry"), "index.css": []byte("body{}")},
		Routes: []pluginregistry.Route{{Spec: iamapi.ReverseProxySpec{
			Matcher:    iamapi.ReverseProxyMatcher{Path: "/api/example/*"},
			Upstream:   iamapi.ReverseProxyUpstream{Scheme: upstream.Scheme, Host: host, Port: int32(port)},
			Directives: iamapi.ReverseProxyDirectives{AuthProxy: true},
		}}},
	}
}

func pluginRegistryServer(t *testing.T, entries ...*pluginregistry.Entry) (*Server, http.Handler, string, string) {
	t.Helper()
	registry := &staticPluginRegistry{entries: entries, ready: true}
	srv := testServer(t)
	srv.SetPluginRegistry(registry)
	handler := srv.Handler()
	return srv, handler, login(t, handler, "admin", "admin-pw"), login(t, handler, "bob", "bob-pw")
}

func TestRegisteredPluginServesIndexAssetsAndBackend(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "upstream %s", r.URL.Path)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, handler, admin, bob := pluginRegistryServer(t, registeredEntry(t, target))

	index := do(handler, "GET", "/plugins/index.json", admin, "")
	if index.Code != http.StatusOK {
		t.Fatalf("index: %d %s", index.Code, index.Body.String())
	}
	var plugins []pluginManifest
	if err := json.Unmarshal(index.Body.Bytes(), &plugins); err != nil {
		t.Fatal(err)
	}
	if len(plugins) != 1 || plugins[0].ID != "example" || plugins[0].Entry != "/plugins/modelsphere.dev--example/index.js" {
		t.Fatalf("index = %+v", plugins)
	}
	if len(plugins[0].Styles) != 1 || plugins[0].Styles[0] != "/plugins/modelsphere.dev--example/index.css" {
		t.Fatalf("styles = %v", plugins[0].Styles)
	}
	if plugins[0].Backend == nil || plugins[0].Backend.Name != "example" || plugins[0].Backend.Prefix != "/api/example" {
		t.Fatalf("backend = %+v", plugins[0].Backend)
	}

	asset := do(handler, "GET", "/plugins/modelsphere.dev--example/index.js", "", "")
	if asset.Code != http.StatusOK || asset.Body.String() != "registered entry" {
		t.Fatalf("asset: %d %q", asset.Code, asset.Body.String())
	}

	if unauthorized := do(handler, "GET", "/api/example/ping", "", ""); unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous backend request: %d", unauthorized.Code)
	}
	if forbidden := do(handler, "GET", "/api/example/ping", bob, ""); forbidden.Code != http.StatusForbidden {
		t.Fatalf("unauthorized backend request: %d %s", forbidden.Code, forbidden.Body.String())
	}
	allowed := do(handler, "GET", "/api/example/ping", admin, "")
	if allowed.Code != http.StatusOK || allowed.Body.String() != "upstream /api/example/ping" {
		t.Fatalf("backend: %d %q", allowed.Code, allowed.Body.String())
	}
}

func TestRevokedRegistrationStopsServingRoutesAndAssets(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "upstream")
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	registry := &staticPluginRegistry{entries: []*pluginregistry.Entry{registeredEntry(t, target)}, ready: true}
	srv := testServer(t)
	srv.SetPluginRegistry(registry)
	handler := srv.Handler()
	admin := login(t, handler, "admin", "admin-pw")

	if response := do(handler, "GET", "/api/example/ping", admin, ""); response.Code != http.StatusOK {
		t.Fatalf("backend before revocation: %d", response.Code)
	}
	registry.entries = nil

	index := do(handler, "GET", "/plugins/index.json", admin, "")
	if strings.Contains(index.Body.String(), "example") {
		t.Fatalf("revoked plugin remains in the index: %s", index.Body.String())
	}
	if asset := do(handler, "GET", "/plugins/modelsphere.dev--example/index.js", "", ""); asset.Code != http.StatusNotFound {
		t.Fatalf("revoked asset: %d", asset.Code)
	}
	if backend := do(handler, "GET", "/api/example/ping", admin, ""); backend.Code != http.StatusNotFound {
		t.Fatalf("revoked backend route: %d", backend.Code)
	}
}

func TestCapabilitiesIncludeRegisteredBackend(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, handler, admin, _ := pluginRegistryServer(t, registeredEntry(t, target))

	response := do(handler, "GET", "/api/capabilities", admin, "")
	if response.Code != http.StatusOK {
		t.Fatalf("capabilities: %d %s", response.Code, response.Body.String())
	}
	var capabilities map[string]backendCapability
	if err := json.Unmarshal(response.Body.Bytes(), &capabilities); err != nil {
		t.Fatal(err)
	}
	if !capabilities["example"].Configured || !capabilities["example"].CanRead {
		t.Fatalf("capabilities = %+v", capabilities)
	}
}

func TestReadinessWaitsForRegistrations(t *testing.T) {
	registry := &staticPluginRegistry{}
	srv := testServer(t)
	srv.SetPluginRegistry(registry)
	handler := srv.Handler()

	if response := do(handler, "GET", "/readyz", "", ""); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz while loading: %d", response.Code)
	}
	registry.ready = true
	if response := do(handler, "GET", "/readyz", "", ""); response.Code != http.StatusOK {
		t.Fatalf("readyz after sync: %d", response.Code)
	}
}
