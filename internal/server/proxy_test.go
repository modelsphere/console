package server

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	"github.com/modelsphere/console/internal/config"
)

type seenRequest struct {
	method, path, query, body string
	header                    http.Header
}

// upstream is a fake module backend (swissd) that records what reached it.
func upstream(t *testing.T) (*httptest.Server, *[]seenRequest) {
	t.Helper()
	var seen []seenRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		seen = append(seen, seenRequest{r.Method, r.URL.Path, r.URL.RawQuery, string(b), r.Header.Clone()})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte(`{"from":"swissd"}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func proxyServer(t *testing.T, backendURL string) http.Handler {
	t.Helper()
	cfg := &config.Config{Backends: []config.Backend{{Name: "swiss", Prefix: "/api/deploy", URL: backendURL + "/api"}}}
	return testServerWithConfig(t, cfg).Handler()
}

func TestProxyForwardsUnderPrefixWithIdentity(t *testing.T) {
	up, seen := upstream(t)
	h := proxyServer(t, up.URL)
	admin := login(t, h, "admin", "admin-pw")

	req := httptest.NewRequest("POST", "/api/deploy/plans?dry=1", strings.NewReader(`{"model":"kimi"}`))
	req.Header.Set("Authorization", "Bearer "+admin)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "token", Value: admin})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusTeapot || rec.Body.String() != `{"from":"swissd"}` {
		t.Fatalf("response not passed through: %d %s", rec.Code, rec.Body.String())
	}
	if len(*seen) != 1 {
		t.Fatalf("upstream hits: %d", len(*seen))
	}
	got := (*seen)[0]
	if got.method != "POST" || got.path != "/api/plans" || got.query != "dry=1" || got.body != `{"model":"kimi"}` {
		t.Fatalf("prefix not rewritten onto backend path: %+v", got)
	}
	if u := got.header.Get("X-Remote-User"); u != "admin" {
		t.Fatalf("X-Remote-User = %q", u)
	}
	if g := strings.Join(got.header.Values("X-Remote-Group"), ","); g != "system:authenticated,system:masters" {
		t.Fatalf("X-Remote-Group = %q", g)
	}
	if a := got.header.Get("Authorization"); a != "Bearer "+admin {
		t.Fatalf("caller token not carried: %q", a)
	}
	if c := got.header.Get("Cookie"); c != "" {
		t.Fatalf("browser cookies leaked to backend: %q", c)
	}
}

func TestProxyRequiresLogin(t *testing.T) {
	up, seen := upstream(t)
	h := proxyServer(t, up.URL)
	if rec := do(h, "GET", "/api/deploy/catalog", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: expected 401, got %d", rec.Code)
	}
	if len(*seen) != 0 {
		t.Fatal("anonymous request reached the backend")
	}
}

func TestProxyReplacesSpoofedRemoteHeaders(t *testing.T) {
	up, seen := upstream(t)
	h := proxyServer(t, up.URL)
	bob := login(t, h, "bob", "bob-pw")
	grantBackend(t, h, "bob", "get")

	req := httptest.NewRequest("GET", "/api/deploy/catalog", nil)
	req.Header.Set("Authorization", "Bearer "+bob)
	req.Header.Set("X-Remote-User", "admin")
	req.Header.Set("X-Remote-Group", "system:masters")
	req.Header.Set("X-Remote-Extra-Scope", "all")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if len(*seen) != 1 {
		t.Fatalf("upstream hits: %d", len(*seen))
	}
	hdr := (*seen)[0].header
	if hdr.Get("X-Remote-User") != "bob" || strings.Join(hdr.Values("X-Remote-Group"), ",") != "system:authenticated" || hdr.Get("X-Remote-Extra-Scope") != "" {
		t.Fatalf("spoofed identity reached backend: %v", hdr)
	}
}

func TestProxyAuthorizesPerBackendAndVerb(t *testing.T) {
	up, seen := upstream(t)
	h := proxyServer(t, up.URL)
	bob := login(t, h, "bob", "bob-pw")

	if rec := do(h, "GET", "/api/deploy/catalog", bob, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("bob before grant: expected 403, got %d", rec.Code)
	}

	grantBackend(t, h, "bob", "get")
	if rec := do(h, "GET", "/api/deploy/catalog", bob, ""); rec.Code != http.StatusTeapot {
		t.Fatalf("bob read after grant: expected passthrough, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(h, "POST", "/api/deploy/install", bob, "{}"); rec.Code != http.StatusForbidden {
		t.Fatalf("bob write with read-only grant: expected 403, got %d", rec.Code)
	}
	if rec := do(h, "DELETE", "/api/deploy/releases/x", bob, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("bob delete with read-only grant: expected 403, got %d", rec.Code)
	}
	if len(*seen) != 1 {
		t.Fatalf("only the permitted request may reach the backend, got %d", len(*seen))
	}
}

func TestProxySeparatesBackendAccessFromSettingsWrites(t *testing.T) {
	up, seen := upstream(t)
	h := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{
		Name: "autotune", Prefix: "/api/autotune", URL: up.URL + "/api",
		AccessRules: []config.BackendAccessRule{
			{PathPrefix: "/search-spaces", Methods: []string{"POST"}, ResourceName: "autotune-settings", Verb: "create"},
			{PathPrefix: "/search-spaces/preview", Methods: []string{"POST"}, ResourceName: "autotune", Verb: "get"},
			{PathPrefix: "/policies", Methods: []string{"POST"}, ResourceName: "autotune-settings", Verb: "create"},
			{PathPrefix: "/policies", Methods: []string{"PUT", "PATCH"}, ResourceName: "autotune-settings", Verb: "update"},
			{PathPrefix: "/policies", Methods: []string{"DELETE"}, ResourceName: "autotune-settings", Verb: "delete"},
			{PathPrefix: "/settings", Methods: []string{"GET", "HEAD", "OPTIONS"}, ResourceName: "autotune-settings", Verb: "get"},
			{PathPrefix: "/settings", Methods: []string{"PUT", "PATCH"}, ResourceName: "autotune-settings", Verb: "update"},
			{PathPrefix: "/campaigns", Methods: []string{"POST"}, ResourceName: "autotune", Verb: "create"},
			{PathPrefix: "/", Methods: []string{"POST", "PUT", "PATCH", "DELETE"}, ResourceName: "autotune-unmapped", Verb: "update"},
		},
	}}}).Handler()
	bob := login(t, h, "bob", "bob-pw")
	check := func(method, endpoint string, status int) {
		t.Helper()
		if rec := do(h, method, "/api/autotune"+endpoint, bob, ""); rec.Code != status {
			t.Fatalf("%s %s: want %d, got %d %s", method, endpoint, status, rec.Code, rec.Body.String())
		}
	}

	grantNamedBackend(t, h, "bob", "autotune", "get")
	check("GET", "/policies", http.StatusTeapot)
	check("POST", "/search-spaces/preview?limit=3", http.StatusTeapot)
	check("POST", "/campaigns", http.StatusForbidden)

	for _, verb := range []string{"create", "update", "delete"} {
		grantNamedBackend(t, h, "bob", "autotune", verb)
	}
	check("POST", "/campaigns", http.StatusTeapot)
	check("POST", "/policies", http.StatusForbidden)
	check("PUT", "/policies/7", http.StatusForbidden)
	check("PATCH", "/policies/7", http.StatusForbidden)
	check("DELETE", "/policies/7", http.StatusForbidden)
	check("POST", "/search-spaces", http.StatusForbidden)
	check("POST", "/search-spaces/previews", http.StatusForbidden)
	check("POST", "/other", http.StatusForbidden)
	check("GET", "/settings", http.StatusForbidden)
	check("HEAD", "/settings", http.StatusForbidden)
	check("PUT", "/settings", http.StatusForbidden)

	grantNamedBackend(t, h, "bob", "autotune-settings", "update")
	check("PUT", "/policies/7", http.StatusTeapot)
	check("PUT", "/other", http.StatusForbidden)
	if len(*seen) != 4 || (*seen)[1].path != "/api/search-spaces/preview" || (*seen)[1].query != "limit=3" {
		t.Fatalf("unexpected upstream requests: %+v", *seen)
	}
}

// A backend with a credential of its own (the model gateway) gets that key as
// its Bearer token, not the caller's session -- the session authorizes the
// caller to console, and nothing else.
func TestProxySendsBackendCredential(t *testing.T) {
	t.Setenv("CONSOLE_TEST_GATEWAY_KEY", "gw-secret")
	up, seen := upstream(t)
	cfg := &config.Config{Backends: []config.Backend{{
		Name: "llm", Prefix: "/api/llm", URL: up.URL, APIKeyEnv: "CONSOLE_TEST_GATEWAY_KEY",
	}}}
	h := testServerWithConfig(t, cfg).Handler()
	admin := login(t, h, "admin", "admin-pw")

	if rec := do(h, "POST", "/api/llm/v1/chat/completions", admin, `{"model":"kimi"}`); rec.Code != http.StatusTeapot {
		t.Fatalf("expected passthrough, got %d %s", rec.Code, rec.Body.String())
	}
	if len(*seen) != 1 {
		t.Fatalf("upstream hits: %d", len(*seen))
	}
	if a := (*seen)[0].header.Get("Authorization"); a != "Bearer gw-secret" {
		t.Fatalf("backend credential not sent: %q", a)
	}
}

// Without apiKeyEnv the caller's token is still carried, which is what a backend
// verifying the JWT itself needs.
func TestProxyWithoutCredentialCarriesSession(t *testing.T) {
	up, seen := upstream(t)
	h := proxyServer(t, up.URL)
	admin := login(t, h, "admin", "admin-pw")

	if rec := do(h, "GET", "/api/deploy/catalog", admin, ""); rec.Code != http.StatusTeapot {
		t.Fatalf("expected passthrough, got %d", rec.Code)
	}
	if a := (*seen)[0].header.Get("Authorization"); a != "Bearer "+admin {
		t.Fatalf("caller token not carried: %q", a)
	}
}

// The Playground's path end to end: the caller's request reaches the gateway
// carrying the credential console holds (not the caller's token), the
// conversation id reaches it too, and the gateway's frames come back as they are
// produced rather than all at the end.
func TestProxyStreamsSSEFromGateway(t *testing.T) {
	t.Setenv("CONSOLE_TEST_GATEWAY_KEY", "gw-secret")
	release := make(chan struct{})
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := r.Header.Get("Authorization"); a != "Bearer gw-secret" {
			t.Errorf("gateway saw Authorization %q, want its own key", a)
		}
		if s := r.Header.Get("X-Session-Id"); s != "conv-1" {
			t.Errorf("gateway saw X-Session-Id %q, want the conversation", s)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"first"}}]}`+"\n\n")
		flusher.Flush()
		<-release // hold the response open: a buffering proxy would show nothing yet
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	t.Cleanup(gateway.Close)

	cfg := &config.Config{Backends: []config.Backend{{
		Name: "llm", Prefix: "/api/llm", URL: gateway.URL, APIKeyEnv: "CONSOLE_TEST_GATEWAY_KEY",
	}}}
	srv := testServerWithConfig(t, cfg)
	console := httptest.NewServer(srv.Handler())
	t.Cleanup(console.Close)

	req, err := http.NewRequest("POST", console.URL+"/api/llm/v1/chat/completions", strings.NewReader(`{"model":"m","stream":true}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+login(t, srv.Handler(), "admin", "admin-pw"))
	req.Header.Set("X-Session-Id", "conv-1")
	resp, err := console.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content type: %q", resp.Header.Get("Content-Type"))
	}

	reader := bufio.NewReader(resp.Body)
	first := make(chan string, 1)
	go func() {
		line, err := reader.ReadString('\n')
		if err != nil {
			line = ""
		}
		first <- line
	}()
	select {
	case line := <-first:
		if !strings.Contains(line, "first") {
			t.Fatalf("first frame: %q", line)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the gateway was still generating and no frame arrived: the proxy buffered the stream")
	}

	close(release)
	rest, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rest), "[DONE]") {
		t.Fatalf("stream did not finish: %q", rest)
	}
}

// A gateway backend finds its URL, route and key in the cluster, so nothing
// about the entrypoint is copied into a values file. Here the console's own
// config names only the site profile, and everything else comes from the objects
// beside it -- the same ones swissd deploys from.
func TestGatewayBackendResolvesFromCluster(t *testing.T) {
	cfg := &config.Config{Backends: []config.Backend{{
		Name: "llm", Prefix: "/api/llm", Gateway: &config.Gateway{Profile: "llm/site-profile"},
	}}}
	srv := testServerWithConfig(t, cfg, gatewayObjects(t)...)

	resolve, err := srv.targetFunc(cfg.Backends[0])
	if err != nil {
		t.Fatal(err)
	}
	target, err := resolve(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	// Every route, the aggregate one first: which serves what is asked per model.
	if got := target.url.String(); got != "http://openresty.llm.svc:8080" || strings.Join(target.routes, ",") != "llm-gateway,kimi-k2.6" {
		t.Fatalf("target = %q routes %v", got, target.routes)
	}
	if target.header != "Authorization" || target.key != "Bearer gw-key-1" {
		t.Fatalf("credential = %q %q", target.header, target.key)
	}
}

// A gateway that cannot be found answers 502 with the reason, not a 404 from the
// SPA, and not a request sent somewhere arbitrary.
func TestGatewayBackendUnresolved(t *testing.T) {
	cfg := &config.Config{Backends: []config.Backend{{
		Name: "llm", Prefix: "/api/llm", Gateway: &config.Gateway{Profile: "llm/absent"},
	}}}
	h := testServerWithConfig(t, cfg).Handler()
	admin := login(t, h, "admin", "admin-pw")

	rec := do(h, "GET", "/api/llm/v1/models", admin, "")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "backend llm") || !strings.Contains(body, "absent") {
		t.Fatalf("the reason is missing from %s", body)
	}
}

// The objects a real install has: the swiss site profile, the openresty route
// ConfigMap and the key Secret.
func gatewayObjects(t *testing.T) []runtime.Object {
	t.Helper()
	return []runtime.Object{
		&unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "v1", "kind": "ConfigMap",
			"metadata": map[string]any{"name": "site-profile", "namespace": "llm"},
			"data":     map[string]any{"profile.yaml": "name: llm\nroute:\n  nginxConfigMap: llm/openresty-conf\n  nginxService: llm/openresty\n  auth:\n    secretRef: llm/openresty-keys\n"},
		}},
		&unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "v1", "kind": "ConfigMap",
			"metadata": map[string]any{"name": "openresty-conf", "namespace": "llm"},
			"data": map[string]any{
				"session_route_kimi-k2.6.conf":   "set $route \"kimi-k2.6\";\n",
				"session_route_llm-gateway.conf": "peers_by_model = {}\n",
			},
		}},
		&unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "v1", "kind": "Secret",
			"metadata": map[string]any{"name": "openresty-keys", "namespace": "llm"},
			"data":     map[string]any{"keys": base64.StdEncoding.EncodeToString([]byte("gw-key-1:alice,gw-key-2:bob"))},
		}},
	}
}

func TestProxyBackendDown(t *testing.T) {
	up, _ := upstream(t)
	down := up.URL
	up.Close()
	h := proxyServer(t, down)
	admin := login(t, h, "admin", "admin-pw")

	rec := do(h, "GET", "/api/deploy/catalog", admin, "")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("backend down: expected JSON 502, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestProxyLeavesOwnRoutesAlone(t *testing.T) {
	up, seen := upstream(t)
	h := proxyServer(t, up.URL)
	admin := login(t, h, "admin", "admin-pw")
	if rec := do(h, "GET", "/api/me", admin, ""); rec.Code != http.StatusOK {
		t.Fatalf("/api/me: %d", rec.Code)
	}
	if rec := do(h, "GET", "/api/deployments", admin, ""); rec.Code == http.StatusTeapot {
		t.Fatal("a path that only shares a string prefix with the backend was proxied")
	}
	if len(*seen) != 0 {
		t.Fatalf("console's own routes reached the backend: %+v", *seen)
	}
}

// grantBackend binds user to a role allowing verb on the "swiss" backend.
func grantBackend(t *testing.T, h http.Handler, user, verb string) {
	t.Helper()
	grantNamedBackend(t, h, user, "swiss", verb)
}

func grantNamedBackend(t *testing.T, h http.Handler, user, backend, verb string) {
	t.Helper()
	admin := login(t, h, "admin", "admin-pw")
	name := backend + "-" + verb
	role := fmt.Sprintf(`{"name":%q,"rules":[{"verbs":[%q],"apiGroups":["iam.theriseunion.io"],"resources":["backends"],"resourceNames":[%q]}]}`, name, verb, backend)
	if rec := do(h, "POST", "/api/iam/roles", admin, role); rec.Code != http.StatusCreated {
		t.Fatalf("create role: %d %s", rec.Code, rec.Body.String())
	}
	binding := fmt.Sprintf(`{"name":%q,"role":%q,"subjects":[{"kind":"User","name":%q}]}`, user+"-"+name, name, user)
	if rec := do(h, "POST", "/api/iam/rolebindings", admin, binding); rec.Code != http.StatusCreated {
		t.Fatalf("create binding: %d %s", rec.Code, rec.Body.String())
	}
}

// The production mux also serves the embedded SPA on "/". Registering it next to
// a backend prefix must not collide (Go's ServeMux panics on ambiguous patterns),
// and each must still get its own requests.
func TestProxyCoexistsWithSPA(t *testing.T) {
	up, seen := upstream(t)
	srv := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{Name: "swiss", Prefix: "/api/deploy", URL: up.URL + "/api"}}})
	srv.SetWeb(fstest.MapFS{"index.html": {Data: []byte("<html>console</html>")}})

	var h http.Handler
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("Handler panicked: %v", r)
			}
		}()
		h = srv.Handler()
	}()

	if rec := do(h, "GET", "/swiss/catalog", "", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console") {
		t.Fatalf("SPA route: %d %q", rec.Code, rec.Body.String())
	}
	admin := login(t, h, "admin", "admin-pw")
	if rec := do(h, "POST", "/api/deploy/plans", admin, "{}"); rec.Code != http.StatusTeapot || len(*seen) != 1 {
		t.Fatalf("proxy beside SPA: %d, hits %d", rec.Code, len(*seen))
	}
	if rec := do(h, "POST", "/swiss/catalog", "", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("non-GET on an SPA route: expected 405, got %d", rec.Code)
	}
}
