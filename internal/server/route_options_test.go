package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/modelsphere/console/internal/config"
)

const routeOptionsFixture = `{"route":"model","directives":[{"key":"tps_limit_tps","label":"Decode rate threshold","group":"Thresholds","kind":"number","fallback":"73","detail":"Deployment default","value":81,"set":true}],"advanced":[],"peers":{"count":3},"adaptive_cc_derived":{"_":{"static_max":200,"min":80,"init":80}}}`

func TestRouteOptionsWithoutGatewayDoesNotServeSPA(t *testing.T) {
	cfg := &config.Config{}
	cfg.Server.Auth.Disabled = true
	srv := testServerWithConfig(t, cfg)
	srv.SetWeb(fstest.MapFS{"index.html": {Data: []byte("<html>SPA</html>")}})
	rec := do(srv.Handler(), "GET", "/api/llm/route-options", "", "")
	if rec.Code != http.StatusNotFound || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("missing gateway must select legacy fallback, got %d %s: %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
}

func TestRouteOptionsLiveCatalog(t *testing.T) {
	var paths []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Remote-User") != "" {
			t.Error("credentials or identity forwarded to public route catalog")
		}
		if r.URL.Path == "/video/_route_opts" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/model/_route_opts" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(routeOptionsFixture))
	}))
	defer up.Close()
	base, _ := url.Parse(up.URL)
	srv := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &config.Gateway{ConfigMap: "llm/routes", Service: "llm/openresty"}}}})
	srv.targetsOnce.Do(func() {
		srv.targets = map[string]targetResolver{"llm": func(context.Context) (*backendTarget, error) {
			return &backendTarget{url: *base, routes: []string{"video", "model"}, key: "secret", header: "Authorization"}, nil
		}}
	})
	h := srv.Handler()
	admin := login(t, h, "admin", "admin-pw")
	for _, path := range []string{"/api/llm/route-options", "/api/llm/route-options?route=model"} {
		rec := do(h, "GET", path, admin, "")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"fallback":"73"`) || !strings.Contains(rec.Body.String(), `"value":81`) {
			t.Fatalf("live catalog = %d %s", rec.Code, rec.Body.String())
		}
	}
	if strings.Join(paths, ",") != "/video/_route_opts,/model/_route_opts,/model/_route_opts" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestRouteOptionsEmptyGatewayAndResolutionFailure(t *testing.T) {
	for _, tc := range []struct {
		ref  string
		want int
	}{
		{"llm/openresty-conf", http.StatusNotFound},
		{"llm/missing-conf", http.StatusBadGateway},
	} {
		t.Run(tc.ref, func(t *testing.T) {
			objects := gatewayObjects(t)
			objects[1].(*unstructured.Unstructured).Object["data"] = map[string]any{}
			cfg := &config.Config{Backends: []config.Backend{{Name: "llm", Prefix: "/api/llm", Gateway: &config.Gateway{ConfigMap: tc.ref, Service: "llm/openresty"}}}}
			h := testServerWithConfig(t, cfg, objects...).Handler()
			admin := login(t, h, "admin", "admin-pw")
			rec := do(h, "GET", "/api/llm/route-options", admin, "")
			if rec.Code != tc.want {
				t.Fatalf("catalog = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestRouteOptionsReadGrantAndStaticRoute(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/model/_route_opts" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(routeOptionsFixture))
	}))
	defer up.Close()
	h := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{Name: "llm", Prefix: "/api/llm", URL: up.URL + "/model"}}}).Handler()
	admin, bob := login(t, h, "admin", "admin-pw"), login(t, h, "bob", "bob-pw")
	for _, tc := range []struct{ path, body string }{
		{"/api/iam/roles", `{"name":"catalog-reader","rules":[{"verbs":["get"],"apiGroups":["iam.theriseunion.io"],"resources":["backends"],"resourceNames":["llm"]}]}`},
		{"/api/iam/rolebindings", `{"name":"bob-catalog-reader","role":"catalog-reader","subjects":[{"kind":"User","name":"bob"}]}`},
	} {
		if rec := do(h, "POST", tc.path, admin, tc.body); rec.Code != http.StatusCreated {
			t.Fatalf("grant: %d %s", rec.Code, rec.Body.String())
		}
	}
	if rec := do(h, "GET", "/api/llm/route-options?route=model", bob, ""); rec.Code != http.StatusOK || rec.Body.String() != routeOptionsFixture {
		t.Fatalf("read grant: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(h, "GET", "/api/llm/route-options?route=another", bob, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown route: %d %s", rec.Code, rec.Body.String())
	}
}

func TestRouteOptionsDoesNotFollowRedirects(t *testing.T) {
	redirected := 0
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected++
		_, _ = w.Write([]byte(routeOptionsFixture))
	}))
	defer other.Close()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, http.StatusFound) }))
	defer up.Close()
	h := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{Name: "llm", Prefix: "/api/llm", URL: up.URL + "/model"}}}).Handler()
	admin := login(t, h, "admin", "admin-pw")
	rec := do(h, "GET", "/api/llm/route-options", admin, "")
	if rec.Code != http.StatusBadGateway || redirected != 0 {
		t.Fatalf("redirect: %d, followed %d times", rec.Code, redirected)
	}
}

func TestReadRouteOptionsBoundsAndShape(t *testing.T) {
	for _, body := range []string{"{}", `{"route":"model","directives":null,"advanced":[]}`, `{"route":"model","directives":[],"advanced":{}}`, strings.Repeat(" ", 1<<20) + routeOptionsFixture} {
		up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
		_, _, err := readRouteOptions(t.Context(), up.Client(), up.URL)
		up.Close()
		if err == nil {
			t.Fatal("invalid or oversized catalog accepted")
		}
	}
}

func TestRouteOptionsAccessAndFailures(t *testing.T) {
	for _, status := range []int{200, 404, 401, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			hits := 0
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				w.WriteHeader(status)
				if status == 200 {
					_, _ = w.Write([]byte("not json"))
				}
			}))
			defer up.Close()
			srv := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{Name: "llm", Prefix: "/api/llm", URL: up.URL + "/model"}}})
			h := srv.Handler()
			admin, bob := login(t, h, "admin", "admin-pw"), login(t, h, "bob", "bob-pw")
			for _, tc := range []struct {
				method, path, token string
				want                int
			}{
				{"GET", "/api/llm/route-options", "", 401},
				{"GET", "/api/llm/route-options", bob, 403},
				{"POST", "/api/llm/route-options", admin, 405},
				{"GET", "/api/llm/route-options?route=..%2Felsewhere", admin, 400},
			} {
				rec := do(h, tc.method, tc.path, tc.token, "")
				if rec.Code != tc.want {
					t.Fatalf("%s %s = %d, want %d", tc.method, tc.path, rec.Code, tc.want)
				}
			}
			if hits != 0 {
				t.Fatalf("rejected requests reached upstream: %d", hits)
			}
			rec := do(h, "GET", "/api/llm/route-options", admin, "")
			want := http.StatusBadGateway
			if status == 404 {
				want = 404
			}
			if rec.Code != want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, want, rec.Body.String())
			}
		})
	}
}
