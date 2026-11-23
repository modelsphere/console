package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateBackends(t *testing.T) {
	ok := Backend{Name: "swiss", Prefix: "/api/deploy", URL: "http://swissd.swiss.svc:8080/api"}
	cases := []struct {
		name    string
		backend []Backend
		wantErr string
	}{
		{"valid", []Backend{ok}, ""},
		{"missing url", []Backend{{Name: "swiss", Prefix: "/api/deploy"}}, "needs url, or a gateway"},
		{"missing name", []Backend{{Prefix: "/api/deploy", URL: ok.URL}}, "needs name and prefix"},
		{"missing prefix", []Backend{{Name: "swiss", URL: ok.URL}}, "needs name and prefix"},
		// Outside /api/ the auth middleware treats the path as a public SPA route.
		{"prefix outside /api", []Backend{{Name: "swiss", Prefix: "/deploy", URL: ok.URL}}, "under /api/"},
		{"prefix is /api itself", []Backend{{Name: "swiss", Prefix: "/api", URL: ok.URL}}, "under /api/"},
		{"prefix shadows iam", []Backend{{Name: "x", Prefix: "/api/iam", URL: ok.URL}}, "reserved"},
		{"prefix shadows me", []Backend{{Name: "x", Prefix: "/api/me", URL: ok.URL}}, "reserved"},
		{"prefix shadows router", []Backend{{Name: "x", Prefix: "/api/router", URL: ok.URL}}, "reserved"},
		{"trailing slash", []Backend{{Name: "swiss", Prefix: "/api/deploy/", URL: ok.URL}}, "trailing"},
		{"relative url", []Backend{{Name: "swiss", Prefix: "/api/deploy", URL: "swissd:8080"}}, "absolute http"},
		{"duplicate prefix", []Backend{ok, {Name: "other", Prefix: "/api/deploy", URL: ok.URL}}, "duplicate"},
		{"duplicate name", []Backend{ok, {Name: "swiss", Prefix: "/api/other", URL: ok.URL}}, "duplicate"},
		{
			"backend with a credential of its own",
			[]Backend{{Name: "llm", Prefix: "/api/llm", URL: "http://gw.svc:8080/llm", APIKeyEnv: "CONSOLE_LLM_API_KEY"}},
			"",
		},
		// A mistyped name sends no credential, and the backend then answers 401
		// for a reason the config never states.
		{
			"env name is not a name",
			[]Backend{{Name: "llm", Prefix: "/api/llm", URL: "http://gw.svc:8080/llm", APIKeyEnv: "llm-api-key"}},
			"not an environment variable name",
		},
		{
			"gateway backend reads the site profile",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Profile: "llm/site-profile"}}},
			"",
		},
		{
			"gateway backend names the route configmap and service directly",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{ConfigMap: "llm/openresty-conf", Service: "llm/openresty"}}},
			"",
		},
		{
			"both url and gateway",
			[]Backend{{Name: "llm", Prefix: "/api/llm", URL: "http://gw.svc:8080/llm", Gateway: &Gateway{Profile: "llm/site-profile"}}},
			"exactly one says where the backend is",
		},
		{
			"gateway without a source",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Service: "llm/openresty"}}},
			"needs profile or configMap",
		},
		{
			"gateway with both sources",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Profile: "llm/site-profile", ConfigMap: "llm/openresty-conf"}}},
			"both profile and configMap",
		},
		// A bare name cannot be looked up: nothing says which namespace.
		{
			"gateway profile without a namespace",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Profile: "site-profile"}}},
			"must be namespace/name",
		},
		{
			"gateway with no service and no profile to read one from",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{ConfigMap: "llm/openresty-conf"}}},
			"gateway.service is required",
		},
		{
			"gateway port out of range",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Profile: "llm/site-profile", Port: 70000}}},
			"not a port",
		},
		// The key Secret is the one reference a bare name may be used for: it
		// means the entrypoint's own namespace.
		{
			"gateway secretref may be bare",
			[]Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Profile: "llm/site-profile", SecretRef: "openresty"}}},
			"",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &Config{Server: Server{Auth: Auth{JWTSecret: "s"}}, Backends: tc.backend}
			err := c.Validate()
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)):
				t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestBackendAPIKey(t *testing.T) {
	t.Setenv("CONSOLE_TEST_GATEWAY_KEY", "gw-secret")
	base := Backend{Name: "llm", Prefix: "/api/llm", URL: "http://gw.svc:8080/llm"}

	withKey := base
	withKey.APIKeyEnv = "CONSOLE_TEST_GATEWAY_KEY"
	if got := withKey.APIKey(); got != "gw-secret" {
		t.Fatalf("APIKey() = %q, want the variable's value", got)
	}

	unset := base
	unset.APIKeyEnv = "CONSOLE_TEST_GATEWAY_KEY_UNSET"
	if got := unset.APIKey(); got != "" {
		t.Fatalf("APIKey() = %q for an unset variable, want empty", got)
	}
	if got := base.APIKey(); got != "" {
		t.Fatalf("APIKey() = %q for a backend naming none, want empty", got)
	}
}

func TestValidateBackendAccessRules(t *testing.T) {
	base := BackendAccessRule{PathPrefix: "/policies", Methods: []string{"POST"}, ResourceName: "autotune-settings", Verb: "create"}
	testCases := []struct {
		name    string
		rules   []BackendAccessRule
		wantErr string
	}{
		{"separate methods", []BackendAccessRule{base, {PathPrefix: "/policies", Methods: []string{"PUT"}, ResourceName: "autotune-settings", Verb: "update"}}, ""},
		{"catch-all", []BackendAccessRule{base, {PathPrefix: "/", Methods: []string{"POST"}, ResourceName: "autotune-unmapped", Verb: "create"}}, ""},
		{"duplicate method", []BackendAccessRule{base, base}, "duplicate rule"},
		{"trailing slash", []BackendAccessRule{{PathPrefix: "/policies/", Methods: base.Methods, ResourceName: base.ResourceName, Verb: base.Verb}}, "clean backend-relative path"},
		{"missing resource name", []BackendAccessRule{{PathPrefix: "/policies", Methods: base.Methods, Verb: base.Verb}}, "methods and resourceName"},
		{"unsupported method", []BackendAccessRule{{PathPrefix: "/policies", Methods: []string{"post"}, ResourceName: base.ResourceName, Verb: base.Verb}}, "unsupported HTTP method"},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			backend := Backend{Name: "autotune", Prefix: "/api/autotune", URL: "http://autotune:8000/api", AccessRules: tc.rules}
			err := validateBackend(backend)
			if tc.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)) {
				t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

// document is what a config file says, and the YAML key names are part of the
// contract: KnownFields turns a typo into a startup failure instead of a setting
// that quietly does nothing.
const document = `
server:
  auth:
    jwtSecret: s
backends:
  - name: swiss
    prefix: /api/deploy
    url: http://swissd.swiss.svc:8080/api
  - name: llm
    prefix: /api/llm
    gateway:
      profile: llm/site-profile
      route: llm-gateway
`

func TestLoadGatewayBackend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "console.yaml")
	if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	llm := c.Backends[1]
	if llm.Gateway == nil || llm.Gateway.Profile != "llm/site-profile" || llm.Gateway.Route != "llm-gateway" {
		t.Fatalf("gateway = %+v", llm.Gateway)
	}
	// The defaults the resolver applies, not the config: what the file omits is
	// whatever the cluster says.
	if llm.Gateway.Port != 0 || llm.Gateway.SecretKey != "" {
		t.Fatalf("gateway = %+v", llm.Gateway)
	}

	typo := filepath.Join(t.TempDir(), "console.yaml")
	if err := os.WriteFile(typo, []byte(strings.Replace(document, "gateway:", "gatewai:", 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(typo); err == nil || !strings.Contains(err.Error(), "gatewai") {
		t.Fatalf("a misspelled key loaded: %v", err)
	}
}

func TestValidateRouter(t *testing.T) {
	llm := Backend{Name: "llm", Prefix: "/api/llm", Gateway: &Gateway{Profile: "llm/site-profile"}}
	cases := []struct {
		name    string
		router  Router
		wantErr string
	}{
		{"off", Router{}, ""},
		{"on", Router{Secret: "console/console-api-keys"}, ""},
		{"secret without namespace", Router{Secret: "console-api-keys"}, "namespace/name"},
		{"unknown backend", Router{Secret: "console/k", Backend: "swiss"}, "not a configured backend"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &Config{Server: Server{Auth: Auth{JWTSecret: "s"}}, Backends: []Backend{llm}, Router: tc.router}
			c.applyDefaults()
			err := c.Validate()
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)):
				t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

// The example is documentation people copy; it has to be a config console would
// actually accept.
func TestExampleConfigLoads(t *testing.T) {
	c, err := Load("../../examples/console.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	llm := c.Backends[1]
	if llm.Gateway == nil || llm.Gateway.Profile == "" {
		t.Fatalf("the example no longer shows a gateway backend: %+v", llm)
	}
	if !c.Router.Enabled() || c.Router.Backend != "llm" || c.Router.MaxBodyBytes != DefaultMaxBodyBytes {
		t.Fatalf("the example no longer shows the router: %+v", c.Router)
	}
	if c.Server.MetricsAddr != DefaultMetricsAddr {
		t.Fatalf("metricsAddr = %q", c.Server.MetricsAddr)
	}
}
